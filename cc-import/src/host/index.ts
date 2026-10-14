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
import { defaultDbPath, lookupCcSwitchToken, scanCcSwitch } from './scan.js'

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
   * 按候选名读取 AUTH_TOKEN 明文；仅导入确认后由 client 调用。
   * scan 已确认 `hasToken` 的候选若在此刻读取失败（db 被并发修改），按结构化
   * 错误返回，client 将其计入该候选的失败明细，不阻断批次。
   */
  async revealToken(providerName: string): Promise<TokenResponse> {
    const scanned = scanCcSwitch(defaultDbPath())
    if (!scanned.ok) return scanned
    const candidate = scanned.candidates.find((entry) => entry.name === providerName)
    if (candidate === undefined) {
      return { ok: false, code: 'candidate_missing', message: `cc-switch 中不存在名为 "${providerName}" 的 claude 候选` }
    }
    if (!candidate.hasToken) {
      return { ok: false, code: 'missing_token', message: `候选 "${providerName}" 未配置 ANTHROPIC_AUTH_TOKEN，无法导入` }
    }
    const token = lookupCcSwitchToken(defaultDbPath(), providerName)
    if (token === null) {
      return { ok: false, code: 'token_unreadable', message: `候选 "${providerName}" 的 AUTH_TOKEN 在导入时已不可读` }
    }
    return { ok: true, token }
  }
}

// tsdown/oxc 目前不降级 TS 5 标准 decorator，改用公开 Remote API 的
// decorator-context 合同手工标记（运行时形态与 `@Remote` 等价）。
markRemoteMethod(CcimportController.prototype, 'scan')
markRemoteMethod(CcimportController.prototype, 'revealToken')

export default CcimportController
