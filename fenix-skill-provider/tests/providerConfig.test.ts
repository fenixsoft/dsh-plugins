import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PATTERN,
  DEFAULT_SOURCE_DIR,
  compilePattern,
  expandSourceDir,
  resolveProviderConfig,
} from '../src/shared/providerConfig.js'

describe('resolveProviderConfig 默认值', () => {
  it('两键省略时取默认 sourceDir ~/.claude/skills 与 pattern fenix-*', () => {
    const resolved = resolveProviderConfig()
    expect(resolved.sourceDir).toBe(join(homedir(), '.claude/skills'))
    expect(resolved.pattern).toBe('fenix-*')
    expect(resolved.patternRe.test('fenix-new')).toBe(true)
  })

  it('显式传 null / 空对象同样取默认', () => {
    expect(resolveProviderConfig(null).pattern).toBe(DEFAULT_PATTERN)
    expect(resolveProviderConfig({}).sourceDir).toBe(join(homedir(), DEFAULT_SOURCE_DIR.slice(1)))
  })
})

describe('sourceDir 展开', () => {
  it('~ 前缀路径展开为 os.homedir() 拼接的绝对路径', () => {
    expect(expandSourceDir('~/fenix-test-skills')).toBe(join(homedir(), 'fenix-test-skills'))
    expect(resolveProviderConfig({ sourceDir: '~/.claude/skills' }).sourceDir).toBe(
      join(homedir(), '.claude/skills'),
    )
  })

  it('绝对路径透传（归一后不变）', () => {
    expect(resolveProviderConfig({ sourceDir: '/root/fenixd/skills' }).sourceDir).toBe(
      '/root/fenixd/skills',
    )
  })

  it('空白字符串 sourceDir 视同省略，取默认', () => {
    expect(resolveProviderConfig({ sourceDir: '  ' }).sourceDir).toBe(join(homedir(), '.claude/skills'))
  })

  it('~user 形态不支持，报错含键名', () => {
    expect(() => resolveProviderConfig({ sourceDir: '~other/skills' })).toThrowError(/sourceDir/)
  })
})

describe('pattern 校验与编译', () => {
  it('默认 fenix-* 前缀通配：匹配 fenix-new，不匹配 anysearch', () => {
    const re = resolveProviderConfig().patternRe
    expect(re.test('fenix-new')).toBe(true)
    expect(re.test('fenix-')).toBe(true)
    expect(re.test('anysearch')).toBe(false)
    expect(re.test('fenixdemoprefix')).toBe(false)
  })

  it('* 不匹配跨段分隔符（段内语义）', () => {
    expect(compilePattern('fenix-*').test('fenix-a/b')).toBe(false)
    expect(compilePattern('*').test('a/b')).toBe(false)
  })

  it('全串锚定：fenix-* 不吞中间命中', () => {
    expect(compilePattern('fenix-*').test('xfenix-new')).toBe(false)
    expect(compilePattern('fenix-*-new').test('fenix-a-new')).toBe(true)
    expect(compilePattern('fenix-*-new').test('fenix-a-new-x')).toBe(false)
  })

  it('pattern 字面量中的正则元字符按字面量处理', () => {
    const re = compilePattern('v1.0+')
    expect(re.test('v1.0+')).toBe(true)
    expect(re.test('v1x0+')).toBe(false)
  })

  it('非法 pattern fen[x]-* 报错含键名 pattern 与非法字符 [', () => {
    expect(() => resolveProviderConfig({ pattern: 'fen[x]-*' })).toThrowError(/pattern/)
    expect(() => compilePattern('fen[x]-*')).toThrowError(/\[/)
  })

  it('其余 glob 元字符 ? ] { } \\ 逐个判非法且报错含键名', () => {
    for (const bad of ['what?', 'fe]nix-*', 'fe{n}ix-*', 'fe\\nix-*']) {
      expect(() => resolveProviderConfig({ pattern: bad }), bad).toThrowError(/pattern/)
    }
  })

  it('跨段 / 判非法', () => {
    expect(() => resolveProviderConfig({ pattern: 'a/b*' })).toThrowError(/pattern/)
  })

  it('空白 pattern 视同省略，取默认', () => {
    expect(resolveProviderConfig({ pattern: '   ' }).pattern).toBe(DEFAULT_PATTERN)
  })
})
