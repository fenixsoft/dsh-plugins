/**
 * fenix-dsh-session-advanced-search loader 配置解析与校验（design D7）。
 *
 * 配置键：`enabled`(true) / `maxCandidates`(30) / `topN`(5) / `llmTimeoutMs`(120000) /
 * `analyzeRoute`(可选 {provider, model}，非空串；把语义分析路由指到有凭证的
 * provider，优先级高于 profile 默认路由——design D2)。
 * 非法值（类型不符或超出范围）装载期显式抛 TypeError（session-grouper 纪律）：
 * 宁可插件拒绝装载留下可定位的错误日志，不带病运行产出误导性结果。
 */

/** 语义分析路由覆盖（provider/model 均非空串；design D2 routeOverride）。 */
export interface AnalyzeRoute {
  readonly provider: string
  readonly model: string
}

/** 解析后的配置（内部视角：全部字段必填、已规范化）。 */
export interface AdvancedSearchSettings {
  readonly enabled: boolean
  /** 预筛候选集上限（≥1）。 */
  readonly maxCandidates: number
  /** LLM 排序返回 Top-N（≥1）。 */
  readonly topN: number
  /** LLM 单调用端到端超时毫秒（>0）。 */
  readonly llmTimeoutMs: number
  /** 可选语义分析路由覆盖（缺省 = 沿用 profile 默认路由 agent-default-model）。 */
  readonly analyzeRoute?: AnalyzeRoute
}

/** loader 传入的原始配置（字段可缺省、可非法；解析期逐一校验）。 */
export interface AdvancedSearchConfigInput {
  readonly enabled?: unknown
  readonly maxCandidates?: unknown
  readonly topN?: unknown
  readonly llmTimeoutMs?: unknown
  readonly analyzeRoute?: unknown
}

/**
 * 配置键默认值（design D7；package.json dsh.config 描述镜像同一来源）。
 * llmTimeoutMs=120_000：实机标定 bigmodel-cn/glm-5.3-flash 对 30 候选的
 * 真实排序耗时 60~70s（2026-11-13 /root/fenixd 1285 会话实测，成功任务
 * 68s 完成、非降级），60s 默认会把一半的成功分析掐成降级——取 2 倍余量。
 */
export const CONFIG_DEFAULTS = {
  enabled: true,
  maxCandidates: 30,
  topN: 5,
  llmTimeoutMs: 120_000,
} as const

/** 布尔校验：真布尔才放行（loader schemastery 已给真布尔，这里兜字符串化形态）。 */
function parseBoolean(key: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  throw new TypeError(`fenix-dsh-session-advanced-search: 配置 ${key} 须为 boolean，收到 ${describe(value)}`)
}

/** 正整数校验（maxCandidates/topN：≥1 的安全整数）。 */
function parsePositiveInt(key: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`fenix-dsh-session-advanced-search: 配置 ${key} 须为 ≥1 的整数，收到 ${describe(value)}`)
  }
  return value
}

/** 正数校验（llmTimeoutMs：>0 的有限数）。 */
function parsePositiveNumber(key: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`fenix-dsh-session-advanced-search: 配置 ${key} 须为 >0 的数字，收到 ${describe(value)}`)
  }
  return value
}

/**
 * analyzeRoute 校验：undefined 放行（可选键，缺省走 profile 默认路由）；
 * 对象形态且 provider/model 均为非空串才合法，否则装载期 TypeError。
 * 用途（design D2）：把语义分析路由指到有凭证的 provider（如 deepseek），
 * 优先级高于 profile 默认路由（agent-default-model）。
 */
function parseAnalyzeRoute(key: string, value: unknown): AnalyzeRoute | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`fenix-dsh-session-advanced-search: 配置 ${key} 须为 { provider, model } 对象，收到 ${describe(value)}`)
  }
  const record = value as Record<string, unknown>
  const provider = record['provider']
  const model = record['model']
  if (typeof provider !== 'string' || provider.trim().length === 0 || typeof model !== 'string' || model.trim().length === 0) {
    throw new TypeError(`fenix-dsh-session-advanced-search: 配置 ${key}.provider / ${key}.model 均须为非空字符串`)
  }
  return { provider, model }
}

/** 非法值简述（错误信息可定位）。 */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/**
 * 解析并校验 loader 配置；任一键非法即抛 TypeError（装载期显式失败）。
 * @param config - cordis loader 传入的配置对象（可 null/undefined = 全默认）。
 */
export function resolveSettings(config?: AdvancedSearchConfigInput | null): AdvancedSearchSettings {
  const analyzeRoute = parseAnalyzeRoute('analyzeRoute', config?.analyzeRoute)
  return {
    enabled: parseBoolean('enabled', config?.enabled, CONFIG_DEFAULTS.enabled),
    maxCandidates: parsePositiveInt('maxCandidates', config?.maxCandidates, CONFIG_DEFAULTS.maxCandidates),
    topN: parsePositiveInt('topN', config?.topN, CONFIG_DEFAULTS.topN),
    llmTimeoutMs: parsePositiveNumber('llmTimeoutMs', config?.llmTimeoutMs, CONFIG_DEFAULTS.llmTimeoutMs),
    ...(analyzeRoute !== undefined ? { analyzeRoute } : {}),
  }
}
