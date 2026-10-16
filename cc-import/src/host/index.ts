/**
 * cc-import Host 半：注册只读 Typert Remote namespace `ccimport`。
 *
 * - `scan`：只读扫描 cc-switch 的 claude 形态候选（零写入）。
 * - `revealToken`：按候选名读取 `ANTHROPIC_AUTH_TOKEN` 明文，供 client 半在
 *   导入确认后调用 `storeCredential` 官方写入路径使用。Host 半自身不实现
 *   任何写入方法（spec「Host 扫描候选」SHALL NOT 条款）；token 只在 client
 *   内存中瞬时经过，落库唯一入口是官方 credentials 服务。
 *
 * 插件形态：默认导出 cordis 插件类（对齐 @deepseek-ai/dsh-api-settings-controller
 * 的 `SettingsController as default` 先例），loader 条目按包名装载。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteMethodDecoratorContext } from '@deepseek-ai/dsh-typert-protocol'
import type { ScanResponse } from '../shared/mapping.js'
import { defaultDbPath, readCcSwitchToken, scanCcSwitch } from './scan.js'

/** revealToken 的结构化应答。 */
export type TokenResponse =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** 经公开 Remote decorator 的标准 decorator-context 合同，手工打方法标记。 */
function markRemoteMethod(prototype: object, method: string): void {
  const initializers: Array<(this: unknown) => void> = []
  const context: RemoteMethodDecoratorContext = {
    name: method,
    private: false,
    static: false,
    addInitializer: (initializer) => {
      initializers.push(initializer)
    },
  }
  Remote((prototype as Record<string, unknown>)[method], context)
  // decorator initializer 以实例为 this、从实例原型读取目标原型；用一次性
  // 占位实例把标记写到 prototype 上，语义与 `@Remote` 声明完全一致。
  for (const initializer of initializers) initializer.call(Object.create(prototype))
}

export class CcimportController extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ccimport', { namespace: 'ccimport' })
  }

  /** 只读扫描 cc-switch 的 claude 形态 provider 候选（响应不含 token 明文）。 */
  async scan(): Promise<ScanResponse> {
    return scanCcSwitch(defaultDbPath())
  }

  /**
   * 安全前提（design 留档）：
   *
   * `revealToken` 是按候选名拉取 token 明文的公开 RPC 面，本身无调用方校验或
   * 审批门；安全性完全押在 dsh fence 只把 `remote.ccimport` 命名空间授予本插件
   * apply 时 inject 的 UI 子 ctx（见 client/index.ts apply 中的
   * `['remote.ccimport', 'remote.settings', 'remote.credentials']` inject，子 ctx
   * 的 reflect fence 对其放行）这一前提上。该前提在本仓库内无法核实——
   * dsh-runtime.d.ts 只是构建期类型缝，运行时形态以发行包行为为准；若宿主侧
   * 存在其他可触达该命名空间的上下文（如共享 remote gateway），读取面即对其
   * 敞开：可按名枚举、逐个拉出 cc-switch 里全部 claude provider 的 AUTH_TOKEN
   * 明文（文件头「token 只在 client 内存瞬时经过、落库走官方凭据路径」约束的
   * 是本插件自身的写入面，约束不了读取面被谁调用）。
   *
   * 后续收紧方向（待 dsh 侧可核实 fence 行为后落地）：scan 时签发短时效一次性
   * reveal 许可，revealToken 校验该许可与调用来源（仅接受确认导入流程 uiCtx
   * 闭包的调用），把「任意按名读取」收敛为「一次确认导入对应一次定点 reveal」。
   */
  async revealToken(providerName: string): Promise<TokenResponse> {
    return readCcSwitchToken(defaultDbPath(), providerName)
  }
}

// tsdown/oxc 目前不降级 TS 5 标准 decorator，改用公开 Remote API 的
// decorator-context 合同手工标记（运行时形态与 `@Remote` 等价）。
markRemoteMethod(CcimportController.prototype, 'scan')
markRemoteMethod(CcimportController.prototype, 'revealToken')

export default CcimportController
