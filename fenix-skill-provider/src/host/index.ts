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
 * - 注册重试：`ctx.skills.registerProvider` 首试失败（loader 装载瞬态）按
 *   0.5s/1s/2s/4s 退避重试至多 5 次，成功留 info 痕（重试恢复注明次数），
 *   终败显式 error 不静默（见 REGISTER_MAX_ATTEMPTS 注释）。
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

/**
 * provider 注册重试上界（含首次）与退避基 delay：0.5s/1s/2s/4s（总窗 ~7.5s）。
 * 针对 loader 装载瞬态（2026-11-03 实证：profile 刚被包管理器改写后的首次启动，
 * 插件 fiber 的 inject 元数据未落定即构造 → `ctx.skills` 访问抛
 * 「cannot get property "skills" without inject」→ 该条目拒绝激活；下一轮启动
 * 自愈且不可复现）。重试窗口覆盖 loader 收敛期，可自愈的瞬态在窗内恢复；
 * 结构性失败（inject 声明真缺失）5 次同因即终败显式 error 留痕，不静默、
 * 不抛未处理异常（该 loader 条目保持激活，skill 功能降级停用）。
 */
const REGISTER_MAX_ATTEMPTS = 5
const REGISTER_RETRY_BASE_MS = 500

/** Host 插件：装载即注册 skill provider 与来源目录 watch（注册失败按上界退避重试）。 */
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
    // 生命周期留痕走 console.*：cordis logger 通道在 dsh 宿主不落 stdout（实测
    // 2026-11-03，注册成功 info 无处可查），systemd 捕获的 stdout（StandardOutput
    // =append:/var/log/dsh-web.log）才是真机可见面；每启动各一行，量可忽略。
    const logInfo = (message: string): void => {
      console.log(message)
    }
    const logError = (message: string): void => {
      console.error(message)
    }

    // 幂等守卫：本实现假设 dsh skill registry 的 registerProvider 工厂只被调用
    // 一次（invalidate / 重收集只重复调用 list/get，不重调工厂；该契约未在本仓库
    // 内可核实）。若 registry 实际会重调工厂，以闭包级标记跳过重复启动，防止每次
    // 新起一个 fs.watch 而旧 watcher 的 stop 被丢弃（watcher 泄漏 + 重复 invalidate）。
    let watchStarted = false
    // 注册重试状态：unregistered 在卸载后置位（迟到的重试不得再注册，防泄漏）；
    // unregister 由成功的尝试赋值，卸载 disposer 闭包读取（变量先声明后赋值，
    // 首试失败时 disposer 亦须可达——重试成功前卸载只清 timer，无注册可注销）。
    let unregistered = false
    let unregister: (() => void) | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    this.ctx.effect(() => () => {
      unregistered = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      unregister?.()
    }, 'fenix-skill-provider: skill provider')

    const attemptRegister = (attempt: number): void => {
      if (unregistered) return
      try {
        unregister = this.ctx.skills.registerProvider((control) => {
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
        // 成功留痕（每次装载一行；经重试恢复时注明次数——loader 瞬态的可观测抓手）。
        logInfo(
          `fenix-skill-provider: provider 注册成功${
            attempt > 0 ? `（重试第 ${attempt} 次后恢复）` : ''
          }`,
        )
      } catch (error) {
        if (attempt >= REGISTER_MAX_ATTEMPTS - 1) {
          logError(
            `fenix-skill-provider: provider 注册失败，已重试 ${REGISTER_MAX_ATTEMPTS} 次放弃（skill 功能停用，重启宿主可重试）: ${errorMessage(error)}`,
          )
          return
        }
        const delay = REGISTER_RETRY_BASE_MS * 2 ** attempt
        console.warn(
          `fenix-skill-provider: provider 注册失败（${attempt + 1}/${REGISTER_MAX_ATTEMPTS}），${delay}ms 后重试: ${errorMessage(error)}`,
        )
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          attemptRegister(attempt + 1)
        }, delay)
      }
    }
    attemptRegister(0)
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
