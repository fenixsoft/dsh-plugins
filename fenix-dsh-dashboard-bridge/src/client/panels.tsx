/**
 * Client 半：iframe 面板、侧栏图标与官方工作区行「名称导航」外挂拦截层。
 *
 * - `DashboardPanel`：主面板内嵌 iframe——src 经 buildPanelSrc 拼装（hash 深链
 *   直达），铺满面板、无边框，并按 layout 契约预留顶部 clearance
 *   （`--dsh-frame-leading-clearance`，macOS 窗口控件带占位，缺省 0）；
 * - `fixedIconComponent`：固定条目的线性图标组件（svg stroke 线性风格），
 *   props 对齐 ui-sidebar 的 SidebarPanelIconOwnerProps（size/active）；
 * - `installWorkspaceNav`：官方工作区行的项目名称导航（SPEC
 *   move-project-nav-to-workspace-rows，2026-11-09 用户裁决）——「项目」菜单
 *   条目与内嵌分区整体退役后，项目导航收敛进官方工作区列表：对命中匹配判据
 *   （matchWorkspaceForProject，D2 路径身份优先）的工作区行，在其名称文本
 *   rect 上挂透明拦截层（absolute + stopPropagation + preventDefault →
 *   deps.selectProject(name)），行首图标区不遮挡（原生 folder→chevron hover
 *   交换与展开/收缩语义保留），行尾 rowActions（菜单/新会话按钮）自带
 *   stopPropagation 不受影响。拦截层是插件命令式外挂 DOM，宿主 React 重渲染
 *   可能使其失挂——经 projectGroupStore 订阅 + ui.workspaces.list 订阅 +
 *   MutationObserver 三通道触发重扫，重扫前校验锚点与既有拦截层存活，缺失
 *   才补挂（幂等，D1 再挂载策略）；锚点不可达（data-row-key 漂移/名称文本
 *   定位失败）→ 该行不装层并 warn 一次，无未处理异常（静默降级，原生行为
 *   兜底）。
 *
 * 组件 factory 返回的外层组件为无 hook 纯函数（服务端/测试可直接求值元素树）；
 * 名称导航纯判定面（findNameTextElement；判据在 projectSync.ts）以 node 桩
 * 替身单测，不依赖真实 DOM。数据源 `projectGroupStore`（轻量模块级 store）
 * 由 index.ts 的项目同步循环驱动（setProjects 名称列表 / setProjectRows
 * 路径行）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { alertCountStore } from './alertCount.js'
import { buildProjectRowMap, compareNames } from './projectSync.js'
import type { ProjectRowInfo, ProjectSummaryProjection, WorkspaceItemLike } from './projectSync.js'
import { createNativeTipSuppressor, createWorkspaceTipController } from './wsTooltip.js'
import type { WorkspaceTipController } from './wsTooltip.js'

/** ui-sidebar 传给图标组件的 owner props（SidebarPanelIconOwnerProps 子集）。 */
export interface PanelIconProps {
  /** 请求的正方形边长（px；宽列 16 / 收起轨 18）。 */
  readonly size?: number
  /** 本面板是否处于选中态。 */
  readonly active?: boolean
}

/** 固定条目 id（与深链一一对应，见 client/index.ts FIXED_ENTRIES；5 项——
 * 「Fenix 项目」曾于 2026-11-11 上午挂上左侧 rail（order 12 + main 面板），
 * 同日 m02220 用户纠正「侧边栏」语义（指对话界面右缘 dock，非左侧菜单栏）
 * 后移除，改由 rightTab.tsx 在右侧边栏挂「Fenix 项目」页签；2026-11-09 退役
 * 的逐项目「项目」内嵌分区（move-project-nav-to-workspace-rows）语义不变）。 */
export type FixedEntryId =
  | 'fenix-overview'
  | 'fenix-command-center'
  | 'fenix-settings'
  | 'fenix-activities'
  | 'fenix-help'

/** 线性图标 path 数据（24×24 viewBox，stroke 线性风格）。 */
const FIXED_GLYPHS: Record<FixedEntryId, readonly string[]> = {
  'fenix-overview': ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  // 指挥中心：指挥屏意象——外框显示器 + 屏内折线态势 + 底座支架（线性风格）。
  'fenix-command-center': [
    'M3 4h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M6 12l3-3 2.5 2.5L15 8l3 3',
    'M9 20h6',
    'M12 16v4',
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
    'M12 22a10 10 0 1 0 0-20 10 10 0 1 0 0 20z',
    'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4',
    'M12 17.5h.01',
  ],
}

/* ============ 运维条目告警徽标（add-dsh-ops-alert-badge） ============ */

/**
 * 徽标圆几何（viewBox 24×24 坐标系钉值）：右上角落位，圆域
 * [cx±r, cy±r] = [12,24]×[0,12] 完全落于 viewBox 之内（闭边界包含）
 * （tests/opsBadge.test.ts 元素树断言钉值；svg 内绘制天然落在图标盒内，
 * 免疫宿主侧栏条目容器 overflow:hidden 裁剪——fenixd dashboard 侧栏徽标
 * 「绝对定位角标悬出文本盒被裁成红弧」同型缺陷的根因规避，spec 防裁剪条款）。
 * 圆径 12 单位覆盖 `99+` 三字符 em-box 全宽（真实浏览器度量，含系统字体
 * advance），文字 em-box 亦全落于圆内/svg 内（r=5.5 档实测 99+ em 右缘溢出
 * svg 0.09px 被边缘裁剪，本档位修复）。viewBox 坐标随 size 渲染尺寸等比
 * 缩放，窄态侧栏（仅显图标）同样完整。
 */
export const OPS_BADGE_CIRCLE = { cx: 18, cy: 6, r: 6 } as const

/** 徽标红底色钉值（红底白字角标，spec「徽标渲染与零值隐匿」）。 */
export const OPS_BADGE_RED = '#e5484d'

/** 超百截断阈值：计数 > 99 显示 `99+`。 */
export const OPS_BADGE_MAX = 99

/** 徽标角标 testid（元素树断言锚点）。 */
export const OPS_BADGE_TESTID = 'fenix-ops-alert-badge'

/** 徽标文案：>99 显示 `99+`（spec 超百截断），其余原样十进制。 */
export function opsBadgeLabel(count: number): string {
  return count > OPS_BADGE_MAX ? '99+' : String(count)
}

/** 徽标字号（viewBox 单位）：随字符数收缩，单字符大字、`99+` 三字符最小
 * 可读（4.8 档 em 宽 ≈11 单位 < 圆径 12，em-box 全落于圆内/svg 内）。 */
function opsBadgeFontSize(label: string): number {
  if (label.length <= 1) return 8
  if (label.length === 2) return 6.2
  return 4.8
}

/**
 * 徽标 `<g>`（circle + text）元素：红底白字，文字白描边（paintOrder:stroke
 * 描边垫底）保细字在小尺寸下不断裂可读。调用方保证 count > 0（0/尚无成功
 * 拉取不产生任何角标元素——零告警隐匿）。
 */
export function opsAlertBadgeElement(count: number): ReactElement {
  const label = opsBadgeLabel(count)
  const { cx, cy, r } = OPS_BADGE_CIRCLE
  return (
    <g data-testid={OPS_BADGE_TESTID}>
      <circle cx={cx} cy={cy} r={r} fill={OPS_BADGE_RED} stroke="none" />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={opsBadgeFontSize(label)}
        fontWeight={700}
        fill="#fff"
        stroke="#fff"
        strokeWidth={0.9}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  )
}

/** 固定条目线性图标组件工厂（每个条目 id 一枚）。 */
export function fixedIconComponent(id: FixedEntryId): (props: PanelIconProps) => ReactElement {
  const glyph = FIXED_GLYPHS[id]
  return function FixedIcon({ size = 18 }: PanelIconProps) {
    // 运维条目叠加待裁决告警徽标（add-dsh-ops-alert-badge）：无 hook 纯函数
    // 读 alertCountStore 快照求值——计数变更经 index.ts 遮蔽重注册触发宿主
    // 重渲染后此快照即新值（组件自身不订阅，仓库纪律：服务端/测试可直接求值
    // 元素树）。count>0 渲染角标；0 或尚无成功拉取（null）不渲染任何角标元素。
    const count = id === 'fenix-activities' ? alertCountStore.getSnapshot().count : null
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
        {count !== null && count > 0 ? opsAlertBadgeElement(count) : null}
      </svg>
    )
  }
}

/**
 * iframe 面板组件：src 由调用方经 buildPanelSrc 拼装后传入。
 *
 * 安全前提（同源完全信任，显式声明）：src 均为 `/fenix-dashboard/` 同源
 * 前缀反代下发的自家静态资源，内容可信——故本 iframe 有意不加 sandbox：
 * 同源文档与宿主页面完全同权（iframe 内脚本可直读 parent.document 与
 * 宿主全局状态），该信任模型是本插件安全边界的单点假设。宿主侧消息通道
 * （installDashboardSessionRequests，client/index.ts）对 event.origin 做
 * 了严格校验（非宿主 origin 一律忽略），但那只是通道准入判定，并不构成
 * 对 iframe 内容的能力隔离。若信任前提被破坏（反代路径可能注入第三方
 * 内容），MUST 改造为 sandbox + postMessage 通道方案（注意
 * allow-same-origin 与脚本并存时 sandbox 形同虚设，需同步收窄 iframe 能
 * 力并把跨帧通信全量改走 postMessage）。
 */
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
          // 底色随宿主主题走变量口径，缺省回退纯白。
          backgroundColor: 'var(--dsw-specific-sidebar-fill, #fff)',
        }}
      />
    </div>
  )
}

/* ================== 官方工作区列表滚动条（注入式 CSS，既有 polish 维持） ================== */

/**
 * 官方 Workspaces 列表滚动条定制（2026-11-06 用户指令：与项目卡片一致——
 * 只留滑块，去上下箭头与轨道底色，滑块 6px 收窄；dsh 全局滚动条为 10px +
 * Chrome 默认箭头/轨道底）。「项目」内嵌分区已随 move-project-nav-to-workspace-rows
 * 退役，本样式表仅保留官方 regionArea 列表规则（既有 polish 不回退）。
 * 宿主类名是 CSS modules 哈希（如 bhn1Oq_list），哈希前缀随构建变、
 * _regionArea/_list 语义段源自源文件类名稳定——属性包含匹配 + regionArea
 * 后代限定，不外溢到宿主其他 _list。注入形态对齐 dsh 官方插件 CSS
 * （style[data-plugin-css] 单例）；node 测试环境无 document，注入跳过；
 * CSS 文本导出供合同测试断言。
 */
export const PROJECT_ROW_CSS = [
  '[class*="_regionArea"] [class*="_list"]::-webkit-scrollbar { width: 6px; }',
  '[class*="_regionArea"] [class*="_list"]::-webkit-scrollbar-thumb { border: 0; border-radius: 3px; background-color: var(--dsh-scrollbar-thumb); background-image: none; background-clip: padding-box; }',
  '[class*="_regionArea"] [class*="_list"]::-webkit-scrollbar-thumb:hover { background-color: var(--dsh-scrollbar-thumb-hover); }',
  '[class*="_regionArea"] [class*="_list"]::-webkit-scrollbar-track { background-color: transparent; }',
  '[class*="_regionArea"] [class*="_list"]::-webkit-scrollbar-button { display: none; }',
].join('\n')

/** 注入样式单例的 data-plugin-css 标识（幂等重挂防重）。 */
const PROJECT_ROW_CSS_TAG = 'fenix-dsh-dashboard-bridge/project-rows.css'

function injectProjectRowCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${PROJECT_ROW_CSS_TAG}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'fenix-dsh-dashboard-bridge'
  tag.dataset.pluginCss = PROJECT_ROW_CSS_TAG
  tag.textContent = PROJECT_ROW_CSS
  // head 缺失（极端时序）静默放弃：模块加载期 head 恒在，防御性兜底即可。
  document.head?.appendChild(tag)
}
injectProjectRowCss()

/* ===================== 项目数据源（名称导航共享 store） ===================== */

/** 名称导航共享快照（模块级轻量 store，跨渲染持久）。 */
export interface ProjectGroupSnapshot {
  /** 项目名列表（去重、码点序）。 */
  readonly projects: readonly string[]
  /** 项目路径行（对齐拉取沉淀；滞后容忍，缺行按路径不可得走标题兜底）。 */
  readonly projectRows: readonly ProjectRowInfo[]
  /** ProjectSummary 精简投影（tooltip 富提示数据源；滞后容忍，缺行回退原生）。 */
  readonly summaries: readonly ProjectSummaryProjection[]
}

type Listener = () => void

function createProjectGroupStore() {
  let snapshot: ProjectGroupSnapshot = { projects: [], projectRows: [], summaries: [] }
  const listeners = new Set<Listener>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const sameList = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((name, index) => name === b[index])
  const sameRows = (a: readonly ProjectRowInfo[], b: readonly ProjectRowInfo[]): boolean =>
    a.length === b.length &&
    a.every((row, index) => {
      const other = b[index]
      return other !== undefined && row.name === other.name && row.path === other.path
    })
  const sameCounts = (
    a: Readonly<Record<string, number>> | null,
    b: Readonly<Record<string, number>> | null,
  ): boolean => {
    if (a === null || b === null) return a === b
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((key) => b[key] === a[key])
  }
  const sameSummaries = (a: readonly ProjectSummaryProjection[], b: readonly ProjectSummaryProjection[]): boolean =>
    a.length === b.length &&
    a.every((row, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        row.name === other.name &&
        row.path === other.path &&
        row.description === other.description &&
        row.daemon === other.daemon &&
        row.hosting === other.hosting &&
        row.exists === other.exists &&
        row.discovered === other.discovered &&
        row.error === other.error &&
        row.task_done === other.task_done &&
        row.task_total === other.task_total &&
        row.active_runs === other.active_runs &&
        sameCounts(row.status_counts, other.status_counts)
      )
    })
  return {
    getSnapshot: (): ProjectGroupSnapshot => snapshot,
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** 整体替换项目列表：去重 + 码点序；无变化零通知。 */
    setProjects(names: readonly string[]): void {
      const projects = [...new Set(names)].sort(compareNames)
      if (sameList(snapshot.projects, projects)) return
      snapshot = { projects, projectRows: snapshot.projectRows, summaries: snapshot.summaries }
      emit()
    },
    /** 整体替换项目路径行（对齐拉取成功时驱动）；无变化零通知。 */
    setProjectRows(rows: readonly ProjectRowInfo[]): void {
      if (sameRows(snapshot.projectRows, rows)) return
      snapshot = { projects: snapshot.projects, projectRows: [...rows], summaries: snapshot.summaries }
      emit()
    },
    /** 整体替换项目投影（tooltip 富提示数据源）；无变化零通知。 */
    setSummaries(summaries: readonly ProjectSummaryProjection[]): void {
      if (sameSummaries(snapshot.summaries, summaries)) return
      snapshot = { projects: snapshot.projects, projectRows: snapshot.projectRows, summaries: [...summaries] }
      emit()
    },
    /** 测试隔离用：恢复初始快照（不动订阅者）。 */
    reset(): void {
      snapshot = { projects: [], projectRows: [], summaries: [] }
      emit()
    },
  }
}

/** 项目数据源 store 单例（名称导航消费；sync 循环驱动）。 */
export const projectGroupStore = createProjectGroupStore()

/* ================= 名称导航（工作区行项目导航，2026-11-09 用户裁决） ================= */

/** 官方工作区行的 data-row-key 键前缀（dsh-client-ui-workspace ProjectRow）。 */
export const WORKSPACE_ROW_KEY_PREFIX = 'workspace:'

/** 名称导航行锚点选择器：data-row-key 前缀 workspace:（语义锚点，非 CSS 哈希）。 */
export const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'

/** 拦截层标记属性（幂等补挂的存活校验锚；值=项目名）。 */
export const WORKSPACE_NAV_OVERLAY_ATTR = 'data-fenix-wsnav'

/** 宿主重渲染重扫去抖（ms）：吸收侧栏过渡动画与列表增量更新的 DOM 抖动。 */
export const WORKSPACE_NAV_RESCAN_DEBOUNCE_MS = 300

/** 名称文本元素最小结构面（真实 Element 天然满足；node 桩按形状构造）。 */
export interface NameTextLike {
  readonly textContent: string | null
  readonly children: { readonly length: number }
}

/** 行元素最小结构面（真实 Element 天然满足；node 桩按形状构造）。 */
export interface RowQueryLike {
  querySelectorAll(selectors: string): { readonly length: number; [index: number]: NameTextLike | undefined }
}

/**
 * 名称文本候选判据：无元素子节点，或仅含拦截层子节点——拦截层由 ensureOverlay
 * append 进名称文本内部，严格无子判据会让挂层后的名称文本永久失明、rescan
 * 无法再命中，ensureOverlay 的换层分支（同文本位项目名变化）不可达。node 桩
 * 替身的 children 只有 length、无从检子元素属性，一律按「有非层子元素」处理
 * （既有替身行为不变）。
 */
function isNameTextCandidate(node: NameTextLike): boolean {
  if (node.children.length === 0) return true
  const children = node.children as unknown as readonly unknown[]
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index] as { getAttribute?: (name: string) => string | null } | undefined
    const attribute = child?.getAttribute?.(WORKSPACE_NAV_OVERLAY_ATTR)
    if (attribute === undefined || attribute === null) return false
  }
  return true
}

/**
 * 行内名称文本定位（D1 锚点链第二步）：遍历行内全部元素，取「无子元素（或
 * 仅含拦截层子元素，见 isNameTextCandidate）且文本内容（trim 后）与项目名
 * 精确相等」的元素——官方行名称结构为 span.projectText > span.title 双层，
 * 无子元素约束天然命中内层 title；挂层后的 title 经拦截层子元素例外维持
 * 命中（同文本位项目名变化时换层分支可达）。MUST NOT 依赖 CSS module 哈希
 * 类名。未命中返回 null（该行不装层，静默降级）。
 */
export function findNameTextElement(row: RowQueryLike, name: string): NameTextLike | null {
  let found: NameTextLike | null = null
  const nodes = row.querySelectorAll('*')
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node === null || node === undefined) continue
    if (!isNameTextCandidate(node)) continue
    if ((node.textContent ?? '').trim() !== name) continue
    found = node // 文档序持续覆盖：同文本嵌套时取最深命中
  }
  return found
}

/** 名称导航装配依赖（index.ts 注入，避免 panels → index 循环依赖）。 */
export interface WorkspaceNavDeps {
  /** 名称点击回调：切换主面板为该项目 iframe（index.ts 注入 projectPanelSelector(ctx)）。 */
  readonly selectProject: (name: string) => void
}

/** 侧栏工作区 list 服务最小结构面（ctx.uiWorkspace 形状漂移防御）。 */
interface WorkspaceListSource {
  getSnapshot?(): { items?: unknown } | undefined
  subscribe?(listener: () => void): () => void
}

/**
 * 工作区行名称导航装配（命令式外挂 DOM，无 React）：
 * - 扫描：官方工作区行（data-row-key 前缀 workspace:）× 项目↔行映射
 *   （buildProjectRowMap，D2 判据）命中行 → 名称文本定位 → 挂透明拦截层
 *   （absolute inset:0，基准=名称文本 span 置 relative，随滚动自动跟随）；
 *   点击 stopPropagation + preventDefault → deps.selectProject(name)；
 *   行首图标区/行尾 rowActions 不在层内，原生语义零侵入。
 * - 再挂载（D1）：三通道触发重扫——projectGroupStore 订阅（sync 数据到齐）、
 *   ui.workspaces.list 订阅（工作区增删，防御缺席）、MutationObserver 去抖
 *   （行 React 重渲染替换名称文本等 DOM 变化）；重扫幂等（既有拦截层存活
 *   校验，缺失才补挂），映射失效行清残留层。
 * - 降级：项目列表未就绪/工作区行未挂载 → 清层零动作；data-row-key 枚举
 *   整体失效 → warn 一次后降级原生；单行名称文本定位失败 → 该行不装层
 *   warn 一次；全部错误路径 warn-only，无未处理异常。
 *
 * @returns 停止函数：断开观察器、退订、移除全部拦截层；node 环境（无
 * document，vitest 单测/SSR）返回 no-op。
 */
export function installWorkspaceNav(ctx: Context, deps: WorkspaceNavDeps): () => void {
  if (typeof document === 'undefined') return () => {}
  let stopped = false
  let disposed = false
  let debounce: ReturnType<typeof setTimeout> | undefined
  const warnedRows = new Set<string>()
  let warnedRowEnum = false

  const list = (ctx.uiWorkspace as { workspaces?: { list?: WorkspaceListSource } } | undefined)?.workspaces?.list

  const itemsFromSnapshot = (): readonly WorkspaceItemLike[] => {
    try {
      const items = list?.getSnapshot?.()?.items
      return Array.isArray(items) ? (items as readonly WorkspaceItemLike[]) : []
    } catch {
      return [] // 快照抛错（形状漂移/桩缺方法）：按空表处理（不装层），不外溢
    }
  }

  const warnOnceForRow = (key: string, reason: string): void => {
    if (warnedRows.has(key)) return
    warnedRows.add(key)
    console.warn(`[fenix-dsh-dashboard-bridge] 工作区行 ${key} 名称导航未装配（${reason}），维持原生行为`)
  }

  // 富提示控制器（add-workspace-row-project-tooltip D2）：数据源 = 本模块
  // projectGroupStore.summaries；node 环境（无 document）整体 no-op。
  const tip: WorkspaceTipController = createWorkspaceTipController({
    getSummaries: () => projectGroupStore.getSnapshot().summaries,
  })

  // 已装层项目名集合（常驻消解器的命中名单）：与拦截层存亡严格同步——
  // ensureOverlay 换层/新挂写入，removeAllOverlays 清空，removeOverlaysOfName
  // 按名移除。消解器只对「确有拦截层的行」隐藏原生提示（非 fenix 行不误伤）。
  const installedNames = new Set<string>()

  // 原生提示互斥手段②（fix-workspace-tip-overlap）：安装期常驻启动，不随富
  // 提示显隐启停——原生 tooltip 与富提示同为 500ms 延迟，show 时才挂观察器
  // 会输掉竞速（落地缺陷实测：两卡同显）。
  const nativeTipSuppressor = createNativeTipSuppressor(() => Array.from(installedNames))
  nativeTipSuppressor.start()

  const removeAllOverlays = (): void => {
    for (const overlay of Array.from(document.querySelectorAll(`[${WORKSPACE_NAV_OVERLAY_ATTR}]`))) {
      overlay.remove()
    }
    installedNames.clear()
    tip.leave() // 行卸载/清残留时富提示随收（overlay DOM 移除不再派发 mouseleave）
  }

  /** 挂装/幂等保活单行拦截层：既有同项目层存活即返回；缺失补挂；项目名变化换层。 */
  const ensureOverlay = (nameText: Element, name: string): void => {
    const parent = nameText.parentElement
    if (parent === null) return
    const existing = parent.querySelector(`[${WORKSPACE_NAV_OVERLAY_ATTR}]`)
    if (existing !== null) {
      const existingName = existing.getAttribute(WORKSPACE_NAV_OVERLAY_ATTR)
      if (existingName === name) return // 存活幂等
      if (existingName !== null) installedNames.delete(existingName) // 换层：旧名退出消解名单
      existing.remove() // 同文本位项目名变化（改名/换映射）：换层
      tip.leave() // 旧层移除：富提示随收（防残卡挂失锚）
      nativeTipSuppressor.refresh() // 旧名的存量原生提示解Hide
    }
    installedNames.add(name) // 新挂/换层：该行原生提示进入互斥名单
    const overlay = document.createElement('span')
    overlay.setAttribute(WORKSPACE_NAV_OVERLAY_ATTR, name)
    overlay.setAttribute('data-testid', 'fenix-wsnav-overlay')
    // 透明命中区，零新增视觉（D6：拦截层样式零新增）；cursor 提示名称可点。
    overlay.style.cssText = 'position:absolute;inset:0;background:transparent;cursor:pointer;'
    overlay.addEventListener('click', (event) => {
      event.stopPropagation()
      event.preventDefault()
      deps.selectProject(name)
    })
    // 富提示悬停（500ms 延迟显示，见 wsTooltip.ts）：数据失效/非 fenix 行由
    // 控制器判定零动作（回退原生提示）。
    overlay.addEventListener('mouseenter', (event) => {
      event.stopPropagation()
      tip.enter(name, overlay)
    })
    overlay.addEventListener('mouseleave', (event) => {
      event.stopPropagation()
      tip.leave()
    })
    // 原生提示互斥手段①（D2）：hover 链事件在拦截层吞噬、不上达宿主监听器
    // （React 合成 onMouseEnter 靠 mouseover/out 代理，原生层 stopPropagation
    // 即断；CSS :hover 不经 JS、行 hover 高亮不受影响）。点击导航行为不变。
    for (const type of ['mouseover', 'mouseout', 'mousemove'] as const) {
      overlay.addEventListener(type, (event) => event.stopPropagation())
    }
    // 定位基准：名称文本 span 置 relative（static→relative 无布局位移），
    // 拦截层 inset:0 精确覆盖文本 rect 且随滚动自动跟随。
    if (nameText instanceof HTMLElement && getComputedStyle(nameText).position === 'static') {
      nameText.style.position = 'relative'
    }
    nameText.appendChild(overlay)
  }

  const rescan = (): void => {
    if (stopped) return
    try {
      const snapshot = projectGroupStore.getSnapshot()
      const rowElements = Array.from(document.querySelectorAll<HTMLElement>(WORKSPACE_ROW_SELECTOR))
      if (snapshot.projects.length === 0 || rowElements.length === 0) {
        // 项目列表未就绪（boot 早期）或工作区行整体未挂载/选择器漂移：清残留层。
        removeAllOverlays()
        if (rowElements.length === 0 && snapshot.projects.length > 0 && itemsFromSnapshot().length > 0 && !warnedRowEnum) {
          warnedRowEnum = true
          console.warn(
            '[fenix-dsh-dashboard-bridge] 工作区行枚举为空（data-row-key 锚点漂移），名称导航降级为原生行为',
          )
        }
        return
      }
      const items = itemsFromSnapshot()
      if (items.length === 0) {
        // 工作区快照未就绪（boot 早期/宿主刷新空窗——实测 dsh Remote model
        // 周期性重载时 items 瞬空）：判定面不可信，本轮不动层（幂等保活）。
        return
      }
      const map = buildProjectRowMap(items, snapshot.projects, snapshot.projectRows)
      for (const row of rowElements) {
        const key = row.getAttribute('data-row-key') ?? ''
        const workspaceId = key.startsWith(WORKSPACE_ROW_KEY_PREFIX)
          ? key.slice(WORKSPACE_ROW_KEY_PREFIX.length)
          : ''
        const name = workspaceId.length > 0 ? map.get(workspaceId) : undefined
        if (name === undefined) continue // 扫描轮零清理（清理由下方 store 差分驱动）
        const nameText = findNameTextElement(row, name)
        if (nameText === null || !(nameText instanceof Element)) {
          // 行内既有层在场时不 warn（瞬窗行文本瞬空时层仍挂原 span、rect 归零
          // 无害；真缺层 + 定位失败才是锚点漂移信号）。
          if (row.querySelector(`[${WORKSPACE_NAV_OVERLAY_ATTR}]`) === null) {
            warnOnceForRow(key, '名称文本定位失败（锚点漂移）')
          }
          continue
        }
        ensureOverlay(nameText, name)
      }
    } catch (error) {
      // 扫描链路整体防御（DOM 异常/形状漂移）：warn 降级原生，无未处理异常。
      console.warn(
        `[fenix-dsh-dashboard-bridge] 工作区名称导航扫描失败（本轮跳过）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * 清理唯一入口 = store.projects 差分（稳定面）：项目从 sync 列表移除时按名
   * 清其拦截层（项目删除行保留、失去导航回退原生）。扫描轮不清层——实测宿主
   * 工作区快照周期性瞬变（items 行内容/行文本瞬空），任何依赖行/快照瞬态的
   * 逐轮清理判据都会被瞬窗击穿，与补挂循环形成挂↔清震荡（实测 7↔0 @ ~670ms）。
   */
  let knownProjects = projectGroupStore.getSnapshot().projects
  const removeOverlaysOfName = (name: string): void => {
    const attr = `${WORKSPACE_NAV_OVERLAY_ATTR}`
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(name) : name
    for (const overlay of Array.from(document.querySelectorAll(`[${attr}="${escaped}"]`))) {
      overlay.remove()
    }
    tip.leave()
    installedNames.delete(name)
    nativeTipSuppressor.refresh() // 项目移除：对应存量原生提示解Hide（删除行保留、回退原生）
  }
  const unsubscribeStore = projectGroupStore.subscribe(() => {
    const snapshot = projectGroupStore.getSnapshot()
    for (const name of knownProjects) {
      if (!snapshot.projects.includes(name)) removeOverlaysOfName(name)
    }
    knownProjects = snapshot.projects
    nativeTipSuppressor.refresh() // 快照兜底：名单与存量隐藏态对齐（换层路径之外的漂移）
    rescan()
  })

  const scheduleRescan = (): void => {
    if (stopped) return
    if (debounce !== undefined) clearTimeout(debounce)
    debounce = setTimeout(rescan, WORKSPACE_NAV_RESCAN_DEBOUNCE_MS)
  }

  // 通道1（store 订阅含 projects 差分清理，见上方 removeOverlaysOfName）。
  // 通道2：工作区快照变化（新建/删除/重命名）→ 去抖重扫（服务缺席防御跳过）。
  const unsubscribeList =
    typeof list?.subscribe === 'function' ? list.subscribe(scheduleRescan) : () => {}
  // 通道3：宿主 DOM 变化（行重渲染替换名称文本、列表增量更新）→ 去抖重扫。
  let observer: MutationObserver | undefined
  if (typeof MutationObserver === 'function' && document.body !== null) {
    observer = new MutationObserver(scheduleRescan)
    observer.observe(document.body, { childList: true, subtree: true })
  }

  rescan() // 立即首扫（boot 已就绪时零延迟生效）

  return () => {
    if (disposed) return
    disposed = true
    stopped = true
    unsubscribeStore()
    unsubscribeList()
    observer?.disconnect()
    if (debounce !== undefined) clearTimeout(debounce)
    removeAllOverlays()
    nativeTipSuppressor.stop() // 全量解Hide：卸载后原生行为完整还原
    tip.dispose()
  }
}
