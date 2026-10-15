/**
 * fenix-skill-provider Host 半：把外部 Claude 风格 skill 目录（默认
 * `~/.claude/skills` 下 `fenix-*`）动态注册进 dsh web 原生 skill 体系。
 *
 * - 插件形态：默认导出 cordis 插件类（对齐 fenix-dsh-dashboard-bridge / cc-import
 *   先例），loader 条目按包名装载，config 键 `sourceDir` / `pattern` 可省略。
 * - provider 注册：`ctx.skills.registerProvider(control => provider)` 注册
 *   `{ name, list, get }`；`list()` 每次动态扫描来源目录（design D2，不缓存），
 *   `get()` 按 candidate.locator 读盘剥 frontmatter，目录增删由 D3 的
 *   `fs.watch` 去抖 `control.invalidate()` 失效注册表缓存。
 * - 容错：config 非法（pattern 含不支持 glob 元字符）时以含键名的可读 error
 *   拒绝装载（对齐 bridge 先例：loader 配置错误应在装载期显式失败）；来源目录
 *   缺失返回空集 + warn；`fs.watch` 初始化失败降级为静态注册 + warn，不抛
 *   未处理异常。
 * - 生命周期：watch 随 provider registration 的 `control.signal` abort 注销
 *   （fiber 卸载 = registration dispose = watch close）；provider 本身随 fiber
 *   卸载自动注销。
 */
import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { WATCH_DEBOUNCE_MS, resolveProviderConfig } from '../shared/providerConfig.js'
import type { ProviderConfigInput, ResolvedProviderConfig } from '../shared/providerConfig.js'
import { parseFrontmatter } from './frontmatter.js'
import { PROVIDER_NAME, scanSkillDir } from './scanner.js'
import type { ScanLog } from './scanner.js'

/** 本插件注册为 cordis 服务的名字（诊断/日志定位用）。 */
export const SERVICE_NAME = 'fenix-skill-provider'

/** Host 插件：装载即注册 skill provider 与来源目录 watch。 */
export default class FenixSkillProvider extends Service {
  constructor(ctx: Context, config?: ProviderConfigInput | null) {
    super(ctx, SERVICE_NAME)
    // 非法 pattern 在此抛含键名的可读 error → 插件拒绝装载（该 loader 条目失败，
    // 不以未捕获异常牵连同一 - insert: 列表中的其余条目，由 cordis 按 fiber 收敛）。
    const resolved = resolveProviderConfig(config)
    const log: ScanLog = (message: string): void => {
      // warn 日志是容错路径（目录缺失 / watch 降级 / 非法条目跳过）的唯一观测抓手。
      try {
        this.ctx.logger.warn('%s', message)
      } catch {
        console.warn(message)
      }
    }

    const unregister = this.ctx.skills.registerProvider((control) => {
      const stopWatch = startSourceDirWatcher(resolved, control, log)
      // 插件卸载（loader 条目移除 / fiber 卸载）时经 disposer 注销 registration，
      // provider 与 watch 一并退出（signal abort 兜底关闭 watcher）。
      return {
        name: PROVIDER_NAME,
        list: (options: SkillLookupOptions) => listCandidates(resolved, options, log),
        get: (candidate: SkillCandidate, options: SkillLookupOptions) =>
          loadDefinition(candidate, options),
      }
    })
    this.ctx.effect(() => unregister, 'fenix-skill-provider: skill provider')
  }
}

/** provider.list：动态扫描；abort 尽早 settle（scanner 返回 complete:false 观察形）。 */
async function listCandidates(
  resolved: ResolvedProviderConfig,
  options: SkillLookupOptions | undefined,
  log: ScanLog,
): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
  if (options?.signal?.aborted) {
    return { candidates: [], complete: false }
  }
  return scanSkillDir(resolved.sourceDir, resolved.patternRe, log, options?.signal)
}

/**
 * provider.get：按 candidate.locator 读 SKILL.md，剥 frontmatter 后返回
 * SkillDefinition（元数据字段与 candidate 一致）；文件已删除/不可读/frontmatter
 * 不再可解析时返回 undefined（registry 的 "no longer loadable" 契约）。
 */
async function loadDefinition(
  candidate: SkillCandidate,
  _options: SkillLookupOptions | undefined,
): Promise<SkillDefinition | undefined> {
  const locator = candidate?.locator
  if (typeof locator !== 'string' || locator.length === 0) return undefined
  let raw: string
  try {
    raw = await readFile(locator, 'utf8')
  } catch {
    return undefined
  }
  const parsed = parseFrontmatter(raw)
  if (parsed === null) return undefined
  return {
    path: candidate.path ?? locator,
    name: candidate.name,
    description: candidate.description,
    whenToUse: candidate.whenToUse,
    invocation: candidate.invocation,
    source: candidate.source,
    provider: candidate.provider,
    resourceBase: candidate.resourceBase,
    metadata: candidate.metadata,
    content: parsed.body,
  }
}

/**
 * 来源目录 watch（design D3）：`fs.watch(sourceDir)` 非递归监听条目增删/改名，
 * 事件 300ms 去抖后调 `control.invalidate()`（失效 collect 缓存并广播
 * `skills/change`）。初始化失败（目录缺失、inotify 上限、平台不支持）降级为
 * 静态注册 + warn，不抛未处理异常。
 *
 * @returns 停止 watch 的 disposer；watch 未能建立时返回 undefined。
 */
function startSourceDirWatcher(
  resolved: ResolvedProviderConfig,
  control: { readonly signal: AbortSignal; readonly invalidate: () => void },
  log: ScanLog,
): (() => void) | undefined {
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(resolved.sourceDir, { persistent: false }, () => scheduleInvalidate())
  } catch (error) {
    log(
      `fenix-skill-provider: fs.watch(${resolved.sourceDir}) 初始化失败，自动同步降级为「重启后生效」的静态注册（skill 注册本身不受影响）: ${errorMessage(error)}`,
    )
    return undefined
  }

  let timer: NodeJS.Timeout | undefined
  function scheduleInvalidate(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      try {
        control.invalidate()
      } catch (error) {
        log(`fenix-skill-provider: control.invalidate() 失败: ${errorMessage(error)}`)
      }
    }, WATCH_DEBOUNCE_MS)
  }

  const stop = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    watcher.close()
  }
  if (control.signal.aborted) {
    stop()
    return stop
  }
  control.signal.addEventListener('abort', stop, { once: true })
  return stop
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
