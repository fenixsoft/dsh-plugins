/**
 * 菜单语言即时刷新单测（i18n 宿主跟随轮）：fixedEntryLabelThunk 求值档随
 * pluginLocale 切换；installMenuLocaleRefresher 在 locale/change 时对 4 条目
 * 遮蔽重注册（priority -10 + 词典 thunk label + icon 单例；fenix-activities 的
 * -10 遮蔽位归 installOpsAlertBadge 独占、由其订阅 locale/change 自行重注册，
 * 见 2026-11-26 review e8a287ba1bee），收口清注册退订。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fixedEntryLabelThunk } from '../src/client/panels.js'
import { installMenuLocaleRefresher } from '../src/client/index.js'
import { resetPluginLocale, setPluginLocale } from '../src/client/pluginLocale.js'

afterEach(() => resetPluginLocale())

describe('fixedEntryLabelThunk', () => {
  it('普通条目求值=词典当前档（string）；运维条目求值含计数 pill（ReactElement）', () => {
    expect(fixedEntryLabelThunk('fenix-overview')()).toBe('概览')
    setPluginLocale('en')
    expect(fixedEntryLabelThunk('fenix-overview')()).toBe('Overview')
    const ops = fixedEntryLabelThunk('fenix-activities')()
    expect(typeof ops).toBe('object')
    expect(JSON.stringify(ops)).toContain('Ops')
  })
})

type RegisteredEntry = { options: Record<string, unknown>; component: unknown }

function makeStubCtx() {
  const registered: RegisteredEntry[] = []
  const disposed: RegisteredEntry[] = []
  let listener: ((snapshot: unknown) => void) | undefined
  const ctx = {
    slots: {
      register: (options: Record<string, unknown>, component: unknown) => {
        const entry = { options, component }
        registered.push(entry)
        return () => disposed.push(entry)
      },
    },
    locale: { getSnapshot: () => ({ active: 'zh' }) },
    on: (_event: 'locale/change', fn: (snapshot: unknown) => void) => {
      listener = fn
      return () => {
        listener = undefined
      }
    },
    fire: (snapshot: unknown) => listener?.(snapshot),
  }
  return { ctx, registered, disposed }
}

describe('installMenuLocaleRefresher', () => {
  it('locale/change → 4 条目遮蔽重注册（-10 + 词典 thunk，跳过 fenix-activities）；en 档求值即英文', () => {
    const { ctx, registered, disposed } = makeStubCtx()
    const stop = installMenuLocaleRefresher(ctx as never)
    // 真实装配链：installLocaleFollow 先于本刷新器订阅并在其回调喂
    // setPluginLocale——本桩按同一语义先喂档再触发事件。
    setPluginLocale('en')
    ctx.fire({ active: 'en' })
    expect(registered).toHaveLength(4)
    for (const entry of registered) {
      expect(entry.options.priority).toBe(-10)
      expect(typeof entry.options.label).toBe('function')
      expect(entry.options.id).not.toBe('fenix-activities')
    }
    const labels = registered.map((e) => (e.options.label as () => unknown)())
    expect(labels[0]).toBe('Overview')
    expect(labels[2]).toBe('Config')
    expect(labels[3]).toBe('Help')
    stop()
  })

  it('重注册幂等：再次切换先收旧遮蔽再注册；收口清全部遮蔽注册', () => {
    const { ctx, registered, disposed } = makeStubCtx()
    const stop = installMenuLocaleRefresher(ctx as never)
    ctx.fire({ active: 'en' })
    ctx.fire({ active: 'zh' })
    expect(registered).toHaveLength(8) // 4 × 2 轮
    expect(disposed).toHaveLength(4) // 每轮先收上一轮
    expect(String((registered[4]?.options.label as () => unknown)())).toBe('概览')
    stop()
    expect(disposed).toHaveLength(8) // 收口清本轮全部
    ctx.fire({ active: 'en' }) // 退订后事件不再触发
    expect(registered).toHaveLength(8)
  })
})
