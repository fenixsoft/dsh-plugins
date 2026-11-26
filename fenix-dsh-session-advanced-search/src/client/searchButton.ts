/**
 * client 半搜索框注入（design D1/D8；锚点签名见 src/types/dsh-runtime.d.ts
 * 头注释——0.2.2-rc.1 发行包实证，官方升级后此处是第一修缝点）。
 *
 * - 官方搜索框（WorkspaceBrowser，侧栏面板内）DOM 层级：
 *     div.<hash>_searchSlot > div.<hash>_search >
 *       button.<hash>_searchButton / input.<hash>_searchInput /
 *       button.<hash>_clearButton（仅展开态渲染）
 *   类值带构建哈希前缀（会漂移），键名稳定——锚点签名用属性子串匹配。
 * - 注入位置 = input 之后（clearButton 左侧）；`input.after(button)` 天然满足
 *   clearButton 条件渲染两种形态。MutationObserver 持续维护：官方重渲染移除
 *   按钮后自动补插；侧栏懒挂载（面板未打开时锚点不存在）也由观察覆盖。
 * - 锚点失配 → warn 一次（限流，防热循环刷日志）+ 放弃注入，不抛错。
 * - dispose 对称：observer 断开 + 按钮移除。
 */
import { UI_TEXT } from '../shared/protocol.js'

/** 锚点签名（属性子串匹配，容忍哈希前缀漂移；README 已知限制条目同步）。 */
export const ANCHOR = {
  /** 搜索槽容器（仅 wide 布局渲染；存在性不做硬校验，input 为准）。 */
  inputSelector: 'input[class*="searchInput"]',
} as const

/** 注入日志门面（warn 失配限流 / debug 在位维护）。 */
export interface SearchButtonLog {
  warn(message: string): void
  debug(message: string): void
}

/** 注入句柄（卸载对称）。 */
export interface SearchButtonHandle {
  /** 断开 observer 并移除按钮（幂等）。 */
  dispose(): void
  /** 更新按钮 title/aria-label（宿主语言档变化时由 client 调用）。 */
  setTitle(title: string): void
}

/** 官方 IconSearchOutlineMedium 内联 SVG（optimize 轮 3.3：几何原样 specs/.../prototype ICONS，无星标；viewBox 0 0 16 16、stroke 1.3）。 */
const ICON_SVG = [
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">',
  '<path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"/>',
  '<path d="M10.2991 10.3933L14.7783 14.8725"/>',
  '</svg>',
].join('')

/**
 * 在官方搜索框 input 之后注入「高级搜索」入口按钮，并持续维护其在位。
 * @param deps.document - 宿主 document（测试注入 jsdom 实例）。
 * @param deps.log - 日志门面。
 * @param deps.onClick - 按钮点击回调（在内容区打开高级搜索视图）。
 */
export function injectSearchButton(deps: { document: Document; log: SearchButtonLog; onClick: () => void }): SearchButtonHandle {
  const doc = deps.document
  // 按钮文案可变（宿主语言档跟随）：当前值闭包持有，observer 补插时用新值。
  let currentTitle: string = UI_TEXT.buttonTitle
  const button = createButton(doc, deps.onClick, () => currentTitle)
  let warned = false
  let disposed = false
  let scheduled = false

  const ensure = (): void => {
    if (disposed) return
    const input = doc.querySelector(ANCHOR.inputSelector)
    if (input === null) {
      if (!warned) {
        warned = true
        deps.log.warn(`fenix-dsh-session-advanced-search: 搜索框锚点失配（${ANCHOR.inputSelector} 不存在），放弃注入高级搜索入口；官方 UI 升级后请按 README「已知限制」修缝`)
      }
      return
    }
    const parent = input.parentElement
    // 在位即跳过（官方重渲染移除后 contains 变 false → 自动补插）。
    if (parent !== null && parent.contains(button)) return
    input.after(button)
    deps.log.debug('fenix-dsh-session-advanced-search: 已注入高级搜索入口按钮（searchInput 之后）')
  }

  // 批量 DOM 变更去抖：一次 mutation burst 合并为一次 ensure。
  const scheduleEnsure = (): void => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      ensure()
    })
  }

  const observer = new MutationObserver(scheduleEnsure)
  observer.observe(doc.documentElement, { childList: true, subtree: true })
  // 锚点可能已就绪（侧栏已挂载）：立即尝试一次。
  ensure()

  return {
    dispose: () => {
      disposed = true
      observer.disconnect()
      button.remove()
    },
    setTitle: (title) => {
      currentTitle = title
      button.title = title
      button.setAttribute('aria-label', title)
    },
  }
}

/** 构造入口按钮（内联 SVG、title=hover 提示；点击回调隔离默认行为与冒泡）。 */
function createButton(doc: Document, onClick: () => void, getTitle: () => string): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'fenix-sas-entry'
  button.title = getTitle()
  button.setAttribute('aria-label', getTitle())
  button.innerHTML = ICON_SVG
  // all:unset 脱离宿主 button 默认样式；尺寸贴官方 28px 图标按钮（optimize 轮：去降透明，color inherit 随主题）。
  button.style.cssText =
    'all:unset;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;cursor:pointer;color:inherit;'
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return button
}
