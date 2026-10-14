/**
 * importer 测试：写入计划构造——set-only、勾选集之外零 ops、已存在判定、
 * 显式「将更新」同键覆盖、批次内 id 冲突 -2 递增、displayName 携带规则。
 */
import { describe, expect, it } from 'vitest'
import { planImports, rowState } from '../src/client/importer.js'
import type { ExistingProviders } from '../src/client/importer.js'
import type { ScanCandidate } from '../src/shared/mapping.js'

function candidate(name: string, overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    name,
    baseURL: `https://${name}.example/anthropic`,
    model: 'deepseek-v4-pro',
    hasToken: true,
    importable: true,
    ...overrides,
  }
}

describe('写入计划：set-only 与勾选集', () => {
  it('所有 ops 都是 set op，且不含 unset', () => {
    const plan = planImports(
      [candidate('a'), candidate('b')],
      { names: new Set(['a', 'b']), updateNames: new Set() },
      {},
    )
    expect(plan.ops).toHaveLength(2)
    for (const op of plan.ops) {
      expect(op.op).toBe('set')
      expect(op.path[0]).toBe('providers')
    }
    expect(plan.ops.some((op) => op.op === 'unset')).toBe(false)
  })

  it('勾选集之外零 ops（5 个可导入只勾 1 个 → 仅 1 条 set）', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e'].map((name) => candidate(name))
    const plan = planImports(candidates, { names: new Set(['c']), updateNames: new Set() }, {})
    expect(plan.ops).toHaveLength(1)
    expect(plan.ops[0]).toEqual({
      op: 'set',
      path: ['providers', 'c'],
      value: expect.objectContaining({ api: 'anthropic-messages' }),
    })
  })

  it('跳过行与未勾选的已存在行不产生任何写调用', () => {
    const candidates = [
      candidate('skip-me', { importable: false, hasToken: false, skipReason: 'missing_token' }),
      candidate('existing', { name: 'existing' }),
    ]
    const existing: ExistingProviders = { existing: { displayName: 'existing' } }
    const plan = planImports(candidates, { names: new Set(['skip-me']), updateNames: new Set() }, existing)
    expect(plan.ops).toHaveLength(0)
    expect(plan.planned).toHaveLength(0)
  })
})

describe('已存在判定与冲突解析', () => {
  it('slug 命中既有 providers 的候选默认不勾选（rowState）', () => {
    const state = rowState(candidate('bigmodel.cn'), new Set(['bigmodel-cn']))
    expect(state).toEqual({ existed: true, defaultChecked: false })
  })

  it('可导入且不存在的新候选默认勾选', () => {
    const state = rowState(candidate('fresh'), new Set(['bigmodel-cn']))
    expect(state).toEqual({ existed: false, defaultChecked: true })
  })

  it('已存在且显式勾选「将更新」→ 同键 set 覆盖（重复导入为覆盖更新）', () => {
    const existing: ExistingProviders = { 'bigmodel-cn': { displayName: 'bigmodel.cn' } }
    const plan = planImports(
      [candidate('bigmodel.cn')],
      { names: new Set(['bigmodel.cn']), updateNames: new Set(['bigmodel.cn']) },
      existing,
    )
    expect(plan.ops).toHaveLength(1)
    expect(plan.ops[0]?.path).toEqual(['providers', 'bigmodel-cn'])
    expect(plan.planned[0]).toMatchObject({ existed: true, update: true, routeId: 'bigmodel-cn' })
  })

  it('slug 与既有键冲突且未显式「将更新」→ 写入 bigmodel-cn-2', () => {
    const existing: ExistingProviders = { 'bigmodel-cn': {} }
    const plan = planImports(
      [candidate('bigmodel.cn')],
      { names: new Set(['bigmodel.cn']), updateNames: new Set() },
      existing,
    )
    expect(plan.ops[0]?.path).toEqual(['providers', 'bigmodel-cn-2'])
  })

  it('仍冲突继续 -3；同批两个同名候选依次加后缀', () => {
    const existing: ExistingProviders = { 'x': {}, 'x-2': {} }
    const plan = planImports(
      [candidate('x'), candidate('x')],
      { names: new Set(['x']), updateNames: new Set() },
      existing,
    )
    expect(plan.ops.map((op) => op.path)).toEqual([['providers', 'x-3'], ['providers', 'x-4']])
  })
})

describe('计划项的 profile 与凭据引用', () => {
  it('keyRef 等于 profile.apiKeyEnv（storeCredential 参数一致）', () => {
    const plan = planImports(
      [candidate('bytedance-volces', { model: 'deepseek-v4.1-flash[1M]' })],
      { names: new Set(['bytedance-volces']), updateNames: new Set() },
      {},
    )
    const item = plan.planned[0]
    expect(item?.keyRef).toBe('BYTEDANCE_VOLCES_API_KEY')
    expect(item?.profile.apiKeyEnv).toBe('BYTEDANCE_VOLCES_API_KEY')
    expect(item?.profile.models).toEqual([{ id: 'deepseek-v4.1-flash', contextWindow: 1_000_000 }])
    expect(item?.profile.api).toBe('anthropic-messages')
  })

  it('displayName 携带规则：slug 与名字一致时省略，否则携带原名', () => {
    const plan = planImports(
      [candidate('deepseek'), candidate('bigmodel.cn')],
      { names: new Set(['deepseek', 'bigmodel.cn']), updateNames: new Set() },
      {},
    )
    const deepseek = plan.planned.find((item) => item.routeId === 'deepseek')
    const bigmodel = plan.planned.find((item) => item.routeId === 'bigmodel-cn')
    expect('displayName' in (deepseek?.profile ?? {})).toBe(false)
    expect(bigmodel?.profile.displayName).toBe('bigmodel.cn')
  })

  it('planImports 为纯函数：不改写传入的既有键集', () => {
    const existing: ExistingProviders = { a: {} }
    planImports([candidate('a')], { names: new Set(['a']), updateNames: new Set() }, existing)
    expect(Object.keys(existing)).toEqual(['a'])
  })
})
