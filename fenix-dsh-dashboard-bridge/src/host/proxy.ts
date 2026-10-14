/**
 * Host 半反代 handler：`<prefix>/X` → `upstream/X` 前缀剥离转发（design D5）。
 *
 * 实现要点（spec「同源反代路由」/「SSE 流式透传不缓冲」/「HTTP 方法与请求体
 * 透传」/「上游不可达降级」的落点）：
 * - 方法 / 查询串 / 请求体透传：请求体以流 pipe 进上游请求（GET/SSE 无体时
 *   即刻 end），不在内存聚合；
 * - 请求头白名单拷贝：仅逐项拷贝内容协商 / 条件请求 / range / content 类头；
 *   `host` 剥离并改写为上游 authority，追加 `x-forwarded-proto/path` 便于排查；
 * - 响应状态 / 头原样回写：仅剥离 `content-length` 与 `transfer-encoding`
 *   交由 node 按实际流重算（流式改道后长度不符），其余原样拷贝；
 * - 响应体逐块 pipe 不聚合：node pipe 自带背压，SSE 天然透传；
 * - 不设任何请求超时（SSE 长连接）；
 * - 客户端断开（响应流关闭）时终止对应上游请求——面板重挂反复开关 SSE，
 *   不终止则在上游侧累积泄漏连接（上游 dashboard 有常驻连接数上限）；
 * - 上游连接失败（ECONNREFUSED / 超时 / DNS）→ 502 + 可读 HTML 提示页，
 *   异常不外溢，并经 logger 输出含 upstream 地址与错误原因的错误日志。
 */
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { normalizePrefix, normalizeUpstream } from '../shared/config.js'

/** 请求头白名单：内容协商 / 条件请求 / range / content 类头逐项拷贝。 */
export const REQUEST_HEADER_ALLOWLIST = [
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'content-type',
  'content-length',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'range',
] as const

export interface DashboardProxyOptions {
  /** 上游 dashboard 地址（无尾斜杠，如 `http://127.0.0.1:8787`）。 */
  readonly upstream: string
  /** URL 路径前缀（尾斜杠形态，如 `/fenix-dashboard/`）。 */
  readonly prefix: string
  /** 错误日志出口（host 半传 ctx.logger；缺省落 console.error）。 */
  readonly logger?: (message: string) => void
}

export type DashboardProxyHandler = (req: IncomingMessage, res: ServerResponse) => void

/** 前缀剥离：返回应转发到上游的路径+查询串；前缀外返回 null（不接手）。 */
export function stripPrefix(
  rawUrl: string | undefined,
  prefix: string,
  barePath: string,
): string | null {
  const raw = rawUrl ?? '/'
  // webserver prefix 路由保证前缀内才进入；此处防御性再判一次，前缀外显式
  // 不接手（返回 null 由 handler 回 404），绝不改写 dsh 自身路径。
  if (raw !== barePath && !raw.startsWith(prefix)) return null
  if (raw === barePath) return '/'
  const rest = raw.slice(prefix.length)
  return rest.startsWith('/') ? rest : `/${rest}`
}

/** 组装转发头：白名单拷贝 + host 改写 + x-forwarded-* 追加。 */
export function buildForwardHeaders(
  req: IncomingMessage,
  target: URL,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = req.headers[name]
    if (value === undefined) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  headers.host = target.host
  headers['x-forwarded-proto'] = 'http'
  headers['x-forwarded-path'] = req.url ?? '/'
  return headers
}

/** HTML 转义（提示页内插 upstream 地址与错误原因用）。 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 502 可读提示页：说明 dashboard 未启动 + 启动指引 + 错误原因。 */
export function renderBadGatewayHtml(upstream: string, reason: string): string {
  const safeUpstream = escapeHtml(upstream)
  const safeReason = escapeHtml(reason)
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>Fenix Dashboard 不可达</title></head>',
    '<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#1f2328;line-height:1.7">',
    '<h1>Fenix Dashboard 未启动</h1>',
    `<p>dsh web 无法连接上游 Fenix Dashboard（<code>${safeUpstream}</code>）。</p>`,
    '<p>请在宿主机启动 dashboard 后重试，例如在 fenixd 仓库执行',
    '<code>python3 bin/fenix_dashboard.py --serve</code>；',
    '若已启动仍不可达，请检查 dsh 插件配置的 <code>upstream</code> 是否正确。</p>',
    `<p>错误原因：<code>${safeReason}</code></p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** 创建前缀剥离转发 handler（挂到 WebServer prefix 路由上）。 */
export function createDashboardProxy(options: DashboardProxyOptions): DashboardProxyHandler {
  const upstream = normalizeUpstream(options.upstream)
  const prefix = normalizePrefix(options.prefix)
  const barePath = prefix.slice(0, -1)
  const logError = options.logger ?? ((message: string) => { console.error(message) })

  return function handleDashboardRequest(req, res) {
    const suffix = stripPrefix(req.url, prefix, barePath)
    if (suffix === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const target = new URL(`${upstream}${suffix}`)
    const upstreamReq = httpRequest(
      target,
      { method: req.method, headers: buildForwardHeaders(req, target) },
      (upstreamRes) => {
        forwardUpstreamResponse(upstreamRes, res)
      },
    )
    // SSE 长连接：显式不设任何请求超时。
    upstreamReq.on('error', (error) => {
      const reason =
        error instanceof Error
          ? `${('code' in error && typeof error.code === 'string' ? error.code : error.name)}: ${error.message}`
          : String(error)
      logError(
        `fenix-dashboard-bridge: 上游不可达 upstream=${upstream} path=${req.url ?? '/'} reason=${reason}`,
      )
      if (res.headersSent) {
        // 流已开始（如 SSE 中途断开）：无法再降级为 502，只能掐断响应。
        res.destroy()
        return
      }
      sendBadGateway(res, upstream, reason)
    })
    // 客户端断开（响应流关闭）→ 终止上游请求，防上游侧泄漏连接。
    let upstreamSettled = false
    upstreamReq.on('close', () => {
      upstreamSettled = true
    })
    res.on('close', () => {
      if (!upstreamSettled) upstreamReq.destroy()
    })
    req.on('error', () => {
      upstreamReq.destroy()
    })
    // 请求体透传（GET/SSE 无体时即刻 end；POST 体逐块直通不聚合）。
    req.pipe(upstreamReq)
  }
}

/** 上游响应回写：状态/头原样（剥 content-length/transfer-encoding），体逐块 pipe。 */
function forwardUpstreamResponse(
  upstreamRes: IncomingMessage,
  res: ServerResponse,
): void {
  const headers: Record<string, string | string[] | undefined> = { ...upstreamRes.headers }
  delete headers['content-length']
  delete headers['transfer-encoding']
  res.writeHead(upstreamRes.statusCode ?? 502, headers)
  upstreamRes.on('error', () => {
    res.destroy()
  })
  // 逐块直通（pipe 含背压，不聚合缓冲）——SSE 事件块产出即达。
  upstreamRes.pipe(res)
}

/** 502 降级响应：可读 HTML 提示页，异常不外溢。 */
function sendBadGateway(res: ServerResponse, upstream: string, reason: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(502, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(renderBadGatewayHtml(upstream, reason))
}
