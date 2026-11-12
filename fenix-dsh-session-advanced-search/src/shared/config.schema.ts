/**
 * fenix-dsh-session-advanced-search loader 配置解析与校验（design D7）。
 *
 * 配置键：`enabled`(true) / `maxCandidates`(30) / `topN`(5) / `llmTimeoutMs`(60000)。
 * 非法值（类型不符或超出范围）装载期显式抛 TypeError（session-grouper 纪律）：
 * 宁可插件拒绝装载留下可定位的错误日志，不带病运行产出误导性结果。
 */

/** 解析后的配置（内部视角：全部字段必填、已规范化）。 */
export interface AdvancedSearchSettings {
  readonly enabled: boolean
  /** 预筛候选集上限（≥1）。 */
  readonly maxCandidates: number
  /** LLM 排序返回 Top-N（≥1）。 */
  readonly topN: number
  /** LLM 单调用端到端超时毫秒（>0）。 */
  readonly llmTimeoutMs: number
}

/** loader 传入的原始配置（字段可缺省、可非法；解析期逐一校验）。 */
export interface AdvancedSearchConfigInput {
  readonly enabled?: unknown
  readonly maxCandidates?: unknown
  readonly topN?: unknown
  readonly llmTimeoutMs?: unknown
}

/** 配置键默认值（design D7；package.json dsh.config 描述镜像同一来源）。 */
export const CONFIG_DEFAULTS = {
  enabled: true,
  maxCandidates: 30,
  topN: 5,
  llmTimeoutMs: 60_000,
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
  return {
    enabled: parseBoolean('enabled', config?.enabled, CONFIG_DEFAULTS.enabled),
    maxCandidates: parsePositiveInt('maxCandidates', config?.maxCandidates, CONFIG_DEFAULTS.maxCandidates),
    topN: parsePositiveInt('topN', config?.topN, CONFIG_DEFAULTS.topN),
    llmTimeoutMs: parsePositiveNumber('llmTimeoutMs', config?.llmTimeoutMs, CONFIG_DEFAULTS.llmTimeoutMs),
  }
}
