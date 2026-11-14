import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WORKSPACE_ROW_SELECTOR } from '../src/client/panels.js'
import {
  INTERACTIVE_PORTAL_ROLE_SELECTOR,
  WORKSPACE_ROW_SELECTOR_MIRROR,
  looksLikeAppRoot,
  looksLikeInteractivePortal,
} from '../src/client/wsTooltip.js'

const src = (): string =>
  readFileSync(fileURLToPath(new URL('../src/client/wsTooltip.ts', import.meta.url)), 'utf8')

describe('looksLikeInteractivePortal（2026-11-11 文件右键菜单隐身回归守卫）', () => {
  it('role=menu 自身命中（querySelector 不含自身，须 matches 双查）', () => {
    const node = { matches: (s: string) => s.includes('[role="menu"]'), querySelector: () => null }
    expect(looksLikeInteractivePortal(node)).toBe(true)
  })

  it('内嵌菜单/对话框/下拉的 wrapper 命中', () => {
    const node = {
      matches: () => false,
      querySelector: (s: string) => (s.includes('[role="dialog"]') ? ({} as Element) : null),
    }
    expect(looksLikeInteractivePortal(node)).toBe(true)
  })

  it('原生 tooltip 门户（无交互角色）不命中', () => {
    const node = { matches: () => false, querySelector: () => null }
    expect(looksLikeInteractivePortal(node)).toBe(false)
  })

  it('DOM 异常安全（返回 false 不抛）', () => {
    const node = {
      matches: () => {
        throw new Error('detached')
      },
      querySelector: () => null,
    }
    expect(looksLikeInteractivePortal(node)).toBe(false)
  })

  it('选择器覆盖 menu/menuitem/dialog/alertdialog/listbox/option', () => {
    for (const role of ['menu', 'menuitem', 'dialog', 'alertdialog', 'listbox', 'option']) {
      expect(INTERACTIVE_PORTAL_ROLE_SELECTOR).toContain(`[role="${role}"]`)
    }
  })
})

describe('wsTooltip 源码钉（消解器交互面守卫接线）', () => {
  it('hideIfMatch 在文本匹配前调用交互面守卫', () => {
    const s = src()
    const hideIdx = s.indexOf('const hideIfMatch')
    const guardIdx = s.indexOf('looksLikeInteractivePortal(node)) return')
    expect(hideIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeGreaterThan(hideIdx)
  })

  it('守卫位于 hidden.has 去重之前（先排除后去重，次序无关正确性但钉住现状）', () => {
    const s = src()
    const guardIdx = s.indexOf('looksLikeInteractivePortal(node)) return')
    const dedupeIdx = s.indexOf("if (hidden.has(node)) return")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(dedupeIdx).toBeGreaterThan(guardIdx)
  })

  it('定位菜单项文案内嵌项目名——回归根因记录钉', () => {
    const locate = readFileSync(
      fileURLToPath(new URL('../src/client/locate.ts', import.meta.url)),
      'utf8',
    )
    expect(locate).toContain('在 ${hit.name} 项目定位')
    expect(src()).toContain('文件右键弹不出来')
  })
})

describe('looksLikeAppRoot（2026-11-14 整树挂载白屏加固守卫）', () => {
  it('子树含工作区行（镜像选择器）→ 应用级容器命中', () => {
    const node = {
      querySelector: (s: string) => (s.includes('[data-row-key^="workspace:"]') ? ({} as Element) : null),
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    }
    expect(looksLikeAppRoot(node, { width: 1024, height: 768 })).toBe(true)
  })

  it('尺寸覆盖视口宽高大半（应用根特征）命中', () => {
    const node = {
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 900, height: 700 }),
    }
    expect(looksLikeAppRoot(node, { width: 1024, height: 768 })).toBe(true)
  })

  it('小浮层（原生 tooltip 门户量级）不命中', () => {
    const node = {
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 244, height: 60 }),
    }
    expect(looksLikeAppRoot(node, { width: 1024, height: 768 })).toBe(false)
  })

  it('视口为 0（无布局环境 jsdom/SSR）时尺寸判据不参与', () => {
    const node = {
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 1024, height: 768 }),
    }
    expect(looksLikeAppRoot(node, { width: 0, height: 0 })).toBe(false)
  })

  it('行选择器镜像与 panels 钉值同值（不 import panels，互钉防漂移）', () => {
    expect(WORKSPACE_ROW_SELECTOR_MIRROR).toBe(WORKSPACE_ROW_SELECTOR)
    expect(WORKSPACE_ROW_SELECTOR_MIRROR).toBe('[data-row-key^="workspace:"]')
  })
})

describe('wsTooltip 源码钉（消解器应用根守卫接线 + 存量惰性补扫 + show 收窄在前）', () => {
  it('hideIfMatch 在交互面守卫之后、去重之前调用应用根守卫（整树挂载白屏加固钉）', () => {
    const s = src()
    const hideIdx = s.indexOf('const hideIfMatch')
    const appRootIdx = s.indexOf('looksLikeAppRoot(node,')
    const dedupeIdx = s.indexOf('if (hidden.has(node)) return')
    expect(hideIdx).toBeGreaterThan(-1)
    expect(appRootIdx).toBeGreaterThan(hideIdx)
    expect(dedupeIdx).toBeGreaterThan(appRootIdx)
  })

  it('存量兜底改为名单非空后的惰性补扫（start 恒空转叙事钉除）', () => {
    const s = src()
    expect(s).toContain('const maybeScanExisting')
    expect(s).toContain('maybeScanExisting()')
    expect(s).not.toContain('存量兜底：观察器启动前已 open')
  })

  it('show 入口 undefined 收窄在前（语义等价、消除冗余观感）', () => {
    expect(src()).toContain('if (summary === undefined || !shouldRenderRichTip(summary)) return')
  })
})
