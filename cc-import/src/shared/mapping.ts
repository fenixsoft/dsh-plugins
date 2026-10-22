/**
 * cc-switch 候选 → dsh pi-ai provider profile 的共享映射纯函数层。
 *
 * Host 半（scan 的模型解析）与 Client 半（写入计划构造、profile 组装）共用；
 * 全部函数无副作用、无 I/O，可直接单测。映射规则出处：
 * spec/changes/add-cc-import-plugin/specs/cc-import/spec.md「映射规则」。
 */

/** cc-switch 一行 claude provider 解析出的导入候选（不含任何 token 明文）。 */
export interface ScanCandidate {
  /** cc-switch 里的 provider 显示名（settings_config 之外的 name 列）。 */
  readonly name: string
  /** ANTHROPIC_BASE_URL；缺失为 null。 */
  readonly baseURL: string | null
  /** 候选模型原始值（回退链解析后），缺失为 null。 */
  readonly model: string | null
  /** 是否配置了 ANTHROPIC_AUTH_TOKEN（只报存在性，不带值）。 */
  readonly hasToken: boolean
  /** 是否可导入（baseURL + token + 模型齐备）。 */
  readonly importable: boolean
  /** 不可导入时的机器可读原因。 */
  readonly skipReason?: 'missing_base_url' | 'missing_token' | 'missing_model'
}

/** 扫描时因单行数据损坏被跳过的 cc-switch 行明细（不阻塞其他候选）。 */
export interface ScanSkippedRow {
  /** 行名；name 列缺失或非字符串时为 null。 */
  readonly name: string | null
  /** 机器可读跳过原因：缺 name 走 `bad_provider_row`，settings_config 坏 JSON 走 `bad_settings_config`。 */
  readonly code: 'bad_provider_row' | 'bad_settings_config'
  /** 人类可读明细。 */
  readonly message: string
}

/** ccimport.scan 的结构化应答：成功给候选数组（单行损坏降级为 skippedRows 明细），异常给 code + message。 */
export type ScanResponse =
  | {
      readonly ok: true
      readonly candidates: readonly ScanCandidate[]
      readonly skippedRows?: readonly ScanSkippedRow[]
    }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** dsh pi-ai 模型行（PiAiModelProfile 的 cc-import 子集）。 */
export interface ModelRow {
  readonly id: string
  readonly contextWindow?: number
}

/** dsh pi-ai provider profile（PiAiProviderProfile 的 cc-import 子集）。 */
export interface ProviderProfile {
  readonly displayName?: string
  readonly apiKeyEnv: string
  readonly api: 'anthropic-messages'
  readonly baseURL: string
  readonly models: readonly ModelRow[]
}

/** cc-switch env 块里承载模型候选的键，按回退顺序排列。 */
export const MODEL_ENV_KEYS = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL'] as const

/**
 * route id = name slug 化：非 `[a-z0-9-]` 字符折叠为 `-`、小写、去首尾 `-`。
 * 折叠连续非法字符为一个 `-`（`bigmodel.cn` → `bigmodel-cn`）。全非法名折叠
 * 为空串，由调用方按不可导入处理。
 */
export function slugifyRouteId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * route id 与既有 providers 键冲突时追加数字后缀：`-2`、`-3`… 递增。
 * @param id 期望的 route id。
 * @param existingKeys 既有 providers 键集（只读；本函数不改写它）。
 */
export function resolveRouteIdConflict(id: string, existingKeys: ReadonlySet<string>): string {
  if (!existingKeys.has(id)) return id
  for (let n = 2; ; n += 1) {
    const candidate = `${id}-${n}`
    if (!existingKeys.has(candidate)) return candidate
  }
}

/**
 * 与 dsh 官方「自定义模型 API」表单同款的凭据引用派生：
 * `<ROUTE>_API_KEY`，ROUTE 为 provider 大写、非 `[A-Z0-9]` 折叠为 `_`。
 * 折叠不单射（`-` 折叠成 `_`，如 `a-b` 与 `a--b` 同得 `A_B_API_KEY`）：不同
 * route id 派生同一引用会互相覆盖 token，批次内碰撞由 `resolveApiKeyEnvConflict`
 * 加后缀消解。
 */
export function deriveApiKeyEnv(routeId: string): string {
  return `${routeId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * keyRef 与已占用凭据引用冲突时在 `_API_KEY` 前插入递增后缀：`A_B_API_KEY` →
 * `A_B_2_API_KEY`、`A_B_3_API_KEY`…（与 `resolveRouteIdConflict` 的 `-2` 后缀
 * 策略同风格）。
 * @param keyRef 期望的凭据引用。
 * @param usedRefs 已占用的凭据引用集（只读；本函数不改写它）。
 */
export function resolveApiKeyEnvConflict(keyRef: string, usedRefs: ReadonlySet<string>): string {
  if (!usedRefs.has(keyRef)) return keyRef
  const prefix = keyRef.slice(0, -'_API_KEY'.length)
  for (let n = 2; ; n += 1) {
    const candidate = `${prefix}_${n}_API_KEY`
    if (!usedRefs.has(candidate)) return candidate
  }
}

/**
 * `[1M]` 后缀拆分：`glm-5.3-flash[1M]` → `{ id: "glm-5.3-flash", contextWindow: 1000000 }`。
 * 无后缀只给 id、不设 contextWindow；拆分适用于任何来源键的模型值。
 * 空白、空 id 与仅后缀值（如 `[1M]`，缺基础模型 id）都原样返回空 id（由调用方
 * 按缺模型处理）。
 *
 * 隐含契约：本函数只产 1M 档（1_000_000）；client 侧 `model.contextWindow`
 * 文案硬编码「1M 上下文 / 1M context」（src/client/locales.ts）与之耦合——
 * 未来扩展其他窗口档位（如 [200K]）时，须同步把该文案改为占位符形态
 * （如「{count} 上下文」）并由渲染侧传入具体数值。
 */
export function splitModelAlias(model: string): ModelRow {
  const trimmed = model.trim()
  const match = /^(.*?)\s*\[1M\]$/.exec(trimmed)
  if (match === null) return { id: trimmed }
  const id = (match[1] ?? '').trim()
  // 值仅为后缀（缺基础模型 id）：无有效 id，按空 id 返回由调用方按缺模型处理。
  if (id.length === 0) return { id: '' }
  return { id, contextWindow: 1_000_000 }
}

/** env 值判空：非字符串 / null / undefined / 纯空白都算缺失。 */
export function envValue(env: Readonly<Record<string, unknown>>, key: string): string | null {
  const raw = env[key]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * 候选模型解析链：`ANTHROPIC_MODEL` → `ANTHROPIC_DEFAULT_OPUS_MODEL` → null。
 * 两键均缺失、为空或仅为 `[1M]` 后缀（缺基础模型 id）才返回 null（调用方标
 * `missing_model`）。
 */
export function resolveCandidateModel(env: Readonly<Record<string, unknown>>): string | null {
  for (const key of MODEL_ENV_KEYS) {
    const value = envValue(env, key)
    if (value === null) continue
    // 仅为 `[1M]` 后缀等价于没配可用模型：继续回退下一键，均无效才按缺模型
    // 处理，避免导入出 id 为后缀原文的空壳模型行。
    if (splitModelAlias(value).id.length === 0) continue
    return value
  }
  return null
}

/**
 * 由候选构造 dsh pi-ai provider profile。
 *
 * - `api` 恒 `anthropic-messages`（cc-switch claude 行全部是 Anthropic 兼容端点）。
 * - `apiKeyEnv` 由 route id 派生 `<ROUTE>_API_KEY`，patch 配置零明文。
 * - 模型行经 `splitModelAlias` 拆分 `[1M]` 后缀。
 * - `displayName` 携带规则：仅当 slug 与原始名不一致时携带（slug 已同名时
 *   省略，route 键本身就是显示名）。
 */
export function buildProviderProfile(routeId: string, candidate: ScanCandidate): ProviderProfile {
  if (candidate.baseURL === null) {
    throw new TypeError(`buildProviderProfile: candidate "${candidate.name}" has no baseURL`)
  }
  const model = candidate.model
  const models: ModelRow[] =
    model === null
      ? []
      : [splitModelAlias(model)]
  const profile: {
    displayName?: string
    apiKeyEnv: string
    api: 'anthropic-messages'
    baseURL: string
    models: readonly ModelRow[]
  } = {
    apiKeyEnv: deriveApiKeyEnv(routeId),
    api: 'anthropic-messages',
    baseURL: candidate.baseURL,
    models,
  }
  if (candidate.name !== routeId) profile.displayName = candidate.name
  return profile
}
