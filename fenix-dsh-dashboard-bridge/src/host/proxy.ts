/**
 * Host 半反代 handler：`<prefix>/X` → `upstream/X` 前缀剥离转发（design D5）。
 *
 * 实现要点（spec「同源反代路由」/「SSE 流式透传不缓冲」/「HTTP 方法与请求体
 * 透传」/「上游不可达降级」的落点）：
 * - 方法 / 查询串 / 请求体透传：请求体以流 pipe 进上游请求（GET/SSE 无体时
 *   即刻 end），不在内存聚合；
 * - 请求头白名单拷贝：仅逐项拷贝内容协商 / 条件请求 / range / content 类头；
 *   `host` 剥离并改写为上游 authority；`x-forwarded-proto` 按请求事实推导
 *   （优先透传前置反代已给值，否则按 socket 判定），`x-forwarded-path` 取
 *   原始路径，便于排查；
 * - 响应状态 / 头原样回写：剥离 `content-length`（交由 node 按实际流重算，
 *   流式改道后长度不符）与 hop-by-hop 头（含 `connection` 列出的逐个头名，
 *   RFC 7230 §6.1/6.7）；Location 例外——指向上游 authority 的绝对地址
 *   改写为前缀内路径（见 rewriteLocationHeader），其余原样拷贝；
 * - 响应体逐块 pipe 不聚合：node pipe 自带背压，SSE 天然透传；
 * - 「请求体收尾 → 收到响应头」阶段设 30s 超时（上游收齐请求后僵死不回响应
 *   头时降级 502，不让浏览器无限 pending；起点不设在发出请求时，避免把仍在
 *   上传大体积请求体的长请求误杀）；已开始的响应流（SSE 长连接）不设任何
 *   超时；
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

/**
 * 「请求体收尾 → 收到响应头」阶段超时：上游 TCP 已 accept、收齐请求体但不
 * 返回响应头（进程僵死 / 连接池耗尽）时降级 502，而非让浏览器无限 pending。
 * 计时起点在客户端请求体收尾（req 'end'）而非发出上游请求时——请求体是逐块
 * pipe 给上游的，上传未完成前上游通常不会提前回响应头，从发请求起算会把仍在
 * 上传的长请求误杀。取值远大于 dashboard 正常首字节时间；已开始的响应流
 * （SSE）不适用任何超时。
 */
const RESPONSE_HEADER_TIMEOUT_MS = 30_000

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

/**
 * 上游 3xx 的 Location 改写：指向上游 authority 的绝对地址改写为前缀内路径
 * （stripPrefix 的逆操作）——上游端口通常不对浏览器暴露，原样透传会让浏览器
 * 拿到上游地址直连，表现为不可达跳转。相对路径 Location 由浏览器按当前代理
 * 路径解析、天然落在前缀内；指向其他 authority 的绝对地址与本代理无关：
 * 两者均原样透传不改写。
 */
export function rewriteLocationHeader(
  location: string,
  upstream: string,
  prefix: string,
): string {
  let upstreamOrigin: string
  let resolved: URL
  try {
    upstreamOrigin = new URL(upstream).origin
    // 以 upstream 为 base 解析：同时覆盖绝对 URL 与协议相对（`//authority/x`）
    // 两种自带 authority 的形态；解析失败（奇异值）原样透传，不因改写丢跳转。
    resolved = new URL(location, upstream)
  } catch {
    return location
  }
  // 原文不含 authority（相对路径或根相对 `/x`）→ 不构成直连泄漏，不改写。
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(location) && !location.startsWith('//')) return location
  if (resolved.origin !== upstreamOrigin) return location
  // prefix 以 `/` 收尾、pathname 以 `/` 开头，去掉 prefix 尾斜杠拼接；根路径
  // `/` 即映射回裸前缀，与 stripPrefix 的 barePath 分支对偶。
  return `${prefix.slice(0, -1)}${resolved.pathname}${resolved.search}${resolved.hash}`
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
  // x-forwarded-proto 不走白名单逐项拷贝、单独按请求事实推导：该头语义是
  // 「原始客户端到代理的协议」。dsh web 之前若还有 TLS 反代，它写入的值最
  // 可信、透传其首值（X-Forwarded-* 在链路各跳逐跳重写，首值即最外层原始
  // 协议）；没有反代给值时按 dsh web 自身 socket 判定。不写死某一种协议，
  // 避免 HTTPS 反代部署下上游拿到的原始协议失真。
  const forwardedProto = req.headers['x-forwarded-proto']
  const trustedProto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
    ?.split(',')[0]
    ?.trim()
  // TLSSocket 才带 encrypted 标记（net.Socket 类型上无此字段，按鸭子类型判）。
  const isHttps = (req.socket as { encrypted?: boolean }).encrypted === true
  headers['x-forwarded-proto'] = trustedProto || (isHttps ? 'https' : 'http')
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
        // 已收到响应头：清除该阶段超时，此后响应流（含 SSE 长连接）不再有超时。
        clearTimeout(responseHeaderTimer)
        forwardUpstreamResponse(upstreamRes, res, upstream, prefix)
      },
    )
    // 「请求体收尾 → 收到响应头」阶段独立超时：上游收齐请求后僵死 / 连接池
    // 耗尽不回响应头时降级 502，而非让浏览器无限 pending。收到响应头或上游
    // 连接收口即清除；已开始的响应流（SSE 长连接）不设任何超时。定时器不在
    // 此处直接 arm，而是推迟到请求体收尾（下方 req 'end'）。
    let responseHeaderTimedOut = false
    let responseHeaderTimer: ReturnType<typeof setTimeout> | undefined
    const armResponseHeaderTimer = () => {
      // 该阶段已先行收口则不再计时：响应头已到（上游可在请求体收尾前提前回
      // 头，如先应答的 SSE——先 clear 后 arm 会留悬空定时器误杀正常转发），
      // 或上游连接已报错/收口（如请求体传输中途降级 502）。
      if (res.headersSent || upstreamSettled) return
      responseHeaderTimer = setTimeout(() => {
        responseHeaderTimedOut = true
        const reason = `上游 ${RESPONSE_HEADER_TIMEOUT_MS}ms 内未返回响应头`
        logError(
          `fenix-dashboard-bridge: 上游响应头超时 upstream=${upstream} path=${req.url ?? '/'} reason=${reason}`,
        )
        // 掐掉僵死的上游连接后走既有 502 路径；destroy 随后引发的滞后 'error'
        // （socket hang up）经 responseHeaderTimedOut 短路，不再动已发出的响应。
        upstreamReq.destroy()
        sendBadGateway(res, upstream, reason)
      }, RESPONSE_HEADER_TIMEOUT_MS)
    }
    upstreamReq.on('error', (error) => {
      // 响应头超时已降级 502：此处的 error 只是 destroy 的滞后回声，跳过。
      if (responseHeaderTimedOut) return
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
      // 上游连接收口（完成 / 出错 / 被销毁）后，响应头超时不再有意义，
      // 避免残留定时器事后去动一个已收口的响应。
      clearTimeout(responseHeaderTimer)
    })
    res.on('close', () => {
      if (!upstreamSettled) upstreamReq.destroy()
    })
    req.on('error', () => {
      upstreamReq.destroy()
    })
    // 请求体透传（GET/SSE 无体时即刻 end；POST 体逐块直通不聚合）。
    req.pipe(upstreamReq)
    // 响应头超时自客户端请求体收尾起算：pipe 收尾（'end'）意味着上游已收齐
    // 请求体，此后不回响应头才叫僵死；上传进行中上游通常不会提前回响应头，
    // 从发出请求起算会把长上传误杀成 502（GET/SSE 无体时 'end' 即刻触发，
    // 行为不变）。挂在 pipe 之后，确保计时自 upstreamReq.end() 起算。
    req.on('end', armResponseHeaderTimer)
  }
}

/** RFC 7230 §6.1 hop-by-hop 头：代理不得向下游透传（`connection` 列出的头名另剥）。 */
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const

/** 上游响应回写：状态/头原样（剥 content-length 与 hop-by-hop 头，Location 改写为前缀内路径），体逐块 pipe。 */
function forwardUpstreamResponse(
  upstreamRes: IncomingMessage,
  res: ServerResponse,
  upstream: string,
  prefix: string,
): void {
  const headers: Record<string, string | string[] | undefined> = { ...upstreamRes.headers }
  // content-length 交由 node 按实际流重算（流式改道后长度不符）；hop-by-hop
  // 头（含 `connection` 列出的逐个头名，RFC 7230 §6.1/6.7）剥除——上游连接
  // 语义（connection: close / keep-alive 参数）不得污染客户端与 dsh web 的
  // 连接复用，也不与 node 自行管理的连接语义冲突。
  delete headers['content-length']
  const connection = headers['connection']
  const listed = (Array.isArray(connection) ? connection.join(',') : connection ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0)
  for (const name of [...HOP_BY_HOP_HEADERS, ...listed]) delete headers[name]
  // 指向上游 authority 的绝对 Location 改写为前缀内路径：上游端口通常不对
  // 浏览器暴露，原样透传会造成不可达直连跳转（相对路径天然落前缀内，不改写）。
  const location = headers.location
  if (typeof location === 'string') {
    headers.location = rewriteLocationHeader(location, upstream, prefix)
  } else if (Array.isArray(location)) {
    headers.location = location.map((value) => rewriteLocationHeader(value, upstream, prefix))
  }
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
