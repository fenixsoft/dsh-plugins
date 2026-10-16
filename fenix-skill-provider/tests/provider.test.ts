import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import FenixSkillProvider from '../src/host/index.js'
import { WATCH_DEBOUNCE_MS } from '../src/shared/providerConfig.js'

/** 最小 host 环境桩：捕获 registerProvider 的 provider/control 与 warn 日志。 */
function createHost(sourceDir: string, pattern?: string): {
  provider: () => SkillProvider
  warns: string[]
  invalidate: ReturnType<typeof vi.fn>
  dispose: () => void
  /** 模拟 dsh registry 重收集时重调工厂（该行为契约未定，用于测 watch 幂等守卫）。 */
  recreate: () => void
} {
  const warns: string[] = []
  const invalidate = vi.fn()
  const controller = new AbortController()
  const control: SkillProviderControl = { signal: controller.signal, invalidate }
  let provider: SkillProvider | undefined
  let createProvider: ((control: SkillProviderControl) => SkillProvider) | undefined
  const effects: Array<() => void> = []
  const ctx = {
    logger: {
      warn: (...args: unknown[]) => {
        warns.push(args.filter((a) => a !== '%s').map(String).join(' '))
      },
      info: () => {},
      error: () => {},
    },
    skills: {
      registerProvider: (create: (control: SkillProviderControl) => SkillProvider) => {
        createProvider = create
        provider = create(control)
        return () => {
          provider = undefined
          controller.abort() // 对齐 dsh-skill：registration dispose 即 abort control.signal
        }
      },
    },
    effect: (fn: () => unknown, _label?: string) => {
      // 对齐 cordis 语义：effect 回调立即执行，其返回值（若为函数）才是 dispose 处理器
      const result = fn()
      const disposer = typeof result === 'function' ? (result as () => void) : undefined
      effects.push(() => disposer?.())
      return () => disposer?.()
    },
  } as unknown as Context
  new FenixSkillProvider(ctx, { sourceDir, pattern })
  return {
    provider: () => {
      if (provider === undefined) throw new Error('provider 未注册')
      return provider
    },
    warns,
    invalidate,
    dispose: () => {
      for (const fn of effects) fn()
    },
    recreate: () => {
      if (createProvider === undefined) throw new Error('工厂未捕获')
      provider = createProvider(control)
    },
  }
}

const dirs: string[] = []
async function makeSourceDir(skillCount = 1): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fenix-skill-provider-host-'))
  dirs.push(dir)
  for (let i = 0; i < skillCount; i++) {
    const name = `fenix-skill-${i}`
    await mkdir(join(dir, name))
    await writeFile(
      join(dir, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: 测试技能 ${i}\n---\n# ${name} 正文\n`,
    )
  }
  return dir
}
const disposables: Array<() => void> = []
function track<T extends { dispose: () => void }>(h: T): T {
  disposables.push(() => h.dispose())
  return h
}

afterEach(() => {
  vi.useRealTimers()
  for (const fn of disposables.splice(0)) fn()
  for (const dir of dirs.splice(0)) rmSyncSafe(dir)
})

function rmSyncSafe(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // 测试夹具清理尽力而为
  }
}

/** 真实事件循环冲刷：等 fs.watch 事件投递（setImmediate 未被 fake，可真实轮转）。 */
async function flushWatchDelivery(iterations = 30): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('FenixSkillProvider 装配', () => {
  it('构造即经 ctx.skills.registerProvider 注册 fenix-skill-provider', async () => {
    const dir = await makeSourceDir()
    const h = track(createHost(dir))
    expect(h.provider().name).toBe('fenix-skill-provider')
    expect(typeof h.provider().list).toBe('function')
    expect(typeof h.provider().get).toBe('function')
  })

  // 回归：构造器访问 this.ctx.skills，cordis 规则要求 Service 声明 static inject，
  // 否则真机装载报「cannot get property "skills" without inject」拒绝激活
  // （本文件的 ctx 桩不做该校验，故此处对静态声明做契约断言）。
  it('声明 static inject 含 skills（cordis 装载契约）', () => {
    expect(FenixSkillProvider.inject).toContain('skills')
  })
})

describe('provider.list', () => {
  it('来源目录缺失：返回空集并留一条含路径的 warn（不抛）', async () => {
    const missing = join(await makeSourceDir(0), 'no-such-dir')
    const h = track(createHost(missing))
    const candidates = await h.provider().list({})
    expect(candidates).toEqual([])
    expect(h.warns.some((w) => w.includes(missing))).toBe(true)
  })

  it('正常来源目录：返回扫描 candidates', async () => {
    const dir = await makeSourceDir(2)
    const h = track(createHost(dir))
    const candidates = await h.provider().list({})
    expect(Array.isArray(candidates)).toBe(true)
    expect((candidates as readonly { name: string }[]).map((c) => c.name)).toEqual([
      'fenix-skill-0',
      'fenix-skill-1',
    ])
  })

  it('options.signal 已 abort：尽早 settle 返回 complete: false 观察', async () => {
    const dir = await makeSourceDir()
    const h = track(createHost(dir))
    const controller = new AbortController()
    controller.abort()
    const result = await h.provider().list({ signal: controller.signal })
    expect(Array.isArray(result)).toBe(false)
  })
})

describe('provider.get', () => {
  it('剥离 frontmatter 且元数据字段与 candidate 一致', async () => {
    const dir = await makeSourceDir()
    const h = track(createHost(dir))
    const candidates = await h.provider().list({})
    const candidate = (candidates as readonly Parameters<SkillProvider['get']>[0][])[0]
    if (candidate === undefined) throw new Error('缺 candidate')
    const def = await h.provider().get(candidate, {})
    expect(def).toBeDefined()
    expect(def?.name).toBe('fenix-skill-0')
    expect(def?.description).toBe('测试技能 0')
    expect(def?.content).not.toMatch(/^\s*---/) // 无 frontmatter 残留
    expect(def?.content).toContain('# fenix-skill-0 正文')
    expect(def?.invocation).toEqual(candidate.invocation)
    expect(def?.source).toBe('custom')
    expect(def?.provider).toBe('fenix-skill-provider')
    expect(def?.resourceBase).toEqual(candidate.resourceBase)
    expect(def?.path).toBe(candidate.locator)
  })

  it('SKILL.md 已删除：返回 undefined 不抛', async () => {
    const dir = await makeSourceDir()
    const h = track(createHost(dir))
    const candidates = await h.provider().list({})
    const candidate = (candidates as readonly Parameters<SkillProvider['get']>[0][])[0]
    if (candidate === undefined) throw new Error('缺 candidate')
    await unlink(join(dir, 'fenix-skill-0', 'SKILL.md'))
    expect(await h.provider().get(candidate, {})).toBeUndefined()
  })

  it('locator 形态非法：返回 undefined 不抛', async () => {
    const dir = await makeSourceDir()
    const h = track(createHost(dir))
    const fake = {
      name: 'fenix-x',
      description: 'd',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom',
      provider: 'fenix-skill-provider',
      rank: 500,
      locator: 42,
    } as Parameters<SkillProvider['get']>[0]
    expect(await h.provider().get(fake, {})).toBeUndefined()
  })
})

describe('fs.watch 自动同步', () => {
  it('目录事件经去抖（300ms）后调 control.invalidate()，窗口内多事件合一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const dir = await makeSourceDir()
    const h = track(createHost(dir))
    // 第一波：两个事件落入同一去抖窗口 → 一次 invalidate
    await writeFile(join(dir, 'touch-1'), 'x')
    await flushWatchDelivery()
    await writeFile(join(dir, 'touch-2'), 'x')
    await flushWatchDelivery()
    expect(h.invalidate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS)
    expect(h.invalidate).toHaveBeenCalledTimes(1)
    // 第二波：窗口过半再来的事件重置去抖 → 再一次 invalidate
    await writeFile(join(dir, 'touch-3'), 'x')
    await flushWatchDelivery()
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS - 50)
    await writeFile(join(dir, 'touch-4'), 'x')
    await flushWatchDelivery()
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS)
    expect(h.invalidate).toHaveBeenCalledTimes(2)
  })

  it('插件卸载（registration dispose）后 watch 注销，不再触发 invalidate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const dir = await makeSourceDir()
    const h = track(createHost(dir))
    h.dispose() // provider registration 注销 → control.signal abort → watcher close
    await writeFile(join(dir, 'touch-after-dispose'), 'x')
    await flushWatchDelivery()
    await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS * 3)
    expect(h.invalidate).not.toHaveBeenCalled()
  })

  it('fs.watch 初始化失败：降级静态注册 + 一条 warn，不抛未处理异常', async () => {
    const dir = await makeSourceDir()
    const spy = vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw new Error('ENOSPC: inotify watch limit reached')
    })
    let h: ReturnType<typeof createHost>
    try {
      h = createHost(dir)
    } finally {
      spy.mockRestore()
    }
    track(h)
    // skill 注册不受影响
    const candidates = await h.provider().list({})
    expect((candidates as readonly { name: string }[]).map((c) => c.name)).toEqual(['fenix-skill-0'])
    // 降级 warn 可观测
    expect(h.warns.join('\n')).toMatch(/fs\.watch/)
    expect(h.warns.join('\n')).toMatch(/降级/)
  })

  it('watcher 运行期 error：与初始化失败同口径降级 + 关闭 watcher，不重复报错、不抛未处理异常', async () => {
    const dir = await makeSourceDir()
    const close = vi.fn()
    const fake = new EventEmitter() as unknown as fs.FSWatcher
    fake.close = (): void => close()
    // 用假 watcher 替换 fs.watch，便于手动 emit 运行期 'error'（目录被删/句柄失效等）
    const spy = vi.spyOn(fs, 'watch').mockImplementation((() => fake) as unknown as typeof fs.watch)
    let h: ReturnType<typeof createHost>
    try {
      h = track(createHost(dir))
    } finally {
      spy.mockRestore()
    }
    fake.emit('error', new Error('ENOENT: no such file or directory, watch 已被删除'))
    // 降级 warn 可观测（同初始化失败口径，含具体错误）
    expect(h.warns.join('\n')).toMatch(/fs\.watch/)
    expect(h.warns.join('\n')).toMatch(/降级/)
    expect(h.warns.join('\n')).toContain('ENOENT')
    expect(close).toHaveBeenCalledTimes(1)
    // 已降级：重复 error 不再重复 warn（也不再抛未处理异常）
    fake.emit('error', new Error('again'))
    expect(h.warns).toHaveLength(1)
    // 后续 dispose（signal abort → stop → close）不抛
    h.dispose()
  })

  it('registerProvider 工厂被重入时 watch 幂等：fs.watch 只启动一次', async () => {
    const dir = await makeSourceDir()
    const spy = vi.spyOn(fs, 'watch')
    const h = track(createHost(dir))
    expect(spy).toHaveBeenCalledTimes(1)
    // 模拟 registry 重收集重调工厂：不再叠加 watcher
    h.recreate()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
