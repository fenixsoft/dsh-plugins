/**
 * host 半进程内任务表（design D6）。
 *
 * - `Map<jobId, Job>` + 每 job 独立 AbortController；**支持多在途任务并存**
 *   （跨标签页天然隔离）——「同一 client 单在途、重复提交取消旧任务」语义由
 *   client 半保证（提交前 DELETE 旧任务），host 不做隐式取消。
 * - 状态机：collecting → filtering → analyzing → done | error | cancelled；
 *   终态（done/error/cancelled）幂等——终态后的 phase 迁移/取消/收尾一律
 *   no-op，轮询端可见状态恒定。
 * - 不跨重启持久：弹窗内等待语义，重启丢任务可接受（client 轮询 404 即按
 *   error 收尾）。
 */
import type { SearchCandidate, SearchJobStatus, SearchPhase, SearchRequest } from '../shared/protocol.js'

/** 终态集合（状态机迁移门）。 */
const TERMINAL_PHASES: readonly SearchPhase[] = ['done', 'error', 'cancelled']

/** 单条分析任务记录。 */
export interface SearchJob {
  readonly id: string
  /** 规范化后的请求（query 已 trim）。 */
  readonly request: SearchRequest
  /** 创建时刻（epoch ms）。 */
  readonly createdAt: number
  /** 取消通道（collector/analyzer 全程监听）。 */
  readonly controller: AbortController
  phase: SearchPhase
  results?: readonly SearchCandidate[]
  degraded?: boolean
  message?: string
}

/** 取消结果：missing=任务不存在；noop=已终态（幂等）；cancelled=本次取消。 */
export type CancelOutcome = 'missing' | 'noop' | 'cancelled'

/** 阶段迁移结果：missing / noop（终态或非法前驱）/ advanced。 */
export type TransitionOutcome = 'missing' | 'noop' | 'advanced'

/** 非终态推进的合法前驱（状态机表）。 */
const PHASE_ORDER: readonly SearchPhase[] = ['collecting', 'filtering', 'analyzing']

/** jobId 生成器注入面（测试钉住序列）。 */
export type JobIdGenerator = () => string

/** 进程内任务表。 */
export class JobTable {
  private readonly jobs = new Map<string, JobRecord>()

  constructor(private readonly nextId: JobIdGenerator = defaultJobId) {}

  /**
   * 新建任务（立即返回，不动任何既有任务——多在途并存）。
   * @param request - 规范化后的搜索请求。
   */
  create(request: SearchRequest): SearchJob {
    const job: SearchJob = {
      id: this.nextId(),
      request,
      createdAt: Date.now(),
      controller: new AbortController(),
      phase: 'collecting',
    }
    this.jobs.set(job.id, job)
    return job
  }

  /** 查任务（GET/DELETE 共用；未知 id undefined → 路由层映射 404）。 */
  get(id: string): SearchJob | undefined {
    return this.jobs.get(id)
  }

  /** 当前在途（非终态）任务数（可观测）。 */
  inFlightCount(): number {
    let count = 0
    for (const job of this.jobs.values()) {
      if (!TERMINAL_PHASES.includes(job.phase)) count += 1
    }
    return count
  }

  /** 推进非终态阶段（状态机表校验前驱；终态/未知 id 幂等 no-op）。 */
  setPhase(id: string, phase: SearchPhase): TransitionOutcome {
    const job = this.jobs.get(id)
    if (job === undefined) return 'missing'
    if (TERMINAL_PHASES.includes(job.phase)) return 'noop'
    const from = PHASE_ORDER.indexOf(job.phase)
    const to = PHASE_ORDER.indexOf(phase)
    // 非法迁移（终态目标 / 回退 / 跳级）：no-op，调用方异常路径各自走 fail()。
    if (to < 0 || to !== from + 1) return 'noop'
    job.phase = phase
    return 'advanced'
  }

  /**
   * 以完成收尾（done + 结果）。终态幂等：已终态任务保持原终态不变。
   * @returns true = 本次生效；false = 任务缺失或已终态。
   */
  complete(id: string, results: readonly SearchCandidate[], degraded: boolean): boolean {
    const job = this.jobs.get(id)
    if (job === undefined || TERMINAL_PHASES.includes(job.phase)) return false
    job.phase = 'done'
    job.results = results
    job.degraded = degraded
    return true
  }

  /**
   * 以失败收尾（error + 中文原因）。终态幂等：已终态任务保持原终态不变
   * （例：DELETE 先到 → cancelled 不被 error 覆盖）。
   */
  fail(id: string, message: string): boolean {
    const job = this.jobs.get(id)
    if (job === undefined || TERMINAL_PHASES.includes(job.phase)) return false
    job.phase = 'error'
    job.message = message
    return true
  }

  /**
   * 取消任务：abort 其 controller（管线异常路径据此提前退出）并置 cancelled。
   * 幂等：已终态任务不再改状态（noop），未知 id missing（路由层映射 404）。
   */
  cancel(id: string): CancelOutcome {
    const job = this.jobs.get(id)
    if (job === undefined) return 'missing'
    if (TERMINAL_PHASES.includes(job.phase)) return 'noop'
    job.phase = 'cancelled'
    job.controller.abort()
    return 'cancelled'
  }

  /** 任务轮询快照（SearchJobStatus 载荷形状）。 */
  status(id: string): SearchJobStatus | undefined {
    const job = this.jobs.get(id)
    if (job === undefined) return undefined
    return {
      jobId: job.id,
      phase: job.phase,
      results: job.results,
      degraded: job.degraded,
      message: job.message,
    }
  }

  /** 装卸载清理：abort 全部在途任务并清表（注册/卸载对称）。 */
  dispose(): void {
    for (const job of this.jobs.values()) {
      if (!TERMINAL_PHASES.includes(job.phase)) {
        job.phase = 'cancelled'
        job.controller.abort()
      }
    }
    this.jobs.clear()
  }
}

/** 内部记录别名（Map 值类型与 SearchJob 同形）。 */
type JobRecord = SearchJob

/** 模块级序号（defaultJobId 用；同毫秒内多任务去重）。 */
let jobSeq = 0

/** 默认 jobId：时间前缀 + 进程内序号（可读、无外部依赖）。 */
function defaultJobId(): string {
  jobSeq += 1
  return `job-${Date.now().toString(36)}-${jobSeq.toString(36)}`
}
