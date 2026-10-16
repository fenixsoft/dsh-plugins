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
import { envValue, resolveCandidateModel } from '../shared/mapping.js'
import type { ScanCandidate, ScanResponse, ScanSkippedRow } from '../shared/mapping.js'

/** 默认 cc-switch 数据库路径（可被 CC_IMPORT_CC_SWITCH_DB 覆盖，测试注入用）。 */
export function defaultDbPath(): string {
  return process.env['CC_IMPORT_CC_SWITCH_DB'] ?? join(homedir(), '.cc-switch', 'cc-switch.db')
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
 * 缺表/缺列（`db_schema`）一律给结构化错误。单行损坏不整体失败：缺 name 的行
 * 以 `bad_provider_row`、行内 `settings_config` 坏 JSON/非对象/缺 env 块以
 * `bad_settings_config` 逐行记入 `skippedRows` 并跳过，其余候选照常产出。
 */
export function scanCcSwitch(dbPath: string = defaultDbPath()): ScanResponse {
  if (!existsSync(dbPath)) {
    return { ok: false, code: 'db_missing', message: `cc-switch 数据库不存在：${dbPath}` }
  }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    // SQLite 延迟到首条语句才读文件头：非 SQLite 文件在这里以
    // 「file is not a database」暴露，归为 db_unreadable 而非 db_schema。
    db.prepare('PRAGMA schema_version').get()
  } catch (error) {
    db?.close()
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
    const skippedRows: ScanSkippedRow[] = []
    for (const row of rows) {
      if (typeof row.name !== 'string' || row.name.length === 0) {
        // 缺 name 的行走独立错误码 bad_provider_row（与 bad_settings_config 的
        // 「settings_config 坏 JSON」语义区分），单行降级为跳过。
        skippedRows.push({
          name: null,
          code: 'bad_provider_row',
          message: 'providers 表存在缺少 name 的 claude 行，已跳过（请在 cc-switch 中修复该行）',
        })
        continue
      }
      const parsed = parseEnvBlock(row.name, row.settings_config)
      if (!parsed.ok) {
        // 单行 settings_config 损坏只跳过该行并记明细，不阻塞其他候选的导入。
        skippedRows.push({ name: row.name, code: parsed.code, message: parsed.message })
        continue
      }
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
    return skippedRows.length > 0 ? { ok: true, candidates, skippedRows } : { ok: true, candidates }
  } finally {
    db.close()
  }
}

/** `readCcSwitchToken` 的结构化结果（code 面对齐 revealToken 的结构化错误）。 */
export type TokenLookup =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false
      readonly code: 'db_missing' | 'db_unreadable' | 'candidate_missing' | 'missing_token' | 'token_unreadable'
      readonly message: string
    }

/**
 * 单次开库、按 name 定点读取某一 claude 行的 `ANTHROPIC_AUTH_TOKEN` 明文，
 * 并就地完成 hasToken 语义校验（`revealToken` 因此不依赖 `scanCcSwitch` 的
 * 整体成败，一次开库完成校验与读取）。
 * 行缺失（`candidate_missing`）、token 未配置（`missing_token`）、行配置损坏
 * 或并发修改（`token_unreadable`）、整库不可读（`db_missing` / `db_unreadable`）
 * 都结构化返回，不抛未捕获异常。
 */
export function readCcSwitchToken(dbPath: string, providerName: string): TokenLookup {
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
    const row = db
      .prepare("SELECT settings_config FROM providers WHERE app_type = 'claude' AND name = ?")
      .get(providerName) as { readonly settings_config?: unknown } | undefined
    if (row === undefined) {
      return { ok: false, code: 'candidate_missing', message: `cc-switch 中不存在名为 "${providerName}" 的 claude 候选` }
    }
    const parsed = parseEnvBlock(providerName, row.settings_config)
    if (!parsed.ok) {
      return { ok: false, code: 'token_unreadable', message: `候选 "${providerName}" 的 AUTH_TOKEN 在导入时已不可读` }
    }
    const token = envValue(parsed.env, 'ANTHROPIC_AUTH_TOKEN')
    if (token === null) {
      return { ok: false, code: 'missing_token', message: `候选 "${providerName}" 未配置 ANTHROPIC_AUTH_TOKEN，无法导入` }
    }
    return { ok: true, token }
  } catch {
    return { ok: false, code: 'token_unreadable', message: `候选 "${providerName}" 的 AUTH_TOKEN 在导入时已不可读` }
  } finally {
    db.close()
  }
}

/** `settings_config` JSON → env 记录；坏 JSON / 非对象 / env 块缺失都以
 * `bad_settings_config` 结构化返回，由调用方按单行跳过记入 skippedRows。 */
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
