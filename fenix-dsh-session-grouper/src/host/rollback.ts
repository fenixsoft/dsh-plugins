/**
 * 回滚层：按台账恢复迁移前状态。
 *
 * 单会话回滚（spec 回滚复现 Scenario）：前置——最新台账行须为 migrated/pending-attach
 * （与 rollbackableSessionIds 同口径；已在案 rolled-back 幂等跳过）。
 *   - fromCwd 与 toCwd 同位（逐字相同，或尾随斜杠/符号链接归一后同位）的条目零文件
 *     操作：仅注册表索引撤销 + 台账标记（迁移本就零重写零归位，防陈旧备份覆盖现位
 *     产物）；
 *   - 其余：先按封存清单核验备份完整性（不可信即拒绝还原，保留现场）；目标会话
 *     目录（mangled(toCwd)）rename 挪入 trash 残目录（迁移后目标位可能已被继续追加
 *     事件，递归删除会静默吞掉增量）：还原后以台账迁移时刻判定，trash 内存在更晚
 *     写入则保留并在结果中给出路径供人工核对找回，无更晚写入才清退；还原时挪入
 *     trash 的原位残迹（迁移后原位亦可能被继续追加或重建）同口径判定；备份产物（`<DSH_HOME>/session-grouper-backups/<id>/`，
 *     即迁移前原目录的全量副本，header.cwd 仍为原值）经 staging 中转 + rename 原子
 *     还原回 `mangled(fromCwd)` 会话目录；
 *   - 注册表实例索引撤销（headers/sessionPaths 删除该 id → readSessionHeader
 *     走 persistence 全量重索引读回旧 header，归属状态复现「未分组」）；
 *   - 台账追加 rolled-back 行（幂等：同 id 后行覆盖前行）。
 * 全部回滚 = 逐条台账按序执行。
 *
 * 回滚只做文件层恢复与索引撤销，不解释会话产物内容（备份即原物，无需重写）。
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { targetSessionDirKey } from '../shared/rules.js'
import type { DshSessionPersistence, DshWorkspaceRegistry, SessionId } from '../types/seam.js'
import { appendLedger, backupDirFor, backupIntact, backupManifestPath, parseLedger, resolveDshHome, resolveRootFromLogPath, type MigrationLedgerEntry, type MigrateLogger } from './migrator.js'
import { errorMessage } from './sessionScan.js'

/** 单会话回滚结果。 */
export type RollbackOutcome =
  // trashDir/originalTrashDir：目标位/原位残迹 trash 中存在迁移后追加写入（或无法
  // 判定）时保守保留的残目录路径，交人工核对后清理。
  | { readonly status: 'rolled-back'; readonly sessionId: SessionId; readonly fromCwd: string; readonly trashDir?: string; readonly originalTrashDir?: string }
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
 * trash（或任意目录树）内是否存在晚于 sinceMs 写入的文件：用于判定迁移后目标位
 * 或原位是否又追加了事件。无法枚举/读取交由调用方按「保留现场」保守处理；符号
 * 链接条目（dirent isFile/isDirectory 均为 false）无法经 readdir 判定其目标的
 * 写入状态，同口径保守判有写入保留残迹（递归删除只删链接本身，链接会静默丢失）。
 */
function hasWritesAfter(dir: string, sinceMs: number): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (hasWritesAfter(full, sinceMs)) return true
    } else if (entry.isFile() && statSync(full).mtimeMs > sinceMs) return true
    else if (entry.isSymbolicLink()) return true
  }
  return false
}

/**
 * trash 残迹保守清退（目标位/原位同口径）：trash 内存在晚于台账迁移时刻（at）
 * 写入的文件即迁移后追加的事件/产物，递归删除会静默丢失——保留并返回路径，随
 * outcome 与日志交人工核对；无更晚写入才清退；时刻不可解析、判定或清退失败一律
 * 保守保留。返回 undefined 表示已清退。
 */
function retainOrDisposeTrash(trashDir: string, migratedAtRaw: string, where: '目标位' | '原位', sessionId: SessionId, log: MigrateLogger): string | undefined {
  const migratedAt = Date.parse(migratedAtRaw)
  try {
    if (Number.isNaN(migratedAt)) {
      log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 台账迁移时刻不可解析（'${String(migratedAtRaw)}'），无法判定${where}是否有迁移后追加的写入，trash 残迹保留于 ${trashDir}，请人工核对后清理`)
      return trashDir
    }
    if (hasWritesAfter(trashDir, migratedAt)) {
      log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚后${where}存在迁移后追加的写入，trash 残迹保留于 ${trashDir}，请人工核对后清理`)
      return trashDir
    }
    rmSync(trashDir, { recursive: true, force: true })
  } catch (error) {
    log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚后无法判定/清退${where} trash 残迹，保留于 ${trashDir} 待人工核对：${errorMessage(error)}`)
    return trashDir
  }
  return undefined
}

/**
 * 备份还原（原子口径）：备份 rename 入 staging 中转 → 原目录残迹 rename 挪入
 * trash（原子搬移代替递归删除）→ staging rename 就位。会话目录缺席窗口 = 残迹
 * 挪入 trash 到 staging 就位之间（≤ 一次 rename；残迹清退只发生在就位之后、由
 * 调用方判定，不再拉长窗口）：窗口内进程被杀时会话目录暂缺，但数据完整滞留于
 * staging 残目录（`${originalDir}.rollback-<时间戳>`），人工挪回即恢复——
 * 不存在半还原态。失败以抛错注明备份当下真实滞留位置（首段 rename 失败 = 备
 * 份仍完整滞留于主备份区原位、未做还原，原目标位内容已在 targetTrashDir 中，
 * 路径随错误一并呈现；挪出之后的失败 = 滞留于 staging，原位残迹已挪入 trash
 * 时一并呈现其路径），供外层 failed detail 呈现人工恢复路径。就位成功后同步
 * 清退备份同级完整性清单文件（残留会在下轮被误当在册核验基准），清理失败仅
 * 告警不影响还原结果。
 *
 * 返回原位残迹滞留的 trash 路径（原位无残迹则 undefined）；不在本函数内就地
 * 清退——残迹中可能含迁移后追加到原位的写入（pending-attach 窗口内应用仍向
 * 旧路径追加、上次中断回滚的残留、人工放置的产物），递归删除会静默吞掉这部分
 * 增量，与目标位残迹同口径交调用方以台账迁移时刻判定清退或保留。
 */
function restoreFromBackup(backupDir: string, originalDir: string, log?: MigrateLogger, targetTrashDir?: string): string | undefined {
  const stagingDir = `${originalDir}.rollback-${Date.now().toString(36)}`
  const trashDir = `${originalDir}.trash-${Date.now().toString(36)}`
  mkdirSync(dirname(originalDir), { recursive: true })
  try {
    renameSync(backupDir, stagingDir)
  } catch (error) {
    // 首段搬移失败（典型如备份区与会话 root 异文件系统触发 EXDEV、权限异常）：
    // 备份原封未动；原目录未触碰，但 step 2 可能已把目标位目录挪入
    // targetTrashDir——须注明该真实位置供外层 failed detail 指导人工找回。
    throw new Error(`备份还原失败（首段搬移），备份仍完整滞留于 ${backupDir}，未做任何还原${targetTrashDir === undefined ? '' : `（原目标位内容已在 ${targetTrashDir}，可人工找回）`}：${errorMessage(error)}`)
  }
  let remnantTrashDir: string | undefined
  try {
    if (existsSync(originalDir)) {
      renameSync(originalDir, trashDir)
      remnantTrashDir = trashDir
    }
    renameSync(stagingDir, originalDir)
  } catch (error) {
    throw new Error(`备份还原中断，备份滞留于 ${stagingDir}（主备份区已空；人工恢复请将其挪回 ${originalDir}${remnantTrashDir === undefined ? '' : `；原位残迹滞留于 ${trashDir}，请人工核对后处置`}）：${errorMessage(error)}`)
  }
  // 备份已就位：清退完整性清单文件（残留会在下轮被误当在册核验基准，与
  // rollbackPartialMigration 的清理口径一致）；失败仅告警，不影响还原结果。
  try {
    rmSync(backupManifestPath(backupDir), { force: true })
  } catch (error) {
    log?.warn(`fenix-dsh-session-grouper: 备份完整性清单清理失败（${backupManifestPath(backupDir)} 残留会误导下轮核验，请人工删除）：${errorMessage(error)}`)
  }
  // 原位残迹不在就位后就地清退：与目标位残迹同口径，返回路径交调用方以台账迁移
  // 时刻判定清退或保留（判定/清退失败一律保守保留，路径随 outcome 与日志交人工
  // 核对）；原位本无残迹则无需处置。
  return remnantTrashDir
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
  // 前置校验：仅 migrated/pending-attach 可回滚（与 rollbackableSessionIds 同口径，
  // 严格 string === 而非 String 宽化——String 形态异常值（如 ["migrated"]）宽化后
  // 恰等于白名单字面量，会放行 parseLedger 已告警不可回滚的行；parseLedger 保留
  // sessionId 形态合法但 status 未知的行，此分支对台账手工编辑/未来新增状态真实
  // 可达，一律拒绝而非照常删除还原）。
  if (latest.status !== 'migrated' && latest.status !== 'pending-attach') {
    return {
      status: 'skipped',
      sessionId,
      detail:
        latest.status === 'rolled-back'
          ? '台账最新状态已是 rolled-back（幂等跳过）'
          : `台账最新状态为 '${String(latest.status)}'，仅 migrated/pending-attach 可回滚（与 rollbackableSessionIds 同口径）`,
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
    //    通常已在目标位继续追加事件，rmSync 会静默吞掉这部分增量。是否真有增量在
    //    还原后以台账迁移时刻（at）判定（见步骤 3 后处理），trash 路径
    //    `${targetDir}.trash-<时间戳>` 供人工核对找回。
    let targetTrashDir: string | undefined
    if (targetDir !== originalDir && existsSync(targetDir)) {
      targetTrashDir = `${targetDir}.trash-${Date.now().toString(36)}`
      renameSync(targetDir, targetTrashDir)
    }
    // 3) 备份还原到原目录（备份即原物，含原 header cwd；staging 中转 + rename 原子就位）。
    //    首段搬移失败时 targetTrashDir 随错误文案呈现，避免目标位内容去向不明。
    const restoreTrashDir = restoreFromBackup(backupDir, originalDir, log, targetTrashDir)
    //    还原已成事实后处理 trash 残迹（目标位 + 原位同口径）：trash 内存在晚于
    //    迁移时刻（台账 at）写入的文件即迁移后追加的事件/产物，递归删除会静默
    //    丢失——保留并在 outcome/日志中给出路径交由人工核对；无更晚写入才清退；
    //    判定或清退失败一律保守保留。
    const retainedTrashDir = targetTrashDir === undefined ? undefined : retainOrDisposeTrash(targetTrashDir, latest.at, '目标位', sessionId, log)
    const retainedOriginalTrashDir = restoreTrashDir === undefined ? undefined : retainOrDisposeTrash(restoreTrashDir, latest.at, '原位', sessionId, log)
    //    目标 project 目录清空则一并移除（避免 mangled 目录残留噪音）。用非递归
    //    rmdirSync 原子判定空目录：非空抛 ENOTEMPTY 由本 catch 忽略，消除「先判定
    //    为空、再递归删除」两步之间新写入的会话目录被一并删除的 TOCTOU。
    if (targetDir !== originalDir) {
      try {
        rmdirSync(dirname(targetDir))
      } catch {
        // 目录非空（含保留的 trash 或新写入会话）或已不存在：保留。
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
    return {
      status: 'rolled-back',
      sessionId,
      fromCwd: latest.fromCwd,
      ...(retainedTrashDir === undefined ? {} : { trashDir: retainedTrashDir }),
      ...(retainedOriginalTrashDir === undefined ? {} : { originalTrashDir: retainedOriginalTrashDir }),
    }
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
    if (arg === '--all') {
      // 互斥模式：--all 与 --session 同时出现时直接报用法错误，绝不按出现顺序
      // 静默择一（否则 `--session <id> --all` 会误执行破坏性的全部回滚）。
      if (mode === 'single') throw new Error(`--all 与 --session 不能同时使用；${CLI_USAGE}`)
      mode = 'all'
    } else if (arg === '--session') {
      if (mode === 'all') throw new Error(`--all 与 --session 不能同时使用；${CLI_USAGE}`)
      sessionId = requireFlagValue(argv, ++i, '--session')
      mode = 'single'
    } else if (arg === '--dsh-home') dshHome = requireFlagValue(argv, ++i, '--dsh-home')
    else if (arg === '--root') requireFlagValue(argv, ++i, '--root')
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
