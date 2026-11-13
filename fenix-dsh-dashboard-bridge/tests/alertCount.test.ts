/**
 * alertCount 单测（add-dsh-ops-alert-badge）：
 * - 口径过滤：spec 场景逐字——`total_unhandled=14` 且 `alerts[]` 14 条中仅
 *   1 条 `choices` 非空 → 计数 1（与 dashboard 徽标同数，不用 total_unhandled）；
 * - 形状漂移：`alerts` 缺失/非数组/行级漂移按 0，不抛未处理异常；
 * - fetchAlertCount：URL 契约（`<prefix>api/alerts`）+ AbortController signal
 *   传递（10s 超时口径常量钉值）+ !ok 抛错；
 * - 同步循环（timer 桩）：60s 周期与 focus 触发、失败/超时保留最后已知值
 *   （不归零）、停止函数收口全部计时器与 focus 监听、node 环境整体跳过。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FETCH_ALERTS_TIMEOUT_MS,
  alertCountStore,
  fetchAlertCount,
  parseAlertCount,
  startAlertCountSync,
} from '../src/client/alertCount.js'
import { DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS } from '../src/client/projectSync.js'
import type { AlertCountStore } from '../src/client/alertCount.js'
import type { SyncTimer } from '../src/client/projectSync.js'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 等待启动拉取/触发拉取落定（pull → setCount → 订阅回调）。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await tick()
}

/** 记录型轻量 store（注入隔离，不与模块单例互相污染）。 */
function recordingStore(): AlertCountStore & { readonly counts: readonly (number | null)[] } {
  const counts: (number | null)[] = []
  let snapshot: { count: number | null } = { count: null }
  const listeners = new Set<() => void>()
  return {
    counts,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setCount(count: number) {
      if (snapshot.count === count) return
      snapshot = { count }
      counts.push(count)
      for (const listener of listeners) listener()
    },
    reset() {
      snapshot = { count: null }
      counts.length = 0
      for (const listener of listeners) listener()
    },
  }
}

function fakeTimer(): SyncTimer & {
  triggerInterval(): void
  triggerFocus(): void
  cleared: boolean
  focusUnsubscribed: boolean
  intervalMs: number | undefined
} {
  let intervalFn: (() => void) | undefined
  let focusFn: (() => void) | undefined
  const state = {
    cleared: false,
    focusUnsubscribed: false,
    intervalMs: undefined as number | undefined,
    triggerInterval() {
      void intervalFn?.()
    },
    triggerFocus() {
      void focusFn?.()
    },
  }
  return {
    get cleared() {
      return state.cleared
    },
    get focusUnsubscribed() {
      return state.focusUnsubscribed
    },
    get intervalMs() {
      return state.intervalMs
    },
    triggerInterval: state.triggerInterval,
    triggerFocus: state.triggerFocus,
    setInterval(fn, ms) {
      intervalFn = fn
      state.intervalMs = ms
      return Symbol('interval-handle')
    },
    clear() {
      state.cleared = true
    },
    onFocus(fn) {
      focusFn = fn
      return () => {
        state.focusUnsubscribed = true
      }
    },
  }
}

/** 14 条告警（total_unhandled=14 语义）中仅第 7 条带非空 choices。 */
function specScenarioPayload(): unknown {
  const alerts = Array.from({ length: 14 }, (_, index) => ({
    id: `a${index}`,
    choices: index === 6 ? ['approve', 'reject'] : [],
  }))
  return { total_unhandled: 14, alerts }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseAlertCount（口径过滤，与 dashboard 徽标同数）', () => {
  it('spec 场景逐字：total_unhandled=14 且 14 条中仅 1 条 choices 非空 → 计数 1（不用 total_unhandled）', () => {
    expect(parseAlertCount(specScenarioPayload())).toBe(1)
  })

  it('choices 判据逐字：非数组 choices、choices 空数组、缺失 choices 均不计；非空数组计 1', () => {
    expect(
      parseAlertCount({
        alerts: [
          { choices: [] },
          { choices: 'bad' },
          { choices: null },
          {},
          { choices: ['one'] },
          { choices: [1, 2] },
        ],
      }),
    ).toBe(2)
  })

  it('alerts 形状漂移按 0：缺失/非数组/null，不抛未处理异常', () => {
    expect(parseAlertCount({})).toBe(0)
    expect(parseAlertCount({ alerts: 'bad' })).toBe(0)
    expect(parseAlertCount({ alerts: null })).toBe(0)
    expect(parseAlertCount(null)).toBe(0)
    expect(parseAlertCount(undefined)).toBe(0)
    expect(parseAlertCount({ alerts: { length: 3 } })).toBe(0)
  })
})

describe('fetchAlertCount（URL 契约 + 超时口径 + !ok 抛错）', () => {
  it('GET <prefix>api/alerts 携 AbortController signal，解析 alerts 口径', async () => {
    const fetchMock = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => specScenarioPayload() }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchAlertCount('/fenix-dashboard/')).resolves.toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/fenix-dashboard/api/alerts')
    expect(init?.headers).toEqual({ accept: 'application/json' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('!ok 抛错（HTTP 500），错误消息带状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    )
    await expect(fetchAlertCount('/fenix-dashboard/')).rejects.toThrow('HTTP 500')
  })

  it('超时口径常量钉值：10s（同 fetchProjectRowsWithTimeout）', () => {
    expect(FETCH_ALERTS_TIMEOUT_MS).toBe(10_000)
  })
})

describe('startAlertCountSync（timer 桩：节奏/降级/收口）', () => {
  beforeEach(() => {
    alertCountStore.reset()
  })

  it('缺省周期 60s（DEFAULT_POLL_INTERVAL_MS）；启动立即拉取一次并写入 store', async () => {
    const store = recordingStore()
    const timer = fakeTimer()
    const fetchCount = vi.fn(() => Promise.resolve(3))
    const stop = startAlertCountSync({ fetchCount, timer, store })
    await settle()
    expect(timer.intervalMs).toBe(DEFAULT_POLL_INTERVAL_MS)
    expect(fetchCount).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().count).toBe(3)
    stop()
  })

  it('周期触发与 focus 触发各重拉一次，徽标随最新口径更新', async () => {
    const store = recordingStore()
    const timer = fakeTimer()
    const fetchCount = vi.fn(() => Promise.resolve(1))
    const stop = startAlertCountSync({ fetchCount, timer, store })
    await settle()
    timer.triggerInterval()
    await settle()
    timer.triggerFocus()
    await settle()
    expect(fetchCount).toHaveBeenCalledTimes(3)
    expect(store.getSnapshot().count).toBe(1)
    stop()
  })

  it('失败保留最后已知值：先成功 1 → 再抛错 → store 仍 1（不归零），warn 落日志', async () => {
    const store = recordingStore()
    const timer = fakeTimer()
    let fail = false
    const fetchCount = vi.fn((): Promise<number> => (fail ? Promise.reject(new Error('upstream down')) : Promise.resolve(1)))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = startAlertCountSync({ fetchCount, timer, store })
    await settle()
    expect(store.getSnapshot().count).toBe(1)
    fail = true
    timer.triggerInterval()
    await settle()
    expect(store.getSnapshot().count).toBe(1) // 不归零不闪烁
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('拉取告警计数失败')
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('upstream down')
    stop()
  })

  it('在飞防重入：focus 与周期同拍只发一次拉取', async () => {
    const store = recordingStore()
    const timer = fakeTimer()
    let release: (() => void) | undefined
    const fetchCount = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(7)
        }),
    )
    const stop = startAlertCountSync({ fetchCount, timer, store })
    await tick()
    timer.triggerInterval()
    timer.triggerFocus()
    release?.()
    await settle()
    expect(fetchCount).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().count).toBe(7)
    stop()
  })

  it('停止函数收口：清周期定时器、退订 focus；停止后触发不再拉取（无残留计时器）', async () => {
    const store = recordingStore()
    const timer = fakeTimer()
    const fetchCount = vi.fn(() => Promise.resolve(2))
    const stop = startAlertCountSync({ fetchCount, timer, store })
    await settle()
    stop()
    expect(timer.cleared).toBe(true)
    expect(timer.focusUnsubscribed).toBe(true)
    const callsAfterStop = fetchCount.mock.calls.length
    timer.triggerInterval()
    timer.triggerFocus()
    await settle()
    expect(fetchCount.mock.calls.length).toBe(callsAfterStop)
    expect(() => stop()).not.toThrow() // 幂等
  })

  it('intervalMs 非法回退缺省、低于下界钳到 5s（归一口径同 startProjectSync）', async () => {
    const store = recordingStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t1 = fakeTimer()
    const stop1 = startAlertCountSync({ fetchCount: () => Promise.resolve(0), timer: t1, store, intervalMs: Number.NaN })
    expect(t1.intervalMs).toBe(DEFAULT_POLL_INTERVAL_MS)
    stop1()
    const t2 = fakeTimer()
    const stop2 = startAlertCountSync({ fetchCount: () => Promise.resolve(0), timer: t2, store, intervalMs: 50 })
    expect(t2.intervalMs).toBe(MIN_POLL_INTERVAL_MS)
    stop2()
    await settle()
    warnSpy.mockRestore()
  })

  it('store 无变化零通知：同值重拉不触发订阅回调', async () => {
    const store = recordingStore()
    const timer = fakeTimer()
    const notifications: (number | null)[] = []
    const unsubscribe = store.subscribe(() => notifications.push(store.getSnapshot().count))
    const stop = startAlertCountSync({ fetchCount: () => Promise.resolve(4), timer, store })
    await settle()
    timer.triggerInterval()
    await settle()
    expect(notifications).toEqual([4]) // 仅首拉一次通知（null→4）
    unsubscribe()
    stop()
  })
})

describe('node 环境整体跳过（无 window 且未注入 timer 桩）', () => {
  it('startAlertCountSync 返回 no-op 停止函数，零拉取零计时器泄漏', async () => {
    expect(typeof window).toBe('undefined')
    const fetchCount = vi.fn(() => Promise.resolve(5))
    const stop = startAlertCountSync({ fetchCount })
    await settle()
    expect(fetchCount).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })
})
