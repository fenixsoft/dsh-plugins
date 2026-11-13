/**
 * @vitest-environment jsdom
 *
 * client/searchView 内容区视图测试（jsdom，optimize 轮 3.4）：非模态视图骨架
 * （无遮罩/无 role=dialog）、空/空白禁提交、可选日期（合法/非法）、Esc 与关闭
 * 按钮、提交流程（POST 载荷 trim + timeRange、Enter 提交）、轮询推进步骤流
 * 三态与本地计时、中断回初始态（DELETE 在途）、降级横幅按 degradedReason 映射
 * 与 credential-missing 两动作（设置缝有/无）、候选点击回调、关闭重开状态重置
 * （含在途 DELETE）、POST 404 / 轮询 404、buildTimeRange / formatActivityTime
 * 纯函数。
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { SearchView, buildTimeRange, formatActivityTime } from '../src/client/searchView.js'
import type { FetchFace, SearchViewProps } from '../src/client/searchView.js'
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
  rerender: (props: Partial<SearchViewProps>) => Promise<void>
  unmount: () => Promise<void>
  openSessions: string[]
}

async function mountView(overrides?: Partial<SearchViewProps> & { fetchImpl?: FetchFace }): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const openSessions: string[] = []
  let currentProps: SearchViewProps = {
    open: true,
    onClose: () => {},
    onOpenSession: (id: string) => openSessions.push(id),
    ...overrides,
  } as SearchViewProps
  await act(async () => {
    root.render(createElement(SearchView, currentProps))
  })
  const rerender = async (next: Partial<SearchViewProps>): Promise<void> => {
    currentProps = { ...currentProps, ...next }
    await act(async () => {
      root.render(createElement(SearchView, currentProps))
    })
  }
  const unmount = async (): Promise<void> => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
  return { rerender, unmount, openSessions }
}

/** React 受控输入赋值（native setter + input 事件）。 */
function setInputValue(element: HTMLInputElement, value: string): void {
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

/** 提交（composer 圆形发送按钮）。 */
async function clickSubmit(): Promise<void> {
  await act(async () => {
    q<HTMLButtonElement>('button[data-fenix-sas="submit"]').click()
  })
}

/** 提交前输入描述（query 输入框）。 */
async function typeQuery(text: string): Promise<void> {
  setInputValue(q<HTMLInputElement>('input[data-fenix-sas="query"]'), text)
  await act(async () => {})
}

const PROGRESS_COLLECTING = { status: 200, payload: { jobId: 'job-1', phase: 'collecting', progress: [{ step: 'collecting', detail: '关键词：登录', at: 1 }] } }
const PROGRESS_FILTERING = { status: 200, payload: { jobId: 'job-1', phase: 'filtering', progress: [{ step: 'collecting', detail: '关键词：登录', at: 1 }, { step: 'filtering', detail: '候选 10→3', at: 2 }] } }

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

afterAll(() => {
  document.body.innerHTML = ''
})

describe('SearchView 非模态视图骨架', () => {
  it('open=true 渲染内容区视图（header/初始态/composer；无遮罩无 role=dialog）', async () => {
    const view = await mountView()
    expect(q('[data-fenix-sas="view"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(q('[data-fenix-sas="initial"]')).not.toBeNull()
    expect(q('[data-fenix-sas="header"]').textContent).toContain(UI_TEXT.dialogTitle)
    expect(q<HTMLInputElement>('input[data-fenix-sas="query"]').placeholder).toBe(UI_TEXT.queryPlaceholder)
    expect(q<HTMLInputElement>('input[data-fenix-sas="date-start"]')).not.toBeNull()
    expect(q('[data-fenix-sas="scope-workspace"]').textContent).toContain('全部工作区')
    await view.unmount()
  })

  it('open=false 渲染 null', async () => {
    const view = await mountView({ open: false })
    expect(document.querySelector('[data-fenix-sas="view"]')).toBeNull()
    await view.unmount()
  })
})

describe('SearchView 提交门控', () => {
  it('空/空白 query 禁用提交；输入后可用', async () => {
    const view = await mountView()
    const submit = (): HTMLButtonElement => q<HTMLButtonElement>('button[data-fenix-sas="submit"]')
    expect(submit().disabled).toBe(true)
    await typeQuery('   ')
    expect(submit().disabled).toBe(true)
    await typeQuery('登录调试')
    expect(submit().disabled).toBe(false)
    await view.unmount()
  })

  it('日期区间非法（结束早于开始）→ 提示 + 禁用；清空恢复', async () => {
    const view = await mountView()
    await typeQuery('q')
    const start = q<HTMLInputElement>('input[data-fenix-sas="date-start"]')
    const end = q<HTMLInputElement>('input[data-fenix-sas="date-end"]')
    setInputValue(start, '2026-01-02')
    setInputValue(end, '2026-01-01')
    await act(async () => {})
    expect(q<HTMLButtonElement>('button[data-fenix-sas="submit"]').disabled).toBe(true)
    expect(document.body.textContent).toContain('时间范围无效')
    setInputValue(end, '')
    await act(async () => {})
    expect(q<HTMLButtonElement>('button[data-fenix-sas="submit"]').disabled).toBe(false)
    await view.unmount()
  })

  it('header 时间范围 chip 随日期输入联动（无日期=全部时间）', async () => {
    const view = await mountView()
    expect(q('[data-fenix-sas="scope-time"]').textContent).toContain('全部时间')
    setInputValue(q<HTMLInputElement>('input[data-fenix-sas="date-start"]'), '2026-01-01')
    setInputValue(q<HTMLInputElement>('input[data-fenix-sas="date-end"]'), '2026-01-31')
    await act(async () => {})
    expect(q('[data-fenix-sas="scope-time"]').textContent).toContain('2026-01-01 ~ 2026-01-31')
    await view.unmount()
  })
})

describe('SearchView 关闭交互', () => {
  it('Esc → onClose；关闭按钮（官方 X）→ onClose', async () => {
    const view = await mountView()
    let closes = 0
    await view.rerender({ onClose: () => (closes += 1) })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(closes).toBe(1)
    await act(async () => {
      q<HTMLButtonElement>('button[aria-label="关闭"]').click()
    })
    expect(closes).toBe(2)
    await view.unmount()
  })
})

describe('SearchView 提交与轮询', () => {
  it('POST 载荷带 trim query + timeRange（Enter 提交同效）；轮询推进后渲染结果行', async () => {
    const results = [
      { sessionId: 's1', title: '登录修复', workspacePath: '/root/fenixd', activityTime: new Date(2026, 0, 2, 9, 30).getTime(), reason: '首条消息命中', confidence: 0.92 },
    ]
    const { fetchImpl, calls } = makeFetch([
      PROGRESS_COLLECTING,
      PROGRESS_FILTERING,
      { status: 200, payload: { jobId: 'job-1', phase: 'done', results } },
    ])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('  登录调试  ')
    setInputValue(q<HTMLInputElement>('input[data-fenix-sas="date-start"]'), '2026-01-01')
    setInputValue(q<HTMLInputElement>('input[data-fenix-sas="date-end"]'), '2026-01-31')
    await act(async () => {})
    // Enter 提交。
    const input = q<HTMLInputElement>('input[data-fenix-sas="query"]')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const post = calls.find((call) => call.method === 'POST')
    expect(post?.url).toBe(JOBS_PATH)
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      query: '登录调试',
      timeRange: { start: new Date(2026, 0, 1).getTime(), end: new Date(2026, 1, 1).getTime() },
    })
    // done：结果卡片渲染（标题/ws/时间/理由/置信度）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
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
    await view.unmount()
  })

  it('步骤流三态：collecting 进行中 → filtering 完成/analyzing 等待 → done 全完成', async () => {
    const { fetchImpl } = makeFetch([
      PROGRESS_COLLECTING,
      PROGRESS_FILTERING,
      { status: 200, payload: { jobId: 'job-1', phase: 'done', results: [], progress: [
        { step: 'collecting', detail: '关键词：登录', at: 1 },
        { step: 'filtering', detail: '候选 10→3', at: 2 },
        { step: 'analyzing', detail: '调用 AI 语义分析 · deepseek · deepseek-chat · 3 个候选', at: 3 },
        { step: 'done', detail: '完成：无匹配候选', at: 4 },
      ] } },
    ])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    const stepState = (step: string): string | null => q(`[data-fenix-sas="step"][data-step="${step}"]`).getAttribute('data-state')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(q('[data-fenix-sas="ai-panel"]')).not.toBeNull()
    expect(stepState('collecting')).toBe('run')
    expect(stepState('filtering')).toBe('wait')
    expect(q('[data-fenix-sas="step"][data-step="collecting"]').textContent).toContain('关键词：登录')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(stepState('collecting')).toBe('ok')
    expect(stepState('filtering')).toBe('run')
    expect(stepState('analyzing')).toBe('wait')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(stepState('collecting')).toBe('ok')
    expect(stepState('done')).toBe('ok')
    // host 实报的 analyzing 步骤 detail 可见（不伪造，报什么渲染什么）。
    expect(q('[data-fenix-sas="step"][data-step="analyzing"]').textContent).toContain('deepseek-chat')
    await view.unmount()
  })

  it('status-pill 本地计时逐 0.1s 刷新「分析中 · X.Xs」', async () => {
    const { fetchImpl } = makeFetch([]) // GET 恒 collecting（在途）
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(q('[data-fenix-sas="pill-text"]').textContent).toBe('分析中 · 1.0s')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(q('[data-fenix-sas="pill-text"]').textContent).toBe('分析中 · 2.5s')
    await view.unmount()
  })

  it('done 终态 status-pill 转完成态；AI 路径结果卡置信度条为 AI 渐变（非 mech）', async () => {
    const results = [{ sessionId: 's1', title: 't', workspacePath: '', activityTime: 1, reason: 'r', confidence: 0.8 }]
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', results } }])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(q('[data-fenix-sas="status-pill"]').getAttribute('data-pill')).toBe('done')
    expect(q('[data-fenix-sas="pill-text"]').textContent).toBe('AI 分析完成')
    expect(q('[data-fenix-sas="conf"]').getAttribute('data-mech')).toBeNull()
    expect(document.body.textContent).toContain('按 AI 相关性排序')
    await view.unmount()
  })

  it('候选点击 → onOpenSession(sessionId)', async () => {
    const results = [{ sessionId: 's9', title: 't', workspacePath: '', activityTime: 1, reason: 'r', confidence: 0.5 }]
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', results } }])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      q<HTMLButtonElement>('button[data-fenix-sas="result"]').click()
    })
    expect(view.openSessions).toEqual(['s9'])
    await view.unmount()
  })

  it('重复提交：在途期间再次提交 → DELETE 旧任务 + 新 POST', async () => {
    const { fetchImpl, calls } = makeFetch([]) // GET 恒 collecting（保持 in-flight）
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('第一次')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await typeQuery('第二次')
    await clickSubmit()
    const deleteCall = calls.find((call) => call.method === 'DELETE')
    expect(deleteCall?.url).toBe(`${API_PREFIX}/jobs/job-1`)
    const posts = calls.filter((call) => call.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1]?.body ?? '{}').query).toBe('第二次')
    await view.unmount()
  })
})

describe('SearchView 中断', () => {
  it('在途点中断 → DELETE 在途任务 + 面板消失回初始态', async () => {
    const { fetchImpl, calls } = makeFetch([]) // GET 恒 collecting（在途）
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(q('[data-fenix-sas="ai-panel"]')).not.toBeNull()
    await act(async () => {
      q<HTMLButtonElement>('button[data-fenix-sas="interrupt"]').click()
    })
    expect(calls.some((call) => call.method === 'DELETE' && call.url === `${API_PREFIX}/jobs/job-1`)).toBe(true)
    expect(document.querySelector('[data-fenix-sas="ai-panel"]')).toBeNull()
    expect(q('[data-fenix-sas="initial"]')).not.toBeNull()
    // 终态停轮：中断后不再产生 GET。
    const getCount = calls.filter((call) => call.method === 'GET').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(getCount)
    await view.unmount()
  })
})

describe('SearchView 降级横幅', () => {
  const DEGRADED_DONE = { status: 200, payload: { jobId: 'job-1', phase: 'done', degraded: true, degradedReason: 'credential-missing', results: [] } }

  it('done + degraded → 横幅按 degradedReason 映射文案', async () => {
    const { fetchImpl } = makeFetch([DEGRADED_DONE])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(q('[data-fenix-sas="degrade-banner"]')).not.toBeNull()
    expect(document.body.textContent).toContain(UI_TEXT.degradedReasonText['credential-missing'])
    expect(q('[data-fenix-sas="status-pill"]').getAttribute('data-pill')).toBe('fail')
    expect(document.body.textContent).toContain('机械搜索 · 已完成')
    await view.unmount()
  })

  it('credential-missing → 两动作按钮；设置缝缺失时点击展示 credentialHint 提示', async () => {
    const { fetchImpl } = makeFetch([DEGRADED_DONE])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).not.toContain(UI_TEXT.credentialHint)
    await act(async () => {
      q<HTMLButtonElement>('button[data-fenix-sas="go-credential"]').click()
    })
    expect(document.body.textContent).toContain(UI_TEXT.credentialHint)
    // 仅重试 AI 分析：回初始分析态（新任务轮询重启，面板复现）。
    await act(async () => {
      q<HTMLButtonElement>('button[data-fenix-sas="retry-ai"]').click()
    })
    expect(document.querySelector('[data-fenix-sas="ai-panel"]')).not.toBeNull()
    await view.unmount()
  })

  it('设置缝在位（onOpenModelSettings）→ 点击直达回调，不展示提示文案', async () => {
    const { fetchImpl } = makeFetch([DEGRADED_DONE])
    vi.useFakeTimers()
    const opens: number[] = []
    const view = await mountView({ fetchImpl, onOpenModelSettings: () => opens.push(1) })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      q<HTMLButtonElement>('button[data-fenix-sas="go-credential"]').click()
    })
    expect(opens).toEqual([1])
    expect(document.body.textContent).not.toContain(UI_TEXT.credentialHint)
    await view.unmount()
  })

  it('retry-ai → 重新 POST 同 query（新任务轮询重启）', async () => {
    const { fetchImpl, calls } = makeFetch([DEGRADED_DONE])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('找会话')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      q<HTMLButtonElement>('button[data-fenix-sas="retry-ai"]').click()
    })
    const posts = calls.filter((call) => call.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1]?.body ?? '{}').query).toBe('找会话')
    await view.unmount()
  })

  it('非凭证降级（timeout）→ 横幅无动作按钮', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', degraded: true, degradedReason: 'timeout', results: [] } }])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.degradedReasonText.timeout)
    expect(document.querySelector('button[data-fenix-sas="go-credential"]')).toBeNull()
    expect(document.querySelector('button[data-fenix-sas="retry-ai"]')).toBeNull()
    await view.unmount()
  })

  it('机械降级结果行置信度条为 mech 灰（data-mech 标注）', async () => {
    const results = [{ sessionId: 's1', title: 't', workspacePath: '', activityTime: 1, reason: '机械匹配：标题关键词命中（2 分）', confidence: 1, degraded: true }]
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', degraded: true, degradedReason: 'parse-failed', results } }])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(q('[data-fenix-sas="conf"]').getAttribute('data-mech')).toBe('true')
    expect(document.body.textContent).toContain('按机械匹配排序')
    await view.unmount()
  })
})

describe('SearchView 错误与空态', () => {
  it('done + 零结果 → 空态文案', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'done', results: [] } }])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.empty)
    await view.unmount()
  })

  it('error 终态 → 「搜索失败」+ message', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, payload: { jobId: 'job-1', phase: 'error', message: '收集失败：磁盘不可读' } }])
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(document.body.textContent).toContain(UI_TEXT.failed)
    expect(document.body.textContent).toContain('收集失败：磁盘不可读')
    await view.unmount()
  })

  it('POST 404 → 服务未启用提示；轮询 404 → 任务丢失提示', async () => {
    const { fetchImpl } = makeFetch()
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl: async (input, init) => ((init?.method ?? 'GET') === 'POST' ? { ok: false, status: 404, json: async () => ({}) } : fetchImpl(input, init)) })
    await typeQuery('q')
    await clickSubmit()
    expect(document.body.textContent).toContain('高级搜索服务未启用')
    await view.unmount()

    const calls2: Call[] = []
    const fetch404: FetchFace = async (input, init) => {
      const method = init?.method ?? 'GET'
      calls2.push({ method, url: input, body: init?.body })
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({ jobId: 'job-9' }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }
    const view2 = await mountView({ fetchImpl: fetch404 })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls2.some((call) => call.method === 'GET' && call.url === `${JOBS_PATH}/job-9`)).toBe(true)
    expect(document.body.textContent).toContain('任务已丢失')
    await view2.unmount()
  })
})

describe('SearchView 关闭重开状态重置', () => {
  it('关闭时 DELETE 在途任务；重开后输入/结果清空', async () => {
    const { fetchImpl, calls } = makeFetch([]) // 恒 collecting（在途）
    vi.useFakeTimers()
    const view = await mountView({ fetchImpl })
    await typeQuery('q')
    await clickSubmit()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls.some((call) => call.method === 'GET')).toBe(true)
    // 关闭（onClose 被装配调用后 open 变 false）：在途 DELETE + 状态重置。
    await view.rerender({ open: false })
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    // 重开：全新状态（输入与结果清空，无残留结果卡）。
    await view.rerender({ open: true })
    expect(q<HTMLInputElement>('input[data-fenix-sas="query"]').value).toBe('')
    expect(document.querySelector('[data-fenix-sas="result"]')).toBeNull()
    expect(q('[data-fenix-sas="initial"]')).not.toBeNull()
    await view.unmount()
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
