/**
 * host/index 装配测试：config 解析（非法值装载期抛错）、必选缝缺失 error 级
 * 显式停用零注册、enabled=false info 停用零注册、注册/卸载对称（effect 与
 * 显式 stop）、runJob 管线端到端（phase 推进序列/done 透传/fail 兜底/取消
 * 竞态不产出）、可选缝缺失降级路径（header-only + 机械回退）。
 */
import { describe, expect, it } from 'vitest'
import FenixSessionAdvancedSearch from '../src/host/index.js'
import { JOBS_PATH } from '../src/shared/protocol.js'
import type { WebRequest, WebResponse } from '../src/types/dsh-runtime.js'

/** webServer.register 桩（座位表 + 手动分发）。 */
class StubWebServer {
  readonly seats = new Map<string, { kind: string; path: string; handler: (req: WebRequest, res: WebResponse) => void | Promise<void> }>()
  registerCalls = 0

  register(route: { kind: 'exact' | 'prefix' | 'fallback'; path: string; handler: (req: WebRequest, res: WebResponse) => void | Promise<void> }): () => void {
    this.registerCalls += 1
    const key = `${route.kind}:${route.path}`
    this.seats.set(key, route)
    return () => {
      this.seats.delete(key)
    }
  }

  async post(body: string): Promise<{ status: number; jobId?: string }> {
    const seat = this.seats.get(`exact:${JOBS_PATH}`)
    if (seat === undefined) return { status: 404 }
    const listeners = new Map<string, ((chunk: Buffer | string) => void)[]>()
    const req = {
      method: 'POST',
      url: JOBS_PATH,
      headers: {},
      on(event: 'data' | 'end', listener: (chunk: Buffer | string) => void) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
      },
      removeListener() {},
    } as unknown as WebRequest
    const chunks: { status: number; headers: Record<string, string>; body: string } = { status: 0, headers: {}, body: '' }
    const res = {
      writeHead(status: number, headers?: Record<string, string>) {
        chunks.status = status
        chunks.headers = headers ?? {}
      },
      end(payload?: string) {
        chunks.body = payload ?? ''
      },
    } as unknown as WebResponse
    const handled = seat.handler(req, res)
    for (const listener of listeners.get('data') ?? []) listener(Buffer.from(body, 'utf8'))
    for (const listener of listeners.get('end') ?? []) listener(Buffer.alloc(0))
    await handled
    const parsed = chunks.body.length > 0 ? (JSON.parse(chunks.body) as { jobId?: string }) : {}
    return { status: chunks.status, jobId: parsed.jobId }
  }
}

/** 最小会话持久化桩（list + open('read') 单事件正文）。 */
function makePersistence(sessions: { id: string; createdAt: number; cwd?: string; text?: string }[]): import('../src/types/dsh-runtime.js').DshSessionPersistence {
  return {
    list: () =>
      Promise.resolve(
        sessions.map((session) => ({ header: { version: 1, id: session.id, createdAt: session.createdAt, isSeeded: false, cwd: session.cwd }, revision: 'r1' })),
      ),
    stat: (id) => Promise.resolve(sessions.filter((s) => s.id === id).map((s) => ({ header: { version: 1, id: s.id, createdAt: s.createdAt, isSeeded: false, cwd: s.cwd }, revision: 'r1' }))[0]),
    open: (id, access) => {
      if (access !== 'read') throw new Error('fixture: read only')
      const session = sessions.find((s) => s.id === id)
      return Promise.resolve({
        id,
        header: { version: 1, id, createdAt: session?.createdAt ?? 0, isSeeded: false },
        access,
        read: () => Promise.resolve({ events: [{ seq: 1, type: 'user/message', content: [{ type: 'text', text: session?.text ?? '' }] }] }),
        close: () => Promise.resolve(),
      })
    },
  }
}

/** stub LLM（固定 JSON 排名输出）。 */
function stubLlm(payload: unknown): import('../src/types/dsh-runtime.js').DshLlmRuntime {
  return {
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: JSON.stringify(payload) }
      })()
    },
  }
}

/** 假 cordis ctx（logger 记账 + effect 记账 + 缝注入）。 */
function makeCtx(overrides: {
  webServer?: unknown
  sessionPersistence?: unknown
  sessionController?: unknown
  llm?: unknown
  agentDefaultModel?: unknown
  omit?: readonly string[]
}): {
  ctx: import('@deepseek-ai/cordis').Context
  webServer: StubWebServer
  logs: { info: string[]; warn: string[]; error: string[]; debug: string[] }
  effects: (() => void)[]
} {
  const webServer = (overrides.webServer ?? new StubWebServer()) as StubWebServer
  const logs = { info: [] as string[], warn: [] as string[], error: [] as string[], debug: [] as string[] }
  const effects: (() => void)[] = []
  // cordis logger printf 语义模拟：%s 依次被参数替换后入账。
  const printf = (args: unknown[]): string => {
    let out = String(args[0])
    for (const param of args.slice(1)) out = out.replace('%s', String(param))
    return out
  }
  const full: Record<string, unknown> = {
    webServer,
    sessionPersistence: overrides.sessionPersistence ?? makePersistence([{ id: 's1', createdAt: 1, cwd: '/w', text: '正文' }]),
    sessionController: overrides.sessionController ?? { list: () => Promise.resolve({ items: [{ sessionId: 's1', updatedAt: 1, running: false, blank: false, projections: { values: { title: '标题' } } }] }) },
    llm: overrides.llm ?? stubLlm({ results: [{ id: 's1', reason: '命中', confidence: 0.9 }] }),
    agentDefaultModel: overrides.agentDefaultModel ?? { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    logger: {
      error: (...args: unknown[]) => logs.error.push(printf(args)),
      warn: (...args: unknown[]) => logs.warn.push(printf(args)),
      info: (...args: unknown[]) => logs.info.push(printf(args)),
      debug: (...args: unknown[]) => logs.debug.push(printf(args)),
    },
    effect: (fn: () => void | (() => void)) => {
      const disposer = fn()
      if (typeof disposer === 'function') effects.push(disposer)
    },
  }
  for (const key of overrides.omit ?? []) delete full[key]
  // cordis get 陷阱忠实镜像（BUG-01 回归基座）：插件 static inject 仅声明
  // webServer/sessionPersistence——其余服务键既使宿主已激活，loader 隔离语境
  // 下属性访问仍抛「cannot get property without inject」（实机复现坐实）；
  // 合法探测姿势是 ctx.get(name)（ReflectService.get 免 inject 读取，缺失
  // 返回 undefined 不抛）。宽松桩（属性访问静默 undefined）正是 BUG-01 漏网
  // 缺口，此处 MUST NOT 退回。
  const injectKeys = ['webServer', 'sessionPersistence']
  const serviceKeys = [...injectKeys, 'sessionController', 'llm', 'agentDefaultModel']
  const raw = full as Record<string, unknown>
  raw.get = (name: string) => raw[name]
  const proxied = new Proxy(raw, {
    get(target, prop) {
      if (typeof prop === 'string' && serviceKeys.includes(prop) && !injectKeys.includes(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(target, prop)
    },
  })
  return { ctx: proxied as unknown as import('@deepseek-ai/cordis').Context, webServer, logs, effects }
}

/** 构造被测插件（装配即注册；phase 轮询一律经公开路由座位驱动）。 */
function makePlugin(ctx: import('@deepseek-ai/cordis').Context, config?: unknown): FenixSessionAdvancedSearch {
  return new FenixSessionAdvancedSearch(ctx, config as never)
}

describe('装配：config 解析与缝校验', () => {
  it('非法配置 → 装载期抛 TypeError（D7 显式失败）', () => {
    const { ctx } = makeCtx({})
    expect(() => makePlugin(ctx, { maxCandidates: 0 })).toThrow(TypeError)
    expect(() => makePlugin(ctx, { enabled: 'yes' })).toThrow(TypeError)
    expect(() => makePlugin(ctx, { llmTimeoutMs: -1 })).toThrow(TypeError)
  })

  it('enabled=false → info 停用、零注册、effect 不挂', () => {
    const { ctx, webServer, logs, effects } = makeCtx({})
    makePlugin(ctx, { enabled: false })
    expect(webServer.registerCalls).toBe(0)
    expect(logs.info.some((m) => m.includes('enabled=false'))).toBe(true)
    expect(effects).toHaveLength(0)
  })

  it('webServer 缝缺失 → error 显式停用零注册', () => {
    const { ctx, logs } = makeCtx({ webServer: {} })
    makePlugin(ctx, undefined)
    expect(logs.error.some((m) => m.includes('webServer 缺失'))).toBe(true)
  })

  it('sessionPersistence 缝缺失 → error 显式停用零注册', () => {
    const { ctx, webServer, logs } = makeCtx({ sessionPersistence: { list: 'not-a-function' } })
    makePlugin(ctx, undefined)
    expect(webServer.registerCalls).toBe(0)
    expect(logs.error.some((m) => m.includes('sessionPersistence'))).toBe(true)
  })
})

describe('装配：注册/卸载对称', () => {
  it('正常装配注册两座位；effect 清理回调注销路由', () => {
    const { ctx, webServer, effects } = makeCtx({})
    makePlugin(ctx, undefined)
    expect(webServer.registerCalls).toBe(2)
    expect([...webServer.seats.keys()].sort()).toEqual([`exact:${JOBS_PATH}`, `prefix:${JOBS_PATH}`].sort())
    for (const dispose of effects) dispose()
    expect(webServer.seats.size).toBe(0)
  })
})

describe('装配：runJob 管线端到端', () => {
  it('POST → phase 推进至 done，LLM 排名透传（非降级）', async () => {
    const { ctx, webServer } = makeCtx({})
    makePlugin(ctx, { topN: 5 })
    const created = await webServer.post(JSON.stringify({ query: '登录' }))
    expect(created.status).toBe(200)
    const jobId = created.jobId as string
    // 经动态座位轮询终态（读座位 handler 直接驱动）。
    const phase = await pollViaRoute(webServer, jobId)
    expect(phase.phase).toBe('done')
    expect(phase.degraded).toBe(false)
    expect(phase.results).toHaveLength(1)
    expect(phase.results?.[0]).toMatchObject({ sessionId: 's1', reason: '命中', confidence: 0.9 })
  })

  it('可选缝全缺（无 controller/llm/agentDefaultModel）→ 降级完成（degraded=true）', async () => {
    const { ctx, webServer } = makeCtx({ omit: ['sessionController', 'llm', 'agentDefaultModel'] })
    makePlugin(ctx, undefined)
    const created = await webServer.post(JSON.stringify({ query: '标题' }))
    const status = await pollViaRoute(webServer, created.jobId as string)
    expect(status.phase).toBe('done')
    expect(status.degraded).toBe(true)
    expect(status.results?.[0]).toMatchObject({ sessionId: 's1', degraded: true })
  })

  it('BUG-01 回归：可选缝探测走 ctx.get——缝在场即增强（镜像桩属性访问抛错下 title 仍落地）', async () => {
    const { ctx, webServer, logs } = makeCtx({})
    // 镜像桩保真自检：未声明 inject 的服务键属性访问必须抛（cordis get 陷阱形态）。
    expect(() => (ctx as unknown as Record<string, unknown>).sessionController).toThrow(/without inject/)
    makePlugin(ctx, undefined)
    const created = await webServer.post(JSON.stringify({ query: '标题' }))
    const status = await pollViaRoute(webServer, created.jobId as string)
    expect(status.phase).toBe('done')
    // 增强生效：投影 title 落进结果，且无 header-only 降级日志——
    // 若 safeSeam 退回属性访问（BUG-01 形态），此用例必然转红。
    expect(status.results?.[0]).toMatchObject({ sessionId: 's1', title: '标题' })
    expect(logs.debug.some((m) => m.includes('sessionController 缝缺失'))).toBe(false)
  })

  it('collector 抛错 → error 收尾（中文 message）', async () => {
    const { ctx, webServer } = makeCtx({ sessionPersistence: { list: () => Promise.reject(new Error('disk gone')), open: () => Promise.reject(new Error('x')) } })
    makePlugin(ctx, undefined)
    const created = await webServer.post(JSON.stringify({ query: 'q' }))
    const status = await pollViaRoute(webServer, created.jobId as string)
    expect(status.phase).toBe('error')
    expect(status.message).toContain('搜索失败')
    expect(status.message).toContain('disk gone')
  })

  it('提交后立即 DELETE → cancelled 终态不被迟到完成覆盖', async () => {
    const { ctx, webServer } = makeCtx({})
    makePlugin(ctx, undefined)
    const created = await webServer.post(JSON.stringify({ query: 'q' }))
    const jobId = created.jobId as string
    // 经 DELETE 座位取消。
    const deleted = await deleteViaRoute(webServer, jobId)
    expect(deleted).toBe(true)
    const status = await pollViaRoute(webServer, jobId)
    expect(status.phase).toBe('cancelled')
  })
})

/** 经 prefix 座位轮询至终态并返回最终 SearchJobStatus。 */
async function pollViaRoute(webServer: StubWebServer, jobId: string, timeoutMs = 2000): Promise<{ phase: string; degraded?: boolean; message?: string; results?: { sessionId: string; reason: string; confidence: number; degraded?: boolean }[] }> {
  const seat = webServer.seats.get(`prefix:${JOBS_PATH}`)
  if (seat === undefined) throw new Error('prefix seat missing')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await requestVia(seat.handler, 'GET', `${JOBS_PATH}/${jobId}`)
    const parsed = JSON.parse(status.body) as { phase: string; degraded?: boolean; message?: string; results?: { sessionId: string; reason: string; confidence: number; degraded?: boolean }[] }
    if (parsed.phase === 'done' || parsed.phase === 'error' || parsed.phase === 'cancelled') return parsed
    if (Date.now() > deadline) throw new Error(`poll timeout, phase=${parsed.phase}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** 经 prefix 座位发 DELETE，返回是否 200。 */
async function deleteViaRoute(webServer: StubWebServer, jobId: string): Promise<boolean> {
  const seat = webServer.seats.get(`prefix:${JOBS_PATH}`)
  if (seat === undefined) throw new Error('prefix seat missing')
  const res = await requestVia(seat.handler, 'DELETE', `${JOBS_PATH}/${jobId}`)
  return res.status === 200
}

/** 最小 req/res 驱动单个 handler。 */
async function requestVia(handler: (req: WebRequest, res: WebResponse) => void | Promise<void>, method: string, url: string): Promise<{ status: number; body: string }> {
  const captured: { status: number; body: string } = { status: 0, body: '' }
  const req = { method, url, headers: {}, on() {}, removeListener() {} } as unknown as WebRequest
  const res = {
    writeHead(status: number) {
      captured.status = status
    },
    end(body?: string) {
      captured.body = body ?? ''
    },
  } as unknown as WebResponse
  await handler(req, res)
  return captured
}
