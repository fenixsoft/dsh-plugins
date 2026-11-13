/**
 * fenix-dsh-session-advanced-search client 半装配（optimize 轮 tasks 3.3；
 * loader 入口形态对齐 fenix-dsh-dashboard-bridge client 先例）。
 *
 * 模块体经 `window.__ModuleLoader__.load({ id, factory })` 注册（tsdown
 * banner/footer 包装），dsh plugin-manager 消费 `inject` 服务键 + `apply(ctx)`
 * 停止函数。
 *
 * 装配链：搜索框注入「高级搜索」入口按钮（官方 IconSearchOutlineMedium 几何）
 * → 点击在**内容区**打开 SearchView（非模态，React createRoot 挂自建容器）→
 * 提交/轮询/重复提交取消旧任务在视图组件内实现（POST jobs / GET 轮询 /
 * DELETE+新建，经注入的 fetch）→ 候选点击接 jump（uiWorkspace 服务缝优先、
 * 侧栏 click 兜底）并关闭视图 → 卸载对称（observer 断开 + root.unmount +
 * 容器移除）。
 *
 * 内容区挂载缝（design D6；optimize 轮 3.3）：点击时刻搜索框必然在位（按钮
 * 就注入在其旁），结构化锚点 = `input.closest('[class*="sidebar"]')` 的
 * **nextElementSibling**（官方布局：侧栏面板与内容区为相邻兄弟）。命中 →
 * 容器 absolute inset 0 占满内容区（视图关闭即还原会话视图，无遮罩侧栏可
 * 交互）；失配（closest/nextElementSibling 任一缺失或非元素）→ 降级右侧抽屉
 * （fixed、左边界避让侧栏实测宽度）+ warn 限流一次。挂载判定惰性首次点击
 * 执行一次并缓存，后续开合复用同一容器/root。
 *
 * `inject` 仅声明 'uiWorkspace'（jump 优先缝；web profile 核心服务）。
 * apply 在无 document 环境（异常宿主/node 直载）自守跳过不抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { injectSearchButton, ANCHOR } from './searchButton.js'
import type { SearchButtonHandle } from './searchButton.js'
import { SearchView } from './searchView.js'
import { jumpToSession } from './jump.js'
import type { JumpLog } from './jump.js'

/** 本插件消费的 client 服务键（uiWorkspace 为 jump 优先缝，design D5）。 */
export const inject = ['uiWorkspace']

/** 侧栏容器锚点（结构化缝：搜索框 input 的最近侧栏祖先；失配降级抽屉）。 */
const SIDEBAR_SELECTOR = '[class*="sidebar"]'

/** 装配选项（测试注入轮询周期；缺省视图自用 1000ms）。 */
export interface ClientPluginOptions {
  /** 视图轮询间隔毫秒（透传 SearchView；测试可调小）。 */
  readonly pollIntervalMs?: number
}

/** client 侧日志门面（消息自带插件前缀）。 */
const log: JumpLog = {
  warn: (message) => console.warn(message),
  debug: (message) => console.debug(message),
}

/** uiWorkspace 安全探测（inject 保证在位；形状漂移自守降级）。 */
function resolveUiWorkspace(ctx: Context): { openSession(target: string): void } | undefined {
  try {
    const ui: unknown = (ctx as unknown as Record<string, unknown>).uiWorkspace
    if (ui === null || typeof ui !== 'object') return undefined
    const openSession = (ui as { openSession?: unknown }).openSession
    return typeof openSession === 'function' ? ({ openSession: openSession.bind(ui) } as { openSession(target: string): void }) : undefined
  } catch {
    return undefined
  }
}

/**
 * 内容区挂载点判定（首次点击执行一次）：搜索框所在侧栏的相邻兄弟元素视为
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

/** 抽屉容器样式（fixed 右侧、左边界避让侧栏实测宽度；避让失败退 0 全屏）。 */
function drawerStyle(doc: Document): string {
  const input = doc.querySelector(ANCHOR.inputSelector)
  const sidebar = input !== null ? input.closest(SIDEBAR_SELECTOR) : null
  const width = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : 0
  const left = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  return `position:fixed;top:0;bottom:0;left:${left}px;right:0;z-index:1000;background:var(--dsh-bg,#fff);box-shadow:-8px 0 24px rgba(0,0,0,.12);`
}

/**
 * client 插件装配体：注入入口按钮 + 挂载内容区视图 + 候选跳转串联。
 * @returns 停止函数（按钮 observer/按钮移除 + root.unmount + 容器清理）。
 */
export function apply(ctx: Context, options?: ClientPluginOptions): () => void {
  if (typeof document === 'undefined') {
    log.warn('fenix-dsh-session-advanced-search: 无 document 环境，client 半装配跳过')
    return () => {}
  }

  const uiWorkspace = resolveUiWorkspace(ctx)
  if (uiWorkspace === undefined) {
    log.warn('fenix-dsh-session-advanced-search: uiWorkspace 服务不可用，候选跳转将走侧栏列表项 click 兜底')
  }

  // 挂载态（惰性首次点击初始化；判定结果缓存，开合复用同一容器/root）。
  let initialized = false
  let open = false
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let drawerWarned = false

  const ensureMounted = (): void => {
    if (initialized) return
    initialized = true
    const contentHost = resolveContentHost(window.document)
    container = window.document.createElement('div')
    container.dataset.fenixSasViewRoot = 'true'
    root = createRoot(container)
    if (contentHost !== undefined) {
      // 内容区模式：容器占满内容区（视图关闭即还原会话视图，无遮罩）。
      container.style.cssText = 'position:absolute;inset:0;z-index:5;'
      if (getComputedStyle(contentHost).position === 'static') contentHost.style.position = 'relative'
      contentHost.append(container)
      log.debug('fenix-dsh-session-advanced-search: 高级搜索视图挂载内容区（侧栏相邻兄弟锚点命中）')
      return
    }
    // 抽屉降级：fixed 右侧 + 避让侧栏实测宽度；warn 限流一次。
    container.style.cssText = drawerStyle(window.document)
    window.document.body.append(container)
    if (!drawerWarned) {
      drawerWarned = true
      log.warn(`fenix-dsh-session-advanced-search: 内容区锚点失配（${ANCHOR.inputSelector}.closest('${SIDEBAR_SELECTOR}').nextElementSibling 不存在），高级搜索视图降级右侧抽屉；官方 UI 升级后请按 README「已知限制」修缝`)
    }
  }

  const render = (): void => {
    if (root === undefined || container === undefined) return
    root.render(
      createElement(SearchView, {
        open,
        onClose: () => {
          open = false
          render()
        },
        onOpenSession: (sessionId: string, title: string) => {
          // 跳转（jump 内部先回调 onClose 关视图），服务缝优先、兜底 click。
          jumpToSession({ uiWorkspace, document: window.document, log }, sessionId, {
            title,
            onClose: () => {
              open = false
              render()
            },
          })
        },
        ...(options?.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      }),
    )
  }

  // 搜索框入口按钮：点击在内容区开视图（MutationObserver 持续维护在位）。
  const button: SearchButtonHandle = injectSearchButton({
    document: window.document,
    log,
    onClick: () => {
      ensureMounted()
      open = true
      render()
    },
  })

  return () => {
    button.dispose()
    void Promise.resolve().then(() => {
      try {
        root?.unmount()
      } catch {
        // 宿主页面已销毁等场景：unmount 失败不阻断清理链。
      }
      container?.remove()
    })
  }
}
