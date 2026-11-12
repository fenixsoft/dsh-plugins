/**
 * fenix-dsh-session-advanced-search host 半装配（tasks 3.5；loader 入口）。
 *
 * - 插件形态：default export cordis 插件服务类（session-grouper 先例），
 *   loader 按 package.json main（lib/index.js）装载；`dsh.config` 四键经
 *   resolveSettings 解析，非法值装载期显式抛 TypeError（design D7）。
 * - 必选服务缝（`webServer` / `sessionPersistence`）进 `static inject` 声明
 *   （cordis 时序保证 + loader 显式等就绪）；缺失/形态不符 → error 级显式
 *   停用，不注册路由。
 * - 可选服务缝（`sessionController` / `llm` / `agentDefaultModel`）**不进
 *   inject**：放进 inject 会变成硬依赖（宿主裁剪该服务时插件永不激活）；
 *   而未声明 inject 的服务经上下文代理属性访问即抛「cannot get property
 *   without inject」（cordis get 陷阱——BUG-01 根因：属性访问探测恒
 *   undefined → sessionController 标题增强整体失效）。故管线执行期经
 *   safeSeam 以 ctx.get(name)（cordis 免 inject 读取；官方 dsh-schedule
 *   同缝消费姿势）探测，缺失走 collector（header-only）/ analyzer（机械
 *   回退 degraded）的既有降级路径——搜索可用性不受影响。
 * - `enabled=false`：info 级停用（零注册零管线；client 半仍注入入口，
 *   提交将得到 404——dsh client-modules 不下发插件配置，client 无法感知
 *   此开关，README 已知限制条目记录该偏差）。
 * - 注册/卸载对称：ctx.effect 挂清理（路由注销 + jobs.dispose abort 在途）。
 *
 * 任务管线（runJob）：collecting（只读收集+预筛计分）→ filtering →
 * analyzing（LLM 单调用）→ done；整链受 job 的 AbortController 约束
 * （取消即中断，不产出不降级），管线异常 fail 收尾（中文 message）。
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSettings } from '../shared/config.schema.js'
import type { AdvancedSearchConfigInput, AdvancedSearchSettings } from '../shared/config.schema.js'
import type { DshAgentDefaultModel, DshSessionController, DshSessionPersistence, DshLlmRuntime } from '../types/dsh-runtime.js'
import { JobTable } from './jobs.js'
import { collectCandidates } from './collector.js'
import type { CollectorLog } from './collector.js'
import { rankCandidates } from './analyzer.js'
import type { AnalyzerLog } from './analyzer.js'
import { registerSearchRoutes } from './routes.js'

/** 本插件注册为 cordis 服务的名字（诊断/日志定位用）。 */
export const SERVICE_NAME = 'fenix-dsh-session-advanced-search'

/** 服务缝校验结果（显式失败时携带可定位的原因）。 */
export interface SeamCheckResult {
  readonly ok: boolean
  readonly reason?: string
}

/**
 * Host 插件：装载即解析配置、校验必选缝、注册三端点路由；管线在任务创建后
 * 异步执行。
 */
export default class FenixSessionAdvancedSearch extends Service {
  /**
   * cordis 依赖注入声明：loader 等 `webServer` / `sessionPersistence` 就绪
   * 后再 apply 本插件（session-grouper 先例：缺声明的实锾示证为构造期
   * cordis 代理抛 cannot get property → loader entry 未激活）。仅声明必选
   * 缝；可选缝经 safeSeam 运行时探测（见模块头注释）。
   */
  static readonly inject = ['webServer', 'sessionPersistence']

  private readonly settings: AdvancedSearchSettings
  private readonly jobs = new JobTable()
  private readonly webServer: Context['webServer']
  private readonly persistence: DshSessionPersistence
  /** 路由注销 disposer（stop 双保险：ctx.effect 与显式 stop 共用）。 */
  private routesDisposer: (() => void) | undefined
  private stopped = false

  constructor(ctx: Context, config?: AdvancedSearchConfigInput | null) {
    super(ctx, SERVICE_NAME)
    // D7：非法配置装载期显式抛 TypeError（loader 记 entry 激活失败，可定位）。
    this.settings = resolveSettings(config)
    if (!this.settings.enabled) {
      this.logInfo(`${SERVICE_NAME}: enabled=false，停用（不注册路由、不执行管线；client 提交将得到 404）`)
      this.webServer = undefined as unknown as Context['webServer']
      this.persistence = undefined as unknown as DshSessionPersistence
      return
    }
    const seam = this.checkRequiredSeams()
    if (!seam.ok) {
      this.logError(`${SERVICE_NAME}: 依赖缝校验失败，显式停用不注册路由：${seam.reason}`)
      this.webServer = undefined as unknown as Context['webServer']
      this.persistence = undefined as unknown as DshSessionPersistence
      return
    }
    this.webServer = ctx.webServer
    this.persistence = ctx.sessionPersistence
    // 插件卸载（loader 条目移除 / fiber 卸载）时注销路由 + abort 在途任务。
    this.ctx.effect(() => () => this.stop(), `${SERVICE_NAME}: routes + jobs`)
    this.routesDisposer = registerSearchRoutes(this.webServer, {
      jobs: this.jobs,
      runJob: (jobId) => this.runJob(jobId),
      log: { warn: (m) => this.logWarn(m) },
    }).dispose
    this.logInfo(`${SERVICE_NAME}: 已注册 ${'/api/session-advanced-search'} 三端点（maxCandidates=${this.settings.maxCandidates}, topN=${this.settings.topN}, llmTimeoutMs=${this.settings.llmTimeoutMs}）`)
  }

  /** 必选缝存在性与形态校验（error 级显式停用路径）。 */
  private checkRequiredSeams(): SeamCheckResult {
    const webServer: unknown = this.ctx.webServer
    if (webServer === null || typeof webServer !== 'object' || typeof (webServer as { register?: unknown }).register !== 'function') {
      return { ok: false, reason: 'ctx.webServer 缺失或形态不符（dsh-host-webserver 服务缝漂移？）' }
    }
    const persistence: unknown = this.ctx.sessionPersistence
    if (persistence === null || typeof persistence !== 'object' || typeof (persistence as { list?: unknown }).list !== 'function' || typeof (persistence as { open?: unknown }).open !== 'function') {
      return { ok: false, reason: 'ctx.sessionPersistence 缺失或形态不符（dsh-session-persistence 服务缝漂移？）' }
    }
    return { ok: true }
  }

  /** 停止：注销路由 + abort 在途任务清表（幂等；卸载 effect 与测试共用）。 */
  stop(): void {
    this.stopped = true
    if (this.routesDisposer !== undefined) {
      this.routesDisposer()
      this.routesDisposer = undefined
    }
    this.jobs.dispose()
  }

  /**
   * 任务管线（routes POST 后 fire-and-forget 调用）：collector 预筛 →
   * analyzer 排序 → complete/fail 收尾。取消语义：job 被取消（DELETE）时
   * 中断且不产出不降级（终态 cancelled 由任务表置位，complete/fail 的
   * 终态幂等门兜底竞态）。
   */
  private async runJob(jobId: string): Promise<void> {
    if (this.stopped) return
    const job = this.jobs.get(jobId)
    if (job === undefined || job.phase !== 'collecting') return
    const log = this.pipelineLog()
    try {
      const sessionController = safeSeam<DshSessionController>(this.ctx, 'sessionController')
      const llm = safeSeam<DshLlmRuntime>(this.ctx, 'llm')
      const agentDefaultModel = safeSeam<DshAgentDefaultModel>(this.ctx, 'agentDefaultModel')

      const collected = await collectCandidates(
        { persistence: this.persistence, sessionController, log },
        job.request,
        this.settings.maxCandidates,
        job.controller.signal,
      )
      if (job.controller.signal.aborted) return
      // 机械管线（收集+时间过滤+计分截断）完成：filtering → analyzing 两连
      // 推进（状态机逐级合法）；LLM 单调用期间停在 analyzing。
      this.jobs.setPhase(jobId, 'filtering')
      if (job.controller.signal.aborted) return
      this.jobs.setPhase(jobId, 'analyzing')

      const analyzed = await rankCandidates(
        { llm, agentDefaultModel, log, timeoutMs: this.settings.llmTimeoutMs, topN: this.settings.topN },
        job.request.query,
        collected.candidates,
        job.controller.signal,
      )
      if (job.controller.signal.aborted) return
      this.jobs.complete(jobId, analyzed.results, analyzed.degraded)
    } catch (error) {
      if (job.controller.signal.aborted) return
      this.jobs.fail(jobId, `搜索失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** collector/analyzer 共用日志门面（ctx.logger printf 适配；缺席退 console）。 */
  private pipelineLog(): CollectorLog & AnalyzerLog {
    return {
      debug: (m) => this.logDebug(m),
      warn: (m) => this.logWarn(m),
    }
  }

  private logDebug(message: string): void {
    try {
      this.ctx.logger.debug('%s', message)
    } catch {
      console.debug(message)
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

/**
 * 运行时可选缝安全探测（BUG-01 契约注释）：cordis 上下文代理对未声明
 * inject 的服务**属性访问即抛**「cannot get property without inject」（get
 * 陷阱；loader 隔离语境下既使服务已在宿主激活也不豁免——实机复现坐实，
 * 属性访问探测恒 undefined → 标题增强整体失效）。探测 MUST 走
 * `ctx.get(name)`：cordis ReflectService.get「without the inject
 * requirement」，服务未提供或提供方 fiber 未激活时返回 undefined 不抛
 * （官方 dsh-schedule 以 ctx.get("sessionController") 消费同一缝）。
 * 返回 undefined 即走 collector（header-only）/ analyzer（机械回退
 * degraded）既有降级路径。
 */
function safeSeam<T>(ctx: Context, key: 'sessionController' | 'llm' | 'agentDefaultModel'): T | undefined {
  const value: unknown = ctx.get(key)
  return (value ?? undefined) as T | undefined
}
