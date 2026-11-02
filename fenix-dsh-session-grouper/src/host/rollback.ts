/**
 * 回滚层：按台账恢复迁移前状态。
 *
 * 单会话回滚（spec 回滚复现 Scenario）：
 *   - 目标会话目录（mangled(toCwd)）删除；
 *   - 备份产物（`<DSH_HOME>/session-grouper-backups/<id>/`，即迁移前原目录的
 *     全量副本，header.cwd 仍为原值）还原回 `mangled(fromCwd)` 会话目录；
 *   - 注册表实例索引撤销（headers/sessionPaths 删除该 id → readSessionHeader
 *     走 persistence 全量重索引读回旧 header，归属状态复现「未分组」）；
 *   - 台账追加 rolled-back 行（幂等：同 id 后行覆盖前行）。
 * 全部回滚 = 逐条台账按序执行；已在案 rolled-back 的跳过（幂等重入）。
 *
 * 回滚只做文件层恢复与索引撤销，不解释会话产物内容（备份即原物，无需重写）。
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { targetSessionDirKey } from '../shared/rules.js'
import type { DshSessionPersistence, DshWorkspaceRegistry, SessionId } from '../types/seam.js'
import { backupDirFor, parseLedger, appendLedger, type MigrationLedgerEntry, type MigrateLogger } from './migrator.js'
import { errorMessage } from './sessionScan.js'

/** 单会话回滚结果。 */
export type RollbackOutcome =
  | { readonly status: 'rolled-back'; readonly sessionId: SessionId; readonly fromCwd: string }
  | { readonly status: 'skipped'; readonly sessionId: SessionId; readonly detail: string }
  | { readonly status: 'failed'; readonly sessionId: SessionId; readonly detail: string }

/** 定位持久化 root：经任一现存会话产物路径回推 `<root>/<projectKey>/...`。 */
async function resolvePersistenceRoot(persistence: DshSessionPersistence): Promise<string | undefined> {
  try {
    const snapshots = await persistence.list()
    for (const snapshot of snapshots) {
      const path = await persistence.resolveCurrentLog?.(snapshot.header.id)
      if (path !== undefined) return dirname3(path)
    }
  } catch {
    // list 失败交由调用方按 failed 上报。
  }
  return undefined
}

function dirname3(path: string): string {
  const parts = path.split('/')
  // <root>/<projectKey>/<sessionDir>/<file> → 去 file/sessionDir/projectKey 三段。
  return parts.slice(0, -3).join('/') || '/'
}

/** 回滚单个会话（最新台账行须为 migrated/pending-attach；rolled-back 幂等跳过）。 */
export async function rollbackSession(
  persistence: DshSessionPersistence,
  registry: DshWorkspaceRegistry | undefined,
  dshHome: string,
  log: MigrateLogger,
  sessionId: SessionId,
  rootHint?: string,
): Promise<RollbackOutcome> {
  const entries = parseLedger(dshHome).filter((entry) => entry.sessionId === sessionId)
  const latest = entries.at(-1)
  if (latest === undefined) {
    return { status: 'skipped', sessionId, detail: '台账中无该会话的迁移记录' }
  }
  if (latest.status === 'rolled-back') {
    return { status: 'skipped', sessionId, detail: '台账最新状态已是 rolled-back（幂等跳过）' }
  }
  const root = rootHint ?? (await resolvePersistenceRoot(persistence))
  if (root === undefined) {
    return { status: 'failed', sessionId, detail: '无法定位持久化 root（无现存会话产物可回推）' }
  }
  const backupDir = backupDirFor(dshHome, sessionId)
  if (!existsSync(backupDir)) {
    return { status: 'failed', sessionId, detail: `备份目录缺失：${backupDir}` }
  }
  try {
    // 1) 目标目录清理（迁移落位的半/全产物）。
    const targetDir = join(root, targetSessionDirKey(latest.toCwd, sessionId))
    const originalDir = join(root, targetSessionDirKey(latest.fromCwd, sessionId))
    if (targetDir !== originalDir) rmSync(targetDir, { recursive: true, force: true })
    // 2) 备份还原到原目录（备份即原物，含原 header cwd）。
    rmSync(originalDir, { recursive: true, force: true })
    mkdirSync(originalDir, { recursive: true })
    cpSync(backupDir, originalDir, { recursive: true })
    // 3) 注册表实例索引撤销（下一轮 readSessionHeader 全量重索引读回旧 header）。
    if (registry !== undefined) {
      registry.headers?.delete(sessionId)
      registry.sessionPaths?.delete(sessionId)
      registry.invalidSessionPaths?.delete(sessionId)
    }
    // 4) 台账标记回滚。
    appendLedger(dshHome, { sessionId, fromCwd: latest.fromCwd, toCwd: latest.toCwd, at: new Date().toISOString(), status: 'rolled-back', backupDir })
    log.info?.(`fenix-dsh-session-grouper: 会话 ${sessionId} 已回滚：${latest.toCwd} → ${latest.fromCwd}（产物与 header 复现迁移前状态）`)
    return { status: 'rolled-back', sessionId, fromCwd: latest.fromCwd }
  } catch (error) {
    const detail = errorMessage(error)
    log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚失败：${detail}`)
    return { status: 'failed', sessionId, detail }
  }
}

/** 台账中可回滚（最新状态为 migrated/pending-attach）的会话 id，按台账顺序。 */
export function rollbackableSessionIds(dshHome: string): readonly SessionId[] {
  const latest = new Map<SessionId, MigrationLedgerEntry>()
  for (const entry of parseLedger(dshHome)) latest.set(entry.sessionId, entry)
  return [...latest.values()].filter((entry) => entry.status === 'migrated' || entry.status === 'pending-attach').map((entry) => entry.sessionId)
}

/** 全部回滚：逐条按台账顺序执行；返回逐会话结果。 */
export async function rollbackAll(
  persistence: DshSessionPersistence,
  registry: DshWorkspaceRegistry | undefined,
  dshHome: string,
  log: MigrateLogger,
): Promise<readonly RollbackOutcome[]> {
  const outcomes: RollbackOutcome[] = []
  for (const sessionId of rollbackableSessionIds(dshHome)) {
    outcomes.push(await rollbackSession(persistence, registry, dshHome, log, sessionId))
  }
  return outcomes
}

/** CLI 参数形态（node lib/host.js --session <id> | --all [--dsh-home <dir>]）。 */
export interface RollbackCliArgs {
  readonly mode: 'single' | 'all'
  readonly sessionId?: SessionId
  readonly dshHome?: string
}

/** 解析 CLI argv（宿主直接 `node lib/host.js ...`）。 */
export function parseRollbackArgs(argv: readonly string[]): RollbackCliArgs {
  let mode: 'single' | 'all' | undefined
  let sessionId: string | undefined
  let dshHome: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--all') mode = 'all'
    else if (arg === '--session') {
      sessionId = argv[++i]
      mode = 'single'
    } else if (arg === '--dsh-home') dshHome = argv[++i]
    else throw new Error(`未知参数 '${arg}'；用法：node lib/host.js --session <sessionId> | --all [--dsh-home <dir>]`)
  }
  if (mode === undefined) throw new Error('缺少 --session <sessionId> 或 --all；用法：node lib/host.js --session <sessionId> | --all [--dsh-home <dir>]')
  if (mode === 'single' && (sessionId === undefined || sessionId.length === 0)) throw new Error('--session 需要非空会话 id')
  return { mode, sessionId, dshHome }
}

/** CLI 主入口（回滚执行 + 结果输出；console 直出，退出码 0/1）。 */
export async function runRollbackCli(
  persistence: DshSessionPersistence,
  registry: DshWorkspaceRegistry | undefined,
  argv: readonly string[],
  stdout: (line: string) => void = (line) => console.log(line),
): Promise<number> {
  const args = parseRollbackArgs(argv)
  const dshHome = args.dshHome ?? (process.env.DSH_HOME ?? join(process.env['HOME'] ?? '', '.dsh'))
  const log: MigrateLogger = {
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  }
  const outcomes =
    args.mode === 'all'
      ? await rollbackAll(persistence, registry, dshHome, log)
      : [await rollbackSession(persistence, registry, dshHome, log, args.sessionId as SessionId)]
  for (const outcome of outcomes) {
    stdout(`${outcome.status}\t${outcome.sessionId}${outcome.status === 'skipped' || outcome.status === 'failed' ? `\t${outcome.detail}` : ''}`)
  }
  return outcomes.every((outcome) => outcome.status !== 'failed') ? 0 : 1
}

/** 备份目录存在性探针（CLI 前置校验/文档化用）。 */
export function backupExists(dshHome: string, sessionId: SessionId): boolean {
  try {
    return statSync(backupDirFor(dshHome, sessionId)).isDirectory()
  } catch {
    return false
  }
}

export const CLI_USAGE = '用法：node lib/host.js --session <sessionId> | --all [--dsh-home <dir>]'

export function cliBasenameHint(): string {
  return basename('lib/host.js')
}
