/**
 * cc-import 构建期类型缝（build-time type seam）。
 *
 * dsh 0.2.0-rc.2 的插件运行时包（cordis / typert-protocol / client-ui-primitives）
 * 未以匹配版本发布到 npm，无法作为 devDependency 安装参与类型检查；本文件按
 * 发行包 lib/types 源码钉死的最小契约面做本地环境声明，只覆盖 cc-import 触碰
 * 的 API。运行时形态以发行包实际行为为准（design.md Risks 条款）。
 */

declare module '@deepseek-ai/cordis' {
  /** 远程调用统一结果（typert RemoteResult 形态）。 */
  export type RemoteResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

  /** settings namespace 的红acted 视图（SettingsNamespaceView 子集）。 */
  export interface SettingsNamespaceView {
    readonly ns: string
    readonly value: unknown
    readonly base?: unknown
    readonly user?: unknown
    readonly revision: number
    readonly writable: boolean
  }

  /** settings 全量 describe 应答（SettingsDescribeValue 子集）。 */
  export interface SettingsDescribeValue {
    readonly writable: boolean
    readonly namespaces: readonly SettingsNamespaceView[]
  }

  /** path 寻址写操作（发行包 SettingsPathOpView：set / unset 两态）。 */
  export type SettingsPathOp =
    | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
    | { readonly op: 'unset'; readonly path: readonly string[] }

  /** client Remote 贡献（TypertRemoteContribution）。 */
  export interface TypertRemoteContribution {
    readonly package: string
    readonly descriptors: readonly unknown[]
  }

  /** slot 注册选项（SlotRegistrationOptions 子集）。 */
  export interface SlotRegistrationOptions {
    readonly name: string
    readonly id?: string
    readonly order?: number
    readonly priority?: number
    /** 本条目文案所属词典命名空间；声明后框架在组件 props 上合成 t。 */
    readonly locale?: string
    /** 注册方业务面工厂：每次渲染求值，结果并入组件 props。 */
    readonly inject?: () => Record<string, unknown>
  }

  /** 词典包（locale.register 的载荷）。 */
  export interface LocaleBundles {
    readonly zh: Readonly<Record<string, string>>
    readonly en: Readonly<Record<string, string>>
  }

  /** locale.bind 返回的翻译函数。 */
  export type Translate = (key: string, params?: Record<string, unknown>) => string

  /**
   * cordis Context：宿主/客户端共用的最小面。client 侧服务（slots/locale/
   * remote）由上游插件提供，宿主侧不触碰；这里统一声明为构建期缝。
   */
  export class Context {
    readonly fiber: { readonly uid: string | null }
    get<T = unknown>(key: string): T
    effect(fn: () => void | (() => void | Promise<void>), label?: string): void
    provide(key: string, value: unknown): void
    readonly slots: {
      inject(slot: string, factory: () => unknown): void
      register(options: SlotRegistrationOptions, component: unknown): () => void
    }
    readonly locale: {
      register(ns: string, bundles: LocaleBundles): void
      bind(ns: string): Translate
    }
    readonly remote: {
      $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void> | void>
      readonly settings: {
        describe(): Promise<RemoteResult<SettingsDescribeValue>>
        mutate(
          ns: string,
          ops: readonly SettingsPathOp[],
          expectedRevision?: number,
        ): Promise<RemoteResult<SettingsNamespaceView>>
      }
      readonly credentials: {
        set(ref: string, value: string): Promise<RemoteResult<void>>
      }
      /**
       * cc-import 自己挂载的 Remote namespace（client/index.ts $mount 后可用）。
       * 远程调用统一返回 RemoteResult 信封（gateway client 面：ok/value/error，
       * value = 业务返回）；业务级失败以业务联合自身的 ok=false 表达（host 半
       * 返回业务联合而非 throw），客户端须先拆信封再判业务 ok。
       */
      readonly ccimport: {
        scan(): Promise<RemoteResult<import('../shared/mapping.js').ScanResponse>>
        revealToken(
          providerName: string,
        ): Promise<
          RemoteResult<
            | { readonly ok: true; readonly token: string }
            | { readonly ok: false; readonly code: string; readonly message: string }
          >
        >
      }
    }
  }

  /** cordis Service 基类：子类构造 (ctx, name) 完成服务注册。 */
  export class Service<T = unknown> {
    readonly ctx: Context
    constructor(ctx: Context, name?: string)
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  import type { Context, Service } from '@deepseek-ai/cordis'

  /** 标准 decorator context 的最小面（TS 5 ClassMethodDecoratorContext 子集）。 */
  export interface RemoteMethodDecoratorContext {
    readonly name: string
    readonly private: boolean
    readonly static: boolean
    addInitializer(initializer: (this: unknown) => void): void
  }

  /** 绑定 Service 到 Typert Gateway 的可见凭据。 */
  export interface TypertGatewayBinding {
    readonly service: object
    readonly serviceKey: string
    readonly namespace: string
  }

  /** 注册 Service 并把同一键绑定到 Typert Gateway；namespace 缺省同 serviceKey。 */
  export declare abstract class TypertRemoteService extends Service {
    readonly typertRemote: TypertGatewayBinding
    protected constructor(
      ctx: Context,
      serviceKey: string,
      options?: { readonly namespace?: string },
    )
  }

  /** 标记一个公开实例方法为 direct Remote 调用（标准 decorator 双参形式）。 */
  export declare function Remote(method: unknown, context: RemoteMethodDecoratorContext): void

  /** 远程失败；client 侧把捕获到的 RemoteFailure 透传展示。 */
  export declare class RemoteError extends Error {
    readonly code: string
    constructor(code: string, message: string, details?: unknown, options?: { cause?: unknown })
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType, ReactNode } from 'react'

  export interface ButtonProps {
    readonly variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    readonly size?: 'md' | 'sm'
    readonly disabled?: boolean
    readonly onClick?: () => void
    readonly children?: ReactNode
  }
  export interface ModalProps {
    readonly open: boolean
    readonly onClose: () => void
    readonly title: string
    readonly closeLabel: string
    readonly description?: string
    readonly children?: ReactNode
    readonly footer?: ReactNode
    readonly contentClassName?: string
  }
  export interface CheckboxProps {
    readonly checked: boolean
    readonly onChange: (next: boolean) => void
    readonly label: string
    readonly disabled?: boolean
    readonly title?: string
  }
  export const Button: ComponentType<ButtonProps>
  export const Modal: ComponentType<ModalProps>
  export const Checkbox: ComponentType<CheckboxProps>
}
