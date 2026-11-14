/**
 * @vitest-environment jsdom
 *
 * client 半装配测试（独立页形态）：入口按钮注入 + 点击跳转独立页。
 * （旧内容区视图/跳转缝测试随 searchView/jump 删除一起移除——独立页形态
 * 会话界面唯一触碰点是入口按钮。）
 */
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.js'
import { PAGE_PATH } from '../src/shared/protocol.js'

function ctx(): unknown {
  return {}
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('client 装配（独立页形态）', () => {
  it('inject 为空：独立页形态零服务依赖', () => {
    expect(inject).toEqual([])
  })

  it('apply 注入入口按钮，点击在内容区挂 iframe 并显示，再点收起；卸载清理', () => {
    const input = document.createElement('input')
    input.className = 'abc_searchInput'
    const sidebar = document.createElement('div')
    sidebar.className = 'abc_sidebar'
    const content = document.createElement('div')
    sidebar.append(input)
    document.body.append(sidebar, content)
    const stop = apply({} as never, { host: window })
    const button = document.querySelector('button.fenix-sas-entry')
    expect(button).not.toBeNull()
    // 首次点击：惰性挂载 + 显示。
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root = content.querySelector('div[data-fenix-sas-view-root]') as HTMLElement | null
    expect(root).not.toBeNull()
    expect(root!.style.display).toBe('')
    const iframe = root!.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe(PAGE_PATH)
    expect((window as unknown as Record<string, unknown>).__fenixSas).toBeDefined()
    // 再点收起（iframe 保活）。
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(root!.style.display).toBe('none')
    // __fenixSas.close 同源缝复现关闭。
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    ;((window as unknown as Record<string, unknown>).__fenixSas as { close(): void }).close()
    expect(root!.style.display).toBe('none')
    // 卸载清理。
    stop()
    expect(content.querySelector('div[data-fenix-sas-view-root]')).toBeNull()
    expect((window as unknown as Record<string, unknown>).__fenixSas).toBeUndefined()
  })

  it('会话切换（侧栏点击捕获兜底）即收视图', () => {
    const input = document.createElement('input')
    input.className = 'abc_searchInput'
    const sidebar = document.createElement('div')
    sidebar.className = 'abc_sidebar'
    const content = document.createElement('div')
    sidebar.append(input)
    document.body.append(sidebar, content)
    const stop = apply({} as never, { host: window })
    const button = document.querySelector('button.fenix-sas-entry')!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root = content.querySelector('div[data-fenix-sas-view-root]') as HTMLElement
    expect(root.style.display).toBe('')
    // 侧栏内点击 → 关闭；内容区点击不受影响。
    sidebar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(root.style.display).toBe('none')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    content.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(root.style.display).toBe('')
    stop()
  })

  it('内容区锚失配 → 降级 fixed 抽屉挂 body', () => {
    const input = document.createElement('input')
    input.className = 'abc_searchInput'
    document.body.append(input) // 无侧栏祖先 → closest 失配
    const stop = apply({} as never, { host: window })
    document.querySelector('button.fenix-sas-entry')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root = document.body.querySelector('div[data-fenix-sas-view-root]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.style.position).toBe('fixed')
    stop()
    expect(document.body.querySelector('div[data-fenix-sas-view-root]')).toBeNull()
  })

  it('无 document 环境跳过装配并返回空停止函数（node 直载自守）', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })
    try {
      const stop = apply(ctx() as never)
      expect(typeof stop).toBe('function')
      expect(() => stop()).not.toThrow()
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, 'document', originalDescriptor)
    }
  })
})
