/**
 * Client 半项目列表同步（spec「每项目动态条目」2026-10 分组化改版；2026-11
 * move-project-nav-to-workspace-rows 追加工作区自动对齐步）：
 * 启动拉取 `<prefix>/api/projects` 驱动名称导航数据源与每项目 main keyed
 * 面板注册；60s 周期 + window focus 重拉；以名称集合为指纹做幂等 reconcile——
 * 新增注册面板、消失注销面板、无变化零操作；拉取失败仅保留既有状态且无未
 * 处理异常。
 *
 * 同步目标 = main keyed 面板（契约不变）+ 名称导航数据源 projectGroupStore
 * （setProjects 整体替换，store 内去重排序、无变化零通知；见 panels.tsx
 * installWorkspaceNav）。
 *
 * 工作区自动对齐步（move-project-nav-to-workspace-rows D3，2026-11-09 用户
 * 裁决）：每轮拉取成功后，exists 可达项目 × 工作区快照（matchWorkspaceForProject
 * 同序判据）求差，缺失者经 `workspaces.create({ path })` 注册（官方 API，create
 * 不开会话，projectSessionStarter 先例）——新项目 60s 内自动出现在工作区列表；
 * 只增不改不删（项目删除后其工作区保留）；对齐拉取失败/超时跳过整轮（不建
 * 不删）；依赖（workspaceItems/createWorkspace/fetchProjectRows）任一缺席整段
 * 禁用（测试桩/异常环境零动作）。
 *
 * 不订阅 dashboard SSE 拿项目表（design D6：避免常驻第二长连接 + 解析负担），
 * 60s 窗口对「侧栏多/少一个项目行」的时效足够。
 */

/** 项目列表轮询周期。 */
export const DEFAULT_POLL_INTERVAL_MS = 60_000

/** 轮询周期下界：合法但低于该值的配置按笔误钳到下界，防高频请求轰炸后端。 */
export const MIN_POLL_INTERVAL_MS = 5_000

/**
 * 规整轮询周期（仅在启动时调用一次，warn 只发一次、不随轮询刷屏）：
 * 非有限/非正数视为配置笔误，回退缺省值；合法但低于下界的钳到下界。
 */
function normalizeIntervalMs(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_POLL_INTERVAL_MS
  if (!Number.isFinite(raw) || raw <= 0) {
    console.warn(
      `[fenix-dsh-dashboard-bridge] intervalMs 配置非法（${String(raw)}），回退缺省 ${DEFAULT_POLL_INTERVAL_MS}ms`,
    )
    return DEFAULT_POLL_INTERVAL_MS
  }
  if (raw < MIN_POLL_INTERVAL_MS) {
    console.warn(
      `[fenix-dsh-dashboard-bridge] intervalMs=${String(raw)}ms 低于下界，钳制为 ${MIN_POLL_INTERVAL_MS}ms（防高频轰炸后端）`,
    )
    return MIN_POLL_INTERVAL_MS
  }
  return raw
}

/** 工作区快照行最小结构面（`ui.workspaces.list.getSnapshot().items` 行）。 */
export interface WorkspaceItemLike {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
}

/** 项目行信息（名称 + exists 可达时的目录路径；不可达为 null）。 */
export interface ProjectRowInfo {
  readonly name: string
  readonly path: string | null
}

/**
 * ProjectSummary 精简投影（add-workspace-row-project-tooltip 数据面，D1）：
 * tooltip 富提示消费的最小字段面——不存全量对象（problems/scenario_count/
 * updated 等本能力不需要，投影面收敛内存与泄漏面）。字段缺失/形状漂移一律
 * null 口径（tooltip 侧「—」不伪装 0）；`exists`/`error` 为降级标记
 * （exists:false 或 error 非空的行，tooltip 判数据失效回退原生提示）。
 */
export interface ProjectSummaryProjection {
  readonly name: string
  readonly path: string | null
  readonly description: string | null
  readonly daemon: string | null
  readonly hosting: string | null
  readonly exists: boolean
  readonly discovered: boolean
  readonly error: string | null
  readonly status_counts: Readonly<Record<string, number>> | null
  readonly task_done: number | null
  readonly task_total: number | null
  readonly active_runs: number | null
}

/** 投影键集合（srcContract 钉值单源：键删除时契约测试红）。 */
export const PROJECT_SUMMARY_KEYS = [
  'name',
  'path',
  'description',
  'daemon',
  'hosting',
  'exists',
  'discovered',
  'error',
  'status_counts',
  'task_done',
  'task_total',
  'active_runs',
] as const

/** 项目行拉取器：GET `<prefix>api/projects` 原始应答（对齐步逐行解析用）。 */
export type ProjectRowsFetcher = () => Promise<unknown>

/**
 * 项目条目汇：reconcile 差异（main keyed 面板注册/注销）与名称导航数据源
 * （setProjects 整体替换、可选 setProjectRows 路径行沉淀）的落点。
 */
export interface ProjectEntrySink {
  /** 项目新增（或消失后重现）：注册该项目 main keyed 面板。 */
  addProject(name: string): void
  /**
   * 以指定 hash 路由重开项目 main keyed 面板（2026-11-11 文件右键「在 Fenix
   * 项目中定位」消费：dispose 旧注册 + 以新 src 重注册，名称集合不变故与
   * reconcile 幂等指纹无冲突）。可选：旧桩零影响。
   */
  openProjectAt?(name: string, route: string): void
  /** 项目消失：注销该项目 main keyed 面板（名称导航映射随项目列表收敛）。 */
  removeProject(name: string): void
  /** 名称导航数据源整体替换（实现应去重排序、无变化零通知）。 */
  setProjects(names: readonly string[]): void
  /** 项目路径行沉淀（对齐拉取成功时驱动；缺省可选，旧桩零影响）。 */
  setProjectRows?(rows: readonly ProjectRowInfo[]): void
  /** ProjectSummary 精简投影沉淀（tooltip 富提示数据源；缺省可选，旧桩零影响）。 */
  setProjectSummaries?(summaries: readonly ProjectSummaryProjection[]): void
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
 * 非 projects 数组抛错（按拉取失败处理），空数组合法；缺失/非字符串 name
 * 的行跳过并计数 warn（行级形状漂移可观测）；projects 非空但全部行无有效
 * name 视为形状漂移（如 name 字段改名），抛错走「拉取失败保留既有状态」
 * 路径，防止把「项目全部消失」伪装成合法空列表而注销全部面板。
 */
export function parseProjectNames(payload: unknown): string[] {
  const projects = (payload as { projects?: unknown } | null | undefined)?.projects
  if (!Array.isArray(projects)) {
    throw new Error('fenix-dsh-dashboard-bridge: /api/projects 应答形状异常（projects 非数组）')
  }
  const names: string[] = []
  let skipped = 0
  for (const item of projects) {
    const name = (item as { name?: unknown } | null | undefined)?.name
    if (typeof name === 'string' && name.length > 0) names.push(name)
    else skipped += 1
  }
  if (projects.length > 0 && names.length === 0) {
    throw new Error(
      `fenix-dsh-dashboard-bridge: /api/projects 应答形状异常（${projects.length} 行均无有效 name，疑似字段漂移）`,
    )
  }
  if (skipped > 0) {
    console.warn(
      `[fenix-dsh-dashboard-bridge] /api/projects ${skipped}/${projects.length} 行缺失/非字符串 name，已跳过`,
    )
  }
  return names
}

/**
 * 解析 `/api/projects` 应答为 ProjectSummary 精简投影数组（tooltip 富提示
 * 数据面）：以 names 序为准逐项目取应答行——行缺失（拉取滞后/项目瞬变）该
 * 项目不产出投影行（tooltip 判「投影缺失」回退原生，不逐行 warn 防 60s 刷屏）；
 * 行在而字段缺失/形状漂移一律 null 口径（不伪装 0）。projects 非数组抛错
 * （与 parseProjectNames 同口径：形状漂移按拉取失败处理，保留既有投影）。
 */
export function parseProjectSummaries(payload: unknown, names: readonly string[]): ProjectSummaryProjection[] {
  const projects = (payload as { projects?: unknown } | null | undefined)?.projects
  if (!Array.isArray(projects)) {
    throw new Error('fenix-dsh-dashboard-bridge: /api/projects 应答形状异常（projects 非数组）')
  }
  const strOf = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
  const numOf = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const byName = new Map<string, unknown>()
  for (const item of projects) {
    const name = (item as { name?: unknown } | null | undefined)?.name
    if (typeof name === 'string' && name.length > 0) byName.set(name, item)
  }
  const countsOf = (value: unknown): Readonly<Record<string, number>> | null => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const counts: Record<string, number> = {}
    let seen = 0
    for (const [status, count] of Object.entries(value as Record<string, unknown>)) {
      seen += 1
      const n = numOf(count)
      if (n !== null) counts[status] = n
    }
    return seen > 0 ? counts : null
  }
  const summaries: ProjectSummaryProjection[] = []
  for (const name of names) {
    const row = byName.get(name)
    if (row === undefined) continue // 行缺失：投影不产出（tooltip 回退原生）
    const record = row as Record<string, unknown>
    summaries.push({
      name,
      // path 复用 parseProjectPath 判据（exists:true 且非空字符串才可用）。
      path: parseProjectPath(payload, name),
      description: strOf(record.description),
      daemon: strOf(record.daemon),
      hosting: strOf(record.hosting),
      exists: record.exists === true,
      discovered: record.discovered === true,
      error: strOf(record.error),
      status_counts: countsOf(record.status_counts),
      task_done: numOf(record.task_done),
      task_total: numOf(record.task_total),
      active_runs: numOf(record.active_runs),
    })
  }
  return summaries
}

/**
 * 解析指定项目在 `/api/projects` 应答中的目录路径（项目行「新建会话」action
 * 对无工作区项目自动建工作区用）：仅接受 `exists: true` 且 `path` 为非空
 * 字符串的行——目录不存在的注册行（exists=false）拿不到可用路径，返回 null
 * （调用方 warn 降级）。项目未注册/应答形状异常同样返回 null（与主链路的
 * 抛错口径不同：这是点击期单次查询，静默降级即可，不产生未处理异常）。
 */
export function parseProjectPath(payload: unknown, name: string): string | null {
  const projects = (payload as { projects?: unknown } | null | undefined)?.projects
  if (!Array.isArray(projects)) return null
  for (const item of projects) {
    const row = item as { name?: unknown; path?: unknown; exists?: unknown } | null | undefined
    if (row?.name !== name) continue
    if (row.exists !== true) return null
    return typeof row.path === 'string' && row.path.length > 0 ? row.path : null
  }
  return null
}

/**
 * 工作区注册路径归一化（D2 判据前处理）：统一分隔符（`\` → `/`）、去尾斜杠。
 * client 运行于浏览器无 fs.realpath，MUST NOT 依赖 fs 规范化（不承诺 symlink
 * 别名归并）；仅做字符串形态归一，其余逐字符比对。
 */
export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * 行-项目匹配判据（move-project-nav-to-workspace-rows D2，刻意严于既有
 * resolveWorkspaceForProject 的标题优先序——标题命中的可能是用户自建同名
 * 目录工作区，路径身份才是真项目行）：路径身份优先——项目路径在场时仅
 * 归一化路径相等命中（标题不回落，同名标题非同路径不命中）；项目路径不可得
 * （exists=false/形状漂移/对齐拉取滞后）时以工作区标题与项目名精确相等兜底。
 * 未命中返回 null。
 */
export function matchWorkspaceForProject(
  items: readonly WorkspaceItemLike[],
  projectPath: string | null,
  projectName: string,
): WorkspaceItemLike | null {
  if (projectPath !== null) {
    const target = normalizeWorkspacePath(projectPath)
    return items.find((item) => normalizeWorkspacePath(item.path) === target) ?? null
  }
  return items.find((item) => item.title === projectName) ?? null
}

/**
 * 项目 ↔ 工作区行映射（名称导航数据面）：以 projects 为准逐项目求命中行
 * （rows 仅供路径查询，缺失按路径不可得走标题兜底）。同一工作区行被多项目
 * 命中时首个项目胜出（项目名唯一性下不应发生，防御保留）。
 */
export function buildProjectRowMap(
  items: readonly WorkspaceItemLike[],
  projects: readonly string[],
  rows: readonly ProjectRowInfo[],
): Map<string, string> {
  const pathOf = new Map(rows.map((row) => [row.name, row.path] as const))
  const map = new Map<string, string>()
  for (const name of projects) {
    const hit = matchWorkspaceForProject(items, pathOf.get(name) ?? null, name)
    if (hit !== null && !map.has(hit.workspaceId)) map.set(hit.workspaceId, name)
  }
  return map
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
  /** 差异落点（main keyed 面板注册/注销 + 名称导航数据源）。 */
  readonly sink: ProjectEntrySink
  /** 轮询周期；缺省 60s；非有限/非正数回退缺省，低于 5s 下界的钳到 5s（均 warn 一次）。 */
  readonly intervalMs?: number
  /** 计时/焦点钩子；缺省真实 setInterval + window focus。 */
  readonly timer?: SyncTimer
  /** 工作区快照枚举（对齐步；缺省 undefined 时整段禁用）。 */
  readonly workspaceItems?: () => readonly WorkspaceItemLike[]
  /** 工作区注册 API（对齐步；缺省 undefined 时整段禁用）。 */
  readonly createWorkspace?: (input: { readonly path: string }) => Promise<{ readonly workspaceId: string }>
  /** 项目行拉取器（对齐步；缺省 undefined 时整段禁用）。 */
  readonly fetchProjectRows?: ProjectRowsFetcher
}

/**
 * 工作区自动对齐步（move-project-nav-to-workspace-rows D3）：本轮 names 拉取
 * 成功后，exists 可达项目 × 工作区快照求差（matchWorkspaceForProject 同序
 * 判据），缺失者 `workspaces.create({ path })` 注册（不开会话）——只增不改
 * 不删；对齐拉取失败/超时跳过整轮（不建不删）；逐项目注册失败 warn 跳过
 * （下轮重试）。依赖任一缺席整段禁用（零动作，不产生未处理异常）。
 *
 * 快照瞬空防护（同 panels.tsx rescan 口径）：`seen` 记录对齐循环是否见过
 * 非空快照——曾非空后转空 = 宿主重载空窗（判定面不可信），本轮不判差
 * 不建区（只增不删，瞬窗误建无法回收），等下一轮快照恢复再对齐；从未非
 * 空过的首启真真空才放行创建。
 */
async function alignWorkspaces(
  options: ProjectSyncOptions,
  names: readonly string[],
  isStopped: () => boolean,
  seen: { hasNonEmptyItems: boolean },
): Promise<void> {
  const fetchRows = options.fetchProjectRows
  const listItems = options.workspaceItems
  const createWorkspace = options.createWorkspace
  if (fetchRows === undefined || listItems === undefined || createWorkspace === undefined) return
  let payload: unknown
  try {
    payload = await fetchRows()
  } catch (error) {
    console.warn(
      `[fenix-dsh-dashboard-bridge] 工作区对齐拉取项目列表失败（本轮跳过，不建不删）：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return
  }
  // 行信息沉淀（名称导航路径判据消费；本轮 names 为准，setProjectRows 可选）。
  const rows: ProjectRowInfo[] = names.map((name) => ({ name, path: parseProjectPath(payload, name) }))
  options.sink.setProjectRows?.(rows)
  // 投影沉淀（tooltip 富提示数据源）：同一 payload 三路复用（names 解析/路径
  // 行/投影），零额外请求。形状漂移（projects 非数组）→ 保留既有投影（warn，
  // 与拉取失败同口径），不产生未处理异常。
  try {
    options.sink.setProjectSummaries?.(parseProjectSummaries(payload, names))
  } catch (error) {
    console.warn(
      `[fenix-dsh-dashboard-bridge] 项目投影解析失败（保留既有投影，等下一轮重试）：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const items = listItems()
  if (items.length > 0) seen.hasNonEmptyItems = true
  else if (seen.hasNonEmptyItems) {
    // 快照瞬空（曾非空后转空——实测 dsh Remote model 周期性重载时 items 瞬空，
    // 同 panels.tsx rescan 防护口径）：判定面不可信，本轮不判差不建区（只增
    // 不删，瞬窗误建的工作区不会被回收），等下一轮快照恢复后再对齐。
    console.warn('[fenix-dsh-dashboard-bridge] 工作区快照瞬空（此前曾非空），本轮对齐跳过（不建区，等快照恢复）')
    return
  }
  for (const row of rows) {
    if (isStopped()) return
    if (row.path === null) continue // 目录不可达项目不对齐（D3：exists 判据前置）
    if (matchWorkspaceForProject(items, row.path, row.name) !== null) continue
    try {
      await createWorkspace({ path: row.path })
    } catch (error) {
      console.warn(
        `[fenix-dsh-dashboard-bridge] 工作区对齐注册失败（项目 ${row.name}，跳过等下轮重试）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

/**
 * 启动项目列表同步循环：立即拉取一次，随后按周期 + 窗口聚焦重拉。
 * 返回停止函数：清定时器、退订焦点、丢弃在途拉取结果；再次调用安全。
 */
export function startProjectSync(options: ProjectSyncOptions): () => void {
  const intervalMs = normalizeIntervalMs(options.intervalMs)
  const timer = options.timer ?? defaultTimer()
  let current: ReadonlySet<string> = new Set()
  let stopped = false
  let inFlight = false
  // 对齐步快照形态记忆（跨轮持久、每循环实例独立）：见过非空快照后，空快照按瞬窗处理。
  const alignSeen = { hasNonEmptyItems: false }

  const pull = async (): Promise<void> => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const names = await options.fetchProjects()
      if (!stopped) {
        current = reconcileProjects(current, names, options.sink)
        options.sink.setProjects(names)
        await alignWorkspaces(options, names, () => stopped, alignSeen)
      }
    } catch (error) {
      // 拉取失败：仅保留既有状态（面板与数据源原样），无未处理异常，
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
