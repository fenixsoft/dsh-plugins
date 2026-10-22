/**
 * Client 半：iframe 面板、侧栏图标、「项目」Portal 内嵌分区与降级浮层分组。
 *
 * - `DashboardPanel`：主面板内嵌 iframe——src 经 buildPanelSrc 拼装（hash 深链
 *   直达），铺满面板、无边框，并按 layout 契约预留顶部 clearance
 *   （`--dsh-frame-leading-clearance`，macOS 窗口控件带占位，缺省 0）；
 * - `fixedIconComponent`：5 个固定条目的线性图标组件（svg stroke 线性风格），
 *   props 对齐 ui-sidebar 的 SidebarPanelIconOwnerProps（size/active）；
 * - `projectSectionComponent`：「项目」条目（order 11）的 Portal 内嵌分区组件
 *   （spec 2026-11 Portal 化）——从条目组件 `closest('nav')` 取条目列表元素，
 *   在其后插入宿主 div 并 createPortal 渲染常驻分区（位于条目列表与工作区
 *   regionArea 之间，官方工作区同款视觉）；锚点不可达/宿主被移除时按
 *   MutationObserver + 轮询兜底重试，连续不可达置 `degraded` 回落浮层分组；
 * - `projectGroupComponent`：「项目」条目内的浮层分组组件——降级路径保留
 *   （上轮实现不删），与分区共享 `projectGroupStore` 与 selectPanel 回调；
 * - `projectBadgeComponent`：项目行首字母圆形徽标（底色由项目名哈希稳定生成）。
 *
 * 组件 factory 返回的外层组件为无 hook 纯函数（服务端/测试可直接求值元素树）；
 * 分区/分组内部经 `useSyncExternalStore` 订阅 `projectGroupStore`（轻量模块级
 * store，跨渲染/跨 portal 持久），纯渲染面 `renderProjectSection` /
 * `renderProjectGroup`、纯 handler 工厂 `projectGroupHandlers` 与纯锚点/宿主/
 * 挂载状态机判定（`sidebarNavFrom` / `mountSectionHost` / `nextPortalMountState`）
 * 均可独立单测（node 环境以结构桩替身覆盖，不依赖真实 DOM）。
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactElement, RefObject } from 'react'
import { compareNames } from './projectSync.js'

/** ui-sidebar 传给图标组件的 owner props（SidebarPanelIconOwnerProps 子集）。 */
export interface PanelIconProps {
  /** 请求的正方形边长（px；宽列 16 / 收起轨 18）。 */
  readonly size?: number
  /** 本面板是否处于选中态。 */
  readonly active?: boolean
}

/** 5 个固定条目 id（与深链一一对应，见 client/index.ts FIXED_ENTRIES）。 */
export type FixedEntryId =
  | 'fenix-overview'
  | 'fenix-projects'
  | 'fenix-settings'
  | 'fenix-activities'
  | 'fenix-help'

/** 线性图标 path 数据（24×24 viewBox，stroke 线性风格）。 */
const FIXED_GLYPHS: Record<FixedEntryId, readonly string[]> = {
  'fenix-overview': ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  'fenix-projects': [
    'M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  'fenix-settings': [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M12 2v3',
    'M12 19v3',
    'M2 12h3',
    'M19 12h3',
    'M4.9 4.9l2.1 2.1',
    'M17 17l2.1 2.1',
    'M19.1 4.9L17 7',
    'M7 17l-2.1 2.1',
  ],
  'fenix-activities': ['M3 12h4l2-7 4 14 2-7h6'],
  'fenix-help': [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4',
    'M12 17.5h.01',
  ],
}

/** 固定条目线性图标组件工厂（每个条目 id 一枚）。 */
export function fixedIconComponent(id: FixedEntryId): (props: PanelIconProps) => ReactElement {
  const glyph = FIXED_GLYPHS[id]
  return function FixedIcon({ size = 18 }: PanelIconProps) {
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
        {glyph.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    )
  }
}

/** 项目名 → 稳定色相（简单多项式哈希，跨会话一致）。 */
function nameHue(name: string): number {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360
  }
  return hash
}

/** 项目条目首字母圆形徽标组件工厂（label=项目名，图标=首字母徽标）。 */
export function projectBadgeComponent(name: string): (props: PanelIconProps) => ReactElement {
  const letter = (Array.from(name.trim())[0] ?? '?').toUpperCase()
  const hue = nameHue(name)
  return function ProjectBadge({ size = 18 }: PanelIconProps) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `hsl(${hue} 42% 46%)`,
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.max(9, Math.round(size * 0.52)),
          fontWeight: 600,
          lineHeight: 1,
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {letter}
      </span>
    )
  }
}

/* ============================== 「项目」分组（工作区样式） ============================== */

/** 「项目」分组共享快照（模块级轻量 store，跨渲染持久）。 */
export interface ProjectGroupSnapshot {
  /** 项目名列表（去重、码点序）。 */
  readonly projects: readonly string[]
  /** 分组展开态（宽态头部行切换）。 */
  readonly expanded: boolean
  /** 当前高亮项目（点击行切换；项目移除时归空）。 */
  readonly activeProject: string | null
}

type Listener = () => void

function createProjectGroupStore() {
  let snapshot: ProjectGroupSnapshot = { projects: [], expanded: true, activeProject: null }
  const listeners = new Set<Listener>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const sameList = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((name, index) => name === b[index])
  return {
    getSnapshot: (): ProjectGroupSnapshot => snapshot,
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** 整体替换项目列表：去重 + 码点序；无变化零通知；高亮项目消失则归空。 */
    setProjects(names: readonly string[]): void {
      const projects = [...new Set(names)].sort(compareNames)
      if (sameList(snapshot.projects, projects)) return
      const activeProject =
        snapshot.activeProject !== null && projects.includes(snapshot.activeProject)
          ? snapshot.activeProject
          : null
      snapshot = { projects, expanded: snapshot.expanded, activeProject }
      emit()
    },
    toggleExpanded(): void {
      snapshot = { ...snapshot, expanded: !snapshot.expanded }
      emit()
    },
    setActiveProject(name: string | null): void {
      if (snapshot.activeProject === name) return
      snapshot = { ...snapshot, activeProject: name }
      emit()
    },
    /** 测试隔离用：恢复初始快照（不动订阅者）。 */
    reset(): void {
      snapshot = { projects: [], expanded: true, activeProject: null }
      emit()
    },
  }
}

/** 「项目」分组 store 单例（单页面单插件实例）。 */
export const projectGroupStore = createProjectGroupStore()

export interface ProjectGroupDeps {
  /** 点击项目行：切换主面板为该项目 iframe（index.ts 经 layout.selectPanel 实现）。 */
  readonly selectProject: (name: string) => void
}

/**
 * 行/头部交互事件最小结构面：项目行同时接受鼠标 click 与键盘 Enter/Space
 * （KeyboardEvent 结构兼容），handler 只消费阻断冒泡所需的方法。
 */
export interface ProjectGroupEventLike {
  stopPropagation(): void
  preventDefault(): void
}

/** 分组块交互回调（事件已在内部 stopPropagation，阻断冒泡到行按钮的 selectPanel）。 */
export interface ProjectGroupHandlers {
  readonly toggleHeader: (event: ProjectGroupEventLike) => void
  readonly selectProject: (name: string, event: ProjectGroupEventLike) => void
}

/**
 * 分组块交互回调工厂（纯函数，可独立单测）：头部行仅切换展开/折叠；
 * 项目行交由 deps.selectProject。
 */
export function projectGroupHandlers(
  store: Pick<typeof projectGroupStore, 'toggleExpanded'>,
  deps: ProjectGroupDeps,
): ProjectGroupHandlers {
  return {
    toggleHeader(event) {
      event.stopPropagation()
      store.toggleExpanded()
    },
    selectProject(name, event) {
      event.stopPropagation()
      deps.selectProject(name)
    },
  }
}

/** 宽态判定：ui-sidebar 宽列请求 16px 图标、收起轨请求 18px（SidebarPanelIconOwnerProps）。 */
const WIDE_ICON_SIZE = 16

/**
 * 统一 size 缺省口径：宿主未传 size 时按收起轨 18（窄态）处理——未知请求下
 * 按窄态降级最保守（分组回计数徽标、不铺头部拦截层）。宽态判定
 * （ProjectGroupInner）与锚点图标尺寸（ProjectSectionEntry）共用本函数，
 * 避免两条路径各持相反的缺省宽窄假设。
 */
function resolveIconSize(size: number | undefined): number {
  return size ?? 18
}

/** 分组列表行高（px）与最大高度（约 7 行，超出内部滚动）。 */
const GROUP_ROW_HEIGHT = 30
const GROUP_MAX_HEIGHT = 7 * GROUP_ROW_HEIGHT + 12

/** 浮层列表的 fixed 视口锚点（px；滚动/尺寸变化时由 ProjectGroupInner 重锚）。 */
export interface ProjectGroupFloatOrigin {
  readonly top: number
  readonly left: number
}

/** 浮层列表 portal 锚定：行按钮之外的宿主节点 + 视口坐标。 */
export interface ProjectGroupFloatAnchor {
  readonly target: HTMLElement
  readonly origin: ProjectGroupFloatOrigin
}

/** 渲染分组的全部输入（纯渲染面，测试可直接构造）。 */
export interface ProjectGroupView {
  readonly projects: readonly string[]
  readonly expanded: boolean
  readonly activeProject: string | null
  /** 宽态（展开侧栏）= true；窄态（收起轨）仅渲染徽标计数。 */
  readonly wide: boolean
  /** 量测得到的行宽基准（px；侧栏列可拖拽调宽，随 ResizeObserver 更新）。 */
  readonly rowWidth: number
  /**
   * 头部拦截层宽度（px；量测的原始 nav 宽度，不钳 360）：与列表宽度的
   * clampSectionRowWidth 钳制解耦——侧栏列拖宽超过 360px 时拦截层仍须盖住
   * 整行，否则行尾点击穿透为行按钮的 selectPanel。缺省回退 rowWidth
   * （node 测试树直构视图保持原语义；生产路径由 ProjectGroupInner 始终提供）。
   */
  readonly headerWidth?: number
  /** 挂到分组根 span 的 ref（内部量测 nav 宽度用）。 */
  readonly glyphRef: RefObject<HTMLSpanElement>
  /** 量测得到的头部拦截层几何（相对定位原点偏移 + 宿主行高）；缺省/失真回退常量。 */
  readonly headerGeometry?: HeaderGeometry | null
  /**
   * 浮层列表 portal 锚定（DOM 结构合规）：展开列表渲染到行按钮之外——原生
   * button 的后代不得含 tabIndex 可聚焦交互项（button 内容模型与 ARIA 嵌套
   * 交互约束），target 为行外宿主节点、origin 为按行矩形推导的 fixed 视口
   * 坐标。缺省时回退内联绝对定位（node 测试树内求值保持原语义；生产路径由
   * ProjectGroupInner 始终提供）。
   */
  readonly float?: ProjectGroupFloatAnchor | null
}

/** iframe 面板组件：src 由调用方经 buildPanelSrc 拼装后传入。 */
export function DashboardPanel({ src }: { readonly src: string }): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        // layout 契约：主面板内容触顶时按窗口控件带让位（缺省 0）。
        paddingTop: 'var(--dsh-frame-leading-clearance, 0px)',
      }}
    >
      <iframe
        src={src}
        title="Fenix Dashboard"
        style={{
          width: '100%',
          height: '100%',
          flex: 1,
          minHeight: 0,
          border: 'none',
          display: 'block',
          // 底色随宿主主题走变量口径（浮层列表同源 sidebar-fill 变量），缺省回退纯白。
          backgroundColor: 'var(--dsw-specific-sidebar-fill, #fff)',
        }}
      />
    </div>
  )
}

/* ============================== 「项目」分组渲染与组件 ============================== */

/**
 * 头部拦截层缺省几何（fenix-projects-header）：相对分组图标定位原点的内缩
 * 与宿主行高基线，与 ui-sidebar 当前行内边距/行高强耦合（宿主样式漂移即错位）。
 * 运行时优先量测宿主行按钮 rect 推导真实几何（measureHeaderGeometry），
 * 仅在量测不可得/失真时回退本常量。
 */
const HEADER_INSET = 10
const HEADER_ROW_HEIGHT = 36

/** 头部拦截层量测几何（相对分组图标定位原点的偏移与宿主行高）。 */
export interface HeaderGeometry {
  readonly top: number
  readonly left: number
  readonly height: number
}

/** 拦截层量测输入的最小元素结构面（真实 Element 天然满足；node 桩按形状构造）。 */
export interface MeasurableOrigin {
  closest(selectors: string): unknown
  getBoundingClientRect(): { readonly top: number; readonly left: number; readonly height: number }
}

/** 拦截层缺省几何（量测不可得/失真时的回退值）。 */
const DEFAULT_HEADER_GEOMETRY: HeaderGeometry = {
  top: -HEADER_INSET,
  left: -HEADER_INSET,
  height: HEADER_ROW_HEIGHT,
}

/**
 * 量测头部拦截层几何：从分组图标定位原点向上找宿主行按钮（SECTION_ROW_SELECTOR）
 * 取其 rect，推导拦截层相对图标原点的行偏移（行在原点左上方，top/left 为负）
 * 与行高——替代与 ui-sidebar 行样式强耦合的固定
 * 魔数（宿主调整行高/内边距后拦截层不再错位）。量测不可得或失真时返回 null
 * （渲染面回退缺省常量）：行按钮不可达、rect 高度为 0（未布局/无布局环境）、
 * 行高偏离基线过远（> 2 倍，疑似结构漂移——坏量测不如常量）。
 */
export function measureHeaderGeometry(origin: MeasurableOrigin | null | undefined): HeaderGeometry | null {
  if (origin == null) return null
  const row = origin.closest(SECTION_ROW_SELECTOR)
  if (typeof row !== 'object' || row === null || !('getBoundingClientRect' in row)) return null
  const rowRect = (row as MeasurableOrigin).getBoundingClientRect()
  const originRect = origin.getBoundingClientRect()
  if (rowRect.height <= 0 || originRect.height <= 0) return null
  if (rowRect.height > HEADER_ROW_HEIGHT * 2) return null
  // 行相对图标原点的偏移（行在原点左上方，恒为负），与 DEFAULT_HEADER_GEOMETRY
  // 的内缩语义同向：消费处直接用作 style.top/left 即可盖住整行。
  return {
    top: rowRect.top - originRect.top,
    left: rowRect.left - originRect.left,
    height: rowRect.height,
  }
}

/** 浮层列表与分组根的间距（px）：列表顶挂在行下沿之下。 */
const GROUP_FLOAT_GAP = 12
/** 浮层列表相对分组根的水平内缩（px）。 */
const GROUP_FLOAT_INSET = 10

const groupListStyle = (rowWidth: number): CSSProperties => ({
  position: 'absolute',
  top: `calc(100% + ${GROUP_FLOAT_GAP}px)`,
  left: -GROUP_FLOAT_INSET,
  width: rowWidth,
  maxHeight: `min(${GROUP_MAX_HEIGHT}px, 46vh)`,
  overflowY: 'auto',
  boxSizing: 'border-box',
  zIndex: 30,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 4,
  borderRadius: 'var(--dsw-radius-md, 8px)',
  border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,0.25))',
  background: 'var(--dsw-specific-sidebar-fill, #fff)',
  boxShadow: 'var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,0.16))',
})

/**
 * 浮层列表 portal 态样式：视觉口径同 groupListStyle（同宽/同限高/同阴影），
 * 定位改按行矩形 fixed 锚定（portal 脱离分组根的布局流后 absolute 原点失效）。
 */
const groupFloatListStyle = (origin: ProjectGroupFloatOrigin, rowWidth: number): CSSProperties => ({
  ...groupListStyle(rowWidth),
  position: 'fixed',
  top: origin.top,
  left: origin.left,
})

const groupRowStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: GROUP_ROW_HEIGHT,
  // 行是限高滚动容器（flex column）的直接子项：默认 flex-shrink:1 会在内容
  // 超限时压缩行高而不是溢出滚动，滚动条永不出现（真机 3942 验证发现），
  // 必须钉死行高让容器真实溢出。
  flexShrink: 0,
  flexGrow: 0,
  padding: '0 8px',
  borderRadius: 'var(--dsw-radius-sm, 6px)',
  border: 'none',
  cursor: 'pointer',
  background: active ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.18))' : 'transparent',
  color: 'var(--dsw-alias-label-primary, inherit)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: `${GROUP_ROW_HEIGHT}px`,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  width: '100%',
  boxSizing: 'border-box',
})

const projectNameStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

/**
 * 项目行渲染工厂（浮层行与分区宽/窄态行共用）：统一 role=button + tabIndex 0 +
 * Enter/Space 触发 + stopPropagation（经 handlers.selectProject）的键盘可达与
 * 事件阻断契约，仅行样式与内容形态（徽标+名称 / 仅徽标）由调用方参数化——
 * 三处各自内联实现会在契约演进时漂移（漏改一处即行为分叉）。
 */
function projectRow(
  name: string,
  active: boolean,
  handlers: ProjectGroupHandlers,
  rowStyle: (active: boolean) => CSSProperties,
  withName: boolean,
): ReactElement {
  // 键盘可达：div[role=button] 非原生按钮，tabIndex 0 + Enter/Space 触发选中。
  return (
    <div
      key={name}
      role="button"
      tabIndex={0}
      data-testid={`fenix-project-row-${name}`}
      data-active={active || undefined}
      title={name}
      onClick={(event) => handlers.selectProject(name, event)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        handlers.selectProject(name, event)
      }}
      style={rowStyle(active)}
    >
      {projectBadgeComponent(name)({ size: 18 })}
      {withName ? <span style={projectNameStyle}>{name}</span> : null}
    </div>
  )
}

/**
 * 「项目」分组纯渲染面（无 hook，测试可直接求值元素树）：
 * - 宽态：行内 chevron 指示 + 头部行拦截层（仅切换展开/折叠，阻断行按钮的
 *   selectPanel）+ 展开时的限高滚动项目行列表（首字母徽标 + 项目名，当前项
 *   高亮）或空态提示；
 * - 窄态（收起轨）：仅首字母徽标形态的计数徽标。
 *
 * 布局说明：本组件渲染在 ui-sidebar panellist 行按钮的图标槽内（span.panelGlyph）；
 * 展开列表经 createPortal 渲染到行按钮之外（原生 button 后代不得含 tabIndex
 * 可聚焦交互项），按行矩形 fixed 锚定挂行下沿，滚动/尺寸变化由 ProjectGroupInner
 * 重锚；未提供锚定时（node 测试树内求值）回退内联绝对定位（行按钮所在 nav 的
 * overflow 可见，仅侧栏列 overflow:hidden 兜底裁剪），宽度取量测的 nav 宽度
 * 以适配可拖拽侧栏列宽。
 */
export function renderProjectGroup(view: ProjectGroupView, handlers: ProjectGroupHandlers): ReactElement {
  if (!view.wide) {
    // 计数徽标刻意常显（含 0）：徽标是收起轨上「项目」入口的唯一视觉标识，
    // 空项目回 null 会留空图标槽；「0」即分组空态的收起轨形态（宽态对应
    // 「暂无项目」提示），与分区窄态「空项目不渲染空壳容器」的分叉属有意设计。
    return (
      <span
        data-testid="fenix-projects-rail-count"
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--dsw-alias-state-business-primary, #5b7cfa)',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1,
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {view.projects.length}
      </span>
    )
  }
  // 拦截层几何：量测值优先（抗宿主样式漂移），缺省/失真回退常量。
  const headerGeometry = view.headerGeometry ?? DEFAULT_HEADER_GEOMETRY
  // 拦截层宽度：原始 nav 量测优先（不钳 360——宽侧栏下行尾点击不得穿透为
  // selectPanel），缺省回退行宽基准。
  const headerWidth = view.headerWidth ?? view.rowWidth
  // 浮层列表：展开时构建；提供 portal 锚定即渲染到行按钮之外（fixed 按行矩形
  // 锚定），否则回退内联绝对定位（原语义）。点击阻断冒泡两条路径同义保留
  //（portal 后 DOM 祖先已非行按钮，保留以防锚定缺失的回退路径冒泡触发 selectPanel）。
  const float = view.float ?? null
  const list = view.expanded ? (
    <span
      data-testid="fenix-projects-list"
      style={float !== null ? groupFloatListStyle(float.origin, view.rowWidth) : groupListStyle(view.rowWidth)}
      onClick={(e) => e.stopPropagation()}
    >
      {view.projects.length === 0 ? (
        <span
          data-testid="fenix-projects-empty"
          style={{
            display: 'block',
            padding: '8px 10px',
            fontSize: 12,
            opacity: 0.6,
            whiteSpace: 'nowrap',
          }}
        >
          暂无项目
        </span>
      ) : (
        view.projects.map((name) =>
          projectRow(name, view.activeProject === name, handlers, groupRowStyle, true),
        )
      )}
    </span>
  ) : null
  return (
    <span
      ref={view.glyphRef}
      data-testid="fenix-projects-group"
      style={{ position: 'relative', display: 'inline-flex', width: WIDE_ICON_SIZE, height: WIDE_ICON_SIZE }}
    >
      <svg
        width={WIDE_ICON_SIZE}
        height={WIDE_ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{
          transition: 'transform var(--ds-transition-duration, 0.15s) var(--ds-ease-in-out, ease)',
          transform: view.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
      {/* 头部行拦截层：覆盖整行，点击仅切换展开/折叠（阻断冒泡到行按钮 selectPanel）。
          已知局限：本层 aria-hidden 且不可聚焦，展开/折叠交互对键盘与辅助技术
          不可达；aria-expanded 迁移到宿主行按钮涉及宿主交互语义，暂未实施。 */}
      <span
        aria-hidden="true"
        data-testid="fenix-projects-header"
        onClick={handlers.toggleHeader}
        style={{
          position: 'absolute',
          top: headerGeometry.top,
          left: headerGeometry.left,
          width: headerWidth,
          height: headerGeometry.height,
          cursor: 'pointer',
        }}
      />
      {list !== null && float !== null ? createPortal(list, float.target) : list}
    </span>
  )
}

/** 分组内量测的缺省行宽基准（侧栏缺省 280 列 - 行内边距/外边距余量）。 */
const DEFAULT_ROW_WIDTH = 260

/**
 * 行宽基准钳制（侧栏列可拖拽调宽）：浮层分组（ProjectGroupInner 量测 nav
 * 宽度）与 Portal 分区（量测宿主宽度）共用，钳制口径的单一来源，避免
 * 双实现各自硬编码边界后漂移。
 */
export function clampSectionRowWidth(width: number): number {
  return Math.min(360, Math.max(160, width))
}

/**
 * 分组块内部组件（hook 层）：订阅分组 store、量测 panellist nav 宽度与浮层
 * portal 锚定（行矩形）并把渲染委派给纯渲染面 renderProjectGroup。
 */
function ProjectGroupInner({
  size,
  deps,
}: {
  readonly size?: number
  readonly deps: ProjectGroupDeps
}): ReactElement {
  const snapshot = useSyncExternalStore(projectGroupStore.subscribe, projectGroupStore.getSnapshot)
  const glyphRef = useRef<HTMLSpanElement>(null)
  const [rowWidth, setRowWidth] = useState(DEFAULT_ROW_WIDTH)
  // 拦截层宽度用原始 nav 宽度（不钳 360）：360 钳制口径仅约束浮层/分区列表宽度。
  const [navWidth, setNavWidth] = useState(DEFAULT_ROW_WIDTH)
  // 头部拦截层几何：量测失败保持 null（渲染面回退缺省常量，不拦错位）。
  const [headerGeometry, setHeaderGeometry] = useState<HeaderGeometry | null>(null)
  // 浮层列表 portal 锚定：行按钮之外宿主（document.body）+ 行矩形视口坐标。
  const [float, setFloat] = useState<ProjectGroupFloatAnchor | null>(null)
  // 宽态判定：仅宽态分支把 glyphRef 挂到分组根 span（窄态渲染计数徽标、无
  // ref），量测依赖 ref 可得。effect 以 wide 为依赖：首挂窄态量测不成（ref 为
  // null 提前返回）后展开为宽列时重跑补测，避免 rowWidth/headerGeometry 永远
  // 停在缺省常量；同态内的 size 数值变化不重跑，量测由 ResizeObserver 持续跟进。
  const wide = resolveIconSize(size) <= WIDE_ICON_SIZE

  useLayoutEffect(() => {
    const nav = glyphRef.current?.closest('nav')
    if (!(nav instanceof HTMLElement)) return
    const update = (): void => {
      setNavWidth(nav.clientWidth)
      setRowWidth(clampSectionRowWidth(nav.clientWidth))
      setHeaderGeometry(measureHeaderGeometry(glyphRef.current))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(nav)
    return () => {
      observer.disconnect()
    }
  }, [wide])

  // 浮层锚定 effect：列表 portal 到行按钮之外后脱离分组根的布局流，按分组根
  // span 行矩形（getBoundingClientRect）推导 fixed 视口坐标；滚动（捕获任意
  // 祖先滚动容器）/窗口尺寸变化时重锚，保持列表挂在行下沿的既有几何关系
  // （侧栏列拖拽调宽由上方 ResizeObserver → update 同步跟进）。
  useLayoutEffect(() => {
    if (!wide) return
    const glyph = glyphRef.current
    if (!(glyph instanceof HTMLElement) || document.body === null) return
    const update = (): void => {
      const rect = glyph.getBoundingClientRect()
      // 零矩形（未布局/已断连）不锚定：坏量测不如保留上次量测（同
      // measureHeaderGeometry 的失真回退口径）。
      if (rect.height <= 0 && rect.width <= 0) return
      const origin = { top: rect.bottom + GROUP_FLOAT_GAP, left: rect.left - GROUP_FLOAT_INSET }
      setFloat((prev) =>
        prev !== null &&
        prev.target === document.body &&
        prev.origin.top === origin.top &&
        prev.origin.left === origin.left
          ? prev
          : { target: document.body, origin },
      )
    }
    update()
    document.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      document.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
    }
  }, [wide])

  return renderProjectGroup(
    {
      projects: snapshot.projects,
      expanded: snapshot.expanded,
      activeProject: snapshot.activeProject,
      wide,
      rowWidth,
      headerWidth: navWidth,
      glyphRef,
      headerGeometry,
      float,
    },
    projectGroupHandlers(projectGroupStore, deps),
  )
}

/** 「项目」条目分组块组件工厂（外层保持无 hook 纯函数形态）。 */
export function projectGroupComponent(deps: ProjectGroupDeps): (props: PanelIconProps) => ReactElement {
  return function ProjectGroup(props: PanelIconProps) {
    return <ProjectGroupInner size={props.size} deps={deps} />
  }
}

/* ================== Portal 内嵌「项目」分区（spec 2026-11 Portal 化） ================== */

/**
 * 锚点选择器：条目列表的语义元素 `<nav aria-label>`（design：regionArea/
 * panelList 的 class 为 CSS module 哈希、升级即变，语义标签抗性强——
 * MUST NOT 依赖 CSS module 哈希类名定位）。
 */
export const SECTION_ANCHOR_SELECTOR = 'nav'

/** Portal 宿主 div 的 data-testid（漂移演练/排障定位用，非样式依据）。 */
export const SECTION_HOST_TESTID = 'fenix-projects-portal-host'

/**
 * 最小锚点结构面（纯判定只消费 `closest`；node 单测以桩替身覆盖，不依赖
 * 真实 DOM 全局——vitest 环境为 node，HTMLElement 全局不存在）。
 */
export interface AnchorOriginLike {
  closest(selectors: string): unknown
}

/**
 * 纯锚点判定：从「项目」条目组件挂载点向上找条目列表元素（语义 nav）。
 * 找不到返回 null（视为锚点不可达，交由挂载状态机累计失败）。
 */
export function sidebarNavFrom(origin: AnchorOriginLike | null | undefined): unknown {
  return origin?.closest(SECTION_ANCHOR_SELECTOR) ?? null
}

/**
 * 行锚点选择器：「项目」条目所在的行按钮（PanelRow 的 `<button class="panelRow">`）。
 * 分区宿主插在该行正下方（nav 内部），成为「项目」菜单的下挂列表而非列表末尾
 * 的独立分区——用户口径：分区应在项目菜单下面，且与菜单同属一个「项目」。
 */
export const SECTION_ROW_SELECTOR = 'button'

/**
 * 纯锚点判定（分区插入点）：优先取「项目」行按钮（宿主紧贴菜单行下方）；
 * 行按钮不可得（结构漂移）回落条目列表 nav（现行为：列表末尾）；均不可得
 * 返回 null（交由挂载状态机累计失败 → 浮层降级）。
 */
export function sectionAnchorFrom(origin: AnchorOriginLike | null | undefined): unknown {
  return origin?.closest(SECTION_ROW_SELECTOR) ?? sidebarNavFrom(origin)
}

/** 纯可达性判定：节点已连接到文档（duck-typed isConnected，桩可测）。 */
export function isAnchorReachable(node: unknown): boolean {
  return typeof node === 'object' && node !== null && (node as { isConnected?: boolean }).isConnected === true
}

/** 宿主元素最小结构面（真实 HTMLDivElement 天然满足；node 桩按形状构造）。 */
export interface SectionHostElement {
  readonly dataset: Record<string, string | undefined>
  readonly style: { cssText: string }
  isConnected: boolean
  remove(): void
  previousElementSibling?: unknown
}

/** 宿主创建所需的 document 最小结构面。 */
export interface SectionHostDocument {
  createElement(tagName: string): SectionHostElement
}

/**
 * 在锚点元素的紧后兄弟位创建并插入宿主 div（锚点 = 「项目」行按钮：分区紧贴
 * 菜单行下方；行按钮漂移时锚点回落 nav，分区位于列表末尾）。位于 nav 内部时
 * 宿主是行间 div，位于 nav 后时是 regionArea 前的兄弟块。insertAdjacentElement
 * 返回 null 表示插入失败（如锚点已断连），返回 null 时本函数同样返回 null
 * （交由状态机累计失败）。宿主由插件创建/清理：flex 允许收缩 + minHeight 0，
 * 不撑破侧栏整体高度。
 */
export function mountSectionHost(
  anchor: { insertAdjacentElement(position: string, element: unknown): unknown },
  doc: SectionHostDocument,
): SectionHostElement | null {
  const host = doc.createElement('div')
  host.dataset.testid = SECTION_HOST_TESTID
  host.style.cssText = 'flex:0 1 auto;min-height:0;min-width:0;'
  return anchor.insertAdjacentElement('afterend', host) === host ? host : null
}

/* ---------------------------- 挂载状态机（纯判定） ---------------------------- */

/** Portal 挂载状态：探测中 / 生效 / 降级（degraded 可恢复，非永久停用）。 */
export type PortalStatus = 'seeking' | 'active' | 'degraded'

export interface PortalMountState {
  readonly status: PortalStatus
  /** 连续不可达次数（挂载成功即清零）。 */
  readonly failures: number
}

/** 连续不可达次数达到该阈值即置 degraded（回落浮层分组）。 */
export const PORTAL_DEGRADE_FAILURES = 3

const ACTIVE_MOUNT: PortalMountState = { status: 'active', failures: 0 }

/**
 * 挂载状态机推进（纯函数，幂等：同态返回同引用以便 React setState 天然去重）：
 * - 挂载成功 → active 且清零（degraded 恢复的唯一出口）；
 * - 失败 → failures+1，达阈值置 degraded；已 degraded 时保持原态
 *   （轮询兜底持续运行，恢复可达即经成功分支自动清除）。
 */
export function nextPortalMountState(state: PortalMountState, mounted: boolean): PortalMountState {
  if (mounted) {
    return state.status === 'active' && state.failures === 0 ? state : ACTIVE_MOUNT
  }
  if (state.status === 'degraded') return state
  const failures = state.failures + 1
  return failures >= PORTAL_DEGRADE_FAILURES
    ? { status: 'degraded', failures }
    : { status: 'seeking', failures }
}

/** Portal 是否生效：状态 active 且宿主仍连接在文档上（宿主被删即失效）。 */
export function isPortalActive(state: PortalMountState, host: unknown): boolean {
  return state.status === 'active' && isAnchorReachable(host)
}

/** 宽窄态阈值（px）：宿主宽度达到即按宽态渲染（收起轨宽约 56px，列态 ≥ 180px）。 */
export const SECTION_WIDE_MIN_WIDTH = 120

/** 宽窄态纯判定（design：Portal 拿不到 renderSlot 的 {wide}，改从宿主宽度推断）。 */
export function isWideSectionWidth(width: number): boolean {
  return width >= SECTION_WIDE_MIN_WIDTH
}

/** 宿主重试巡检周期（ms）：轮询兜底（MutationObserver 之外的最终保底）。 */
export const PORTAL_POLL_INTERVAL_MS = 1_000

/** MutationObserver 触发的重试去抖（ms）：吸收侧栏过渡动画的 DOM 抖动。 */
export const PORTAL_OBSERVER_DEBOUNCE_MS = 300

/* ------------------------------ 分区纯渲染面 ------------------------------ */

/** 分区高度上限（约 7 行，超出内部滚动）——与浮层分组同一口径。 */
export const SECTION_MAX_HEIGHT = `min(${GROUP_MAX_HEIGHT}px, 46vh)`

/** 渲染分区的全部输入（纯渲染面，测试可直接构造）。 */
export interface ProjectSectionView {
  readonly projects: readonly string[]
  /** 历史契约字段：分区已常驻展开（无折叠态），渲染不再消费。 */
  readonly expanded: boolean
  readonly activeProject: string | null
  /** 宽态（列宽 ≥ SECTION_WIDE_MIN_WIDTH）= true；窄态渲染徽标栈。 */
  readonly wide: boolean
  /** 历史契约字段：渲染不再消费（宽态容器 width auto、行 width 100%）。 */
  readonly rowWidth: number
}

/** 分区容器样式（紧贴「项目」菜单行下方：无自带标题——上方菜单即「项目」）。 */
const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  boxSizing: 'border-box',
  width: 'auto',
  margin: '0 10px 8px',
  padding: 6,
  minHeight: 0,
  borderRadius: 'var(--dsw-radius-md, 8px)',
  border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,0.25))',
  background: 'var(--dsw-specific-sidebar-fill, transparent)',
}

/** 分区列表容器样式：最大高度 + 内部滚动（行钉死高度让容器真实溢出）。 */
const sectionListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: SECTION_MAX_HEIGHT,
  overflowY: 'auto',
  minHeight: 0,
  boxSizing: 'border-box',
}

/** 窄态徽标栈容器样式（仅徽标，居中成列，无横向溢出）。 */
const sectionRailListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  maxHeight: SECTION_MAX_HEIGHT,
  overflowY: 'auto',
  minHeight: 0,
  boxSizing: 'border-box',
  padding: '2px 0',
}

/** 窄态单枚徽标行样式（徽标栈行：居中、随容器收缩、可高亮、无横向溢出）。 */
const sectionRailRowStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 2,
  flexShrink: 0,
  borderRadius: 'var(--dsw-radius-sm, 6px)',
  cursor: 'pointer',
  background: active ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.18))' : 'transparent',
})

/** 宽态分区行（首字母徽标 + 项目名，当前项高亮）：复用项目行渲染工厂。 */
function sectionRow(name: string, active: boolean, handlers: ProjectGroupHandlers): ReactElement {
  return projectRow(name, active, handlers, groupRowStyle, true)
}

/** 窄态分区行（徽标栈：仅首字母徽标，无项目名文本，无横向溢出）：复用项目行渲染工厂。 */
function sectionRailRow(name: string, active: boolean, handlers: ProjectGroupHandlers): ReactElement {
  return projectRow(name, active, handlers, sectionRailRowStyle, false)
}

/**
 * 「项目」分区纯渲染面（无 hook，测试可直接求值元素树）：
 * - 分区紧贴「项目」菜单行下方，**不带自带标题**（上方菜单即「项目」，避免
 *   双「项目」菜单）；常驻渲染项目行（无折叠态）。
 * - 宽态：限高滚动项目行列表（首字母徽标 + 项目名，当前项高亮）或空态提示；
 * - 窄态（收起轨）：徽标栈（仅徽标、居中、无横向溢出）；空项目返回 null
 *   （不渲染带边框内边距的空分区壳；宽态空项目则渲染「暂无项目」空态壳，
 *   两态空态口径不同）。
 *
 * 事件契约与浮层分组共用 ProjectGroupHandlers：项目行 selectProject（内部
 * stopPropagation 阻断冒泡到行按钮）。`expanded` 字段保留于视图契约但不再
 * 生效（分区常驻展开，折叠语义由「项目」菜单行的主面板切换承担）。
 */
export function renderProjectSection(view: ProjectSectionView, handlers: ProjectGroupHandlers): ReactElement | null {
  if (!view.wide) {
    // 窄态空项目：不渲染空壳容器（避免收起轨上出现无边框信息的空白边框块）。
    if (view.projects.length === 0) return null
    return (
      <section
        data-testid="fenix-projects-section"
        aria-label="项目"
        style={{ ...sectionStyle, margin: '0 2px 8px', padding: 4, alignItems: 'center' }}
      >
        <span data-testid="fenix-projects-list" style={sectionRailListStyle} onClick={(e) => e.stopPropagation()}>
          {view.projects.map((name) => sectionRailRow(name, view.activeProject === name, handlers))}
        </span>
      </section>
    )
  }
  return (
    <section data-testid="fenix-projects-section" aria-label="项目" style={sectionStyle}>
      <span data-testid="fenix-projects-list" style={sectionListStyle} onClick={(e) => e.stopPropagation()}>
        {view.projects.length === 0 ? (
          <span
            data-testid="fenix-projects-empty"
            style={{
              display: 'block',
              padding: '8px 10px',
              fontSize: 12,
              opacity: 0.6,
              whiteSpace: 'nowrap',
            }}
          >
            暂无项目
          </span>
        ) : (
          view.projects.map((name) => sectionRow(name, view.activeProject === name, handlers))
        )}
      </span>
    </section>
  )
}

/* ------------------------- Portal 挂载与条目退化组件 ------------------------- */

/**
 * 分区条目内部组件（hook 层）：锚点探测 + 宿主生命周期 + Portal 渲染 +
 * 降级浮层。挂载循环（useLayoutEffect 一次性建立）：
 * - 首挂即尝试：从条目组件 `sectionAnchorFrom` 取锚点（优先「项目」行按钮，
 *   宿主紧贴菜单行下方成为下挂列表；行按钮漂移回落 nav）→ 锚点紧后位插宿主
 *   → createPortal 渲染分区；
 * - 巡检 = `setInterval` 轮询兜底 + MutationObserver（document.body 子树，
 *   去抖）双通道触发同一 `tick`：锚点可达且宿主健康（紧贴锚点之后）则幂等
 *   保持；宿主被移除/漂移则清陈旧宿主重挂（侧栏过渡动画时序竞争自愈）；
 *   观察器按 portalActive 占停（生效期 disconnect、探测/降级窗口恢复），
 *   轮询兜底独立运行，分区重挂能力不丢；
 * - 锚点不可达连续 `PORTAL_DEGRADE_FAILURES` 次 → `degraded` 暂停 Portal
 *   渲染，浮层分组自动接管；轮询兜底持续运行，锚点恢复可达即自动重挂并
 *   清除 degraded（可恢复而非永久停用）；
 * - 卸载：清计时器/观察器并移除宿主（portal 随宿主移除，无残留）。
 */
function ProjectSectionEntry({
  size,
  deps,
}: {
  readonly size?: number
  readonly deps: ProjectGroupDeps
}): ReactElement {
  const snapshot = useSyncExternalStore(projectGroupStore.subscribe, projectGroupStore.getSnapshot)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [mountState, setMountState] = useState<PortalMountState>({ status: 'seeking', failures: 0 })
  const [hostWidth, setHostWidth] = useState(0)
  // tick 闭包内读写宿主用 ref（setState 异步，避免重挂竞态下误判健康）。
  const hostRef = useRef<HTMLDivElement | null>(null)
  // 观察器跨 effect 共享 ref：挂载 effect 创建，占停 effect 按 portalActive
  // 接管 observe/disconnect（声明序在挂载 effect 之后，首挂即按初始态归位）。
  const observerRef = useRef<MutationObserver | null>(null)

  useLayoutEffect(() => {
    let disposed = false
    let poll: ReturnType<typeof setInterval> | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    let observer: MutationObserver | undefined

    const detach = (): void => {
      hostRef.current?.remove()
      hostRef.current = null
      setHost(null)
    }

    const tick = (): void => {
      if (disposed) return
      const anchor = sectionAnchorFrom(anchorRef.current)
      if (!isAnchorReachable(anchor)) {
        detach()
        setMountState((state) => nextPortalMountState(state, false))
        return
      }
      const current = hostRef.current
      if (current !== null && current.isConnected && current.previousElementSibling === anchor) {
        // 健康幂等：状态不变时不触发重渲染。
        setMountState((state) => nextPortalMountState(state, true))
        return
      }
      // 宿主曾挂载但被移除/漂移：本轮先脱挂（Portal 暂停渲染 → 浮层分组自动
      // 接管，降级可观察），下一轮巡检（观察器去抖/轮询）再重挂——不与删除
      // 同拍重挂，保证「降级 → 恢复」的时序响亮且可验证。
      if (current !== null) {
        detach()
        setMountState((state) => nextPortalMountState(state, false))
        return
      }
      // 从未挂载（首挂或降级后重挂）：锚点可达即插宿主。
      detach()
      const anchorElement = anchor as HTMLElement
      const mounted = mountSectionHost(anchorElement, {
        createElement: (tag) => document.createElement(tag),
      })
      if (mounted === null || !mounted.isConnected) {
        setMountState((state) => nextPortalMountState(state, false))
        return
      }
      const hostElement = mounted as HTMLDivElement
      hostRef.current = hostElement
      setHost(hostElement)
      setMountState((state) => nextPortalMountState(state, true))
    }

    // 立即首挂；轮询兜底；MutationObserver 去抖触发（吸收动画期 DOM 抖动）。
    tick()
    poll = setInterval(tick, PORTAL_POLL_INTERVAL_MS)
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => {
        if (disposed) return
        if (debounce !== undefined) clearTimeout(debounce)
        debounce = setTimeout(tick, PORTAL_OBSERVER_DEBOUNCE_MS)
      })
      observerRef.current = observer
      observer.observe(document.body, { childList: true, subtree: true })
    }
    return () => {
      disposed = true
      if (poll !== undefined) clearInterval(poll)
      if (debounce !== undefined) clearTimeout(debounce)
      observer?.disconnect()
      observerRef.current = null
      detach()
    }
  }, [])

  // 宿主宽度量测：宽窄态信号（Portal 拿不到 renderSlot 的 {wide}）。
  useLayoutEffect(() => {
    if (host === null) return
    const update = (): void => {
      setHostWidth(host.clientWidth)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(host)
    return () => {
      resizeObserver.disconnect()
    }
  }, [host])

  const portalActive = isPortalActive(mountState, host)

  // 观察器占停（document.body 全子树监听的开销收敛）：portal 生效期宿主健康
  // 巡检由轮询兜底独立承担，观察器 disconnect——宿主任意位置的 DOM 插拔
  // （聊天流式渲染、面板切换等）不再触发去抖 tick；退回探测/降级窗口即恢复
  // observe，重挂响应不降速。兜底能力不丢：轮询巡检（PORTAL_POLL_INTERVAL_MS）
  // 持续运行，宿主被移除先经轮询检出并置 portalActive=false，本 effect 随即
  // 恢复监听（observe 同目标重注册幂等，不会重复回调）。
  useLayoutEffect(() => {
    const mutationObserver = observerRef.current
    if (mutationObserver === null || document.body === null) return
    if (portalActive) mutationObserver.disconnect()
    else mutationObserver.observe(document.body, { childList: true, subtree: true })
  }, [portalActive])

  // 锚点图标尺寸随 ui-sidebar 实际请求（宽列 16 / 收起轨 18）；缺省口径与
  // 宽态判定共用 resolveIconSize（收起轨 18，同源窄态降级假设）。
  const anchorIconSize = resolveIconSize(size)
  const handlers = projectGroupHandlers(projectGroupStore, deps)
  return (
    <>
      {/* 条目锚点：常驻于侧栏树内（portalActive 时呈图标直选「项目」主面板形态；
          降级窗口零尺寸让位给浮层分组，保留树内位置供重挂探测）。 */}
      <span
        ref={anchorRef}
        data-testid="fenix-projects-anchor"
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: portalActive ? anchorIconSize : 0,
          height: portalActive ? anchorIconSize : 0,
          overflow: 'hidden',
        }}
      >
        {portalActive ? fixedIconComponent('fenix-projects')({ size: anchorIconSize }) : null}
      </span>
      {portalActive && host !== null ? (
        createPortal(
          renderProjectSection(
            {
              projects: snapshot.projects,
              expanded: snapshot.expanded,
              activeProject: snapshot.activeProject,
              wide: isWideSectionWidth(hostWidth),
              rowWidth: clampSectionRowWidth(hostWidth),
            },
            handlers,
          ),
          host,
        )
      ) : (
        // 降级路径（seeking/degraded）：浮层分组自动接管（现实现保留为组件）。
        <ProjectGroupInner size={size} deps={deps} />
      )}
    </>
  )
}

/**
 * 「项目」条目 Portal 分区组件工厂（外层保持无 hook 纯函数形态）。
 * Portal 生效时条目退化为图标直选「项目」主面板；分区常驻内嵌于条目列表
 * 与工作区之间；锚点漂移自动降级回浮层分组（projectGroupComponent 路径）。
 */
export function projectSectionComponent(deps: ProjectGroupDeps): (props: PanelIconProps) => ReactElement {
  return function ProjectSection(props: PanelIconProps) {
    return <ProjectSectionEntry size={props.size} deps={deps} />
  }
}
