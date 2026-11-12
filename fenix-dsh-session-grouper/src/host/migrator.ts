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

/** 台账行解析（单行损坏跳过不抛）。 */
export function parseLedger(dshHome: string): readonly MigrationLedgerEntry[] {
  const path = ledgerPath(dshHome)
  if (!existsSync(path)) return []
  const entries: MigrationLedgerEntry[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      entries.push(JSON.parse(trimmed) as MigrationLedgerEntry)
    } catch {
      // 单行损坏跳过，不影响其余行。
    }
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
    let rollbackResult: 'rolled-back' | 'no-backup' | 'restore-refused' = 'no-backup'
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
        // 下唯一 staging 目录，成功后 rename 晋升为正式备份目录并封存完整性清单。
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
          renameSync(backupStaging, backupDir)
          writeFileSync(this.backupManifestPath(backupDir), JSON.stringify(this.collectManifest(backupDir)), 'utf8')
        } catch (error) {
          rmSync(backupStaging, { recursive: true, force: true })
          throw error
        }

        // (5) 以新 header 重写物化到目标 cwd 目录（目标已有 generation 即拒绝）。
        const newHeader: DshSessionHeader = { ...before.header, cwd: toCwd }
        await this.materializeRewritten(newHeader, events, handle.inheritedEventCount)

        // (6) 校验目标产物（identity 校验含新 header.cwd 与路径一致性）。
        const targetPath = join(this.lastKnownRoot as string, targetSessionDirKey(toCwd, sessionId), basename(srcLog))
        await this.verifyRewritten(targetPath, sessionId, toCwd)

        // (7) 释放写锁后删除旧目录（顺序不可颠倒：同 id 双目录共存 = duplicate）。
        await this.closeHandle(handle, sessionId)
        closed = true
        this.removeSourceSessionDir(srcLog, toCwd, sessionId)

        // (8) 注册表实例状态校正 + 官方 attach 归组 + 台账。
        return await this.attachAndLedger(sessionId, newHeader, toCwdCanonical, fromCwd, toCwd, backupDir)
      } catch (error) {
        // 数据级失败：回滚到原状态，不留半迁移。
        if (!closed) await this.closeHandle(handle, sessionId)
        rollbackResult = this.rollbackPartialMigration(sessionId, fromCwd, toCwd)
        throw error
      }
    } catch (error) {
      // 失败阶段如实区分：仅备份已晋升且还原成功才宣称「已回滚」；备份前早期
      // 失败未改动任何数据；备份不可信/还原未完成时现场保留待人工核查。
      const detail = errorMessage(error)
      // 显式断言加宽后再比较：TS 跨嵌套 catch 再抛路径的 CFA 跟不到内层 catch
      // 的赋值，会把 rollbackResult 收窄成初值字面量并误判比较无交集（TS2367）；
      // 运行时值域即此三者并集（内层 catch 实际写入），断言还原真实类型。
      const result = rollbackResult as 'rolled-back' | 'no-backup' | 'restore-refused'
      if (result === 'rolled-back') {
        this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移失败已回滚：${detail}`)
      } else if (result === 'restore-refused') {
        this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移失败（备份不可信，未执行还原，现场保留，详见回滚告警）：${detail}`)
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
    // srcLog 形如 <root>/<projectKey>/<sessionDir>/<file>；root 取上三级。
    this.lastKnownRoot = dirname(dirname(dirname(path)))
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
    rmSync(srcSessionDir, { recursive: true, force: true })
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
   */
  private async attachAndLedger(
    sessionId: SessionId,
    newHeader: DshSessionHeader,
    toCwdCanonical: string,
    fromCwd: string,
    toCwd: string,
    backupDir?: string,
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
      appendLedger(this.dshHome, { sessionId, fromCwd, toCwd, at: new Date().toISOString(), status: 'pending-attach', detail, ...(backupDir === undefined ? {} : { backupDir }) })
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 数据已迁移但归组未即时生效（pending-attach，下次启动/重启重试）：${detail}`)
      return { status: 'pending-attach', sessionId, fromCwd, toCwd, detail }
    }
    appendLedger(this.dshHome, { sessionId, fromCwd, toCwd, at: new Date().toISOString(), status: 'migrated', ...(backupDir === undefined ? {} : { backupDir }) })
    this.log.info?.(`fenix-dsh-session-grouper: 会话 ${sessionId} 已迁移归组：${fromCwd} → ${toCwd}`)
    return { status: 'migrated', sessionId, fromCwd, toCwd }
  }

  /** 备份完整性清单路径（与备份目录同级，永不进入会话目录）。 */
  private backupManifestPath(backupDir: string): string {
    return `${backupDir}.manifest.json`
  }

  /** 清退备份目录与其完整性清单（既往周期遗留备份绝不充当本次「迁移前状态」）。 */
  private discardBackup(sessionId: SessionId): void {
    const backupDir = backupDirFor(this.dshHome, sessionId)
    rmSync(backupDir, { recursive: true, force: true })
    rmSync(this.backupManifestPath(backupDir), { force: true })
  }

  /** 递归收集目录清单：相对路径 → 字节数。 */
  private collectManifest(root: string, dir: string = root, files: Record<string, number> = {}): Record<string, number> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) this.collectManifest(root, full, files)
      else if (entry.isFile()) files[relative(root, full)] = statSync(full).size
    }
    return files
  }

  /** 回滚前核验：备份内容与封存清单逐文件比对（文件数 + 字节数）；清单缺失/损坏/不符均视为不可信。 */
  private backupIntact(backupDir: string): boolean {
    if (!existsSync(this.backupManifestPath(backupDir))) return false
    let sealed: Record<string, number>
    try {
      sealed = JSON.parse(readFileSync(this.backupManifestPath(backupDir), 'utf8')) as Record<string, number>
    } catch {
      return false
    }
    let actual: Record<string, number>
    try {
      actual = this.collectManifest(backupDir)
    } catch {
      return false
    }
    return Object.keys(actual).length === Object.keys(sealed).length && Object.keys(actual).every((key) => sealed[key] === actual[key])
  }

  /**
   * 数据级失败回滚：以备份为准恢复原目录、清理半迁移目标目录。
   * 备份不存在（失败发生在备份前）时数据未动，仅告警。
   * 返回处置口径供外层失败日志如实措辞：'rolled-back' = 备份已还原就位；
   * 'no-backup' = 无备份、数据未改动；'restore-refused' = 备份不可信或还原
   * 中断，拒绝/未能还原，现场保留（详见告警）。
   */
  private rollbackPartialMigration(sessionId: SessionId, fromCwd: string, toCwd: string): 'rolled-back' | 'no-backup' | 'restore-refused' {
    const root = this.lastKnownRoot
    const backupDir = backupDirFor(this.dshHome, sessionId)
    if (root === undefined || !existsSync(backupDir)) {
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 失败发生于备份前（root=${String(root)}，backup=${existsSync(backupDir)}），数据未改动，无需回滚`)
      return 'no-backup'
    }
    // 信任备份前先核验完整性：清单缺失/损坏/内容不符 ⇒ 备份不可信，拒绝还原
    // （保留现场供人工核查），绝不以残缺副本覆盖仍然完好的原目录。
    if (!this.backupIntact(backupDir)) {
      this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 备份完整性核验未通过（${backupDir}），拒绝还原以保留现场，请人工核查后处置`)
      return 'restore-refused'
    }
    // 备份真实位置随回滚推进变化：backupDir → stagingDir（第一段 rename 后）→
    // originalDir（还原完成）。失败日志必须报告当下真实位置，排障者按提示才能
    // 找到备份；rename 原子完成即无 staging 残留（数据整体就位，无副本散落）。
    let backupLocation = backupDir
    try {
      const originalDir = join(root, targetSessionDirKey(fromCwd, sessionId))
      const stagingDir = `${originalDir}.rollback-${Date.now().toString(36)}`
      mkdirSync(dirname(originalDir), { recursive: true })
      // 先挪走半迁移残迹（若在），再把备份整目录就位（rename 原子）。
      rmSync(originalDir, { recursive: true, force: true })
      renameSync(backupDir, stagingDir)
      backupLocation = stagingDir
      renameSync(stagingDir, originalDir)
      backupLocation = originalDir
      // 备份已就位：清退完整性清单文件（残留会在下轮被误当在册核验基准）。
      try {
        rmSync(this.backupManifestPath(backupDir), { force: true })
      } catch {
        // 清理失败不影响回滚结果。
      }
      const targetDir = join(root, targetSessionDirKey(toCwd, sessionId))
      if (targetDir !== originalDir && existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true })
        // 目标 project 目录清空则一并移除（避免 mangled 目录残留噪音）。
        try {
          const targetProjectDir = dirname(targetDir)
          if (existsSync(targetProjectDir) && readdirSync(targetProjectDir).length === 0) rmSync(targetProjectDir, { recursive: true, force: true })
        } catch {
          // 目录已不存在/不可枚举：忽略。
        }
      }
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 已回滚到迁移前状态（备份已还原至 ${originalDir}）`)
      return 'rolled-back'
    } catch (error) {
      this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚自检失败（备份保留于 ${backupLocation}）：${errorMessage(error)}`)
      return 'restore-refused'
    }
  }
}
