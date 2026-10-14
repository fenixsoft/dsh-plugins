/**
 * cc-switch 只读扫描：从 `~/.cc-switch/cc-switch.db` 读 `providers` 表的
 * claude 形态行，解析 `settings_config` 的 env 块产出导入候选。
 *
 * 只读边界：SQLite 以 readOnly 打开；响应只报 `ANTHROPIC_AUTH_TOKEN` 的存在性
 * （`hasToken`），任何路径都不含 token 明文。异常一律结构化返回（code +
 * message），不抛未捕获异常。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveCandidateModel } from '../shared/mapping.js'
import type { ScanCandidate, ScanResponse } from '../shared/mapping.js'

/** 默认 cc-switch 数据库路径（可被 CC_IMPORT_CC_SWITCH_DB 覆盖，测试注入用）。 */
export function defaultDbPath(): string {
  return process.env['CC_IMPORT_CC_SWITCH_DB'] ?? join(homedir(), '.cc-switch', 'cc-switch.db')
}

/** env 块取值：非字符串或纯空白视为缺失。 */
function envValue(env: Readonly<Record<string, unknown>>, key: string): string | null {
  const raw = env[key]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** 错误消息归一：Error 用 message，其余 String 化。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ProviderRow {
  readonly name: unknown
  readonly settings_config: unknown
}

/**
 * 扫描 cc-switch.db 的 claude 形态 provider。
 * @param dbPath 数据库路径；缺省 `~/.cc-switch/cc-switch.db`。
 * @returns 成功给候选数组；db 缺失（`db_missing`）、无法打开（`db_unreadable`）、
 * 缺表/缺列（`db_schema`）、行内 `settings_config` 坏 JSON（`bad_settings_config`）
 * 一律给结构化错误。
 */
export function scanCcSwitch(dbPath: string = defaultDbPath()): ScanResponse {
  if (!existsSync(dbPath)) {
    return { ok: false, code: 'db_missing', message: `cc-switch 数据库不存在：${dbPath}` }
  }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch (error) {
    return { ok: false, code: 'db_unreadable', message: `cc-switch 数据库无法打开：${messageOf(error)}` }
  }
  try {
    let rows: ProviderRow[]
    try {
      const declared = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'providers'")
        .get()
      if (declared === undefined) {
        return { ok: false, code: 'db_schema', message: 'cc-switch 数据库缺少 providers 表' }
      }
      rows = db
        .prepare(
          "SELECT name, settings_config FROM providers WHERE app_type = 'claude' ORDER BY sort_index, created_at, name",
        )
        .all() as unknown as ProviderRow[]
    } catch (error) {
      // 缺列 / schema 变化：结构化报错而非崩溃（design.md Risks 条款）。
      return { ok: false, code: 'db_schema', message: `cc-switch providers 表不可读：${messageOf(error)}` }
    }
    const candidates: ScanCandidate[] = []
    for (const row of rows) {
      if (typeof row.name !== 'string' || row.name.length === 0) {
        return { ok: false, code: 'bad_settings_config', message: 'providers 表存在缺少 name 的 claude 行' }
      }
      const parsed = parseEnvBlock(row.name, row.settings_config)
      if (!parsed.ok) return parsed
      const env = parsed.env
      const baseURL = envValue(env, 'ANTHROPIC_BASE_URL')
      const hasToken = envValue(env, 'ANTHROPIC_AUTH_TOKEN') !== null
      const model = resolveCandidateModel(env)
      const skipReason =
        baseURL === null ? 'missing_base_url' : !hasToken ? 'missing_token' : model === null ? 'missing_model' : undefined
      candidates.push({
        name: row.name,
        baseURL,
        model,
        hasToken,
        importable: skipReason === undefined,
        ...(skipReason === undefined ? {} : { skipReason }),
      })
    }
    return { ok: true, candidates }
  } finally {
    db.close()
  }
}

/**
 * 定点读取某一 claude 行的 `ANTHROPIC_AUTH_TOKEN` 明文。
 * 仅供 `revealToken` 在 scan 确认 `hasToken` 后调用；行缺失或 token 缺失返回
 * null（并发修改窗口由调用侧按单项失败处理）。
 */
export function lookupCcSwitchToken(dbPath: string, providerName: string): string | null {
  if (!existsSync(dbPath)) return null
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return null
  }
  try {
    const row = db
      .prepare("SELECT settings_config FROM providers WHERE app_type = 'claude' AND name = ?")
      .get(providerName) as { readonly settings_config?: unknown } | undefined
    if (row === undefined || typeof row.settings_config !== 'string') return null
    const parsed: unknown = JSON.parse(row.settings_config)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const env = (parsed as { readonly env?: unknown }).env
    if (env === null || typeof env !== 'object' || Array.isArray(env)) return null
    const token = (env as Readonly<Record<string, unknown>>)['ANTHROPIC_AUTH_TOKEN']
    return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** `settings_config` JSON → env 记录；坏 JSON / 非对象 / env 块缺失都走结构化错误。 */
function parseEnvBlock(
  providerName: string,
  settingsConfig: unknown,
): { readonly ok: true; readonly env: Readonly<Record<string, unknown>> } | {
  readonly ok: false
  readonly code: 'bad_settings_config'
  readonly message: string
} {
  let parsed: unknown
  if (typeof settingsConfig === 'string') {
    try {
      parsed = JSON.parse(settingsConfig)
    } catch {
      return {
        ok: false,
        code: 'bad_settings_config',
        message: `provider "${providerName}" 的 settings_config 不是合法 JSON`,
      }
    }
  } else {
    parsed = settingsConfig
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'bad_settings_config',
      message: `provider "${providerName}" 的 settings_config 不是 JSON 对象`,
    }
  }
  const env = (parsed as { readonly env?: unknown }).env
  if (env === null || env === undefined) {
    return { ok: false, code: 'bad_settings_config', message: `provider "${providerName}" 的 settings_config 缺少 env 块` }
  }
  if (typeof env !== 'object' || Array.isArray(env)) {
    return {
      ok: false,
      code: 'bad_settings_config',
      message: `provider "${providerName}" 的 settings_config.env 不是 JSON 对象`,
    }
  }
  return { ok: true, env: env as Readonly<Record<string, unknown>> }
}
