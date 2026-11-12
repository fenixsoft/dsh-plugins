/**
 * host 半 LLM 语义分析器（design D3：单调用排序）。
 *
 * - 候选集摘要（标题/活动时间/工作区/首条用户消息节选）打包进一个 prompt，
 *   一次 `ctx.llm.stream` 调用返回 JSON 排名（id+reason+confidence）。
 *   成本 O(1) 次调用；`topN` 截取。
 * - 降级矩阵（spec「LLM 失败回退」）：LLM 服务缺失 / 调用超时（llmTimeoutMs）/
 *   调用失败 / 输出解析失败（含零有效行）→ 机械评分排序回退 + `degraded=true`，
 *   且按原因分类记录 warn 级日志（服务缺失/超时/解析失败/调用失败）。
 * - LLM 路由取 profile 既有默认（`ctx.agentDefaultModel.currentSelection()`），
 *   不自带 provider 配置（session-titles 同模式）。
 */
import type { DshAgentDefaultModel, DshLlmRuntime } from '../types/dsh-runtime.js'
import type { SearchCandidate } from '../shared/protocol.js'
import type { PrefilteredSession } from './collector.js'

/** 分析器日志门面。 */
export interface AnalyzerLog {
  warn(message: string): void
  debug(message: string): void
}

/** 分析器依赖缝（测试注入 stub LLM；host 装配传 ctx 缝）。 */
export interface AnalyzerDeps {
  readonly llm?: DshLlmRuntime | undefined
  readonly agentDefaultModel?: DshAgentDefaultModel | undefined
  readonly log: AnalyzerLog
  /** LLM 单调用端到端超时毫秒（design D7 llmTimeoutMs）。 */
  readonly timeoutMs: number
  /** 返回 Top-N（design D7 topN）。 */
  readonly topN: number
}

/** 分析结果：结果行 + 降级标注（降级时附原因分类）。 */
export interface AnalysisOutcome {
  readonly results: readonly SearchCandidate[]
  readonly degraded: boolean
  /** 降级原因分类（degraded=true 时有值）：llm-missing/timeout/call-failed/parse-failed。 */
  readonly degradedReason?: 'llm-missing' | 'timeout' | 'call-failed' | 'parse-failed'
}

/** LLM 排名行（严格校验后的被消费面）。 */
interface LlmRankRow {
  readonly id: string
  readonly reason: string
  readonly confidence: number
}

/**
 * 对预筛候选做语义排序。
 * @param query - 用户自然语言描述。
 * @param candidates - collector 产出的候选（已按机械分排序）。
 * @param signal - 任务取消信号（与内部超时 deadline 合并）。
 */
export async function rankCandidates(
  deps: AnalyzerDeps,
  query: string,
  candidates: readonly PrefilteredSession[],
  signal: AbortSignal,
): Promise<AnalysisOutcome> {
  // 空候选：无 LLM 调用必要，直接空态（非降级——管线正常，只是没有匹配）。
  if (candidates.length === 0) return { results: [], degraded: false }

  // LLM 缺失（服务缝/默认路由缝任一不在位）：机械回退，分类『服务缺失』。
  const route = resolveRoute(deps)
  if (route === undefined || deps.llm === undefined || typeof deps.llm.stream !== 'function') {
    return mechanicalFallback(deps, candidates, 'llm-missing', 'LLM 服务缺失')
  }

  // 单调用：候选摘要打包 + 严格 JSON 输出契约。
  const system = [
    '你是编码助手会话检索的排序器。给定用户对想找会话的描述与一组候选会话摘要，',
    '按语义匹配度从高到低排序。',
    '只输出一个 JSON 对象，形如 {"results":[{"id":"<候选id>","reason":"<中文匹配理由>","confidence":<0到1小数>}]}，',
    '不要输出任何其它文本、Markdown 代码块或解释。全部候选都参与排序，置信度表示匹配把握。',
  ].join('')
  const user = buildUserPrompt(query, candidates)

  // 超时 deadline：内部 controller + 定时器；外部取消即刻转发。
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), Math.max(1, deps.timeoutMs))
  const onOuterAbort = () => deadline.abort()
  signal.addEventListener('abort', onOuterAbort, { once: true })
  let raw: string
  try {
    raw = await streamText(deps.llm, { provider: route.provider, model: route.model, system, user }, deadline.signal)
  } catch (error) {
    if (signal.aborted) {
      // 任务被取消（而非超时）：直接中断，机械回退无意义。
      return { results: [], degraded: false }
    }
    if (deadline.signal.aborted) {
      return mechanicalFallback(deps, candidates, 'timeout', `LLM 调用超时（${deps.timeoutMs}ms）`)
    }
    return mechanicalFallback(deps, candidates, 'call-failed', `LLM 调用失败：${errorMessage(error)}`)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onOuterAbort)
  }
  // 流正常闭合但 deadline 已到（生成器被 abort 静默终止）：按超时分类；
  // 外部任务取消优先（不降级、不产出——取消语义由任务层收尾）。
  if (signal.aborted) return { results: [], degraded: false }
  if (deadline.signal.aborted) {
    return mechanicalFallback(deps, candidates, 'timeout', `LLM 调用超时（${deps.timeoutMs}ms）`)
  }

  // 严格 JSON 解析 + id 白名单过滤 + topN 截取；失败回退分类『解析失败』。
  const rows = parseLlmRanking(raw, new Set(candidates.map((row) => row.sessionId)))
  if (rows.length === 0) {
    return mechanicalFallback(deps, candidates, 'parse-failed', 'LLM 输出解析失败（零有效排名行）')
  }
  const byId = new Map(candidates.map((row) => [row.sessionId, row]))
  const results = rows.slice(0, Math.max(1, deps.topN)).map((row) => toCandidate(byId.get(row.id) as PrefilteredSession, row.reason, row.confidence, false))
  deps.log.debug(`session-advanced-search: LLM 排序完成（${rows.length} 行，取 topN=${deps.topN}）`)
  return { results, degraded: false }
}

/** 机械评分排序回退：候选保持 collector 顺序（评分优先、同分最近活跃），topN 截取。 */
function mechanicalFallback(
  deps: AnalyzerDeps,
  candidates: readonly PrefilteredSession[],
  reason: AnalysisOutcome['degradedReason'],
  warnMessage: string,
): AnalysisOutcome {
  deps.log.warn(`session-advanced-search: ${warnMessage}，回退机械评分排序（degraded）`)
  const maxScore = Math.max(...candidates.map((row) => row.score), 0)
  const results = candidates.slice(0, Math.max(1, deps.topN)).map((row) =>
    toCandidate(
      row,
      row.score > 0 ? `机械匹配：标题/路径关键词命中（${row.score} 分）` : '机械匹配：按最近活跃排序',
      maxScore > 0 ? row.score / maxScore : 0,
      true,
    ),
  )
  return { results, degraded: true, degradedReason: reason }
}

/** 统一候选行构造（analyzer 内部 → 协议候选）。 */
function toCandidate(row: PrefilteredSession, reason: string, confidence: number, degraded: boolean): SearchCandidate {
  return {
    sessionId: row.sessionId,
    title: row.title,
    workspacePath: row.workspacePath,
    activityTime: row.activityTime,
    reason,
    confidence: Math.min(1, Math.max(0, confidence)),
    ...(degraded ? { degraded: true } : {}),
  }
}

/** 解析默认 LLM 路由；缝缺失（或 provider/model 空）返回 undefined。 */
function resolveRoute(deps: AnalyzerDeps): { provider: string; model: string } | undefined {
  const agentDefaultModel = deps.agentDefaultModel
  if (agentDefaultModel === undefined || typeof agentDefaultModel.currentSelection !== 'function') return undefined
  try {
    const selection = agentDefaultModel.currentSelection()
    if (typeof selection?.provider !== 'string' || selection.provider.length === 0) return undefined
    if (typeof selection?.model !== 'string' || selection.model.length === 0) return undefined
    return { provider: selection.provider, model: selection.model }
  } catch {
    return undefined
  }
}

/** 流式调用并拼接 text-delta 文本。 */
async function streamText(
  llm: DshLlmRuntime,
  input: { provider: string; model: string; system: string; user: string },
  signal: AbortSignal,
): Promise<string> {
  let text = ''
  const stream = llm.stream({
    provider: input.provider,
    model: input.model,
    system: input.system,
    maxTokens: 2048,
    signal,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: input.user }],
      },
    ],
  })
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    if (signal.aborted) break
  }
  return text
}

/** 候选摘要 prompt（逐行 JSONL，截断超长节选防 prompt 失控）。 */
export function buildUserPrompt(query: string, candidates: readonly PrefilteredSession[]): string {
  const lines = candidates.map((row) =>
    JSON.stringify({
      id: row.sessionId,
      title: row.title || '（无标题）',
      activityTime: new Date(row.activityTime).toISOString(),
      workspace: row.workspacePath || '（未归组）',
      excerpt: row.excerpt,
    }),
  )
  return [
    `用户想找的会话描述：${query}`,
    '',
    '候选会话摘要（每行一个 JSON）：',
    ...lines,
  ].join('\n')
}

/**
 * 严格解析 LLM 输出为排名行：接受整体 JSON 或文本中的首个 JSON 对象；
 * id 必须命中候选白名单，reason 为字符串，confidence 为 [0,1] 数值；
 * 非法行丢弃，产出顺序即 LLM 排名顺序。
 */
export function parseLlmRanking(raw: string, knownIds: ReadonlySet<string>): readonly LlmRankRow[] {
  const parsed = tryParseJsonObject(raw)
  if (parsed === undefined) return []
  const list = parsed['results']
  if (!Array.isArray(list)) return []
  const rows: LlmRankRow[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = record['id']
    const reason = record['reason']
    const confidence = record['confidence']
    if (typeof id !== 'string' || !knownIds.has(id) || seen.has(id)) continue
    if (typeof reason !== 'string') continue
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue
    seen.add(id)
    rows.push({ id, reason, confidence })
  }
  return rows
}

/** 从原始输出提取首个 JSON 对象（容忍 Markdown 围栏/前后缀文本）。 */
function tryParseJsonObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim()
  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  return tryParse(trimmed.slice(start, end + 1))
}

/** JSON.parse 安全封装。 */
function tryParse(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    return undefined
  } catch {
    return undefined
  }
}

/** 错误摘要。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
