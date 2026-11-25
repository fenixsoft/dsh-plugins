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
 * - 降级（D4）：ctx.theme 缺席 / getTheme 不可调 / 事件订阅不可用 → 缓存
 *   undefined（buildPanelSrc 第三参不传，输出与现状逐字符一致）、不订阅、
 *   广播空转，无报错。降级面收敛在本模块，其它模块不感知主题能力存在与否。
 *   注意 cordis proxy 对缺失服务属性访问会抛错（`cannot get property "theme"
 *   without inject`），故 ctx.theme / 事件订阅读取全部在 try/catch 内。
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
 * 两键均缺席 → D4 降级）。listener 参数取 unknown 宽面（与 dsh-runtime.d.ts
 * 的 Context.on seam 严格匹配），快照形状收窄在 schemeOf 内联完成。 */
export interface ThemeFollowContext {
  /** dsh-client-ui-theme 服务（旧版宿主缺席；属性访问抛错按缺席降级）。 */
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
 * 降级（D4）：theme 服务缺席（含属性访问抛错）/ getTheme 不可调 / 抛错 /
 * 事件订阅不可用 → 缓存保持 undefined、不订阅、返回 no-op disposer，无报错。
 * 订阅不可用时不注入初始档：无实时跟随能力的快照会把面板永远钉死在装入时
 * 档位（宿主切主题后必然错档且无法纠正），宁可不注入交 dashboard 自身缺省。
 */
export function installThemeFollow(ctx: ThemeFollowContext): () => void {
  cachedScheme = undefined // 装入即重置：降级路径缓存恒 undefined，重装不残留旧值
  try {
    const theme = ctx?.theme
    if (theme === null || theme === undefined || typeof theme.getTheme !== 'function') return () => {}
    if (typeof ctx.on !== 'function') return () => {}
    let initial: ThemeScheme | undefined
    try {
      initial = schemeOf(theme.getTheme())
    } catch {
      return () => {} // getTheme 抛错（形状漂移）：按缺席降级
    }
    if (initial === undefined) return () => {} // 快照非白名单档：无可注入值，降级
    cachedScheme = initial
    const unsubscribe = ctx.on('theme/change', (snapshot) => {
      const scheme = schemeOf(snapshot)
      if (scheme === undefined) return // 白名单外值：缓存与广播均保持不变
      cachedScheme = scheme // 先刷新缓存再广播（晚挂载面板取最新档）
      broadcastTheme(scheme)
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
      cachedScheme = undefined
    }
  } catch {
    // ctx.theme 属性访问抛错（cordis proxy：服务未注入/未就绪）→ D4 降级。
    cachedScheme = undefined
    return () => {}
  }
}
