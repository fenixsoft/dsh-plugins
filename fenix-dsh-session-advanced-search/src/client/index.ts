/**
 * fenix-dsh-session-advanced-search client 半装配（tasks 4.4）。
 *
 * 形态对齐 fenix-dsh-dashboard-bridge client 先例（dsh client-modules 契约）：
 * 模块体经 `window.__ModuleLoader__.load({ id, factory })` 注册（tsdown
 * banner/footer 包装），dsh plugin-manager 消费 `inject` 服务键 + `apply(ctx)`
 * 停止函数。
 *
 * 装配链：搜索框注入「高级搜索」入口按钮 → 点击开弹窗（React createRoot 挂
 * 自建容器）→ 提交/轮询/重复提交取消旧任务在弹窗组件内实现（POST jobs /
 * GET 轮询 / DELETE+新建，经注入的 fetch）→ 候选点击接 jump（uiWorkspace
 * 服务缝优先、侧栏 click 兜底）并关闭弹窗 → 卸载对称（observer 断开 +
 * root.unmount + 容器移除）。
 *
 * `inject` 仅声明 'uiWorkspace'（jump 优先缝；web profile 核心服务）。
 * apply 在无 document 环境（异常宿主/node 直载）自守跳过不抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { injectSearchButton } from './searchButton.js'
import type { SearchButtonHandle } from './searchButton.js'
import { SearchDialog } from './searchDialog.js'
import { jumpToSession } from './jump.js'
import type { JumpLog } from './jump.js'

/** 本插件消费的 client 服务键（uiWorkspace 为 jump 优先缝，design D5）。 */
export const inject = ['uiWorkspace']

/** 装配选项（测试注入轮询周期；缺省弹窗自用 1000ms）。 */
export interface ClientPluginOptions {
  /** 弹窗轮询间隔毫秒（透传 SearchDialog；测试可调小）。 */
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
 * client 插件装配体：注入入口按钮 + 挂载弹窗 + 候选跳转串联。
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

  // 弹窗挂载容器（React root 专属，标记便于诊断）。
  const container = document.createElement('div')
  container.dataset.fenixSasDialogRoot = 'true'
  document.body.append(container)
  const root: Root = createRoot(container)

  let open = false
  const render = (): void => {
    root.render(
      createElement(SearchDialog, {
        open,
        onClose: () => {
          open = false
          render()
        },
        onOpenSession: (sessionId: string, title: string) => {
          // 跳转（jump 内部先回调 onClose 关弹窗），服务缝优先、兜底 click。
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
  render()

  // 搜索框入口按钮：点击开弹窗（MutationObserver 持续维护在位）。
  const button: SearchButtonHandle = injectSearchButton({
    document: window.document,
    log,
    onClick: () => {
      open = true
      render()
    },
  })

  return () => {
    button.dispose()
    void Promise.resolve().then(() => {
      try {
        root.unmount()
      } catch {
        // 宿主页面已销毁等场景：unmount 失败不阻断清理链。
      }
      container.remove()
    })
  }
}
