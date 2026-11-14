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
 * - 终态回收：client 轮询到终态即停（不 DELETE），终态任务（含 results）会
 *   滞留表内——在写入/读取路径惰性回收超龄（TTL）终态任务并设容量上限，
 *   常驻进程下任务表不无界增长（在途任务不受影响）。
 * - 过程步骤（optimize-session-advanced-search design D5）：推进点经
 *   appendProgress 追加（有界 50 条），GET 快照携带 progress 与
 *   degradedReason（向后兼容可选字段）。
 */
import type { SearchCandidate, SearchJobStatus, SearchPhase, SearchProgressStep, SearchRequest, SearchJobSummary } from '../shared/protocol.js'
import { PROGRESS_MAX_STEPS } from '../shared/protocol.js'

/** 终态集合（状态机迁移门）。 */
const TERMINAL_PHASES: readonly SearchPhase[] = ['done', 'error', 'cancelled']

/** 终态任务滞留 TTL（ms）：超龄惰性回收，防常驻进程任务表无界增长。 */
const TERMINAL_TTL_MS = 60 * 60 * 1000

/** 终态任务容量上限：超限淘汰最老终态任务（在途任务不参与淘汰）。 */
const MAX_TERMINAL_JOBS = 64

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
  /** 过程步骤流（推进点追加，有界保留最近 PROGRESS_MAX_STEPS 条）。 */
  readonly progress: SearchProgressStep[]
  /** 终态打点时刻（epoch ms；写入终态时设置，回收据此判超龄）。 */
  completedAt?: number
  results?: readonly SearchCandidate[]
  degraded?: boolean
  /** degraded=true 时的原因分类（degradedReason 贯通轮询载荷）。 */
  degradedReason?: SearchJobStatus['degradedReason']
  message?: string
}

/** 任务变更监听器（SSE 推送用；参数为发生变更任务的 jobId）。 */
export type JobChangeListener = (jobId: string) => void

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
  /** 变更监听器（SSE 订阅；发射失败隔离，不影响写路径）。 */
  private readonly listeners = new Set<JobChangeListener>()

  constructor(private readonly nextId: JobIdGenerator = defaultJobId) {}

  /**
   * 订阅任务变更（appendProgress/setPhase/complete/fail/cancel 触发）。
   * @returns 退订函数（幂等，重复调用安全）。
   */
  subscribe(listener: JobChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 广播变更（监听器异常逐一吞掉并 warn 一次语义交由调用方日志；写路径永不被打断）。 */
  private emit(jobId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(jobId)
      } catch {
        /* 监听器异常隔离：SSE 断连竞态等不影响任务管线。 */
      }
    }
  }

  /**
   * 新建任务（立即返回，不动任何既有任务——多在途并存）。
   * @param request - 规范化后的搜索请求。
   */
  create(request: SearchRequest): SearchJob {
    this.reclaimTerminalJobs()
    const job: SearchJob = {
      id: this.nextId(),
      request,
      createdAt: Date.now(),
      controller: new AbortController(),
      phase: 'collecting',
      progress: [],
    }
    this.jobs.set(job.id, job)
    return job
  }

  /** 查任务（GET/DELETE 共用；未知 id undefined → 路由层映射 404）。 */
  get(id: string): SearchJob | undefined {
    return this.jobs.get(id)
  }

  /**
   * 追加过程步骤（design D5 推进点记录）：写入时刻打点 + 有界保留最近
   * PROGRESS_MAX_STEPS 条（超出淘汰最旧）。未知 id no-op；终态后步骤不再
   * 变更（轮询端可见状态恒定）。
   */
  appendProgress(id: string, step: string, detail?: string): void {
    const job = this.jobs.get(id)
    if (job === undefined || TERMINAL_PHASES.includes(job.phase)) return
    job.progress.push({ step, ...(detail !== undefined ? { detail } : {}), at: Date.now() })
    if (job.progress.length > PROGRESS_MAX_STEPS) {
      job.progress.splice(0, job.progress.length - PROGRESS_MAX_STEPS)
    }
    this.emit(id)
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
    this.emit(id)
    return 'advanced'
  }

  /**
   * 以完成收尾（done + 结果）。终态幂等：已终态任务保持原终态不变。
   * @param degradedReason - degraded=true 时的原因分类（贯通轮询载荷）。
   * @returns true = 本次生效；false = 任务缺失或已终态。
   */
  complete(id: string, results: readonly SearchCandidate[], degraded: boolean, degradedReason?: SearchJobStatus['degradedReason']): boolean {
    this.reclaimTerminalJobs()
    const job = this.jobs.get(id)
    if (job === undefined || TERMINAL_PHASES.includes(job.phase)) return false
    job.phase = 'done'
    job.completedAt = Date.now()
    job.results = results
    job.degraded = degraded
    if (degraded && degradedReason !== undefined) job.degradedReason = degradedReason
    this.emit(id)
    return true
  }

  /**
   * 以失败收尾（error + 中文原因）。终态幂等：已终态任务保持原终态不变
   * （例：DELETE 先到 → cancelled 不被 error 覆盖）。
   */
  fail(id: string, message: string): boolean {
    this.reclaimTerminalJobs()
    const job = this.jobs.get(id)
    if (job === undefined || TERMINAL_PHASES.includes(job.phase)) return false
    job.phase = 'error'
    job.completedAt = Date.now()
    job.message = message
    this.emit(id)
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
    job.completedAt = Date.now()
    job.controller.abort()
    this.emit(id)
    return 'cancelled'
  }

  /** 任务轮询快照（SearchJobStatus 载荷形状；progress/degradedReason 可选扩展字段）。 */
  status(id: string): SearchJobStatus | undefined {
    this.reclaimTerminalJobs()
    const job = this.jobs.get(id)
    if (job === undefined) return undefined
    return {
      jobId: job.id,
      phase: job.phase,
      results: job.results,
      degraded: job.degraded,
      ...(job.degradedReason !== undefined ? { degradedReason: job.degradedReason } : {}),
      ...(job.progress.length > 0 ? { progress: [...job.progress] } : {}),
      message: job.message,
    }
  }

  /**
   * 全部任务诊断摘要（GET /jobs 列表；创建时间升序）。不携带 results/progress
   * 全量载荷——列表仅用于排障观测（「AI 分析仍然会失败」类反馈的现场还原）。
   */
  list(now: number = Date.now()): SearchJobSummary[] {
    this.reclaimTerminalJobs(now)
    const summaries: SearchJobSummary[] = []
    for (const job of this.jobs.values()) {
      const end = job.completedAt ?? now
      summaries.push({
        jobId: job.id,
        phase: job.phase,
        createdAt: job.createdAt,
        elapsedMs: Math.max(0, end - job.createdAt),
        resultCount: job.results?.length ?? 0,
        ...(job.degraded !== undefined ? { degraded: job.degraded } : {}),
        ...(job.degradedReason !== undefined ? { degradedReason: job.degradedReason } : {}),
        ...(job.message !== undefined ? { message: job.message } : {}),
      })
    }
    summaries.sort((a, b) => a.createdAt - b.createdAt)
    return summaries
  }

  /**
   * 惰性回收终态任务（写入/读取路径进入时调用）：清超龄（TTL）终态任务，
   * 容量超限再淘汰最老终态任务；在途（非终态）任务一律不动。client 轮询到
   * 终态即停（不 DELETE），无此回收则常驻进程任务表随搜索次数无界增长。
   */
  private reclaimTerminalJobs(now: number = Date.now()): void {
    const terminal: { id: string; at: number }[] = []
    for (const [id, job] of this.jobs) {
      if (!TERMINAL_PHASES.includes(job.phase)) continue
      const at = job.completedAt ?? job.createdAt
      if (now - at >= TERMINAL_TTL_MS) this.jobs.delete(id)
      else terminal.push({ id, at })
    }
    const overflow = terminal.length - MAX_TERMINAL_JOBS
    if (overflow > 0) {
      terminal.sort((a, b) => a.at - b.at)
      for (const entry of terminal.slice(0, overflow)) this.jobs.delete(entry.id)
    }
  }

  /** 装卸载清理：abort 全部在途任务并清表（注册/卸载对称）；SSE 订阅一并清空。 */
  dispose(): void {
    for (const job of this.jobs.values()) {
      if (!TERMINAL_PHASES.includes(job.phase)) {
        job.phase = 'cancelled'
        job.controller.abort()
      }
    }
    this.jobs.clear()
    this.listeners.clear()
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
