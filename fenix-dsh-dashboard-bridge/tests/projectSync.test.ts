/**
 * Client 半单测：reconcile 三态与幂等、失败兜底、同步循环（假定时器/焦点桩）、
 * 项目列表解析。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLL_INTERVAL_MS,
  PROJECT_ORDER_BASE,
  compareNames,
  parseProjectNames,
  reconcileProjects,
  startProjectSync,
} from '../src/client/projectSync.js'
import type { ProjectEntrySink, SyncTimer } from '../src/client/projectSync.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

interface RecordingSink extends ProjectEntrySink {
  readonly added: { name: string; order: number }[]
  readonly removed: string[]
  calls(): number
}

function recordingSink(): RecordingSink {
  const added: { name: string; order: number }[] = []
  const removed: string[] = []
  return {
    added,
    removed,
    addProject(project) {
      added.push({ name: project.name, order: project.order })
    },
    removeProject(name) {
      removed.push(name)
    },
    calls: () => added.length + removed.length,
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

describe('reconcileProjects（指纹幂等）', () => {
  it('新增：空 → [b,a] 按名称序注册，order 从 100 起', () => {
    const sink = recordingSink()
    const next = reconcileProjects(new Map(), ['b', 'a'], sink)
    expect(sink.added).toEqual([
      { name: 'a', order: PROJECT_ORDER_BASE },
      { name: 'b', order: PROJECT_ORDER_BASE + 1 },
    ])
    expect(sink.removed).toEqual([])
    expect([...next.entries()]).toEqual([
      ['a', 100],
      ['b', 101],
    ])
  })

  it('移除：消失项目 dispose，保留项零操作', () => {
    const sink = recordingSink()
    const next = reconcileProjects(
      new Map([
        ['a', 100],
        ['b', 101],
      ]),
      ['a'],
      sink,
    )
    expect(sink.removed).toEqual(['b'])
    expect(sink.added).toEqual([])
    expect([...next.entries()]).toEqual([['a', 100]])
  })

  it('无变化：指纹一致零操作（连续同列表零重注册）', () => {
    const sink = recordingSink()
    const current = new Map([
      ['a', 100],
      ['b', 101],
    ])
    const once = reconcileProjects(current, ['a', 'b'], sink)
    expect(sink.calls()).toBe(0)
    const twice = reconcileProjects(once, ['b', 'a'], sink)
    expect(sink.calls()).toBe(0)
    expect(twice).toEqual(once)
  })

  it('中间插入：新项按名称序入位，位次后移的既有项重注册，其余不动', () => {
    const sink = recordingSink()
    const next = reconcileProjects(
      new Map([
        ['a', 100],
        ['c', 101],
      ]),
      ['a', 'b', 'c'],
      sink,
    )
    // c 从 order 101 移到 102 → 先注销再重注册；a 保持 100 不动。
    expect(sink.removed).toEqual(['c'])
    expect(sink.added).toEqual([
      { name: 'b', order: 101 },
      { name: 'c', order: 102 },
    ])
    expect([...next.entries()]).toEqual([
      ['a', 100],
      ['b', 101],
      ['c', 102],
    ])
  })

  it('重复名去重后按名称序编 order', () => {
    const sink = recordingSink()
    const next = reconcileProjects(new Map(), ['x', 'x', 'a'], sink)
    expect(sink.added).toEqual([
      { name: 'a', order: 100 },
      { name: 'x', order: 101 },
    ])
    expect(next.size).toBe(2)
  })

  it('compareNames 码点序确定', () => {
    expect(compareNames('a', 'b')).toBe(-1)
    expect(compareNames('b', 'a')).toBe(1)
    expect(compareNames('same', 'same')).toBe(0)
  })
})

describe('parseProjectNames', () => {
  it('解析 {projects:[{name}]} 形状', () => {
    expect(parseProjectNames({ projects: [{ name: 'fenixd' }, { name: 'dsh-plugins' }] })).toEqual([
      'fenixd',
      'dsh-plugins',
    ])
  })

  it('空数组合法', () => {
    expect(parseProjectNames({ projects: [] })).toEqual([])
  })

  it('缺失/非字符串 name 的行静默跳过', () => {
    expect(parseProjectNames({ projects: [{ name: 'a' }, {}, { name: 42 }, null, { name: 'b' }] })).toEqual(['a', 'b'])
  })

  it('形状异常抛错（按拉取失败处理）', () => {
    expect(() => parseProjectNames({ items: [] })).toThrow(/projects/)
    expect(() => parseProjectNames(null)).toThrow(/projects/)
    expect(() => parseProjectNames({ projects: 'nope' })).toThrow(/projects/)
  })
})

describe('startProjectSync 同步循环', () => {
  it('启动即拉取；周期与焦点触发重拉；幂等；stop 后不再拉取', async () => {
    let list: string[] = ['a']
    let fetchCalls = 0
    const timer = fakeTimer()
    const sink = recordingSink()

    const stop = startProjectSync({
      fetchProjects: async () => {
        fetchCalls += 1
        return list
      },
      sink,
      intervalMs: 1234,
      timer,
    })
    await tick()
    expect(fetchCalls).toBe(1)
    expect(sink.added).toEqual([{ name: 'a', order: 100 }])
    expect(timer.intervalMs).toBe(1234)

    // 周期触发：列表变化 → 差异注册。
    list = ['a', 'b']
    timer.triggerInterval()
    await tick()
    expect(sink.added).toEqual([
      { name: 'a', order: 100 },
      { name: 'b', order: 101 },
    ])

    // 焦点触发：列表无变化 → 零操作。
    timer.triggerFocus()
    await tick()
    expect(sink.calls()).toBe(2)

    // stop：清定时器 + 退订焦点 + 停止拉取。
    stop()
    expect(timer.cleared).toBe(true)
    expect(timer.focusUnsubscribed).toBe(true)
    const callsAtStop = fetchCalls
    timer.triggerInterval()
    timer.triggerFocus()
    await tick()
    expect(fetchCalls).toBe(callsAtStop)
    expect(sink.calls()).toBe(2)

    // 再次 stop 安全。
    expect(() => stop()).not.toThrow()
  })

  it('默认周期为 60s；默认计时器在 node（无 window）下焦点订阅为 no-op', () => {
    const stop = startProjectSync({
      fetchProjects: async () => [],
      sink: recordingSink(),
      timer: undefined,
    })
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(60_000)
    expect(() => stop()).not.toThrow()
  })

  it('fetch reject 失败兜底：sink 不动、无未处理异常，下一轮恢复同步', async () => {
    let shouldFail = true
    const timer = fakeTimer()
    const sink = recordingSink()
    const stop = startProjectSync({
      fetchProjects: async () => {
        if (shouldFail) throw new Error('upstream down')
        return ['a']
      },
      sink,
      intervalMs: 1000,
      timer,
    })
    await tick()
    await tick()
    expect(sink.calls()).toBe(0)

    shouldFail = false
    timer.triggerInterval()
    await tick()
    expect(sink.added).toEqual([{ name: 'a', order: 100 }])
    stop()
  })

  it('空列表：全部项目条目 dispose（仅固定条目保留），不抛异常', async () => {
    const timer = fakeTimer()
    const sink = recordingSink()
    let list: string[] = ['a', 'b']
    const stop = startProjectSync({
      fetchProjects: async () => list,
      sink,
      intervalMs: 1000,
      timer,
    })
    await tick()
    expect(sink.calls()).toBe(2)

    list = []
    timer.triggerInterval()
    await tick()
    expect(sink.removed.sort()).toEqual(['a', 'b'])
    expect(sink.added).toHaveLength(2)
    stop()
  })
})
