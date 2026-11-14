/**
 * fenix-dsh-session-advanced-search client 半装配（内容区嵌入形态）。
 *
 * 需求演进（用户指令）：
 *   - m00937「转向独立定制的高级搜索页面，不要再会话界面上修改元素」
 *     → 搜索 UI 收敛为独立页（host 半 exact 路由直出自包含 HTML）；
 *   - m01459「高级搜索的页面应当是嵌入在右侧的内容区域，不能把菜单也占掉了」
 *     → 入口按钮不再整页跳转，而是在**内容区**挂载 iframe 容器嵌入独立页
 *       ——侧栏/菜单完全可见可交互，搜索 UI 与定稿原型逐像素一致（iframe
 *       内即独立页本体），且 iframe 文档隔离保证不触碰会话 composer。
 *
 * 生命周期：按钮点击 → 惰性挂载（判定一次并缓存）+ 显示；关闭路径三重
 *   ① 页内「返回会话」→ window.parent.__fenixSas.close()（同源直调）；
 *   ② 会话切换（selection 快照店订阅主缝 + 侧栏点击捕获兜底）；
 *   ③ Escape 键。
 * 关闭 = display:none 隐藏容器（iframe 保活，重开无闪白）；卸载对称清理。
 *
 * 模块体经 `window.__ModuleLoader__.load({ id, factory })` 注册（tsdown
 * banner/footer 包装），dsh plugin-manager 消费 `inject` 服务键 + `apply(ctx)`
 * 停止函数。`inject` 为空数组：uiWorkspace 仅机会式探测（跳转缝增强），
 * 非硬依赖。apply 在无 document 环境自守跳过不抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import { PAGE_PATH } from '../shared/protocol.js'
import { injectSearchButton, ANCHOR } from './searchButton.js'
import type { SearchButtonHandle } from './searchButton.js'

/** 本插件消费的 client 服务键：嵌入形态零硬依赖（uiWorkspace 机会式探测）。 */
export const inject: readonly string[] = []

/** 侧栏容器锚点（结构化缝：搜索框 input 的最近侧栏祖先；失配降级抽屉）。 */
const SIDEBAR_SELECTOR = '[class*="sidebar"]'

/** selection 快照店缝（dsh-client-store createSnapshotStore 形态子集）。 */
interface SelectionStoreWatch {
  subscribe(listener: () => void): () => void
}

/** client 侧日志门面（消息自带插件前缀）。 */
const log = {
  warn: (message: string) => console.warn(message),
  debug: (message: string) => console.debug(message),
}

/** uiWorkspace 安全探测（机会式：仅用于会话切换即收视图的主缝增强）。 */
function resolveUiWorkspace(ctx: Context): { watchSelectionChange?(listener: () => void): () => void } | undefined {
  try {
    const ui: unknown = (ctx as unknown as Record<string, unknown>).uiWorkspace
    if (ui === null || typeof ui !== 'object') return undefined
    const selection = (ui as { selection?: unknown }).selection
    if (selection === null || typeof selection !== 'object') return undefined
    const subscribe = (selection as { subscribe?: unknown }).subscribe
    if (typeof subscribe !== 'function') return undefined
    const store = selection as SelectionStoreWatch
    return {
      watchSelectionChange: (listener: () => void): (() => void) => {
        try {
          return subscribe.call(store, listener)
        } catch {
          return () => {}
        }
      },
    }
  } catch {
    return undefined
  }
}

/**
 * 内容区挂载点判定（首次显示执行一次）：搜索框所在侧栏的相邻兄弟元素视为
 * 内容区；失配返回 undefined（调用方走右侧抽屉降级）。
 */
function resolveContentHost(doc: Document): HTMLElement | undefined {
  const input = doc.querySelector(ANCHOR.inputSelector)
  if (input === null) return undefined
  const sidebar = input.closest(SIDEBAR_SELECTOR)
  if (sidebar === null) return undefined
  const content = sidebar.nextElementSibling
  return content instanceof HTMLElement ? content : undefined
}

/** 抽屉容器样式（fixed 右侧、左边界避让侧栏实测宽度；避让失败退 0 全屏宽）。 */
function drawerStyle(doc: Document): string {
  const input = doc.querySelector(ANCHOR.inputSelector)
  const sidebar = input !== null ? input.closest(SIDEBAR_SELECTOR) : null
  const width = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : 0
  const left = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  return `position:fixed;top:0;bottom:0;left:${left}px;right:0;z-index:900;background:var(--dsh-bg,#fff);box-shadow:-8px 0 24px rgba(0,0,0,.12);`
}

/** 装配选项（host 仅供测试注入；缺省真实 window）。 */
export interface ClientPluginOptions {
  /** DOM 宿主（测试桩；缺省 window）。 */
  readonly host?: Pick<Window, 'document' | 'addEventListener' | 'removeEventListener'>
}

/**
 * client 插件装配体：注入入口按钮 + 内容区 iframe 嵌入独立页。
 * @returns 停止函数（按钮 observer/按钮移除 + 容器清理 + 监听退订）。
 */
export function apply(ctx: Context, options?: ClientPluginOptions): () => void {
  if (typeof document === 'undefined') {
    log.warn('fenix-dsh-session-advanced-search: 无 document 环境，client 半装配跳过')
    return () => {}
  }
  const win = options?.host ?? window

  const uiWorkspace = resolveUiWorkspace(ctx)
  if (uiWorkspace === undefined) {
    log.debug('fenix-dsh-session-advanced-search: uiWorkspace selection 缝不可用，会话切换即收视图走侧栏点击兜底')
  }

  // 挂载态（惰性首次显示初始化；判定结果缓存，开合复用同一容器/iframe）。
  let initialized = false
  let open = false
  let container: HTMLDivElement | undefined
  let iframe: HTMLIFrameElement | undefined
  let drawerWarned = false

  const ensureMounted = (): void => {
    if (initialized) return
    initialized = true
    const doc = win.document
    container = doc.createElement('div')
    container.dataset.fenixSasViewRoot = 'true'
    container.style.display = 'none'
    iframe = doc.createElement('iframe')
    iframe.src = PAGE_PATH
    iframe.title = '高级搜索'
    iframe.style.cssText = 'display:block;width:100%;height:100%;border:none;background:transparent;'
    container.append(iframe)

    const contentHost = resolveContentHost(doc)
    if (contentHost !== undefined) {
      // 内容区模式：容器占满内容区（关闭即还原会话视图，无遮罩）。
      container.style.cssText += 'position:absolute;inset:0;z-index:5;'
      if (doc.defaultView !== null && doc.defaultView !== undefined && getComputedStyle(contentHost).position === 'static') {
        contentHost.style.position = 'relative'
      }
      contentHost.append(container)
      log.debug('fenix-dsh-session-advanced-search: 高级搜索视图（iframe）挂载内容区（侧栏相邻兄弟锚点命中）')
      return
    }
    // 抽屉降级：fixed 右侧 + 避让侧栏实测宽度；warn 限流一次。
    container.style.cssText += drawerStyle(doc)
    doc.body.append(container)
    if (!drawerWarned) {
      drawerWarned = true
      log.warn(`fenix-dsh-session-advanced-search: 内容区锚点失配（input.closest('${SIDEBAR_SELECTOR}').nextElementSibling 不存在），高级搜索视图降级右侧抽屉；官方 UI 升级后请按 README「已知限制」修缝`)
    }
  }

  const showView = (): void => {
    ensureMounted()
    open = true
    if (container !== undefined) container.style.display = ''
  }

  const closeView = (): void => {
    if (!open) return
    open = false
    if (container !== undefined) container.style.display = 'none'
  }

  // 页内嵌沟通缝：iframe 独立页「返回会话」按钮经同源直调关闭视图。
  const winAny = win as unknown as Record<string, unknown>
  winAny.__fenixSas = { close: closeView }

  // 会话切换即收视图（缺陷 a96b3dc 同源策略）：主缝 selection 快照店订阅
  // （subscribe 不立即回调，装配时初始态不误关）；缝缺失 → document 捕获
  // 阶段侧栏点击兜底（仅覆盖鼠标路径）。
  const disposeSelectionWatch = uiWorkspace?.watchSelectionChange?.(closeView) ?? undefined
  let disposeSidebarFallback: (() => void) | undefined
  if (disposeSelectionWatch === undefined) {
    const onSidebarClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // 入口按钮本身在侧栏内：捕获阶段先于按钮 handler 执行，需豁免（否则
      // toggle 语义被破坏：先关后开净效果恒为开）。
      if (target.closest('button.fenix-sas-entry') !== null) return
      if (target.closest(SIDEBAR_SELECTOR) !== null) closeView()
    }
    win.document.addEventListener('click', onSidebarClick, true)
    disposeSidebarFallback = (): void => {
      win.document.removeEventListener('click', onSidebarClick, true)
    }
  }

  // Escape 关闭（iframe 内按键不冒泡到父文档，故父层监听只覆盖父页焦点态；
  // iframe 内 Escape 由页面自身处理——独立页形态同样支持）。
  const onKeyDown = (event: KeyboardEvent): void => {
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

  return () => {
    button.dispose()
    disposeSelectionWatch?.()
    disposeSidebarFallback?.()
    win.document.removeEventListener('keydown', onKeyDown, true)
    delete winAny.__fenixSas
    container?.remove()
  }
}
