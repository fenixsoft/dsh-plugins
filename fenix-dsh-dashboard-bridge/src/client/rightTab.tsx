/**
 * dsh web 右侧边栏「Fenix 项目」页签（2026-11-11 用户需求 + m02220 语义纠正）：
 * 「侧边栏」指对话界面右上角的面板列（工作区文件/代码审查变更所在的右缘
 * dock，@deepseek-ai/dsh-client-ui-sidebar-right），不是左侧 rail 菜单栏。
 * 本页签在右侧边栏挂一个 iframe body（复用 DashboardPanel），承载 Fenix
 * Dashboard——guide 入口默认落 #/projects 项目总览；文件右键「在 Fenix 项目
 * 中定位」（locate.ts）经 openTab 携 params 深链到该项目首页的文件视图。
 *
 * 契约钉死（发行包 @deepseek-ai/dsh-client-ui-sidebar-right 0.2.2-rc.1 lib
 * 源码为据）：
 * - 两段注册：①`ctx.sidebarRightTabs.register({id, kind, keepMounted?,
 *   priority?, title(address)=>string, guide?:[{id,order,title,
 *   description?,icon?}]})`（page 类型按 kind 打开，guide 条目出现在右缘
 *   「+」菜单）；②keyed slot `sidebar.right.pane.tab` 以 definition 的 id 为
 *   key 注册 body 组件。
 * - body 经框架注入的 `props.useTabInfo()` 读 `tab.navigation = {address,
 *   params, revision}`（files 先例 FilesBody 同款消费面）；openTab 同 kind →
 *   pane 内 reveal + 新 params 送达（revision++）——body 依 params 重算
 *   iframe src 即完成深链导航。
 * - keepMounted: true：页签内容跨隐藏/切换会话保活（iframe 状态不丢）。
 *
 * 全部形状漂移（服务缺席/props 面变化）按降级处理：注册 no-op、body 渲染
 * 项目总览兜底路由，页面不崩。
 */
import type { ReactElement } from 'react'
import { buildPanelSrc } from '../shared/config.js'
import { DashboardPanel } from './panels.js'
import { homeFileRouteFor } from './locate.js'
import { pluginT } from './pluginLocale.js'
import { currentThemeScheme } from './themeFollow.js'
import { currentLocaleScheme } from './localeFollow.js'

/** 页签 definition id（body seat 的 slot key 与之一致；files 先例以包名为 id）。 */
export const FENIX_TAB_ID = 'fenix-dsh-dashboard-bridge'

/** 页签 kind：openTab 按 kind 寻址（SidebarRightTabParamsMap 自定义 kind 零校验）。 */
export const FENIX_TAB_KIND = 'fenix-dashboard'

/** openTab params：定位深链目标（project=项目名，path=项目内相对路径）。 */
export interface SidebarFileParams {
  readonly project?: string
  readonly path?: string
}

/**
 * 侧栏 params → dashboard hash 路由（纯函数）：project 缺席/空 → 项目总览
 * 单入口 `#/projects`；否则复用 locate.ts 的 homeFileRouteFor 深链
 * `#/projects/<enc>?tab=home&path=<enc-rel>`（path 缺席视为项目根）。
 */
export function routeForSidebarParams(params: SidebarFileParams | undefined): string {
  const project = params?.project
  if (project === undefined || project === '') return '#/projects'
  return homeFileRouteFor(project, params?.path ?? '')
}

/**
 * guide 菜单图标（右缘「+」菜单条目用）：折角文件夹线性轮廓（与原左侧 rail
 * 「Fenix 项目」条目同款 glyph，24 viewBox stroke 风格）。自绘 React svg，
 * 不依赖 primitives 的具名图标（IconProps 结构兼容 {size?}）。
 */
const FOLDER_GLYPH = 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'

export function FenixGuideIcon(props?: { readonly size?: number }): ReactElement {
  const size = props?.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={FOLDER_GLYPH} />
    </svg>
  )
}

/**
 * sidebar-right 服务最小消费面（形状漂移/测试桩自守；只列本插件消费的键）。
 */
export interface SidebarRightTabsLike {
  register(definition: {
    readonly id: string
    readonly kind: string
    readonly keepMounted?: boolean
    readonly priority?: string
    readonly title: (address: string) => string
    readonly guide?: readonly {
      readonly id: string
      readonly order: number
      readonly title: () => string
      readonly description?: () => string
      readonly icon?: (props?: { readonly size?: number }) => ReactElement
    }[]
  }): () => void
}

export interface SidebarRightLike {
  openTab(kind: string, options?: { readonly params?: unknown }): void
}

/** body 组件收到的框架注入面（files FilesBody 同款 useTabInfo 消费形态）。 */
export interface FenixTabBodyProps {
  readonly useTabInfo?: () => {
    readonly tab?: {
      readonly navigation?: {
        readonly params?: SidebarFileParams
        readonly revision?: number
      }
    }
  }
}

/**
 * 页签 body 工厂（闭包持 prefix）：useTabInfo 读当前 navigation.params 重算
 * iframe src——guide 点击（无 params）落项目总览；右键定位（带 params）深链
 * 文件视图。params 未变时 src 同值，React 不改 iframe src 属性（无重载，纯
 * reveal）；同 params 重复导航（revision++）不强制重载——页签已在目标视图。
 */
export function createFenixProjectsBody(prefix: string): (props: FenixTabBodyProps) => ReactElement {
  return function FenixProjectsBody(props: FenixTabBodyProps): ReactElement {
    let params: SidebarFileParams | undefined
    try {
      params = props?.useTabInfo?.()?.tab?.navigation?.params
    } catch {
      params = undefined // 注入面形状漂移：按无 params 降级（项目总览）
    }
    // 渲染期同步取主题缓存（页签 keepMounted 保活但 body 渲染惰性求值，注入
    // 档为宿主最近档）；缓存 undefined（宿主主题 API 缺席）→ 无 theme 段。
    return DashboardPanel({
      src: buildPanelSrc(prefix, routeForSidebarParams(params), currentThemeScheme(), currentLocaleScheme()),
    })
  }
}

/**
 * sidebarRight.openTab 消费装配（文件右键定位的侧栏落点）：服务缺席返回
 * undefined（locate.ts 走 main 面板回退路径）。
 */
export function createSidebarProjectOpener(
  ctx: { readonly sidebarRight?: SidebarRightLike },
): ((name: string, rel: string) => void) | undefined {
  const sidebar = ctx.sidebarRight
  if (sidebar === undefined || typeof sidebar.openTab !== 'function') return undefined
  return (name: string, rel: string): void => {
    sidebar.openTab(FENIX_TAB_KIND, { params: { project: name, path: rel } })
  }
}

/** keyed slot 注册最小面（slots.register 的本插件消费形态）。组件参数
 * `never`：slot 面（tab body / contextMenu.icon）props 各异，注册侧统一
 * 以零假设收窄（never 为底型，任意组件函数均可赋值）。 */
export interface SlotsRegisterLike {
  register(
    options: { readonly name: string; readonly key: string },
    component: (props: never) => ReactElement,
  ): () => void
}

/**
 * 注册右侧边栏「Fenix 项目」页签：definition（keepMounted 保活 + guide 菜单
 * 条目「Fenix 项目」→ #/projects 项目总览）+ body seat（keyed slot，key=definition
 * id）。sidebarRightTabs 服务缺席（dsh 版本漂移/测试桩）整体跳过返回 no-op。
 *
 * @returns 注销函数（definition disposer + body seat disposer，均幂等）。
 */
export function registerFenixRightTab(
  ctx: {
    readonly sidebarRightTabs?: SidebarRightTabsLike
    readonly slots?: SlotsRegisterLike
  },
  prefix: string,
): () => void {
  const registry = ctx.sidebarRightTabs
  const seats = ctx.slots
  if (
    registry === undefined ||
    typeof registry.register !== 'function' ||
    seats === undefined ||
    typeof seats.register !== 'function'
  ) {
    return () => {}
  }
  let disposeDefinition: () => void
  try {
    disposeDefinition = registry.register({
      id: FENIX_TAB_ID,
      kind: FENIX_TAB_KIND,
      // iframe 跨页签隐藏/会话切换保活：右键定位后用户切走再回来，视图不重置。
      keepMounted: true,
      // i18n 宿主跟随（code-review e27cf35aea7b）：title/guide 文案渲染期经
      // pluginT 取词典当前档（宿主每次渲染调用 thunk），与左侧菜单同语言跟随。
      title: () => pluginT('rightTab.title'),
      guide: [
        {
          id: 'projects',
          order: 40,
          title: () => pluginT('rightTab.guide.projects'),
          description: () => pluginT('rightTab.guide.projectsDesc'),
          icon: FenixGuideIcon,
        },
      ],
    })
  } catch (error) {
    // definition 注册同步抛错（宿主注册表校验等）：warn 降级返回 no-op，页面
    // 不崩（与文件头「形状漂移按降级处理」声明对齐）。
    console.warn(
      `[fenix-dsh-dashboard-bridge] sidebarRightTabs.register 失败，已降级为 no-op：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return () => {}
  }
  try {
    const disposeBody = seats.register(
      { name: 'sidebar.right.pane.tab', key: FENIX_TAB_ID },
      createFenixProjectsBody(prefix),
    )
    return () => {
      disposeBody()
      disposeDefinition()
    }
  } catch (error) {
    // body seat 注册失败：先注销已成功的 definition 再降级 no-op（防 definition
    // 泄漏，code-review 7d937b06b2c9）；注销本身抛错不再外溢。
    console.warn(
      `[fenix-dsh-dashboard-bridge] sidebar.right.pane.tab 注册失败，已降级为 no-op：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    try {
      disposeDefinition()
    } catch {
      // definition 注销抛错按已注销处理
    }
    return () => {}
  }
}

/** 文件右键定位项的菜单图标 key（contextMenu.icon keyed slot；插件域内唯一，
 * 与 LOCATE_MENU_ID 同前缀）。 */
export const LOCATE_ICON_KEY = 'fenix-dashboard-bridge.locate-icon'

/** 定位图标（crosshair，stroke currentColor 随菜单文字色，与原生项一致）。 */
export function LocateMenuIcon(props?: { readonly size?: number }): ReactElement {
  const size = props?.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </svg>
  )
}

/**
 * 注册定位菜单图标的 contextMenu.icon keyed slot（2026-11-11 用户需求：菜单
 * 项与原生项一致带图标）。slots 缺席（异常环境/测试桩）整体跳过返回 no-op。
 * 返回注销函数。
 */
export function registerLocateMenuIcon(ctx: {
  readonly slots?: SlotsRegisterLike
}): () => void {
  const slots = ctx.slots
  if (slots === undefined || typeof slots.register !== 'function') return () => {}
  return slots.register({ name: 'contextMenu.icon', key: LOCATE_ICON_KEY }, LocateMenuIcon)
}
