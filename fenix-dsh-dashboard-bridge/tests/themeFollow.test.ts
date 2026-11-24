/**
 * themeFollow 单测（SPEC add-bridge-theme-channel 任务 1.3）：
 * - 注册表挂载注销对称（在册才送达；注销后不再送达；重复注销幂等）；
 * - 广播形状与白名单（{kind:'fenix-theme', theme} 逐字节；targetOrigin=宿主
 *   window.location.origin）；
 * - 非法 colorScheme 不发（缓存维持 last-known-good）；
 * - 单窗口销毁不中断广播（抛错窗口跳过并摘除，其余窗口正常送达）；
 * - ctx.theme 缺席降级零注入（缺席/不可调/抛错/订阅不可用/属性访问抛错五路，
 *   buildPanelSrc 输出与既有契约逐字符一致）；
 * - 事件刷新缓存后新挂载面板注入最新档（先刷新缓存再广播）+ disposer 收口。
 */
import { describe, expect, it, vi } from 'vitest'
import { buildPanelSrc } from '../src/shared/config.js'
import {
  FENIX_THEME_KIND,
  broadcastTheme,
  currentThemeScheme,
  installThemeFollow,
  registerPanelWindow,
  unregisterPanelWindow,
} from '../src/client/themeFollow.js'
import type { ThemeFollowContext } from '../src/client/themeFollow.js'

/** postMessage 间谍的最小 Window 替身（node 环境无真实窗口）。 */
const fakeWindow = (): Window & { readonly postMessage: ReturnType<typeof vi.fn> } => {
  const postMessage = vi.fn()
  return { postMessage } as unknown as Window & { readonly postMessage: ReturnType<typeof vi.fn> }
}

/** 宿主 window.location.origin 桩（spec 钉 targetOrigin=宿主自身 origin）。 */
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

/** 快照桩（dsh-client-ui-theme ThemeSnapshot 最小形状，含白名单外漂移值）。 */
const snapshotOf = (colorScheme: unknown): { active: { colorScheme: unknown } } => ({
  active: { colorScheme },
})

describe('面板窗口注册表（挂载注销对称 + 广播闸）', () => {
  it('挂载注销对称：在册才送达；注销后不再送达；重复注销幂等', () => {
    const win = fakeWindow()
    registerPanelWindow(win)
    broadcastTheme('dark')
    expect(win.postMessage).toHaveBeenCalledTimes(1)
    unregisterPanelWindow(win)
    broadcastTheme('dark')
    expect(win.postMessage).toHaveBeenCalledTimes(1) // 注销后零送达（对称）
    expect(() => unregisterPanelWindow(win)).not.toThrow() // 幂等
  })

  it('广播形状与 targetOrigin：({kind:"fenix-theme", theme}, 宿主 origin) 逐字节', () => {
    const win = fakeWindow()
    registerPanelWindow(win)
    try {
      withHostOrigin('https://dsh.example', () => broadcastTheme('light'))
      expect(win.postMessage).toHaveBeenCalledTimes(1)
      expect(win.postMessage).toHaveBeenCalledWith(
        { kind: FENIX_THEME_KIND, theme: 'light' },
        'https://dsh.example',
      )
    } finally {
      unregisterPanelWindow(win)
    }
  })

  it('白名单外值不发：非法 colorScheme 零 postMessage（漂移值/undefined/误传快照整体）', () => {
    const win = fakeWindow()
    registerPanelWindow(win)
    try {
      broadcastTheme('sepia')
      broadcastTheme(undefined)
      broadcastTheme(snapshotOf('dark')) // 误传快照整体（应传 colorScheme 值）
      expect(win.postMessage).not.toHaveBeenCalled()
    } finally {
      unregisterPanelWindow(win)
    }
  })

  it('单窗口销毁不中断广播：抛错窗口跳过并摘除，其余窗口正常送达', () => {
    const dead = fakeWindow()
    dead.postMessage.mockImplementation(() => {
      throw new Error('target frame destroyed')
    })
    const live = fakeWindow()
    registerPanelWindow(dead)
    registerPanelWindow(live)
    try {
      expect(() => broadcastTheme('dark')).not.toThrow()
      expect(dead.postMessage).toHaveBeenCalledTimes(1)
      expect(live.postMessage).toHaveBeenCalledTimes(1)
      // 摘除后：后续广播只发在册窗口（抛错窗口不重复失败）。
      broadcastTheme('dark')
      expect(dead.postMessage).toHaveBeenCalledTimes(1)
      expect(live.postMessage).toHaveBeenCalledTimes(2)
    } finally {
      unregisterPanelWindow(dead)
      unregisterPanelWindow(live)
    }
  })

  it('contentWindow 缺席（null/undefined）登记/注销零动作、无未处理异常', () => {
    expect(() => {
      registerPanelWindow(null as unknown as Window)
      unregisterPanelWindow(null)
      unregisterPanelWindow(undefined)
    }).not.toThrow()
  })
})

describe('installThemeFollow（快照缓存 + 订阅 + 降级）', () => {
  it('快照装入即缓存；事件先刷新缓存再广播；晚挂载面板注入最新档；disposer 退订+清缓存', () => {
    const win = fakeWindow()
    registerPanelWindow(win)
    const listeners: Array<(snapshot: unknown) => void> = []
    const stop = installThemeFollow({
      theme: { getTheme: () => snapshotOf('light') },
      on: (_event, listener) => {
        listeners.push(listener)
        return () => {
          listeners.length = 0
        }
      },
    })
    expect(currentThemeScheme()).toBe('light') // 装入时快照即缓存（首帧即对）

    listeners[0]?.(snapshotOf('dark')) // 宿主切换 theme/change
    expect(currentThemeScheme()).toBe('dark') // 先刷新缓存
    expect(win.postMessage).toHaveBeenCalledTimes(1)
    expect(win.postMessage).toHaveBeenCalledWith(
      { kind: FENIX_THEME_KIND, theme: 'dark' },
      expect.any(String), // 再广播（origin 形状已在他例钉值）
    )

    // 晚于宿主切换的新挂载面板：初始注入档=最新缓存档（评审 2026-11-24）。
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects', currentThemeScheme())).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/projects',
    )

    stop()
    expect(currentThemeScheme()).toBeUndefined() // 缓存清零
    expect(listeners).toHaveLength(0) // 宿主事件总线已退订
    expect(win.postMessage).toHaveBeenCalledTimes(1) // 退订后零新增广播
    unregisterPanelWindow(win)
  })

  it('D4 降级：ctx.theme 缺席 / getTheme 不可调 / 抛错 / 订阅不可用 → 缓存 undefined 零注入、无报错', () => {
    const degraded: readonly ThemeFollowContext[] = [
      {}, // ctx.theme 缺席（旧版宿主）
      { theme: {} }, // getTheme 不可调
      { theme: { getTheme: () => { throw new Error('snapshot shape drift') } } }, // getTheme 抛错
      { theme: { getTheme: () => snapshotOf('dark') } }, // 事件订阅不可用（不注入易错死档）
    ]
    degraded.forEach((ctx, index) => {
      const stop = installThemeFollow(ctx)
      expect(currentThemeScheme(), `降级路 ${index} 缓存应为 undefined`).toBeUndefined()
      // 零注入：三参透传 undefined 缓存 → 输出与既有契约逐字符一致。
      expect(buildPanelSrc('/fenix-dashboard/', '#/overview', currentThemeScheme())).toBe(
        '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview',
      )
      expect(() => stop()).not.toThrow()
      expect(() => stop()).not.toThrow() // disposer 幂等
    })
  })

  it('ctx.theme 属性访问抛错（cordis proxy：服务未注入/未就绪）→ D4 降级零报错', () => {
    const hostile = {
      get theme(): undefined {
        throw new Error('cannot get property "theme" without inject')
      },
    }
    const stop = installThemeFollow(hostile)
    expect(currentThemeScheme()).toBeUndefined()
    expect(() => stop()).not.toThrow()
  })

  it('白名单外快照档：装入与事件均不驱动缓存/广播（last-known-good 保持不变）', () => {
    const win = fakeWindow()
    registerPanelWindow(win)
    const listeners: Array<(snapshot: unknown) => void> = []
    const stop = installThemeFollow({
      theme: { getTheme: () => snapshotOf('light') },
      on: (_event, listener) => {
        listeners.push(listener)
        return () => {}
      },
    })
    expect(currentThemeScheme()).toBe('light')
    listeners[0]?.(snapshotOf('sepia')) // 白名单外：不发不刷
    expect(currentThemeScheme()).toBe('light') // 已挂载面板主题保持不变
    expect(win.postMessage).not.toHaveBeenCalled()
    stop()
    expect(currentThemeScheme()).toBeUndefined()
    unregisterPanelWindow(win)
  })
})
