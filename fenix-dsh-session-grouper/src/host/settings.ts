/**
 * loader config 解析归一。
 *
 * 装载期显式抛错纪律（spec 配置项 Requirement）：**出现即校验**——配置键存在
 * 但类型非法时装载失败（loader 日志可见），MUST NOT 静默取缺省；键缺失才落
 * 缺省值。缺省配置安全可用（本机两项目根是真实需求，非保守占位）。
 */

/** 插件配置（loader 传入形态：全部键可选，值待校验）。 */
export interface GrouperConfigInput {
  readonly projects?: unknown
  readonly quietMinutes?: unknown
  readonly intervalMinutes?: unknown
  readonly enabled?: unknown
}

/** 归一后的插件配置。 */
export interface GrouperSettings {
  /** 项目根绝对路径数组（`projects=[]` 合法：零迁移、零注册）。 */
  readonly projects: readonly string[]
  /** 静默期毫秒（quietMinutes * 60_000）。 */
  readonly quietMs: number
  /** 扫描周期毫秒（intervalMinutes * 60_000）。 */
  readonly intervalMs: number
  /** 总开关。 */
  readonly enabled: boolean
}

export const DEFAULT_PROJECTS: readonly string[] = ['/root/fenixd', '/root/dsh-plugins']
export const DEFAULT_QUIET_MINUTES = 30
export const DEFAULT_INTERVAL_MINUTES = 10
export const DEFAULT_ENABLED = true

/**
 * 解析并归一 loader config。
 * @throws 配置键存在但非法时抛 `Error`（装载期显式失败，不静默取缺省）。
 */
export function resolveSettings(raw: GrouperConfigInput | null | undefined): GrouperSettings {
  const projects = raw?.projects === undefined ? DEFAULT_PROJECTS : parseProjects(raw.projects)
  return {
    projects,
    quietMs: raw?.quietMinutes === undefined ? DEFAULT_QUIET_MINUTES * 60_000 : parsePositiveInt(raw.quietMinutes, 'quietMinutes') * 60_000,
    intervalMs: raw?.intervalMinutes === undefined ? DEFAULT_INTERVAL_MINUTES * 60_000 : parsePositiveInt(raw.intervalMinutes, 'intervalMinutes') * 60_000,
    enabled: raw?.enabled === undefined ? DEFAULT_ENABLED : parseBoolean(raw.enabled, 'enabled'),
  }
}

/** projects：字符串数组；每项非空且以 `/` 起始（绝对路径，但不允许根路径 `/` 本身）；`[]` 合法（零动作）。 */
function parseProjects(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`fenix-dsh-session-grouper: config.projects 必须为字符串数组，实得 ${describe(value)}`)
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new TypeError(`fenix-dsh-session-grouper: config.projects 含非法项（须非空字符串），实得 ${describe(item)}`)
    }
    if (!item.startsWith('/')) {
      throw new TypeError(`fenix-dsh-session-grouper: config.projects 项必须为绝对路径，实得 '${item}'`)
    }
    // 根路径 `/`（剥尾斜杠后为空）不被 rules 层归属判定支持——stripTrailingSlash
    // 的前提即调用方不传根分隔符，`/` 作根会使所有子路径会话静默 out-of-scope，
    // 故配置面在此显式拒绝（出现即校验，不留合法却零迁移的静默失效）。
    if (/^\/+$/.test(item)) {
      throw new TypeError(`fenix-dsh-session-grouper: config.projects 项不允许根路径 '/'（无子路径可归属），实得 '${item}'`)
    }
  }
  // 重复根去重保序（幂等注册本可容忍重复，配置面收敛更干净）。
  return [...new Set(value as string[])]
}

function parsePositiveInt(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`fenix-dsh-session-grouper: config.${key} 必须为正整数（分钟），实得 ${describe(value)}`)
  }
  return value
}

function parseBoolean(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`fenix-dsh-session-grouper: config.${key} 必须为布尔值，实得 ${describe(value)}`)
  }
  return value
}

function describe(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return `${typeof value}`
}
