/**
 * 回滚层：按台账恢复迁移前状态。
 *
 * 单会话回滚（spec 回滚复现 Scenario）：前置——最新台账行须为 migrated/pending-attach
 * （与 rollbackableSessionIds 同口径；已在案 rolled-back 幂等跳过）。
 *   - fromCwd 与 toCwd 同位（逐字相同，或尾随斜杠/符号链接归一后同位）的条目零文件
 *     操作：仅注册表索引撤销 + 台账标记（迁移本就零重写零归位，防陈旧备份覆盖现位
 *     产物）；
 *   - 其余：目标会话目录（mangled(toCwd)）删除；备份产物（`<DSH_HOME>/session-grouper-backups/<id>/`，
 *     即迁移前原目录的全量副本，header.cwd 仍为原值）经 staging 中转 + rename 原子
 *     还原回 `mangled(fromCwd)` 会话目录；
 *   - 注册表实例索引撤销（headers/sessionPaths 删除该 id → readSessionHeader
 *     走 persistence 全量重索引读回旧 header，归属状态复现「未分组」）；
 *   - 台账追加 rolled-back 行（幂等：同 id 后行覆盖前行）。
 * 全部回滚 = 逐条台账按序执行。
 *
 * 回滚只做文件层恢复与索引撤销，不解释会话产物内容（备份即原物，无需重写）。
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { targetSessionDirKey } from '../shared/rules.js'
import type { DshSessionPersistence, DshWorkspaceRegistry, SessionId } from '../types/seam.js'
import { appendLedger, backupDirFor, parseLedger, resolveDshHome, type MigrationLedgerEntry, type MigrateLogger } from './migrator.js'
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

/** 注册表实例索引撤销（headers/sessionPaths/invalidSessionPaths 删除该 id）。 */
function undoRegistryIndex(registry: DshWorkspaceRegistry | undefined, sessionId: SessionId): void {
  if (registry === undefined) return
  registry.headers?.delete(sessionId)
  registry.sessionPaths?.delete(sessionId)
  registry.invalidSessionPaths?.delete(sessionId)
}

/** fromCwd 与 toCwd 是否同位：逐字相同，或尾随斜杠归一/realpath（符号链接）归一后同位。 */
async function sameLocation(a: string, b: string): Promise<boolean> {
  const normalize = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  if (normalize(a) === normalize(b)) return true
  try {
    return (await realpath(a)) === (await realpath(b))
  } catch {
    return false
  }
}

/**
 * 备份还原（原子口径，与 migrator.rollbackPartialMigration 同序）：挪走原目录残迹 →
 * 备份 rename 到 staging 中转 → rename 就位，任一时刻会话目录要么是完整迁移态、
 * 要么是完整回滚态，不留半还原。
 */
function restoreFromBackup(backupDir: string, originalDir: string): void {
  const stagingDir = `${originalDir}.rollback-${Date.now().toString(36)}`
  mkdirSync(dirname(originalDir), { recursive: true })
  rmSync(originalDir, { recursive: true, force: true })
  renameSync(backupDir, stagingDir)
  renameSync(stagingDir, originalDir)
}

/** 单会话回滚（最新台账行须为 migrated/pending-attach 否则 skipped，rolled-back 幂等跳过；fromCwd/toCwd 同位零文件操作）。 */
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
  // 前置校验：仅 migrated/pending-attach 可回滚（与 rollbackableSessionIds 同口径；
  // status 经 String 宽化比较，台账手工编辑/未来新增状态一律拒绝而非照常删除还原）。
  const latestStatus = String(latest.status)
  if (latestStatus !== 'migrated' && latestStatus !== 'pending-attach') {
    return {
      status: 'skipped',
      sessionId,
      detail:
        latestStatus === 'rolled-back'
          ? '台账最新状态已是 rolled-back（幂等跳过）'
          : `台账最新状态为 '${latestStatus}'，仅 migrated/pending-attach 可回滚（与 rollbackableSessionIds 同口径）`,
    }
  }
  const backupDir = backupDirFor(dshHome, sessionId)
  try {
    // 0) 同位短路：fromCwd 与 toCwd 同位（逐字相同，或尾随斜杠/符号链接归一后同位）
    //    的条目迁移时零重写、零归位，回滚同样跳过文件删除与备份还原（防陈旧备份
    //    覆盖现位产物），仅做注册表索引撤销与台账 rolled-back 标记。
    if (await sameLocation(latest.fromCwd, latest.toCwd)) {
      undoRegistryIndex(registry, sessionId)
      appendLedger(dshHome, { sessionId, fromCwd: latest.fromCwd, toCwd: latest.toCwd, at: new Date().toISOString(), status: 'rolled-back', backupDir })
      log.info?.(`fenix-dsh-session-grouper: 会话 ${sessionId} 已回滚：${latest.toCwd} 与 ${latest.fromCwd} 同位（零文件操作，仅索引撤销与台账标记）`)
      return { status: 'rolled-back', sessionId, fromCwd: latest.fromCwd }
    }
    const root = rootHint ?? (await resolvePersistenceRoot(persistence))
    if (root === undefined) {
      return { status: 'failed', sessionId, detail: '无法定位持久化 root（无现存会话产物可回推）' }
    }
    if (!existsSync(backupDir)) {
      return { status: 'failed', sessionId, detail: `备份目录缺失：${backupDir}` }
    }
    // 1) 目标目录清理（迁移落位的半/全产物）；目标 project 目录清空则一并移除。
    const targetDir = join(root, targetSessionDirKey(latest.toCwd, sessionId))
    const originalDir = join(root, targetSessionDirKey(latest.fromCwd, sessionId))
    if (targetDir !== originalDir) {
      rmSync(targetDir, { recursive: true, force: true })
      try {
        const targetProjectDir = dirname(targetDir)
        if (existsSync(targetProjectDir) && readdirSync(targetProjectDir).length === 0) rmSync(targetProjectDir, { recursive: true, force: true })
      } catch {
        // 目录已不存在/不可枚举：忽略。
      }
    }
    // 2) 备份还原到原目录（备份即原物，含原 header cwd；staging 中转 + rename 原子就位）。
    restoreFromBackup(backupDir, originalDir)
    // 3) 注册表实例索引撤销（下一轮 readSessionHeader 全量重索引读回旧 header）。
    undoRegistryIndex(registry, sessionId)
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

/** 解析 CLI argv（宿主直接 `node lib/host.js ...`；`--root` 由装配层消费，此处识别跳过）。 */
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
    else if (arg === '--root') i++
    else throw new Error(`未知参数 '${arg}'；${CLI_USAGE}`)
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
  const dshHome = args.dshHome ?? resolveDshHome()
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

export const CLI_USAGE = '用法：node lib/host.js --session <sessionId> | --all [--dsh-home <dir>]'
