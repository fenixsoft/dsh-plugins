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
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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
   */
  async migrate(item: { sessionId: SessionId; header: DshSessionHeader; fromCwd: string; toCwd: string }): Promise<MigrateOutcome> {
    const { sessionId, fromCwd, toCwd } = item
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
          return { status: 'refused', sessionId, reason: 'revision-changed', detail: '迁移准备期间产物被改写（revision 变化），拒绝本轮，产物保持原状' }
        }
        // 根直属会话（header cwd 已等于项目根，canonical 同位）：零重写、零归位，
        // 直接注册表校正 + attach（产物归位幂等）。
        if (await this.sameCanonicalPath(fromCwd, toCwdCanonical)) {
          await this.closeHandle(handle, sessionId)
          closed = true
          return await this.attachAndLedger(sessionId, before.header, toCwdCanonical, fromCwd, toCwd, backupDirFor(this.dshHome, sessionId))
        }

        // (4) 备份先行（原会话目录全量复制）。
        const srcLog = await this.requireCurrentLog(sessionId)
        const backupDir = backupDirFor(this.dshHome, sessionId)
        mkdirSync(backupDir, { recursive: true })
        cpSync(dirname(srcLog), backupDir, { recursive: true })

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
        this.rollbackPartialMigration(sessionId, fromCwd, toCwd)
        throw error
      }
    } catch (error) {
      const detail = errorMessage(error)
      this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 迁移失败已回滚：${detail}`)
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

  /** 注册表实例状态校正 + attach + 台账。 */
  private async attachAndLedger(
    sessionId: SessionId,
    newHeader: DshSessionHeader,
    toCwdCanonical: string,
    fromCwd: string,
    toCwd: string,
    backupDir: string,
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
      appendLedger(this.dshHome, { sessionId, fromCwd, toCwd, at: new Date().toISOString(), status: 'pending-attach', detail, backupDir })
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 数据已迁移但归组未即时生效（pending-attach，下次启动/重启重试）：${detail}`)
      return { status: 'pending-attach', sessionId, fromCwd, toCwd, detail }
    }
    appendLedger(this.dshHome, { sessionId, fromCwd, toCwd, at: new Date().toISOString(), status: 'migrated', backupDir })
    this.log.info?.(`fenix-dsh-session-grouper: 会话 ${sessionId} 已迁移归组：${fromCwd} → ${toCwd}`)
    return { status: 'migrated', sessionId, fromCwd, toCwd }
  }

  /**
   * 数据级失败回滚：以备份为准恢复原目录、清理半迁移目标目录。
   * 备份不存在（失败发生在备份前）时数据未动，仅告警。
   */
  private rollbackPartialMigration(sessionId: SessionId, fromCwd: string, toCwd: string): void {
    const root = this.lastKnownRoot
    const backupDir = backupDirFor(this.dshHome, sessionId)
    if (root === undefined || !existsSync(backupDir)) {
      this.log.warn(`fenix-dsh-session-grouper: 会话 ${sessionId} 失败发生于备份前（root=${String(root)}，backup=${existsSync(backupDir)}），数据未改动，无需回滚`)
      return
    }
    try {
      const originalDir = join(root, targetSessionDirKey(fromCwd, sessionId))
      const stagingDir = `${originalDir}.rollback-${Date.now().toString(36)}`
      mkdirSync(dirname(originalDir), { recursive: true })
      // 先挪走半迁移残迹（若在），再把备份整目录就位（rename 原子）。
      rmSync(originalDir, { recursive: true, force: true })
      renameSync(backupDir, stagingDir)
      renameSync(stagingDir, originalDir)
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
    } catch (error) {
      this.log.error(`fenix-dsh-session-grouper: 会话 ${sessionId} 回滚自检失败（备份保留于 ${backupDir}）：${errorMessage(error)}`)
    }
  }
}
