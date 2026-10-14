/**
 * Client 半项目列表同步（spec「每项目动态条目」/「项目列表轮询同步」）：
 * 启动拉取 `<prefix>/api/projects` 生成每项目动态条目；60s 周期 + window focus
 * 重拉；以 name 有序集合为指纹做幂等 reconcile——新增注册、消失 dispose、
 * 无变化零操作；拉取失败/空列表仅保留固定条目且无未处理异常。
 *
 * 不订阅 dashboard SSE 拿项目表（design D6：避免常驻第二长连接 + 解析负担），
 * 60s 窗口对「侧栏多/少一个项目行」的时效足够。
 */

/** 项目条目 order 基准（固定 5 项取 10–14，项目条目全部位于其后）。 */
export const PROJECT_ORDER_BASE = 100

/** 项目列表轮询周期。 */
export const DEFAULT_POLL_INTERVAL_MS = 60_000

/** 一条待注册的项目条目（order = 100 起按名称排序）。 */
export interface ProjectRegistration {
  readonly name: string
  readonly order: number
}

/** 项目条目汇：把 reconcile 的差异落到 slots（ctx.slots.register/disposer）。 */
export interface ProjectEntrySink {
  addProject(project: ProjectRegistration): void
  removeProject(name: string): void
}

export type ProjectListFetcher = () => Promise<readonly string[]>

/** 名称比较（码点序，跨环境确定）。 */
export function compareNames(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * 解析 `/api/projects` 应答为项目名数组：`{ projects: [{ name }] }`；
 * 非 projects 数组抛错（按拉取失败处理），空数组合法，缺失/非字符串 name
 * 的行静默跳过。
 */
export function parseProjectNames(payload: unknown): string[] {
  const projects = (payload as { projects?: unknown } | null | undefined)?.projects
  if (!Array.isArray(projects)) {
    throw new Error('fenix-dsh-dashboard-bridge: /api/projects 应答形状异常（projects 非数组）')
  }
  const names: string[] = []
  for (const item of projects) {
    const name = (item as { name?: unknown } | null | undefined)?.name
    if (typeof name === 'string' && name.length > 0) names.push(name)
  }
  return names
}

/**
 * 幂等 reconcile：期望映射 = 去重排序后的 `{ name → 100 + 有序位次 }`。
 * - 消失（或期望 order 变化，如中间插入使位次后移）→ removeProject；
 * - 新增（或 order 变化的既有项重注册）→ addProject；
 * - 指纹（name 有序集合）不变 → 期望映射逐项相等 → 零操作。
 * 返回新的已注册映射（name → order），作为下一轮 reconcile 的 current。
 */
export function reconcileProjects(
  current: ReadonlyMap<string, number>,
  next: readonly string[],
  sink: ProjectEntrySink,
): ReadonlyMap<string, number> {
  const names = [...new Set(next)].sort(compareNames)
  const desired = new Map<string, number>(names.map((name, index) => [name, PROJECT_ORDER_BASE + index]))
  for (const [name, order] of current) {
    if (desired.get(name) !== order) sink.removeProject(name)
  }
  for (const [name, order] of desired) {
    if (current.get(name) !== order) sink.addProject({ name, order })
  }
  return desired
}

/** 计时/焦点钩子（测试注入假定时器；node 环境无 window 时焦点订阅为 no-op）。 */
export interface SyncTimer {
  setInterval(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
  onFocus(fn: () => void): () => void
}

function defaultTimer(): SyncTimer {
  return {
    setInterval(fn, ms) {
      return setInterval(fn, ms)
    },
    clear(handle) {
      clearInterval(handle as ReturnType<typeof setInterval>)
    },
    onFocus(fn) {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return () => {}
      }
      window.addEventListener('focus', fn)
      return () => {
        window.removeEventListener('focus', fn)
      }
    },
  }
}

export interface ProjectSyncOptions {
  /** 拉取项目名列表（默认实现 fetch `<prefix>/api/projects` 并解析）。 */
  readonly fetchProjects: ProjectListFetcher
  /** 差异落点（ctx.slots 注册/注销）。 */
  readonly sink: ProjectEntrySink
  /** 轮询周期；缺省 60s。 */
  readonly intervalMs?: number
  /** 计时/焦点钩子；缺省真实 setInterval + window focus。 */
  readonly timer?: SyncTimer
}

/**
 * 启动项目列表同步循环：立即拉取一次，随后按周期 + 窗口聚焦重拉。
 * 返回停止函数：清定时器、退订焦点、丢弃在途拉取结果；再次调用安全。
 */
export function startProjectSync(options: ProjectSyncOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timer = options.timer ?? defaultTimer()
  let current: ReadonlyMap<string, number> = new Map()
  let stopped = false
  let inFlight = false

  const pull = async (): Promise<void> => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const names = await options.fetchProjects()
      if (!stopped) current = reconcileProjects(current, names, options.sink)
    } catch (error) {
      // 拉取失败：仅保留固定条目（既有项目条目原样保留），无未处理异常，
      // 等下一轮/聚焦重试。失败要吞但不能不可见：warn 出状态/错误消息便于排障。
      console.warn(
        `[fenix-dsh-dashboard-bridge] 拉取项目列表失败（保留既有条目，等下一轮/聚焦重试）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      inFlight = false
    }
  }

  const handle = timer.setInterval(() => {
    void pull()
  }, intervalMs)
  const unfocus = timer.onFocus(() => {
    void pull()
  })
  void pull()

  return () => {
    stopped = true
    timer.clear(handle)
    unfocus()
  }
}
