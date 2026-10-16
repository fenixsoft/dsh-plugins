/**
 * cc-import Client 半的写入计划构造（纯函数层）。
 *
 * 从对话框勾选态 + 既有 pi-ai providers 快照，构造逐候选的官方路径写入计划：
 * 每个计划项一条 `set` op（writeSettings）+ 一条 `storeCredential` 参数。
 * 任何路径都不产生 `unset`、不整体替换 providers 命名空间（spec「官方路径写入」
 * 「只加不删幂等」）。
 */
import {
  buildProviderProfile,
  resolveApiKeyEnvConflict,
  resolveRouteIdConflict,
  slugifyRouteId,
} from '../shared/mapping.js'
import type { ProviderProfile, ScanCandidate } from '../shared/mapping.js'
import type { SettingsPathOp } from '@deepseek-ai/cordis'

/**
 * 既有 pi-ai provider 的计划期摘要（来自 settings 快照，不含密钥明文）。
 * apiKeyEnv 是凭据引用名而非密钥，随摘要带走供 planImports 消解跨批次
 * keyRef 碰撞。
 */
export interface ExistingProviderSummary {
  readonly displayName?: unknown
  readonly baseURL?: unknown
  readonly apiKeyEnv?: unknown
}

/** 既有 providers 快照：route id → 摘要。 */
export type ExistingProviders = Readonly<Record<string, ExistingProviderSummary>>

/** 对话框勾选态：勾选集 + 显式「将更新」集（仅对已存在行有意义）。 */
export interface ImportSelection {
  /** 勾选的候选名集合（勾选集之外零 ops）。 */
  readonly names: ReadonlySet<string>
  /** 显式勾选「将更新」的候选名集合（已存在行的覆盖更新语义）。 */
  readonly updateNames: ReadonlySet<string>
}

/** 一个候选的写入计划项。 */
export interface PlannedImport {
  readonly candidate: ScanCandidate
  /** 实际写入的 route id（冲突已解析）。 */
  readonly routeId: string
  readonly profile: ProviderProfile
  /** storeCredential 的凭据引用（`<ROUTE>_API_KEY`；与既有 providers 或批次内先到者派生冲突时带 `_2` 递增后缀）。 */
  readonly keyRef: string
  /** slug 命中既有 providers（对话框标「已存在」）。 */
  readonly existed: boolean
  /** 用户显式勾选「将更新」：同键 set 覆盖而非加后缀。 */
  readonly update: boolean
}

/** 计划中被跳过的勾选项（含机器可读原因）。 */
export interface SkippedImport {
  readonly name: string
  readonly reason: 'unnameable' | 'not_importable' | 'duplicate'
}

/** 一次导入的完整写入计划。 */
export interface ImportPlan {
  /**
   * 按候选顺序与 planned 锁步对齐的 set op（每项一条；set-only）。写入路径
   * （executeImport）按序直接消费本数组，不二次构造同一 op。
   */
  readonly ops: readonly SettingsPathOp[]
  readonly planned: readonly PlannedImport[]
  readonly skipped: readonly SkippedImport[]
}

/**
 * 对话框行状态判定（纯函数）：slug 命中既有 providers → 已存在，默认不勾选；
 * 可导入行默认勾选；跳过行无勾选框（disabled）。
 */
export function rowState(
  candidate: ScanCandidate,
  existingKeys: ReadonlySet<string>,
): { readonly existed: boolean; readonly defaultChecked: boolean } {
  if (!candidate.importable) return { existed: false, defaultChecked: false }
  const slug = slugifyRouteId(candidate.name)
  const existed = slug.length > 0 && existingKeys.has(slug)
  return { existed, defaultChecked: !existed }
}

/**
 * 构造写入计划。
 *
 * - 只处理「勾选 ∩ 可导入」的候选（勾选集之外零 ops）。
 * - 默认对 slug 与既有 providers（或同批已规划 id）冲突的候选加 `-2`/`-3` 后缀；
   已存在行被显式勾选「将更新」时同键覆盖（spec「重复导入为覆盖更新」）。
 * - slug 为空的候选跳过（`unnameable`）。
 * - 同名候选只保留首个、后续同名跳过（`duplicate`）：勾选集/行 key/revealToken
 *   全程以 name 寻址，而 cc-switch 的 providers.name 未见唯一约束，重名行会让
 *   勾选与计划互相串扰。
 * - keyRef 派生把 `-` 折叠成 `_`，不同 route id 可派生同一凭据引用：与既有
 *   providers 已占用引用或批次内先到者碰撞时，对后到者加 `_2`/`_3` 递增后缀
 *   （`resolveApiKeyEnvConflict`）；覆盖更新例外，沿用既有条目当前引用原位替换。
 */
export function planImports(
  candidates: readonly ScanCandidate[],
  selection: ImportSelection,
  existing: ExistingProviders,
): ImportPlan {
  // existed 判定必须始终对齐 rowState 的「原始快照」口径：existingKeys 会随
  // 批次把新 routeId 入集（冲突消解用），同批 slug 归一相撞（如「Alpha Labs」
  // 与「alpha labs」）时，后者的 routeId 只是批次内消解产物，不应据此把
  // 对话框仍视为新行的候选误标成「已存在」。
  const originalKeys = new Set(Object.keys(existing))
  const existingKeys = new Set(originalKeys)
  // keyRef 消解不只看批次内：既有 providers 已占用的凭据引用一并入集。路由
  // 键不同不代表引用不同（既有 `a_b` 与新候选 `a-b` 大写折叠后同得
  // A_B_API_KEY），不跨批次消解会让 set 直接覆盖别家 token 且无任何警告。
  const usedKeyRefs = new Set<string>(
    Object.values(existing)
      .map((summary) => summary.apiKeyEnv)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
  const seenNames = new Set<string>()
  const ops: SettingsPathOp[] = []
  const planned: PlannedImport[] = []
  const skipped: SkippedImport[] = []
  for (const candidate of candidates) {
    if (!selection.names.has(candidate.name)) continue
    if (seenNames.has(candidate.name)) {
      skipped.push({ name: candidate.name, reason: 'duplicate' })
      continue
    }
    seenNames.add(candidate.name)
    if (!candidate.importable) {
      skipped.push({ name: candidate.name, reason: 'not_importable' })
      continue
    }
    const slug = slugifyRouteId(candidate.name)
    if (slug.length === 0) {
      skipped.push({ name: candidate.name, reason: 'unnameable' })
      continue
    }
    const existed = originalKeys.has(slug)
    const update = existed && selection.updateNames.has(candidate.name)
    const routeId = update ? slug : resolveRouteIdConflict(slug, existingKeys)
    const built = buildProviderProfile(routeId, candidate)
    // routeId 在批次内已唯一，但 keyRef 派生不单射（`a-b` 与 `a--b` 同得
    // A_B_API_KEY），后到者若不消解会覆盖先到者的 token：按 routeId 同风格
    // 的递增后缀策略给后到者派生独立 keyRef（既有占用已入集，跨批次碰撞
    // 同样加后缀）。覆盖更新例外：同一条既有 provider 原地更新沿用它当前
    // 的引用，token 原位替换、不留孤儿凭据。
    const currentRef = update ? existing[slug]?.apiKeyEnv : undefined
    const keyRef =
      typeof currentRef === 'string' && currentRef.length > 0
        ? currentRef
        : resolveApiKeyEnvConflict(built.apiKeyEnv, usedKeyRefs)
    const profile = keyRef === built.apiKeyEnv ? built : { ...built, apiKeyEnv: keyRef }
    usedKeyRefs.add(keyRef)
    existingKeys.add(routeId)
    ops.push({ op: 'set', path: ['providers', routeId], value: profile })
    planned.push({
      candidate,
      routeId,
      profile,
      keyRef,
      existed,
      update,
    })
  }
  return { ops, planned, skipped }
}
