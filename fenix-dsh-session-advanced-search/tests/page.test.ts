/**
 * 独立高级搜索页路由契约测试（转向轮 m00937）：exact 座位注册形状、GET 出
 * 自包含 HTML（text/html; charset=utf-8）、HEAD 同头空体、非 GET 405、页面
 * 内含 API 端点与会话深链缝标记（dsh.sessions.current）、原型脚手架
 * （data-proto-id / 预览切换）不残留、注册/卸载对称。
 */
import { describe, expect, it } from 'vitest'
import { PAGE_ROUTE, registerPageRoute, renderPageHtml } from '../src/host/page.js'
import type { WebServerSeam } from '../src/host/page.js'
import { JOBS_PATH } from '../src/shared/protocol.js'

/** 页路由专用座位表桩（kind:path 记账 + exact 直分发）。 */
class StubPageServer {
  readonly seats = new Map<string, { kind: string; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }>()

  register(route: { kind: 'exact' | 'prefix' | 'fallback'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void {
    const key = `${route.kind}:${route.path}`
    this.seats.set(key, route)
    return () => {
      this.seats.delete(key)
    }
  }

  seat(method: string): { handler: (req: unknown, res: unknown) => void | Promise<void> } | undefined {
    return this.seats.get(`exact:${method}`)
  }
}

/** 响应记账桩（页面路由只消费 writeHead/end）。 */
class PageRes {
  status = 0
  headers: Record<string, string> = {}
  body: string | undefined

  writeHead(status: number, headers?: Record<string, string>): this {
    this.status = status
    this.headers = headers ?? {}
    return this
  }

  end(payload?: string): this {
    this.body = payload
    return this
  }
}

const WARN_LOG: string[] = []
function setup(): { server: StubPageServer } {
  const server = new StubPageServer()
  registerPageRoute(server as unknown as WebServerSeam, { log: { warn: (m) => WARN_LOG.push(m) } })
  return { server }
}

describe('registerPageRoute（独立高级搜索页）', () => {
  it('exact 座位注册于 PAGE_ROUTE（无前缀冲突面）', () => {
    const { server } = setup()
    expect(server.seats.has(`exact:${PAGE_ROUTE}`)).toBe(true)
    expect(PAGE_ROUTE).toBe('/session-advanced-search')
    expect(PAGE_ROUTE.startsWith(JOBS_PATH)).toBe(false)
  })

  it('GET 返回 200 text/html 自包含页面（含端点与深链缝标记）', async () => {
    const { server } = setup()
    const res = new PageRes()
    await server.seat(PAGE_ROUTE)!.handler({ method: 'GET', url: PAGE_ROUTE }, res)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-store')
    const html = res.body ?? ''
    expect(html).toContain('<!doctype html')
    expect(html).toContain('高级搜索')
    expect(html).toContain(JOBS_PATH)
    expect(html).toContain('dsh.sessions.current')
    expect(html).toContain('degradedReason')
    // SSE 优先数据面（m01577 闪烁修复）：EventSource + /events 端点 + 轮询兜底。
    expect(html).toContain('EventSource')
    expect(html).toContain("/events'");
    expect(html).toContain('startPolling')
    // 增量步骤渲染（不再整体 innerHTML 重建）。
    expect(html).toContain('insertAdjacentHTML')
    // 跳转服务缝优先（__fenixSas.openSession），localStorage 兜底保留。
    expect(html).toContain('__fenixSas')
    expect(html).toContain('openSession')
    expect((res.headers['content-length'] ?? '')).toBe(String(Buffer.byteLength(html)))
    expect(html.length).toBeLessThan(200 * 1024)
  })

  it('页面为纯真实现：无原型脚手架与未消费占位', async () => {
    const html = renderPageHtml()
    expect(html).not.toContain('data-proto-id')
    expect(html).not.toContain('modeToggle')
    expect(html).not.toContain('annotator.js')
    expect(html).not.toContain('${')
    expect(html).not.toContain('ws:')
  })

  it('宿主偏好跟随：双主题令牌 + 偏好引导 + postMessage 契约 + 双语词典', () => {
    const html = renderPageHtml()
    // 双主题：light 默认 + dark 全量 override（真机采集令牌锚点）。
    expect(html).toContain('html[data-theme="dark"]')
    expect(html).toContain('#151517')
    expect(html).toContain('color-scheme: dark')
    // head 早执行 boot script：?theme=/?locale= → 父文档属性回退 → 首帧落档。
    expect(html).toContain("data-ds-theme-source")
    expect(html).toContain('data-theme')
    // 实时跟随通道：只认父窗口源的 postMessage 监听（bridge themeFollow /
    // fenixd localeChannel 契约同形）。
    expect(html).toContain("kind === 'fenix-theme'")
    expect(html).toContain("kind === 'fenix-locale'")
    expect(html).toContain('applyI18n')
    // 双语词典关键 en 文案（zh 默认静态值保留）。
    expect(html).toContain("'Advanced Search'")
    expect(html).toContain('Search session history in natural language')
    expect(html).toContain("tr('step.' + p.step)")
  })

  it('HEAD 同响应头但空体；其余方法 405 JSON', async () => {
    const { server } = setup()
    const headRes = new PageRes()
    await server.seat(PAGE_ROUTE)!.handler({ method: 'HEAD', url: PAGE_ROUTE }, headRes)
    expect(headRes.status).toBe(200)
    expect(headRes.body).toBeUndefined()

    const postRes = new PageRes()
    await server.seat(PAGE_ROUTE)!.handler({ method: 'POST', url: PAGE_ROUTE }, postRes)
    expect(postRes.status).toBe(405)
    expect((postRes.body as string)).toContain('method not allowed')

    const delRes = new PageRes()
    await server.seat(PAGE_ROUTE)!.handler({ method: 'DELETE', url: PAGE_ROUTE }, delRes)
    expect(delRes.status).toBe(405)
  })

  it('注册/卸载对称：dispose 后座位移除', () => {
    const server = new StubPageServer()
    const reg = registerPageRoute(server as unknown as WebServerSeam, { log: { warn: (m) => WARN_LOG.push(m) } })
    expect(server.seats.size).toBe(1)
    reg.dispose()
    expect(server.seats.size).toBe(0)
    reg.dispose()
    expect(server.seats.size).toBe(0)
  })

  it('register 返回非函数时 warn 一次且 dispose 幂等不抛', () => {
    const bogus = {
      register: () => undefined,
    }
    expect(() => {
      const reg = registerPageRoute(bogus as unknown as WebServerSeam, { log: { warn: (m) => WARN_LOG.push(m) } })
      reg.dispose()
    }).not.toThrow()
    expect(WARN_LOG.some((m) => m.includes(PAGE_ROUTE))).toBe(true)
  })
})
