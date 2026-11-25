/**
 * localeFollow 单测（i18n 宿主跟随轮；结构镜像 themeFollow.test.ts）：
 * - 广播形状与白名单（{kind:'fenix-locale', locale:'zh-CN'|'en-US'} 逐字节；
 *   宿主 'zh'|'en' → fenix 档映射；白名单外不发且缓存 last-known-good）；
 * - 注册表与主题跟随共享单源（同一 panelWindows 集合，双通道广播一致送达）；
 * - 快照装入即缓存；事件先刷新缓存再广播；晚挂载面板注入最新档；disposer
 *   退订 + 清缓存；
 * - D4 降级五路（locale 缺席 / getSnapshot 不可调 / 抛错 / 订阅不可用 /
 *   属性访问抛错）→ 缓存 undefined、buildPanelSrc 第四参不传输出零变化；
 * - 快照非白名单档 → 不注入不订阅（无实时跟随能力的快照宁可不注入）。
 */
import { describe, expect, it, vi } from 'vitest'
import { buildPanelSrc } from '../src/shared/config.js'
import {
  FENIX_LOCALE_KIND,
  broadcastLocale,
  currentLocaleScheme,
  installLocaleFollow,
} from '../src/client/localeFollow.js'
import { registerPanelWindow, unregisterPanelWindow } from '../src/client/themeFollow.js'
import type { LocaleFollowContext } from '../src/client/localeFollow.js'

/** postMessage 间谍的最小 Window 替身（node 环境无真实窗口）。 */
const fakeWindow = (): Window & { readonly postMessage: ReturnType<typeof vi.fn> } => {
  const postMessage = vi.fn()
  return { postMessage } as unknown as Window & { readonly postMessage: ReturnType<typeof vi.fn> }
}

/** 宿主 window.location.origin 桩（与主题广播同一 targetOrigin 口径）。 */
function withHostOrigin<T>(origin: string, run: () => T): T {
  const holder = globalThis as { window?: unknown }
  const original = holder.window
  holder.window = { location: { origin } }
  try {
    return run()
  } finally {
    holder.window = original
  }
}

/** 快照桩（dsh-client-locale LocaleSnapshot 最小形状，含漂移值位）。 */
const snapshotOf = (active: unknown): { active: unknown } => ({ active })

/** ctx 桩：getSnapshot 返回给定快照、on 记录 listener 并返回退订间谍。 */
function ctxOf(initial: unknown): LocaleFollowContext & {
  readonly listeners: Array<(snapshot: unknown) => void>
  readonly unsubscribe: ReturnType<typeof vi.fn>
} {
  const listeners: Array<(snapshot: unknown) => void> = []
  const unsubscribe = vi.fn()
  return {
    locale: { getSnapshot: () => snapshotOf(initial) },
    on: ((_event: unknown, listener: (snapshot: unknown) => void) => {
      listeners.push(listener)
      return unsubscribe
    }) as LocaleFollowContext['on'],
    listeners,
    unsubscribe,
  }
}

describe('语言广播（形状 / 白名单 / 映射）', () => {
  it('广播形状与 targetOrigin：({kind:"fenix-locale", locale}, 宿主 origin) 逐字节', () => {
    const win = fakeWindow()
    registerPanelWindow(win)
    try {
      withHostOrigin('http://127.0.0.1:3080', () => broadcastLocale('en-US'))
      expect(win.postMessage).toHaveBeenCalledTimes(1)
      expect(win.postMessage).toHaveBeenCalledWith({ kind: FENIX_LOCALE_KIND, locale: 'en-US' }, 'http://127.0.0.1:3080')
    } finally {
      unregisterPanelWindow(win)
    }
  })

  it('宿主原始值映射：zh→zh-CN、en→en-US 均可广播；白名单外值不发', () => {
    const win = fakeWindow()
    registerPanelWindow(win)
    try {
      broadcastLocale('zh')
      expect(win.postMessage).toHaveBeenCalledWith({ kind: FENIX_LOCALE_KIND, locale: 'zh-CN' }, expect.any(String))
      broadcastLocale('en')
      expect(win.postMessage).toHaveBeenCalledWith({ kind: FENIX_LOCALE_KIND, locale: 'en-US' }, expect.any(String))
      const count = win.postMessage.mock.calls.length
      broadcastLocale('ja')
      broadcastLocale(undefined)
      broadcastLocale({ active: 'zh' }) // 误传快照整体
      expect(win.postMessage).toHaveBeenCalledTimes(count)
    } finally {
      unregisterPanelWindow(win)
    }
  })

  it('注册表与主题跟随共享单源：同一窗口登记后主题/语言广播均送达', async () => {
    const { broadcastTheme } = await import('../src/client/themeFollow.js')
    const win = fakeWindow()
    registerPanelWindow(win)
    try {
      withHostOrigin('http://127.0.0.1:3080', () => {
        broadcastTheme('dark')
        broadcastLocale('zh-CN')
      })
      expect(win.postMessage).toHaveBeenCalledTimes(2)
    } finally {
      unregisterPanelWindow(win)
    }
  })

  it('单窗口销毁不中断广播：抛错窗口跳过并摘除，其余窗口正常送达', () => {
    const broken = fakeWindow()
    broken.postMessage.mockImplementation(() => {
      throw new Error('destroyed frame')
    })
    const healthy = fakeWindow()
    registerPanelWindow(broken)
    registerPanelWindow(healthy)
    try {
      expect(() => withHostOrigin('http://127.0.0.1:3080', () => broadcastLocale('en-US'))).not.toThrow()
      expect(healthy.postMessage).toHaveBeenCalledTimes(1)
      broadcastLocale('en-US') // 摘除后重播：broken 不再收到（注册表已剔除）
      expect(healthy.postMessage).toHaveBeenCalledTimes(2)
    } finally {
      unregisterPanelWindow(broken)
      unregisterPanelWindow(healthy)
    }
  })
})

describe('installLocaleFollow（缓存 / 事件 / 降级）', () => {
  it('快照装入即缓存（宿主 zh→fenix 档）；事件先刷新缓存再广播；晚挂载注入最新档；disposer 退订+清缓存', () => {
    const ctx = ctxOf('zh')
    const stop = installLocaleFollow(ctx)
    expect(currentLocaleScheme()).toBe('zh-CN')
    expect(ctx.listeners).toHaveLength(1)

    const win = fakeWindow()
    registerPanelWindow(win)
    try {
      ctx.listeners[0]!(snapshotOf('en')) // 宿主切英文：先刷新缓存再广播
      expect(currentLocaleScheme()).toBe('en-US')
      expect(win.postMessage).toHaveBeenCalledWith({ kind: FENIX_LOCALE_KIND, locale: 'en-US' }, expect.any(String))
      // 晚挂载面板（注册期拼串）注入最新档
      expect(buildPanelSrc('/fenix-dashboard/', '#/projects', undefined, currentLocaleScheme())).toBe(
        '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&locale=en-US#/projects',
      )
    } finally {
      unregisterPanelWindow(win)
    }
    stop()
    expect(ctx.unsubscribe).toHaveBeenCalledTimes(1)
    expect(currentLocaleScheme()).toBeUndefined() // 缓存清零
  })

  it('buildPanelSrc 第四参：白名单档拼 &locale= 段（theme 段之后、hash 之前）；缺席/白名单外零变化', () => {
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects', 'dark', 'en-US')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark&locale=en-US#/projects',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects', undefined, 'zh-CN')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&locale=zh-CN#/projects',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects', undefined, 'ja')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects', 'light', 'zh')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=light&locale=zh-CN#/projects',
    )
  })

  it('D4 降级：locale 缺席 / getSnapshot 不可调 / 抛错 / 订阅不可用 → 缓存 undefined 零注入、无报错', () => {
    expect(installLocaleFollow({}).call).toBeTypeOf('function') // 缺席服务 → no-op disposer
    expect(currentLocaleScheme()).toBeUndefined()
    expect(installLocaleFollow({ locale: {} } as unknown as LocaleFollowContext)).toBeTypeOf('function')
    expect(
      installLocaleFollow({ locale: { getSnapshot: () => undefined } } as unknown as LocaleFollowContext),
    ).toBeTypeOf('function')
    expect(
      installLocaleFollow({
        locale: {
          getSnapshot: () => {
            throw new Error('shape drift')
          },
        },
        on: () => 'x',
      } as unknown as LocaleFollowContext),
    ).toBeTypeOf('function')
    expect(
      installLocaleFollow({ locale: { getSnapshot: () => snapshotOf('zh') } } as unknown as LocaleFollowContext),
    ).toBeTypeOf('function') // 订阅不可用：不注入（宁缺毋错）
    expect(currentLocaleScheme()).toBeUndefined()
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview', 'dark', currentLocaleScheme())).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/overview',
    )
  })

  it('ctx.locale 属性访问抛错（cordis proxy：服务未注入/未就绪）→ 降级零报错', () => {
    const hostile = new Proxy(
      {},
      {
        get(): never {
          throw new Error('cannot get property "locale" without inject')
        },
      },
    )
    expect(() => installLocaleFollow(hostile as unknown as LocaleFollowContext)).not.toThrow()
    expect(currentLocaleScheme()).toBeUndefined()
  })

  it('白名单外快照档：终局降级不订阅（宁缺毋错）；后续独立装入不受影响', () => {
    const ctx = ctxOf('ja') // 装入快照即漂移：非空但非白名单 → 坏值终局降级
    const stop = installLocaleFollow(ctx)
    expect(currentLocaleScheme()).toBeUndefined()
    expect(ctx.listeners).toHaveLength(0) // 终局降级：不订阅、不再轮询
    stop()
    // 独立装入正常档不受前例影响
    const ctx2 = ctxOf('en')
    const stop2 = installLocaleFollow(ctx2)
    expect(currentLocaleScheme()).toBe('en-US')
    ctx2.listeners[0]!(snapshotOf('ko')) // 事件发漂移值：缓存维持 last-known-good
    expect(currentLocaleScheme()).toBe('en-US')
    stop2()
  })

  it('late provide：装入时 locale 缺席 → 轮询等服务注入后正常接档（真实宿主时序）', async () => {
    vi.useFakeTimers()
    try {
      const listeners: Array<(snapshot: unknown) => void> = []
      const ctx: LocaleFollowContext = {
        // 初始缺席（插件同步 apply 时 locale 服务尚未 provide）
        on: ((_event: unknown, listener: (snapshot: unknown) => void) => {
          listeners.push(listener)
          return () => {}
        }) as LocaleFollowContext['on'],
      }
      const stop = installLocaleFollow(ctx)
      expect(currentLocaleScheme()).toBeUndefined() // 未就绪：不误降级
      // 1s 后 locale 服务 provide（late provide），快照 active 就绪
      ;(ctx as { locale?: LocaleFollowContext['locale'] }).locale = {
        getSnapshot: () => snapshotOf('en'),
      }
      await vi.advanceTimersByTimeAsync(1100)
      expect(currentLocaleScheme()).toBe('en-US') // 轮询接入成功
      expect(listeners).toHaveLength(1) // 事件订阅也接上
      stop()
      expect(currentLocaleScheme()).toBeUndefined() // 收口清缓存
    } finally {
      vi.useRealTimers()
    }
  })

  it("早期空快照（active 为空串）：不终局，等服务回同步后接档", async () => {
    vi.useFakeTimers()
    try {
      let active: unknown = ''
      const listeners: Array<(snapshot: unknown) => void> = []
      const ctx: LocaleFollowContext = {
        locale: { getSnapshot: () => snapshotOf(active) },
        on: ((_event: unknown, listener: (snapshot: unknown) => void) => {
          listeners.push(listener)
          return () => {}
        }) as LocaleFollowContext['on'],
      }
      const stop = installLocaleFollow(ctx)
      expect(currentLocaleScheme()).toBeUndefined() // 空档：等
      active = 'zh' // settings 回同步
      await vi.advanceTimersByTimeAsync(1100)
      expect(currentLocaleScheme()).toBe('zh-CN')
      expect(listeners).toHaveLength(1)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
