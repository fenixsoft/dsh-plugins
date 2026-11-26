/**
 * client/hostFollow 宿主偏好跟随测试：白名单归一、运行时 inject 子上下文
 * 装配（回调直发 + dispose 双层收口）、inject 缝缺失自守（空句柄不抛错）。
 */
import { describe, expect, it, vi } from 'vitest'
import { installHostUiFollow, normalizeLocale, normalizeTheme } from '../src/client/hostFollow.js'

/** 构造运行时 inject 缝桩：记录 deps，回调同步执行并返回可 dispose 句柄。 */
function makeInjector() {
  const calls: string[][] = []
  const stops: Array<() => void> = []
  const inject = (deps: string[], callback: (scoped: unknown) => unknown): { dispose: () => void } => {
    calls.push([...deps])
    const stop = callback({}) as (() => void) | undefined
    if (typeof stop === 'function') stops.push(stop)
    return { dispose: () => stops.splice(0).forEach((s) => s()) }
  }
  return { inject, calls, stops }
}

describe('normalizeLocale / normalizeTheme 白名单', () => {
  it('locale 归一：en/en-US/en_US → en；zh/zh-CN → zh；其余 undefined', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('en_us')).toBe('en')
    expect(normalizeLocale('zh')).toBe('zh')
    expect(normalizeLocale('zh-CN')).toBe('zh')
    expect(normalizeLocale('fr')).toBeUndefined()
    expect(normalizeLocale(42)).toBeUndefined()
  })

  it('theme 归一：dark/light；其余 undefined', () => {
    expect(normalizeTheme('dark')).toBe('dark')
    expect(normalizeTheme('LIGHT')).toBe('light')
    expect(normalizeTheme('sepia')).toBeUndefined()
    expect(normalizeTheme(null)).toBeUndefined()
  })
})

describe('installHostUiFollow 运行时 inject 装配', () => {
  it('两通道各声明一次（locale/theme），快照值即发回调', () => {
    const injector = makeInjector()
    const onLocale = vi.fn()
    const onTheme = vi.fn()
    // scoped ctx：locale 快照 en + theme 快照 dark（read 走可选链自守）。
    injector.inject = ((deps: string[], callback: (scoped: unknown) => unknown) => {
      calls.push([...deps])
      const scoped = deps[0] === 'locale' ? { locale: { getSnapshot: () => ({ active: 'en' }) } } : { theme: { getTheme: () => ({ active: { colorScheme: 'dark' } }) } }
      callback(scoped)
      return { dispose: () => {} }
    }) as typeof injector.inject
    const calls: string[][] = injector.calls
    const follow = installHostUiFollow({ inject: injector.inject }, { onLocale, onTheme })
    expect(calls).toEqual([['locale'], ['theme']])
    expect(onLocale).toHaveBeenCalledWith('en')
    expect(onTheme).toHaveBeenCalledWith('dark')
    follow.dispose()
  })

  it('ctx 无 inject 缝 → 空句柄自守，dispose 幂等不抛', () => {
    const follow = installHostUiFollow({}, { onLocale: vi.fn(), onTheme: vi.fn() })
    expect(() => follow.dispose()).not.toThrow()
    expect(() => follow.dispose()).not.toThrow()
  })

  it('dispose 收口：停子插件（channel.dispose）+ disposer（clearInterval）双层', () => {
    let disposed = 0
    const timers: ReturnType<typeof setInterval>[] = []
    const realSetInterval = globalThis.setInterval
    const inject = (deps: string[], callback: (scoped: unknown) => unknown): { dispose: () => void } => {
      // 拦截 setInterval：捕获定时器句柄，避免真实 1s 轮询残留。
      const scoped = deps[0] === 'locale'
        ? { locale: { getSnapshot: () => ({ active: 'zh' }) } }
        : { theme: { getTheme: () => ({ active: { colorScheme: 'light' } }) } }
      globalThis.setInterval = ((fn: () => void, ms?: number) => {
        const t = realSetInterval(fn, (ms ?? 1000) * 1000)
        timers.push(t)
        return t
      }) as typeof setInterval
      const stop = callback(scoped) as () => void
      globalThis.setInterval = realSetInterval
      return {
        dispose: () => {
          disposed += 1
          stop()
        },
      }
    }
    const follow = installHostUiFollow({ inject }, { onLocale: vi.fn(), onTheme: vi.fn() })
    follow.dispose()
    expect(disposed).toBe(2)
    for (const t of timers) clearInterval(t)
    // 幂等。
    expect(() => follow.dispose()).not.toThrow()
  })

  it('快照形状漂移（getSnapshot 缺失/抛错）→ 不回调不抛', () => {
    const inject = (deps: string[], callback: (scoped: unknown) => unknown): { dispose: () => void } => {
      const scoped = deps[0] === 'locale' ? { locale: {} } : { theme: { getTheme: () => { throw new Error('boom') } } }
      expect(() => callback(scoped)).not.toThrow()
      return { dispose: () => {} }
    }
    const follow = installHostUiFollow({ inject }, { onLocale: vi.fn(), onTheme: vi.fn() })
    follow.dispose()
  })
})
