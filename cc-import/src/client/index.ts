/**
 * cc-import Client 半：Models 设置页 footer 注入「从 Claude Code 导入」按钮。
 *
 * - `slots.inject("settings.models.footer", ...)` 注册 footer 条目（按钮 +
 *   对话框），文案经 `locale.register` 注册中英双语。
 * - 本插件自己的 Remote 贡献（`ccimport.scan` / `ccimport.revealToken`）经
 *   `remote.$mount` 挂载为 `ctx.remote.ccimport`。
 * - 导入执行走与官方「自定义模型 API」表单完全相同的写入路径：
 *   `writeSettings(llm-pi-ai ns, [set op], expectedRevision)` →
 *   `storeCredential(<ROUTE>_API_KEY, token)`；conflict 时重读快照重试一次，
 *   单项失败不阻断批次。
 */
import type { Context, SettingsPathOp } from '@deepseek-ai/cordis'
import { ImportFooterEntry, snapshotFromScan } from './dialog.js'
import type { DialogSnapshot, ImportOutcome } from './dialog.js'
import type { ExistingProviders, ImportPlan } from './importer.js'
import { LOCALE_NS, localeBundles } from './locales.js'
import type { ScanResponse } from '../shared/mapping.js'

/** dsh 的 pi-ai provider settings namespace（Models 页同款，先例 settings-models）。 */
const PI_AI_NS = 'llm-pi-ai'

/** cordis 服务注入：本插件消费的全部 client 服务键。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials']

/** 本插件 Remote namespace 的 client 侧贡献描述符（src-json 编解码）。 */
const TYPERT_REMOTE = {
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
        { name: 'providerName', wire: 'providerName', source: 'json', codec: { mode: 'src-json' } },
      ],
      result: { mode: 'src-json' },
    },
  ],
} as const

/** settings 快照里的 pi-ai providers 形状（只取计划期需要的摘要字段）。 */
function extractProviders(value: unknown): ExistingProviders {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const providers = (value as { readonly providers?: unknown }).providers
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return {}
  const result: Record<string, { displayName?: unknown; baseURL?: unknown }> = {}
  for (const [routeId, profile] of Object.entries(providers as Record<string, unknown>)) {
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) continue
    const summary = profile as { readonly displayName?: unknown; readonly baseURL?: unknown }
    result[routeId] = { displayName: summary.displayName, baseURL: summary.baseURL }
  }
  return result
}

interface ExistingRead {
  readonly ok: true
  readonly existing: ExistingProviders
  readonly revision: number
}

/** 重读 pi-ai providers 快照（对话框打开与 conflict 重试共用）。 */
async function readExistingProviders(
  ctx: Context,
): Promise<ExistingRead | { readonly ok: false; readonly message: string }> {
  const response = await ctx.remote.settings.describe()
  if (!response.ok) return { ok: false, message: response.error.message }
  const view = response.value.namespaces.find((namespace) => namespace.ns === PI_AI_NS)
  if (view === undefined) return { ok: true, existing: {}, revision: 0 }
  return { ok: true, existing: extractProviders(view.value), revision: view.revision }
}

/**
 * 执行一个写入计划：逐候选 reveal → writeSettings（conflict 重读重试一次）→
 * storeCredential。任何一步失败记入失败明细并继续其余候选；set-only，任何
 * 路径不 unset、不整体替换 providers。
 */
async function executeImport(ctx: Context, plan: ImportPlan): Promise<ImportOutcome> {
  let snapshot: ExistingRead | { ok: false; message: string } = await readExistingProviders(ctx)
  const failures: { name: string; reason: string }[] = []
  let succeeded = 0
  for (const item of plan.planned) {
    const tokenRevealed = await ctx.remote.ccimport.revealToken(item.candidate.name)
    if (!tokenRevealed.ok) {
      failures.push({ name: item.candidate.name, reason: tokenRevealed.message })
      continue
    }
    const op: SettingsPathOp = { op: 'set', path: ['providers', item.routeId], value: item.profile }
    let written = await ctx.remote.settings.mutate(PI_AI_NS, [op], snapshot.ok ? snapshot.revision : undefined)
    if (!written.ok && written.error.code === 'settings/conflict') {
      // 重读快照并重试一次；再冲突按该候选失败处理，不中断批次。
      snapshot = await readExistingProviders(ctx)
      written = await ctx.remote.settings.mutate(PI_AI_NS, [op], snapshot.ok ? snapshot.revision : undefined)
    }
    if (!written.ok) {
      failures.push({ name: item.candidate.name, reason: written.error.message })
      continue
    }
    if (snapshot.ok) snapshot = { ...snapshot, revision: written.value.revision }
    const stored = await ctx.remote.credentials.set(item.keyRef, tokenRevealed.token)
    if (!stored.ok) {
      failures.push({ name: item.candidate.name, reason: stored.error.message })
      continue
    }
    succeeded += 1
  }
  return { succeeded, failures }
}

/**
 * Client 插件体：注册词典、挂载本插件 Remote 贡献、向 Models 页 footer 注入
 * 导入入口。slot 未声明（dsh 升级改名）时注入不生效，页面不崩（design.md Risks）。
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, localeBundles), 'cc-import: dictionaries')
  const unmountRemote = await ctx.remote.$mount(TYPERT_REMOTE)

  const loadSnapshot = async (): Promise<DialogSnapshot> => {
    const scanned: ScanResponse = await ctx.remote.ccimport.scan()
    const existing = await readExistingProviders(ctx)
    if (!existing.ok) return { ok: false, message: existing.message }
    return snapshotFromScan(scanned, existing.existing)
  }
  const runImport = (plan: ImportPlan): Promise<ImportOutcome> => executeImport(ctx, plan)

  ctx.slots.inject('settings.models.footer', () =>
    ctx.slots.register(
      {
        name: 'settings.models.footer',
        id: 'cc-import',
        order: 10,
        locale: LOCALE_NS,
        inject: () => ({ loadSnapshot, runImport }),
      },
      ImportFooterEntry,
    ),
  )

  return async () => {
    await unmountRemote()
  }
}
