/**
 * 文件右键「在 <项目名> 项目定位」（2026-11-11 用户需求；同日迭代：文案精简
 * + 菜单图标）：dsh web 文件右键菜单
 * 挂 target 'file' 贡献——把点击文件解析为绝对路径，按路径前缀匹配 Fenix 项目
 * （projectGroupStore.projectRows 数据源），命中即注入菜单项；点击后优先在
 * 右侧边栏（对话界面右缘 dock）打开「Fenix 项目」页签并携 params 深链到该
 * 文件视图（createSidebarProjectOpener，m02220 语义纠正）；sidebarRight 服务
 * 缺席时回退 main keyed 面板（iframe src 携 `#/projects/<name>?tab=home&path=
 * <rel>` 深链）并激活面板。
 *
 * 契约钉死（发行包 lib/types 源码为据）：
 * - `ctx.contextMenus.register({id, target:'file', order, resolve(target, signal)})
 *   → unregister`（@deepseek-ai/dsh-client-ui-context-menu）；
 * - file target 形状 {sessionId, path, line?, paneId?}；
 * - 绝对路径解析走 open-in-app directory 菜单同款轻量路（无 RPC）：
 *   `ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd` + resolveWorkspacePath
 *   字符串拼（服务缺失按解析失败降级，不产菜单项）。
 *
 * 全部纯函数可 node 直测；resolve/run 全错误路径 warn 降级，无未处理异常。
 */
import type { ProjectRowInfo } from './projectSync.js'
import { locateMenuLabel, pluginT } from './pluginLocale.js'
import { normalizeWorkspacePath } from './projectSync.js'

/**
 * Workspace 相对路径 → 绝对路径（open-in-app resolveWorkspacePath 同语义）：
 * 绝对路径（POSIX `/` 开头或 Windows 盘符/UNC）原样返回；相对路径以会话
 * workspace 根拼绝对（cwd 尾斜杠归一，`./` 前缀剥除）；cwd 不可得返回原值
 * （调用方按不可解析降级）。
 */
export function resolveWorkspacePath(cwd: string, path: string): string {
  const isWindowsStyle = (value: string): boolean => /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
  if (path.startsWith('/') || isWindowsStyle(path)) return path
  if (cwd === undefined || cwd === '') return path
  const separator = isWindowsStyle(cwd) && cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[/\\]+$/, '')}${separator}${path.replace(/^(?:\.?[/\\])+/, '')}`
}

/** 定位命中：项目名 + 文件相对项目的路径（POSIX 分隔，文件在项目根为空串）。 */
export interface ProjectFileLocate {
  readonly name: string
  readonly rel: string
}

/**
 * 绝对路径 → Fenix 项目定位（纯函数）：逐行取归一化项目路径（路径不可得的行
 * 不参与），absPath 必须严格位于项目路径之内或与其相等（`<root>/` 前缀或全等
 * ——防 `/root/fenixd-x` 误命中 `/root/fenixd`）；嵌套项目取最长前缀（最深
 * 项目胜出）。未命中返回 null。
 */
export function locateProjectForFile(
  absPath: string,
  rows: readonly ProjectRowInfo[],
): ProjectFileLocate | null {
  const normalized = normalizeWorkspacePath(absPath)
  if (normalized === '') return null
  let best: { readonly name: string; readonly root: string } | null = null
  for (const row of rows) {
    if (row.path === null || row.path === '') continue
    const root = normalizeWorkspacePath(row.path)
    if (root === '') continue
    if (normalized === root) {
      if (best === null || root.length > best.root.length) best = { name: row.name, root }
      continue
    }
    if (!normalized.startsWith(`${root}/`)) continue
    if (best === null || root.length > best.root.length) best = { name: row.name, root }
  }
  if (best === null) return null
  return { name: best.name, rel: normalized === best.root ? '' : normalized.slice(best.root.length + 1) }
}

/**
 * 定位深链：`#/projects/<enc>?tab=home&path=<enc-rel>`（dashboard hash 路由
 * seed 直达文件视图，path 参数已冒烟验证）；文件在项目根（rel 空串）退化为
 * 项目首页根路由（与 projectRouteFor 同形）。
 */
export function homeFileRouteFor(name: string, rel: string): string {
  if (rel === '') return `#/projects/${encodeURIComponent(name)}`
  return `#/projects/${encodeURIComponent(name)}?tab=home&path=${encodeURIComponent(rel)}`
}

/** 文件右键菜单装配依赖（index.ts 注入；测试桩替身）。 */
export interface LocateMenuDeps {
  /** 项目路径行数据源（projectGroupStore 快照投影）。 */
  readonly getProjectRows: () => readonly ProjectRowInfo[]
  /** 右侧边栏「Fenix 项目」页签 openTab 装配（createSidebarProjectOpener）；
   * 提供时为定位首选落点（2026-11-11 m02220 语义纠正：定位在对话界面右缘
   * dock 打开项目页签），缺席回退 main 面板路径。 */
  readonly openSidebarProjectTab?: (name: string, rel: string) => void
  /** 重开项目 main keyed 面板（dispose 旧注册 + 以新 src 重注册；回退路径）。 */
  readonly openProjectAt: (name: string, route: string) => void
  /** 激活项目面板（ctx.layout.selectPanel 包装，吞错降级；回退路径）。 */
  readonly selectProject: (name: string) => void
  /** 菜单图标 key（rightTab.tsx LOCATE_ICON_KEY；提供时 action 携
   * icon:{key}，菜单项与原生项一致显示定位图标）。 */
  readonly iconKey?: string
}

/** contextMenus 服务最小消费面（形状漂移/测试桩自守，见 registerFileContextMenu）。 */
export interface ContextMenusLike {
  register(contribution: {
    readonly id: string
    readonly target: 'file'
    readonly order: number
    resolve(
      target: { readonly sessionId: string; readonly path: string; readonly line?: number },
      signal: AbortSignal,
    ): readonly FileMenuAction[] | Promise<readonly FileMenuAction[]>
  }): () => void
}

/** 本插件产出的菜单 action 最小面（MenuAction 子集）。 */
export interface FileMenuAction {
  readonly id: string
  readonly label: string
  /** 菜单图标（ContextMenuIcon 子集）：key 指向本插件注册的
   * contextMenu.icon keyed slot 渲染（rightTab.tsx registerLocateMenuIcon）。
   * 2026-11-11 用户需求：菜单项与原生项一致带图标。 */
  readonly icon?: { readonly key: string }
  readonly failureLabel?: string
  run?: () => void | Promise<void>
}

/** sessions 服务最小消费面（只读 cwd 快照）。 */
export interface SessionsLike {
  readonly list: {
    getSnapshot(): { readonly byId: Record<string, { readonly cwd?: string } | undefined> }
  }
}

/** 菜单贡献 id（target 'file' 族内唯一；与插件名同域防碰撞）。 */
export const LOCATE_MENU_ID = 'fenix-dashboard-bridge.locate-in-project'

/**
 * 注册文件右键「在 Fenix 项目中定位」：contextMenus/sessions 服务缺失（异常
 * 环境或测试桩）整体跳过返回 no-op；resolve 中会话 cwd 不可得或无项目命中
 * 返回空数组（菜单不出现该项，原生菜单零污染）。命中项点击后优先 openSidebar
 * ProjectTab（右侧边栏页签深链，m02220 语义纠正），服务缺席回退 openProjectAt
 * 重开 main 面板（iframe 深链直达文件）+ selectProject 激活；run 内部错误
 * warn 后 rethrow（dsh 以 failureLabel 呈现可见失败反馈）。
 *
 * @returns 注销函数（服务缺失时为 no-op）。
 */
export function registerFileContextMenu(ctx: {
  readonly contextMenus?: ContextMenusLike
  readonly sessions?: SessionsLike
}, deps: LocateMenuDeps): () => void {
  const menus = ctx.contextMenus
  if (menus === undefined || typeof menus.register !== 'function') return () => {}
  return menus.register({
    id: LOCATE_MENU_ID,
    target: 'file',
    order: 90,
    resolve: (target, signal) => {
      try {
        let cwd: string | undefined
        try {
          cwd = ctx.sessions?.list?.getSnapshot()?.byId?.[target.sessionId]?.cwd
        } catch {
          cwd = undefined // 快照形状漂移：按解析失败降级
        }
        const abs = resolveWorkspacePath(cwd ?? '', target.path)
        const hit = locateProjectForFile(abs, deps.getProjectRows())
        if (hit === null) return []
        const route = homeFileRouteFor(hit.name, hit.rel)
        const action: FileMenuAction = {
          id: LOCATE_MENU_ID,
          // 2026-11-11 用户需求：文案「在 <项目名> 项目定位」（i18n 宿主跟随
          // 轮：label/failureLabel 经 pluginLocale 词典，求值期取当前档）。
          label: locateMenuLabel(hit.name),
          ...(deps.iconKey !== undefined && deps.iconKey !== '' ? { icon: { key: deps.iconKey } } : {}),
          failureLabel: pluginT('locate.failureLabel'),
          run: async () => {
            try {
              if (typeof deps.openSidebarProjectTab === 'function') {
                // 首选：右侧边栏「Fenix 项目」页签 openTab（pane 内 reveal 或
                // 新开，params 送达 body 重算 iframe src 深链）。
                deps.openSidebarProjectTab(hit.name, hit.rel)
              } else {
                // 回退：main keyed 面板（dispose 旧 + 新 src 重注册）+ 激活。
                deps.openProjectAt(hit.name, route)
                deps.selectProject(hit.name)
              }
            } catch (error) {
              console.warn(
                `[fenix-dsh-dashboard-bridge] 在 Fenix 项目中定位失败：${
                  error instanceof Error ? error.message : String(error)
                }`,
              )
              throw error // 可见失败（failureLabel 反馈），不留静默失败
            }
          },
        }
        void signal
        return [action]
      } catch (error) {
        // resolve 抛错会让 contextMenus 服务整单失败（failed() → 菜单不弹出，
        // 2026-11-11 线上回归）：任何形状漂移都降级为「不贡献菜单项」。
        console.warn(
          '[fenix-dsh-dashboard-bridge] resolve failed，已降级不贡献菜单项：',
          error instanceof Error ? error.message : String(error),
        )
        return []
      }
    },
  })
}
