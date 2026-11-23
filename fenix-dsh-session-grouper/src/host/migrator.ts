/**
 * 迁移执行层：按计划逐会话执行 cwd 重写迁移。
 *
 * 机制（探针实证于安装包 dsh-session-persistence-jsonl@0.2.0-rc.2，见
 * src/types/dsh-runtime.d.ts 探针结论）：
 *   1. `stat` 取修订快照 → `open(id,'write')`（进程内单写者声明 + 跨进程
 *      flock 写锁）→ 句柄读全量事件；
 *   2. 迁移前修订校验：`stat` 复核 revision，源在准备窗口内被改即拒绝本轮
 *      （写竞争中止场景，产物保持原状）；
 *   3. 备份先行：原会话目录全量复制到 `<DSH_HOME>/session-grouper-backups/<id>/`；
 *   4. 重写：`persistBatch(newHeader, events, false, inherited)` /
 *      `persistHeader`——以新 header 的 cwd 推导目标路径物化（包内代码处理
 *      zstd 帧），目标已有 generation 即拒绝（目标冲突检测，MUST NOT 覆盖）；
 *   5. 校验：目标产物路径（rules 复刻 mangle 推导 + 源文件名）经
 *      `readStoredLog` 回读，identity 校验通过方可进入删除步；
 *   6. `close` 写句柄（释放写锁）后删除旧会话目录（旧 project 目录若空一并
 *      清理）；顺序不可颠倒——同 id 双目录共存会让 findLog 抛 duplicate；
 *   7. 注册表实例状态校正（`headers`/`sessionPaths` 按新 header 更新；字段
 *      缺失/非 Map 形态 → 显式转台账 pending-attach 兜底）→ 官方
 *      `attachSession` 归组；
 *   8. `<DSH_HOME>/session-grouper/migrations.jsonl` 追加台账。
 *
 * 失败语义：数据级步骤（4/5/6 及之前）任一失败 → 回滚到原状态并告警，不留
 * 半迁移状态；attach 级失败 → 按设计 Decision 5(b) 记 pending-attach（下次
 * dsh-web 重启全量重索引后重试收敛），数据已一致不回滚。
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { targetSessionDirKey } from '../shared/rules.js'
import type { DshSessionEvent, DshSessionHeader, DshSessionPersistence, DshSessionSnapshot, DshWorkspace, DshWorkspaceRegistry, SessionId } from '../types/seam.js'
import { errorMessage } from './sessionScan.js'

/** 迁移器对日志的窄接口。 */
export interface MigrateLogger {
  warn(message: string): void
  error(message: string): void
  info?(message: string): void
}

/** 单会话迁移结果。 */
export type MigrateOutcome =
  | { readonly status: 'migrated'; readonly sessionId: SessionId; readonly fromCwd: string; readonly toCwd: string }
  | { readonly status: 'pending-attach'; readonly sessionId: SessionId; readonly fromCwd: string; readonly toCwd: string; readonly detail: string }
  | { readonly status: 'refused'; readonly sessionId: SessionId; readonly reason: 'revision-changed'; readonly detail: string }
  | { readonly status: 'failed'; readonly sessionId: SessionId; readonly detail: string }

/** 台账行（migrations.jsonl）。 */
export interface MigrationLedgerEntry {
  readonly sessionId: SessionId
  readonly fromCwd: string
  readonly toCwd: string
  /** ISO8601 时间戳。 */
  readonly at: string
  readonly status: 'migrated' | 'pending-attach' | 'rolled-back'
  readonly detail?: string
  /** 备份目录（迁移/回滚可回查）。 */
  readonly backupDir?: string
  /** 释放写锁前打点的时刻（epoch ms，仅重写路径）：回滚 trash 清退判定阈值——
   *  该时刻前 flock 持有中不存在任何应用侧写入，此后目标位/原位写入均属迁移后
   *  增量；台账 at 打点晚于锁释放与注册表校正/attach，以其为阈值会漏判释放与
   *  落盘之间窗口内追加的增量（详见 rollback.ts retainOrDisposeTrash）。 */
  readonly releaseAtMs?: number
}

/**
 * 迁移内回滚（rollbackPartialMigration）的处置口径：status 为处置结论（语义见
 * 该方法注释）；trashDir = 还原前挪入 trash 的原位残迹经判定含迁移后追加写入
 * （或无法判定/清退失败）而保守保留的残目录路径，随口径上交外层失败日志供人工
 * 核对（已清退则缺省）。
 */
type RollbackDisposition = {
  readonly status: 'rolled-back' | 'no-backup' | 'restore-refused' | 'restore-done-cleanup-failed'
  readonly trashDir?: string
}

/** `<DSH_HOME>` 解析：`DSH_HOME` 环境变量优先，缺省 `~/.dsh`（dsh-home-paths 同序）。 */
export function resolveDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 备份根目录：`<DSH_HOME>/session-grouper-backups/`。 */
export function backupsDir(dshHome: string): string {
  return join(dshHome, 'session-grouper-backups')
}

/** 台账文件：`<DSH_HOME>/session-grouper/migrations.jsonl`。 */
export function ledgerPath(dshHome: string): string {
  return join(dshHome, 'session-grouper', 'migrations.jsonl')
}

/** 备份目录：`<DSH_HOME>/session-grouper-backups/<sessionId>/`。 */
export function backupDirFor(dshHome: string, sessionId: SessionId): string {
  return join(backupsDir(dshHome), sessionId)
}

/** 由会话产物日志路径回推持久化 root：`<root>/<projectKey>/<sessionDir>/<file>` 取上三级。 */
export function resolveRootFromLogPath(path: string): string {
  return dirname(dirname(dirname(path)))
}

/** 台账行解析（单行损坏跳过不抛：JSON 语法损坏与非对象/关键字段形态异常行均按损坏行跳过）。 */
export function parseLedger(dshHome: string): readonly MigrationLedgerEntry[] {
  const path = ledgerPath(dshHome)
  if (!existsSync(path)) return []
  const entries: MigrationLedgerEntry[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // 单行损坏跳过，不影响其余行。
      continue
    }
    // 形态守卫：合法 JSON 但非对象（null/数字/数组等）或 sessionId 形态不符 ⇒
    // 按损坏行跳过并 warn 留痕。否则坏行会以断言形态混入结果污染下游 id 集
    // （如 readMigratedSessionIds 对 null 条目访问 status 抛 TypeError，幂等去重
    // 基准整体崩溃）；台账虽由本工具写入，部分写入/手工编辑/外部工具污染均可能
    // 产生合法 JSON 的坏行。
    const entry = parsed as Partial<MigrationLedgerEntry> | null
    if (entry === null || typeof entry !== 'object' || typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) {
      console.warn(`fenix-dsh-session-grouper: 台账存在形态异常行，已按损坏行跳过：${trimmed.slice(0, 200)}`)
      continue
    }
    // status 不在已知字面量内的行保留不丢弃：下游一律按字面量白名单消费——
    // readMigratedSessionIds 视为非在册（撤销幂等去重基准）、rollbackableSessionIds
    // 不列为可回滚、rollbackSession 前置拒绝——台账手工编辑/未来新增状态一律拒绝
    // 回滚而非照常还原。若按损坏行丢弃，latest 会退化为更早的合法行，回滚反而
    // 按陈旧 fromCwd/toCwd 执行。
    if (entry.status !== 'migrated' && entry.status !== 'pending-attach' && entry.status !== 'rolled-back') {
      console.warn(`fenix-dsh-session-grouper: 台账行 status '${String(entry.status)}' 非已知状态，按未知状态保留（不可回滚、不计入在册）：${trimmed.slice(0, 200)}`)
    }
    entries.push(entry as MigrationLedgerEntry)
  }
  return entries
}

/**
 * 读台账中「已迁移且未回滚」的会话 id 集（幂等去重基准；同 id 后行覆盖前行，
 * 回滚行撤销在案状态）。
 */
export function readMigratedSessionIds(dshHome: string): readonly SessionId[] {
  const ids = new Set<SessionId>()
  for (const entry of parseLedger(dshHome)) {
    if (entry.status === 'migrated' || entry.status === 'pending-attach') ids.add(entry.sessionId)
    else ids.delete(entry.sessionId)
  }
  return [...ids]
}

/** 台账追加（migrations.jsonl）。 */
export function appendLedger(dshHome: string, entry: MigrationLedgerEntry): void {
  const path = ledgerPath(dshHome)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8')
}

/** 备份完整性清单路径（与备份目录同级，永不进入会话目录）。 */
export function backupManifestPath(backupDir: string): string {
  return `${backupDir}.manifest.json`
}

/** 递归收集目录清单：相对路径 → 字节数。 */
// [fenix-ignore:ba49327123d8] 失效前提不成立：清单封存自 cpSync 复制后的 staging 产物本身（与核验两侧同用本函数一致跳过符号链接，且 cpSync 默认 dereference:false——实测 Node 24 链接含 dangling/目录链接均原样按链接复制，不解引用），备份不会比清单多出条目，backupIntact 不会恒 false，回滚不会失效
function collectManifest(root: string, dir: string = root, files: Record<string, number> = {}): Record<string, number> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectManifest(root, full, files)
    else if (entry.isFile()) files[relative(root, full)] = statSync(full).size
  }
  return files
}

/** 回滚前核验：备份内容与封存清单逐文件比对（文件数 + 字节数）；清单缺失/损坏/不符均视为不可信。 */
export function backupIntact(backupDir: string): boolean {
  if (!existsSync(backupManifestPath(backupDir))) return false
  let sealed: Record<string, number>
  try {
    sealed = JSON.parse(readFileSync(backupManifestPath(backupDir), 'utf8')) as Record<string, number>
  } catch {
    return false
  }
  // 形态守卫：合法 JSON 但非对象（null/数字/数组等）⇒ 视为清单损坏、备份不可信。
  // 否则 Object.keys(sealed) 对 null 抛 TypeError，从回滚关键路径
  // （rollbackPartialMigration / rollback.ts restoreFromBackup）直接崩溃；
  // 清单虽由本工具写入，部分写入/手工编辑/外部工具污染均可能产生合法 JSON 的
  // 坏形态（与 parseLedger 坏行守卫同口径）。
  if (sealed === null || typeof sealed !== 'object' || Array.isArray(sealed)) return false
  let actual: Record<string, number>
  try {
    actual = collectManifest(backupDir)
  } catch {
    return false
  }
  return Object.keys(actual).length === Object.keys(sealed).length && Object.keys(actual).every((key) => sealed[key] === actual[key])
}

/**
 * 目录树内是否存在晚于 sinceMs 写入的文件或目录（与 rollback.ts hasWritesAfter
 * 同口径的最小等价实现）：用于判定释放写锁窗口内活动进程是否向原位追加了事件。
 * 无法枚举/读取由调用方按「保留现场」保守处理；符号链接条目（dirent isFile/
 * isDirectory 均为 false）无法经 readdir 判定其目标的写入状态，同口径保守判有
 * 写入；目录条目同样检查自身 mtime——迁移后新增的空目录（内无任何文件）仅靠
 * 文件判定会漏检而被递归清退静默吞掉；目录 rename 保留自身 mtime，迁移前目录
 * 不会误报。
 */
function hasWritesAfter(dir: string, sinceMs: number): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (statSync(full).mtimeMs > sinceMs || hasWritesAfter(full, sinceMs)) return true
    } else if (entry.isFile() && statSync(full).mtimeMs > sinceMs) return true
    else if (entry.isSymbolicLink()) return true
  }
  return false
}

/** 迁移执行器：一个实例对应一个持久化后端 + 注册表 + 日志。 */
export class Migrator {
  /** 本实例已见过的持久化 root（requireCurrentLog 时记录；回滚恢复基准）。 */
  private lastKnownRoot: string | undefined

  constructor(
    private readonly persistence: DshSessionPersistence,
    private readonly registry: DshWorkspaceRegistry,
    private readonly log: MigrateLogger,
    private readonly dshHome: string = resolveDshHome(),
    /** 重写通道（缺省后端自带 persistBatch/persistHeader；测试可注入替身）。 */
    private readonly rewrite?: Pick<DshSessionPersistence, 'persistBatch' | 'persistHeader'>,
  ) {}

  /**
   * 执行单个迁移计划项。单会话失败不抛出：返回结果对象由调用层决定是否
   * 继续整轮（错误隔离）。
   *
   * item.header 仅为计划参考字段，实现不消费：迁移基准 header 以
   * requireSnapshot 实时取回的 before.header 为准（计划生成与执行存在时间窗，
   * 计划 header 可能陈旧），基准一致性由 fromCwd === before.header.cwd 复核兜底。
   */
  async migrate(item: { sessionId: SessionId; header?: DshSessionHeader; fromCwd: string; toCwd: string }): Promise<MigrateOutcome> {
    const { sessionId, fromCwd, toCwd } = item
    // 外层失败日志的处置口径（默认「备份前早期失败」）：仅当内层 catch 实际
    // 执行过回滚且备份还原成功才允许宣称「已回滚」，不得虚报。
    let rollbackResult: RollbackDisposition = { status: 'no-backup' }
    // 释放写锁前打点（步骤 7 或内层 catch 释放前写入）：回滚原位 trash 残迹的
    // 清退判定阈值——该时刻前 flock 持有中不存在任何应用侧写入，此后原位写入
    // 均属释放窗口内活动进程的迁移后增量（详见 rollbackPartialMigration）。
    let releaseAtMs: number | undefined
    try {
      // (1) 迁移前修订快照 + 计划基准复核。
      const before = await this.requireSnapshot(sessionId)
      if (before.header.cwd !== fromCwd) {
        return { status: 'failed', sessionId, detail: `header.cwd 已变为 '${String(before.header.cwd)}'，与计划基准 '${fromCwd}' 不符，跳过本轮` }
      }
      const toCwdCanonical = await realpath(toCwd)

      // (2) 写句柄：进程内单写者 + 跨进程 flock；他者持有写锁即拒绝本轮。
      const handle = await this.persistence.open(sessionId, 'write')
      let closed = false
      try {
        // (3) 读全量事件 + 写前修订校验。
        const events = (await handle.read()).events
        const after = await this.requireSnapshot(sessionId)
        if (after.revision !== before.revision) {
          // 写竞争中止：拒绝本轮，产物保持原状；先释放写声明再返回。
          await this.closeHandle(handle, sessionId)
          closed = true
          const detail = '迁移准备期间产物被改写（revision 变化），拒绝本轮，产物保持原状'
          // 拒绝不静默：调用方（runRound）不消费 refused 返回值，此处必须留痕。
          this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移被拒绝（revision-changed）：${detail}`)
          return { status: 'refused', sessionId, reason: 'revision-changed', detail }
        }
        // 根直属会话（header cwd 已等于项目根，canonical 同位）：零重写、零归位，
        // 直接注册表校正 + attach（产物归位幂等）。
        // 台账不写 backupDir：本次迁移无备份，历史周期遗留的备份目录不代表
        // 「本次迁移前状态」，写入台账会误导回滚用陈旧备份覆盖当前产物。
        if (await this.sameCanonicalPath(fromCwd, toCwdCanonical)) {
          await this.closeHandle(handle, sessionId)
          closed = true
          return await this.attachAndLedger(sessionId, before.header, toCwdCanonical, fromCwd, toCwd)
        }

        // (4) 备份先行（原会话目录全量复制），两阶段原子晋升：先复制到主备份区
        // 下唯一 staging 目录，完整性清单在 staging 侧先行封存，随后随 rename 一并
        // 晋升为正式备份目录。
        // cpSync 中途失败（磁盘满/个别文件不可读）时 staging 即刻清退，正式备份
        // 目录保持「无备份」状态，回滚自然走「失败发生于备份前、数据未改动」
        // 分支，绝不以残缺副本覆盖完好原目录。先清空旧备份：cpSync 对既存目录
        // 是合并语义（逐项覆盖、不删除多出文件），直接并入会让陈旧 generation
        // 跨周期残留，回滚还原时又被带回会话目录。
        const backupDir = backupDirFor(this.dshHome, sessionId)
        this.discardBackup(sessionId)
        const srcLog = await this.requireCurrentLog(sessionId)
        const backupStaging = `${backupDir}.staging-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        try {
          mkdirSync(dirname(backupDir), { recursive: true })
          cpSync(dirname(srcLog), backupStaging, { recursive: true })
          // 清单在 staging 侧封存（相对路径键与晋升后一致），易失败的收集/落盘
          // （磁盘满/EACCES）全部发生在晋升前，失败即整目录清退，不产生残缺晋升；
          // 晋升只剩两次 rename 且清单先行——中途被杀残留的是「有清单无目录」
          // （下轮 discardBackup 可全量清退），而非「有目录无清单」的不可信滞留，
          // 使「正式备份目录存在则清单必在」的不变式在同步失败路径上成立。
          writeFileSync(backupManifestPath(backupStaging), JSON.stringify(collectManifest(backupStaging)), 'utf8')
          renameSync(backupManifestPath(backupStaging), backupManifestPath(backupDir))
          renameSync(backupStaging, backupDir)
        } catch (error) {
          // 兜底清退全部四类可能残迹（force 对缺席路径是 no-op），绝不留下
          // 「正式备份目录存在但清单缺失」的滞留形态误导 rollbackPartialMigration
          // 误判「备份不可信，现场保留」。
          rmSync(backupStaging, { recursive: true, force: true })
          rmSync(backupManifestPath(backupStaging), { force: true })
          rmSync(backupDir, { recursive: true, force: true })
          rmSync(backupManifestPath(backupDir), { force: true })
          throw error
        }

        // (5) 以新 header 重写物化到目标 cwd 目录（目标已有 generation 即拒绝）。
        const newHeader: DshSessionHeader = { ...before.header, cwd: toCwd }
        await this.materializeRewritten(newHeader, events, handle.inheritedEventCount)

        // (6) 校验目标产物（identity 校验含新 header.cwd 与路径一致性）。
        const targetPath = join(this.lastKnownRoot as string, targetSessionDirKey(toCwd, sessionId), basename(srcLog))
        await this.verifyRewritten(targetPath, sessionId, toCwd)

        // (7) 释放写锁后删除旧目录（顺序不可颠倒：同 id 双目录共存 = duplicate）。
        //     释放前打点 releaseAtMs 供回滚 trash 清退判定：flock 持有中不存在任何
        //     应用侧写入，该时刻后目标位/原位的写入均属迁移后增量（台账 at 打点在
        //     attachAndLedger 尾部、晚于锁释放，以其为阈值会漏判窗口内追加的增量）。
        releaseAtMs = Date.now()
        await this.closeHandle(handle, sessionId)
        closed = true
        this.removeSourceSessionDir(srcLog, toCwd, sessionId)

        // (8) 注册表实例状态校正 + 官方 attach 归组 + 台账。
        return await this.attachAndLedger(sessionId, newHeader, toCwdCanonical, fromCwd, toCwd, backupDir, releaseAtMs)
      } catch (error) {
        // 数据级失败：回滚到原状态，不留半迁移。
        if (!closed) {
          // 判定阈值打点须先于释放写锁：flock 持有中不存在任何应用侧写入，该
          // 时刻前原位写入均属迁移窗口内（备份已含），此后写入均属释放窗口内
          // 其他进程的迁移后增量——与步骤 7 释放前打点同一口径。
          releaseAtMs = Date.now()
          await this.closeHandle(handle, sessionId)
        }
        rollbackResult = this.rollbackPartialMigration(sessionId, fromCwd, toCwd, releaseAtMs ?? Date.now())
        throw error
      }
    } catch (error) {
      // 失败阶段如实区分：仅备份已晋升且还原成功才宣称「已回滚」；备份前早期
      // 失败未改动任何数据；备份不可信/还原未完成时现场保留待人工核查。
      const detail = errorMessage(error)
      // 显式断言加宽后再比较：TS 跨嵌套 catch 再抛路径的 CFA 跟不到内层 catch
      // 的赋值，会把 rollbackResult 收窄成初值字面量并误判比较无交集（TS2367）；
      // 运行时值域即此三者并集（内层 catch 实际写入），断言还原真实类型。
      const result = rollbackResult as RollbackDisposition
      if (result.status === 'rolled-back') {
        this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移失败已回滚${result.trashDir === undefined ? '' : `（原位残迹含迁移后追加的写入，保留于 ${result.trashDir} 待人工核对）`}：${detail}`)
      } else if (result.status === 'restore-refused') {
        this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移失败（备份不可信，未执行还原，现场保留，详见回滚告警）：${detail}`)
      } else if (result.status === 'restore-done-cleanup-failed') {
        this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移失败（原目录已还原，仅目标残迹处置失败，残迹仍在目标位可人工找回，详见回滚告警）：${detail}`)
      } else {
        this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移早期失败（未改动数据，无需回滚）：${detail}`)
      }
      return { status: 'failed', sessionId, detail }
    }
  }

  // ── 步骤原语 ──────────────────────────────────────────────

  /** fromCwd（可能已删除，realpath 不解析）与目标 canonical 是否同位。 */
  private async sameCanonicalPath(fromCwd: string, toCwdCanonical: string): Promise<boolean> {
    if (fromCwd === toCwdCanonical) return true
    try {
      return (await realpath(fromCwd)) === toCwdCanonical
    } catch {
      return false
    }
  }

  private async requireSnapshot(id: SessionId): Promise<DshSessionSnapshot> {
    const snapshot = await this.persistence.stat(id)
    if (snapshot === undefined) throw new Error(`会话 ${id} 在持久化层不可见`)
    return snapshot
  }

  private async requireCurrentLog(id: SessionId): Promise<string> {
    const path = await this.persistence.resolveCurrentLog?.(id)
    if (path === undefined) throw new Error(`会话 ${id} 无当前 generation 产物`)
    // srcLog 形如 <root>/<projectKey>/<sessionDir>/<file>。
    this.lastKnownRoot = resolveRootFromLogPath(path)
    return path
  }

  private async materializeRewritten(newHeader: DshSessionHeader, events: readonly DshSessionEvent[], inheritedEventCount: number): Promise<void> {
    const channel = this.rewrite ?? this.persistence
    if (events.length === 0) {
      if (!channel.persistHeader) throw new Error('持久化缝不提供 persistHeader 重写通道（服务缝漂移）')
      await channel.persistHeader(newHeader, inheritedEventCount)
      return
    }
    if (!channel.persistBatch) throw new Error('持久化缝不提供 persistBatch 重写通道（服务缝漂移）')
    await channel.persistBatch(newHeader, events, false, inheritedEventCount)
  }

  private async verifyRewritten(targetPath: string, sessionId: SessionId, toCwd: string): Promise<void> {
    if (!existsSync(targetPath)) throw new Error(`重写产物未出现在目标路径 ${targetPath}`)
    if (this.persistence.readStoredLog === undefined) {
      // 形状桩后端（测试替身）无 readStoredLog 通道：以存在性校验顶替并在日志注明。
      this.log.warn(`fenix-dsh-session-grouper: 持久化缝不提供 readStoredLog，退化为存在性校验（会话 ${sessionId}）`)
      return
    }
    const verified = (await this.persistence.readStoredLog(targetPath, sessionId)) as { meta?: DshSessionHeader } | undefined
    if (verified?.meta?.cwd !== toCwd) {
      throw new Error(`重写产物校验失败：目标 header.cwd='${String(verified?.meta?.cwd)}' ≠ '${toCwd}'`)
    }
  }

  private async closeHandle(handle: { close(): Promise<void> }, sessionId: SessionId): Promise<void> {
    try {
      await handle.close()
    } catch (error) {
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 写句柄关闭异常（继续）：${errorMessage(error)}`)
    }
  }

  private removeSourceSessionDir(srcLog: string, toCwd: string, sessionId: SessionId): void {
    const root = this.lastKnownRoot
    if (root === undefined) return
    const srcSessionDir = dirname(srcLog)
    const targetSessionDir = join(root, targetSessionDirKey(toCwd, sessionId))
    // 防御：源目录与目标目录同一路径（根直属会话，cwd === 项目根）时不删。
    if (srcSessionDir === targetSessionDir) return
    // 窗口语义：closeHandle 释放写锁与本处删除之间存在窗口，持有该会话的活动
    // 进程可重新获得写锁并向旧目录追加事件，直接 rmSync 会把这些增量静默吞掉。
    // 与 rollback.ts 的 trash 口径一致：先 rename 挪入 trash 残目录（原子搬移，
    // 清退失败或中途被杀时增量滞留可人工找回，而非无声丢失），再清退残目录。
    const srcTrashDir = `${srcSessionDir}.trash-${Date.now().toString(36)}`
    let movedToTrash = false
    try {
      renameSync(srcSessionDir, srcTrashDir)
      movedToTrash = true
    } catch {
      // 源目录已缺席或不可挪动（无可保留的增量）：按直接删除兜底（force 对缺席
      // 目录是 no-op）。
    }
    if (movedToTrash) {
      try {
        rmSync(srcTrashDir, { recursive: true, force: true })
      } catch (error) {
        this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 旧目录残迹清退失败，增量滞留于 ${srcTrashDir} 可人工找回：${errorMessage(error)}`)
      }
    } else {
      rmSync(srcSessionDir, { recursive: true, force: true })
    }
    // 旧 project 目录清空则一并移除（避免 mangled 目录残留噪音）。
    const srcProjectDir = dirname(srcSessionDir)
    try {
      if (readdirSync(srcProjectDir).length === 0) rmSync(srcProjectDir, { recursive: true, force: true })
    } catch {
      // 目录已不存在/不可枚举：忽略。
    }
  }

  /**
   * 注册表实例状态校正 + attach + 台账。
   * backupDir 缺省 = attach-only 路径（零重写零备份）：台账不写该字段，
   * 保证「台账带 backupDir ⇒ 备份确属本次迁移前状态」的回滚前提。
   * releaseAtMs 仅重写路径传入并记入台账（回滚 trash 清退判定阈值）；
   * attach-only 路径零重写零窗口，回滚走同位短路分支，不消费该时刻。
   */
  private async attachAndLedger(
    sessionId: SessionId,
    newHeader: DshSessionHeader,
    toCwdCanonical: string,
    fromCwd: string,
    toCwd: string,
    backupDir?: string,
    releaseAtMs?: number,
  ): Promise<MigrateOutcome> {
    const headers = this.registry.headers
    const sessionPaths = this.registry.sessionPaths
    const indexShapeOk = headers instanceof Map && sessionPaths instanceof Map
    let pendingDetail: string | undefined
    if (indexShapeOk) {
      headers.set(sessionId, newHeader)
      sessionPaths.set(sessionId, toCwdCanonical)
      this.registry.invalidSessionPaths?.delete(sessionId)
    } else {
      pendingDetail = '注册表实例索引形态不符（headers/sessionPaths 非 Map），转 pending-attach 兜底'
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} ${pendingDetail}`)
    }
    try {
      const workspace: DshWorkspace = await this.registry.create(toCwd, basename(toCwd))
      await workspace.attachSession(sessionId)
    } catch (error) {
      // attach 级失败：数据已一致，按 Decision 5(b) 记 pending-attach（不回滚数据）。
      const detail = `${pendingDetail === undefined ? 'attachSession 失败' : pendingDetail}：${errorMessage(error)}`
      // 台账落盘失败（磁盘满/EACCES 等）同样不进入数据回滚路径：此刻重写/归位
      // 早已完成，外层 catch 的 rollbackPartialMigration 会把迁移成功的新产物整体
      // 删除还原，而注册表内存态不随回滚校正——失败仅 warn 降级为「迁移成功但
      // 台账缺失」。
      try {
        appendLedger(this.dshHome, { sessionId, fromCwd, toCwd, at: new Date().toISOString(), status: 'pending-attach', detail, ...(backupDir === undefined ? {} : { backupDir }), ...(releaseAtMs === undefined ? {} : { releaseAtMs }) })
      } catch (ledgerError) {
        this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移成功但台账 pending-attach 落盘失败（数据已一致不回滚；台账缺失该 id 会被下轮重复迁移，请人工核对）：${errorMessage(ledgerError)}`)
      }
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 数据已迁移但归组未即时生效（pending-attach，下次启动/重启重试）：${detail}`)
      return { status: 'pending-attach', sessionId, fromCwd, toCwd, detail }
    }
    try {
      appendLedger(this.dshHome, { sessionId, fromCwd, toCwd, at: new Date().toISOString(), status: 'migrated', ...(backupDir === undefined ? {} : { backupDir }), ...(releaseAtMs === undefined ? {} : { releaseAtMs }) })
    } catch (ledgerError) {
      // 同上：台账写失败不回滚已一致数据，仅降级告警留痕。
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移成功但台账 migrated 落盘失败（数据已一致不回滚；台账缺失该 id 会被下轮重复迁移，请人工核对）：${errorMessage(ledgerError)}`)
    }
    this.log.info?.(`fenix-dsh-session-grouper: 会话 ${sessionId} 已迁移归组：${fromCwd} → ${toCwd}`)
    return { status: 'migrated', sessionId, fromCwd, toCwd }
  }

  /** 清退备份目录与其完整性清单（既往周期遗留备份绝不充当本次「迁移前状态」）。 */
  private discardBackup(sessionId: SessionId): void {
    const backupDir = backupDirFor(this.dshHome, sessionId)
    rmSync(backupDir, { recursive: true, force: true })
    rmSync(backupManifestPath(backupDir), { force: true })
  }

  /**
   * 数据级失败回滚：以备份为准恢复原目录、清理半迁移目标目录。
   * 备份不存在（失败发生在备份前）时数据未动，仅告警。
   * 返回处置口径供外层失败日志如实措辞：status 'rolled-back' = 备份已还原就位；
   * 'no-backup' = 无备份、数据未改动；'restore-refused' = 备份不可信或还原前
   * 拒绝/中断，拒绝/未能还原，现场保留（详见告警）；'restore-done-cleanup-failed' =
   * 备份已还原就位（还原已完成），仅其后的目标残迹清理/处置失败。
   * trashDir = 还原前挪入 trash 的原位残迹经判定含迁移后追加写入（或无法判定/
   * 清退失败）而保守保留的残目录路径，供人工核对（已清退则缺省）。
   */
  private rollbackPartialMigration(sessionId: SessionId, fromCwd: string, toCwd: string, disposeSinceMs: number): RollbackDisposition {
    const root = this.lastKnownRoot
    const backupDir = backupDirFor(this.dshHome, sessionId)
    if (root === undefined || !existsSync(backupDir)) {
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 失败发生于备份前（root=${String(root)}，backup=${existsSync(backupDir)}），数据未改动，无需回滚`)
      return { status: 'no-backup' }
    }
    // 信任备份前先核验完整性：清单缺失/损坏/内容不符 ⇒ 备份不可信，拒绝还原
    // （保留现场供人工核查），绝不以残缺副本覆盖仍然完好的原目录。
    if (!backupIntact(backupDir)) {
      this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 备份完整性核验未通过（${backupDir}），拒绝还原以保留现场，请人工核查后处置`)
      return { status: 'restore-refused' }
    }
    // 备份真实位置随回滚推进变化：backupDir → stagingDir（第一段 rename 后）→
    // originalDir（还原完成）。失败日志必须报告当下真实位置，排障者按提示才能
    // 找到备份；rename 原子完成即无 staging 残留（数据整体就位，无副本散落）。
    // originalDir/stagingDir 提至 try 外（纯路径计算不抛错）：catch 内按
    // backupLocation 是否已推进到 originalDir 区分失败阶段——还原完成后的残迹
    // 处置失败 ≠ 还原前拒绝，二者外层措辞必须区分（见 catch）。
    const originalDir = join(root, targetSessionDirKey(fromCwd, sessionId))
    const stagingDir = `${originalDir}.rollback-${Date.now().toString(36)}`
    let backupLocation = backupDir
    let retainedTrashDir: string | undefined
    try {
      mkdirSync(dirname(originalDir), { recursive: true })
      // 先挪走半迁移残迹（若在），再把备份整目录就位（rename 原子）。原目录不得
      // 直接递归删除：closeHandle 释放写锁与本处还原之间存在窗口，持有该会话的
      // 活动进程可重新获得写锁并向原目录追加事件，直接 rmSync 会把这些增量静默
      // 吞掉——与 removeSourceSessionDir 及 rollback.ts restoreFromBackup 的
      // trash 口径一致，先 rename 挪入 trash 残目录保留（原子搬移，判定或清退
      // 失败时增量滞留可人工找回，而非无声丢失），备份就位后再以释放写锁前打点
      // （disposeSinceMs）经 hasWritesAfter 同口径判定清退或保留。
      let originalTrashDir: string | undefined
      if (existsSync(originalDir)) {
        originalTrashDir = `${originalDir}.trash-${Date.now().toString(36)}`
        try {
          renameSync(originalDir, originalTrashDir)
        } catch (error) {
          // 原目录不可挪动：保留现场拒绝还原（绝不以递归删除硬闯吞掉窗口内可能
          // 的追加增量），备份完整保留于主备份区原位，人工核查后处置。
          this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚还原前原目录无法挪入 trash 残目录（${originalTrashDir}），为保留现场拒绝还原，备份完整保留于 ${backupDir}，请人工核查后处置：${errorMessage(error)}`)
          return { status: 'restore-refused' }
        }
      }
      renameSync(backupDir, stagingDir)
      backupLocation = stagingDir
      renameSync(stagingDir, originalDir)
      backupLocation = originalDir
      // 备份已就位：清退完整性清单文件（残留会在下轮被误当在册核验基准）。
      // （本路径未走 rollback.ts 的 restoreFromBackup，此处清理为独立实现，幂等。）
      try {
        rmSync(backupManifestPath(backupDir), { force: true })
      } catch {
        // 清理失败不影响回滚结果。
      }
      // 原位残迹清退判定（retainOrDisposeOriginalTrash：与 rollback.ts
      // retainOrDisposeTrash 同口径）：trash 内存在晚于释放写锁前打点的写入即
      // 窗口内活动进程追加的增量，保留待人工核对；无更晚写入才清退。
      if (originalTrashDir !== undefined) {
        retainedTrashDir = this.retainOrDisposeOriginalTrash(originalTrashDir, disposeSinceMs, sessionId)
      }
      const targetDir = join(root, targetSessionDirKey(toCwd, sessionId))
      if (targetDir !== originalDir && existsSync(targetDir)) {
        // 与 rollback.ts 对同一场景的 trash 口径对齐：迁移后会话通常已在目标位
        // 继续追加事件，rmSync 会静默吞掉这部分增量——先 rename 挪入 trash 残
        // 目录保留，递归删除只在备份已还原就位之后进行且失败仅留残迹，增量
        // 丢失时可从 `${targetDir}.trash-<时间戳>` 人工找回。
        const targetTrashDir = `${targetDir}.trash-${Date.now().toString(36)}`
        renameSync(targetDir, targetTrashDir)
        try {
          rmSync(targetTrashDir, { recursive: true, force: true })
        } catch (error) {
          this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 半迁移目标目录残迹清退失败，增量滞留于 ${targetTrashDir} 可人工找回：${errorMessage(error)}`)
        }
        // 目标 project 目录清空则一并移除（避免 mangled 目录残留噪音）。
        try {
          const targetProjectDir = dirname(targetDir)
          if (existsSync(targetProjectDir) && readdirSync(targetProjectDir).length === 0) rmSync(targetProjectDir, { recursive: true, force: true })
        } catch {
          // 目录已不存在/不可枚举：忽略。
        }
      }
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 已回滚到迁移前状态（备份已还原至 ${originalDir}${retainedTrashDir === undefined ? '' : `；原位残迹含迁移后追加的写入，保留于 ${retainedTrashDir} 待人工核对`}）`)
      return { status: 'rolled-back', ...(retainedTrashDir === undefined ? {} : { trashDir: retainedTrashDir }) }
    } catch (error) {
      if (backupLocation === originalDir) {
        // 备份已 rename 就位（还原已完成），失败发生在其后的残迹清理/处置阶段：
        // 若按 'restore-refused' 上报，外层会宣称「备份不可信，未执行还原」，与
        // 已完成的还原事实矛盾（误导排障者寻找一个已不存在的备份），故区分口径。
        this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 已还原至 ${originalDir}，但目标残迹处置失败（残迹仍在目标位，可人工找回${retainedTrashDir === undefined ? '' : `；原位残迹保留于 ${retainedTrashDir} 待人工核对`}）：${errorMessage(error)}`)
        return { status: 'restore-done-cleanup-failed', ...(retainedTrashDir === undefined ? {} : { trashDir: retainedTrashDir }) }
      }
      this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚自检失败（备份保留于 ${backupLocation}）：${errorMessage(error)}`)
      return { status: 'restore-refused' }
    }
  }

  /**
   * 原位 trash 残迹保守清退（与 rollback.ts retainOrDisposeTrash 同口径的最小
   * 等价实现——rollback.ts 未导出该判定，且其已单向依赖本文件，反向 import 会
   * 构成循环依赖）：trash 内存在晚于判定阈值写入的文件即释放写锁窗口内活动进程
   * 追加的事件/产物，递归删除会静默丢失——保留并返回路径交人工核对；无更晚写入
   * 才清退；时刻不可解析、判定或清退失败一律保守保留。阈值 disposeSinceMs 取
   * 释放写锁前打点（flock 持有中不存在任何应用侧写入，此后原位写入均属迁移后
   * 增量，严格大于判定完整覆盖）。返回 undefined 表示已清退。
   */
  private retainOrDisposeOriginalTrash(trashDir: string, sinceMs: number, sessionId: SessionId): string | undefined {
    try {
      if (Number.isNaN(sinceMs)) {
        this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚清退判定时刻不可解析，无法判定原位是否有迁移后追加的写入，trash 残迹保留于 ${trashDir}，请人工核对后清理`)
        return trashDir
      }
      if (hasWritesAfter(trashDir, sinceMs)) {
        this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚后原位存在迁移后追加的写入，trash 残迹保留于 ${trashDir}，请人工核对后清理`)
        return trashDir
      }
      rmSync(trashDir, { recursive: true, force: true })
    } catch (error) {
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚后无法判定/清退原位 trash 残迹，保留于 ${trashDir} 待人工核对：${errorMessage(error)}`)
      return trashDir
    }
    return undefined
  }
}
