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
