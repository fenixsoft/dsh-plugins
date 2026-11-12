/**
 * @vitest-environment jsdom
 *
 * client/searchButton 注入测试（jsdom）：注入成功位置（input 之后、
 * clearButton 左侧）、hover 提示（title）、失配降级（warn 限流不抛错）、
 * 官方重渲染移除后自动补插、卸载清理（observer 断开 + 按钮移除）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ANCHOR, injectSearchButton } from '../src/client/searchButton.js'
import { UI_TEXT } from '../src/shared/protocol.js'

/** 夹具：官方搜索框 DOM 形态（哈希前缀 `abc_` 模拟漂移）。 */
function mountSearchBox(doc: Document, options?: { expanded?: boolean; noSlot?: boolean }): { input: HTMLInputElement; clearButton?: HTMLButtonElement } {
  const slot = doc.createElement('div')
  slot.className = 'abc_searchSlot'
  const box = doc.createElement('div')
  box.className = 'abc_search'
  const searchButton = doc.createElement('button')
  searchButton.className = 'abc_searchButton'
  const input = doc.createElement('input')
  input.className = 'abc_searchInput'
  input.type = 'text'
  box.append(searchButton, input)
  let clearButton: HTMLButtonElement | undefined
  if (options?.expanded !== false) {
    clearButton = doc.createElement('button')
    clearButton.className = 'abc_clearButton'
    box.append(clearButton)
  }
  slot.append(box)
  if (options?.noSlot !== true) doc.body.append(slot)
  else doc.body.append(box)
  return { input, clearButton }
}

/** 记账 log。 */
function makeLog(): { warns: string[]; debugs: string[]; warn: (m: string) => void; debug: (m: string) => void } {
  const warns: string[] = []
  const debugs: string[] = []
  return { warns, debugs, warn: (m) => warns.push(m), debug: (m) => debugs.push(m) }
}

/** 排空微任务（mutation burst 去抖后的 ensure）。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('injectSearchButton 注入位置', () => {
  it('展开态：按钮插在 searchInput 之后、clearButton 之前', async () => {
    const { input, clearButton } = mountSearchBox(document)
    const log = makeLog()
    const handle = injectSearchButton({ document, log, onClick: () => {} })
    await flush()
    const button = document.querySelector('button.fenix-sas-entry')
    expect(button).not.toBeNull()
    expect(input.nextElementSibling).toBe(button)
    expect(button?.previousElementSibling).toBe(input)
    expect(button?.nextElementSibling).toBe(clearButton)
    handle.dispose()
  })

  it('未展开态（无 clearButton）：按钮仍插在 searchInput 之后', async () => {
    const { input } = mountSearchBox(document, { expanded: false })
    const handle = injectSearchButton({ document, log: makeLog(), onClick: () => {} })
    await flush()
    expect(input.nextElementSibling?.classList.contains('fenix-sas-entry')).toBe(true)
    handle.dispose()
  })

  it('侧栏懒挂载：初始无锚点，DOM 后挂载时自动注入', async () => {
    const log = makeLog()
    const handle = injectSearchButton({ document, log, onClick: () => {} })
    await flush()
    expect(document.querySelector('button.fenix-sas-entry')).toBeNull()
    mountSearchBox(document)
    await flush()
    expect(document.querySelector('button.fenix-sas-entry')).not.toBeNull()
    handle.dispose()
  })
})

describe('injectSearchButton 交互', () => {
  it('title/aria-label = hover 提示「高级搜索」；点击触发回调且不冒泡', async () => {
    const { input } = mountSearchBox(document)
    let clicks = 0
    const parentClicks: number[] = []
    const box = input.parentElement as HTMLElement
    box.addEventListener('click', () => parentClicks.push(1))
    const handle = injectSearchButton({ document, log: makeLog(), onClick: () => (clicks += 1) })
    await flush()
    const button = document.querySelector('button.fenix-sas-entry') as HTMLButtonElement
    expect(button.title).toBe(UI_TEXT.buttonTitle)
    expect(button.getAttribute('aria-label')).toBe(UI_TEXT.buttonTitle)
    button.click()
    expect(clicks).toBe(1)
    expect(parentClicks).toEqual([])
    handle.dispose()
  })
})

describe('injectSearchButton 失配降级', () => {
  it('无锚点 → 不注入不抛错，warn 恰一次（重复变更不刷日志）', async () => {
    const log = makeLog()
    const handle = injectSearchButton({ document, log, onClick: () => {} })
    await flush()
    expect(document.querySelector('button.fenix-sas-entry')).toBeNull()
    expect(log.warns).toHaveLength(1)
    expect(log.warns[0]).toContain('锚点失配')
    // 后续无关 DOM 变更：不重复 warn、也不注入。
    document.body.append(document.createElement('div'))
    await flush()
    expect(log.warns).toHaveLength(1)
    handle.dispose()
  })
})

describe('injectSearchButton 在位维护', () => {
  it('官方重渲染移除按钮后自动补插', async () => {
    const { input } = mountSearchBox(document)
    const handle = injectSearchButton({ document, log: makeLog(), onClick: () => {} })
    await flush()
    expect(document.querySelector('button.fenix-sas-entry')).not.toBeNull()
    // 模拟官方重渲染：按钮被移除。
    document.querySelector('button.fenix-sas-entry')?.remove()
    await flush()
    const reinserted = input.nextElementSibling
    expect(reinserted?.classList.contains('fenix-sas-entry')).toBe(true)
    handle.dispose()
  })
})

describe('injectSearchButton 卸载清理', () => {
  it('dispose 后按钮移除、observer 断开（DOM 变更不再注入）', async () => {
    mountSearchBox(document)
    const handle = injectSearchButton({ document, log: makeLog(), onClick: () => {} })
    await flush()
    expect(document.querySelector('button.fenix-sas-entry')).not.toBeNull()
    handle.dispose()
    expect(document.querySelector('button.fenix-sas-entry')).toBeNull()
    // observer 已断开：再次移除 + 重挂锚点，不产生新注入。
    mountSearchBox(document)
    await flush()
    expect(document.querySelectorAll('button.fenix-sas-entry')).toHaveLength(0)
    // dispose 幂等。
    expect(() => handle.dispose()).not.toThrow()
  })
})

describe('ANCHOR 签名导出', () => {
  it('锚点选择器与 design 回填签名一致（README 修缝指南同步面）', () => {
    expect(ANCHOR.inputSelector).toBe('input[class*="searchInput"]')
  })
})
