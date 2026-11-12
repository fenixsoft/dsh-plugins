/**
 * Client 半：官方工作区行「项目富提示」浮层（add-workspace-row-project-tooltip
 * D2，2026-11-10）。fenix 项目工作区行名称悬停 500ms（对齐原生 delayMs）后，
 * portal 到 body 的深卡浮层显示项目概况：名称 + 运行态胶囊 / 路径 / 简介一行 /
 * 非零 SPEC 状态胶囊组 / 任务与活跃 Agent 统计。
 *
 * 视觉 = 方案B 暗面胶囊定稿（用户 2026-11-10 批准）：深卡规格逐值取自 dsh web
 * 原生 tooltip 实测（#2C2C2E / 16px 圆角 / 12·16 内距 / 三层阴影 / 标题 #fff
 * 14px·20px / 次文本 #cfd3d6 12px·16px / 无箭头 / 行右侧浮出）；状态→tone 映射
 * 取 fenixd 概览台账 STATUS_META 单源（含 blocked 分相 repairing/queued 扩展），
 * 胶囊色取 OV_TONE 同相暗面派生（文字亮化 + 底 16%~22% 透明）。
 *
 * 结构：纯判定面（tipCardSpec 及各 *_of 函数）node 可测（不触 DOM）；DOM 构建
 * 与显隐控制（createWorkspaceTipController）真实环境专用，node 环境（vitest
 * 单测/SSR）整体 no-op。显隐纯 display 切换，零 animation/transition（静态
 * 渲染红线）；数据失效（投影缺失/exists:false/error）不渲染富提示——该行回退
 * dsh 原生三行提示。原生提示互斥由两层插件侧手段承担（不改原生 tooltip
 * primitive）：① 拦截层 mouse 事件 stopPropagation（panels.tsx 侧）；② 常驻
 * 消解器（createNativeTipSuppressor，panels.tsx 安装期 start）：监听 body 直子
 * 新增/存量浮层，文本命中任一已装层项目名即隐藏（warn 一次），项目移除经
 * refresh 解除（删除行保留回退原生）。②不随富提示显隐启停——两者同为 500ms
 * 延迟，show 时才挂观察器会输掉竞速（落地缺陷：两卡同显）。②未命中且①未
 * 奏效时按静默降级纪律处理（富提示自身显隐不受影响，不破坏原生提示）。
 */
import type { ProjectSummaryProjection } from './projectSync.js'

/** 富提示卡锚属性（幂等/消解判定的存活锚；srcContract 钉值）。 */
export const WORKSPACE_TIP_ATTR = 'data-fenix-wstip'

/** 富提示卡 testid（实拍/排障定位锚）。 */
export const WORKSPACE_TIP_TESTID = 'fenix-wstip-card'

/** 悬停显示延迟（ms；对齐 dsh 原生 tooltip delayMs 500 实测值）。 */
export const WORKSPACE_TIP_DELAY_MS = 500

/** 富卡固定宽（px；原型定稿 300——原生内容自宽 244，富内容放宽并保持同内距）。 */
export const WORKSPACE_TIP_WIDTH_PX = 300

/** 富卡与行右缘的水平间距（px；原型 `left: calc(100% + 12px)`）。 */
export const WORKSPACE_TIP_GAP_PX = 12

/** 富卡相对行顶的纵向偏移（px；原型 `top: -5px`）。 */
export const WORKSPACE_TIP_OFFSET_Y_PX = -5

/** 胶囊 tone 键（与 fenixd STATUS_META StatusTone 同域）。 */
export type TipTone = 'muted' | 'info' | 'warning' | 'critical' | 'good' | 'aqua'

/**
 * 状态→tone 映射（D3 钉值单源；与 fenixd STATUS_META 逐键一致 + blocked 分相
 * repairing/queued 扩展）。未知状态由 statusPillsOf 回退 muted。
 */
export const STATUS_TONE_MAP: Record<string, TipTone> = {
  drafted: 'muted',
  ready: 'info',
  reviewing: 'aqua',
  implementing: 'warning',
  implemented: 'aqua',
  testing: 'info',
  verified: 'good',
  'bug-found': 'critical',
  blocked: 'critical',
  done: 'good',
  pushed: 'good',
  repairing: 'info',
  queued: 'warning',
}

/** 状态→中文标签映射（与 fenixd STATUS_META 逐键一致 + blocked 分相扩展）。 */
export const STATUS_LABEL_MAP: Record<string, string> = {
  drafted: '草稿',
  ready: '就绪',
  reviewing: '评审中',
  implementing: '实现中',
  implemented: '已实现',
  testing: '验证中',
  verified: '已验证',
  'bug-found': '有Bug',
  blocked: '阻塞',
  done: '完成',
  pushed: '已推送',
  repairing: '修复中',
  queued: '排队中',
}

/**
 * 方案B 暗面派生色 [文字, 底]（原型定稿表逐值；文字取 OV_TONE 同相亮化，
 * 底取同相 16%~22% 透明）。srcContract 钉值防漂移。
 */
export const TONE_DARK: Record<TipTone, readonly [string, string]> = {
  info: ['#7aa2ff', 'rgba(37,99,235,.16)'],
  warning: ['#f0ac54', 'rgba(217,119,6,.16)'],
  critical: ['#ff8080', 'rgba(220,38,38,.18)'],
  good: ['#5fce8f', 'rgba(22,163,74,.16)'],
  aqua: ['#45c1dc', 'rgba(8,145,178,.16)'],
  muted: ['#a9b4c0', 'rgba(100,116,139,.22)'],
}

/** 胶囊共用形态（999 · 12px · padding-inline 9 · weight 500；色由 tone 派生拼入）。 */
export const TIP_PILL_CSS =
  'display:inline-block;border-radius:999px;font-size:12px;line-height:18px;padding:1px 9px;font-weight:500;white-space:nowrap;'

/**
 * 深卡容器样式（原型定稿逐值：#2C2C2E / 16px 圆角 / 12px 16px 内距 / 三层阴影
 * / 次文本色基线 / 固定定位 portal）。display 由控制器切换（缺省 none）；
 * 零 animation/transition（静态渲染红线，srcContract 断言源）。
 */
export const TIP_CARD_CSS =
  'position:fixed;z-index:2147483000;box-sizing:border-box;display:none;width:300px;' +
  'background:#2C2C2E;border-radius:16px;padding:12px 16px;' +
  'box-shadow:rgba(0,0,0,.2) 0 0 1px 0,rgba(0,0,0,.02) 0 0 4px 0,rgba(0,0,0,.08) 0 12px 32px 0;' +
  'color:#cfd3d6;font-size:12px;line-height:16px;pointer-events:none;'

/* ============================ 纯判定面（node 可测） ============================ */

/** 运行态胶囊判定（台账名称行同口径）：running+managed=运行中 good /
 * running+unmanaged=运行中·未托管 warning / stopped=未运行 warning；daemon
 * 缺失/其他健康值不渲染运行态胶囊（不伪装）。 */
export function daemonPillOf(summary: ProjectSummaryProjection): { readonly label: string; readonly tone: TipTone } | null {
  if (summary.daemon === 'running') {
    return summary.hosting === 'unmanaged'
      ? { label: '运行中·未托管', tone: 'warning' }
      : { label: '运行中', tone: 'good' }
  }
  if (summary.daemon === 'stopped') return { label: '未运行', tone: 'warning' }
  return null
}

/** 状态胶囊（渲染面行项）。 */
export interface TipStatusPill {
  readonly status: string
  readonly label: string
  readonly tone: TipTone
  readonly count: number
}

/** 胶囊折叠上限（原型定稿：非零状态超过 4 个折叠为前 4 + 「+N」muted 摘要）。 */
export const STATUS_PILL_MAX = 4

/**
 * 非零状态胶囊组：仅保留 count > 0 的状态；序 = STATUS_LABEL_MAP 键序（确定
 * 序防端点 dict 序漂移），未知状态码点序殿后；超过 STATUS_PILL_MAX 折叠为
 * 前 4 + 「+N」muted 摘要胶囊（count 0 不参与任何语义，仅折叠计数）。全零/
 * 字段缺失返回空数组（渲染面整段不渲染）。
 */
export function statusPillsOf(counts: Readonly<Record<string, number>> | null): readonly TipStatusPill[] {
  if (counts === null) return []
  const orderOf = (status: string): number => {
    const index = Object.keys(STATUS_LABEL_MAP).indexOf(status)
    return index >= 0 ? index : Object.keys(STATUS_LABEL_MAP).length + 1
  }
  const pills = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      status,
      label: STATUS_LABEL_MAP[status] ?? status,
      tone: STATUS_TONE_MAP[status] ?? 'muted',
      count,
    }))
    .sort((a, b) => {
      const byOrder = orderOf(a.status) - orderOf(b.status)
      return byOrder !== 0 ? byOrder : a.status < b.status ? -1 : a.status > b.status ? 1 : 0
    })
  if (pills.length > STATUS_PILL_MAX) {
    return [...pills.slice(0, STATUS_PILL_MAX), { status: '+N', label: `+${pills.length - STATUS_PILL_MAX}`, tone: 'muted', count: 0 }]
  }
  return pills
}

/**
 * 富提示渲染判定（回退分支单源）：投影缺失（undefined）或降级标记在场
 * （exists:false / error 非空）→ false（该行回退 dsh 原生提示，不渲染残缺
 * 富提示）。
 */
export function shouldRenderRichTip(summary: ProjectSummaryProjection | undefined): boolean {
  if (summary === undefined) return false
  return summary.exists && summary.error === null
}

/** 数值口径：null/缺失 → 「—」（不伪装 0）；真实 0 照显。 */
function numOf(value: number | null): string {
  return value === null ? '—' : String(value)
}

/** 富卡内容规格（纯数据；DOM 构建消费，node 可测钉内容契约）。 */
export interface TipCardSpec {
  readonly name: string
  /** 运行态胶囊；null 不渲染。 */
  readonly daemon: { readonly label: string; readonly tone: TipTone } | null
  /** 自动发现胶囊（discovered:true 时 muted）；null 不渲染。 */
  readonly discovered: { readonly label: string; readonly tone: TipTone } | null
  /** 路径文本；null 不渲染该行（不伪装）。 */
  readonly path: string | null
  /** 简介行；empty=true 显示占位口径（「暂无简介」）弱化色。 */
  readonly description: { readonly text: string; readonly empty: boolean }
  /** 非零状态胶囊组（含 +N 折叠摘要）；空数组整段不渲染。 */
  readonly pills: readonly TipStatusPill[]
  /** 任务「x/y」；任一缺失 → null（渲染「—」）。 */
  readonly tasks: string | null
  /** 活跃 Agent 数；缺失 → null（渲染「—」）。 */
  readonly activeRuns: string | null
}

/** 投影 → 富卡内容规格（简介空/缺失 → 「暂无简介」，与概览台账口径一致）。 */
export function tipCardSpec(summary: ProjectSummaryProjection): TipCardSpec {
  const descText = summary.description ?? ''
  return {
    name: summary.name,
    daemon: daemonPillOf(summary),
    discovered: summary.discovered ? { label: '自动发现', tone: 'muted' } : null,
    path: summary.path,
    description: { text: descText.length > 0 ? descText : '暂无简介', empty: descText.length === 0 },
    pills: statusPillsOf(summary.status_counts),
    tasks: summary.task_done === null || summary.task_total === null ? null : `${summary.task_done}/${summary.task_total}`,
    activeRuns: summary.active_runs === null ? null : String(summary.active_runs),
  }
}

/* ====================== DOM 构建与显隐控制（真实环境专用） ====================== */

function el(tag: string, cssText: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.style.cssText = cssText
  if (text !== undefined) node.textContent = text
  return node
}

function toneCss(tone: TipTone): string {
  const pair = TONE_DARK[tone]
  return `${TIP_PILL_CSS}color:${pair[0]};background:${pair[1]};`
}

/** spec → 深卡 DOM（textContent 注入，零 innerHTML——项目名/简介 XSS 面封死）。 */
export function renderTipCard(spec: TipCardSpec): HTMLElement {
  const card = el('div', TIP_CARD_CSS)
  card.setAttribute(WORKSPACE_TIP_ATTR, spec.name)
  card.setAttribute('data-testid', WORKSPACE_TIP_TESTID)

  const head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;')
  head.appendChild(el('span', 'color:#ffffff;font-size:14px;line-height:20px;', spec.name))
  const headPills = el('div', 'display:flex;gap:4px;flex:none;')
  if (spec.daemon !== null) headPills.appendChild(el('span', toneCss(spec.daemon.tone), spec.daemon.label))
  if (spec.discovered !== null) headPills.appendChild(el('span', toneCss(spec.discovered.tone), spec.discovered.label))
  if (headPills.childNodes.length > 0) head.appendChild(headPills)
  card.appendChild(head)

  if (spec.path !== null) {
    card.appendChild(el('div', 'color:#cfd3d6;font-size:12px;line-height:16px;margin-top:2px;', spec.path))
  }

  const descCss =
    'color:#cfd3d6;font-size:12px;line-height:16px;margin-top:6px;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;'
  const desc = el('div', spec.description.empty ? `${descCss}color:rgba(207,211,214,.55);` : descCss, spec.description.text)
  card.appendChild(desc)

  if (spec.pills.length > 0) {
    const pills = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;min-width:0;')
    for (const pill of spec.pills) {
      pills.appendChild(el('span', toneCss(pill.tone), pill.status === '+N' ? pill.label : `${pill.label} ${pill.count}`))
    }
    card.appendChild(pills)
  }

  const stats = el('div', 'color:#cfd3d6;font-size:12px;line-height:16px;margin-top:8px;')
  const num = (value: string): HTMLElement => {
    const node = el('b', 'font-weight:600;font-variant-numeric:tabular-nums;', value)
    return node
  }
  stats.appendChild(document.createTextNode('任务 '))
  stats.appendChild(num(spec.tasks ?? '—'))
  stats.appendChild(document.createTextNode(' 个 · 活跃 Agent '))
  stats.appendChild(num(spec.activeRuns ?? '—'))
  stats.appendChild(document.createTextNode(' 个'))
  card.appendChild(stats)

  return card
}

/** 富提示控制器依赖（数据源注入避免 wsTooltip → panels 循环依赖）。 */
export interface WorkspaceTipDeps {
  /** 项目投影枚举（panels.tsx 注入 projectGroupStore 快照读取）。 */
  readonly getSummaries: () => readonly ProjectSummaryProjection[]
}

/** 富提示控制器（enter/leave 幂等；node 环境 no-op）。 */
export interface WorkspaceTipController {
  /** 悬停进入（行名称拦截层锚定）：500ms 后显示；数据失效零动作（回退原生）。 */
  enter(name: string, anchor: Element): void
  /** 悬停离开/滚动/行卸载：收卡、停消解监听。幂等。 */
  leave(): void
  /** 整体清理：收卡并移除浮层 DOM。幂等。 */
  dispose(): void
}

/** 常驻原生提示消解器（手段②·fix-workspace-tip-overlap）：安装期 start、
 * 不随富提示显隐启停——原生 tooltip 与富提示同为 500ms 延迟，show 时才挂
 * 观察器会输掉竞速、错过 portal 节点的 add 事件（落地缺陷实测：两卡同显）。
 * 命中规则 = body 直子（含 start 时存量兜底扫描）文本含任一已装层项目名；
 * 本插件卡经 WORKSPACE_TIP_ATTR 排除，行内浮层（非 body 直子）不误伤。
 * refresh 供项目移除后解除隐藏（删除行保留、回退原生），命中 warn 一次。 */
export interface NativeTipSuppressor {
  start(): void
  refresh(): void
  stop(): void
}

/** 交互面角色选择器：body 直子 portal 若承载菜单/对话框/下拉/通知条等
 * role 标记面，一律不命中消解。2026-11-11 回归教训——文件右键菜单的
 * 「在 Fenix 项目中定位」项文案内嵌项目名，文本匹配曾把整颗菜单挂载即
 * 隐身（display:none），用户侧表现为文件右键弹不出来；querySelector 不含
 * 自身，故 matches 与 querySelector 双查。role=status/alert 通知条亦在名单
 * （通知文案可内嵌项目名，挂载即被吞属误伤）。残留权衡：无任何 role 标记
 * 的非交互 portal（无标记 toast 等）仍在误伤面内——文本包含是消解原生
 * tooltip 的唯一可用判据（原生 tooltip 门户无交互角色、无可钉特征类名，
 * tooltip 角色不可入名单），这类浮层命中后仅 refresh/stop 可解除。 */
export const INTERACTIVE_PORTAL_ROLE_SELECTOR =
  '[role="menu"],[role="menuitem"],[role="dialog"],[role="alertdialog"],[role="listbox"],[role="option"],[role="status"],[role="alert"]'

/** 纯函数守卫（node 可测）：portal 是否交互面（含自身）。 */
export function looksLikeInteractivePortal(node: {
  matches(selector: string): boolean
  querySelector(selector: string): Element | null
}): boolean {
  try {
    return node.matches(INTERACTIVE_PORTAL_ROLE_SELECTOR) || node.querySelector(INTERACTIVE_PORTAL_ROLE_SELECTOR) !== null
  } catch {
    return false
  }
}

export function createNativeTipSuppressor(getNames: () => readonly string[]): NativeTipSuppressor {
  if (typeof MutationObserver !== 'function') {
    return { start: () => {}, refresh: () => {}, stop: () => {} }
  }
  let observer: MutationObserver | undefined
  let warned = false
  const hidden = new Map<HTMLElement, string>()

  const hideIfMatch = (node: HTMLElement): void => {
    if (node.hasAttribute(WORKSPACE_TIP_ATTR)) return // 本插件富卡不误伤
    if (looksLikeInteractivePortal(node)) return // 菜单/对话框/下拉/通知条不误伤
    if (hidden.has(node)) return
    const text = node.textContent ?? ''
    for (const name of getNames()) {
      if (!text.includes(name)) continue
      node.style.display = 'none'
      hidden.set(node, name)
      if (!warned) {
        warned = true
        console.warn(
          '[fenix-dsh-dashboard-bridge] fenix 行原生提示常驻消解命中（已装层行互斥，非 fenix 行不误伤）',
        )
      }
      return
    }
  }

  return {
    start() {
      this.stop()
      if (document.body === null) return
      // 存量兜底：观察器启动前已 open 的 portal 节点 childList 不再报 add。
      for (const node of Array.from(document.body.children)) {
        if (node instanceof HTMLElement) hideIfMatch(node)
      }
      observer = new MutationObserver((mutations) => {
        try {
          for (const mutation of mutations) {
            for (const node of Array.from(mutation.removedNodes)) {
              if (node instanceof HTMLElement) hidden.delete(node)
            }
            for (const node of Array.from(mutation.addedNodes)) {
              if (node instanceof HTMLElement && node.parentElement === document.body) {
                hideIfMatch(node)
              }
            }
          }
        } catch {
          // 消解失败静默（warn-only 纪律上限即此）：富提示自身显隐不受影响。
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    },
    refresh() {
      const names = getNames()
      for (const [node, name] of Array.from(hidden)) {
        if (names.includes(name)) continue // 已装层仍在：维持隐藏
        try {
          node.style.removeProperty('display')
        } catch {
          // 节点已被宿主卸载：忽略。
        }
        hidden.delete(node)
      }
    },
    stop() {
      observer?.disconnect()
      observer = undefined
      for (const node of hidden.keys()) {
        try {
          node.style.removeProperty('display')
        } catch {
          // 节点已被宿主卸载：忽略。
        }
      }
      hidden.clear()
    },
  }
}

/**
 * 创建富提示控制器：单例深卡 lazy portal 到 body；enter 起 500ms 定时器，
 * 到点渲染 spec 并锚定拦截层 rect 右侧显示（视口 clamp）；leave/滚动/行卸载
 * 即收。显隐纯 display 切换（零动画）。原生提示互斥由常驻消解器承担
 * （createNativeTipSuppressor，panels.tsx 安装期启动），控制器不再耦合启停。
 */
export function createWorkspaceTipController(deps: WorkspaceTipDeps): WorkspaceTipController {
  if (typeof document === 'undefined') {
    return { enter: () => {}, leave: () => {}, dispose: () => {} }
  }
  let card: HTMLElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let activeAnchor: Element | undefined

  /** 任意容器滚动即收（scenario：mouseleave/滚动/行卸载即收；capture 捕获
   * 任意滚动容器，passive 零阻塞）。 */
  const onScroll = (): void => {
    leave()
  }
  const armScrollGuard = (): void => {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  }
  const disarmScrollGuard = (): void => {
    document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
  }

  const ensureCard = (): HTMLElement => {
    if (card === undefined) {
      card = el('div', TIP_CARD_CSS)
      card.setAttribute('data-testid', WORKSPACE_TIP_TESTID)
      document.body.appendChild(card)
    }
    return card
  }

  const leave = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    disarmScrollGuard()
    activeAnchor = undefined
    if (card !== undefined) card.style.display = 'none'
  }

  const show = (name: string, anchor: Element): void => {
    const summary = deps.getSummaries().find((row) => row.name === name)
    if (!shouldRenderRichTip(summary) || summary === undefined) return // 回退原生
    // 行瞬窗（重渲染替换中 rect 归零）：不显示残卡。
    const probe = anchor.getBoundingClientRect()
    if (probe.width === 0 && probe.height === 0) return
    const node = ensureCard()
    const fresh = renderTipCard(tipCardSpec(summary))
    fresh.style.display = 'block'
    node.replaceWith(fresh)
    card = fresh
    // 锚定拦截层 rect 右侧（对齐原生 card 相对行右缘浮出），视口越界 clamp。
    const rect = anchor.getBoundingClientRect()
    const width = WORKSPACE_TIP_WIDTH_PX
    let left = rect.right + WORKSPACE_TIP_GAP_PX
    let top = rect.top + WORKSPACE_TIP_OFFSET_Y_PX
    const viewportWidth = document.documentElement?.clientWidth ?? 1024
    const viewportHeight = document.documentElement?.clientHeight ?? 768
    const cardHeight = fresh.getBoundingClientRect().height
    if (left + width > viewportWidth - 8) left = Math.max(8, rect.left - width - WORKSPACE_TIP_GAP_PX)
    if (top + cardHeight > viewportHeight - 8) top = Math.max(8, viewportHeight - cardHeight - 8)
    fresh.style.left = `${Math.round(left)}px`
    fresh.style.top = `${Math.round(top)}px`
    armScrollGuard()
  }

  return {
    enter(name, anchor) {
      leave() // 幂等：换行悬停先收旧卡与旧定时器
      activeAnchor = anchor
      timer = setTimeout(() => {
        timer = undefined
        if (activeAnchor === anchor) show(name, anchor)
      }, WORKSPACE_TIP_DELAY_MS)
    },
    leave,
    dispose() {
      leave()
      card?.remove()
      card = undefined
    },
  }
}
