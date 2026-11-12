/**
 * host 半机械预筛收集器（design D4，全程只读）。
 *
 * 管线（逐级可观测，各级候选数量以 debug 级日志输出）：
 *   1. 只读收集：`sessionPersistence.list()` 全量 header（覆盖全部工作区，
 *      含归档会话）；`ctx.sessionController.list()` 在缝可用时提供 title 与
 *      updatedAt 增强（header 自身无 title/活动时间——侦察结论见 design.md）。
 *   2. 可选时间范围过滤：活动时间（controller updatedAt 优先，回退
 *      header.createdAt）落在 [start, end) 内才保留。
 *   3. 关键词计分：query 切词后对标题（+2/词）与工作区路径（+1/词）命中计分。
 *   4. 截断 maxCandidates：评分优先、同分取最近活跃。
 *   5. 首条用户消息节选（仅截断后的候选集，≤2048 UTF-8 字节/会话）：经
 *      `sessionPersistence.open(id, 'read')` 只读扫描 `user/message` 事件；
 *      单会话读取失败不中断整轮（warn + 空节选）。
 *
 * 只读纪律：绝不调用 persist* 系列写通道（persistHeader/persistBatch），绝不以 'write'
 * 打开会话；不修改任何会话产物（spec「分析只读」场景）。
 */
import type { DshSessionController, DshSessionPersistence } from '../types/dsh-runtime.js'
import type { SearchRequest, SearchTimeRange } from '../shared/protocol.js'

/** 单会话首条用户消息节选字节上限（design D4：2KB）。 */
export const EXCERPT_MAX_BYTES = 2048

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

  // 3. 关键词计分 + 4. 截断（评分优先、同分取最近活跃）。
  const scored = scoreSessions(ranged, enrichment, request.query)
  scored.sort(compareByScoreThenRecency)
  const truncated = scored.slice(0, Math.max(1, maxCandidates))
  deps.log.debug(`session-advanced-search: 计分截断后 ${truncated.length} 个（maxCandidates=${maxCandidates}）`)

  // 5. 首条用户消息节选（仅截断后的候选集，控制读取成本）。
  const candidates: PrefilteredSession[] = []
  for (const row of truncated) {
    if (signal.aborted) break
    const excerpt = await readFirstUserMessage(deps.persistence, row.sessionId, signal, deps.log)
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

/** 时间范围过滤（闭开区间 [start, end)；无范围原样通过）。 */
function filterByTimeRange(
  snapshots: readonly { header: { readonly id: string; readonly createdAt: number; readonly cwd?: string } }[],
  enrichment: Enrichment,
  range: SearchTimeRange | undefined,
): typeof snapshots {
  if (range === undefined) return snapshots
  return snapshots.filter((snapshot) => {
    const activity = enrichment.byId.get(snapshot.header.id)?.updatedAt ?? snapshot.header.createdAt
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
 * （自然语言描述无分词边界，2-gram 提供稳健的子串命中信号）。
 */
export function tokenize(query: string): string[] {
  const tokens: string[] = []
  for (const match of query.toLowerCase().matchAll(/([a-z0-9_./\\-]{2,})|([一-鿿]{1,})/g)) {
    const [, ascii, cjk] = match
    if (ascii !== undefined) {
      tokens.push(ascii)
    } else if (cjk !== undefined) {
      for (let i = 0; i + 2 <= cjk.length; i += 1) tokens.push(cjk.slice(i, i + 2))
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
 * 单会话失败（含打开/读流异常）warn 隔离返回空串，不中断整轮收集。
 */
async function readFirstUserMessage(
  persistence: DshSessionPersistence,
  sessionId: string,
  signal: AbortSignal,
  log: CollectorLog,
): Promise<string> {
  try {
    const handle = await persistence.open(sessionId, 'read', { signal })
    try {
      // 成本假设：handle.read() 为缝当前唯一形态（一次性全量载入事件流；
      // 类型面 read(offset?, length?) 的偏移语义未钉死、返回仍是全量
      // events 数组，故不走分页）。长会话事件流可达数 MB，串行读取
      // maxCandidates 个候选的瞬时内存峰值与耗时在此接受。
      const { events } = await handle.read()
      const text = extractFirstUserText(events)
      return byteTruncate(text, EXCERPT_MAX_BYTES)
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (signal.aborted) return ''
    log.warn(`session-advanced-search: 会话 ${sessionId} 首条用户消息读取失败（跳过节选）：${errorMessage(error)}`)
    return ''
  }
}

/** 扫描事件流取首条 user/message 的 text 块拼接（防御未知形状）。 */
export function extractFirstUserText(events: readonly { readonly type: string; readonly [key: string]: unknown }[]): string {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const content = event.content
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

/** 错误摘要。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
