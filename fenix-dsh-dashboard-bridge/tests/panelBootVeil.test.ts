/**
 * 启动遮罩（dashboard-loading-veil，2026-11-25 用户反馈）单测：
 * DashboardPanel 元素树携带遮罩标记态初始显示、CSS 合同（类名/变量口径/
 * keyframes/reduced-motion）、wireBootVeil 状态机（接线显→load 隐→src 深链
 * 换页显→解线摘监听断观察器）。node 环境纯对象桩，MutationObserver 经
 * observeSrcAttr 缝注入。
 */
import { describe, expect, it } from 'vitest'
import {
  BOOT_VEIL_CLASS,
  DashboardPanel,
  PANEL_BOOT_VEIL_CSS,
  wireBootVeil,
} from '../src/client/panels.js'
import type { BootVeilIframeLike, BootVeilVeilLike } from '../src/client/panels.js'

/* ============ 元素树桩（无 DOM，照 srcContract.test.ts ElementLike 风格） ============ */

interface ElementLike {
  readonly type?: unknown
  readonly props?: { readonly [key: string]: unknown }
}

const asElement = (node: unknown): ElementLike => node as ElementLike

const kidsOf = (el: ElementLike): ElementLike[] => {
  const children = el.props?.children
  return (Array.isArray(children) ? children : [children]).map(asElement)
}

const findByClass = (nodes: ElementLike[], className: string): ElementLike | undefined =>
  nodes.find((node) => node.props?.className === className)

/** 记录型 iframe 桩：load 监听可手动触发，计数可见。 */
function iframeStub() {
  const listeners = new Map<string, Array<() => void>>()
  const stub = {
    addEventListener: (type: string, fn: () => void): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    removeEventListener: (type: string, fn: () => void): void => {
      listeners.set(type, (listeners.get(type) ?? []).filter((it) => it !== fn))
    },
    fire: (type: string): void => {
      for (const fn of listeners.get(type) ?? []) fn()
    },
    listenerCount: (type: string): number => (listeners.get(type) ?? []).length,
  }
  return stub
}

/** 记录型遮罩桩：标记态写入序列可见。 */
function veilStub() {
  const states: boolean[] = []
  const stub: BootVeilVeilLike & { readonly states: boolean[] } = {
    setActive: (active) => states.push(active),
    states,
  }
  return stub
}

/** 记录型 src 属性观察桩：替代 MutationObserver，回调可手动触发。 */
function observerStub() {
  let onSrcChange: (() => void) | null = null
  let disconnected = false
  const stub = {
    observe: (_target: BootVeilIframeLike, cb: () => void): void => {
      onSrcChange = cb
    },
    // 真 MutationObserver.disconnect 后不再派发：封回调。
    disconnect: (): void => {
      disconnected = true
      onSrcChange = null
    },
    fireSrcChange: (): void => onSrcChange?.(),
    isDisconnected: (): boolean => disconnected,
  }
  return stub
}

/* ============ DashboardPanel 元素树 ============ */

describe('DashboardPanel 启动遮罩元素树', () => {
  it('容器 relative + 遮罩初始 data-active=true 盖住 iframe 首帧空白', () => {
    const tree = asElement(DashboardPanel({ src: 'http://127.0.0.1:8787/?embed=1#/projects' }))
    expect(tree.props?.style).toMatchObject({ position: 'relative' })
    const kids = kidsOf(tree)
    const veil = findByClass(kids, BOOT_VEIL_CLASS)
    expect(veil).toBeDefined()
    expect(veil?.props?.['data-active']).toBe('true')
    expect(veil?.props?.['aria-hidden']).toBe('true')
    // 遮罩顶部按窗口控件带让位，与容器 paddingTop 同口径。
    expect(veil?.props?.style).toMatchObject({
      top: 'var(--dsh-frame-leading-clearance, 0px)',
    })
    // 环 + 文案两层结构，文案即「加载中」。
    const veilKids = kidsOf(veil as ElementLike)
    expect(findByClass(veilKids, `${BOOT_VEIL_CLASS}-ring`)).toBeDefined()
    const label = findByClass(veilKids, `${BOOT_VEIL_CLASS}-label`)
    expect(label?.props?.children).toBe('加载中')
  })

  it('iframe 兄弟节点序：遮罩排在 iframe 之后（z 序由 CSS 保证，结构先 iframe 后遮罩）', () => {
    const tree = asElement(DashboardPanel({ src: 'http://127.0.0.1:8787/' }))
    const kids = kidsOf(tree)
    const iframeIndex = kids.findIndex((node) => node.type === 'iframe')
    const veilIndex = kids.findIndex((node) => node.props?.className === BOOT_VEIL_CLASS)
    expect(iframeIndex).toBeGreaterThanOrEqual(0)
    expect(veilIndex).toBeGreaterThan(iframeIndex)
  })
})

/* ============ PANEL_BOOT_VEIL_CSS 合同 ============ */

describe('PANEL_BOOT_VEIL_CSS 合同', () => {
  it('主选择器与元素树类名一致（同源常量拼接）', () => {
    expect(PANEL_BOOT_VEIL_CSS).toContain(`.${BOOT_VEIL_CLASS} {`)
    expect(PANEL_BOOT_VEIL_CSS).toContain(`.${BOOT_VEIL_CLASS}-ring`)
    expect(PANEL_BOOT_VEIL_CSS).toContain(`.${BOOT_VEIL_CLASS}-label`)
  })

  it('隐藏态走 data-active=false 属性选择器（opacity+visibility+pointer-events 三连）', () => {
    expect(PANEL_BOOT_VEIL_CSS).toContain(`.${BOOT_VEIL_CLASS}[data-active='false']`)
    expect(PANEL_BOOT_VEIL_CSS).toContain('opacity: 0')
    expect(PANEL_BOOT_VEIL_CSS).toContain('visibility: hidden')
    expect(PANEL_BOOT_VEIL_CSS).toContain('pointer-events: none')
    expect(PANEL_BOOT_VEIL_CSS).toContain('transition: opacity 0.2s')
  })

  it('颜色全部宿主变量口径随主题换档，hex 仅兜底', () => {
    expect(PANEL_BOOT_VEIL_CSS).toContain('var(--dsw-specific-sidebar-fill, #fff)')
    expect(PANEL_BOOT_VEIL_CSS).toContain('var(--dsw-specific-button-major, #0f1115)')
    expect(PANEL_BOOT_VEIL_CSS).toContain('var(--dsw-alias-label-tertiary, #adb2b8)')
    expect(PANEL_BOOT_VEIL_CSS).toContain('var(--dsw-font-family,')
  })

  it('自带 keyframes 与 reduced-motion 降级', () => {
    expect(PANEL_BOOT_VEIL_CSS).toContain('@keyframes fenix-bridge-veil-spin')
    expect(PANEL_BOOT_VEIL_CSS).toContain('animation: fenix-bridge-veil-spin 0.9s linear infinite')
    expect(PANEL_BOOT_VEIL_CSS).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

/* ============ wireBootVeil 状态机 ============ */

describe('wireBootVeil 状态机', () => {
  it('接线即显示 → iframe load 淡出 → src 属性变化（宿主深链换页）重新拉起 → load 再淡出', () => {
    const iframe = iframeStub()
    const veil = veilStub()
    const observer = observerStub()
    wireBootVeil(iframe, veil, { observeSrcAttr: (target, cb) => (observer.observe(target, cb), () => observer.disconnect()) })
    expect(veil.states).toEqual([true])
    iframe.fire('load')
    expect(veil.states).toEqual([true, false])
    observer.fireSrcChange()
    expect(veil.states).toEqual([true, false, true])
    iframe.fire('load')
    expect(veil.states).toEqual([true, false, true, false])
  })

  it('解线口：摘 load 监听 + 断开 src 观察器，触发不再改标记态', () => {
    const iframe = iframeStub()
    const veil = veilStub()
    const observer = observerStub()
    const detach = wireBootVeil(iframe, veil, {
      observeSrcAttr: (target, cb) => (observer.observe(target, cb), () => observer.disconnect()),
    })
    expect(iframe.listenerCount('load')).toBe(1)
    detach()
    expect(iframe.listenerCount('load')).toBe(0)
    expect(observer.isDisconnected()).toBe(true)
    iframe.fire('load')
    observer.fireSrcChange()
    expect(veil.states).toEqual([true]) // 解线后无新写入
  })

  it('重复 load 事件（重定向/历史导航）只反复落 false，不抬遮罩', () => {
    const iframe = iframeStub()
    const veil = veilStub()
    wireBootVeil(iframe, veil, { observeSrcAttr: () => () => {} })
    for (let round = 0; round < 3; round += 1) {
      iframe.fire('load')
    }
    expect(veil.states[0]).toBe(true)
    expect(veil.states.slice(1).every((state) => state === false)).toBe(true)
    expect(veil.states.at(-1)).toBe(false)
  })
})
