/**
 * mapping 测试：`[1M]` 拆分、无后缀不设 contextWindow、id 冲突 `-2` 递增、
 * 模型回退链、profile 形态与 apiKeyEnv 派生、displayName 携带规则。
 */
import { describe, expect, it } from 'vitest'
import {
  buildProviderProfile,
  deriveApiKeyEnv,
  resolveApiKeyEnvConflict,
  resolveCandidateModel,
  resolveRouteIdConflict,
  slugifyRouteId,
  splitModelAlias,
} from '../src/shared/mapping.js'
import type { ScanCandidate } from '../src/shared/mapping.js'

function candidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    name: 'bigmodel.cn',
    baseURL: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5.3-flash[1M]',
    hasToken: true,
    importable: true,
    ...overrides,
  }
}

describe('splitModelAlias（[1M] 后缀拆分）', () => {
  it('glm-5.3-flash[1M] → { id: "glm-5.3-flash", contextWindow: 1000000 }', () => {
    expect(splitModelAlias('glm-5.3-flash[1M]')).toEqual({ id: 'glm-5.3-flash', contextWindow: 1_000_000 })
  })

  it('拆分适用于任何来源键的模型值（ANTHROPIC_DEFAULT_OPUS_MODEL 来源同样生效）', () => {
    expect(splitModelAlias('deepseek-v4.1-flash[1M]')).toEqual({ id: 'deepseek-v4.1-flash', contextWindow: 1_000_000 })
  })

  it('无后缀只给 id，不含 contextWindow 字段', () => {
    const row = splitModelAlias('deepseek-v4-pro')
    expect(row).toEqual({ id: 'deepseek-v4-pro' })
    expect('contextWindow' in row).toBe(false)
  })

  it('id 不含 [1M] 后缀（含空白的别名也剥离干净）', () => {
    expect(splitModelAlias('glm-5.3-flash [1M]').id).toBe('glm-5.3-flash')
  })
})

describe('slugifyRouteId', () => {
  it('非 [a-z0-9-] 字符折叠为 -、小写、去首尾 -', () => {
    expect(slugifyRouteId('bigmodel.cn')).toBe('bigmodel-cn')
    expect(slugifyRouteId('OpenCodeGo')).toBe('opencodego')
    expect(slugifyRouteId('--Weird Name--')).toBe('weird-name')
    expect(slugifyRouteId('bytedance_volces.v2')).toBe('bytedance-volces-v2')
  })

  it('已是合法 slug 的名字原样保留；全非法名折叠为空串', () => {
    expect(slugifyRouteId('deepseek')).toBe('deepseek')
    expect(slugifyRouteId('???')).toBe('')
  })
})

describe('resolveRouteIdConflict（冲突加 -2/-3 递增后缀）', () => {
  it('无冲突原样返回', () => {
    expect(resolveRouteIdConflict('bigmodel-cn', new Set(['other']))).toBe('bigmodel-cn')
  })

  it('冲突加 -2；仍冲突继续 -3', () => {
    expect(resolveRouteIdConflict('bigmodel-cn', new Set(['bigmodel-cn']))).toBe('bigmodel-cn-2')
    expect(resolveRouteIdConflict('bigmodel-cn', new Set(['bigmodel-cn', 'bigmodel-cn-2']))).toBe('bigmodel-cn-3')
  })

  it('不改写传入的既有键集（纯函数）', () => {
    const existing = new Set(['a'])
    resolveRouteIdConflict('a', existing)
    expect(existing.has('a-2')).toBe(false)
  })
})

describe('resolveApiKeyEnvConflict（keyRef 冲突在 _API_KEY 前插递增后缀）', () => {
  it('无冲突原样返回', () => {
    expect(resolveApiKeyEnvConflict('A_B_API_KEY', new Set(['OTHER_API_KEY']))).toBe('A_B_API_KEY')
  })

  it('冲突加 _2；仍冲突继续 _3（派生折叠不单射：a-b 与 a--b 同得 A_B_API_KEY）', () => {
    expect(deriveApiKeyEnv('a-b')).toBe('A_B_API_KEY')
    expect(deriveApiKeyEnv('a--b')).toBe('A_B_API_KEY')
    expect(resolveApiKeyEnvConflict('A_B_API_KEY', new Set(['A_B_API_KEY']))).toBe('A_B_2_API_KEY')
    expect(resolveApiKeyEnvConflict('A_B_API_KEY', new Set(['A_B_API_KEY', 'A_B_2_API_KEY']))).toBe('A_B_3_API_KEY')
  })

  it('不改写传入的已用引用集（纯函数）', () => {
    const used = new Set(['A_API_KEY'])
    resolveApiKeyEnvConflict('A_API_KEY', used)
    expect(used.has('A_2_API_KEY')).toBe(false)
  })
})

describe('resolveCandidateModel（模型键回退链）', () => {
  it('ANTHROPIC_MODEL 在册时直接采用', () => {
    expect(resolveCandidateModel({ ANTHROPIC_MODEL: 'deepseek-v4-pro', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3-flash[1M]' })).toBe('deepseek-v4-pro')
  })

  it('ANTHROPIC_MODEL 缺失回退 ANTHROPIC_DEFAULT_OPUS_MODEL', () => {
    expect(resolveCandidateModel({ ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3-flash[1M]' })).toBe('glm-5.3-flash[1M]')
  })

  it('均缺失或为空返回 null（调用方标 missing_model）', () => {
    expect(resolveCandidateModel({})).toBeNull()
    expect(resolveCandidateModel({ ANTHROPIC_MODEL: '  ', ANTHROPIC_DEFAULT_OPUS_MODEL: '' })).toBeNull()
    expect(resolveCandidateModel({ ANTHROPIC_MODEL: null })).toBeNull()
  })
})

describe('buildProviderProfile（profile 形态与 apiKeyEnv 派生）', () => {
  it('形态 {displayName?, apiKeyEnv, api: "anthropic-messages", baseURL, models: [...]}', () => {
    const profile = buildProviderProfile('bigmodel-cn', candidate())
    expect(profile).toEqual({
      displayName: 'bigmodel.cn',
      apiKeyEnv: 'BIGMODEL_CN_API_KEY',
      api: 'anthropic-messages',
      baseURL: 'https://open.bigmodel.cn/api/anthropic',
      models: [{ id: 'glm-5.3-flash', contextWindow: 1_000_000 }],
    })
  })

  it('apiKeyEnv 派生 <ROUTE>_API_KEY（与官方表单同款规则）', () => {
    expect(deriveApiKeyEnv('opencodego')).toBe('OPENCODEGO_API_KEY')
    expect(deriveApiKeyEnv('bytedance-volces')).toBe('BYTEDANCE_VOLCES_API_KEY')
    expect(buildProviderProfile('bytedance-volces', candidate({ name: 'bytedance-volces', model: 'deepseek-v4-flash' })).apiKeyEnv).toBe('BYTEDANCE_VOLCES_API_KEY')
  })

  it('displayName 携带规则：slug 与原始名一致时不携带', () => {
    const profile = buildProviderProfile('deepseek', candidate({ name: 'deepseek', model: 'deepseek-flash[1M]' }))
    expect('displayName' in profile).toBe(false)
  })

  it('无后缀模型生成不含 contextWindow 的模型行', () => {
    const profile = buildProviderProfile('aliyun', candidate({ name: 'aliyun', model: 'deepseek-v4-pro' }))
    expect(profile.models).toEqual([{ id: 'deepseek-v4-pro' }])
  })
})
