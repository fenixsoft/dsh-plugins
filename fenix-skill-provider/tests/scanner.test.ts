import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import { scanSkillDir, USER_LEVEL_RANK, PROVIDER_NAME } from '../src/host/scanner.js'
import { parseFrontmatter } from '../src/host/frontmatter.js'
import { compilePattern } from '../src/shared/providerConfig.js'

let root: string
const warns: string[] = []
const log = (message: string): void => {
  warns.push(message)
}
const patternRe = compilePattern('fenix-*')

function skillMd(dirName: string, frontmatter: string, body = `# ${dirName} 正文\n`): string {
  return `---\n${frontmatter}\n---\n${body}`
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fenix-skill-provider-scan-'))
  // 合法条目（含可选键、显式 invocation 覆盖、metadata）
  mkdirSync(join(root, 'fenix-new'))
  writeFileSync(
    join(root, 'fenix-new', 'SKILL.md'),
    skillMd('fenix-new', 'name: fenix-new\ndescription: 创建新的 fenix 规格变更'),
  )
  mkdirSync(join(root, 'fenix-quoted'))
  writeFileSync(
    join(root, 'fenix-quoted', 'SKILL.md'),
    skillMd(
      'fenix-quoted',
      'name: "fenix-quoted"\ndescription: \'带引号描述\'\nwhenToUse: 需要新建规格时\nmetadata:\n  owner: fenix\n  pinned: true',
    ),
  )
  mkdirSync(join(root, 'fenix-user-off'))
  writeFileSync(
    join(root, 'fenix-user-off', 'SKILL.md'),
    skillMd('fenix-user-off', 'name: fenix-user-off\ndescription: 仅模型可见\nuser-invocable: false'),
  )
  mkdirSync(join(root, 'fenix-model-off'))
  writeFileSync(
    join(root, 'fenix-model-off', 'SKILL.md'),
    skillMd('fenix-model-off', 'name: fenix-model-off\ndescription: 仅用户可见\ndisable-model-invocation: true'),
  )
  // 指向目录的 symlink 条目
  mkdirSync(join(root, 'fenix-link-target'))
  writeFileSync(
    join(root, 'fenix-link-target', 'SKILL.md'),
    skillMd('fenix-link-target', 'name: fenix-link\ndescription: 经软链暴露的条目'),
  )
  symlinkSync(join(root, 'fenix-link-target'), join(root, 'fenix-link'), 'dir')
  // 重名：两个目录 frontmatter name 相同（目录序靠前者胜出）
  mkdirSync(join(root, 'fenix-x'))
  writeFileSync(join(root, 'fenix-x', 'SKILL.md'), skillMd('fenix-x', 'name: fenix-x\ndescription: 首个同名'))
  mkdirSync(join(root, 'fenix-y'))
  writeFileSync(join(root, 'fenix-y', 'SKILL.md'), skillMd('fenix-y', 'name: fenix-x\ndescription: 后到同名'))
  // 非法条目族
  mkdirSync(join(root, 'fenix-noskill')) // 缺 SKILL.md
  mkdirSync(join(root, 'fenix-badfm'))
  writeFileSync(join(root, 'fenix-badfm', 'SKILL.md'), '---\nname: fenix-badfm\n# 围栏未闭合\n正文')
  mkdirSync(join(root, 'fenix-noname'))
  writeFileSync(
    join(root, 'fenix-noname', 'SKILL.md'),
    skillMd('fenix-noname', 'description: 缺 name'),
  )
  mkdirSync(join(root, 'fenix-nodesc'))
  writeFileSync(join(root, 'fenix-nodesc', 'SKILL.md'), skillMd('fenix-nodesc', 'name: fenix-nodesc'))
  mkdirSync(join(root, 'fenix-BadName'))
  writeFileSync(
    join(root, 'fenix-BadName', 'SKILL.md'),
    skillMd('fenix-BadName', 'name: Fenix_Bad\ndescription: 非 kebab-case'),
  )
  // SKILL.md 是目录（readFile EISDIR → 单条目 I/O 错误 contained）
  mkdirSync(join(root, 'fenix-locked'))
  mkdirSync(join(root, 'fenix-locked', 'SKILL.md'))
  // 断链 symlink
  symlinkSync(join(root, 'no-such-target'), join(root, 'fenix-broken'), 'dir')
  // pattern 不匹配的合法条目 + 匹配 pattern 的平文件
  mkdirSync(join(root, 'anysearch'))
  writeFileSync(join(root, 'anysearch', 'SKILL.md'), skillMd('anysearch', 'name: anysearch\ndescription: 不匹配 pattern'))
  writeFileSync(join(root, 'fenix-x.md'), '平文件：本 provider 不收录顶层平文件')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

async function scan(sourceDir = root, re = patternRe): Promise<readonly SkillCandidate[]> {
  warns.length = 0
  const result = await scanSkillDir(sourceDir, re, log)
  if (Array.isArray(result)) return result
  throw new Error('未 abort 时应返回完整数组形态')
}

describe('scanSkillDir', () => {
  it('只收录匹配 pattern 的目录条目，平文件与不匹配项不产生 candidate', async () => {
    const names = (await scan()).map((c) => c.name).sort()
    // 含 symlink 条目 fenix-link；重名保留首个（fenix-x），fenix-y 被跳过
    expect(names).toEqual([
      'fenix-link',
      'fenix-model-off',
      'fenix-new',
      'fenix-quoted',
      'fenix-user-off',
      'fenix-x',
    ])
  })

  it('candidate 字段：rank/source/provider/locator/resourceBase/path 与 invocation 缺省', async () => {
    const candidates = await scan()
    const fenixNew = candidates.find((c) => c.name === 'fenix-new')
    expect(fenixNew).toBeDefined()
    const dir = join(root, 'fenix-new')
    expect(fenixNew?.rank).toBe(USER_LEVEL_RANK)
    expect(fenixNew?.source).toBe('custom')
    expect(fenixNew?.provider).toBe(PROVIDER_NAME)
    expect(fenixNew?.description).toBe('创建新的 fenix 规格变更')
    expect(fenixNew?.locator).toBe(join(dir, 'SKILL.md'))
    expect(fenixNew?.path).toBe(join(dir, 'SKILL.md'))
    expect(fenixNew?.resourceBase).toEqual({ kind: 'directory', path: dir })
    expect(fenixNew?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(fenixNew?.whenToUse).toBeUndefined()
    expect(fenixNew?.metadata).toBeUndefined()
  })

  it('frontmatter 引号值与 whenToUse/metadata 解析', async () => {
    const candidates = await scan()
    const quoted = candidates.find((c) => c.name === 'fenix-quoted')
    expect(quoted?.description).toBe('带引号描述')
    expect(quoted?.whenToUse).toBe('需要新建规格时')
    expect(quoted?.metadata).toEqual({ owner: 'fenix', pinned: true })
  })

  it('显式 invocation 覆盖：user-invocable: false 与 disable-model-invocation: true', async () => {
    const candidates = await scan()
    expect(candidates.find((c) => c.name === 'fenix-user-off')?.invocation).toEqual({
      modelInvocable: true,
      userInvocable: false,
    })
    expect(candidates.find((c) => c.name === 'fenix-model-off')?.invocation).toEqual({
      modelInvocable: false,
      userInvocable: true,
    })
  })

  it('每个非法条目各留一条含目录名与原因的 warn，互不影响合法条目', async () => {
    await scan()
    const byDir = (dir: string): string | undefined => warns.find((w) => w.includes(dir))
    expect(byDir('fenix-noskill')).toMatch(/缺 SKILL\.md/)
    expect(byDir('fenix-badfm')).toMatch(/frontmatter/)
    expect(byDir('fenix-noname')).toMatch(/缺 name/)
    expect(byDir('fenix-nodesc')).toMatch(/缺 description/)
    expect(byDir('fenix-BadName')).toMatch(/kebab-case/)
    expect(byDir('fenix-locked')).toMatch(/不可读/)
    expect(byDir('fenix-broken')).toMatch(/符号链接/)
    expect(byDir('fenix-y')).toMatch(/重名/)
    // 不匹配 pattern 与平文件不打扰日志
    expect(warns.some((w) => w.includes('anysearch'))).toBe(false)
    expect(warns.some((w) => w.includes('fenix-x.md'))).toBe(false)
  })

  it('来源目录不存在：返回空集并留一条含路径的 warn', async () => {
    const result = await scan(join(root, 'no-such-dir'))
    expect(result).toEqual([])
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain(join(root, 'no-such-dir'))
  })

  it('signal 已 abort 时尽早返回 complete: false 的观察形态', async () => {
    warns.length = 0
    const controller = new AbortController()
    controller.abort()
    const result = await scanSkillDir(root, patternRe, log, controller.signal)
    expect(Array.isArray(result)).toBe(false)
    if (!Array.isArray(result)) {
      expect((result as { complete: boolean }).complete).toBe(false)
    }
  })
})

describe('parseFrontmatter', () => {
  it('剥离围栏返回正文，键值取平直 YAML', () => {
    const parsed = parseFrontmatter(
      '---\nname: fenix-new\ndescription: 创建规格\n---\n# 正文\n第一行\n',
    )
    expect(parsed?.name).toBe('fenix-new')
    expect(parsed?.description).toBe('创建规格')
    expect(parsed?.body).toBe('# 正文\n第一行\n')
  })

  it('布尔键解析：user-invocable / disable-model-invocation', () => {
    const parsed = parseFrontmatter(
      '---\nname: a\ndescription: b\nuser-invocable: false\ndisable-model-invocation: true\n---\nbody',
    )
    expect(parsed?.userInvocable).toBe(false)
    expect(parsed?.modelInvocable).toBe(false)
  })

  it('围栏缺失、未闭合、无冒号结构行均返回 null', () => {
    expect(parseFrontmatter('name: fenix\n')).toBeNull()
    expect(parseFrontmatter('---\nname: fenix\n')).toBeNull()
    expect(parseFrontmatter('---\nname fenix\n---\n')).toBeNull()
    expect(parseFrontmatter('')).toBeNull()
  })

  it('metadata 扁平键值解析', () => {
    const parsed = parseFrontmatter(
      '---\nname: a\ndescription: b\nmetadata:\n  owner: fenix\n  pinned: false\n---\nbody',
    )
    expect(parsed?.metadata).toEqual({ owner: 'fenix', pinned: false })
  })
})
