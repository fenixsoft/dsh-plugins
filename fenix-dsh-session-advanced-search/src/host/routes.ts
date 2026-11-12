/**
 * host 半 HTTP 路由（design D2，webServer.register 同源 API）。
 *
 * 端点（`/api/session-advanced-search` 前缀避免与官方/其它插件路由冲突）：
 *   POST   /api/session-advanced-search/jobs        建任务，立即返回 {jobId}
 *   GET    /api/session-advanced-search/jobs/:id    轮询 {phase, results?, degraded?}
 *   DELETE /api/session-advanced-search/jobs/:id    取消（幂等；未知 id 404）
 *
 * 注册形态：`POST 建任务` 走 exact 座位（无前缀冲突），`/:id` 两条动态路径共用
 * 一个 prefix 座位（auth 先例 + dsh-host-webserver kind 语义）。prefix 座位 path
 * MUST 不带尾斜杠——dsh-host-webserver `match()` 规则为
 * `pathname === prefix || startsWith(prefix + '/')`（exact 命中优先、prefix 最长
 * 前缀胜出），带尾斜杠座位令深层路径永不命中（验证轮 BUG-01 教训，tests/
 * routes.test.ts 以忠实分发桩钉死）。响应一律 JSON（no-store）；请求体 64KB
 * 上限（query 文本余量充足）。
 *
 * 「重复提交取消旧任务」语义由 client 半保证（提交前 DELETE 旧任务）——host
 * 不做隐式取消（design D6 多标签页隔离）。
 */
import { JOBS_PATH, parseSearchRequest } from '../shared/protocol.js'
import type { SearchJobCreated, SearchJobStatus } from '../shared/protocol.js'
import type { WebRequest, WebResponse } from '../types/dsh-runtime.js'
import type { JobTable } from './jobs.js'

/** POST 请求体上限（design：64KB，自然语言描述 + 时间范围余量充足）。 */
export const MAX_BODY_BYTES = 64 * 1024

/** 动态任务端点的 id 提取（prefix 座位收到完整路径）。 */
const JOB_ID_PATTERN = /\/api\/session-advanced-search\/jobs\/([^/?#]+)/

/** 路由层依赖（host 装配注入；测试用桩对账）。 */
export interface RouteDeps {
  /** 进程内任务表。 */
  readonly jobs: JobTable
  /**
   * 任务执行管线（collector→analyzer，含 phase 推进与终态收尾）。POST 响应
   * 写出后 fire-and-forget 调用；实现自兜异常（fail 收尾），此处再兜一层。
   */
  readonly runJob: (jobId: string) => Promise<void>
  /** 日志门面（路由级异常 warn）。 */
  readonly log: { warn(message: string): void }
}

/** 三端点注册（register 返回的 disposer 汇总，供卸载对称）。 */
export interface RegisteredRoutes {
  readonly dispose: () => void
}

/** webServer.register 缝的最小被消费面（测试桩对账面）。 */
export interface WebServerSeam {
  register(route: { kind: 'exact' | 'prefix' | 'fallback'; path: string; handler: (req: WebRequest, res: WebResponse) => void | Promise<void> }): () => void
}

/** 注册三端点；返回汇总 disposer（注册/卸载对称）。 */
export function registerSearchRoutes(webServer: WebServerSeam, deps: RouteDeps): RegisteredRoutes {
  const disposers: (() => void)[] = []

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: JOBS_PATH,
      handler: (req, res) => handleJobsCollection(deps, req, res),
    }),
  )
  disposers.push(
    webServer.register({
      kind: 'prefix',
      // 无尾斜杠：dsh-host-webserver match 为 pathname===prefix||startsWith(prefix+'/')，
      // 带尾斜杠座位使深层路径（/jobs/:id）永不命中（验证轮 BUG-01 根因）。
      path: JOBS_PATH,
      handler: (req, res) => handleJobItem(deps, req, res),
    }),
  )

  return {
    dispose: () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // 注销异常不影响其余注销（对称卸载尽力而为）。
        }
      }
    },
  }
}

/** 任务集合端点：POST 建任务（立即返回 jobId）；其余方法 405。 */
async function handleJobsCollection(deps: RouteDeps, req: WebRequest, res: WebResponse): Promise<void> {
  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'method not allowed; use POST' })
    return
  }
  let payload: unknown
  try {
    const body = await readRequestBody(req, MAX_BODY_BYTES)
    payload = body.length > 0 ? JSON.parse(body) : undefined
  } catch (error) {
    writeJson(res, 400, { error: `invalid request body: ${error instanceof Error ? error.message : String(error)}` })
    return
  }
  const request = parseSearchRequest(payload)
  if (request === undefined) {
    writeJson(res, 400, { error: 'query 必填且非空；timeRange 须为 {start,end}（epoch ms，start<end）' })
    return
  }
  const job = deps.jobs.create(request)
  // 立即返回 jobId；管线异步执行（fire-and-forget，异常由管线自身 fail 兜底）。
  writeJson(res, 200, { jobId: job.id } satisfies SearchJobCreated)
  void deps.runJob(job.id).catch((error) => {
    deps.log.warn(`session-advanced-search: 任务 ${job.id} 管线异常：${error instanceof Error ? error.message : String(error)}`)
    deps.jobs.fail(job.id, '搜索失败：内部错误')
  })
}

/** 单任务端点：GET 轮询 / DELETE 取消；未知 id 404。 */
function handleJobItem(deps: RouteDeps, req: WebRequest, res: WebResponse): void {
  const url = typeof req.url === 'string' ? req.url : ''
  const match = JOB_ID_PATTERN.exec(url)
  const jobId = match?.[1]
  if (jobId === undefined || jobId.length === 0) {
    writeJson(res, 404, { error: 'job not found' })
    return
  }
  if (req.method === 'GET') {
    const status = deps.jobs.status(jobId)
    if (status === undefined) {
      writeJson(res, 404, { error: 'job not found' })
      return
    }
    writeJson(res, 200, status satisfies SearchJobStatus)
    return
  }
  if (req.method === 'DELETE') {
    const outcome = deps.jobs.cancel(jobId)
    if (outcome === 'missing') {
      writeJson(res, 404, { error: 'job not found' })
      return
    }
    // cancelled 与 noop（已终态）都按取消成功返回——DELETE 幂等语义。
    writeJson(res, 200, { cancelled: true })
    return
  }
  writeJson(res, 405, { error: 'method not allowed; use GET or DELETE' })
}

/** 读取请求体（字节上限；超限抛错由调用方 400）。 */
export function readRequestBody(req: WebRequest, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const onData = (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      total += buffer.length
      if (total > maxBytes) {
        settled = true
        req.removeListener('data', onData)
        reject(new Error(`request body exceeds ${maxBytes} bytes`))
        return
      }
      chunks.push(buffer)
    }
    req.on('data', onData)
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

/** JSON 响应写出（no-store；content-length 固定）。 */
function writeJson(res: WebResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}
