/**
 * 宿主主题跟随通道（SPEC add-bridge-theme-channel）：iframe 嵌入态主题跟随的
 * 宿主半——初始档注入（三挂载点经 currentThemeScheme 同步取模块级缓存，作
 * buildPanelSrc 第三参拼 `&theme=<档>`）+ 实时广播（订阅宿主
 * `ctx.on("theme/change")`，向全部在册 iframe contentWindow postMessage
 * `{kind:'fenix-theme', theme:'dark'|'light'}`，与 fenixd 仓
 * core/dashboard/static/src/utils/embedBridge.ts 的 iframe 侧契约逐字节镜像，
 * 消息形状双向对称 `{kind, theme}` 风格）。
 *
 * 形状（design D1/D2/D3）：
 * - 模块级快照缓存：installThemeFollow 装入时读 `ctx.theme.getTheme()` 落缓存；
 *   theme/change 事件**先刷新缓存再广播**——右缘页签首次打开、项目面板新注册
 *   等「晚于宿主切换」的挂载从缓存取初始注入档，只广播不刷新缓存则这些面板
 *   首帧错档且无后续广播可补（评审 2026-11-24 补）。缓存随每次事件刷新，
 *   注入档 SHALL 为宿主最近档而非插件安装时快照。
 * - 注册表：registerPanelWindow/unregisterPanelWindow 由 DashboardPanel 的
 *   callback ref 在挂载/卸载对称驱动（panels.tsx）；广播仅发在册窗口（成员
 *   资格为唯一发送闸），单窗口 postMessage 抛错跳过并摘除，不中断其余窗口。
 * - 降级与等待（D4，2026-11-26 review 73434a31edea 对齐 localeFollow 先例）：
 *   ctx.theme 未注入/未就绪（含属性访问抛错——cordis proxy 对缺失服务抛
 *   `cannot get property "theme" without inject`）→ 1s 轮询重试（late provide
 *   假设，console.debug 留痕一次）；订阅面缺席 / 非白名单坏值 → 终局降级：
 *   缓存 undefined（buildPanelSrc 第三参不传，输出与现状逐字符一致）、不订阅、
 *   广播空转，无报错。降级面收敛在本模块，其它模块不感知主题能力存在与否。
 *   'theme' 不入 client 静态 inject——静态声明 = 激活前等待服务存在，旧版宿主
 *   缺席即整个插件激活永远 pending，降级路径永不触发（见 index.ts inject 注释）。
 *
 * 白名单口径（design D3）：colorScheme 经 normalizeThemeScheme 映射，白名单外
 * 值既不刷新缓存也不广播（spec「非法 colorScheme 不发…已挂载面板主题保持
 * 不变」——缓存维持 last-known-good）。
 */
import { normalizeThemeScheme } from '../shared/config.js'
import type { ThemeScheme } from '../shared/config.js'

/** host→iframe 主题消息 kind 常量（dashboard 侧镜像值：fenixd 仓
 * core/dashboard/static/src/utils/embedBridge.ts 的 THEME_MESSAGE_KIND——
 * 双仓字面量必须逐字节一致，任一侧改动必改另一侧，两侧单测各自钉值）。 */
export const FENIX_THEME_KIND = 'fenix-theme'

/** 宿主主题快照最小消费面（dsh-client-ui-theme ThemeSnapshot 子集；仅列本
 * 模块读取的键，形状漂移按 undefined 降级）。 */
export interface ThemeSnapshotLike {
  readonly active?: { readonly colorScheme?: unknown }
}

/** 宿主主题服务最小消费面（dsh-client-ui-theme ThemeRuntime 子集）。 */
export interface ThemeServiceLike {
  readonly getTheme?: () => ThemeSnapshotLike | undefined
}

/** installThemeFollow 的 ctx 最小消费面（宿主 ctx 子集；测试桩按形状构造，
 * 两键均缺席 → 轮询等待，永不就绪则跟随静默失效——console.debug 留痕一次）。
 * listener 参数取 unknown 宽面（与 dsh-runtime.d.ts 的 Context.on seam 严格
 * 匹配），快照形状收窄在 schemeOf 内联完成。 */
export interface ThemeFollowContext {
  /** dsh-client-ui-theme 服务（旧版宿主缺席/未就绪；属性访问抛错按未就绪继续轮询）。 */
  readonly theme?: ThemeServiceLike
  /** cordis 事件订阅（返回退订 disposer）；不可用 → 不订阅（D4 降级）。 */
  on?(event: 'theme/change', listener: (snapshot: unknown) => void): unknown
}

/* ================== 模块级快照缓存（挂载点同步取初始档） ================== */

let cachedScheme: ThemeScheme | undefined = undefined

/**
 * 当前宿主主题档缓存：三挂载点同步取初始注入档（undefined = 降级不注入，
 * buildPanelSrc 第三参不传）。缓存随每次 theme/change 事件刷新——晚于宿主
 * 切换的挂载（右缘页签首次打开 / 项目面板重注册 / 固定条目面板渲染）注入的
 * 即宿主最近档。
 */
export function currentThemeScheme(): ThemeScheme | undefined {
  return cachedScheme
}

/* ====================== 面板窗口注册表（广播目标） ======================
 * 语言跟随（localeFollow.ts）共享同一集合：主题与语言是同一 iframe 面板面的
 * 两个宿主档，注册表 MUST 单源（注册/注销只有 DashboardPanel ref 一条驱动）。 */

export const panelWindows = new Set<Window>()

/**
 * 挂载登记（DashboardPanel callback ref attach 半驱动）；win 缺席（iframe
 * 离屏/未进浏览上下文的瞬态）静默跳过，重复登记 Set 去重。
 */
export function registerPanelWindow(win: Window): void {
  if (win === undefined || win === null) return
  panelWindows.add(win)
}

/** 卸载注销（callback ref detach 半驱动）；幂等，缺席参数零动作。 */
export function unregisterPanelWindow(win: Window | null | undefined): void {
  if (win === undefined || win === null) return
  panelWindows.delete(win)
}

/**
 * 广播目标 origin：宿主页面自身 origin（反代同源）——postMessage 的
 * targetOrigin 只接受 origin 不接受路径前缀（spec「theme/change 实时广播」）。
 * node 测试环境无 window 降级 `'*'`（该环境无真实跨帧面，选择不可观测）。
 */
export function broadcastOrigin(): string {
  const origin = (globalThis as { window?: { location?: { origin?: unknown } } }).window?.location
    ?.origin
  return typeof origin === 'string' && origin.length > 0 ? origin : '*'
}

/**
 * 向全部在册 iframe 窗口广播主题档：白名单映射（其它值不发）；消息形状
 * `{kind:'fenix-theme', theme:'dark'|'light'}`；仅发在册窗口（成员资格为
 * 唯一发送闸），单窗口 postMessage 抛错（已销毁）跳过并从注册表摘除，不
 * 中断其余广播、无未捕获异常。
 */
export function broadcastTheme(theme: unknown): void {
  const scheme = normalizeThemeScheme(theme)
  if (scheme === undefined) return
  const message = { kind: FENIX_THEME_KIND, theme: scheme }
  const origin = broadcastOrigin()
  for (const win of Array.from(panelWindows)) {
    try {
      win.postMessage(message, origin)
    } catch {
      panelWindows.delete(win) // 已销毁窗口：跳过并摘除，防逐轮重复失败
    }
  }
}

/* ========================= 装配（启动一次 + disposer） ========================= */

/** 快照 → 白名单档（事件 listener 的 unknown 宽面在此收窄；非对象快照/形状
 * 漂移一律 undefined）。 */
function schemeOf(snapshot: unknown): ThemeScheme | undefined {
  if (snapshot === null || snapshot === undefined || typeof snapshot !== 'object') return undefined
  return normalizeThemeScheme((snapshot as ThemeSnapshotLike).active?.colorScheme)
}

/**
 * 主题跟随装配（插件 client 启动时调用一次，接入点 MUST 先于项目同步注册——
 * projectEntrySink 的 src 在 registerProjectPanel 时即拼串而非渲染惰性求值，
 * design D3）：读宿主快照落模块级缓存 → 订阅 theme/change（处理序：先刷新
 * 缓存再广播）→ 返回 disposer（退订 + 缓存清零）随插件清理链路执行。
 *
 * 声明与时序核实结论（2026-11-26 review 0920849798c7 / 73434a31edea）：
 * - 'theme' 不入 client 静态 inject：cordis 静态 inject 键 = 「激活前等待该
 *   服务存在」（真机实测口径，cc-import contract.ts fence 约束同源：声明宿主
 *   不提供的服务即 boot 报 waiting for service、激活永远 pending），旧版宿主
 *   无 dsh-client-ui-theme 时声明会让整个 client 插件激活 pending、D4 降级
 *   永不触发。故与 locale 同策略：服务全部由本函数运行时探测。
 * - late provide 轮询（localeFollow 先例）：locale 服务 await settings read
 *   之后才 provide 的时序教训（本插件同步 apply 时宿主服务大概率未注入，
 *   一次性判定会让跟随永久失效）对同构的 theme 服务保守取同一假设（本仓无
 *   该服务 provide 时序的实证记录）——服务缺席/未就绪 1s 轮询重试，进入等待
 *   路径 console.debug 留痕一次，便于旧版宿主上排查「跟随静默失效」。
 *
 * 终局降级（不注入初始档）：theme/change 订阅面缺席、或快照非空但非白名单档
 * （坏值宁缺毋错）→ 缓存保持 undefined、不订阅、返回 no-op disposer，console.
 * debug 留痕。订阅面缺席时不注入初始档：无实时跟随能力的快照会把面板永远钉死
 * 在装入时档位（宿主切主题后必然错档且无法纠正），宁可不注入交 dashboard 自身
 * 缺省。
 */
export function installThemeFollow(ctx: ThemeFollowContext): () => void {
  cachedScheme = undefined // 装入即重置：降级路径缓存恒 undefined，重装不残留旧值
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let waitingLogged = false

  const subscribe = (
    themeService: NonNullable<ThemeFollowContext['theme']>,
    on: NonNullable<ThemeFollowContext['on']>,
  ): void => {
    const dispose = on('theme/change', (snapshot) => {
      const scheme = schemeOf(snapshot)
      if (scheme === undefined) return // 白名单外值：缓存与广播均保持不变
      cachedScheme = scheme // 先刷新缓存再广播（晚挂载面板取最新档）
      broadcastTheme(scheme)
    })
    unsubscribe = typeof dispose === 'function' ? (dispose as () => void) : undefined
  }

  /**
   * 单轮接入尝试。true = 已终局（订阅成功或「宁缺毋错」降级）；false = 未就绪需再等。
   */
  const attempt = (): boolean => {
    try {
      const theme = ctx?.theme
      if (theme === null || theme === undefined || typeof theme.getTheme !== 'function') {
        return false // 服务未注入/未就绪：等下一次轮询（late provide 假设）
      }
      if (typeof ctx.on !== 'function') {
        console.debug(
          '[fenix-dsh-dashboard-bridge] theme/change 订阅面缺席：主题跟随终局降级（不注入初始档，交 dashboard 自身缺省）',
        )
        return true // 订阅面缺席：无法跟随，终局降级（同 localeFollow）
      }
      const on = ctx.on
      let initial: ThemeScheme | undefined
      try {
        const snapshot = theme.getTheme()
        const raw = (snapshot as ThemeSnapshotLike | null | undefined)?.active?.colorScheme
        if (raw === undefined || raw === null || raw === '') {
          return false // 早期空快照（服务已注入、偏好尚未回同步）：等回同步
        }
        initial = schemeOf(snapshot)
      } catch {
        return false // getTheme 抛错（形状漂移/未就绪）：继续等（localeFollow 同口径）
      }
      if (initial === undefined) {
        console.debug(
          '[fenix-dsh-dashboard-bridge] theme 快照非白名单档：主题跟随终局降级（坏值宁缺毋错，不注入初始档）',
        )
        return true // 非空且非白名单：坏值，宁缺毋错
      }
      cachedScheme = initial
      subscribe(theme, on)
      return true
    } catch {
      return false // ctx.theme 属性访问抛错（cordis proxy）→ 继续等
    }
  }

  const poll = (): void => {
    if (stopped) return
    if (attempt()) return // 终局（成功或降级），不再排程
    if (!waitingLogged) {
      waitingLogged = true
      console.debug(
        '[fenix-dsh-dashboard-bridge] theme 服务未注入/未就绪（late provide 假设，对齐 localeFollow 先例）：1s 轮询等待，就绪后接入主题跟随',
      )
    }
    timer = setTimeout(poll, 1000) // 未就绪：1s 后再试（theme 服务 late provide）
  }

  poll()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    if (typeof unsubscribe === 'function') unsubscribe()
    cachedScheme = undefined
  }
}
