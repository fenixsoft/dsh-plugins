/**
 * loader config 解析归一：缺省生效、显式抛错（非法输入装载期失败，不静默取缺省）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_PROJECTS,
  DEFAULT_QUIET_MINUTES,
  resolveSettings,
} from '../src/host/settings.js'

describe('resolveSettings 缺省', () => {
  it('undefined / null → 全缺省（projects/quiet/interval/enabled）', () => {
    for (const raw of [undefined, null]) {
      const s = resolveSettings(raw)
      expect(s.projects).toEqual(DEFAULT_PROJECTS)
      expect(s.quietMs).toBe(DEFAULT_QUIET_MINUTES * 60_000)
      expect(s.intervalMs).toBe(DEFAULT_INTERVAL_MINUTES * 60_000)
      expect(s.enabled).toBe(true)
    }
  })

  it('空对象 {} → 全缺省', () => {
    const s = resolveSettings({})
    expect(s.projects).toEqual(['/root/fenixd', '/root/dsh-plugins'])
    expect(s.quietMs).toBe(30 * 60_000)
    expect(s.intervalMs).toBe(10 * 60_000)
    expect(s.enabled).toBe(true)
  })
})

describe('resolveSettings 显式合法覆盖', () => {
  it('全量覆盖', () => {
    const s = resolveSettings({ projects: ['/opt/x', '/opt/y'], quietMinutes: 5, intervalMinutes: 1, enabled: false })
    expect(s.projects).toEqual(['/opt/x', '/opt/y'])
    expect(s.quietMs).toBe(5 * 60_000)
    expect(s.intervalMs).toBe(60_000)
    expect(s.enabled).toBe(false)
  })

  it('projects=[] 合法（零迁移零注册）', () => {
    expect(resolveSettings({ projects: [] }).projects).toEqual([])
  })

  it('projects 重复根去重保序', () => {
    expect(resolveSettings({ projects: ['/a', '/b', '/a'] }).projects).toEqual(['/a', '/b'])
  })

  it('部分键覆盖：其余键落缺省', () => {
    const s = resolveSettings({ quietMinutes: 15 })
    expect(s.quietMs).toBe(15 * 60_000)
    expect(s.projects).toEqual(DEFAULT_PROJECTS)
    expect(s.intervalMs).toBe(10 * 60_000)
  })
})

describe('resolveSettings 非法输入显式抛错', () => {
  const bad: ReadonlyArray<[string, object]> = [
    ['projects 非数组', { projects: '/root/fenixd' }],
    ['projects 含非字符串', { projects: ['/root/fenixd', 42] }],
    ['projects 含空串', { projects: [''] }],
    ['projects 含相对路径', { projects: ['rel/path'] }],
    ['quietMinutes 非数', { quietMinutes: 'x' }],
    ['quietMinutes 零', { quietMinutes: 0 }],
    ['quietMinutes 负数', { quietMinutes: -3 }],
    ['quietMinutes 非整数', { quietMinutes: 1.5 }],
    ['intervalMinutes 非数', { intervalMinutes: true }],
    ['intervalMinutes 零', { intervalMinutes: 0 }],
    ['enabled 非布尔', { enabled: 'yes' }],
  ]
  for (const [label, raw] of bad) {
    it(`${label} → 抛 TypeError 不静默取缺省`, () => {
      expect(() => resolveSettings(raw as never)).toThrow(TypeError)
    })
  }
})
