/**
 * Client 半项目列表同步（spec「每项目动态条目」2026-10 分组化改版）：
 * 启动拉取 `<prefix>/api/projects` 驱动「项目」分组数据源与每项目 main keyed
 * 面板注册；60s 周期 + window focus 重拉；以名称集合为指纹做幂等 reconcile——
 * 新增注册面板、消失注销面板、无变化零操作；拉取失败仅保留既有状态且无未
 * 处理异常。
 *
 * 项目不再逐个注册顶层侧栏条目（spec 变更：平铺条目改为「项目」分组，见
 * panels.tsx 分组组件）；同步目标 = main keyed 面板（契约不变）+ 分组组件
 * 数据源（setProjects 整体替换，store 内去重排序、无变化零通知）。
 *
 * 不订阅 dashboard SSE 拿项目表（design D6：避免常驻第二长连接 + 解析负担），
 * 60s 窗口对「侧栏多/少一个项目行」的时效足够。
 */

/** 项目列表轮询周期。 */
export const DEFAULT_POLL_INTERVAL_MS = 60_000

/**
 * 项目条目汇：reconcile 差异（main keyed 面板注册/注销）与分组数据源
 * （setProjects 整体替换）的落点。
 */
export interface ProjectEntrySink {
  /** 项目新增（或消失后重现）：注册该项目 main keyed 面板。 */
  addProject(name: string): void
  /** 项目消失：注销该项目 main keyed 面板并清理分组残留态。 */
  removeProject(name: string): void
  /** 分组数据源整体替换（实现应去重排序、无变化零通知）。 */
  setProjects(names: readonly string[]): void
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
 * 幂等 reconcile（main keyed 面板差异）：期望集 = 去重后的名称集合。
 * - 消失 → removeProject；
 * - 新增 → addProject；
 * - 指纹（名称集合）不变 → 零操作。
 * 返回新的已注册集合，作为下一轮 reconcile 的 current。
 */
export function reconcileProjects(
  current: ReadonlySet<string>,
  next: readonly string[],
  sink: Pick<ProjectEntrySink, 'addProject' | 'removeProject'>,
): ReadonlySet<string> {
  const desired = new Set([...new Set(next)])
  for (const name of current) {
    if (!desired.has(name)) sink.removeProject(name)
  }
  for (const name of desired) {
    if (!current.has(name)) sink.addProject(name)
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
  /** 差异落点（main keyed 面板注册/注销 + 分组数据源）。 */
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
  let current: ReadonlySet<string> = new Set()
  let stopped = false
  let inFlight = false

  const pull = async (): Promise<void> => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const names = await options.fetchProjects()
      if (!stopped) {
        current = reconcileProjects(current, names, options.sink)
        options.sink.setProjects(names)
      }
    } catch (error) {
      // 拉取失败：仅保留既有状态（面板与分组数据源原样），无未处理异常，
      // 等下一轮/聚焦重试。失败要吞但不能不可见：warn 出状态便于排障。
      console.warn(
        `[fenix-dsh-dashboard-bridge] 拉取项目列表失败（保留既有状态，等下一轮/聚焦重试）：${
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
