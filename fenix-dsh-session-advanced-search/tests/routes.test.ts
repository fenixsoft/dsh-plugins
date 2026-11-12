/**
 * host/routes 三端点契约测试（桩 webServer.register 缝对账）：
 * 座位注册形状（exact 集合 + prefix 动态）、POST 建任务立即返回 jobId（校验
 * 400/405/超限）、GET 轮询 phase/results/degraded 可见性、DELETE 取消（幂等/
 * 未知 404）、runJob 异常兜底 fail、注册/卸载对称。
 */
import { describe, expect, it } from 'vitest'
import { JOBS_PATH } from '../src/shared/protocol.js'
import { MAX_BODY_BYTES, registerSearchRoutes } from '../src/host/routes.js'
import { JobTable } from '../src/host/jobs.js'
import type { WebRequest, WebResponse } from '../src/types/dsh-runtime.js'

/** 最小事件发射器（data/end 记账）。 */
class FakeReq implements WebRequest {
  // 实现签名用 any 入参收编三种事件监听形态，保证与 WebRequest 各重载双向兼容。
  private readonly listeners = new Map<string, ((chunk: any) => void)[]>()
  readonly headers: Record<string, string> = {}
  ended = false

  constructor(
    readonly method: string,
    readonly url: string,
  ) {}

  on(event: 'data', listener: (chunk: Buffer | string) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: string, listener: (chunk: any) => void): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): this {
    const list = this.listeners.get(event) ?? []
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
    return this
  }

  emitData(chunk: Buffer): void {
    for (const listener of this.listeners.get('data') ?? []) listener(chunk)
  }

  emitEnd(): void {
    this.ended = true
    for (const listener of this.listeners.get('end') ?? []) listener(Buffer.alloc(0))
  }
}

/** 响应记账桩。 */
class FakeRes implements WebResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''

  writeHead(status: number, headers?: Record<string, string>): this {
    this.status = status
    this.headers = headers ?? {}
    return this
  }

  end(payload?: string): this {
    this.body = payload ?? ''
    return this
  }

  json(): unknown {
    return JSON.parse(this.body)
  }
}

/**
 * webServer.register 桩：座位表记账 + 分发忠实镜像 dsh-host-webserver `match()`
 * 语义——exact 表命中优先，prefix 表按 `pathname === prefix ||
 * startsWith(prefix + '/')` 匹配、最长前缀胜出（带尾斜杠座位令深层路径永不
 * 命中——验证轮 BUG-01 的回归防线，禁止放宽为宽松 startsWith）。
 */
class StubWebServer {
  readonly seats = new Map<string, { kind: string; path: string; handler: (req: WebRequest, res: WebResponse) => void | Promise<void> }>()

  register(route: { kind: 'exact' | 'prefix' | 'fallback'; path: string; handler: (req: WebRequest, res: WebResponse) => void | Promise<void> }): () => void {
    const key = `${route.kind}:${route.path}`
    this.seats.set(key, route)
    return () => {
      this.seats.delete(key)
    }
  }

  dispatch(req: FakeReq, res: FakeRes): void | Promise<void> {
    const exact = this.seats.get(`exact:${req.url}`)
    if (exact !== undefined) return exact.handler(req, res)
    let best: { kind: string; path: string; handler: (req: WebRequest, res: WebResponse) => void | Promise<void> } | undefined
    for (const seat of this.seats.values()) {
      if (seat.kind !== 'prefix') continue
      if (req.url !== seat.path && !req.url.startsWith(`${seat.path}/`)) continue
      if (best === undefined || seat.path.length > best.path.length) best = seat
    }
    if (best !== undefined) return best.handler(req, res)
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":"no route"}')
    return undefined
  }
}

/** 组装被测路由（确定性 jobId 序列 + runJob 台账）。 */
function setup(): {
  server: StubWebServer
  jobs: JobTable
  runJobs: string[]
  setRunJob: (impl: (jobId: string) => Promise<void>) => void
  dispatch: (method: string, url: string, body?: string) => Promise<FakeRes>
} {
  const server = new StubWebServer()
  let seq = 0
  const jobs = new JobTable(() => `job-${(seq += 1)}`)
  const runJobs: string[] = []
  let runJobImpl: (jobId: string) => Promise<void> = () => Promise.resolve()
  registerSearchRoutes(server, {
    jobs,
    runJob: (jobId) => {
      runJobs.push(jobId)
      return runJobImpl(jobId)
    },
    log: { warn: () => {} },
  })
  const dispatch = async (method: string, url: string, body?: string): Promise<FakeRes> => {
    const req = new FakeReq(method, url)
    const res = new FakeRes()
    const handled = server.dispatch(req, res)
    if (body !== undefined) req.emitData(Buffer.from(body, 'utf8'))
    req.emitEnd()
    await handled
    return res
  }
  return { server, jobs, runJobs, setRunJob: (impl) => (runJobImpl = impl), dispatch }
}

describe('路由注册对账', () => {
  it('两个座位：exact 任务集合 + prefix 动态项；dispose 后座位清空', () => {
    const { server } = setup()
    expect([...server.seats.keys()].sort()).toEqual([`exact:${JOBS_PATH}`, `prefix:${JOBS_PATH}`].sort())
    // webServer.register 返回的 disposer 均被汇总。
    const { server: server2 } = setup()
    const registered = registerSearchRoutes(server2, { jobs: new JobTable(), runJob: () => Promise.resolve(), log: { warn: () => {} } })
    registered.dispose()
    expect(server2.seats.size).toBe(0)
  })

  it('prefix 座位 path 无尾斜杠（dsh-host-webserver prefix 契约，BUG-01 回归）', () => {
    const { server } = setup()
    const prefixSeat = server.seats.get(`prefix:${JOBS_PATH}`)
    expect(prefixSeat).toBeDefined()
    expect(prefixSeat?.path).toBe(JOBS_PATH)
    expect(prefixSeat?.path.endsWith('/')).toBe(false)
  })

  it('深层路径 /jobs/:id 经忠实分发命中 prefix 座位（404 出自 handler 而非分发兜底）', async () => {
    const { dispatch } = setup()
    const created = await dispatch('POST', JOBS_PATH, JSON.stringify({ query: 'q' }))
    const { jobId } = created.json() as { jobId: string }
    // 命中 prefix 座位的铁证：未知 id 的 404 出自路由 handler（job not found）而非
    // 分发桩兜底（no route）——尾斜杠座位下深层路径会落兜底（验证轮 BUG-01 形态）。
    const unknownRes = await dispatch('GET', `${JOBS_PATH}/ghost`)
    expect(unknownRes.status).toBe(404)
    expect(unknownRes.json()).toEqual({ error: 'job not found' })
    const knownRes = await dispatch('GET', `${JOBS_PATH}/${jobId}`)
    expect(knownRes.status).toBe(200)
    expect(knownRes.json()).toMatchObject({ jobId, phase: 'collecting' })
  })
})

describe('POST /jobs 建任务', () => {
  it('合法载荷 → 200 {jobId}，任务入库且 runJob 被异步触发', async () => {
    const { jobs, runJobs, dispatch } = setup()
    const res = await dispatch('POST', JOBS_PATH, JSON.stringify({ query: '  登录调试  ', timeRange: { start: 1, end: 2 } }))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.headers['cache-control']).toBe('no-store')
    const { jobId } = res.json() as { jobId: string }
    expect(jobId).toBe('job-1')
    const job = jobs.get(jobId)
    expect(job?.request).toEqual({ query: '登录调试', timeRange: { start: 1, end: 2 } })
    expect(job?.phase).toBe('collecting')
    // 立即返回语义：响应已写出，管线异步触发。
    expect(runJobs).toEqual([jobId])
  })

  it('空白 query / 非法 timeRange / 非对象载荷 → 400 且不建任务', async () => {
    const { jobs, dispatch } = setup()
    for (const body of [
      JSON.stringify({ query: '   ' }),
      JSON.stringify({ query: 'x', timeRange: { start: 5, end: 5 } }),
      JSON.stringify({ query: 'x', timeRange: { start: -1, end: 5 } }),
      'null',
      '["query"]',
    ]) {
      const res = await dispatch('POST', JOBS_PATH, body)
      expect(res.status, body).toBe(400)
      expect((res.json() as { error: string }).error).toBeTypeOf('string')
    }
    expect(jobs.inFlightCount()).toBe(0)
  })

  it('坏 JSON / 超限 body → 400', async () => {
    const { dispatch } = setup()
    const bad = await dispatch('POST', JOBS_PATH, '{not json')
    expect(bad.status).toBe(400)
    expect((bad.json() as { error: string }).error).toContain('invalid request body')
    const oversized = await dispatch('POST', JOBS_PATH, 'x'.repeat(MAX_BODY_BYTES + 1))
    expect(oversized.status).toBe(400)
    expect((oversized.json() as { error: string }).error).toContain('exceeds')
  })

  it('集合端点非 POST → 405', async () => {
    const { dispatch } = setup()
    expect((await dispatch('GET', JOBS_PATH)).status).toBe(405)
    expect((await dispatch('DELETE', JOBS_PATH)).status).toBe(405)
  })

  it('runJob 异常 → 任务 fail 收尾（error + 中文原因）', async () => {
    const { jobs, setRunJob, dispatch } = setup()
    setRunJob(() => Promise.reject(new Error('pipeline boom')))
    const res = await dispatch('POST', JOBS_PATH, JSON.stringify({ query: 'q' }))
    const { jobId } = res.json() as { jobId: string }
    await new Promise((resolve) => setTimeout(resolve, 0))
    const status = jobs.status(jobId)
    expect(status?.phase).toBe('error')
    expect(status?.message).toBe('搜索失败：内部错误')
  })
})

describe('GET /jobs/:id 轮询', () => {
  it('phase 推进全程可见（collecting→filtering→analyzing→done）', async () => {
    const { jobs, dispatch } = setup()
    const created = await dispatch('POST', JOBS_PATH, JSON.stringify({ query: 'q' }))
    const { jobId } = created.json() as { jobId: string }

    expect((await dispatch('GET', `${JOBS_PATH}/${jobId}`)).json()).toMatchObject({ jobId, phase: 'collecting' })
    jobs.setPhase(jobId, 'filtering')
    expect((await dispatch('GET', `${JOBS_PATH}/${jobId}`)).json()).toMatchObject({ phase: 'filtering' })
    jobs.setPhase(jobId, 'analyzing')
    expect((await dispatch('GET', `${JOBS_PATH}/${jobId}`)).json()).toMatchObject({ phase: 'analyzing' })

    jobs.complete(jobId, [{ sessionId: 's1', title: 't', workspacePath: '/w', activityTime: 1, reason: 'r', confidence: 0.9 }], true)
    const doneRes = await dispatch('GET', `${JOBS_PATH}/${jobId}`)
    expect(doneRes.status).toBe(200)
    expect(doneRes.json()).toMatchObject({
      jobId,
      phase: 'done',
      degraded: true,
      results: [{ sessionId: 's1', title: 't', workspacePath: '/w', activityTime: 1, reason: 'r', confidence: 0.9 }],
    })
  })

  it('未知 id → 404；error 终态带 message', async () => {
    const { jobs, dispatch } = setup()
    expect((await dispatch('GET', `${JOBS_PATH}/ghost`)).status).toBe(404)
    jobs.create({ query: 'q' })
    jobs.fail('job-1', '搜索失败：内部错误')
    expect((await dispatch('GET', `${JOBS_PATH}/job-1`)).json()).toMatchObject({ phase: 'error', message: '搜索失败：内部错误' })
  })
})

describe('DELETE /jobs/:id 取消', () => {
  it('在途任务 → 200 {cancelled:true}，终态 cancelled 且 controller 已 abort', async () => {
    const { jobs, dispatch } = setup()
    const created = await dispatch('POST', JOBS_PATH, JSON.stringify({ query: 'q' }))
    const { jobId } = created.json() as { jobId: string }
    const res = await dispatch('DELETE', `${JOBS_PATH}/${jobId}`)
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ cancelled: true })
    const job = jobs.get(jobId)
    expect(job?.phase).toBe('cancelled')
    expect(job?.controller.signal.aborted).toBe(true)
  })

  it('已终态 → 仍 200（noop 幂等语义），状态不被覆盖', async () => {
    const { jobs, dispatch } = setup()
    jobs.create({ query: 'q' })
    jobs.complete('job-1', [], false)
    const res = await dispatch('DELETE', `${JOBS_PATH}/job-1`)
    expect(res.status).toBe(200)
    expect(jobs.status('job-1')?.phase).toBe('done')
  })

  it('未知 id → 404；动态端点其余方法 → 405', async () => {
    const { dispatch } = setup()
    expect((await dispatch('DELETE', `${JOBS_PATH}/ghost`)).status).toBe(404)
    expect((await dispatch('POST', `${JOBS_PATH}/job-1`, '{}')).status).toBe(405)
    expect((await dispatch('PUT', `${JOBS_PATH}/job-1`)).status).toBe(405)
  })
})
