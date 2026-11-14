/**
 * 回滚层：按台账恢复迁移前状态。
 *
 * 单会话回滚（spec 回滚复现 Scenario）：前置——最新台账行须为 migrated/pending-attach
 * （与 rollbackableSessionIds 同口径；已在案 rolled-back 幂等跳过）。
 *   - fromCwd 与 toCwd 同位（逐字相同，或尾随斜杠/符号链接归一后同位）的条目零文件
 *     操作：仅注册表索引撤销 + 台账标记（迁移本就零重写零归位，防陈旧备份覆盖现位
 *     产物）；
 *   - 其余：先按封存清单核验备份完整性（不可信即拒绝还原，保留现场）；目标会话
 *     目录（mangled(toCwd)）rename 挪入 trash 残目录保留（迁移后目标位可能已被
 *     继续追加事件，递归删除会静默吞掉增量；无迁移时点 revision 可自动比对，残余
 *     风险由 trash 保留兜底 + 人工核对）；备份产物（`<DSH_HOME>/session-grouper-backups/<id>/`，
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
import { appendLedger, backupDirFor, backupIntact, backupManifestPath, parseLedger, resolveDshHome, resolveRootFromLogPath, type MigrationLedgerEntry, type MigrateLogger } from './migrator.js'
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
      if (path !== undefined) return resolveRootFromLogPath(path)
    }
  } catch {
    // list 失败交由调用方按 failed 上报。
  }
  return undefined
}

/**
 * 注册表实例索引撤销（headers/sessionPaths/invalidSessionPaths 删除该 id）。
 * 容错内聚在函数内部：索引形态异常（字段为无 delete 方法的非 Map 形态等）逐
 * 字段降级告警不外抛——同位短路分支零文件操作必然可成功收尾；备份还原分支
 * 备份已消费，更不容索引异常把回滚打成 failed。两处调用口径由此天然一致，
 * 不一致由下次全量重索引自愈。
 */
function undoRegistryIndex(registry: DshWorkspaceRegistry | undefined, sessionId: SessionId, log?: MigrateLogger): void {
  if (registry === undefined) return
  try {
    registry.headers?.delete(sessionId)
  } catch (error) {
    log?.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 注册表 headers 索引撤销失败（待下次全量重索引自愈）：${errorMessage(error)}`)
  }
  try {
    registry.sessionPaths?.delete(sessionId)
  } catch (error) {
    log?.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 注册表 sessionPaths 索引撤销失败（待下次全量重索引自愈）：${errorMessage(error)}`)
  }
  try {
    registry.invalidSessionPaths?.delete(sessionId)
  } catch (error) {
    log?.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 注册表 invalidSessionPaths 索引撤销失败（待下次全量重索引自愈）：${errorMessage(error)}`)
  }
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
 * 备份还原（原子口径）：备份 rename 入 staging 中转 → 原目录残迹 rename 挪入
 * trash（原子搬移代替递归删除）→ staging rename 就位 → 删 trash。会话目录缺席
 * 窗口 = 残迹挪入 trash 到 staging 就位之间（≤ 一次 rename；递归删除只发生在
 * 就位之后，不再拉长窗口）：窗口内进程被杀时会话目录暂缺，但数据完整滞留于
 * staging 残目录（`${originalDir}.rollback-<时间戳>`），人工挪回即恢复——
 * 不存在半还原态。备份挪出主备份区之后的失败以抛错注明滞留位置（staging），
 * 供外层 failed detail 呈现人工恢复路径。就位成功后同步清退备份同级完整性
 * 清单文件（残留会在下轮被误当在册核验基准），清理失败仅告警不影响还原结果。
 */
function restoreFromBackup(backupDir: string, originalDir: string, log?: MigrateLogger): void {
  const stagingDir = `${originalDir}.rollback-${Date.now().toString(36)}`
  const trashDir = `${originalDir}.trash-${Date.now().toString(36)}`
  mkdirSync(dirname(originalDir), { recursive: true })
  renameSync(backupDir, stagingDir)
  try {
    if (existsSync(originalDir)) renameSync(originalDir, trashDir)
    renameSync(stagingDir, originalDir)
  } catch (error) {
    throw new Error(`备份还原中断，备份滞留于 ${stagingDir}（主备份区已空；人工恢复请将其挪回 ${originalDir}）：${errorMessage(error)}`)
  }
  // 备份已就位：清退完整性清单文件（残留会在下轮被误当在册核验基准，与
  // rollbackPartialMigration 的清理口径一致）；失败仅告警，不影响还原结果。
  try {
    rmSync(backupManifestPath(backupDir), { force: true })
  } catch (error) {
    log?.warn(`fenix-dsh-session-grouper: 备份完整性清单清理失败（${backupManifestPath(backupDir)} 残留会误导下轮核验，请人工删除）：${errorMessage(error)}`)
  }
  // 就位已完成：trash 残迹清理失败不影响还原结果（残留仅是垃圾），忽略。
  try {
    rmSync(trashDir, { recursive: true, force: true })
  } catch {
    // 残迹留待人工清理。
  }
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
  // status 经 String 宽化比较——parseLedger 保留 sessionId 形态合法但 status 未知的
  // 行，此分支对台账手工编辑/未来新增状态真实可达，一律拒绝而非照常删除还原）。
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
      undoRegistryIndex(registry, sessionId, log)
      // 台账行不带 backupDir（与 migrator「不消费备份不写该字段」口径一致）：
      // 本分支零文件操作、未消费备份，写入的只能是既往周期遗留的陈旧备份目录，
      // 会误导排障者当作「本次回滚面对的迁移前状态」。
      appendLedger(dshHome, { sessionId, fromCwd: latest.fromCwd, toCwd: latest.toCwd, at: new Date().toISOString(), status: 'rolled-back' })
      log.info?.(`fenix-dsh-session-grouper: 会话 ${sessionId} 已回滚：${latest.toCwd} 与 ${latest.fromCwd} 同位（零文件操作，仅索引撤销与台账标记）`)
      return { status: 'rolled-back', sessionId, fromCwd: latest.fromCwd }
    }
    const root = rootHint ?? (await resolvePersistenceRoot(persistence))
    if (root === undefined) {
      return { status: 'failed', sessionId, detail: '无法定位持久化 root（无现存会话产物可回推）' }
    }
    const targetDir = join(root, targetSessionDirKey(latest.toCwd, sessionId))
    const originalDir = join(root, targetSessionDirKey(latest.fromCwd, sessionId))
    if (!existsSync(backupDir)) {
      return {
        status: 'failed',
        sessionId,
        detail: `备份目录缺失：${backupDir}（若上次回滚在还原中途失败，备份可能滞留于 ${originalDir}.rollback-<时间戳> 残目录或已实际还原至 ${originalDir}；人工核对后处理台账，勿盲目重试）`,
      }
    }
    // 1) 备份完整性核验（与 rollbackPartialMigration 同口径，且 MUST 先于任何对
    //    targetDir/originalDir 的删除或挪动）：清单缺失/损坏/内容不符 ⇒ 备份不可信，
    //    拒绝还原以保留现场，绝不以残缺副本覆盖现位产物。
    if (!backupIntact(backupDir)) {
      const detail = `备份完整性核验未通过（${backupDir}），拒绝还原以保留现场，请人工核查后处置`
      log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} ${detail}`)
      return { status: 'failed', sessionId, detail }
    }
    // 2) 目标目录清理（迁移落位的半/全产物）：rename 挪入 trash 残目录保留（与
    //    restoreFromBackup 对 originalDir 残迹同口径），不做递归删除——迁移后会话
    //    通常已在目标位继续追加事件，rmSync 会静默吞掉这部分增量。残余风险：台账
    //    未封存迁移时点的 revision/事件规模，现位产物是否已被改写无现成数据可自动
    //    比对拒绝；trash 保留把静默丢失变为可恢复，若有增量丢失请从 trash 残目录
    //    （`${targetDir}.trash-<时间戳>`）人工核对找回。
    let targetTrashDir: string | undefined
    if (targetDir !== originalDir && existsSync(targetDir)) {
      targetTrashDir = `${targetDir}.trash-${Date.now().toString(36)}`
      renameSync(targetDir, targetTrashDir)
    }
    // 3) 备份还原到原目录（备份即原物，含原 header cwd；staging 中转 + rename 原子就位）。
    restoreFromBackup(backupDir, originalDir, log)
    //    还原已成事实后清退目标位 trash 残迹（失败不影响回滚结果，留待人工）。
    if (targetTrashDir !== undefined) {
      try {
        rmSync(targetTrashDir, { recursive: true, force: true })
      } catch {
        // 残迹留待人工清理。
      }
    }
    //    目标 project 目录清空则一并移除（避免 mangled 目录残留噪音）。
    if (targetDir !== originalDir) {
      try {
        const targetProjectDir = dirname(targetDir)
        if (existsSync(targetProjectDir) && readdirSync(targetProjectDir).length === 0) rmSync(targetProjectDir, { recursive: true, force: true })
      } catch {
        // 目录已不存在/不可枚举：忽略。
      }
    }
    // 4) 注册表实例索引撤销（下一轮 readSessionHeader 全量重索引读回旧 header）。
    //    还原已成事实：撤销容错已内聚于 undoRegistryIndex（不外抛、逐字段降级
    //    告警）——否则备份已消费而台账无从标记，重试将永远卡在「备份目录缺失」；
    //    索引不一致由下次全量重索引自愈。
    undoRegistryIndex(registry, sessionId, log)
    // 5) 台账标记回滚（收尾最后一步）：落盘失败时磁盘已还原、备份已消费，detail
    //    注明实况，避免被 rollbackableSessionIds 误导为可原样重试。
    try {
      appendLedger(dshHome, { sessionId, fromCwd: latest.fromCwd, toCwd: latest.toCwd, at: new Date().toISOString(), status: 'rolled-back', backupDir })
    } catch (error) {
      throw new Error(`会话目录已还原至 ${originalDir}、备份已消费（不可原样重试），但台账 rolled-back 落盘失败：${errorMessage(error)}`)
    }
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

/** 取旗标值：值缺席（落在 argv 末尾）或形如另一旗标（'--' 开头）即用法错误——
 *  否则会把下一个旗标当值吞掉（如 `--session --all` 把 '--all' 当会话 id 送入
 *  回滚、`--dsh-home` 落在末尾时静默回退默认 home）。 */
function requireFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined || value.length === 0 || value.startsWith('--')) {
    throw new Error(`${flag} 需要非空值且不能以 '--' 开头；${CLI_USAGE}`)
  }
  return value
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
      sessionId = requireFlagValue(argv, ++i, '--session')
      mode = 'single'
    } else if (arg === '--dsh-home') dshHome = requireFlagValue(argv, ++i, '--dsh-home')
    else if (arg === '--root') i++
    else throw new Error(`未知参数 '${arg}'；${CLI_USAGE}`)
  }
  if (mode === undefined) throw new Error(`缺少 --session <sessionId> 或 --all；${CLI_USAGE}`)
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
