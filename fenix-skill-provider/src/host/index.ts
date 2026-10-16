/**
 * fenix-skill-provider Host 半：把外部 Claude 风格 skill 目录（默认
 * `~/.claude/skills` 下 `fenix-*`）动态注册进 dsh web 原生 skill 体系。
 *
 * - 插件形态：默认导出 cordis 插件类（对齐 fenix-dsh-dashboard-bridge / cc-import
 *   先例），loader 条目按包名装载，config 键 `sourceDir` / `pattern` 可省略。
 * - provider 注册：`ctx.skills.registerProvider(control => provider)` 注册
 *   `{ name, list, get }`；`list()` 每次动态扫描来源目录（design D2，不缓存），
 *   `get()` 按 candidate.locator 读盘剥 frontmatter，目录条目增删/改名由 D3 的
 *   `fs.watch` 去抖 `control.invalidate()` 失效注册表缓存。watch 非递归、不覆盖
 *   skill 子目录内部：既有条目的 SKILL.md 就地编辑（frontmatter 元数据变更）
 *   不触发失效，列表元数据须重启宿主才更新（正文经 get() 每次读盘仍即时）。
 * - 容错：config 非法（pattern 含不支持 glob 元字符）时以含键名的可读 error
 *   拒绝装载（对齐 bridge 先例：loader 配置错误应在装载期显式失败）；来源目录
 *   缺失返回空集 + warn；`fs.watch` 初始化失败或运行期 error 均降级为静态
 *   注册 + warn，不抛未处理异常。
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
import { errorMessage } from '../shared/errorMessage.js'
import { WATCH_DEBOUNCE_MS, resolveProviderConfig } from '../shared/providerConfig.js'
import type { ProviderConfigInput, ResolvedProviderConfig } from '../shared/providerConfig.js'
import { parseFrontmatter } from './frontmatter.js'
import { PROVIDER_NAME, scanSkillDir } from './scanner.js'
import type { ScanLog } from './scanner.js'

/** 本插件注册为 cordis 服务的名字（诊断/日志定位用）。 */
export const SERVICE_NAME = 'fenix-skill-provider'

/** Host 插件：装载即注册 skill provider 与来源目录 watch。 */
export default class FenixSkillProvider extends Service {
  /** 依赖 skill registry 服务：声明后构造器内方可访问 `this.ctx.skills`
   * （cordis 规则——未声明 inject 访问 ctx.<name> 抛
   * 「cannot get property "skills" without inject」并拒绝装载）。 */
  static readonly inject = ['skills']

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

    // 幂等守卫：本实现假设 dsh skill registry 的 registerProvider 工厂只被调用
    // 一次（invalidate / 重收集只重复调用 list/get，不重调工厂；该契约未在本仓库
    // 内可核实）。若 registry 实际会重调工厂，以闭包级标记跳过重复启动，防止每次
    // 新起一个 fs.watch 而旧 watcher 的 stop 被丢弃（watcher 泄漏 + 重复 invalidate）。
    let watchStarted = false
    const unregister = this.ctx.skills.registerProvider((control) => {
      if (!watchStarted) {
        watchStarted = true
        startSourceDirWatcher(resolved, control, log)
      }
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
 * `skills/change`）。非递归不覆盖 skill 子目录内部：既有条目的 SKILL.md
 * 就地编辑（frontmatter 元数据变更）不产生事件，列表元数据须重启宿主才更新
 * （正文经 get() 每次读盘仍即时）。
 * 初始化失败（目录缺失、inotify 上限、平台不支持）与运行期
 * 'error'（目录被删/改名、句柄失效等）都降级为静态注册 + warn，不抛未处理异常。
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
      `fenix-skill-provider: fs.watch(${resolved.sourceDir}) 初始化失败，自动同步降级为「重启后生效」的静态注册（skill 注册本身不受影响；watch 仅覆盖条目增删/改名，SKILL.md 就地编辑亦需重启生效）: ${errorMessage(error)}`,
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

  // 运行期 'error' 事件（来源目录被删/改名、inotify 句柄失效等）：Node 的
  // EventEmitter 约定是 error 事件无监听即抛未捕获异常，在 dsh 宿主进程里会
  // 拖垮整个 web 进程。与初始化失败同口径降级：warn 一条后关闭 watcher，并置
  // degraded 避免重复报错（error 后 watcher 通常已死，自动同步失效，按「重启后
  // 生效」的静态注册口径运行）。自动重建 watcher 需与本 signal 的 abort 联动
  // 重建，当前最小实现不做，留注释备忘。
  let degraded = false
  watcher.on('error', (error) => {
    if (degraded) return
    degraded = true
    log(
      `fenix-skill-provider: fs.watch(${resolved.sourceDir}) 运行期失效，自动同步降级为「重启后生效」的静态注册（skill 注册本身不受影响；watch 仅覆盖条目增删/改名，SKILL.md 就地编辑亦需重启生效）: ${errorMessage(error)}`,
    )
    try {
      stop()
    } catch {
      // watcher 已被运行期故障杀死时 close 可能再抛：降级路径尽力清理即可
    }
  })
  return stop
}
