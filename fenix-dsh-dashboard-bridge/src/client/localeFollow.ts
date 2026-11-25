/**
 * 宿主语言跟随通道（i18n 宿主跟随轮）：iframe 嵌入态语言跟随的宿主半——
 * 初始档注入（三挂载点经 currentLocaleScheme 同步取模块级缓存，作
 * buildPanelSrc 第四参拼 `&locale=<档>`）+ 实时广播（订阅宿主
 * `ctx.on("locale/change")`，向全部在册 iframe contentWindow postMessage
 * `{kind:'fenix-locale', locale:'zh-CN'|'en-US'}`，与 fenixd 仓
 * core/dashboard/static/src/utils/localeChannel.ts 的 iframe 侧契约逐字节
 * 镜像，结构镜像 themeFollow.ts 先例）。
 *
 * 形状（themeFollow 同构）：
 * - 模块级快照缓存：installLocaleFollow 装入时读 `ctx.locale.getSnapshot()`
 *   落缓存；locale/change 事件**先刷新缓存再广播**——右缘页签首次打开、项目
 *   面板新注册等「晚于宿主切换」的挂载从缓存取初始注入档，只广播不刷新缓存
 *   则这些面板首帧错档且无后续广播可补。缓存随每次事件刷新，注入档 SHALL 为
 *   宿主最近档而非插件安装时快照。
 * - 注册表：与主题跟随共享同一 panelWindows 集合（themeFollow.ts 导出），
 *   广播仅发在册窗口（成员资格为唯一发送闸），单窗口 postMessage 抛错跳过
 *   并摘除，不中断其余窗口。
 * - 降级（themeFollow D4 同款）：ctx.locale 缺席 / getSnapshot 不可调 / 事件
 *   订阅不可用 → 缓存 undefined（buildPanelSrc 第四参不传，输出与现状逐字符
 *   一致）、不订阅、广播空转，无报错。降级面收敛在本模块，其它模块不感知
 *   语言能力存在与否。注意 cordis proxy 对缺失服务属性访问会抛错（`cannot
 *   get property "locale" without inject`），故 ctx.locale / 事件订阅读取
 *   全部在 try/catch 内。
 *
 * 白名单口径：宿主快照 active 经 normalizeLocaleScheme 映射（'zh'→'zh-CN'、
 * 'en'→'en-US'），白名单外值既不刷新缓存也不广播（缓存维持 last-known-good）。
 */
import { normalizeLocaleScheme } from '../shared/config.js'
import type { LocaleScheme } from '../shared/config.js'
import { broadcastOrigin, panelWindows } from './themeFollow.js'
import { setPluginLocale } from './pluginLocale.js'

/** host→iframe 语言消息 kind 常量（dashboard 侧镜像值：fenixd 仓
 * core/dashboard/static/src/utils/localeChannel.ts 的 LOCALE_MESSAGE_KIND——
 * 双仓字面量必须逐字节一致，任一侧改动必改另一侧，两侧单测各自钉值）。 */
export const FENIX_LOCALE_KIND = 'fenix-locale'

/** 宿主语言快照最小消费面（dsh-client-locale LocaleSnapshot 子集；仅列本
 * 模块读取的键，形状漂移按 undefined 降级）。 */
export interface LocaleSnapshotLike {
  readonly active?: unknown
}

/** 宿主语言服务最小消费面（dsh-client-locale LocaleRuntime 子集）。 */
export interface LocaleServiceLike {
  readonly getSnapshot?: () => LocaleSnapshotLike | undefined
}

/** installLocaleFollow 的 ctx 最小消费面（宿主 ctx 子集；测试桩按形状构造，
 * 两键均缺席 → 降级）。listener 参数取 unknown 宽面（与 dsh-runtime.d.ts
 * 的 Context.on seam 严格匹配），快照形状收窄在 localeOf 内联完成。 */
export interface LocaleFollowContext {
  /** dsh-client-locale 服务（旧版宿主缺席；属性访问抛错按缺席降级）。 */
  readonly locale?: LocaleServiceLike
  /** cordis 事件订阅（返回退订 disposer）；不可用 → 不订阅（降级）。 */
  on?(event: 'locale/change', listener: (snapshot: unknown) => void): unknown
}

/* ================== 模块级快照缓存（挂载点同步取初始档） ================== */

let cachedLocale: LocaleScheme | undefined = undefined

/**
 * 当前宿主语言档缓存：三挂载点同步取初始注入档（undefined = 降级不注入，
 * buildPanelSrc 第四参不传）。缓存随每次 locale/change 事件刷新——晚于宿主
 * 切换的挂载注入的即宿主最近档。
 */
export function currentLocaleScheme(): LocaleScheme | undefined {
  return cachedLocale
}

/**
 * 快照 → 白名单档（事件 listener 的 unknown 宽面在此收窄；非对象快照/形状
 * 漂移一律 undefined）。
 */
function localeOf(snapshot: unknown): LocaleScheme | undefined {
  if (snapshot === null || snapshot === undefined || typeof snapshot !== 'object') return undefined
  return normalizeLocaleScheme((snapshot as LocaleSnapshotLike).active)
}

/**
 * 语言跟随装配（插件 client 启动时调用一次，接入点与 installThemeFollow
 * 相邻且同序——buildPanelSrc 拼串是注册期同步取缓存，接入点 MUST 先于项目
 * 同步注册，themeFollow D3 同款纪律）：读宿主快照落模块级缓存 → 订阅
 * locale/change（处理序：先刷新缓存再广播）→ 返回 disposer（退订 + 缓存
 * 清零）随插件清理链路执行。
 *
 * 降级：locale 服务缺席（含属性访问抛错）/ getSnapshot 不可调 / 抛错 /
 * 事件订阅不可用 → 缓存保持 undefined、不订阅、返回 no-op disposer，无报错。
 * 订阅不可用时不注入初始档：无实时跟随能力的快照会把面板永远钉死在装入时
 * 档位（宿主切语言后必然错档且无法纠正），宁可不注入交 dashboard 自身缺省。
 */
export function installLocaleFollow(ctx: LocaleFollowContext): () => void {
  cachedLocale = undefined // 装入即重置：降级路径缓存恒 undefined，重装不残留旧值
  try {
    const localeService = ctx?.locale
    if (localeService === null || localeService === undefined || typeof localeService.getSnapshot !== 'function') {
      return () => {}
    }
    if (typeof ctx.on !== 'function') return () => {}
    let initial: LocaleScheme | undefined
    try {
      initial = localeOf(localeService.getSnapshot())
    } catch {
      return () => {} // getSnapshot 抛错（形状漂移）：按缺席降级
    }
    if (initial === undefined) return () => {} // 快照非白名单档：无可注入值，降级
    cachedLocale = initial
    setPluginLocale(initial) // 插件自绘控件文案（tooltip/菜单）跟随宿主档
    const unsubscribe = ctx.on('locale/change', (snapshot) => {
      const loc = localeOf(snapshot)
      if (loc === undefined) return // 白名单外值：缓存与广播均保持不变
      cachedLocale = loc // 先刷新缓存再广播（晚挂载面板取最新档）
      setPluginLocale(loc) // 插件文案档同步刷新
      broadcastLocale(loc)
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
      cachedLocale = undefined
    }
  } catch {
    // ctx.locale 属性访问抛错（cordis proxy：服务未注入/未就绪）→ 降级。
    cachedLocale = undefined
    return () => {}
  }
}

/**
 * 向全部在册 iframe 窗口广播语言档：白名单映射（其它值不发）；消息形状
 * `{kind:'fenix-locale', locale:'zh-CN'|'en-US'}`；仅发在册窗口（成员资格为
 * 唯一发送闸），单窗口 postMessage 抛错（已销毁）跳过并从注册表摘除，不
 * 中断其余广播、无未捕获异常。注册表/targetOrigin 与主题广播共享单源
 * （themeFollow.panelWindows / broadcastOrigin）。
 */
export function broadcastLocale(locale: unknown): void {
  const loc = normalizeLocaleScheme(locale)
  if (loc === undefined) return
  const message = { kind: FENIX_LOCALE_KIND, locale: loc }
  const origin = broadcastOrigin()
  for (const win of Array.from(panelWindows)) {
    try {
      win.postMessage(message, origin)
    } catch {
      panelWindows.delete(win) // 已销毁窗口：跳过并摘除，防逐轮重复失败
    }
  }
}
