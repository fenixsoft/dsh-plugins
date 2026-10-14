/**
 * Host 半单测：前缀剥离转发 / SSE 流式透传 / 上游不可达降级 / dsh 侧桩。
 *
 * mock 上游与代理侧都用真实 node:http 服务（随机端口），客户端请求走真实
 * socket——SSE 时间差断言依赖真实计时器与真实分块到达时间。
 */
import { createServer, request as httpRequest } from 'node:http'
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createDashboardProxy, stripPrefix } from '../src/host/proxy.js'
import type { DashboardProxyHandler } from '../src/host/proxy.js'
import { DEFAULT_PREFIX } from '../src/shared/config.js'

// ---------------------------------------------------------------------------
// 基础设施：服务起停 / mock 上游 / 客户端请求
// ---------------------------------------------------------------------------

const servers: Server[] = []
const timers: ReturnType<typeof setTimeout>[] = []

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      servers.push(server)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

afterEach(async () => {
  for (const timer of timers.splice(0)) clearTimeout(timer)
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

interface SeenRequest {
  readonly method: string
  readonly url: string | undefined
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

/** 起 mock 上游：记录每个请求（方法/路径/头/体），由 handler 决定应答。 */
async function startMockUpstream(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<{ port: number; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      handler(req, res, seen[seen.length - 1]?.body ?? '')
    })
    res.on('error', () => {})
  })
  return { port: await listen(server), seen }
}

function jsonResponse(res: ServerResponse, status: number, payload: unknown, contentType = 'application/json'): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': contentType })
  res.end(body)
}

/** 把 proxy handler 挂到真实 http server（模拟 webserver 的 prefix 分发位置）。 */
async function startProxyServer(handler: DashboardProxyHandler): Promise<number> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => {
      // handler 抛错也必须在响应层收口，不外溢崩进程。
      if (!res.headersSent) {
        res.writeHead(500)
        res.end()
      } else {
        res.destroy()
      }
    })
  })
  return listen(server)
}

interface SimpleResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

function request(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk as Buffer))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

/** 找一个「当前空闲」的端口（起服 → 读端口 → 关服）。 */
async function freePort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  servers.splice(servers.indexOf(server), 1)
  return port
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// 3.1 透传断言
// ---------------------------------------------------------------------------

describe('前缀剥离转发（透传断言）', () => {
  it('GET API 请求透传：状态码/Content-Type/响应体一致，前缀剥离、host 改写、x-forwarded-path 追加', async () => {
    const upstream = await startMockUpstream((req, res) => {
      jsonResponse(res, 200, { projects: [{ name: 'fenixd' }, { name: 'dsh-plugins' }] })
    })
    const proxy = createDashboardProxy({ upstream: `http://127.0.0.1:${upstream.port}`, prefix: DEFAULT_PREFIX })
    const proxyPort = await startProxyServer(proxy)

    const response = await request(proxyPort, { path: '/fenix-dashboard/api/projects' })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/json')
    expect(JSON.parse(response.body)).toEqual({ projects: [{ name: 'fenixd' }, { name: 'dsh-plugins' }] })
    expect(upstream.seen).toHaveLength(1)
    const seen = upstream.seen[0]
    expect(seen?.method).toBe('GET')
    expect(seen?.url).toBe('/api/projects')
    expect(seen?.headers.host).toBe(`127.0.0.1:${upstream.port}`)
    expect(seen?.headers['x-forwarded-path']).toBe('/fenix-dashboard/api/projects')
    expect(seen?.headers['x-forwarded-proto']).toBe('http')
  })

  it('hashed 静态资源 200：/fenix-dashboard/umi.<hash>.js → 上游 /umi.<hash>.js', async () => {
    const upstream = await startMockUpstream((req, res) => {
      if (req.url === '/umi.ab3d9f.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', etag: '"abc123"' })
        res.end('console.log("umi")')
        return
      }
      res.writeHead(404)
      res.end()
    })
    const proxy = createDashboardProxy({ upstream: `http://127.0.0.1:${upstream.port}`, prefix: DEFAULT_PREFIX })
    const proxyPort = await startProxyServer(proxy)

    const response = await request(proxyPort, { path: '/fenix-dashboard/umi.ab3d9f.js' })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/javascript')
    expect(response.headers.etag).toBe('"abc123"')
    expect(response.body).toBe('console.log("umi")')
    expect(upstream.seen[0]?.url).toBe('/umi.ab3d9f.js')
  })

  it('POST 方法、查询串与请求体透传；响应状态原样回写', async () => {
    const upstream = await startMockUpstream((req, res, body) => {
      jsonResponse(res, 201, { accepted: true, echo: body }, 'application/json')
    })
    const proxy = createDashboardProxy({ upstream: `http://127.0.0.1:${upstream.port}`, prefix: DEFAULT_PREFIX })
    const proxyPort = await startProxyServer(proxy)

    const response = await request(proxyPort, {
      method: 'POST',
      path: '/fenix-dashboard/api/code-review/run?dry=1',
      headers: { 'content-type': 'application/json' },
      body: '{"spec":"fenix-dash-bridge"}',
    })

    expect(response.status).toBe(201)
    expect(JSON.parse(response.body)).toEqual({ accepted: true, echo: '{"spec":"fenix-dash-bridge"}' })
    const seen = upstream.seen[0]
    expect(seen?.method).toBe('POST')
    expect(seen?.url).toBe('/api/code-review/run?dry=1')
    expect(seen?.body).toBe('{"spec":"fenix-dash-bridge"}')
    expect(seen?.headers['content-type']).toBe('application/json')
    expect(seen?.headers['content-length']).toBe('28')
  })

  it('前缀剥离正确性：裸前缀、带尾斜杠、深层路径、条件请求头逐项拷贝', async () => {
    const upstream = await startMockUpstream((req, res) => {
      jsonResponse(res, 200, { url: req.url })
    })
    const proxy = createDashboardProxy({ upstream: `http://127.0.0.1:${upstream.port}`, prefix: DEFAULT_PREFIX })
    const proxyPort = await startProxyServer(proxy)

    expect(upstream.seen).toHaveLength(0)
    await request(proxyPort, { path: '/fenix-dashboard' })
    await request(proxyPort, { path: '/fenix-dashboard/' })
    await request(proxyPort, { path: '/fenix-dashboard/api/specs?limit=5', headers: { 'if-none-match': '"v7"' } })

    expect(upstream.seen.map((entry) => entry.url)).toEqual(['/', '/', '/api/specs?limit=5'])
    expect(upstream.seen[2]?.headers['if-none-match']).toBe('"v7"')
  })

  it('stripPrefix：前缀外返回 null（不接手），相似前缀不误剥', () => {
    const bare = DEFAULT_PREFIX.slice(0, -1)
    expect(stripPrefix('/fenix-dashboard/api/projects?x=1', DEFAULT_PREFIX, bare)).toBe('/api/projects?x=1')
    expect(stripPrefix('/fenix-dashboard', DEFAULT_PREFIX, bare)).toBe('/')
    expect(stripPrefix('/fenix-dashboard/', DEFAULT_PREFIX, bare)).toBe('/')
    expect(stripPrefix('/api/bridge', DEFAULT_PREFIX, bare)).toBeNull()
    expect(stripPrefix('/fenix-dashboard-evil/x', DEFAULT_PREFIX, bare)).toBeNull()
    // 缺失 url（畸形请求）按前缀外处理：不接手。
    expect(stripPrefix(undefined, DEFAULT_PREFIX, bare)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3.2 SSE 流式断言
// ---------------------------------------------------------------------------

interface Chunk {
  readonly text: string
  readonly at: number
}

/** 打开一条流式 GET，记录分块到达时间；支持按内容等待与客户端断开。 */
function openStream(port: number, path: string): {
  chunks: Chunk[]
  waitFor(fragment: string): Promise<Chunk>
  headers: Promise<IncomingHttpHeaders>
  destroy(): void
} {
  const chunks: Chunk[] = []
  const waiters: { fragment: string; resolve: (chunk: Chunk) => void }[] = []
  let clientReq: ClientRequest | undefined
  const headers = new Promise<IncomingHttpHeaders>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path }, (res) => {
      resolve(res.headers)
      res.setEncoding('utf8')
      res.on('data', (text) => {
        const chunk = { text: String(text), at: Date.now() }
        chunks.push(chunk)
        for (const [index, waiter] of waiters.entries()) {
          if (chunk.text.includes(waiter.fragment)) {
            waiters.splice(index, 1)
            waiter.resolve(chunk)
          }
        }
      })
      res.on('error', () => {})
    })
    req.on('error', reject)
    clientReq = req
    req.end()
  })
  return {
    chunks,
    waitFor(fragment) {
      const found = chunks.find((chunk) => chunk.text.includes(fragment))
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve) => waiters.push({ fragment, resolve }))
    },
    headers,
    destroy() {
      clientReq?.destroy()
    },
  }
}

describe('SSE 流式透传（不缓冲）', () => {
  it('事件块逐块即时到达（时间差断言）；连接长开不超时；客户端断开终止上游连接', async () => {
    let upstreamClosed = false
    const upstream = await startMockUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(':ok\n\n')
      timers.push(setTimeout(() => res.write('data: tick-1\n\n'), 2000))
      timers.push(setTimeout(() => res.write('data: tick-2\n\n'), 4000))
      res.on('close', () => {
        upstreamClosed = true
      })
    })
    const proxy = createDashboardProxy({ upstream: `http://127.0.0.1:${upstream.port}`, prefix: DEFAULT_PREFIX })
    const proxyPort = await startProxyServer(proxy)

    const startedAt = Date.now()
    const stream = openStream(proxyPort, '/fenix-dashboard/api/stream')
    const headers = await stream.headers
    expect(headers['content-type']).toBe('text/event-stream')
    expect(headers['content-length']).toBeUndefined()

    // 事件产出后即刻到达：tick-1 于上游产出（t0+2s）后立即抵达，不得等聚合。
    const tick1 = await stream.waitFor('tick-1')
    expect(tick1.at - startedAt).toBeLessThan(3500)

    // tick-2 与 tick-1 到达间隔 ≈ 上游 2s 产出间隔：若代理聚合缓冲，两块会
    // 同时抵达（间隔塌缩）或延迟到连接结束。
    const tick2 = await stream.waitFor('tick-2')
    expect(tick2.at - tick1.at).toBeGreaterThanOrEqual(1500)
    expect(tick2.at - startedAt).toBeLessThan(6000)

    // 连接长开不超时：tick-2（t0+4s）之后连接仍在、上游未断。
    await delay(300)
    expect(upstreamClosed).toBe(false)

    // 客户端断开 → 反代终止对应上游请求（防上游常驻连接泄漏）。
    stream.destroy()
    const closeDeadline = Date.now() + 2500
    while (!upstreamClosed && Date.now() < closeDeadline) {
      await delay(50)
    }
    expect(upstreamClosed).toBe(true)
  }, 20_000)

  it('SSE 响应头原样拷贝且剥 content-length/transfer-encoding 交由 node 重算', async () => {
    const upstream = await startMockUpstream((req, res) => {
      const body = 'data: a\n\ndata: b\n\n'
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        // 上游声明正确的 content-length；反代仍 MUST 剥离（流式改道后长度不符）。
        'content-length': String(Buffer.byteLength(body)),
        'x-accel-buffering': 'no',
      })
      res.write('data: a\n\n')
      res.end('data: b\n\n')
    })
    const proxy = createDashboardProxy({ upstream: `http://127.0.0.1:${upstream.port}`, prefix: DEFAULT_PREFIX })
    const proxyPort = await startProxyServer(proxy)

    const response = await request(proxyPort, { path: '/fenix-dashboard/api/stream' })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream')
    expect(response.headers['x-accel-buffering']).toBe('no')
    expect(response.headers['content-length']).toBeUndefined()
    expect(response.body).toBe('data: a\n\ndata: b\n\n')
  })
})

// ---------------------------------------------------------------------------
// 3.3 降级断言 + dsh 侧桩
// ---------------------------------------------------------------------------

describe('上游不可达降级', () => {
  it('上游停机返回 502 与可读提示页（含「Fenix Dashboard 未启动」与启动指引），错误日志含 upstream 与原因', async () => {
    const port = await freePort()
    const logs: string[] = []
    const proxy = createDashboardProxy({
      upstream: `http://127.0.0.1:${port}`,
      prefix: DEFAULT_PREFIX,
      logger: (message) => logs.push(message),
    })
    const proxyPort = await startProxyServer(proxy)

    const response = await request(proxyPort, { path: '/fenix-dashboard/' })

    expect(response.status).toBe(502)
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(response.body).toContain('Fenix Dashboard 未启动')
    expect(response.body).toContain('python3 bin/fenix_dashboard.py --serve')
    expect(response.body).toContain(`http://127.0.0.1:${port}`)
    expect(logs.join('\n')).toContain(`upstream=http://127.0.0.1:${port}`)
    expect(logs.join('\n')).toContain('ECONNREFUSED')
  })

  it('降级后代理不外溢：同实例后续请求仍正常处理（502 重复可恢复，前缀外 404）', async () => {
    const port = await freePort()
    const proxy = createDashboardProxy({ upstream: `http://127.0.0.1:${port}`, prefix: DEFAULT_PREFIX })
    const proxyPort = await startProxyServer(proxy)

    const first = await request(proxyPort, { path: '/fenix-dashboard/overview' })
    const second = await request(proxyPort, { path: '/fenix-dashboard/api/projects' })
    const outside = await request(proxyPort, { path: '/some/other/path' })

    expect(first.status).toBe(502)
    expect(second.status).toBe(502)
    expect(second.body).toContain('Fenix Dashboard 未启动')
    expect(outside.status).toBe(404)
  })
})

describe('dsh 侧桩（路由注册/注销）', () => {
  interface RegisteredRoute {
    readonly kind: string
    readonly path: string
    readonly handler: unknown
  }

  /** 最小 WebServer 桩：记录注册，disposer 语义对齐真实实现（Map.delete，幂等）。 */
  function stubWebServer() {
    const registered: RegisteredRoute[] = []
    const table = new Map<string, RegisteredRoute>()
    const disposeCalls: string[] = []
    const effects: (() => void)[] = []
    const ctx = {
      logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
      webServer: {
        register(route: RegisteredRoute) {
          registered.push(route)
          table.set(route.path, route)
          return () => {
            // 对齐 WebServer.register：按 path 删除，幂等可重复调用。
            if (table.delete(route.path)) disposeCalls.push(route.path)
          }
        },
      },
      effect(fn: () => () => void) {
        effects.push(fn())
      },
    }
    return { ctx, registered, table, disposeCalls, effects }
  }

  async function importHostPlugin() {
    return await import('../src/host/index.js')
  }

  it('默认配置注册 prefix 路由（无尾斜杠），卸载经 disposer 注销且幂等', async () => {
    const host = await importHostPlugin()
    const Plugin = host.default
    const stub = stubWebServer()

    const plugin = new Plugin(stub.ctx as never)
    expect(stub.registered).toHaveLength(1)
    expect(stub.registered[0]?.kind).toBe('prefix')
    expect(stub.registered[0]?.path).toBe('/fenix-dashboard')
    expect(typeof stub.registered[0]?.handler).toBe('function')

    // 卸载：effect 收集的 disposer 执行注销；重复调用安全（幂等）。
    expect(stub.table.has('/fenix-dashboard')).toBe(true)
    for (const dispose of stub.effects) dispose()
    expect(stub.table.has('/fenix-dashboard')).toBe(false)
    expect(stub.disposeCalls).toEqual(['/fenix-dashboard'])
    for (const dispose of stub.effects) dispose()
    expect(stub.disposeCalls).toEqual(['/fenix-dashboard'])
    void plugin
  })

  it('loader 行 config 覆盖：prefix 归一（补/去尾斜杠），upstream 透传给反代', async () => {
    const host = await importHostPlugin()
    const Plugin = host.default

    const stubA = stubWebServer()
    new Plugin(stubA.ctx as never, { prefix: '/dash/' } as never)
    expect(stubA.registered[0]?.path).toBe('/dash')

    const stubB = stubWebServer()
    new Plugin(stubB.ctx as never, { prefix: 'dash' } as never)
    expect(stubB.registered[0]?.path).toBe('/dash')

    const stubC = stubWebServer()
    new Plugin(stubC.ctx as never, { upstream: 'http://127.0.0.1:9000/', prefix: '/x/' } as never)
    expect(stubC.registered[0]?.path).toBe('/x')

    // 非法 upstream 在装载期显式失败（配置错误不静默）。
    expect(() => new Plugin(stubWebServer().ctx as never, { upstream: 'ftp://x' } as never)).toThrow(/http\/https/)
  })
})
