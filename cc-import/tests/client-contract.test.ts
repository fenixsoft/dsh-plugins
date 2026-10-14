/**
 * client 契约面防回归断言（spec verify-dsh-plugins-live 任务 1.4）。
 *
 * 覆盖暴露真机激活缺陷的契约面：gateway client 面在 `$mount` 时对贡献描述符
 * 执行 `requireStrictInputs` —— 每个入参 codec 必须 `mode === 'strict'`（否则
 * 抛 "has no strict codec"，bootloader 吞成 `entry did not activate`，client 半
 * 整体激活失败）。本测试在 node 侧复刻该校验的最小面，防止描述符再退化成
 * 裸 src-json 入参；同时断言入口导出形状（apply / inject）与 result codec
 * 合法性（typert-registry validateCodec 语义：src-json 或 strict）。
 */
import { describe, expect, it } from 'vitest'
import { inject, TYPERT_REMOTE } from '../src/client/contract.js'

type Codec = { readonly mode: string; readonly typeSymbol?: unknown; readonly create?: unknown }

/** 复刻 gateway requireStrictInputs：入参（含 uplink/context invocation）必须 strict。 */
function requireStrictParameterCodecs(descriptors: ReadonlyArray<{ parameters: ReadonlyArray<{ name: string; codec: Codec }> }>): void {
  for (const descriptor of descriptors) {
    for (const parameter of descriptor.parameters) {
      expect(parameter.codec.mode, `parameter ${parameter.name} codec must be strict`).toBe('strict')
      expect(typeof parameter.codec.create, `parameter ${parameter.name} must carry a create() schema factory`).toBe('function')
      expect(String(parameter.codec.typeSymbol).length, `parameter ${parameter.name} typeSymbol must be nonempty`).toBeGreaterThan(0)
    }
  }
}

/** 复刻 typert-registry validateCodec：result codec 必须是 src-json 或 strict 两态。 */
function requireKnownResultCodecs(descriptors: ReadonlyArray<{ id: string; result: Codec }>): void {
  for (const descriptor of descriptors) {
    expect(['src-json', 'strict'], `${descriptor.id} result codec mode`).toContain(descriptor.result.mode)
  }
}

describe('TYPERT_REMOTE 描述符形态（真机 0.2.0-rc.2 契约）', () => {
  it('全部入参 codec 为 strict 形态（gateway requireStrictInputs 复刻）', () => {
    requireStrictParameterCodecs(TYPERT_REMOTE.descriptors)
  })

  it('全部 result codec 为 src-json 或 strict（typert-registry validateCodec 复刻）', () => {
    requireKnownResultCodecs(TYPERT_REMOTE.descriptors)
  })

  it('描述符 id/namespace/method 段与宿主 Remote 服务键一致', () => {
    for (const descriptor of TYPERT_REMOTE.descriptors) {
      expect(descriptor.id).toBe(`${TYPERT_REMOTE.package}#${descriptor.namespace}/${descriptor.method}`)
      expect(descriptor.service).toBe('ccimport')
      expect(descriptor.namespace).toBe('ccimport')
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
    }
    expect(TYPERT_REMOTE.descriptors.map((descriptor) => descriptor.method).sort()).toEqual(['revealToken', 'scan'])
  })

  it('strict codec 的 create() 产出 zod string schema（字符串透传、非字符串拒绝）', () => {
    const revealToken = TYPERT_REMOTE.descriptors.find((descriptor) => descriptor.method === 'revealToken')
    expect(revealToken).toBeDefined()
    const codec = revealToken!.parameters[0]!.codec as { mode: string; create: () => { parse: (value: unknown) => unknown } }
    const schema = codec.create()
    expect(typeof schema.parse).toBe('function')
    expect(schema.parse('my-provider')).toBe('my-provider')
    expect(() => schema.parse(42)).toThrow()
  })
})

describe('client 入口导出形状', () => {
  it('inject 声明覆盖 slots/locale/remote 与 settings、credentials，且不含 remote.ccimport', () => {
    expect(inject).toContain('slots')
    expect(inject).toContain('locale')
    expect(inject).toContain('remote')
    expect(inject).toContain('remote.settings')
    expect(inject).toContain('remote.credentials')
    // 真机实测（0.2.0-rc.2）：`remote.<ns>` inject 键 = 激活前等待该 client 侧
    // 命名空间服务存在；remote.ccimport 只能由本插件 apply 期 $mount 自拉起，
    // 声明它 = 自等待自提供，激活永远 pending（"waiting for service"）。
    // ccimport 服务引用由 index.ts 在 mount 后立即捕获，不经 inject。
    expect(inject).not.toContain('remote.ccimport')
  })
})
