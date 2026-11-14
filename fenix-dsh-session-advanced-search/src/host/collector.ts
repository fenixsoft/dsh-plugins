/**
 * host 半机械预筛收集器（design D4，全程只读）。
 *
 * 管线（逐级可观测，各级候选数量以 debug 级日志输出）：
 *   1. 只读收集：`sessionPersistence.list()` 全量 header（覆盖全部工作区，
 *      含归档会话）；`ctx.sessionController.list()` 在缝可用时提供 title 与
 *      updatedAt 增强（header 自身无 title/活动时间——侦察结论见 design.md）。
 *   2. 可选时间范围过滤：活动时间（controller updatedAt 优先，回退
 *      header.createdAt）落在 [start, end) 内才保留。
 *   2b. cold 会话 title 折叠回退（BUG-01 修复）：controller.list 对未激活
 *      （cold）会话只回投影缓存且永不折叠（官方 api-session-controller list
 *      「a listing never seeds a fold」），无缓存行 title 恒空 → 标题计分
 *      整体失效。对过滤后仍无投影 title 的会话，经
 *      `sessionPersistence.open(id, 'read')` 只读事件流折叠最后一条
 *      `session/title` 事件的 `data.title`（官方 dsh-session-title
 *      foldSessionTitle 的 findLast last-wins 同语义）；按最近活跃优先、上限
 *      TITLE_FOLD_MAX_SESSIONS，单会话失败 warn 隔离；读取成功的同时缓存
 *      首条用户消息供第 5 步节选复用（同会话只读一次事件流）。
 *   3. 关键词计分：query 切词后对标题（+2/词）与工作区路径（+1/词）命中计分。
 *   4. 截断 maxCandidates：评分优先、同分取最近活跃。
 *   5. 首条用户消息节选（仅截断后的候选集，≤2048 UTF-8 字节/会话）：优先
 *      复用 2b 缓存，未缓存的候选经 `sessionPersistence.open(id, 'read')`
 *      只读扫描 `user/message` 事件；单会话读取失败不中断整轮（warn + 空节选）。
 *
 * 只读纪律：绝不调用 persist* 系列写通道（persistHeader/persistBatch），绝不以 'write'
 * 打开会话；不修改任何会话产物（spec「分析只读」场景）。
 */
import type { DshSessionController, DshSessionEvent, DshSessionPersistence } from '../types/dsh-runtime.js'
import type { SearchRequest, SearchTimeRange } from '../shared/protocol.js'
import { errorMessage } from '../shared/errors.js'

/** 单会话首条用户消息节选字节上限（design D4：2KB）。 */
export const EXCERPT_MAX_BYTES = 2048

/**
 * cold 会话 title 折叠读取上限（防超长收集）：折叠回退需对无投影 title 的
 * 会话逐个读事件流，生产实例 cold 会话可达数百；按最近活跃优先折叠，超限的
 * 更早会话 title 保持空（仍有 cwd 计分与 header-only 路径，功能不失效）。
 */
export const TITLE_FOLD_MAX_SESSIONS = 200

/** 收集器日志门面（debug 逐级可观测；warn 单会话失败隔离）。 */
export interface CollectorLog {
  debug(message: string): void
  warn(message: string): void
}

/** 收集器依赖缝（测试注入假实现；host 装配传 ctx 缝）。 */
export interface CollectorDeps {
  readonly persistence: DshSessionPersistence
  /** title/updatedAt 增强源（可选缝；缺失回退 header-only）。 */
  readonly sessionController?: DshSessionController | undefined
  readonly log: CollectorLog
}

/** 预筛后的候选行（analyzer 输入；reason/confidence 由分析层赋予）。 */
export interface PrefilteredSession {
  readonly sessionId: string
  readonly title: string
  readonly workspacePath: string
  readonly activityTime: number
  /** 机械计分（关键词命中；无命中 0）。 */
  readonly score: number
  /** 首条用户消息节选（≤2KB；读取失败为空串）。 */
  readonly excerpt: string
}

/** 管线各阶段统计（debug 日志与测试断言面）。 */
export interface CollectStats {
  /** 只读收集总数。 */
  readonly total: number
  /** 时间范围过滤后剩余。 */
  readonly afterTimeFilter: number
  /** 计分截断后候选数。 */
  readonly afterScoring: number
}

export interface CollectOutcome {
  readonly candidates: readonly PrefilteredSession[]
  readonly stats: CollectStats
}

/**
 * 执行机械预筛管线。整管线只读；signal 支持任务取消（阶段间与逐会话读取检查）。
 */
export async function collectCandidates(
  deps: CollectorDeps,
  request: SearchRequest,
  maxCandidates: number,
  signal: AbortSignal,
): Promise<CollectOutcome> {
  // 1. 只读收集：全量 header（覆盖全部工作区）。
  const snapshots = await deps.persistence.list({ signal })
  const total = snapshots.length
  deps.log.debug(`session-advanced-search: 收集会话 ${total} 个（全工作区，只读 header）`)

  // 增强：controller.list 的 title/updatedAt（可选缝；失败回退 header-only）。
  const enrichment = await loadEnrichment(deps, signal)

  // 2. 时间范围过滤（活动时间：updatedAt 优先，回退 createdAt）。
  const ranged = filterByTimeRange(snapshots, enrichment, request.timeRange)
  deps.log.debug(`session-advanced-search: 时间过滤后 ${ranged.length} 个（范围 ${describeRange(request.timeRange)}）`)

  // 2b. cold 会话 title 折叠回退（BUG-01 修复）：投影缓存对 cold 会话永不
  //     折叠，无缓存行 title 恒空 → 标题计分失效；经只读事件流折叠补齐，
  //     并缓存首条用户消息供第 5 步节选复用。
  const excerptsById = await foldColdTitles(deps, ranged, enrichment, signal)

  // 3. 关键词计分 + 4. 截断（评分优先、同分取最近活跃）。
  const scored = scoreSessions(ranged, enrichment, request.query)
  scored.sort(compareByScoreThenRecency)
  const truncated = scored.slice(0, Math.max(1, maxCandidates))
  deps.log.debug(`session-advanced-search: 计分截断后 ${truncated.length} 个（maxCandidates=${maxCandidates}）`)

  // 5. 首条用户消息节选（仅截断后的候选集，控制读取成本；2b 缓存优先）。
  const candidates: PrefilteredSession[] = []
  for (const row of truncated) {
    if (signal.aborted) break
    const excerpt = await readFirstUserMessage(deps.persistence, row.sessionId, signal, deps.log, excerptsById)
    candidates.push({ ...row, excerpt })
  }
  return { candidates, stats: { total, afterTimeFilter: ranged.length, afterScoring: truncated.length } }
}

/** controller.list 增强索引（sessionId → {title, updatedAt}）。 */
interface Enrichment {
  readonly byId: Map<string, { title: string; updatedAt: number }>
}

/** 加载增强源；缝缺失或调用失败均回退空索引（header-only 路径）。 */
async function loadEnrichment(deps: CollectorDeps, signal: AbortSignal): Promise<Enrichment> {
  const controller = deps.sessionController
  if (controller === undefined || typeof controller.list !== 'function') {
    deps.log.debug('session-advanced-search: sessionController 缝缺失，按 header-only 收集（无 title/updatedAt 增强）')
    return { byId: new Map() }
  }
  try {
    const value = await controller.list({}, signal)
    const byId = new Map<string, { title: string; updatedAt: number }>()
    for (const item of value.items ?? []) {
      // updatedAt 数值守卫（与 title 守卫同口径）：缝漂移返回非有限数值时
      // 跳过该条，该会话回退 header-only（活动时间用 header.createdAt），
      // 避免时间过滤比较失真与下游 toISOString() 对 Invalid Date 抛错。
      const updatedAt: unknown = item.updatedAt
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) continue
      byId.set(item.sessionId, {
        title: readProjectionTitle(item),
        updatedAt,
      })
    }
    return { byId }
  } catch (error) {
    if (signal.aborted) return { byId: new Map() }
    deps.log.warn(`session-advanced-search: sessionController.list 增强失败，回退 header-only：${errorMessage(error)}`)
    return { byId: new Map() }
  }
}

/** 从 summary 投影里读 title（dsh-session-title title 投影，string | null）。 */
function readProjectionTitle(summary: { projections?: { values?: Readonly<Record<string, unknown>> } }): string {
  const values = summary.projections?.values
  if (values === undefined) return ''
  const title = values['title']
  return typeof title === 'string' ? title : ''
}

/** 会话活动时间：增强 updatedAt 优先，回退 header.createdAt（时间过滤/折叠排序共用）。 */
function activityTimeOf(
  enrichment: Enrichment,
  header: { readonly id: string; readonly createdAt: number },
): number {
  return enrichment.byId.get(header.id)?.updatedAt ?? header.createdAt
}

/**
 * cold 会话 title 折叠回退（只读，BUG-01 修复）。
 *
 * controller.list 对 cold（未激活）会话只回投影缓存且永不折叠（官方
 * api-session-controller list.js projectionsFor：「a listing never seeds a
 * fold / missing cache rows are never folded here」），无缓存行 title 恒空 →
 * 标题计分整体失效、排序退化为纯最近活跃。对**时间过滤后仍无投影 title** 的
 * 会话，经只读事件流折叠最后一条 `session/title` 事件的 `data.title` 补齐
 * （官方 dsh-session-title foldSessionTitle 的 findLast last-wins 同语义）。
 *
 * 成本与鲁棒性：按最近活跃优先串行读取、上限 TITLE_FOLD_MAX_SESSIONS（超限
 * 的更早会话 title 保持空，debug 说明）；单会话失败 warn 隔离不中断。读取
 * 成功的同时缓存首条用户消息（未截断全文）供第 5 步节选复用，同一会话至多
 * 读一次事件流。返回 sessionId → 首条用户消息全文。
 */
async function foldColdTitles(
  deps: CollectorDeps,
  snapshots: readonly { header: { readonly id: string; readonly createdAt: number } }[],
  enrichment: Enrichment,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const excerptsById = new Map<string, string>()
  const cold = snapshots
    .filter((snapshot) => (enrichment.byId.get(snapshot.header.id)?.title ?? '') === '')
    .sort((a, b) => activityTimeOf(enrichment, b.header) - activityTimeOf(enrichment, a.header))
  if (cold.length === 0) return excerptsById
  const limited = cold.slice(0, TITLE_FOLD_MAX_SESSIONS)
  if (cold.length > limited.length) {
    deps.log.debug(
      `session-advanced-search: cold title 折叠达上限 ${TITLE_FOLD_MAX_SESSIONS}，其余 ${cold.length - limited.length} 个更早会话不折叠（title 保持空）`,
    )
  }
  let folded = 0
  for (const snapshot of limited) {
    if (signal.aborted) break
    const id = snapshot.header.id
    try {
      const events = await readEventStream(deps.persistence, id, signal)
      excerptsById.set(id, extractFirstUserText(events))
      const title = foldTitleFromEvents(events)
      const enriched = enrichment.byId.get(id)
      enrichment.byId.set(id, enriched !== undefined ? { ...enriched, title } : { title, updatedAt: snapshot.header.createdAt })
      if (title !== '') folded += 1
    } catch (error) {
      if (signal.aborted) break
      deps.log.warn(`session-advanced-search: 会话 ${id} cold title 折叠读取失败（title 保持空）：${errorMessage(error)}`)
    }
  }
  deps.log.debug(`session-advanced-search: cold title 折叠完成（无投影 title ${limited.length} 个，折叠出标题 ${folded} 个）`)
  return excerptsById
}

/**
 * 折叠会话标题：事件流中最后一条 `session/title` 事件的 `data.title`
 * （官方 dsh-session-title titleProjectionDefinition.apply 的 last-wins 同
 * 语义；缺 data 或 title 非字符串视为无标题）。纯函数，导出供测试。
 */
export function foldTitleFromEvents(events: readonly DshSessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type !== 'session/title') continue
    const data: unknown = event.data
    if (data !== null && typeof data === 'object') {
      const title = (data as Record<string, unknown>).title
      if (typeof title === 'string') return title
    }
    return ''
  }
  return ''
}

/** 只读载入会话事件流（open→read→close；异常上抛由调用方隔离）。 */
async function readEventStream(
  persistence: DshSessionPersistence,
  sessionId: string,
  signal: AbortSignal,
): Promise<readonly DshSessionEvent[]> {
  const handle = await persistence.open(sessionId, 'read', { signal })
  try {
    const { events } = await handle.read()
    return events
  } finally {
    // close 失败（句柄已失效、后端异常等）不得覆盖 read 的原始异常：
    // 上层 warn 隔离日志记录的须是真实读取失败原因。本函数无日志缝，
    // close 失败静默吞掉（close 结果不影响已读取的事件流语义）。
    try {
      await handle.close()
    } catch {
      // 静默吞掉，见上注释。
    }
  }
}

/** 时间范围过滤（闭开区间 [start, end)；无范围原样通过）。 */
function filterByTimeRange(
  snapshots: readonly { header: { readonly id: string; readonly createdAt: number; readonly cwd?: string } }[],
  enrichment: Enrichment,
  range: SearchTimeRange | undefined,
): typeof snapshots {
  if (range === undefined) return snapshots
  return snapshots.filter((snapshot) => {
    const activity = activityTimeOf(enrichment, snapshot.header)
    return activity >= range.start && activity < range.end
  })
}

/** 计分后的中间行（含时间/标题/路径与得分）。 */
interface ScoredRow {
  readonly sessionId: string
  readonly title: string
  readonly workspacePath: string
  readonly activityTime: number
  readonly score: number
}

/** 关键词计分：标题命中 +2/词、工作区路径命中 +1/词（大小写不敏感）。 */
function scoreSessions(
  snapshots: readonly { header: { readonly id: string; readonly createdAt: number; readonly cwd?: string } }[],
  enrichment: Enrichment,
  query: string,
): ScoredRow[] {
  const tokens = tokenize(query)
  return snapshots.map((snapshot) => {
    const header = snapshot.header
    const enriched = enrichment.byId.get(header.id)
    const title = enriched?.title ?? ''
    const workspacePath = header.cwd ?? ''
    const activityTime = enriched?.updatedAt ?? header.createdAt
    let score = 0
    for (const token of tokens) {
      if (title.toLowerCase().includes(token)) score += 2
      if (workspacePath.toLowerCase().includes(token)) score += 1
    }
    return { sessionId: header.id, title, workspacePath, activityTime, score }
  })
}

/**
 * query 切词：ASCII/数字词（≥2 字符）逐词；CJK 连续段按 2 字片段切
 * （自然语言描述无分词边界，2-gram 提供稳健的子串命中信号）；长度为 1
 * 的 CJK 段切不出 2-gram，保留单字 token 参与标题/路径子串命中（否则
 * 单汉字 query 下机械分全零，截断退化为纯最近活跃、较早相关会话失去召回）。
 */
export function tokenize(query: string): string[] {
  const tokens: string[] = []
  for (const match of query.toLowerCase().matchAll(/([a-z0-9_./\\-]{2,})|([一-鿿]{1,})/g)) {
    const [, ascii, cjk] = match
    if (ascii !== undefined) {
      tokens.push(ascii)
    } else if (cjk !== undefined) {
      if (cjk.length === 1) {
        tokens.push(cjk)
      } else {
        for (let i = 0; i + 2 <= cjk.length; i += 1) tokens.push(cjk.slice(i, i + 2))
      }
    }
  }
  return tokens
}

/** 排序：评分降序，同分取最近活跃。 */
function compareByScoreThenRecency(a: ScoredRow, b: ScoredRow): number {
  if (a.score !== b.score) return b.score - a.score
  return b.activityTime - a.activityTime
}

/**
 * 只读读取某会话首条用户消息的 ≤2KB 文本节选。
 * 优先复用 cold title 折叠阶段缓存的事件流读取结果（同一会话至多读一次流）；
 * 缓存未命中再读。单会话失败（含打开/读流异常）warn 隔离返回空串，不中断
 * 整轮收集。
 */
async function readFirstUserMessage(
  persistence: DshSessionPersistence,
  sessionId: string,
  signal: AbortSignal,
  log: CollectorLog,
  excerptsById?: ReadonlyMap<string, string>,
): Promise<string> {
  const cached = excerptsById?.get(sessionId)
  if (cached !== undefined) return byteTruncate(cached, EXCERPT_MAX_BYTES)
  try {
    // 成本假设：handle.read() 为缝当前唯一形态（一次性全量载入事件流；
    // 类型面 read(offset?, length?) 的偏移语义未钉死、返回仍是全量
    // events 数组，故不走分页）。长会话事件流可达数 MB，串行读取
    // maxCandidates 个候选的瞬时内存峰值与耗时在此接受。
    const events = await readEventStream(persistence, sessionId, signal)
    return byteTruncate(extractFirstUserText(events), EXCERPT_MAX_BYTES)
  } catch (error) {
    if (signal.aborted) return ''
    log.warn(`session-advanced-search: 会话 ${sessionId} 首条用户消息读取失败（跳过节选）：${errorMessage(error)}`)
    return ''
  }
}

/**
 * 扫描事件流取首条 user/message 的 text 块拼接（防御未知形状）。
 *
 * 事件形态：`handle.read()` 返回存储 envelope（`{type,seq,time,data}`，
 * 真机 jsonl 后端实证），user/message 文本块在 `data.content`；顶层
 * `content` 仅作运行时形态的兼容回退（BUG-02 回归：只读顶层 content
 * 时真机节选恒空）。
 */
export function extractFirstUserText(events: readonly { readonly type: string; readonly [key: string]: unknown }[]): string {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const data = event.data
    const envelopeContent = data !== null && typeof data === 'object' ? (data as Record<string, unknown>).content : undefined
    const content = Array.isArray(envelopeContent) ? envelopeContent : event.content
    if (!Array.isArray(content)) continue
    const parts: string[] = []
    for (const block of content) {
      if (block !== null && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
        const text = (block as Record<string, unknown>).text
        if (typeof text === 'string' && text.length > 0) parts.push(text)
      }
    }
    if (parts.length > 0) return parts.join('\n')
  }
  return ''
}

/** UTF-8 字节安全截断（≤maxBytes；多字节序列不截半字符）。 */
export function byteTruncate(text: string, maxBytes: number): string {
  const source = Buffer.from(text, 'utf8')
  if (source.length <= maxBytes) return text
  const sliced = source.subarray(0, maxBytes).toString('utf8')
  // toString('utf8') 已把尾部残缺序列替换为 U+FFFD；去掉该替换符保证不截半字。
  return sliced.endsWith('�') ? sliced.slice(0, -1) : sliced
}

/** 时间范围描述（debug 日志）。 */
function describeRange(range: SearchTimeRange | undefined): string {
  if (range === undefined) return '未提供'
  return `[${new Date(range.start).toISOString()}, ${new Date(range.end).toISOString()})`
}
