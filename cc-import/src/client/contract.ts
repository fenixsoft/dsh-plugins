/**
 * cc-import Client 半的宿主契约面：服务注入声明与 Remote 贡献描述符。
 *
 * 独立成模块的原因：`index.ts` 聚合 react 组件（dialog.tsx 依赖 client 模块表
 * 里的 `@deepseek-ai/dsh-client-ui-primitives`，node 侧不可解析），而本模块只
 * 依赖 zod，可在 node 测试中直接导入做防回归断言（tests/client-contract.test.ts）。
 *
 * 形态对齐官方 `@deepseek-ai/dsh-api-remotes` client 面的生成描述符（真机
 * dsh 0.2.0-rc.2 实测约束）：
 * - 入参 codec MUST 为 strict 形态（`mode: 'strict'` + 非空 `typeSymbol` +
 *   zod schema 工厂）——gateway client 面 `requireStrictInputs` 对每个
 *   parameter 强制 `codec.mode === 'strict'`，裸 `{ mode: 'src-json' }` 入参
 *   在 `$mount` 即被拒（"generated Remote <endpoint> field … has no strict
 *   codec"），bootloader 把该 reject 吞成 `entry did not activate`，曾致
 *   client 半整页启动期零激活（2026-10-14 真机定位，spec verify-dsh-plugins-live
 *   任务 1.2/1.3）。zod 随 bundle 内联，与官方包先例一致。
 * - result 允许 src-json 透传（typert-registry validateCodec 两态皆收，
 *   gateway 仅对入参强制 strict）。
 */
import { z } from 'zod'

/**
 * cordis 服务注入：本插件消费的全部 client 服务键。
 *
 * 真机实测（0.2.0-rc.2）两条 fence 约束：
 * - `remote.<namespace>` 键声明 = 「激活前等待该 client 侧命名空间服务存在」。
 *   `remote.settings` / `remote.credentials` 由官方 controller 在合成树里提供，
 *   可安全等待；而 `remote.ccimport` 只能由本插件 apply 期 `$mount` 自己拉起，
 *   声明它= 自等待自己提供的服务，激活永远 pending（boot 报 "waiting for
 *   service: remote.ccimport"）——MUST NOT 声明。
 * - slot 组件在 React 渲染上下文里经 apply 期 ctx 访问 `remote.ccimport` 会撞
 *   reflect fence（"cannot get property … without inject"），因此 ccimport 服务
 *   引用在 apply 期 mount 完成后立即捕获（见 index.ts），闭包持引用而非持 ctx。
 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials']

/** 本插件 Remote namespace 的 client 侧贡献描述符。 */
export const TYPERT_REMOTE = {
  package: 'cc-import',
  descriptors: [
    {
      id: 'cc-import#ccimport/scan',
      service: 'ccimport',
      namespace: 'ccimport',
      method: 'scan',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
    {
      id: 'cc-import#ccimport/revealToken',
      service: 'ccimport',
      namespace: 'ccimport',
      method: 'revealToken',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'providerName',
          wire: 'providerName',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'cc-import#ccimport/revealToken:providerName',
            create: () => z.string(),
          },
        },
      ],
      result: { mode: 'src-json' },
    },
  ],
} as const
