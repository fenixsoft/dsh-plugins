/**
 * fenix-dsh-session-advanced-search client 半装配（内容区嵌入形态 v3.1）。
 *
 * 需求演进（用户指令）：
 *   - m00937「转向独立定制的高级搜索页面，不要再会话界面上修改元素」
 *     → 搜索 UI 收敛为独立页（host 半 exact 路由直出自包含 HTML）；
 *   - m01459「高级搜索的页面应当是嵌入在右侧的内容区域，不能把菜单也占掉了」
 *     → 入口按钮开合内容区 iframe 嵌入（侧栏/菜单完全可见可交互）；
 *   - m01577 修「重新点高级搜索没保留原搜索结果」
 *     → 容器改挂 **document.body** 固定定位（不再挂进 React 管理的内容区
 *       节点——React 重渲染会摘除外来子节点，令缓存容器失连成孤儿；body
 *       挂载点 React 不可达，iframe 天然保活，重开即原样恢复）。位置用内容
 *       区锚点矩形计算（覆盖内容区、避让侧栏），resize/布局变化时同步。
 *   - m01577 修「搜索结果点击没有正确跳转到被搜索到的会话」
 *     → 恢复 v1 的 `ctx.uiWorkspace.openSession(sessionId)` 服务缝（官方侧
 *       栏搜索结果打开会话同走此缝）：iframe 页点结果卡 → 同源直调
 *       `parent.__fenixSas.openSession(id)` → 应用内导航（不整页刷新）。
 *       localStorage + 首页导航（restoreSelection 缝）保留为服务缝缺失时
 *       的兜底（独立页形态无父级服务，天然走兜底）。
 *
 * 生命周期：按钮点击 → 惰性挂载（判定一次并缓存）+ 同步位置 + 显示；关闭
 * 路径三重 ① 页内「返回会话」→ window.parent.__fenixSas.close()（同源直
 * 调）② 会话切换（selection 快照店订阅主缝 + 侧栏点击捕获兜底）③ Escape。
 * 关闭 = display:none 隐藏容器（iframe 保活，重开无闪白）；卸载对称清理。
 *
 * 模块体经 `window.__ModuleLoader__.load({ id, factory })` 注册（tsdown
 * banner/footer 包装），dsh plugin-manager 消费 `inject` 服务键 + `apply(ctx)`
 * 停止函数。`inject` 声明 uiWorkspace（跳转服务缝）；缝运行期缺失仍自守
 * （跳转走兜底、切会话收视图走侧栏点击兜底）。apply 在无 document 环境
 * 自守跳过不抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import { PAGE_PATH } from '../shared/protocol.js'
import { injectSearchButton, ANCHOR } from './searchButton.js'
import type { SearchButtonHandle } from './searchButton.js'

/** 本插件消费的 client 服务键（uiWorkspace：openSession 跳转缝 + selection 收视图缝）。 */
export const inject: readonly string[] = ['uiWorkspace']

/** 侧栏容器锚点（结构化缝：搜索框 input 的最近侧栏祖先；失配降级抽屉）。 */
const SIDEBAR_SELECTOR = '[class*="sidebar"]'

/** selection 快照店缝（dsh-client-store createSnapshotStore 形态子集）。 */
interface SelectionStoreWatch {
  subscribe(listener: () => void): () => void
}

/** uiWorkspace 服务被消费面（均为可选：缝漂移时逐项探测降级）。 */
interface UiWorkspaceSeam {
  /** subscribe 同步抛错时返回 undefined：缝实际未挂上，装配层按不可用降级。 */
  watchSelectionChange?(listener: () => void): (() => void) | undefined
  openSession?(sessionId: string): void
}

/** client 侧日志门面（消息自带插件前缀）。 */
const log = {
  warn: (message: string) => console.warn(message),
  debug: (message: string) => console.debug(message),
}

/** uiWorkspace 安全探测（逐缝独立：selection 订阅与 openSession 互不绑定）。 */
function resolveUiWorkspace(ctx: Context): UiWorkspaceSeam | undefined {
  let ui: unknown
  try {
    ui = (ctx as unknown as Record<string, unknown>).uiWorkspace
  } catch {
    return undefined
  }
  if (ui === null || typeof ui !== 'object') return undefined
  const seam: UiWorkspaceSeam = {}
  const source = ui as { selection?: unknown; openSession?: unknown }
  const selection = source.selection
  if (selection !== null && typeof selection === 'object') {
    const subscribe = (selection as { subscribe?: unknown }).subscribe
    if (typeof subscribe === 'function') {
      const store = selection as SelectionStoreWatch
      seam.watchSelectionChange = (listener: () => void): (() => void) | undefined => {
        try {
          return subscribe.call(store, listener)
        } catch {
          // subscribe 同步抛错 = 监听未挂上：返回 undefined（不伪造可用 dispose），
          // 使 disposeSelectionWatch 退化为 undefined、缝被判定不可用。
          return undefined
        }
      }
    }
  }
  if (typeof source.openSession === 'function') {
    const open = source.openSession as (this: unknown, sessionId: string) => void
    seam.openSession = (sessionId: string): void => {
      open.call(ui, sessionId)
    }
  }
  return seam.watchSelectionChange !== undefined || seam.openSession !== undefined ? seam : undefined
}

/**
 * 内容区锚点判定（结构性：搜索框所在侧栏的相邻兄弟元素）。v3.1 起仅用于
 * **取位置矩形**（容器挂 body 固定定位），不再作为 DOM 挂载点。
 */
function resolveContentHost(doc: Document): HTMLElement | undefined {
  const input = doc.querySelector(ANCHOR.inputSelector)
  if (input === null) return undefined
  const sidebar = input.closest(SIDEBAR_SELECTOR)
  if (sidebar === null) return undefined
  const content = sidebar.nextElementSibling
  return content instanceof HTMLElement ? content : undefined
}

/**
 * 嵌入面板定位：优先内容区锚点矩形（left/top/width/height 精确覆盖内容区，
 * 侧栏与顶栏完全可见）；失配退化为右侧抽屉（left=侧栏实测宽，余全屏）。
 * @returns 定位样式串 + 观察目标（锚点命中时为内容区元素，供 ResizeObserver）。
 */
function panelLayout(doc: Document): { style: string; observe?: Element } {
  const host = resolveContentHost(doc)
  if (host !== undefined) {
    const rect = host.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const round = (n: number): number => Math.round(n)
      return {
        style:
          `position:fixed;top:${round(rect.top)}px;left:${round(rect.left)}px;` +
          `width:${round(rect.width)}px;height:${round(rect.height)}px;z-index:900;` +
          'background:var(--dsh-bg,#fff);box-shadow:-8px 0 24px rgba(0,0,0,.12);',
        observe: host,
      }
    }
  }
  // 抽屉降级：left=侧栏右边界（避让失败退 0 全屏宽）。
  const input = doc.querySelector(ANCHOR.inputSelector)
  const sidebar = input !== null ? input.closest(SIDEBAR_SELECTOR) : null
  const width = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : 0
  const left = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  return {
    style: `position:fixed;top:0;left:${left}px;right:0;bottom:0;z-index:900;background:var(--dsh-bg,#fff);box-shadow:-8px 0 24px rgba(0,0,0,.12);`,
  }
}

/** 装配选项（host 仅供测试注入；缺省真实 window）。 */
export interface ClientPluginOptions {
  /** DOM 宿主（测试桩；缺省 window）。 */
  readonly host?: Pick<Window, 'document' | 'addEventListener' | 'removeEventListener'>
}

/**
 * client 插件装配体：注入入口按钮 + body 挂载 iframe 嵌入面板（覆盖内容区）。
 * @returns 停止函数（按钮 observer/按钮移除 + 容器清理 + 监听/观察退订）。
 */
export function apply(ctx: Context, options?: ClientPluginOptions): () => void {
  // 宿主先于全局探测解析：调用方经 host 注入自带 document 的宿主（测试桩）时，
  // 即便全局无 document 也应可装配——自守判定统一落在解析后的宿主上。
  const win = options?.host ?? (typeof window !== 'undefined' ? window : undefined)
  if (win?.document === undefined) {
    log.warn('fenix-dsh-session-advanced-search: 无 document 环境，client 半装配跳过')
    return () => {}
  }

  const uiWorkspace = resolveUiWorkspace(ctx)
  if (uiWorkspace?.openSession === undefined) {
    log.debug('fenix-dsh-session-advanced-search: uiWorkspace.openSession 缝不可用，结果卡跳转走 localStorage 兜底')
  }
  if (uiWorkspace?.watchSelectionChange === undefined) {
    log.debug('fenix-dsh-session-advanced-search: uiWorkspace selection 缝不可用，会话切换即收视图走侧栏点击兜底')
  }

  // 挂载态（惰性首次显示初始化；判定结果缓存，开合复用同一容器/iframe——
  // 状态（上次搜索结果）随之保留，直至整页刷新）。
  let initialized = false
  let open = false
  let container: HTMLDivElement | undefined
  let iframe: HTMLIFrameElement | undefined
  let observer: ResizeObserver | undefined
  let observedHost: Element | undefined
  let layoutWarned = false

  /** 同步面板位置（内容区矩形随窗口/侧栏宽度变化时对齐）。
   *  注意：cssText 整体赋值会清掉 display:none——收起态下 ResizeObserver
   *  触发（如开关右侧边栏导致内容区 resize）曾把视图“洗”回可见，而 open
   *  标志仍为 false，closeView 的 `!open` 早退使其永远关不掉（m01984）。
   *  故此处显式保持收起态：closed 时样式串附加 display:none。 */
  const syncPosition = (): void => {
    if (container === undefined) return
    const layout = panelLayout(win.document)
    container.style.cssText = layout.style + (open ? '' : ';display:none')
    // 官方 React 可能整体替换内容区元素：旧节点脱离文档后不再回报尺寸。
    // 每次同步比对已观察目标，变化即断开重挂（降级抽屉时目标缺失则纯断开）。
    if (layout.observe === observedHost) return
    observer?.disconnect()
    observer = undefined
    observedHost = layout.observe
    if (layout.observe !== undefined && typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(syncPosition)
      observer.observe(layout.observe)
    }
  }

  // [fenix-ignore:3d7f80671ff6] v3.1 起容器挂 document.body 且 position:fixed，contentHost 仅只读矩形，从不改写宿主 inline 样式，卸载无残留可还原
  const ensureMounted = (): void => {
    if (initialized) return
    const doc = win.document
    try {
      container = doc.createElement('div')
      container.dataset.fenixSasViewRoot = 'true'
      container.style.display = 'none'
      iframe = doc.createElement('iframe')
      iframe.src = PAGE_PATH
      iframe.title = '高级搜索'
      iframe.style.cssText = 'display:block;width:100%;height:100%;border:none;background:transparent;'
      container.append(iframe)
      // body 挂载：React 重渲染不可达（内容区挂载会被摘除成孤儿——上一形态
      // 「重开不保留结果」根因），iframe 状态天然保活。
      syncPosition()
      doc.body.append(container)
    } catch (error) {
      // 装配中途抛错：回滚半成品与观察态，initialized 保持未置位（闩锁只在
      // 装配全部成功后落定），warn 留痕后返回，下次点击入口按钮可整体重试——
      // 原实现先置闩锁后装配，任一步骤抛错即永久封锁后续 showView。
      container?.remove()
      container = undefined
      iframe = undefined
      observer?.disconnect()
      observer = undefined
      observedHost = undefined
      log.warn(`fenix-dsh-session-advanced-search: 嵌入视图装配抛错，已回滚待下次点击重试：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    initialized = true
    if (layoutWarned) return
    const anchored = resolveContentHost(doc) !== undefined
    if (!anchored) {
      layoutWarned = true
      log.warn(`fenix-dsh-session-advanced-search: 内容区锚点失配（input.closest('${SIDEBAR_SELECTOR}').nextElementSibling 不存在），高级搜索视图降级右侧抽屉；官方 UI 升级后请按 README「已知限制」修缝`)
    }
  }

  const showView = (): void => {
    ensureMounted()
    open = true
    syncPosition()
    if (container !== undefined) container.style.display = ''
  }

  const closeView = (): void => {
    // 不做 `!open` 早退：即使 open 标志与实际可见态失步（历史 bug 的放大器），
    // 任何收起路径都必须强制隐藏容器，保证「点了就收」绝对成立。
    open = false
    if (container !== undefined) container.style.display = 'none'
  }

  /** 会话跳转服务缝：uiWorkspace.openSession（官方「搜索结果打开会话」同缝）。 */
  const openSessionViaService = uiWorkspace?.openSession

  // 页内嵌沟通缝：iframe 独立页「返回会话」→ close；结果卡点击 →
  // openSession（应用内导航；服务缝缺失不暴露，页面走 localStorage 兜底）。
  const winAny = win as unknown as Record<string, unknown>
  const sasApi: { close: () => void; openSession?: (sessionId: string) => void } = { close: closeView }
  if (openSessionViaService !== undefined) {
    sasApi.openSession = (sessionId: string): void => {
      try {
        openSessionViaService(sessionId)
        closeView()
      } catch (error) {
        log.warn(`fenix-dsh-session-advanced-search: uiWorkspace.openSession 打开会话 ${sessionId} 抛错，交由页面兜底路径：${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
    }
  }
  winAny.__fenixSas = sasApi

  // 会话切换即收视图，双保险：
  // ① selection 快照店订阅（缝存在即挂；subscribe 不立即回调，初始态不误关）。
  //    注意：该缝在真实 app 的生效性无法离线证明（m01846 用户仍报「点所有会话
  //    都显示搜索页」）——故②不再以①缺失为前提，恒注册。
  // ② click-away 兜底（恒注册，document 捕获阶段）：凡点击不落在本视图容器、
  //    也不落在入口按钮上，一律收视图。会话切换/顶栏/侧栏任何交互都必然触发，
  //    与缝形状彻底解耦。
  const disposeSelectionWatch = uiWorkspace?.watchSelectionChange?.(closeView) ?? undefined
  const onAwayClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    // 入口按钮在侧栏内且捕获先于按钮 handler：豁免，否则 toggle 语义被破坏
    // （先关后开净效果恒为开）。视图容器内的点击（iframe 触摸/滚动条）不收。
    if (target.closest('button.fenix-sas-entry') !== null) return
    if (target.closest('[data-fenix-sas-view-root]') !== null) return
    closeView()
  }
  win.document.addEventListener('click', onAwayClick, true)
  const disposeSidebarFallback = (): void => {
    win.document.removeEventListener('click', onAwayClick, true)
  }

  // Escape 关闭（iframe 内按键不冒泡到父文档，故父层监听只覆盖父页焦点态；
  // iframe 内 Escape 由页面自身处理——独立页形态同样支持）。IME 合成期按键
  // 不参与：父页输入法合成中按 Esc 取候选词不得误关视图。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    if (event.key === 'Escape') closeView()
  }
  win.document.addEventListener('keydown', onKeyDown, true)

  // 搜索框入口按钮：点击开合嵌入视图（MutationObserver 持续维护按钮在位）。
  const button: SearchButtonHandle = injectSearchButton({
    document: win.document,
    log,
    onClick: () => {
      if (open) closeView()
      else showView()
    },
  })

  // 窗口尺寸变化时重对齐（面板 fixed 定位不随文档流）。
  const onResize = (): void => {
    if (open) syncPosition()
  }
  win.addEventListener?.('resize', onResize)

  return () => {
    button.dispose()
    observer?.disconnect()
    disposeSelectionWatch?.()
    disposeSidebarFallback?.()
    win.document.removeEventListener('keydown', onKeyDown, true)
    win.removeEventListener?.('resize', onResize)
    delete winAny.__fenixSas
    container?.remove()
  }
}
