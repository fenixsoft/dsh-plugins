/**
 * fenix-dsh-dashboard-bridge Client 半（dsh.client, platform web）：
 * 向 `sidebar.panellist` 列表插槽注册 5 个固定菜单条目（概览/指挥中心/配置/
 * 运维/帮助，order 10–18；「Fenix 项目」曾于 2026-11-11 上午挂上左侧 rail，
 * 同日 m02220 用户纠正「侧边栏」语义——指对话界面右上角的面板列（右缘
 * dock，工作区文件/代码审查变更所在），非左侧菜单栏——遂移除 rail 条目，
 * 改由 rightTab.tsx 在右侧边栏注册「Fenix 项目」页签）并以 priority -10
 * 遮蔽重排官方 Plugins/自动化任务 条目（reorderOfficialPanels，零改 dist）；
 * 在 layout `main` keyed 插槽挂对应 iframe
 * 面板（hash 深链直达）；启动时拉取 `<prefix>/api/projects` 驱动每项目 main
 * keyed 面板（深链 `#/projects/<name>` 契约不变）与官方工作区行「名称导航」
 * （installWorkspaceNav：fenix 项目工作区行名称点击 = 打开该项目详情，
 * 行首图标维持原生展开/收缩），60s 周期 + window focus 重拉并幂等同步
 * （含工作区自动对齐：新项目经 workspaces.create 自动注册，见 projectSync.ts）。
 * 另注册 dsh 文件右键菜单「在 <项目名> 项目定位」（registerFileContextMenu，
 * 2026-11-11 用户需求：文件路径 → 项目前缀匹配 → 优先右侧边栏「Fenix 项目」
 * 页签 openTab 深链直达该文件，sidebarRight 缺席回退 main 面板路径）。
 * boot 后等工作区列表就绪调 startSession() 落新会话
 * 界面（bootToNewSession，进入/刷新不再落入上次会话视图，2026-11-05 二次
 * 定调覆盖同日「落概览」先行指令）。
 *
 * 注册形态对照发行包 @deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js：
 * `ctx.slots.inject(slotName, factory)` + `ctx.slots.register(options, component)`，
 * 侧栏条目组件为图标组件（props {size, active}），main 条目以 `key` 注册。
 * 程序化面板切换入口 = `ctx.layout.selectPanel(id)`（见 src/types/dsh-runtime.d.ts
 * 类型缝注释）。插件卸载时：固定条目由 inject 工厂返回的 disposer 注销；项目
 * main 面板由同步停止函数统一 dispose；名称导航拦截层由其停止函数移除；右键
 * 菜单贡献由其 unregister 注销；右侧边栏页签由 registerFenixRightTab 的组合
 * disposer 注销。
 */
import type { Context } from '@deepseek-ai/cordis'
import { buildPanelSrc, resolveBridgeConfig } from '../shared/config.js'
import type { BridgeConfigInput } from '../shared/config.js'
import { DashboardPanel, fixedIconComponent, installWorkspaceNav, projectGroupStore } from './panels.js'
import type { FixedEntryId } from './panels.js'
import { registerFileContextMenu } from './locate.js'
import {
  createSidebarProjectOpener,
  LOCATE_ICON_KEY,
  registerFenixRightTab,
  registerLocateMenuIcon,
} from './rightTab.js'
import {
  DEFAULT_POLL_INTERVAL_MS,
  parseProjectNames,
  parseProjectPath,
  startProjectSync,
} from './projectSync.js'
import type {
  ProjectEntrySink,
  ProjectListFetcher,
  ProjectRowsFetcher,
  SyncTimer,
  WorkspaceItemLike,
} from './projectSync.js'

/** 本插件消费的 client 服务键（无 RPC 需求，不引 api-remotes）：sessions
 * （文件右键解析会话 workspace 根，dsh-client-ui-session）、contextMenus
 * （文件右键菜单贡献，dsh-client-ui-context-menu）2026-11-11 追加；
 * sidebarRight/sidebarRightTabs（右侧边栏页签，dsh-client-ui-sidebar-right）
 * 同日 m02220 语义纠正后追加——「Fenix 项目」落对话界面右缘 dock。 */
export const inject = [
  'slots',
  'layout',
  'uiWorkspace',
  'workspaces',
  'sessions',
  'contextMenus',
  'sidebarRight',
  'sidebarRightTabs',
]

/** 5 个固定条目：id 与深链一一对应，order 10–18（「Fenix 项目」已移入右侧
 * 边栏页签，见 rightTab.tsx）。 */
export interface FixedEntry {
  readonly id: FixedEntryId
  readonly label: string
  readonly route: string
  readonly order: number
}

export const FIXED_ENTRIES: readonly FixedEntry[] = [
  // order 段位（2026-11-05 用户指令重排）：概览 10 / 配置 13 为桥接原段位；
  // 运维 15、指挥中心 16、帮助 18——插件菜单（官方 order 0，经下方
  // OFFICIAL_PANEL_REORDER 遮蔽改写为 14）落到配置之后，指挥中心(16)与自动
  // 化任务（官方 order 10，遮蔽改写为 17）落到运维之后。
  // 设置条目名「配置」（2026-11-05 用户指令）：避让 dsh web 既有「设置」官方菜单。
  { id: 'fenix-overview', label: '概览', route: '#/overview', order: 10 },
  { id: 'fenix-command-center', label: '指挥中心', route: '#/command-center', order: 16 },
  { id: 'fenix-settings', label: '配置', route: '#/settings', order: 13 },
  { id: 'fenix-activities', label: '运维', route: '#/activities', order: 15 },
  { id: 'fenix-help', label: '帮助', route: '#/help', order: 18 },
]

/**
 * 官方面板重排表（2026-11-05 用户指令）：sidebar.panellist 为 list 槽——cell
 * 键 = options.id，entries 按 priority 升序稳定重排后每 cell 取首个
 * （dsh-client-ui-slots entriesOfSlot 契约）——以更低 priority 重注册同 id 即
 * 遮蔽官方注册，仅改写 order 落位；label/icon 组件复用官方 entry 的引用
 * （渲染观感零变化）。零改 dist：官方注册保持原样，宿主升级不破坏本表语义
 * （官方 id 漂移时重排项自动缺席、降级为官方排位，不崩）。
 */
const OFFICIAL_PANEL_REORDER: readonly { readonly id: string; readonly order: number }[] = [
  // 插件（官方 plugin-manager 注册 order 0 排首位）→ 挪到配置(13)之后
  { id: 'plugins', order: 14 },
  // 自动化任务（官方 schedule 注册 order 10）→ 挪到指挥中心(16)之后
  { id: 'schedules', order: 17 },
]

/**
 * 官方面板遮蔽重排：订阅 panellist 变更，官方 id 在场（entriesOfSlot 胜出者）
 * 即以 priority -10 重注册同 id 改写 order，label/icon 复用官方 entry 引用；
 * 全部到位后自动退订。事件驱动零时序假设——官方注册无论先于还是晚于本插件
 * apply 都会在下一次条目变更后被捕获。id 漂移（升级改 id）时对应项静默缺席
 * （降级为官方排位），已到位项不受影响。
 *
 * @returns 退订函数（含未到位项的等待订阅；插件卸载统一收口）。
 */
export function reorderOfficialPanels(ctx: Context): () => void {
  // 形状漂移/测试桩自守：facade 缺 entriesOfSlot/subscribe（dsh 升级改名或桩
  // 上下文）时整体跳过（降级官方排位），不产生未处理异常（design Risks 条款）。
  if (typeof ctx.slots.entriesOfSlot !== 'function' || typeof ctx.slots.subscribe !== 'function') {
    return () => {}
  }
  const done = new Set<string>()
  const attempt = () => {
    let entries: ReturnType<Context['slots']['entriesOfSlot']>
    try {
      entries = ctx.slots.entriesOfSlot('sidebar.panellist')
    } catch {
      return // 插槽未声明（形状漂移）：等下一次变更再试
    }
    for (const target of OFFICIAL_PANEL_REORDER) {
      if (done.has(target.id)) continue
      const found = entries.find((entry) => entry.options.id === target.id)
      if (found === undefined) continue
      try {
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: target.id,
            order: target.order,
            priority: -10,
            label: found.options.label,
          },
          found.component,
        )
        done.add(target.id)
      } catch (error) {
        console.warn(
          `[fenix-dsh-dashboard-bridge] 官方面板 ${target.id} 重排注册失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        done.add(target.id) // 失败也不重试（同 id 同 priority 冲突等恒定错误）
      }
    }
    if (done.size >= OFFICIAL_PANEL_REORDER.length) unsubscribe()
  }
  const unsubscribe = ctx.slots.subscribe('sidebar.panellist', attempt)
  attempt() // 官方先于本插件注册时首轮即中
  return unsubscribe
}

/**
 * boot 落新会话（2026-11-05 用户指令二次定调「进入/刷新默认停留在新会话界面」，
 * 覆盖同日先行指令「落概览」）：工作区模块的 restoreSelection 在 boot 链路把
 * mainReference 重开到上次会话（持久化 `dsh.sessions.current` 恢复 +
 * recentWorkspace 兜底，两条路都绕不开），默认落点是上次会话视图。本插件
 * boot 后短轮询调 `uiWorkspace.startSession()`——原生侧栏 New Session 按钮逐键
 * 路径（新建/复用空白会话，blank 会话即新会话界面）。URL 带 `#panel=<id>` 深
 * 链时改走 selectPanel 直达该面板（深链优先于默认落点）。门禁：工作区 list
 * 相位 'ready' 后才触发（过早调用 target 解析不到会 clearMain 落「选择工作区」
 * 空态，与按钮点击观感不符）；250ms ×40 上限；node 环境（vitest 单测）无
 * window 整段跳过，不产计时器泄漏。
 */
function bootToNewSession(ctx: Context): () => void {
  if (typeof window === 'undefined') return () => {}
  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    const ui = ctx.uiWorkspace
    if (ui === undefined) {
      clearInterval(timer)
      return
    }
    const phase = ui.workspaces?.list?.getSnapshot?.().phase
    if (phase !== 'ready' && tries < 40) return
    clearInterval(timer)
    if (phase !== 'ready') {
      console.warn('[fenix-dsh-dashboard-bridge] boot 落新会话失败：工作区列表未就绪')
      return
    }
    const hashPanelId = panelIdFromHash()
    if (hashPanelId !== null) {
      // 深链优先：URL 带 #panel=<id> 直达该面板，默认新会话落点让位
      try {
        ctx.layout?.selectPanel?.(hashPanelId)
      } catch {
        console.warn(`[fenix-dsh-dashboard-bridge] 深链面板 ${hashPanelId} 未注册，维持默认落点`)
      }
      return
    }
    try {
      ui.startSession()
    } catch (error) {
      console.warn(
        `[fenix-dsh-dashboard-bridge] boot 落新会话失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }, 250)
  return () => {
    clearInterval(timer)
  }
}

/** 项目 main 面板键：`fenix-project-<name>`（与旧顶层条目 id 一致，深链契约不变）。 */
export function projectIdFor(name: string): string {
  return `fenix-project-${name}`
}

/** 项目面板深链：`#/projects/<name>`（name 经 URI 编码）。 */
export function projectRouteFor(name: string): string {
  return `#/projects/${encodeURIComponent(name)}`
}

/** apply 的可注入选项：prefix 供测试/定制，其余注入点仅供单测桩用。 */
export interface ClientPluginOptions extends BridgeConfigInput {
  /** 项目列表拉取桩（缺省 fetch `<prefix>api/projects`）。 */
  readonly fetchProjects?: ProjectListFetcher
  /** 轮询周期（缺省 60s）。 */
  readonly intervalMs?: number
  /** 计时/焦点钩子桩（缺省真实定时器 + window focus）。 */
  readonly timer?: SyncTimer
}

/** 默认项目列表拉取超时（毫秒）：悬挂请求超时后 abort，不让同步循环永久停摆。 */
const FETCH_PROJECTS_TIMEOUT_MS = 10_000

/** 默认项目列表拉取：GET `<prefix>api/projects` → parseProjectNames（10s 超时）。 */
export function defaultFetchProjects(prefix: string): ProjectListFetcher {
  return async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_PROJECTS_TIMEOUT_MS)
    try {
      const response = await fetch(`${prefix}api/projects`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`fenix-dsh-dashboard-bridge: 拉取项目列表失败 HTTP ${response.status}`)
      }
      return parseProjectNames(await response.json())
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * 项目名称点击 → 激活该项目 main keyed 面板（工作区行名称导航的落点，
 * move-project-nav-to-workspace-rows）：`ctx.layout.selectPanel(projectId)`
 * （未注册面板会抛错——吞掉并 warn，不产生未处理异常）；layout 服务缺失
 * （异常环境）时保持静默降级。
 */
export function projectPanelSelector(ctx: Context): (name: string) => void {
  return (name: string) => {
    try {
      ctx.layout?.selectPanel?.(projectIdFor(name))
    } catch (error) {
      console.warn(
        `[fenix-dsh-dashboard-bridge] 切换项目面板失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

/** 项目行「新建会话」action 的可注入依赖（测试桩用）。 */
export interface SessionStarterDeps {
  /** 项目目录路径查询桩（缺省 GET `<prefix>api/projects` 解析 exists 行）。 */
  readonly fetchProjectPath?: (name: string) => Promise<string | null>
}

/**
 * 项目行「新建会话」action：已有对应 dsh 工作区 → 原生
 * `uiWorkspace.startSession(workspaceId)`（新建/复用空白会话并把主面板切回
 * 会话视图，与工作区行 rowActions 的 + 按钮行为逐键相同）；无对应工作区 →
 * 按项目目录自动建工作区（原生 addWorkspace adoptDirectory 的
 * `workspaces.create({ path })` 同键）后同样 startSession——fenix 项目即
 * 目录，注册过 dashboard 的项目必可落成工作区。服务缺失（异常环境/测试桩）、
 * 目录不可得（exists=false）或创建失败时 console.warn 降级，不产生未处理
 * 异常。async 内核 fire-and-forget：点击回调保持同步签名。
 */
export function projectSessionStarter(
  ctx: Context,
  prefix: string,
  deps?: SessionStarterDeps,
): (name: string) => void {
  const fetchPath = deps?.fetchProjectPath ?? defaultFetchProjectPath(prefix)
  return (name: string) => {
    void startProjectSessionInner(ctx, fetchPath, name)
  }
}

/** 新建会话主流程（全量错误路径 warn 落日志，不外溢）。`prompt` 缺省为无
 * draft options（原生空白新会话）；非空时经 `startSession(ws, { prompt })`
 * 预填新会话输入框首行（新会话 draft 恒空必 applied）——dashboard 内嵌页
 * 「新会话」按钮（installDashboardSessionRequests）的「对于 XXXX SPEC：」
 * 前缀即走此参数。 */
async function startProjectSessionInner(
  ctx: Context,
  fetchPath: (name: string) => Promise<string | null>,
  name: string,
  prompt?: string,
): Promise<void> {
  try {
    const ui = ctx.uiWorkspace
    if (ui === undefined) {
      console.warn('[fenix-dsh-dashboard-bridge] uiWorkspace 服务不可用，无法新建会话')
      return
    }
    // 空串/纯空白 prompt 视同未携带（不产生空 draft options）。
    const draftOptions = prompt !== undefined && prompt.trim() !== '' ? { prompt } : undefined
    const existing = resolveWorkspaceIdForProject(ui.workspaces.list.getSnapshot().items, name)
    if (existing !== null) {
      ui.startSession(existing, draftOptions)
      return
    }
    const workspaces = ctx.workspaces
    if (workspaces === undefined) {
      console.warn(
        `[fenix-dsh-dashboard-bridge] 项目 ${name} 无对应工作区且 workspaces 服务不可用，无法自动建工作区`,
      )
      return
    }
    const path = await fetchPath(name)
    if (path === null) {
      console.warn(`[fenix-dsh-dashboard-bridge] 项目 ${name} 无可用目录（未注册或目录不存在），无法新建会话`)
      return
    }
    const created = await workspaces.create({ path })
    ui.startSession(created.workspaceId, draftOptions)
  } catch (error) {
    console.warn(
      `[fenix-dsh-dashboard-bridge] 新建会话失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/** 默认项目目录查询：GET `<prefix>api/projects` → parseProjectPath（10s 超时，同主链路口径）。 */
export function defaultFetchProjectPath(prefix: string): (name: string) => Promise<string | null> {
  return async (name) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_PROJECTS_TIMEOUT_MS)
    try {
      const response = await fetch(`${prefix}api/projects`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`fenix-dsh-dashboard-bridge: 拉取项目列表失败 HTTP ${response.status}`)
      }
      return parseProjectPath(await response.json(), name)
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * 项目名 → dsh 工作区 id 解析（纯函数，可独立单测）：title 精确匹配优先，
 * 回落 path 末段（'/' 或 '\\' 分隔的 basename）匹配——fenix 项目名即工作区
 * 目录名，两种口径覆盖 title 被用户改名过的工作区。未命中返回 null。
 */
export function resolveWorkspaceIdForProject(
  items: readonly { workspaceId: string; path: string; title: string }[],
  name: string,
): string | null {
  const basenameOf = (path: string): string => {
    const segments = path.split(/[\\/]/)
    return segments[segments.length - 1] ?? ''
  }
  const byTitle = items.find((item) => item.title === name)
  if (byTitle !== undefined) return byTitle.workspaceId
  const byBasename = items.find((item) => basenameOf(item.path) === name)
  return byBasename?.workspaceId ?? null
}

/* ============ dashboard 内嵌页「新会话」请求通道（add-dsh-new-session-button） ============ */

/** iframe → 宿主「新建会话」消息 kind 常量（dashboard 侧镜像值：fenixd
 *  core/dashboard/static/src/utils/embedBridge.ts HOST_NEW_SESSION_KIND——
 *  双仓字面量必须逐字节一致，任一侧改动必改另一侧，两侧单测各自钉值）。 */
export const HOST_NEW_SESSION_KIND = 'fenix-dashboard:new-session'

/** 解析通过的请求载荷（project 必填非空；prompt 可选任意非受限字符串）。 */
export interface HostNewSessionRequest {
  readonly project: string
  readonly prompt?: string
}

/**
 * 消息形状校验（纯函数，独立单测）：非对象/kind 不符/project 非空串/
 * prompt 非串（含 undefined 合法）→ null（吞）。kind 常量单点鉴别——宿主
 * window 上可能并存其它插件的 message 监听，本桥只认自己的信封。
 */
export function parseHostNewSessionMessage(data: unknown): HostNewSessionRequest | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  if (record.kind !== HOST_NEW_SESSION_KIND) return null
  if (typeof record.project !== 'string' || record.project === '') return null
  if (record.prompt !== undefined && typeof record.prompt !== 'string') return null
  return record.prompt === undefined
    ? { project: record.project }
    : { project: record.project, prompt: record.prompt }
}

/**
 * dashboard 内嵌页「新会话」按钮宿主半（2026-11-11 用户需求）：监听同源
 * dashboard iframe 的 postMessage（`{ kind, project, prompt? }`，形状见
 * parseHostNewSessionMessage；kind 与载荷契约在 dashboard 侧 embedBridge.ts
 * 双仓镜像），命中后走 startProjectSessionInner——以 project 定位/自动建
 * 工作区并原生新建会话，prompt 预填输入框首行（SPEC 详情页「对于 XXXX
 * SPEC：」前缀）。
 *
 * 安全口径：iframe 经 `/fenix-dashboard/` 同源前缀反代嵌入，event.origin
 * 必须等于宿主 origin（跨源一律忽略）；载荷形状校验兜底；执行结果不经
 * 通道回传，主面板视图切换本身即用户可见反馈（fire-and-forget，与按钮
 * 侧口径一致）。window 缺席（node 环境/异常宿主）→ no-op 降级注册。
 *
 * @returns 注销函数（幂等安全：removeEventListener 重复调用零副作用）。
 */
export function installDashboardSessionRequests(
  ctx: Context,
  prefix: string,
  deps?: SessionStarterDeps,
): () => void {
  if (typeof window === 'undefined') {
    console.warn('[fenix-dsh-dashboard-bridge] window 不可用，dashboard 新会话请求通道降级 no-op')
    return () => {}
  }
  const fetchPath = deps?.fetchProjectPath ?? defaultFetchProjectPath(prefix)
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return
    const request = parseHostNewSessionMessage(event.data)
    if (request === null) return
    void startProjectSessionInner(ctx, fetchPath, request.project, request.prompt)
  }
  window.addEventListener('message', onMessage)
  return () => {
    window.removeEventListener('message', onMessage)
  }
}

/** 默认项目行拉取：GET `<prefix>api/projects` → 原始应答（工作区对齐步逐行
 * 解析用；10s 超时同主链路口径）。 */
export function defaultFetchProjectRows(prefix: string): ProjectRowsFetcher {
  return async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_PROJECTS_TIMEOUT_MS)
    try {
      const response = await fetch(`${prefix}api/projects`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`fenix-dsh-dashboard-bridge: 拉取项目列表失败 HTTP ${response.status}`)
      }
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * ctx → 工作区快照枚举（对齐步输入；uiWorkspace 服务缺席返回 undefined 禁用
 * 对齐）。items 形状漂移（非数组/快照抛错）按空表处理，不产生未处理异常。
 */
function workspaceItemsFrom(ctx: Context): (() => readonly WorkspaceItemLike[]) | undefined {
  const list = ctx.uiWorkspace?.workspaces?.list
  if (list === undefined) return undefined
  return () => {
    try {
      const items = list.getSnapshot().items
      return Array.isArray(items) ? items : []
    } catch {
      return []
    }
  }
}

/** ctx → 工作区注册（workspaces 服务缺席返回 undefined 禁用对齐）。注意
 * MUST 以「workspaces.create(...)」方法形态调用（receiver = 服务实例）：
 * 摘引用散调用会丢 this（WorkspaceController.create 内读 this.model 抛
 * TypeError——真实环境已踩）。 */
function createWorkspaceFrom(
  ctx: Context,
): ((input: { readonly path: string }) => Promise<{ readonly workspaceId: string }>) | undefined {
  const workspaces = ctx.workspaces
  if (workspaces === undefined) return undefined
  return (input) => workspaces.create(input)
}

/**
 * 项目 main 面板汇：ctx.slots 上 keyed 注册/注销，支持整体清理。
 * （spec 2026-10 分组化：侧栏不再逐项目注册 panellist 条目。）
 */
export function projectEntrySink(ctx: Context, prefix: string): ProjectEntrySink & { disposeAll(): void } {
  const disposers = new Map<string, () => void>()
  const registerProjectPanel = (name: string, route: string): void => {
    // 防御自守：重名重复 add 先注销旧注册，避免旧 disposer 被覆盖后无法注销（泄漏）。
    disposers.get(name)?.()
    const src = buildPanelSrc(prefix, route)
    const disposePanel = ctx.slots.register({ name: 'main', key: projectIdFor(name) }, () =>
      DashboardPanel({ src }),
    )
    disposers.set(name, disposePanel)
  }
  return {
    addProject(name) {
      registerProjectPanel(name, projectRouteFor(name))
    },
    openProjectAt(name, route) {
      // 文件右键「在 Fenix 项目中定位」落点：dispose 旧 + 以深链 src 重注册
      // （面板无 keep-alive，重注册是唯一让 iframe 载入新 hash 的途径）。
      registerProjectPanel(name, route)
    },
    removeProject(name) {
      const dispose = disposers.get(name)
      if (dispose !== undefined) {
        dispose()
        disposers.delete(name)
      }
      // 名称导航映射随 projectGroupStore.setProjects 收敛（删除项目行失去
      // 拦截层回退原生），此处无残留态。
    },
    setProjects(names) {
      projectGroupStore.setProjects(names)
    },
    setProjectRows(rows) {
      // 2026-11-11 修复：此前 sink 漏实现本方法——alignWorkspaces 的可选调用
      // `options.sink.setProjectRows?.(rows)` 被静默跳过，projectGroupStore 的
      // projectRows 恒为空，文件右键「在 Fenix 项目中定位」与名称导航路径判据
      // 全部失效（类型面可选方法逃过了 tsc，桩齐活的全量测试也未暴露）。
      projectGroupStore.setProjectRows(rows)
    },
    setProjectSummaries(summaries) {
      projectGroupStore.setSummaries(summaries)
    },
    disposeAll() {
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
    },
  }
}

/**
 * 面板深链 hash 解析（外层文档 URL：`#panel=<id>`）。与 iframe 内部的 dashboard
 * hash 路由（#/overview 等）互不相干——iframe 有独立 URL 命名空间。无 hash 或
 * 值为空返回 null。
 */
export function panelIdFromHash(): string | null {
  if (typeof window === 'undefined') return null
  const PANEL_HASH_PREFIX = '#panel='
  if (!window.location.hash.startsWith(PANEL_HASH_PREFIX)) return null
  const id = decodeURIComponent(window.location.hash.slice(PANEL_HASH_PREFIX.length))
  return id.length > 0 ? id : null
}

/**
 * 面板深链双向桥（2026-11-05 用户需求「菜单切换体现在 URL、可经 URL 直达」）：
 * dsh 原生面板选中无 hash 事实源（layout client 无 hashchange 监听、无面板
 * 订阅口），插件侧双向补齐、零改 dist——
 * - 写向：包装 `ctx.layout.selectPanel`（ui-sidebar 行点击即
 *   `ctx.layout.selectPanel(id)` 动态调用，包装拦全部切换源）。面板 id → 写
 *   `location.hash = 'panel=<id>'`（赋值产生历史条目：浏览器后退可在面板间回
 *   退，与 dashboard hash 路由同观感；hash 已同值时赋值无操作、无循环）；
 *   null（会话视图）→ `history.replaceState` 清 hash（保 token 查询串、不产
 *   垃圾历史条目、不触发 hashchange）。
 * - 读向：`hashchange` 监听 → 解析 `#panel=<id>` → selectPanel（未注册 id 抛
 *   错吞掉，维持当前视图）；刷新/分享链接/后退前进三类入口同路。
 * - boot：bootToNewSession 内 hash 深链优先于默认新会话落点（见其注释）。
 * 循环安全：hashchange → selectPanel → wrapper 复写同值 hash → 赋值无操作收敛。
 * 形状漂移/测试桩自守：无 window 或 layout.selectPanel 缺失时整体跳过。
 *
 * @returns 恢复函数（摘 hashchange 监听、还原原生 selectPanel）。
 */
export function deepLinkPanels(ctx: Context): () => void {
  if (typeof window === 'undefined') return () => {}
  const layout = ctx.layout
  if (typeof layout?.selectPanel !== 'function') return () => {}
  // 原属性值原样保存/还原（不用 bind 副本：还原须恢复身份可逆性，防双层包装
  // 残留——dispose/reload 语义下 bound 函数行为等价但身份漂移）
  const original: (panelId: string | null) => void = layout.selectPanel
  const applyHash = () => {
    const id = panelIdFromHash()
    if (id === null) return
    try {
      original.call(layout, id)
    } catch {
      // 未注册面板 id：忽略（维持当前视图）
    }
  }
  const wrapped = (panelId: string | null): void => {
    original.call(layout, panelId)
    try {
      if (panelId === null) {
        if (panelIdFromHash() !== null) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
        }
        return
      }
      const want = '#panel=' + encodeURIComponent(panelId)
      if (window.location.hash !== want) window.location.hash = want
    } catch {
      // 历史操作失败不致命（隐私模式等）
    }
  }
  layout.selectPanel = wrapped
  window.addEventListener('hashchange', applyHash)
  return () => {
    window.removeEventListener('hashchange', applyHash)
    layout.selectPanel = original
  }
}

/**
 * Client 插件体：注册固定条目与 main 面板，启动项目列表同步（含工作区自动
 * 对齐）与工作区行名称导航。slot 形状漂移（dsh 升级改名）时注册不生效、
 * 页面不崩（design Risks）。
 *
 * @returns 停止函数：撤名称导航拦截层、停同步循环并 dispose 全部项目 main
 * 面板（固定条目由 inject 工厂 disposer 随插件卸载注销）。
 */
export function apply(ctx: Context, options?: ClientPluginOptions): () => void {
  const resolved = resolveBridgeConfig(options)
  const prefix = resolved.prefix

  // 固定侧栏条目（order 10–18，线性图标）；「Fenix 项目」总览入口在右侧
  // 边栏页签（m02220 语义纠正，见 rightTab.tsx），不在左侧 rail。
  ctx.slots.inject('sidebar.panellist', () => {
    const disposers = FIXED_ENTRIES.map((entry) =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: entry.id, order: entry.order, label: entry.label },
        fixedIconComponent(entry.id),
      ),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // main keyed 插槽：与侧栏条目同 id 的 iframe 面板（深链直达）。每项目面板
  // `fenix-project-<name>` 由项目同步注册（名称导航目标，契约不变）。
  // 「Fenix 项目」总览入口在右侧边栏页签（registerFenixRightTab），不在 main。
  ctx.slots.inject('main', () => {
    const disposers = FIXED_ENTRIES.map((entry) =>
      ctx.slots.register({ name: 'main', key: entry.id }, () =>
        DashboardPanel({ src: buildPanelSrc(prefix, entry.route) }),
      ),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // 官方面板遮蔽重排 + boot 落新会话 + 面板深链双向桥 + 工作区行名称导航
  // （2026-11-05 / 2026-11-09 用户指令，见各函数注释）。
  const stopReorder = reorderOfficialPanels(ctx)
  const stopBootSwitch = bootToNewSession(ctx)
  const stopDeepLink = deepLinkPanels(ctx)
  const stopWorkspaceNav = installWorkspaceNav(ctx, { selectProject: projectPanelSelector(ctx) })
  // dashboard 内嵌页「新会话」按钮宿主半（2026-11-11 用户需求）：SPEC 列表/
  // 详情页 filters 槽位按钮（仅 embed 态渲染）postMessage → 本监听新建会话
  // （prompt 前缀预填），见 installDashboardSessionRequests 注释。
  const stopHostSessionRequests = installDashboardSessionRequests(ctx, prefix)

  // 项目数据同步：main keyed 面板差异注册 + 名称导航数据源整体替换 + 工作区
  // 自动对齐（60s 周期 + window focus 幂等同步）。对齐依赖（uiWorkspace/
  // workspaces 服务）在 ctx 上装配，服务缺席整段禁用（测试桩零动作零网络）。
  const sink = projectEntrySink(ctx, prefix)
  const stopSync = startProjectSync({
    fetchProjects: options?.fetchProjects ?? defaultFetchProjects(prefix),
    sink,
    intervalMs: options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    timer: options?.timer,
    fetchProjectRows: defaultFetchProjectRows(prefix),
    workspaceItems: workspaceItemsFrom(ctx),
    createWorkspace: createWorkspaceFrom(ctx),
  })

  // 右侧边栏「Fenix 项目」页签（2026-11-11 用户需求 + m02220 语义纠正：
  // 「侧边栏」指对话界面右上角的面板列，非左侧菜单栏）：guide 菜单落项目
  // 总览，body iframe 承载 dashboard；服务缺席注册 no-op（rightTab.tsx）。
  const stopRightTab = registerFenixRightTab(ctx, prefix)

  // 文件右键「在 Fenix 项目中定位」（2026-11-11 用户需求）：resolve 期按
  // projectGroupStore 快照做路径前缀匹配（60s 同步滞后容忍——未同步到路径行
  // 时菜单项不出现，零污染）；命中后优先右侧边栏页签 openTab 深链
  // （createSidebarProjectOpener），sidebarRight 缺席回退 main 面板路径；
  // 服务缺失 registerFileContextMenu 内部降级 no-op。
  // 定位菜单图标（contextMenu.icon keyed slot，2026-11-11 用户需求：菜单项
  // 与原生项一致带图标）；服务缺失内部降级 no-op。
  const stopLocateIcon = registerLocateMenuIcon(ctx)
  const stopLocateMenu = registerFileContextMenu(
    ctx,
    {
      getProjectRows: () => projectGroupStore.getSnapshot().projectRows,
      openSidebarProjectTab: createSidebarProjectOpener(ctx),
      openProjectAt: sink.openProjectAt ?? (() => {}),
      selectProject: projectPanelSelector(ctx),
      iconKey: LOCATE_ICON_KEY,
    },
  )

  return () => {
    stopLocateIcon()
    stopLocateMenu()
    stopRightTab()
    stopWorkspaceNav()
    stopHostSessionRequests()
    stopDeepLink()
    stopBootSwitch()
    stopReorder()
    stopSync()
    sink.disposeAll()
  }
}
