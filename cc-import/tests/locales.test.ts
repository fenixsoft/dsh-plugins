/**
 * 双语文案契约：新操作键必须中英齐备（spec「Models 页导入入口」——
 * 「取消全部选择」文案中英双语）。同时守护键域不随改动静默漂移。
 */
import { describe, expect, it } from 'vitest'
import { LOCALE_NS, localeBundles } from '../src/client/locales.js'

describe('localeBundles 双语键域', () => {
  it('命名空间为 cc-import，zh/en 两包键集合一致', () => {
    expect(LOCALE_NS).toBe('cc-import')
    expect(Object.keys(localeBundles).sort()).toEqual(['en', 'zh'])
    expect(Object.keys(localeBundles['zh'] ?? {}).sort()).toEqual(Object.keys(localeBundles['en'] ?? {}).sort())
  })

  it('「取消全部选择」键 dialog.deselectAll 中英双语', () => {
    expect(localeBundles['zh']?.['dialog.deselectAll']).toBe('取消全部选择')
    expect(localeBundles['en']?.['dialog.deselectAll']).toBe('Deselect all')
  })
})
