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
