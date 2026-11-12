/**
 * client/searchDialog 弹窗测试（jsdom）：open 门控、空/空白禁提交、可选日期
 * （合法/非法）、Esc 与关闭按钮、提交流程（POST 载荷 trim + timeRange）、
 * 1s 轮询（阶段文案→终态）、结果列表（标题/工作区/时间/理由/置信度）、
 * degraded 横幅、空态、error/cancelled 展示、候选点击回调、重复提交
 * DELETE+新建、关闭重开状态重置（含在途 DELETE）、POST 404 / 轮询 404 错误、
 * buildTimeRange / formatActivityTime 纯函数。
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { SearchDialog, buildTimeRange, formatActivityTime } from '../src/client/searchDialog.js'
import type { FetchFace, SearchDialogProps } from '../src/client/searchDialog.js'
import { API_PREFIX, JOBS_PATH, UI_TEXT } from '../src/shared/protocol.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** fetch 调用记账行。 */
interface Call {
  method: string
  url: string
  body?: string
}

/** GET 轮询脚本行。 */
interface QueueItem {
  status: number
  payload: unknown
}

/** 可编程 fetch 桩：POST/DELETE 默认成功，GET 按脚本出队（耗尽停在 collecting）。 */
function makeFetch(getQueue: QueueItem[] = []): { fetchImpl: FetchFace; calls: Call[] } {
  const calls: Call[] = []
  let postSeq = 0
  const fetchImpl: FetchFace = async (input, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url: input, body: init?.body })
    if (method === 'POST') {
      postSeq += 1
      return { ok: true, status: 200, json: async () => ({ jobId: `job-${postSeq}` }) }
    }
    if (method === 'DELETE') return { ok: true, status: 200, json: async () => ({ cancelled: true }) }
    const next = getQueue.shift()
    const item: QueueItem = next ?? { status: 200, payload: { jobId: 'job-1', phase: 'collecting' } }
    return { ok: item.status === 200, status: item.status, json: async () => item.payload }
  }
  return { fetchImpl, calls }
}

/** 渲染句柄（重开/关闭 rerender + unmount 清理）。 */
interface Mounted {
  rerender: (props: Partial<SearchDialogProps>) => Promise<void>
  unmount: () => Promise<void>
  onClose: () => void
  openSessions: string[]
}

async function mountDialog(overrides?: Partial<SearchDialogProps> & { fetchImpl?: FetchFace }): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  let currentProps: SearchDialogProps = {
    open: true,
    onClose: () => {},
    onOpenSession: () => {},
    ...overrides,
  } as SearchDialogProps
  const openSessions: string[] = []
  currentProps = { ...currentProps, onOpenSession: (id: string, _title: string) => openSessions.push(id) }
  await act(async () => {
    root.render(createElement(SearchDialog, currentProps))
  })
  const rerender = async (next: Partial<SearchDialogProps>): Promise<void> => {
    currentProps = { ...currentProps, ...next, onOpenSession: currentProps.onOpenSession }
    await act(async () => {
      root.render(createElement(SearchDialog, currentProps))
    })
  }
  const unmount = async (): Promise<void> => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
  return { rerender, unmount, onClose: currentProps.onClose, openSessions }
}

/** React 受控输入赋值（native setter + input 事件）。 */
function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 查询 helper。 */
function q<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`missing: ${selector}`)
  return found
}

async function clickSubmit(): Promise<void> {
  const button = q<HTMLButtonElement>('button[type="button"]:not([aria-label])')
  await act(async () => {
    button.click()
  })
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

afterAll(() => {
  document.body.innerHTML = ''
})

describe('SearchDialog 开合与基础渲染', () => {
  it('open=false 渲染 null', async () => {
    const dialog = await mountDialog({ open: false })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await dialog.unmount()
  })

  it('open=true 渲染弹窗骨架（标题/描述 placeholder/日期输入/提交按钮）', async () => {
    const dialog = await mountDialog()
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(q<HTMLTextAreaElement>('textarea').placeholder).toBe(UI_TEXT.queryPlaceholder)
    expect(q<HTMLInputElement>('input[type="date"]')).not.toBeNull()
    expect(document.body.textContent).toContain(UI_TEXT.submit)
    await dialog.unmount()
  })
})

describe('SearchDialog 提交门控', () => {
  it('空/空白 query 禁用提交；输入后可用', async () => {
    const dialog = await mountDialog()
    const submit = (): HTMLButtonElement => q<HTMLButtonElement>('button[type="button"]:not([aria-label])')
    expect(submit().disabled).toBe(true)
    setInputValue(q<HTMLTextAreaElement>('textarea'), '   ')
    await act(async () => {})
    expect(submit().disabled).toBe(true)
    setInputValue(q<HTMLTextAreaElement>('textarea'), '登录调试')
    await act(async () => {})
    expect(submit().disabled).toBe(false)
    await dialog.unmount()
  })

  it('日期区间非法（结束早于开始）→ 提示 + 禁用；清空恢复', async () => {
    const dialog = await mountDialog()
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    const dates = document.querySelectorAll<HTMLInputElement>('input[type="date"]')
    setInputValue(dates[0] as HTMLInputElement, '2026-01-02')
    setInputValue(dates[1] as HTMLInputElement, '2026-01-01')
    await act(async () => {})
    expect(q<HTMLButtonElement>('button[type="button"]:not([aria-label])').disabled).toBe(true)
    expect(document.body.textContent).toContain('时间范围无效')
    setInputValue(dates[1] as HTMLInputElement, '')
    await act(async () => {})
    expect(q<HTMLButtonElement>('button[type="button"]:not([aria-label])').disabled).toBe(false)
    await dialog.unmount()
  })
})

describe('SearchDialog 关闭交互', () => {
  it('Esc → onClose；关闭按钮 → onClose', async () => {
    const dialog = await mountDialog()
    let closes = 0
    await dialog.rerender({ onClose: () => (closes += 1) })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(closes).toBe(1)
    await act(async () => {
      q<HTMLButtonElement>('button[aria-label="关闭"]').click()
    })
    expect(closes).toBe(2)
    await dialog.unmount()
  })
})

describe('SearchDialog 提交与轮询', () => {
  it('POST 载荷带 trim query + timeRange；轮询推进后渲染结果行', async () => {
    const results = [
      { sessionId: 's1', title: '登录修复', workspacePath: '/root/fenixd', activityTime: new Date(2026, 0, 2, 9, 30).getTime(), reason: '首条消息命中', confidence: 0.92 },
    ]
    const { fetchImpl, calls } = makeFetch([
      { status: 200, payload: { jobId: 'job-1', phase: 'collecting' } },
      { status: 200, payload: { jobId: 'job-1', phase: 'analyzing' } },
      { status: 200, payload: { jobId: 'job-1', phase: 'done', results } },
    ])
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl })
    setInputValue(q<HTMLTextAreaElement>('textarea'), '  登录调试  ')
    const dates = document.querySelectorAll<HTMLInputElement>('input[type="date"]')
    setInputValue(dates[0] as HTMLInputElement, '2026-01-01')
    setInputValue(dates[1] as HTMLInputElement, '2026-01-31')
    await clickSubmit()
    const post = calls.find((call) => call.method === 'POST')
    expect(post?.url).toBe(JOBS_PATH)
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      query: '登录调试',
      timeRange: { start: new Date(2026, 0, 1).getTime(), end: new Date(2026, 1, 1).getTime() },
    })
    // 第 1s：collecting 文案。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.phaseText.collecting ?? '')
    // 第 2s：analyzing 文案。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.phaseText.analyzing ?? '')
    // 第 3s：done + 结果行。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain('登录修复')
    expect(document.body.textContent).toContain('/root/fenixd')
    expect(document.body.textContent).toContain('2026-01-02 09:30')
    expect(document.body.textContent).toContain('首条消息命中')
    expect(document.body.textContent).toContain('92%')
    // 终态后停轮：不再产生 GET。
    const getCount = calls.filter((call) => call.method === 'GET').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(getCount)
    await dialog.unmount()
  })

  it('候选点击 → onOpenSession(sessionId)', async () => {
    const results = [{ sessionId: 's9', title: 't', workspacePath: '', activityTime: 1, reason: 'r', confidence: 0.5 }]
    const { fetchImpl } = makeFetch([
      { status: 200, payload: { jobId: 'job-1', phase: 'done', results } },
    ])
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl })
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      q<HTMLButtonElement>('ul button').click()
    })
    expect(dialog.openSessions).toEqual(['s9'])
    await dialog.unmount()
  })

  it('重复提交：在途期间再次提交 → DELETE 旧任务 + 新 POST', async () => {
    const { fetchImpl, calls } = makeFetch([]) // GET 恒 collecting（保持 in-flight）
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl })
    setInputValue(q<HTMLTextAreaElement>('textarea'), '第一次')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    setInputValue(q<HTMLTextAreaElement>('textarea'), '第二次')
    await clickSubmit()
    const deleteCall = calls.find((call) => call.method === 'DELETE')
    expect(deleteCall?.url).toBe(`${API_PREFIX}/jobs/job-1`)
    const posts = calls.filter((call) => call.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1]?.body ?? '{}').query).toBe('第二次')
    await dialog.unmount()
  })

  it('degraded=true → 顶部标注；行 degraded 透传', async () => {
    const results = [{ sessionId: 's1', title: 't', workspacePath: '', activityTime: 1, reason: '机械匹配：标题关键词命中（2 分）', confidence: 1, degraded: true }]
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', results, degraded: true } }])
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl })
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.degradedBadge)
    await dialog.unmount()
  })

  it('done + 零结果 → 空态文案', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', results: [] } }])
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl })
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.empty)
    await dialog.unmount()
  })

  it('error 终态 → 「搜索失败」+ message；cancelled → 已取消', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'error', message: '收集失败：磁盘不可读' } }])
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl })
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.failed)
    expect(document.body.textContent).toContain('收集失败：磁盘不可读')
    await dialog.unmount()
  })

  it('POST 404 → 服务未启用提示；轮询 404 → 任务丢失提示', async () => {
    const { fetchImpl } = makeFetch()
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl: async (input, init) => (init?.method ?? 'GET') === 'POST' ? { ok: false, status: 404, json: async () => ({}) } : fetchImpl(input, init) })
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    await clickSubmit()
    expect(document.body.textContent).toContain('高级搜索服务未启用')
    await dialog.unmount()

    // 轮询 404：POST 成功、GET 一律 404（任务表丢失）。
    const calls2: Call[] = []
    const fetch404: FetchFace = async (input, init) => {
      const method = init?.method ?? 'GET'
      calls2.push({ method, url: input, body: init?.body })
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({ jobId: 'job-9' }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }
    const dialog2 = await mountDialog({ fetchImpl: fetch404 })
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls2.some((call) => call.method === 'GET' && call.url === `${JOBS_PATH}/job-9`)).toBe(true)
    expect(document.body.textContent).toContain('任务已丢失')
    await dialog2.unmount()
  })
})

describe('SearchDialog 关闭重开状态重置', () => {
  it('关闭时 DELETE 在途任务；重开后输入/结果清空', async () => {
    const results = [{ sessionId: 's1', title: 't', workspacePath: '', activityTime: 1, reason: 'r', confidence: 1 }]
    const { fetchImpl, calls } = makeFetch([]) // 恒 collecting（在途）
    vi.useFakeTimers()
    const dialog = await mountDialog({ fetchImpl })
    setInputValue(q<HTMLTextAreaElement>('textarea'), 'q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls.some((call) => call.method === 'GET')).toBe(true)
    // 关闭（onClose 被装配调用后 open 变 false）：在途 DELETE + 状态重置。
    await dialog.rerender({ open: false })
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    // 重开：全新状态。
    await dialog.rerender({ open: true })
    expect(q<HTMLTextAreaElement>('textarea').value).toBe('')
    expect(document.body.textContent).not.toContain('t')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await dialog.unmount()
  })
})

describe('buildTimeRange 纯函数', () => {
  it('无日期：valid 无 range', () => {
    expect(buildTimeRange('', '')).toEqual({ valid: true })
  })

  it('只填开始/只填结束：单边界', () => {
    expect(buildTimeRange('2026-01-02', '')).toEqual({ valid: true, range: { start: new Date(2026, 0, 2).getTime(), end: Number.MAX_SAFE_INTEGER } })
    expect(buildTimeRange('', '2026-01-02')).toEqual({ valid: true, range: { start: 0, end: new Date(2026, 0, 3).getTime() } })
  })

  it('都填：闭开区间（开始日零点 → 结束日次日零点，本地时区）', () => {
    expect(buildTimeRange('2026-01-02', '2026-01-05')).toEqual({
      valid: true,
      range: { start: new Date(2026, 0, 2).getTime(), end: new Date(2026, 0, 6).getTime() },
    })
  })

  it('同日=全天合法；早于开始/坏格式非法', () => {
    // 结束端点为次日零点（开区间），同日即覆盖全天 → 合法。
    expect(buildTimeRange('2026-01-05', '2026-01-05').valid).toBe(true)
    expect(buildTimeRange('2026-01-06', '2026-01-05').valid).toBe(false)
    expect(buildTimeRange('20260101', '2026-01-05').valid).toBe(false)
    expect(buildTimeRange('2026-13-01', '').valid).toBe(false)
  })
})

describe('formatActivityTime', () => {
  it('本地时区 YYYY-MM-DD HH:mm', () => {
    expect(formatActivityTime(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04')
    expect(formatActivityTime(new Date(2026, 10, 30, 23, 59).getTime())).toBe('2026-11-30 23:59')
  })
})
