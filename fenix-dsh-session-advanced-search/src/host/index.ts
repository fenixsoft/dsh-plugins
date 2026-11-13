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
 * 推进点经 JobTable.appendProgress 记录过程步骤（design D5）：collecting
 * 开始（关键词）、filtering 完成（候选 N→M + 工作区分布）、analyzing 开始
 * （provider·model·候选数）、完成（置信度摘要或降级原因）。
 *
 * 凭证预检（design D2）：credentialProbe 装配——credential-ref（apiKeyEnv）
 * 读取按 dsh 0.2.2-rc.1 实测缝自守：优先 llm 运行时对象上的 providers 投影
 * （官方未来加缝兼容），缺失回退 dsh 凭证引用命名约定
 * `<ROUTE 大写蛇形>_API_KEY`（cc-import deriveApiKeyEnv 同规则、官方
 * dsh-llm-deepseek-api-key 先例 DEEPSEEK_API_KEY）；凭证存在性 = 进程环境
 * 非空 **或** ctx.credentials 凭据库已配置（Models 页写入路径）——两处都不
 * 在才判缺失；缝/形状漂移 → warn 一次返回 true 跳过预检（不误杀，由
 * analyzer D1 超时硬解耦兜底）。凭据库为异步 resolve，而 probe 缝为同步
 * 布尔——runJob 在发起分析前按路由 provider 异步预热快照，probe 读快照。
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSettings } from '../shared/config.schema.js'
import type { AdvancedSearchConfigInput, AdvancedSearchSettings } from '../shared/config.schema.js'
import type { DshAgentDefaultModel, DshSessionController, DshSessionPersistence, DshLlmRuntime } from '../types/dsh-runtime.js'
import { JobTable } from './jobs.js'
import { collectCandidates, tokenize } from './collector.js'
import type { CollectorLog, CollectStats, PrefilteredSession } from './collector.js'
import { rankCandidates, resolveRoute } from './analyzer.js'
import type { AnalyzerLog, AnalyzerDeps, AnalyzerRoute, AnalysisOutcome } from './analyzer.js'
import { registerSearchRoutes } from './routes.js'
import { registerPageRoute, PAGE_ROUTE } from './page.js'
import { UI_TEXT } from '../shared/protocol.js'

/** 本插件注册为 cordis 服务的名字（诊断/日志定位用）。 */
export const SERVICE_NAME = 'fenix-dsh-session-advanced-search'

/** ctx.credentials 凭据缝最小被消费面（dsh-credentials CredentialProvider 子集；可选缝）。 */
interface CredentialSeamFace {
  resolve(ref: string): Promise<{ readonly value?: unknown } | undefined>
}

/** dsh 凭证引用命名约定派生：route id → 大写蛇形 + `_API_KEY`（cc-import deriveApiKeyEnv 同规则）。 */
export function deriveCredentialRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

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
  /** 凭据库存在性快照（ref → 已配置？；runJob 发起分析前按路由 provider 预热）。 */
  private readonly credentialStore = new Map<string, boolean>()
  /** 形状漂移 warn 限流（一次）。 */
  private credentialShapeWarned = false
  /** 路由注销 disposer（stop 双保险：ctx.effect 与显式 stop 共用）。 */
  private routesDisposer: (() => void) | undefined
  private pageRouteDisposer: (() => void) | undefined
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
    // 独立高级搜索页（转向轮 m00937：不再注入会话界面，入口为本页 URL）。
    this.pageRouteDisposer = registerPageRoute(this.webServer, { log: { warn: (m) => this.logWarn(m) } }).dispose
    this.logInfo(`${SERVICE_NAME}: 已注册 /api/session-advanced-search 三端点与独立页 ${PAGE_ROUTE}（maxCandidates=${this.settings.maxCandidates}, topN=${this.settings.topN}, llmTimeoutMs=${this.settings.llmTimeoutMs}${this.settings.analyzeRoute !== undefined ? `, analyzeRoute=${this.settings.analyzeRoute.provider}/${this.settings.analyzeRoute.model}` : ''}）`)
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
    if (this.pageRouteDisposer !== undefined) {
      this.pageRouteDisposer()
      this.pageRouteDisposer = undefined
    }
    this.jobs.dispose()
  }

  /**
   * 任务管线（routes POST 后 fire-and-forget 调用）：collector 预筛 →
   * analyzer 排序 → complete/fail 收尾。取消语义：job 被取消（DELETE）时
   * 中断且不产出不降级（终态 cancelled 由任务表置位，complete/fail 的
   * 终态幂等门兜底竞态）。推进点（design D5）：collecting 开始（关键词）/
   * filtering 完成（候选 N→M + 工作区分布）/ analyzing 开始
   * （provider·model·候选数）/ 完成（置信度摘要或降级原因）。
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

      // 分析依赖（含 analyzeRoute 透传与凭证预检缝，design D2）；路由在管线
      // 发起前解析（2.2 暴露面），analyzing 步骤 detail 与凭证预热同源取用。
      const analyzerDeps: AnalyzerDeps = {
        llm,
        agentDefaultModel,
        log,
        timeoutMs: this.settings.llmTimeoutMs,
        topN: this.settings.topN,
        credentialProbe: this.createCredentialProbe(),
        ...(this.settings.analyzeRoute !== undefined ? { routeOverride: this.settings.analyzeRoute } : {}),
      }
      const route = resolveRoute(analyzerDeps)
      if (route !== undefined) await this.warmCredential(route.provider)
      if (job.controller.signal.aborted) return

      // collecting 开始：detail = 解析出的关键词（机械预筛计分同源 tokenize）。
      this.jobs.appendProgress(jobId, 'collecting', keywordDetail(job.request.query))
      const collected = await collectCandidates(
        { persistence: this.persistence, sessionController, log },
        job.request,
        this.settings.maxCandidates,
        job.controller.signal,
      )
      if (job.controller.signal.aborted) return
      // filtering 完成：detail = 候选 N→M + 工作区分布摘要。
      this.jobs.appendProgress(jobId, 'filtering', filterDetail(collected.stats, collected.candidates))
      // 机械管线（收集+时间过滤+计分截断）完成：filtering → analyzing 两连
      // 推进（状态机逐级合法）；LLM 单调用期间停在 analyzing。
      this.jobs.setPhase(jobId, 'filtering')
      if (job.controller.signal.aborted) return
      this.jobs.setPhase(jobId, 'analyzing')
      // analyzing 开始：detail = provider·model·候选数（route 未解析时机械排序）。
      this.jobs.appendProgress(jobId, 'analyzing', analyzingDetail(route, collected.candidates.length))

      const analyzed = await rankCandidates(analyzerDeps, job.request.query, collected.candidates, job.controller.signal)
      if (job.controller.signal.aborted) return
      // 完成：detail = 置信度摘要或降级原因（credential-missing 附凭证引用）。
      this.jobs.appendProgress(jobId, 'done', doneDetail(analyzed, route, (provider) => this.readCredentialRef(provider)))
      this.jobs.complete(jobId, analyzed.results, analyzed.degraded, analyzed.degradedReason)
    } catch (error) {
      if (job.controller.signal.aborted) return
      this.jobs.fail(jobId, `搜索失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 构造凭证预检缝（design D2）：credential-ref 读取（llm 投影 → 命名约定
   * 派生），进程环境非空或凭据库快照已配置才放行；ref 不可得 / 快照未预热
   * 返回 true（不误杀，由 analyzer 超时硬解耦兜底）。
   */
  private createCredentialProbe(): (provider: string) => boolean {
    return (provider: string): boolean => {
      const ref = this.readCredentialRef(provider)
      if (ref === undefined) return true
      const env = process.env[ref]
      if (typeof env === 'string' && env.length > 0) return true
      // 进程环境无值：查凭据库快照（runJob 已按路由预热；未预热视为未知）。
      return this.credentialStore.get(ref) ?? true
    }
  }

  /**
   * 读路由 provider 的 credential-ref（apiKeyEnv）：llm 运行时对象上的
   * providers 投影优先（官方未来加缝兼容；profile 在位但无 apiKeyEnv 时不做
   * 命名猜测，undefined = 不误杀），投影缺失回退 dsh 凭证引用命名约定。
   */
  private readCredentialRef(provider: string): string | undefined {
    const llm: unknown = safeSeam<DshLlmRuntime>(this.ctx, 'llm')
    if (llm !== null && typeof llm === 'object' && 'providers' in llm) {
      const providers = (llm as { providers?: unknown }).providers
      if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
        if (!this.credentialShapeWarned) {
          this.credentialShapeWarned = true
          this.logWarn(`session-advanced-search: llm providers 投影形状漂移（非对象），凭证预检回退命名约定派生`)
        }
      } else {
        const profile = (providers as Record<string, unknown>)[provider]
        if (profile !== null && typeof profile === 'object') {
          const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
          if (typeof ref === 'string' && ref.length > 0) return ref
          return undefined
        }
      }
    }
    return deriveCredentialRef(provider)
  }

  /**
   * 按路由 provider 预热凭据库快照（probe 缝为同步布尔，凭据库 resolve 为
   * 异步——runJob 发起分析前 await 预热，probe 读快照零阻塞）。进程环境已
   * 配置的直接置 true 不查库；无凭据缝时环境即唯一凭证来源（置 false）；
   * resolve 异常移除快照让 probe 返回 true 跳过预检（不误杀）。
   */
  private async warmCredential(provider: string | undefined): Promise<void> {
    if (provider === undefined || provider.length === 0) return
    const ref = this.readCredentialRef(provider)
    if (ref === undefined) return
    const env = process.env[ref]
    if (typeof env === 'string' && env.length > 0) {
      this.credentialStore.set(ref, true)
      return
    }
    const credentials = safeSeam<CredentialSeamFace>(this.ctx, 'credentials')
    if (credentials === undefined || typeof credentials.resolve !== 'function') {
      this.credentialStore.set(ref, false)
      return
    }
    try {
      const resolved = await credentials.resolve(ref)
      const value = resolved?.value
      this.credentialStore.set(ref, typeof value === 'string' && value.length > 0)
    } catch (error) {
      this.credentialStore.delete(ref)
      this.logWarn(`session-advanced-search: 凭据库查询失败（ref=${ref}），跳过凭证预检：${error instanceof Error ? error.message : String(error)}`)
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
function safeSeam<T>(ctx: Context, key: 'sessionController' | 'llm' | 'agentDefaultModel' | 'credentials'): T | undefined {
  const value: unknown = ctx.get(key)
  return (value ?? undefined) as T | undefined
}

/** collecting 步骤 detail：解析出的关键词列表（机械预筛计分同源 tokenize）。 */
function keywordDetail(query: string): string {
  const tokens = tokenize(query)
  return tokens.length > 0 ? `关键词：${tokens.join(' / ')}` : '全文描述匹配（无可切分关键词）'
}

/** filtering 步骤 detail：候选 N→M + 工作区分布摘要（候选集按 workspacePath 计数，Top3）。 */
function filterDetail(stats: CollectStats, candidates: readonly PrefilteredSession[]): string {
  const counts = new Map<string, number>()
  for (const row of candidates) {
    const key = row.workspacePath === '' ? '（未归组）' : row.workspacePath
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const distribution = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([workspace, count]) => `${workspace} ×${count}`)
    .join(' · ')
  return `候选 ${stats.total}→${stats.afterScoring}${distribution.length > 0 ? `（${distribution}）` : ''}`
}

/** analyzing 步骤 detail：provider·model·候选数（route 未解析时如实标注）。 */
function analyzingDetail(route: AnalyzerRoute | undefined, candidateCount: number): string {
  const routePart = route !== undefined ? `${route.provider} · ${route.model}` : '路由未解析'
  return `调用 AI 语义分析 · ${routePart} · ${candidateCount} 个候选`
}

/** done 步骤 detail：置信度摘要或降级原因（credential-missing 附凭证引用，design D2 文案要素）。 */
function doneDetail(outcome: AnalysisOutcome, route: AnalyzerRoute | undefined, readRef: (provider: string) => string | undefined): string {
  if (outcome.degraded && outcome.degradedReason !== undefined) {
    const reasonText = UI_TEXT.degradedReasonText[outcome.degradedReason]
    if (outcome.degradedReason === 'credential-missing') {
      const ref = route !== undefined ? readRef(route.provider) : undefined
      return `降级：${reasonText}（凭证引用 ${ref ?? '未知'} 未配置）`
    }
    return `降级：${reasonText}`
  }
  if (outcome.results.length === 0) return '完成：无匹配候选'
  const maxConfidence = Math.max(...outcome.results.map((row) => row.confidence))
  return `完成：${outcome.results.length} 个候选 · 置信度最高 ${Math.round(maxConfidence * 100)}%`
}
