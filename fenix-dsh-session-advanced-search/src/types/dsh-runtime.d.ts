/**
 * fenix-dsh-session-advanced-search 构建期类型缝（build-time type seam）。
 *
 * dsh 0.2.2-rc.1 的插件运行时包（cordis / dsh-host-webserver / dsh-llm /
 * dsh-api-session-controller 等）未以匹配版本发布到 npm，无法作为
 * devDependency 安装参与类型检查；本文件按发行包 lib/types 源码钉死的最小
 * 契约面做本地环境声明，只覆盖本插件触碰的 API（0.2.2-rc.1 发行包侦察，
 * 结论同步记录于 spec/changes/add-session-advanced-search/design.md）：
 *
 * - `@deepseek-ai/cordis`：Service 基类（host 插件类基座）、Context 的
 *   effect / logger 面（对齐发行包 cordis@4.x 与 session-grouper 先例）。
 * - `ctx.webServer.register`：同源 HTTP API 注册缝（fenix-dsh-auth 先例；
 *   exact 座位无冲突，handler 持有完整响应生命周期）。
 * - `ctx.sessionPersistence`：会话产物只读枚举缝（fenix-dsh-session-grouper
 *   已验证；list() 覆盖全部工作区含归档会话）。
 * - `ctx.sessionController.list`：官方冷安全会话列表投影（title/updatedAt
 *   增强源；侦察发现，可选缝——缺失回退 header-only）。
 * - `ctx.llm.stream` + `ctx.agentDefaultModel.currentSelection()`：host 侧
 *   LLM 服务缝（dsh-session-title-llm 同模式侦察钉死，可选缝——缺失/失败
 *   回退机械评分）。
 * - `ctx.uiWorkspace.openSession`：client 侧既有会话打开缝（design D5 钉死，
 *   可选缝——缺失回退侧栏列表项 click 兜底）。
 *
 * 官方搜索框锚点缝（design D1/Open Questions 回填，不入运行时声明）：
 * 搜索框 DOM 位于 @deepseek-ai/dsh-client-ui-workspace 的 WorkspaceBrowser
 * （sidebar 包自身 bundle 无 search 字样；WorkspaceBrowser 渲染于侧栏面板），
 * 层级（0.2.2-rc.1 发行包 lib/client.js CSS-modules 映射 + JSX 实证）：
 *
 *   div.<hash>_searchSlot          仅 wide 布局渲染
 *     div.<hash>_search            展开态附加 <hash>_searchExpanded
 *       button.<hash>_searchButton   放大镜（IconSearchOutlineRegular）
 *       input.<hash>_searchInput     type="text"，placeholder=i18n search.placeholder
 *       button.<hash>_clearButton    仅展开态渲染；aria-label=i18n search.clear
 *                                    （内含 IconCloseFillRegular）
 *
 * 类值带构建哈希前缀（当前 `bhn1Oq_`，升级漂移）、键名稳定——插件锚点签名
 * 用属性子串匹配：容器 `[class*="searchSlot"]` 内 `input[class*="searchInput"]`；
 * X 按钮 `button[class*="clearButton"]`。注入位置 = input 之后（clearButton
 * 左侧；clearButton 条件渲染，由 MutationObserver 在其出现/消失时持续维护）。
 *
 * 运行时形态以发行包实际行为为准（design.md Risks 条款）。
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
  }

  /** cordis 插件服务基类（host 半插件形态，session-grouper 先例）。 */
  export class Service {
    /** 插件 fiber 上下文（服务缝消费入口）。 */
    readonly ctx: Context
    /** 本服务注册在 ctx 下的名字。 */
    name: string
    constructor(ctx: Context, name?: string)
    /** cordis 依赖注入声明：loader 等这些服务就绪后再 apply 本插件。 */
    static inject?: readonly string[]
    start(): void
    stop(): void
  }
}

/** 宿主侧服务缝的最小被消费面（全局环境声明，host 半导入）。 */
declare global {
  interface Window {
    /** dsh client-modules 懒加载 CJS 工厂注册表（client 半装配入口）。 */
    readonly __ModuleLoader__: {
      load(registration: { id: string; factory: (require: (id: string) => unknown) => unknown }): void
    }
  }
}

/** 会话 id（安装包为品牌字符串；此处按字符串消费）。 */
export type SessionId = string

/** 宿主 WebServer 路由注册缝的被消费面（fenix-dsh-auth 先例，0.2.2-rc.1）。 */
export interface WebRoute {
  /** exact 座位：无前缀匹配冲突（官方 frontend-static 只占 fallback 座位）。 */
  readonly kind: 'exact' | 'prefix' | 'fallback'
  /** 路径（无尾斜杠）。 */
  readonly path: string
  /** handler 持有完整响应生命周期（Node 风格 writeHead/end）。 */
  readonly handler: (req: WebRequest, res: WebResponse) => void | Promise<void>
}

/** handler 收到的请求被消费面。 */
export interface WebRequest {
  readonly method?: string
  readonly url?: string
  readonly headers: Record<string, string | string[] | undefined>
  on(event: 'data', listener: (chunk: Buffer | string) => void): void
  on(event: 'end', listener: () => void): void
  /** 请求流故障（连接异常断开/底层 I/O 错误）；handler 可据此 reject 并回写错误响应。 */
  on(event: 'error', listener: (error: Error) => void): void
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): void
}

/** handler 可写的响应 sink 被消费面。 */
export interface WebResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: Buffer | string): unknown
}

/** 会话持久化 header 的被消费面（安装包 SessionHeader 结构子集）。 */
export interface DshSessionHeader {
  readonly version: number
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
}

/** stat/list 快照的被消费面。 */
export interface DshSessionSnapshot {
  readonly header: DshSessionHeader
  readonly revision: string
  readonly eventCount?: number
  readonly sizeBytes?: number
}

/** 会话句柄的被消费面（只读通道：首条用户消息节选）。 */
export interface DshSessionHandle {
  readonly id: SessionId
  readonly header: DshSessionHeader
  readonly access: 'read' | 'write'
  read(offset?: number, length?: number): Promise<{ events: readonly DshSessionEvent[] }>
  close(): Promise<void>
}

/** 会话事件被消费面（只读扫描：user/message / session/title）。 */
export interface DshSessionEvent {
  readonly seq: number
  readonly type: string
  readonly [key: string]: unknown
}

/** `ctx.sessionPersistence` 服务缝的被消费面（只读消费）。 */
export interface DshSessionPersistence {
  /** 后端标签：JSONL 后端实例为 'session-persistence-jsonl'。 */
  readonly name?: string
  list(options?: { signal?: AbortSignal }): Promise<readonly DshSessionSnapshot[]>
  stat(id: SessionId, options?: { signal?: AbortSignal }): Promise<DshSessionSnapshot | undefined>
  /** 只读打开（collector 首条用户消息节选；绝不以 'write' 打开）。 */
  open(id: SessionId, access: 'read', options?: { signal?: AbortSignal }): Promise<DshSessionHandle>
}

/** 官方冷安全会话列表行（dsh-api-session-controller SessionSummary 子集）。 */
export interface DshSessionSummary {
  readonly sessionId: SessionId
  /** 最近活动时刻（epoch ms；官方按此排序）。 */
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly cwd?: string
  /** 投影提示：values.title 为最新会话标题（dsh-session-title title 投影）。 */
  readonly projections?: {
    readonly values?: Readonly<Record<string, unknown>>
  }
}

/** `ctx.sessionController` 服务缝的被消费面（只读 list；可选缝）。 */
export interface DshSessionController {
  /** 冷安全可见会话摘要（不激活任何 Agent）。 */
  list(request: { readonly cursor?: string }, signal?: AbortSignal): Promise<{
    readonly items: readonly DshSessionSummary[]
  }>
}

/** dsh-llm 请求消息被消费面（一次性 user 文本输入）。 */
export interface DshLlmUserInput {
  readonly role: 'user'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
}

/** dsh-llm GenerateOptions 被消费面（session-titles 同模式一次性调用）。 */
export interface DshLlmGenerateOptions {
  /** 注册的 provider 路由（agentDefaultModel 取默认）。 */
  provider?: string
  model?: string
  readonly messages: readonly DshLlmUserInput[]
  /** 一次性调用的 system prompt。 */
  readonly system?: string
  readonly maxTokens?: number
  readonly signal?: AbortSignal
}

/** 流 chunk 被消费面（只累加 text-delta）。 */
export interface DshLlmStreamChunk {
  readonly type: string
  readonly text?: string
}

/** `ctx.llm` 服务缝的被消费面（dsh-llm LlmRuntime 子集；可选缝）。 */
export interface DshLlmRuntime {
  stream(options: DshLlmGenerateOptions): AsyncIterable<DshLlmStreamChunk>
}

/** `ctx.agentDefaultModel` 服务缝的被消费面（可选缝；默认路由来源）。 */
export interface DshAgentDefaultModel {
  /** 当前默认模型选择（provider+model）。 */
  currentSelection(): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
}

/** 宿主 Context 的插件可消费服务缝（与 @deepseek-ai/cordis 声明合并）。 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * cordis 运行时免 inject 服务读取（ReflectService.get 混入；可选缝探测
     * 唯一合法姿势——服务未提供/提供方 fiber 未激活时返回 undefined 不抛）。
     * 未声明 inject 的服务**属性访问即抛**「cannot get property without
     * inject」（BUG-01 根因：属性访问探测恒 undefined → 标题增强整体失效）。
     * 本声明系插件侧消费契约：cordis 主入口类型不导出该混入（reflect.d.ts
     * augmentation 未随 index.d.ts 出口），运行时形态经 cordis 4.x 实源与
     * 官方 dsh-schedule ctx.get("sessionController") 同缝消费双重坐实。
     */
    get(name: string): unknown
    /** 宿主 WebServer 服务（@deepseek-ai/dsh-host-webserver 提供）。 */
    readonly webServer: {
      /** 注册命名路由；同 (kind, path) 重复注册会抛错。返回注销 disposer。 */
      register(route: WebRoute): () => void
    }
    /** 会话持久化服务（@deepseek-ai/dsh-session-persistence 提供，只读消费）。 */
    readonly sessionPersistence: DshSessionPersistence
    /**
     * 会话业务 API（@deepseek-ai/dsh-api-session-controller 提供）。可选缝：
     * 测试桩上下文不提供；运行时守卫缺失即回退 header-only 收集。
     */
    readonly sessionController?: DshSessionController
    /**
     * LLM 运行时（@deepseek-ai/dsh-llm 提供）。可选缝：缺失/调用失败回退
     * 机械评分排序（degraded 标注，功能不中断）。
     */
    readonly llm?: DshLlmRuntime
    /** 默认模型选择（@deepseek-ai/dsh-agent-default-model 提供）。可选缝同上。 */
    readonly agentDefaultModel?: DshAgentDefaultModel
    /**
     * 工作区 UI 服务（@deepseek-ai/dsh-client-ui-workspace 提供，
     * UiWorkspaceService；client 侧既有会话打开缝，design D5 钉死）。
     * openSession(target) =「Select a Session and show its Conversation as one
     * UI navigation action」（navigation.d.ts）——跨工作区天然支持。可选缝：
     * 缺失时回退侧栏列表项 UI click 兜底。
     */
    readonly uiWorkspace?: {
      openSession(target: string): void
    }
  }
}

export {}

