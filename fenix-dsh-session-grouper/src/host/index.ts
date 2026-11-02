/**
 * fenix-dsh-session-grouper Host 半：会话归组插件（纯 host，无 client UI）。
 *
 * - 插件形态：默认导出 cordis 插件服务类（对齐 fenix-dsh-dashboard-bridge
 *   host 半先例），loader 条目按包名装载，config 键 `projects` /
 *   `quietMinutes` / `intervalMinutes` / `enabled` 可省略（缺省见 settings.ts）。
 * - 启动期服务缝校验：`ctx.workspaceRegistry` / `ctx.sessionPersistence` 缺失、
 *   持久化后端非 JSONL（SQLite 等不受支持形态）、运行时包版本与 peer 钉版
 *   (0.2.0-rc.2) 不符 → 显式错误停用扫描（MUST NOT 静默降级、不写坏产物）。
 * - `enabled=false` 或 `projects=[]`：零动作零注册（仅日志记录停用态）。
 * - 周期扫描循环：每 `intervalMinutes` 一轮——注册项目工作区 → 扫描未归组
 *   冷会话 → 构建迁移计划 → 逐会话执行（单会话失败错误隔离，不中断整轮）。
 * - 返回/卸载语义：构造内挂 ctx.effect 停止循环；`stop()` 供测试显式停止。
 */
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { buildMigrationPlan, sessionDirKeyOf } from '../shared/rules.js'
import type { MigrationPlanItem } from '../shared/rules.js'
import type { DshSessionPersistence, DshWorkspaceRegistry, SessionScanEntry } from '../types/seam.js'
import { Migrator, readMigratedSessionIds, resolveDshHome } from './migrator.js'
import type { MigrateLogger } from './migrator.js'
import { resolveSettings } from './settings.js'
import type { GrouperConfigInput, GrouperSettings } from './settings.js'
import { ensureProjectWorkspaces, scanSessions, errorMessage } from './sessionScan.js'

/** 本插件注册为 cordis 服务的名字（诊断/日志定位用）。 */
export const SERVICE_NAME = 'fenix-dsh-session-grouper'

/** peer 精确钉版（package.json peerDependencies 同步；漂移即显式拒绝装载）。 */
export const PEER_PIN = '0.2.0-rc.2'

/** 版本校验探测的包（peerDependencies 被消费面）。 */
const PINNED_PACKAGES = ['@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-workspace'] as const

/** 服务缝校验结果（显式失败时携带可定位的原因）。 */
export interface SeamCheckResult {
  readonly ok: boolean
  readonly reason?: string
}

export interface SessionGrouperOptions extends GrouperConfigInput {
  /** DSH_HOME 覆盖（测试注入临时目录；缺省 resolveDshHome()）。 */
  readonly dshHome?: string
  /**
   * peer 版本探针注入（缺省经 createRequire 读安装包 package.json；
   * 测试注入钉版漂移形态覆盖显式拒绝分支）。
   */
  readonly peerVersionProbe?: (pkg: string) => string | undefined
}

/**
 * Host 插件：装载即校验服务缝与配置，随后周期扫描迁移。
 */
export default class FenixSessionGrouper extends Service {
  /**
   * cordis 依赖注入声明（对齐 bridge host 先例 `static inject = ['webServer']`）：
   * 真实 dsh loader 须等 `workspaceRegistry` / `sessionPersistence` 服务就绪后再
   * apply 本插件，构造期 `ctx.<service>` 属性访问才可解析。缺声明的实锾示证
   * （0.2.0-rc.2 真机装载即崩）：插件 fiber 的 store 链上服务尚未在位，cordis
   * 代理抛 `cannot get property "workspaceRegistry" without inject` → loader
   * 「1 entry did not activate」→ 零注册零迁移。服务名真源：dsh-workspace
   * `super(ctx, 'workspaceRegistry')`；dsh-workspace 自身
   * `static inject = ['storageDomain', 'sessionPersistence']`（两名字均为
   * cordis 服务名）。单测形状桩自供 ctx 不经 loader 装载缝，hostContract
   * 以 inject 声明契约测试守卫（漏声明即单测红灯）。
   */
  static readonly inject = ['workspaceRegistry', 'sessionPersistence']

  /** 扫描循环句柄（stop() / 卸载 effect 复用）。 */
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  /** 停用原因（校验失败/开关关闭时置位；空 = 正常运行）。 */
  private readonly deactivateReason: { reason: string; level: 'info' | 'error' } | undefined
  private readonly settings: GrouperSettings
  private readonly dshHome: string
  private readonly peerVersionProbe: ((pkg: string) => string | undefined) | undefined

  constructor(ctx: Context, config?: SessionGrouperOptions | null) {
    super(ctx, SERVICE_NAME)
    this.settings = resolveSettings(config)
    this.dshHome = config?.dshHome ?? resolveDshHome()
    this.peerVersionProbe = config?.peerVersionProbe
    this.deactivateReason = this.checkDeactivation(config)
    if (this.deactivateReason !== undefined) {
      if (this.deactivateReason.level === 'error') this.logError(this.deactivateReason.reason)
      else this.logInfo(this.deactivateReason.reason)
      // 显式停用（服务缝漂移）或合法零动作（开关关闭/空项目根）：不启动循环，
      // 服务本体保持装载供诊断日志回查；零注册、零迁移。
      return
    }
    // 插件卸载（loader 条目移除 / fiber 卸载）时停止扫描循环。
    this.ctx.effect(() => () => this.stop(), `${SERVICE_NAME}: scan loop`)
    this.scheduleNextRound(0)
  }

  /** 停用判定：开关关闭 / projects 空（合法零动作，info 级）；服务缝漂移（error 级显式失败）。 */
  private checkDeactivation(config?: SessionGrouperOptions | null): { reason: string; level: 'info' | 'error' } | undefined {
    if (!this.settings.enabled) {
      return { reason: 'fenix-dsh-session-grouper: enabled=false，停用（零注册、零迁移）', level: 'info' }
    }
    if (this.settings.projects.length === 0) {
      return { reason: 'fenix-dsh-session-grouper: projects=[]，零注册、零迁移（停用扫描循环）', level: 'info' }
    }
    const seam = this.checkServiceSeam()
    if (!seam.ok) return { reason: `fenix-dsh-session-grouper: 服务缝校验失败，显式停用扫描：${seam.reason}`, level: 'error' }
    return undefined
  }

  /**
   * 服务缝存在性与形态校验：`ctx.workspaceRegistry`（create/list）/
   * `ctx.sessionPersistence`（list/open/stat/resolveCurrentLog/persist 通道）
   * 必须在位；持久化后端必须为 JSONL（`name === 'session-persistence-jsonl'`，
   * SQLite 形态不受支持，显式失败）；peer 钉版不符显式拒绝。
   */
  private checkServiceSeam(): SeamCheckResult {
    const registry: DshWorkspaceRegistry | undefined = this.ctx.workspaceRegistry
    if (registry === undefined || typeof registry.create !== 'function' || typeof registry.list !== 'function') {
      return { ok: false, reason: 'ctx.workspaceRegistry 缺失或形态不符（dsh-workspace 服务缝漂移？）' }
    }
    const persistence: DshSessionPersistence | undefined = this.ctx.sessionPersistence
    if (persistence === undefined || typeof persistence.list !== 'function' || typeof persistence.open !== 'function' || typeof persistence.stat !== 'function') {
      return { ok: false, reason: 'ctx.sessionPersistence 缺失或形态不符（dsh-session-persistence 服务缝漂移？）' }
    }
    if (persistence.name !== 'session-persistence-jsonl') {
      return { ok: false, reason: `持久化后端 '${String(persistence.name)}' 非 JSONL 形态，本插件不支持（SQLite 等直接显式失败）` }
    }
    if (typeof persistence.resolveCurrentLog !== 'function' || typeof persistence.persistBatch !== 'function' || typeof persistence.persistHeader !== 'function' || typeof persistence.readStoredLog !== 'function') {
      return { ok: false, reason: 'sessionPersistence 缺少重写/定位通道（resolveCurrentLog/persistBatch/persistHeader/readStoredLog）' }
    }
    const version = this.checkPeerVersions()
    if (!version.ok) return { ok: false, reason: version.reason }
    return { ok: true }
  }

  /** peer 钉版校验：可解析到安装包 package.json 时比对版本，否则告警放行。 */
  private checkPeerVersions(): SeamCheckResult {
    if (this.peerVersionProbe !== undefined) {
      for (const pkg of PINNED_PACKAGES) {
        const version = this.peerVersionProbe(pkg)
        if (version !== undefined && version !== PEER_PIN) {
          return { ok: false, reason: `${pkg} 运行时版本 ${version} 与 peer 钉版 ${PEER_PIN} 不符（缝漂移纪律：显式拒绝装载）` }
        }
      }
      return { ok: true }
    }
    try {
      const require = createRequire(import.meta.url)
      for (const pkg of PINNED_PACKAGES) {
        const manifest = require(`${pkg}/package.json`) as { version?: string }
        if (manifest.version !== undefined && manifest.version !== PEER_PIN) {
          return { ok: false, reason: `${pkg} 运行时版本 ${manifest.version} 与 peer 钉版 ${PEER_PIN} 不符（缝漂移纪律：显式拒绝装载）` }
        }
      }
      return { ok: true }
    } catch {
      // 安装布局无法 require 解析（如 pnpm link 形态）：结构校验已兜底，告警放行。
      this.logWarn(`fenix-dsh-session-grouper: peer 版本无法经 require 解析校验（${PINNED_PACKAGES.join(', ')}），以结构校验为准`)
      return { ok: true }
    }
  }

  /** 周期扫描循环：setTimeout 链（intervalMs 间隔；stop 可打断）。 */
  private scheduleNextRound(delayMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.runRound().finally(() => {
        if (!this.stopped) this.scheduleNextRound(this.settings.intervalMs)
      })
    }, delayMs)
    // unref：不阻止宿主进程退出。
    this.timer?.unref?.()
  }

  /** 停止扫描循环（卸载 effect 与测试显式停止共用）。 */
  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /**
   * 单轮扫描：注册项目工作区 → 扫描 → 计划 → 执行。
   * 整轮抛错不致循环中断（下一轮继续）；单会话迁移失败不中断本轮其余会话。
   */
  async runRound(): Promise<void> {
    if (this.stopped) return
    const registry = this.ctx.workspaceRegistry as DshWorkspaceRegistry
    const persistence = this.ctx.sessionPersistence as DshSessionPersistence
    const log = this.logFacade()
    try {
      await ensureProjectWorkspaces(registry, this.settings.projects, log)
      const entries = await scanSessions(persistence, registry)
      const plan = buildMigrationPlan({
        sessions: entries,
        projects: this.settings.projects,
        quietMs: this.settings.quietMs,
        now: Date.now(),
        migratedSessionIds: readMigratedSessionIds(this.dshHome),
        occupiedTargetSessionDirs: occupiedSessionDirKeys(entries),
      })
      const migrator = new Migrator(persistence, registry, log, this.dshHome)
      for (const item of plan) {
        if (item.kind === 'skip') continue
        await migrator.migrate(item)
      }
    } catch (error) {
      // 整轮级失败（如 list 抛错）：告警，循环继续（下一轮重试）。
      this.logError(`fenix-dsh-session-grouper: 扫描轮失败（下一轮重试）：${errorMessage(error)}`)
    }
  }

  /**
   * 目标占用集：现存产物的会话目录键（`<projectKey>/<sessionSeg>`），
   * 由扫描行聚合；计划层以「目标键被占且非自身现位」判冲突。
   */
  private occupiedTargetDirs(entries: readonly SessionScanEntry[]): Set<string> {
    return occupiedSessionDirKeys(entries)
  }

  /** MigrateLogger 门面（ctx.logger 缺席时退 console，测试假 ctx 友好）。 */
  private logFacade(): MigrateLogger {
    return {
      warn: (m) => this.logWarn(m),
      error: (m) => this.logError(m),
      info: (m) => this.logInfo(m),
    }
  }

  private logWarn(message: string): void {
    try {
      this.ctx.logger.warn('%s', message)
    } catch {
      console.warn(message)
    }
  }

  private logError(message: string): void {
    try {
      this.ctx.logger.error('%s', message)
    } catch {
      console.error(message)
    }
  }

  private logInfo(message: string): void {
    try {
      this.ctx.logger.info('%s', message)
    } catch {
      console.info(message)
    }
  }
}

/** 现存产物的会话目录键集合（扫描行聚合，供计划层目标冲突判定）。 */
function occupiedSessionDirKeys(entries: readonly SessionScanEntry[]): Set<string> {
  const occupied = new Set<string>()
  for (const entry of entries) {
    const key = sessionDirKeyOf(entry.artifactPath)
    if (key !== undefined) occupied.add(key)
  }
  return occupied
}
