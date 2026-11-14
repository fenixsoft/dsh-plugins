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

  it('apply 注入入口按钮（官方搜索框 input 之后），点击跳转独立页，卸载移除', () => {
    const input = document.createElement('input')
    input.className = 'abc_searchInput'
    document.body.append(input)
    const navigated: string[] = []
    const stop = apply(ctx() as never, { navigateTo: (path) => navigated.push(path) })
    const button = document.querySelector('button.fenix-sas-entry')
    expect(button).not.toBeNull()
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(navigated).toEqual([PAGE_PATH])
    stop()
    expect(document.querySelector('button.fenix-sas-entry')).toBeNull()
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
