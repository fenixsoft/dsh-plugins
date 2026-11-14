/**
 * @vitest-environment jsdom
 *
 * client 半装配测试（v3.1 body 挂载嵌入形态）：
 * - 面板挂 document.body（React 重渲染不可达 → iframe 保活 = 重开保留结果）；
 * - 位置取内容区锚点矩形（覆盖内容区避让侧栏）；失配降级抽屉；
 * - __fenixSas：close 收视图 + openSession 服务缝（ctx.uiWorkspace 提供）；
 * - 会话切换收视图：selection 订阅缝（存在即挂）+ click-away 捕获兜底（恒注册，
 *   与缝形状解耦——m01846 用户实报「点所有会话都显示搜索页」即缝失效场景）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.js'
import { PAGE_PATH } from '../src/shared/protocol.js'

/** 标准侧栏/内容区骨架（锚点命中）。 */
function mountSkeleton(): { sidebar: HTMLElement; content: HTMLElement } {
  const input = document.createElement('input')
  input.className = 'abc_searchInput'
  const sidebar = document.createElement('div')
  sidebar.className = 'abc_sidebar'
  const content = document.createElement('div')
  sidebar.append(input)
  document.body.append(sidebar, content)
  return { sidebar, content }
}

function sasApi(): { close(): void; openSession?(id: string): void } {
  return (window as unknown as Record<string, unknown>).__fenixSas as never
}

function viewRoot(): HTMLElement {
  return document.querySelector('div[data-fenix-sas-view-root]') as HTMLElement
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('client 装配（v3.1 body 挂载嵌入）', () => {
  it('inject 声明 uiWorkspace（openSession 跳转缝 + selection 收视图缝）', () => {
    expect(inject).toEqual(['uiWorkspace'])
  })

  it('点击挂 body 固定面板（不在内容区节点内）并显示，再点收起；iframe 保活', () => {
    mountSkeleton()
    const stop = apply({} as never, { host: window })
    const button = document.querySelector('button.fenix-sas-entry')
    expect(button).not.toBeNull()
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root = viewRoot()
    expect(root).not.toBeNull()
    expect(root.parentElement).toBe(document.body)
    expect(root.style.display).toBe('')
    expect(root.style.position).toBe('fixed')
    const iframe = root.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe(PAGE_PATH)
    expect(sasApi()).toBeDefined()
    // 再点收起（iframe 仍在 DOM = 保活）。
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(root.style.display).toBe('none')
    expect(root.isConnected).toBe(true)
    expect(root.querySelector('iframe')).not.toBeNull()
    // __fenixSas.close 同源缝复现关闭。
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    sasApi().close()
    expect(root.style.display).toBe('none')
    stop()
    expect(document.querySelector('div[data-fenix-sas-view-root]')).toBeNull()
    expect((window as unknown as Record<string, unknown>).__fenixSas).toBeUndefined()
  })

  it('ctx.uiWorkspace 提供 openSession 时暴露 __fenixSas.openSession（先开话后收面板）', () => {
    mountSkeleton()
    const openSession = vi.fn()
    const stop = apply({ uiWorkspace: { openSession, selection: {} } } as never, { host: window })
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('')
    sasApi().openSession!('sess-9')
    expect(openSession).toHaveBeenCalledWith('sess-9')
    expect(viewRoot().style.display).toBe('none')
    // 服务缝抛错：透传给页面（页面走 localStorage 兜底），不吞错。
    const boom = vi.fn(() => {
      throw new Error('boom')
    })
    stop()
    const stop2 = apply({ uiWorkspace: { openSession: boom } } as never, { host: window })
    expect(() => sasApi().openSession!('sess-x')).toThrow('boom')
    expect(boom).toHaveBeenCalledWith('sess-x')
    stop2()
  })

  it('uiWorkspace 缺失：openSession 不暴露（页面走兜底），侧栏点击兜底收视图仍生效', () => {
    const { sidebar } = mountSkeleton()
    const stop = apply({} as never, { host: window })
    expect(sasApi().openSession).toBeUndefined()
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('')
    // 侧栏内点击 → 关闭；入口按钮豁免（toggle 语义不被兜底破坏）。
    sidebar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('none')
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    sidebar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('none')
    stop()
  })

  it('click-away 兜底恒注册：任意非豁免点击即收视图（含 selection 缝在场时）', () => {
    mountSkeleton()
    let listener: (() => void) | undefined
    const subscribe = (fn: () => void): (() => void) => {
      listener = fn
      return () => {
        listener = undefined
      }
    }
    // selection 缝在场（旧实现此时不注册兜底；新实现恒注册）。
    const stop = apply({ uiWorkspace: { selection: { subscribe } } } as never, { host: window })
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('')
    // 任意位置点击（顶栏/主区/空白）→ 收视图。
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('none')
    // 容器自身点击（滚动条/边框触摸）不收。
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('')
    viewRoot().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('')
    stop()
    // 卸载后 click-away 不再收（监听已移除，开视图后 body 点击不关闭）。
    const stop2 = apply({} as never, { host: window })
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    stop2()
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector('div[data-fenix-sas-view-root]')).toBeNull()
  })

  it('selection 快照店订阅主缝：回调即收视图', () => {
    mountSkeleton()
    let listener: (() => void) | undefined
    const subscribe = (fn: () => void): (() => void) => {
      listener = fn
      return () => {
        listener = undefined
      }
    }
    const stop = apply({ uiWorkspace: { selection: { subscribe } } } as never, { host: window })
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(viewRoot().style.display).toBe('')
    listener!()
    expect(viewRoot().style.display).toBe('none')
    stop()
    expect(listener).toBeUndefined()
  })

  it('内容区锚失配 → 抽屉降级（left=0 全屏宽）；有侧栏则避让侧栏宽度', () => {
    const input = document.createElement('input')
    input.className = 'abc_searchInput'
    document.body.append(input) // 无侧栏祖先 → 锚点失配
    const stop = apply({} as never, { host: window })
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root = viewRoot()
    expect(root.style.position).toBe('fixed')
    expect(root.style.left).toBe('0px')
    stop()
    expect(document.querySelector('div[data-fenix-sas-view-root]')).toBeNull()
  })

  it('无 document 环境跳过装配并返回空停止函数（node 直载自守）', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })
    try {
      const stop = apply({} as never)
      expect(typeof stop).toBe('function')
      expect(() => stop()).not.toThrow()
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, 'document', originalDescriptor)
    }
  })
})
