/**
 * pluginLocale 单测（i18n 宿主跟随轮）：插件自绘控件文案的双语词典与宿主档
 * 跟随——zh 缺省降级（宿主语言能力缺席 = 现状中文零回归）、宿主 zh/en 档
 * 映射、白名单外值忽略（last-known-good）、未知键回退、复合串出口形态钉值
 * （locateMenuLabel 的 2026-11-11 用户需求原文 / wsTooltipStatsLine 三段）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { locateMenuLabel, pluginLocale, pluginT, resetPluginLocale, setPluginLocale } from '../src/client/pluginLocale.js'

afterEach(() => resetPluginLocale())

describe('宿主档缓存', () => {
  it('缺省 undefined（降级 zh）；宿主原始值映射 zh/en；白名单外忽略', () => {
    expect(pluginLocale()).toBeUndefined()
    setPluginLocale('zh')
    expect(pluginLocale()).toBe('zh-CN')
    setPluginLocale('en')
    expect(pluginLocale()).toBe('en-US')
    setPluginLocale('ja')
    setPluginLocale(undefined)
    setPluginLocale({ active: 'zh' })
    expect(pluginLocale()).toBe('en-US') // last-known-good
    resetPluginLocale()
    expect(pluginLocale()).toBeUndefined()
  })
})

describe('文案取值', () => {
  it('未喂档降级 zh：与既有中文文案逐字节一致（零回归锚）', () => {
    expect(pluginT('wsTooltip.status.drafted')).toBe('草稿')
    expect(pluginT('wsTooltip.status.pushed')).toBe('已推送')
    expect(locateMenuLabel('fenixd')).toBe('在 fenixd 项目定位')
  })

  it('宿主 en 档取英文列；切回 zh 即时生效', () => {
    setPluginLocale('en')
    expect(pluginT('wsTooltip.status.drafted')).toBe('Drafted')
    expect(pluginT('wsTooltip.running.unmanaged')).toBe('Running · unmanaged')
    expect(pluginT('wsTooltip.noDesc')).toBe('No description')
    expect(locateMenuLabel('fenixd')).toBe('Locate in fenixd project')
    setPluginLocale('zh')
    expect(pluginT('wsTooltip.status.drafted')).toBe('草稿')
  })

  it('未知键回退键名（开发期可见，不静默空串）', () => {
    expect(pluginT('wsTooltip.status.nonexistent')).toBe('wsTooltip.status.nonexistent')
  })
})

describe('菜单词典（i18n 宿主跟随轮：侧栏固定条目 label）', () => {
  it('缺省 zh 逐字=FIXED_ENTRIES 钉串；en 档即时切换；切回 zh 生效', () => {
    expect(pluginT('menu.fenix-overview')).toBe('概览')
    expect(pluginT('menu.fenix-command-center')).toBe('指挥中心')
    expect(pluginT('menu.fenix-settings')).toBe('配置')
    expect(pluginT('menu.fenix-activities')).toBe('运维')
    expect(pluginT('menu.fenix-help')).toBe('帮助')
    setPluginLocale('en')
    expect(pluginT('menu.fenix-overview')).toBe('Overview')
    expect(pluginT('menu.fenix-command-center')).toBe('Command Center')
    expect(pluginT('menu.fenix-settings')).toBe('Config')
    expect(pluginT('menu.fenix-activities')).toBe('Ops')
    expect(pluginT('menu.fenix-help')).toBe('Help')
    setPluginLocale('zh')
    expect(pluginT('menu.fenix-overview')).toBe('概览')
  })
})
