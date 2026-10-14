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
import { inject, TYPERT_REMOTE } from './contract.js'
import { ImportFooterEntry, snapshotFromScan } from './dialog.js'
import type { DialogSnapshot, ImportOutcome } from './dialog.js'
import type { ExistingProviders, ImportPlan } from './importer.js'
import { LOCALE_NS, localeBundles } from './locales.js'

export { inject }

/** dsh 的 pi-ai provider settings namespace（Models 页同款，先例 settings-models）。 */
const PI_AI_NS = 'llm-pi-ai'

/** cordis registry 运行时 mixin 的结构面（`ctx.plugin` 的 inject 形态；类型面未声明）。 */
interface ContextWithInject {
  inject(inject: string[], apply: (ctx: unknown) => void): { dispose(): void | Promise<void> }
}

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
    // 先拆 RemoteResult 信封：信封层失败=调用/传输级；业务联合的 ok=false=
    // host 半的结构化拒绝（candidate_missing / missing_token 等）。
    const envelope = await ctx.remote.ccimport.revealToken(item.candidate.name)
    if (!envelope.ok) {
      failures.push({ name: item.candidate.name, reason: envelope.error.message })
      continue
    }
    const tokenRevealed = envelope.value
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
/**
 * Client 插件体：注册词典、挂载本插件 Remote 贡献、向 Models 页 footer 注入
 * 导入入口。slot 未声明（dsh 升级改名）时注入不生效，页面不崩（design.md Risks）。
 */
/**
 * 激活失败可观测（spec ADDED「激活失败可观测」）：dsh bootloader 把底层 reject
 * 吞成 `web boot: 1 entry did not activate / cc-import: failed` 一行词，插件侧
 * 在每个激活环节的失败路径上补一条含环节名与错误栈的 `console.warn`，使具体
 * reject 点可从浏览器控制台定位；成功路径零 console 输出。
 */
function logStageFailure(stage: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.warn(`[cc-import:apply] activation stage "${stage}" rejected: ${detail}`)
}

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  ctx.effect(() => {
    try {
      return ctx.locale.register(LOCALE_NS, localeBundles)
    } catch (err) {
      logStageFailure('locale.register', err)
      throw err
    }
  }, 'cc-import: dictionaries')

  let unmountRemote: () => void | Promise<void>
  try {
    unmountRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  } catch (err) {
    logStageFailure('remote.$mount', err)
    throw err
  }

  // UI 注册走运行时 inject（先例：@deepseek-ai/dsh-experimental-client-ui-voice-input
  // 的 mountVoiceInput）：`remote.ccimport` 命名空间服务由上一行 $mount 拉起，
  // 此刻以运行时 inject 声明它可立即满足，且子 ctx 的 reflect fence 对其放行；
  // slot 闭包在此后任意时机（React 渲染/事件）调用 ccimport 均安全。该键
  // MUST NOT 进入口静态 inject——那会在 apply 之前等待自提供的服务，激活
  // 永远 pending（真机实测死锁）。settings/credentials 一并声明，授予子 ctx
  // 对话框读写面的 fence 访问。ctx.inject 为 registry 运行时 mixin，类型面
  // 未声明（cordis context.ts 仅注释说明），此处按运行时形态结构化断言。
  const ui = (ctx as unknown as ContextWithInject).inject(
    ['remote.ccimport', 'remote.settings', 'remote.credentials'],
    (uiCtx) => registerUi(uiCtx as Context),
  )

  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

/**
 * UI 注册体（运行时 inject 的 apply 回调）：构造对话框数据面闭包并注入
 * Models 页 footer slot。闭包持有 fence 已放行的 uiCtx，后续调用不再受
 * 渲染上下文影响。
 */
function registerUi(ctx: Context): void {
  const loadSnapshot = async (): Promise<DialogSnapshot> => {
    // 远程调用先拆 RemoteResult 信封（gateway client 面：value = 业务返回），
    // 业务级失败（scan 自己的 ok=false）再由 snapshotFromScan 判别。
    const envelope = await ctx.remote.ccimport.scan()
    if (!envelope.ok) return { ok: false, message: envelope.error.message }
    const existing = await readExistingProviders(ctx)
    if (!existing.ok) return { ok: false, message: existing.message }
    return snapshotFromScan(envelope.value, existing.existing)
  }
  const runImport = (plan: ImportPlan): Promise<ImportOutcome> => executeImport(ctx, plan)

  try {
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
  } catch (err) {
    logStageFailure('slots.inject', err)
    throw err
  }
}
