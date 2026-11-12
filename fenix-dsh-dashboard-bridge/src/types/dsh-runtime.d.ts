/**
 * fenix-dsh-dashboard-bridge 构建期类型缝（build-time type seam）。
 *
 * dsh 0.2.0-rc.2 的插件运行时包（cordis / dsh-host-webserver）未以匹配版本
 * 发布到 npm，无法作为 devDependency 安装参与类型检查；本文件按发行包
 * lib/types 源码钉死的最小契约面做本地环境声明，只覆盖本插件触碰的 API：
 *
 * - `@deepseek-ai/cordis`：Service 基类（host 插件类的基座）、Context 上的
 *   effect / logger / slots 服务面（对齐发行包 cordis@4.0.4 与
 *   dsh-client-ui-slots 的注册形态）。
 * - `@deepseek-ai/dsh-host-webserver`：WebServer 服务的 register 路由契约
 *   （kind/prefix、path 无尾斜杠、handler 持有完整响应生命周期），声明为
 *   Context 上的 `webServer` 服务。
 *
 * 侧栏语义锚点缝（2026-11 Portal 内嵌分区，spec「每项目动态条目」）：
 * ui-sidebar 0.2.0-rc.2 侧栏根为 flex 列——`nav.panelList`（条目列表，语义
 * `<nav aria-label>`，本插件分区锚点）→ `div.regionArea`（`renderSlot(
 * "sidebar.workspaces", {wide, expandSidebar})`）→ `div.footArea`。二者的
 * class 为 CSS module 哈希（构建期生成，升级即变），不可作定位依据；插件
 * 锚点探测只依赖语义元素（条目组件 `closest('nav')`），宿主插 nav 紧后
 * 兄弟位。此结构缝以发行包 lib/client.js 源码为据钉死，不进入运行时声明。
 *
 * 运行时形态以发行包实际行为为准（design.md Risks 条款）。文件不入交付
 * 声明段（basename 与 cc-import 同名文件唯一命中会被 lint 疑似笔误规则
 * 拒绝），按 cc-import 的 src/types/dsh-runtime.d.ts 先例原样留存。
 */

declare module '@deepseek-ai/cordis' {
  /** 宿主/客户端共用的最小 cordis Context 面。 */
  export class Context {
    /** 注册一个随插件 fiber 卸载自动清理的副作用。 */
    effect(fn: () => void | (() => void | Promise<void>), label?: string): void
    /** 具名日志门面（printf 风格占位符）。 */
    readonly logger: {
      error(format?: unknown, ...params: unknown[]): void
      warn(format?: unknown, ...params: unknown[]): void
      info(format?: unknown, ...params: unknown[]): void
      debug(format?: unknown, ...params: unknown[]): void
    }
    /** client 侧插槽服务（sidebar.panellist 列表 / main keyed 注册入口）。 */
    readonly slots: {
      /**
       * 声明本插件对某插槽的注册方：factory 内调用 slots.register 完成注册，
       * 返回值（disposer）或生成器产出的 disposer 由框架在插件卸载时收集执行。
       */
      inject(slot: string, factory: () => unknown): void
      /** 注册一个条目；返回注销 disposer（幂等，可安全重复调用）。 */
      register(options: SlotRegistrationOptions, component: unknown): () => void
      /**
       * 投影某插槽的每 cell 胜出条目（2026-11-05 官方面板重排读官方 label/icon
       * 引用用）：list 槽 cell 键 = options.id，entries 按 priority 升序稳定重排
       * 后每 cell 取首个——低 priority 重注册同 id 即遮蔽原条目。形状为
       * { component, options }（ui-sidebar syncPanels 同款消费面）。
       */
      entriesOfSlot(slot: string): readonly { readonly component: unknown; readonly options: SlotRegistrationOptions }[]
      /** 订阅插槽条目变更（ui-sidebar syncPanels 同款消费面）；返回退订函数。 */
      subscribe(slot: string, fn: () => void): () => void
    }
    /** 宿主 WebServer 服务（@deepseek-ai/dsh-host-webserver 提供）。 */
    readonly webServer: {
      /** 注册命名路由；同 (kind, path) 重复注册会抛错。返回注销 disposer。 */
      register(route: WebRoute): () => void
    }
    /**
     * client 布局服务（@deepseek-ai/dsh-client-ui-layout 提供）。
     *
     * 程序化面板切换入口（2026-10 实现期读 0.2.0-rc.2 发行包源码钉死）：
     * ui-sidebar 的 panellist 行按钮 onClick → 注入回调 selectPanel(id) →
     * `ctx.layout.selectPanel(id)`；layout 侧校验 hasMainPanel(panelId)（未注册
     * 抛 `layout.selectPanel: main panel "<id>" is not registered`）后写
     * panelInfo.activePanelId 驱动 main keyed 面板与行高亮。面板选中无 hash
     * 路由事实源（layout client 无 hashchange/location.hash），深链仅存在于
     * 本插件 iframe src 内部。
     */
    readonly layout: {
      /** 激活 main keyed 面板（panelId=null 回到会话视图）；未注册的 id 会抛错。 */
      selectPanel(panelId: string | null): void
    }
    /**
     * 工作区 UI 服务（@deepseek-ai/dsh-client-ui-workspace 提供，UiWorkspaceService）。
     * 最小消费面：项目行「新建会话」action 复用原生 startSession(workspaceId)
     * ——新建（或复用空白）会话并把主面板切回会话视图，与工作区行
     * rowActions 的 + 按钮行为逐键相同。声明为可选：测试桩上下文不提供，
     * 运行时守卫缺失即降级（design Risks 条款）。
     */
    readonly uiWorkspace?: {
      /** 纯工作区控制器（items 形状以 WorkspaceView 为据：id/path/title）。 */
      readonly workspaces: {
        readonly list: {
          getSnapshot(): {
            /** 就绪相位（'ready' 后 list 数据可用；boot 落新会话以此作门）。 */
            readonly phase?: string
            readonly items: readonly {
              readonly workspaceId: string
              readonly path: string
              readonly title: string
            }[]
          }
        }
      }
      /**
       * 新建（或复用空白）会话并切主面板到该会话（原生 startSession 同名）。
       * workspaceId 缺省 = 原生侧栏 New Session 按钮逐键路径（target 回落
       * currentWorkspaceId ?? recent；无任何工作区时 clearMain 落无会话态）。
       *
       * draftOptions（2026-11-11「新会话」按钮批新增消费面）：原生支持会话框
       * 预填——dsh-client-ui-workspace lib/client.js:1502 起 `initializeDraft =
       * draftOptions!==undefined && (prompt!==undefined || …)`，经
       * prepareDraft → conversation.input.requestDraftInitialization 应用；
       * 新会话空白 draft 恒空，`{ prompt }` 必 setDraft 落输入框首行（缺省
       * whenDraftExists='keep'，非破坏）。dashboard 内嵌页「对于 XXXX SPEC：」
       * 前缀即走此参数。
       */
      startSession(workspaceId?: string, draftOptions?: { readonly prompt?: string }): void
    }
    /**
     * 工作区控制器服务（@deepseek-ai/dsh-api-workspace-controller 提供，键
     * "workspaces"；ui-workspace 即经 ctx.get("workspaces") 消费）。最小消费面：
     * 「新建会话」action 对无工作区的 fenix 项目按目录自动建工作区——与原生
     * addWorkspace adoptDirectory 的 create({path}) 同键。声明可选理由同上。
     */
    readonly workspaces?: {
      /** 按目录路径注册工作区；失败 reject（原生 WorkspaceCreateError 同语义）。 */
      create(input: { readonly path: string }): Promise<{ readonly workspaceId: string }>
    }
    /**
     * 会话列表服务（@deepseek-ai/dsh-client-ui-session 提供，服务键
     * "sessions"，0.2.2-rc.1 lib/client.js:1109）。文件右键「在 Fenix 项目中
     * 定位」（2026-11-11）消费面：由菜单 target.sessionId 取所属会话的
     * workspace 根目录（cwd），把相对 target.path 解析为绝对路径——与
     * open-in-app directory 菜单的绝对路径解法（轻量字符串拼，无 RPC）同形。
     * 声明可选：测试桩上下文不提供，运行时守卫缺失即降级。
     */
    readonly sessions?: {
      readonly list: {
        getSnapshot(): {
          readonly byId: Record<string, { readonly cwd?: string } | undefined>
        }
      }
    }
    /**
     * 右键菜单服务（@deepseek-ai/dsh-client-ui-context-menu 提供，0.2.2-rc.1
     * lib/types 钉死）。最小消费面：register 贡献 file 菜单项，resolve 按
     * target 返回动作数组，返回 unregister。file target = {sessionId, path,
     * line?, paneId?}（path 相对会话 cwd）。声明可选理由同上。
     */
    readonly contextMenus?: {
      register(contribution: {
        readonly id: string
        readonly target: 'file'
        readonly order: number
        resolve(
          target: { readonly sessionId: string; readonly path: string; readonly line?: number },
          signal: AbortSignal,
        ):
          | readonly {
              readonly id: string
              readonly label: string
              readonly failureLabel?: string
              run(): void | Promise<void>
            }[]
          | Promise<
              readonly {
                readonly id: string
                readonly label: string
                readonly failureLabel?: string
                run(): void | Promise<void>
              }[]
            >
      }): () => void
    }
    /**
     * 右侧边栏页签注册表（@deepseek-ai/dsh-client-ui-sidebar-right 提供，
     * 0.2.2-rc.1 lib 源码钉死；服务键 "sidebarRightTabs"）。最小消费面：
     * register 页签 definition——page 类型按 kind 打开（无 patterns），guide
     * 条目出现在右缘「+」菜单；body 组件经 slots 以 `sidebar.right.pane.tab`
     * 槽、definition id 为 key 注册。声明可选：测试桩上下文不提供，缺失即
     * 降级 no-op（rightTab.tsx）。
     */
    readonly sidebarRightTabs?: {
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
          readonly icon?: (props?: { readonly size?: number }) => unknown
        }[]
      }): () => void
    }
    /**
     * 右侧边栏控制器（@deepseek-ai/dsh-client-ui-sidebar-right 提供，服务键
     * "sidebarRight"）。最小消费面：openTab 按 kind 打开/页内 reveal 页签并
     * 送达 params（navigation.revision++）；文件右键定位（2026-11-11 m02220
     * 语义纠正）经此把项目页签开进右缘 dock。声明可选理由同上。
     */
    readonly sidebarRight?: {
      openTab(kind: string, options?: { readonly params?: unknown }): void
    }
  }

  /** slots.register 的注册选项（SlotRegistrationOptions / KindOptions 子集）。 */
  export interface SlotRegistrationOptions {
    /** 目标插槽名（如 'sidebar.panellist' / 'main'）。 */
    readonly name: string
    /** 列表插槽条目 id（sidebar.panellist；同时是 main 面板键的对应 id）。 */
    readonly id?: string
    /** keyed 插槽条目键（main；与侧栏条目 id 一一对应）。 */
    readonly key?: string
    /** 列表条目升序排序键；同序数保持注册顺序。 */
    readonly order?: number
    /**
     * 条目优先级（缺省 0）：list 槽 entries 按 priority 升序稳定重排后每 cell
     * 取首个——同 id 低 priority 注册即遮蔽官方条目（chat-polish 同款遮蔽语义，
     * 2026-11-05 官方面板重排消费）。
     */
    readonly priority?: number
    /** 行标题与可访问名：纯字符串或每次读取求值的 thunk。 */
    readonly label?: string | (() => string)
    /** 本条目文案所属词典命名空间；不声明则 label 按原样使用。 */
    readonly locale?: string
  }

  /** WebServer 命名路由（WebRoute 子集：本插件只用 prefix 一类）。 */
  export interface WebRoute {
    /** 'prefix' p 匹配 p 与 p/<anything>；exact 逐字匹配。 */
    readonly kind: 'exact' | 'prefix'
    /** 绝对路径名，无尾斜杠。 */
    readonly path: string
    /** 持有完整响应生命周期（可长开，如 SSE）。 */
    readonly handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
  }

  /** cordis Service 基类：子类构造 (ctx, name) 完成服务注册。 */
  export class Service<T = unknown> {
    readonly ctx: Context
    /** 本服务注册在 ctx 下的名字。 */
    name: string
    constructor(ctx: Context, name?: string)
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType, ReactNode } from 'react'

  /**
   * 最小契约面（只覆盖本插件消费的导出）：发行包 primitives 为 CSS-in-JS
   * 组件集，props 以 0.2.0-rc.2 发行包 lib 用法为准。Tooltip 与 NewChat
   * 图标为原生工作区行「新建会话」rowActions 的同款基元（本项目行 action
   * 与原生逐键同形）。
   */
  export interface TooltipProps {
    /** 悬浮提示文案（原样使用，不做词典查找）。 */
    readonly label: ReactNode
    /** 弹出方位/对齐（native rowActions 用 bottom/end）。 */
    readonly side?: 'top' | 'bottom' | 'left' | 'right'
    readonly align?: 'start' | 'center' | 'end'
    /** 悬浮延时（毫秒）。 */
    readonly delayMs?: number
    readonly children?: ReactNode
  }
  export const Tooltip: ComponentType<TooltipProps>
  /** 线性「新建会话」图标（24 viewBox stroke 风格，缺省尺寸随宿主）。 */
  export const IconNewChatOutlineRegular: ComponentType<Record<string, never>>
}

