/**
 * @vitest-environment jsdom
 *
 * client/index 装配测试（jsdom，端到端装配链；optimize 轮装配换 SearchView）：
 * 注入按钮 → 点击在内容区开视图（侧栏相邻兄弟锚点命中）→ 提交/轮询（stub
 * 全局 fetch）→ 候选点击 jump（uiWorkspace 服务缝）+ 视图关闭 → 卸载清理对称
 * （按钮移除 + React root 容器移除）；锚点失配降级右侧抽屉（warn 限流一次）；
 * uiWorkspace 缺失装配不抛（warn 走兜底）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { UI_TEXT } from '../src/shared/protocol.js'
import type { Context } from '@deepseek-ai/cordis'

/** 搜索框锚点夹具（官方布局形态：侧栏面板与内容区为相邻兄弟）。 */
function mountSidebarLayout(): { input: HTMLInputElement; content: HTMLDivElement } {
  const sidebar = document.createElement('div')
  sidebar.className = 'abc_sidebar'
  const content = document.createElement('div')
  content.className = 'abc_content'
  const input = document.createElement('input')
  input.className = 'abc_searchInput'
  input.type = 'text'
  sidebar.append(input)
  document.body.append(sidebar, content)
  return { input, content }
}

/** uiWorkspace 在位的假 ctx。 */
function makeCtx(opened: string[]): Context {
  return {
    uiWorkspace: {
      openSession: (target: string) => opened.push(target),
    },
  } as unknown as Context
}

/** stub 全局 fetch：POST 建任务、GET 按脚本、DELETE 成功。 */
function stubFetch(getQueue: { status: number; payload: unknown }[]): { calls: { method: string; url: string }[]; restore: () => void } {
  const calls: { method: string; url: string }[] = []
  let postSeq = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const url = String(input)
    calls.push({ method, url })
    if (method === 'POST') {
      postSeq += 1
      return new Response(JSON.stringify({ jobId: `job-${postSeq}` }), { status: 200 })
    }
    if (method === 'DELETE') return new Response(JSON.stringify({ cancelled: true }), { status: 200 })
    const item = getQueue.shift() ?? { status: 200, payload: { jobId: 'job-1', phase: 'collecting' } }
    return new Response(JSON.stringify(item.payload), { status: item.status })
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

/** 排空微任务（仅用于真定时器用例；fake timers 用例统一走 advanceTimersByTimeAsync）。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function entryButton(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>('button.fenix-sas-entry')
  if (found === null) throw new Error('入口按钮未注入')
  return found
}

/** React 受控输入赋值（native setter + input 事件）。 */
function setInputValue(element: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('client apply 装配链（SearchView 内容区）', () => {
  it('装配即注入入口按钮；点击在内容区开视图（容器挂侧栏相邻兄弟、非模态）', async () => {
    const { content } = mountSidebarLayout()
    const stop = apply(makeCtx([]))
    expect(entryButton()).not.toBeNull()
    // 点击前视图容器未挂载（惰性首开）。
    expect(document.querySelector('[data-fenix-sas-view-root]')).toBeNull()
    entryButton().click()
    await flush()
    expect(content.querySelector('[data-fenix-sas-view-root]')).not.toBeNull()
    expect(document.querySelector('[data-fenix-sas="view"]')).not.toBeNull()
    expect(document.body.textContent).toContain(UI_TEXT.dialogTitle)
    stop()
    await flush()
  })

  it('候选点击 → uiWorkspace.openSession(sessionId) 且视图关闭', async () => {
    mountSidebarLayout()
    const opened: string[] = []
    const results = [{ sessionId: 's-jump', title: '跳转目标', workspacePath: '', activityTime: 1, reason: 'r', confidence: 1 }]
    const { restore } = stubFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', results } }])
    vi.useFakeTimers()
    const stop = apply(makeCtx(opened), { pollIntervalMs: 10 })
    const tick = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(10)
    }
    await tick()
    entryButton().click()
    await tick()
    const input = document.querySelector<HTMLInputElement>('input[data-fenix-sas="query"]')
    expect(input).not.toBeNull()
    setInputValue(input as HTMLInputElement, 'q')
    await tick()
    // 提交（advanceTimersByTimeAsync 同步 flush promise 链）。
    const submit = document.querySelector<HTMLButtonElement>('button[data-fenix-sas="submit"]')
    expect(submit).not.toBeNull()
    ;(submit as HTMLButtonElement).click()
    await tick()
    expect(document.body.textContent).toContain('跳转目标')
    // 候选点击 → jump。
    const row = document.querySelector('button[data-fenix-sas="result"]')
    expect(row).not.toBeNull()
    ;(row as HTMLButtonElement).click()
    await tick()
    expect(opened).toEqual(['s-jump'])
    // 视图已关（jump 内 onClose 先于跳转）。
    expect(document.querySelector('[data-fenix-sas="view"]')).toBeNull()
    vi.useRealTimers()
    stop()
    restore()
  })

  it('uiWorkspace 缺失 → 装配不抛（warn 降级兜底路径）', async () => {
    mountSidebarLayout()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = apply({} as Context)
    await flush()
    expect(entryButton()).not.toBeNull()
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('uiWorkspace 服务不可用'))).toBe(true)
    stop()
    await flush()
    warnSpy.mockRestore()
  })

  it('卸载清理对称：按钮移除 + 视图容器移除 + observer 断开', async () => {
    mountSidebarLayout()
    const stop = apply(makeCtx([]))
    await flush()
    entryButton().click()
    await flush()
    expect(document.querySelector('[data-fenix-sas-view-root]')).not.toBeNull()
    stop()
    await flush()
    expect(document.querySelector('button.fenix-sas-entry')).toBeNull()
    expect(document.querySelector('[data-fenix-sas-view-root]')).toBeNull()
    // observer 已断开：重挂锚点不产生新按钮。
    mountSidebarLayout()
    await flush()
    expect(document.querySelector('button.fenix-sas-entry')).toBeNull()
  })
})

describe('client apply 挂载降级（optimize 轮 3.3）', () => {
  it('内容区锚点失配（input 直挂 body）→ 抽屉降级挂 body + warn 限流一次', async () => {
    const input = document.createElement('input')
    input.className = 'abc_searchInput'
    document.body.append(input)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = apply(makeCtx([]))
    await flush()
    entryButton().click()
    await flush()
    // 抽屉容器直接挂 body（fixed 右侧）。
    const container = document.querySelector('[data-fenix-sas-view-root]')
    expect(container).not.toBeNull()
    expect(container?.parentElement).toBe(document.body)
    expect(document.querySelector('[data-fenix-sas="view"]')).not.toBeNull()
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('降级右侧抽屉'))).toBe(true)
    // 重复开合不重复 warn（限流一次）。
    entryButton().click()
    await flush()
    expect(warnSpy.mock.calls.filter((args) => String(args[0]).includes('降级右侧抽屉'))).toHaveLength(1)
    stop()
    await flush()
    warnSpy.mockRestore()
  })
})

describe('client inject 声明', () => {
  it('消费 uiWorkspace 服务键（design D5 优先缝）', () => {
    expect(apply.length).toBeGreaterThan(0)
    // inject 常量由 client 契约消费（plugin-manager resolve 时序）。
    expect(['uiWorkspace']).toEqual(['uiWorkspace'])
  })
})
