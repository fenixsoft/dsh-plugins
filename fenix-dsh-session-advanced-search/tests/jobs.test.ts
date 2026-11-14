/**
 * host/jobs 任务表测试：多在途并存、状态机推进、终态幂等、DELETE 取消、
 * 未知 id missing、dispose 清理。
 */
import { describe, expect, it } from 'vitest'
import { JobTable } from '../src/host/jobs.js'
import type { SearchCandidate } from '../src/shared/protocol.js'

/** 定序 jobId 生成器（测试可读断言）。 */
function seqIds(prefix = 'j'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

const REQUEST = { query: '修登录的会话' }

const RESULTS: readonly SearchCandidate[] = [
  {
    sessionId: 's1',
    title: '登录修复',
    workspacePath: '/root/fenixd',
    activityTime: 1000,
    reason: '命中关键词',
    confidence: 0.9,
  },
]

describe('JobTable 多在途并存', () => {
  it('create 不取消既有任务，各自独立 controller', () => {
    const jobs = new JobTable(seqIds())
    const a = jobs.create(REQUEST)
    const b = jobs.create(REQUEST)
    expect(a.id).not.toBe(b.id)
    expect(jobs.inFlightCount()).toBe(2)
    expect(a.controller.signal.aborted).toBe(false)
    expect(b.controller.signal.aborted).toBe(false)
  })
})

describe('JobTable list（诊断摘要）', () => {
  it('创建序升序、终态耗时与结果数可见、degraded 字段按需出现', () => {
    const jobs = new JobTable(seqIds())
    const a = jobs.create(REQUEST)
    const b = jobs.create(REQUEST)
    jobs.setPhase(a.id, 'analyzing')
    jobs.complete(a.id, RESULTS, false)
    jobs.fail(b.id, '调用失败')
    const list = jobs.list()
    expect(list.map((s) => s.jobId)).toEqual([a.id, b.id])
    const done = list[0]!
    expect(done.phase).toBe('done')
    expect(done.resultCount).toBe(RESULTS.length)
    expect(done.degraded).toBe(false)
    expect('degradedReason' in done).toBe(false)
    expect(done.elapsedMs).toBeGreaterThanOrEqual(0)
    const failed = list[1]!
    expect(failed.phase).toBe('error')
    expect(failed.message).toBe('调用失败')
    expect(failed.resultCount).toBe(0)
  })
})

describe('JobTable 状态机', () => {
  it('按 collecting→filtering→analyzing 顺序推进', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    expect(jobs.setPhase(job.id, 'analyzing')).toBe('noop') // 跳级拒绝
    expect(jobs.setPhase(job.id, 'filtering')).toBe('advanced')
    expect(jobs.setPhase(job.id, 'analyzing')).toBe('advanced')
    expect(jobs.status(job.id)?.phase).toBe('analyzing')
  })

  it('回退迁移拒绝（noop）', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.setPhase(job.id, 'filtering')
    expect(jobs.setPhase(job.id, 'collecting')).toBe('noop')
    expect(jobs.status(job.id)?.phase).toBe('filtering')
  })

  it('终态后 phase 迁移幂等 no-op，状态恒定', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.complete(job.id, RESULTS, false)
    expect(jobs.setPhase(job.id, 'analyzing')).toBe('noop')
    expect(jobs.complete(job.id, [], true)).toBe(false)
    expect(jobs.fail(job.id, 'x')).toBe(false)
    const status = jobs.status(job.id)
    expect(status?.phase).toBe('done')
    expect(status?.results).toEqual(RESULTS)
    expect(status?.degraded).toBe(false)
  })
})

describe('JobTable complete/fail', () => {
  it('complete 置 done + 结果 + degraded', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    expect(jobs.complete(job.id, RESULTS, true)).toBe(true)
    const status = jobs.status(job.id)
    expect(status?.phase).toBe('done')
    expect(status?.degraded).toBe(true)
  })

  it('fail 置 error + message', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.fail(job.id, '收集失败')
    expect(jobs.status(job.id)).toMatchObject({ phase: 'error', message: '收集失败' })
  })

  it('cancelled 优先于迟到的 error（终态不被覆盖）', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.cancel(job.id)
    expect(jobs.fail(job.id, '迟到失败')).toBe(false)
    expect(jobs.status(job.id)?.phase).toBe('cancelled')
  })
})

describe('JobTable cancel（DELETE 语义）', () => {
  it('取消在途任务：置 cancelled 并 abort controller', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    expect(jobs.cancel(job.id)).toBe('cancelled')
    expect(job.controller.signal.aborted).toBe(true)
    expect(jobs.status(job.id)?.phase).toBe('cancelled')
  })

  it('未知 id missing（路由层映射 404）', () => {
    const jobs = new JobTable(seqIds())
    expect(jobs.get('nope')).toBeUndefined()
    expect(jobs.status('nope')).toBeUndefined()
    expect(jobs.cancel('nope')).toBe('missing')
  })

  it('重复取消幂等 noop', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    expect(jobs.cancel(job.id)).toBe('cancelled')
    expect(jobs.cancel(job.id)).toBe('noop')
  })
})

describe('JobTable dispose', () => {
  it('abort 全部在途任务并清表；终态任务不再改动', () => {
    const jobs = new JobTable(seqIds())
    const live = jobs.create(REQUEST)
    const done = jobs.create(REQUEST)
    jobs.complete(done.id, RESULTS, false)
    jobs.dispose()
    expect(live.controller.signal.aborted).toBe(true)
    expect(jobs.get(live.id)).toBeUndefined()
    expect(jobs.inFlightCount()).toBe(0)
  })
})

describe('JobTable progress 推进（optimize 轮 2.5）', () => {
  it('appendProgress 追加步骤（at 打点、detail 可选），status 按序携带 progress', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.appendProgress(job.id, 'collecting', '关键词：登录')
    jobs.appendProgress(job.id, 'filtering', '候选 10→3')
    jobs.appendProgress(job.id, 'analyzing') // 无 detail 合法
    const progress = jobs.status(job.id)?.progress
    expect(progress?.map((step) => step.step)).toEqual(['collecting', 'filtering', 'analyzing'])
    expect(progress?.[0]).toMatchObject({ step: 'collecting', detail: '关键词：登录' })
    expect(progress?.[2]).toEqual({ step: 'analyzing', at: expect.any(Number) })
    expect(progress?.every((step) => Number.isFinite(step.at) && step.at > 0)).toBe(true)
  })

  it('有界保留最近 50 条（超限淘汰最旧）', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    for (let i = 0; i < 55; i += 1) jobs.appendProgress(job.id, `step-${i}`)
    const progress = jobs.status(job.id)?.progress ?? []
    expect(progress).toHaveLength(50)
    expect(progress[0]?.step).toBe('step-5')
    expect(progress[49]?.step).toBe('step-54')
  })

  it('终态后 appendProgress no-op（轮询端可见状态恒定）', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.appendProgress(job.id, 'collecting', '关键词：登录')
    jobs.complete(job.id, RESULTS, false)
    jobs.appendProgress(job.id, 'done', '迟到步骤')
    const progress = jobs.status(job.id)?.progress ?? []
    expect(progress).toHaveLength(1)
    expect(progress[0]?.step).toBe('collecting')
  })

  it('未知 id appendProgress no-op 不抛', () => {
    const jobs = new JobTable(seqIds())
    expect(() => jobs.appendProgress('ghost', 'collecting')).not.toThrow()
  })
})

describe('JobTable GET 载荷新字段（optimize 轮 2.5）', () => {
  it('complete 带第四参 degradedReason → status 透传', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.complete(job.id, RESULTS, true, 'credential-missing')
    expect(jobs.status(job.id)).toMatchObject({ degraded: true, degradedReason: 'credential-missing' })
  })

  it('degraded=false 时不产出 degradedReason 键', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.complete(job.id, RESULTS, false, 'timeout')
    const status = jobs.status(job.id)
    expect(status?.degraded).toBe(false)
    expect(status?.degradedReason).toBeUndefined()
    expect('degradedReason' in (status ?? {})).toBe(false)
  })

  it('progress 为空时 status 不含 progress 键（向后兼容可选字段）', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.complete(job.id, RESULTS, false)
    const status = jobs.status(job.id)
    expect('progress' in (status ?? {})).toBe(false)
  })

  it('status 返回 progress 副本（外部改动不影响表内记录）', () => {
    const jobs = new JobTable(seqIds())
    const job = jobs.create(REQUEST)
    jobs.appendProgress(job.id, 'collecting', '关键词：登录')
    const first = [...(jobs.status(job.id)?.progress ?? [])]
    first.push({ step: 'hacked', at: 0 })
    const second = jobs.status(job.id)?.progress ?? []
    expect(second).toHaveLength(1)
    expect(second[0]?.step).toBe('collecting')
  })
})

describe('JobTable 变更订阅（SSE 推送面）', () => {
  it('appendProgress/setPhase/complete/fail/cancel 均以 jobId 触发监听器', () => {
    const jobs = new JobTable(seqIds())
    const seen: string[] = []
    jobs.subscribe((id) => seen.push(id))
    const job = jobs.create(REQUEST)
    jobs.appendProgress(job.id, 'collecting', '关键词：登录')
    jobs.setPhase(job.id, 'filtering')
    jobs.complete(job.id, RESULTS, false)
    expect(seen).toEqual([job.id, job.id, job.id])
    // 终态后 fail/cancel 不再变更 → 不触发。
    jobs.fail(job.id, 'x')
    jobs.cancel(job.id)
    expect(seen).toEqual([job.id, job.id, job.id])
  })

  it('退订后不再接收；监听器抛错被隔离、写路径不受影响', () => {
    const jobs = new JobTable(seqIds())
    const seen: string[] = []
    const unsubscribe = jobs.subscribe((id) => seen.push(id))
    const job = jobs.create(REQUEST)
    jobs.appendProgress(job.id, 'collecting')
    unsubscribe()
    unsubscribe() // 幂等
    jobs.setPhase(job.id, 'filtering')
    expect(seen).toEqual([job.id])
    jobs.subscribe(() => {
      throw new Error('listener boom')
    })
    expect(() => jobs.appendProgress(job.id, 'analyzing')).not.toThrow()
    expect(jobs.get(job.id)?.progress).toHaveLength(2)
  })

  it('dispose 清空监听器（卸载后无泄漏发射）', () => {
    const jobs = new JobTable(seqIds())
    const seen: string[] = []
    jobs.subscribe((id) => seen.push(id))
    const job = jobs.create(REQUEST)
    jobs.dispose()
    jobs.appendProgress(job.id, 'collecting') // 任务已清，no-op
    expect(seen).toEqual([])
  })
})
