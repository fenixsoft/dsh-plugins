/**
 * Client 半：iframe 面板、侧栏图标与「项目」分组组件（design D1/D3/D4）。
 *
 * - `DashboardPanel`：主面板内嵌 iframe——src 经 buildPanelSrc 拼装（hash 深链
 *   直达），铺满面板、无边框，并按 layout 契约预留顶部 clearance
 *   （`--dsh-frame-leading-clearance`，macOS 窗口控件带占位，缺省 0）；
 * - `fixedIconComponent`：4 个固定条目的线性图标组件（svg stroke 线性风格），
 *   props 对齐 ui-sidebar 的 SidebarPanelIconOwnerProps（size/active）；
 * - `projectGroupComponent`：「项目」条目（order 11）的分组块组件——工作区
 *   样式：可折叠分组、首字母徽标 + 项目名行、最大高度内部滚动、窄态仅徽标
 *   计数；点击项目行经 deps.selectProject 切换主面板，头部行仅切换展开/折叠；
 * - `projectBadgeComponent`：项目行首字母圆形徽标（底色由项目名哈希稳定生成）。
 *
 * 组件 factory 返回的外层组件为无 hook 纯函数（服务端/测试可直接求值元素树）；
 * 分组块内部经 `useSyncExternalStore` 订阅 `projectGroupStore`（轻量模块级
 * store，跨渲染持久），纯渲染面 `renderProjectGroup` 与纯 handler 工厂
 * `projectGroupHandlers` 可独立单测。
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement, RefObject } from 'react'
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

/** 分组块交互回调（事件已在内部 stopPropagation，阻断冒泡到行按钮的 selectPanel）。 */
export interface ProjectGroupHandlers {
  readonly toggleHeader: (event: ReactMouseEvent<HTMLElement>) => void
  readonly selectProject: (name: string, event: ReactMouseEvent<HTMLElement>) => void
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

/** 分组列表行高（px）与最大高度（约 7 行，超出内部滚动）。 */
const GROUP_ROW_HEIGHT = 30
const GROUP_MAX_HEIGHT = 7 * GROUP_ROW_HEIGHT + 12

/** 渲染分组的全部输入（纯渲染面，测试可直接构造）。 */
export interface ProjectGroupView {
  readonly projects: readonly string[]
  readonly expanded: boolean
  readonly activeProject: string | null
  /** 宽态（展开侧栏）= true；窄态（收起轨）仅渲染徽标计数。 */
  readonly wide: boolean
  /** 量测得到的行宽基准（px；侧栏列可拖拽调宽，随 ResizeObserver 更新）。 */
  readonly rowWidth: number
  /** 挂到分组根 span 的 ref（内部量测 nav 宽度用）。 */
  readonly glyphRef: RefObject<HTMLSpanElement>
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
          backgroundColor: '#fff',
        }}
      />
    </div>
  )
}

/* ============================== 「项目」分组渲染与组件 ============================== */

const groupListStyle = (rowWidth: number): CSSProperties => ({
  position: 'absolute',
  top: 'calc(100% + 12px)',
  left: -10,
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

const groupRowStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: GROUP_ROW_HEIGHT,
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
 * 「项目」分组纯渲染面（无 hook，测试可直接求值元素树）：
 * - 宽态：行内 chevron 指示 + 头部行拦截层（仅切换展开/折叠，阻断行按钮的
 *   selectPanel）+ 展开时的限高滚动项目行列表（首字母徽标 + 项目名，当前项
 *   高亮）或空态提示；
 * - 窄态（收起轨）：仅首字母徽标形态的计数徽标。
 *
 * 布局说明：本组件渲染在 ui-sidebar panellist 行按钮的图标槽内（span.panelGlyph）；
 * 列表以绝对定位浮层挂在行下沿（行按钮所在 nav 的 overflow 可见，仅侧栏列
 * overflow:hidden 兜底裁剪），宽度取量测的 nav 宽度以适配可拖拽侧栏列宽。
 */
export function renderProjectGroup(view: ProjectGroupView, handlers: ProjectGroupHandlers): ReactElement {
  if (!view.wide) {
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
      {/* 头部行拦截层：覆盖整行，点击仅切换展开/折叠（阻断冒泡到行按钮 selectPanel）。 */}
      <span
        aria-hidden="true"
        data-testid="fenix-projects-header"
        onClick={handlers.toggleHeader}
        style={{
          position: 'absolute',
          top: -10,
          left: -10,
          width: view.rowWidth,
          height: 36,
          cursor: 'pointer',
        }}
      />
      {view.expanded ? (
        <span data-testid="fenix-projects-list" style={groupListStyle(view.rowWidth)} onClick={(e) => e.stopPropagation()}>
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
            view.projects.map((name) => {
              const badge = projectBadgeComponent(name)({ size: 18 })
              return (
                <div
                  key={name}
                  role="button"
                  tabIndex={-1}
                  data-testid={`fenix-project-row-${name}`}
                  data-active={view.activeProject === name || undefined}
                  title={name}
                  onClick={(event) => handlers.selectProject(name, event)}
                  style={groupRowStyle(view.activeProject === name)}
                >
                  {badge}
                  <span style={projectNameStyle}>{name}</span>
                </div>
              )
            })
          )}
        </span>
      ) : null}
    </span>
  )
}

/** 分组内量测的缺省行宽基准（侧栏缺省 280 列 - 行内边距/外边距余量）。 */
const DEFAULT_ROW_WIDTH = 260

/**
 * 分组块内部组件（hook 层）：订阅分组 store、量测 panellist nav 宽度并把
 * 渲染委派给纯渲染面 renderProjectGroup。
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

  useLayoutEffect(() => {
    const nav = glyphRef.current?.closest('nav')
    if (!(nav instanceof HTMLElement)) return
    const update = (): void => {
      setRowWidth(Math.min(360, Math.max(160, nav.clientWidth)))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(nav)
    return () => {
      observer.disconnect()
    }
  }, [])

  return renderProjectGroup(
    {
      projects: snapshot.projects,
      expanded: snapshot.expanded,
      activeProject: snapshot.activeProject,
      wide: (size ?? 18) <= WIDE_ICON_SIZE,
      rowWidth,
      glyphRef,
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
