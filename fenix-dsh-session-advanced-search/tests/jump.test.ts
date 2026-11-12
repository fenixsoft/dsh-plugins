/**
 * client/jump 跳转测试（jsdom）：服务缝优先（openSession 参数原样透传=
 * 跨工作区语义、不被兜底干扰）、缝缺失/形态不符走侧栏 click 兜底（标题
 * 文本匹配）、跳转前先关弹窗（onClose 顺序）、兜底未命中 warn 不抛错。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { jumpToSession } from '../src/client/jump.js'
import type { JumpLog } from '../src/client/jump.js'

/** 记账 log。 */
function makeLog(): JumpLog & { warns: string[]; debugs: string[] } {
  const warns: string[] = []
  const debugs: string[] = []
  return { warns, debugs, warn: (m) => warns.push(m), debug: (m) => debugs.push(m) }
}

/** 夹具：侧栏会话列表（li 文本=标题）。 */
function mountSidebar(doc: Document, titles: readonly string[]): HTMLLIElement[] {
  const list = doc.createElement('ul')
  list.className = 'abc_sessionList'
  const items = titles.map((title) => {
    const item = doc.createElement('li')
    item.className = 'abc_sessionItem'
    item.textContent = title
    list.append(item)
    return item
  })
  doc.body.append(list)
  return items
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('jumpToSession 服务缝优先', () => {
  it('uiWorkspace 在位 → openSession(sessionId) 原样透传，不触侧栏 DOM', () => {
    const log = makeLog()
    const clicked: string[] = []
    mountSidebar(document, ['标题甲']).forEach((item) => item.addEventListener('click', () => clicked.push('li')))
    const opened: string[] = []
    const ok = jumpToSession(
      { uiWorkspace: { openSession: (target) => opened.push(target) }, document, log },
      'sess-cross-workspace-1',
      { title: '标题甲' },
    )
    expect(ok).toBe(true)
    expect(opened).toEqual(['sess-cross-workspace-1'])
    expect(clicked).toEqual([])
  })

  it('跨工作区会话：sessionId 无工作区前缀加工直接生效', () => {
    const log = makeLog()
    const opened: string[] = []
    jumpToSession({ uiWorkspace: { openSession: (target) => opened.push(target) }, log }, '/other/ws/session-9')
    expect(opened).toEqual(['/other/ws/session-9'])
  })

  it('onClose 在 openSession 之前调用（跳转前先关弹窗）', () => {
    const log = makeLog()
    const order: string[] = []
    jumpToSession(
      {
        uiWorkspace: { openSession: () => order.push('open') },
        log,
      },
      's1',
      { onClose: () => order.push('close') },
    )
    expect(order).toEqual(['close', 'open'])
  })
})

describe('jumpToSession 侧栏 click 兜底', () => {
  it('缝缺失 → 标题匹配列表项 click 命中', () => {
    const log = makeLog()
    const items = mountSidebar(document, ['登录修复', '调试超时'])
    const clicked: string[] = []
    items.forEach((item) => item.addEventListener('click', () => clicked.push(item.textContent ?? '')))
    const ok = jumpToSession({ document, log }, 's2', { title: ' 调试超时 ' })
    expect(ok).toBe(true)
    expect(clicked).toEqual(['调试超时'])
    expect(log.debugs.some((m) => m.includes('兜底'))).toBe(true)
  })

  it('openSession 形态不符（非函数）→ 同样走兜底', () => {
    const log = makeLog()
    const items = mountSidebar(document, ['标题乙'])
    let clicks = 0
    items[0]?.addEventListener('click', () => (clicks += 1))
    const ok = jumpToSession({ uiWorkspace: { openSession: undefined as unknown as (target: string) => void }, document, log }, 's3', { title: '标题乙' })
    expect(ok).toBe(true)
    expect(clicks).toBe(1)
  })

  it('兜底未命中（无匹配标题）→ warn + false 不抛错', () => {
    const log = makeLog()
    mountSidebar(document, ['别的会话'])
    const ok = jumpToSession({ document, log }, 's4', { title: '不存在的标题' })
    expect(ok).toBe(false)
    expect(log.warns).toHaveLength(1)
    expect(log.warns[0]).toContain('不存在的标题')
  })

  it('无 document 且无缝 → warn + false', () => {
    const log = makeLog()
    const ok = jumpToSession({ log }, 's5', { title: '任意' })
    expect(ok).toBe(false)
    expect(log.warns).toHaveLength(1)
  })

  it('无缝且无标题 → warn + false', () => {
    const log = makeLog()
    mountSidebar(document, ['标题丙'])
    const ok = jumpToSession({ document, log }, 's6')
    expect(ok).toBe(false)
    expect(log.warns).toHaveLength(1)
  })

  it('兜底路径 onClose 同样先调用（跳转前关弹窗）', () => {
    const log = makeLog()
    mountSidebar(document, ['标题丁'])
    const order: string[] = []
    const items = document.querySelectorAll('li')
    items.forEach((item) => item.addEventListener('click', () => order.push('click')))
    jumpToSession({ document, log }, 's7', { title: '标题丁', onClose: () => order.push('close') })
    expect(order).toEqual(['close', 'click'])
  })
})
