import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  INTERACTIVE_PORTAL_ROLE_SELECTOR,
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
