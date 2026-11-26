/**
 * 宿主 UI 偏好跟随（语言档 + 深浅色主题）：client 半消费 dsh 宿主 locale/theme
 * 服务，把快照值经回调交给装配层（入口按钮文案 + iframe 页 postMessage 通道）。
 *
 * 服务闸形态（fenix i18n 轮实证结论，与 dashboard-bridge / auth / chat-polish
 * 同款）：cordis 客户端插件只能访问自己 inject 声明过的服务——**静态** inject
 * 声明（模块导出对象 inject 数组）是激活 fence：宿主缺该服务时插件激活永久
 * pending（整个 client 插件死），故禁止静态声明 locale/theme；**运行时**
 * ctx.inject(deps, callback)（cordis 子插件形态）让子 fiber 持自己的声明——
 * 服务已存在则回调立即执行，late provide 由 cordis 原生 pending→激活处理，
 * 回调返回函数即 apply disposer（随父 fiber 卸载级联）。1s 轮询为无害兜底
 * （服务闸已开时快照读取不再抛错；重复 adopt 同值幂等）。
 *
 * 宿主缺 inject 缝（老宿主/测试桩 ctx={}）→ 整体跳过（返回空句柄），装配层
 * 走页面自守默认（zh + light），不抛错——宁缺毋错降级口径与 localeFollow 同。
 */

/** 运行时 inject 子上下文缝（cordis Context.inject(deps, callback) 形态子集）。 */
interface HostInjectContext {
  inject(deps: string[], callback: (scoped: unknown) => unknown): { dispose(): void | Promise<void> }
}

/** 语言档白名单归一（宿主快照 active 形态：'zh'/'en'，容忍区域后缀变体）。 */
export function normalizeLocale(value: unknown): 'zh' | 'en' | undefined {
  if (typeof value !== 'string') return undefined
  const lower = value.toLowerCase()
  if (lower === 'en' || lower === 'en-us' || lower === 'en_us') return 'en'
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh_cn') return 'zh'
  return undefined
}

/** 主题白名单归一（dsh-client-theme active.colorScheme 形态：'dark'/'light'）。 */
export function normalizeTheme(value: unknown): 'dark' | 'light' | undefined {
  if (typeof value !== 'string') return undefined
  const lower = value.toLowerCase()
  if (lower === 'dark') return 'dark'
  if (lower === 'light') return 'light'
  return undefined
}

/** locale 服务快照读取（scoped ctx.locale.getSnapshot().active；缝漂移自守）。 */
function readLocale(scoped: unknown): 'zh' | 'en' | undefined {
  try {
    const service = (scoped as { locale?: unknown }).locale
    if (service === null || typeof service !== 'object') return undefined
    const getSnapshot = (service as { getSnapshot?: unknown }).getSnapshot
    if (typeof getSnapshot !== 'function') return undefined
    const snapshot = (getSnapshot as (this: unknown) => unknown).call(service)
    if (snapshot === null || typeof snapshot !== 'object') return undefined
    return normalizeLocale((snapshot as { active?: unknown }).active)
  } catch {
    return undefined
  }
}

/** theme 服务快照读取（scoped ctx.theme.getTheme()?.active?.colorScheme）。 */
function readTheme(scoped: unknown): 'dark' | 'light' | undefined {
  try {
    const service = (scoped as { theme?: unknown }).theme
    if (service === null || typeof service !== 'object') return undefined
    const getTheme = (service as { getTheme?: unknown }).getTheme
    if (typeof getTheme !== 'function') return undefined
    const theme = (getTheme as (this: unknown) => unknown).call(service)
    if (theme === null || typeof theme !== 'object') return undefined
    const active = (theme as { active?: unknown }).active
    if (active === null || typeof active !== 'object') return undefined
    return normalizeTheme((active as { colorScheme?: unknown }).colorScheme)
  } catch {
    return undefined
  }
}

export interface HostUiFollowHandlers {
  /** 语言档落定（仅值变化时回调）。 */
  onLocale(locale: 'zh' | 'en'): void
  /** 主题落定（仅值变化时回调）。 */
  onTheme(theme: 'dark' | 'light'): void
}

export interface HostUiFollowHandle {
  /** 退订轮询与事件订阅、停子插件（幂等）。 */
  dispose(): void
}

/** late provide 兜底轮询周期（ms）——服务闸已开时读取不抛错，重复读幂等。 */
const POLL_MS = 1000

/**
 * 装配宿主 UI 偏好跟随（locale + theme 两通道独立，互不绑定）。
 * @param ctx - client 插件根 ctx（宿主运行时提供；测试桩可为任意值）。
 * @returns 句柄（dispose 幂等；ctx 无 inject 缝时为空操作句柄）。
 */
export function installHostUiFollow(ctx: unknown, handlers: HostUiFollowHandlers): HostUiFollowHandle {
  const stops: Array<() => void> = []
  let injector: HostInjectContext['inject'] | undefined
  try {
    const candidate = (ctx as { inject?: unknown } | null)?.inject
    if (typeof candidate === 'function') injector = candidate.bind(ctx) as HostInjectContext['inject']
  } catch {
    injector = undefined
  }
  if (injector === undefined) {
    return { dispose: () => {} }
  }
  /**
   * 单通道：运行时 inject 声明 deps → 子 fiber 内 adopt（快照读 + 事件订阅
   * + 轮询兜底），值变化即回调。inject 缝抛错/缺 dispose → 通道静默放弃。
   */
  const start = <T extends string>(
    deps: string[],
    eventName: string,
    read: (scoped: unknown) => T | undefined,
    fire: (value: T) => void,
  ): void => {
    try {
      const channel = injector!(deps, (scoped) => {
        let current: T | undefined
        const adopt = (): void => {
          try {
            const next = read(scoped)
            if (next !== undefined && next !== current) {
              current = next
              fire(next)
            }
          } catch {
            // 快照读取抛错（服务中途摘除等）：保持当前值，下轮轮询重试。
          }
        }
        adopt()
        const timer = setInterval(adopt, POLL_MS)
        let offChange: (() => void) | undefined
        try {
          const on = (scoped as { on?: unknown }).on
          if (typeof on === 'function') {
            const off = (on as (event: string, listener: () => void) => unknown).call(scoped, eventName, adopt)
            if (typeof off === 'function') offChange = off as () => void
          }
        } catch {
          // 事件订阅缝缺失：轮询兜底已覆盖（1s 内跟随）。
        }
        // cordis 对象形态 apply disposer 约定：父 fiber 卸载时级联调用。
        return () => {
          clearInterval(timer)
          offChange?.()
        }
      })
      // channel.dispose = 停子插件（与回调返回的 disposer 二层；两层都接，
      // 幂等双保险——cordis 对已停 fiber 的重复 stop 自守）。
      if (channel !== null && typeof channel === 'object' && typeof (channel as { dispose?: unknown }).dispose === 'function') {
        const dispose = (channel as { dispose: () => void | Promise<void> }).dispose
        stops.push(() => {
          try {
            void dispose()
          } catch {
            // 停通道抛错（宿主先拆等）：dispose 链继续。
          }
        })
      }
    } catch {
      // inject 缝抛错（宿主形态漂移）：通道放弃，页面走自守默认。
    }
  }
  start(['locale'], 'locale/change', readLocale, handlers.onLocale)
  start(['theme'], 'theme/change', readTheme, handlers.onTheme)
  return {
    dispose: () => {
      for (const stop of stops.splice(0)) {
        try {
          stop()
        } catch {
          // 单通道停止抛错不影响其余通道收口。
        }
      }
    },
  }
}
