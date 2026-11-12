/**
 * fenix-dsh-session-advanced-search 双半协议（shared 契约面）。
 *
 * client 半（弹窗）与 host 半（路由）经同源 HTTP API 通信（design D2）：
 *   POST /api/session-advanced-search/jobs        发起分析任务 → {jobId}
 *   GET  /api/session-advanced-search/jobs/:id    轮询 phase/results/degraded
 *   DELETE /api/session-advanced-search/jobs/:id  取消在途任务
 *
 * 本模块同时承载两侧共用的运行时校验守卫：host 收 POST 载荷时按
 * parseSearchRequest 校验（空/非串 query 拒绝、时间范围合法性），client 半
 * 提交前同样跑一遍避免明显非法请求出门。类型面与校验面单一来源，双半
 * 漂移即测试红灯（tests/protocol.test.ts）。
 */

/** API 路径前缀（design D2：带插件命名空间避免与官方/其它插件路由冲突）。 */
export const API_PREFIX = '/api/session-advanced-search'

/** 发起分析任务端点。 */
export const JOBS_PATH = `${API_PREFIX}/jobs`

/** 任务阶段枚举（design D2）。collecting/filtering 为机械管线，analyzing 为 LLM 单调用。 */
export type SearchPhase = 'collecting' | 'filtering' | 'analyzing' | 'done' | 'error' | 'cancelled'

/** 全部合法阶段（守卫用）。 */
export const SEARCH_PHASES: readonly SearchPhase[] = ['collecting', 'filtering', 'analyzing', 'done', 'error', 'cancelled'] as const

/** 可选活动时间范围（epoch ms，闭开区间语义：start ≤ 活动时刻 < end）。 */
export interface SearchTimeRange {
  /** 起始（含）；epoch ms。 */
  readonly start: number
  /** 结束（不含）；epoch ms。 */
  readonly end: number
}

/** 发起分析任务的请求载荷。 */
export interface SearchRequest {
  /** 会话内容自然语言描述（必填非空；trim 后非空才合法）。 */
  readonly query: string
  /** 可选时间范围。 */
  readonly timeRange?: SearchTimeRange
}

/** 候选结果（弹窗结果列表行）。 */
export interface SearchCandidate {
  readonly sessionId: string
  /** 会话标题（无标题投影时回退占位文案由展示层决定，此字段可空串）。 */
  readonly title: string
  /** 所属工作区路径（header.cwd；未归组为空串）。 */
  readonly workspacePath: string
  /** 活动时间（epoch ms）。 */
  readonly activityTime: number
  /** 匹配理由（LLM 产出；降级时为机械命中摘要）。 */
  readonly reason: string
  /** 置信度 [0,1]（降级时为归一化机械分）。 */
  readonly confidence: number
  /** 降级标注：true = LLM 分析不可用，已按机械匹配排序。 */
  readonly degraded?: boolean
}

/** GET 任务轮询响应载荷。 */
export interface SearchJobStatus {
  readonly jobId: string
  readonly phase: SearchPhase
  /** 终态（done/error）时的结果；degraded=true 表示 LLM 排序回退为机械评分。 */
  readonly results?: readonly SearchCandidate[]
  readonly degraded?: boolean
  /** error/cancelled 时的简短中文原因（展示层直接呈现）。 */
  readonly message?: string
}

/** POST 建任务响应载荷。 */
export interface SearchJobCreated {
  readonly jobId: string
}

/** 提取请求文本块（未守卫输入）。 */
function trimQuery(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

/** 时间范围合法性：数字、有限、非负、start < end。 */
export function isValidTimeRange(value: unknown): value is SearchTimeRange {
  if (value === null || typeof value !== 'object') return false
  const { start, end } = value as Record<string, unknown>
  if (typeof start !== 'number' || typeof end !== 'number') return false
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  if (start < 0 || end < 0) return false
  return start < end
}

/**
 * 校验并规范化搜索请求载荷（POST body 解析产物）。
 * @returns 合法时规范化后的请求（query trim）；非法时 undefined。
 */
export function parseSearchRequest(value: unknown): SearchRequest | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const query = trimQuery((value as Record<string, unknown>).query)
  if (query === undefined || query.length === 0) return undefined
  const rawRange = (value as Record<string, unknown>).timeRange
  if (rawRange === undefined) return { query }
  if (!isValidTimeRange(rawRange)) return undefined
  return { query, timeRange: rawRange }
}

/** 阶段守卫。 */
export function isSearchPhase(value: unknown): value is SearchPhase {
  return typeof value === 'string' && (SEARCH_PHASES as readonly string[]).includes(value)
}

/**
 * 校验轮询响应载荷（client 半消费前的形状守卫）。
 * @returns 合法时原值；非法时 undefined。
 */
export function parseJobStatus(value: unknown): SearchJobStatus | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.jobId !== 'string' || record.jobId.length === 0) return undefined
  if (!isSearchPhase(record.phase)) return undefined
  if (record.results !== undefined && !Array.isArray(record.results)) return undefined
  if (record.results !== undefined && !(record.results as unknown[]).every(isSearchCandidate)) return undefined
  if (record.message !== undefined && typeof record.message !== 'string') return undefined
  return value as SearchJobStatus
}

/** 候选行守卫（形状 + confidence 域）。 */
export function isSearchCandidate(value: unknown): value is SearchCandidate {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) return false
  if (typeof record.title !== 'string') return false
  if (typeof record.workspacePath !== 'string') return false
  if (typeof record.activityTime !== 'number' || !Number.isFinite(record.activityTime)) return false
  if (typeof record.reason !== 'string') return false
  if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) return false
  if (record.confidence < 0 || record.confidence > 1) return false
  if (record.degraded !== undefined && typeof record.degraded !== 'boolean') return false
  return true
}

/** 客户端展示用的固定文案（双半共享，保持文案单一来源）。 */
export const UI_TEXT = {
  /** 注入按钮 hover 提示。 */
  buttonTitle: '高级搜索',
  /** 弹窗标题。 */
  dialogTitle: '高级搜索',
  /** 描述输入 placeholder。 */
  queryPlaceholder: '描述你想找的会话内容，例如「上周调试登录超时的会话」',
  /** 提交按钮。 */
  submit: '开始搜索',
  /** 进度阶段文案（phase → 文案）。 */
  phaseText: {
    collecting: '正在收集会话…',
    filtering: '正在预筛候选…',
    analyzing: 'agent 分析中…',
  } as Record<SearchPhase, string | undefined>,
  /** 降级标注。 */
  degradedBadge: 'LLM 分析不可用，已按机械匹配排序',
  /** 空态文案。 */
  empty: '未找到匹配的会话',
  /** 任务失败文案前缀（message 拼接在其后）。 */
  failed: '搜索失败',
  /** 已取消文案。 */
  cancelled: '已取消',
} as const
