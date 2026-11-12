/**
 * 文件右键「在 \<项目名\> 项目定位」单测（2026-11-11 用户需求契约面，同日迭代文案+图标）：
 * - resolveWorkspacePath：绝对路径三态（POSIX/Windows 盘符/UNC）原样、相对
 *   cwd 拼接（`./` 剥除、Windows 分隔符跟随、cwd 缺席回落原值）；
 * - locateProjectForFile：根内文件/项目根本身/防同前缀误命中（fenixd-x 不命中
 *   fenixd）/嵌套项目最长前缀胜出/路径不可得行跳过/空入参 null；
 * - homeFileRouteFor：根文件退化项目首页路由、子文件 `?tab=home&path=` seed
 *   深链（path 经 URI 编码）；
 * - registerFileContextMenu：命中注入单项（label 文案钉）、未命中空数组（原生
 *   菜单零污染）、服务缺失 no-op 降级、run 错误 warn 后 rethrow（failureLabel
 *   可见失败语义）、resolve 内 sessions 快照形状漂移降级。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  LOCATE_MENU_ID,
  homeFileRouteFor,
  locateProjectForFile,
  registerFileContextMenu,
  resolveWorkspacePath,
} from '../src/client/locate.js'
import type { ContextMenusLike, FileMenuAction } from '../src/client/locate.js'
import type { ProjectRowInfo } from '../src/client/projectSync.js'

const row = (name: string, path: string | null): ProjectRowInfo => ({ name, path })

describe('resolveWorkspacePath（open-in-app 同语义）', () => {
  it('绝对路径三态原样返回：POSIX / Windows 盘符 / UNC', () => {
    expect(resolveWorkspacePath('/elsewhere', '/root/fenixd/src/a.ts')).toBe('/root/fenixd/src/a.ts')
    expect(resolveWorkspacePath('/elsewhere', 'C:\\repo\\fenixd\\a.ts')).toBe('C:\\repo\\fenixd\\a.ts')
    expect(resolveWorkspacePath('/elsewhere', '\\\\server\\share\\a.ts')).toBe('\\\\server\\share\\a.ts')
  })

  it('相对路径以 cwd 拼接：`./` 前缀剥除、cwd 尾斜杠归一', () => {
    expect(resolveWorkspacePath('/root/fenixd', 'src/a.ts')).toBe('/root/fenixd/src/a.ts')
    expect(resolveWorkspacePath('/root/fenixd/', './src/a.ts')).toBe('/root/fenixd/src/a.ts')
    expect(resolveWorkspacePath('/root/fenixd', './nested/./b.md')).toBe('/root/fenixd/nested/./b.md')
  })

  it('Windows cwd 跟随反斜杠分隔符', () => {
    expect(resolveWorkspacePath('C:\\repo\\fenixd', 'src\\a.ts')).toBe('C:\\repo\\fenixd\\src\\a.ts')
  })

  it('cwd 不可得（undefined/空串）：原值回落（调用方按不可解析降级）', () => {
    expect(resolveWorkspacePath('', 'src/a.ts')).toBe('src/a.ts')
    expect(resolveWorkspacePath('', 'src/a.ts')).not.toMatch(/^\//)
  })
})

describe('locateProjectForFile（最长前缀 wins）', () => {
  const rows: readonly ProjectRowInfo[] = [
    row('fenixd', '/root/fenixd'),
    row('nested', '/root/fenixd/packages/app'),
    row('nopath', null),
    row('emptypath', ''),
  ]

  it('项目根内文件命中：rel 为相对项目的 POSIX 路径', () => {
    expect(locateProjectForFile('/root/fenixd/src/pages/list.tsx', rows)).toEqual({
      name: 'fenixd',
      rel: 'src/pages/list.tsx',
    })
  })

  it('文件即项目根：rel 空串', () => {
    expect(locateProjectForFile('/root/fenixd', rows)).toEqual({ name: 'fenixd', rel: '' })
  })

  it('防同前缀误命中：/root/fenixd-x 不命中 fenixd', () => {
    expect(locateProjectForFile('/root/fenixd-x/a.txt', rows)).toBeNull()
  })

  it('嵌套项目：最长前缀（最深项目）胜出', () => {
    expect(locateProjectForFile('/root/fenixd/packages/app/src/main.tsx', rows)).toEqual({
      name: 'nested',
      rel: 'src/main.tsx',
    })
  })

  it('路径不可得（null/空串）行不参与匹配；尾斜杠/反斜杠归一', () => {
    expect(locateProjectForFile('/root/elsewhere/a.txt', rows)).toBeNull()
    expect(locateProjectForFile('/root/fenixd/a.md', [row('x', '/root/fenixd/')])).toEqual({ name: 'x', rel: 'a.md' })
    expect(locateProjectForFile('/root/fenixd\\a.md', [row('x', '/root\\fenixd')])).toEqual({ name: 'x', rel: 'a.md' })
  })

  it('空入参防御：absPath 空串或空行表 → null', () => {
    expect(locateProjectForFile('', rows)).toBeNull()
    expect(locateProjectForFile('/root/fenixd/a.md', [])).toBeNull()
  })
})

describe('homeFileRouteFor（dashboard seed 深链）', () => {
  it('子文件：#/projects/<enc>?tab=home&path=<enc-rel>（rel 经 URI 编码）', () => {
    expect(homeFileRouteFor('fenixd', 'src/pages/list.tsx')).toBe(
      '#/projects/fenixd?tab=home&path=src%2Fpages%2Flist.tsx',
    )
    expect(homeFileRouteFor('my project', 'a b.md')).toBe('#/projects/my%20project?tab=home&path=a%20b.md')
  })

  it('文件在项目根（rel 空串）：退化项目首页根路由（与 projectRouteFor 同形）', () => {
    expect(homeFileRouteFor('fenixd', '')).toBe('#/projects/fenixd')
  })
})

/* ============ registerFileContextMenu（桩替身） ============ */

interface RecordedContribution {
  readonly id: string
  readonly target: string
  readonly order: number
  resolve(
    target: { readonly sessionId: string; readonly path: string },
    signal: AbortSignal,
  ): readonly FileMenuAction[] | Promise<readonly FileMenuAction[]>
}

/** 最小 contextMenus/sessions 桩：记录贡献、可配 cwd 表（sessionId → cwd，
 * 桩内组形为 dsh 真实快照形态 byId[sessionId] = { cwd }）。 */
function menuStub(opts: { cwds?: Record<string, string>; registerThrows?: boolean } = {}) {
  const recorded: RecordedContribution[] = []
  const unregistered: string[] = []
  const ctx: {
    contextMenus?: ContextMenusLike
    sessions?: unknown
  } = {}
  if (!opts.registerThrows) {
    ctx.contextMenus = {
      register(contribution) {
        recorded.push(contribution as unknown as RecordedContribution)
        return () => {
          unregistered.push(String((contribution as { id: string }).id))
        }
      },
    }
  }
  if (opts.cwds !== undefined) {
    ctx.sessions = {
      list: {
        getSnapshot: () => ({
          byId: Object.fromEntries(
            Object.entries(opts.cwds ?? {}).map(([sessionId, cwd]) => [sessionId, { cwd }]),
          ),
        }),
      },
    }
  }
  return { ctx, recorded, unregistered }
}

describe('registerFileContextMenu', () => {
  it('注册契约：id/target/order 钉值；返回注销函数', () => {
    const stub = menuStub({ cwds: {} })
    const stop = registerFileContextMenu(stub.ctx as never, {
      getProjectRows: () => [],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    expect(stub.recorded).toHaveLength(1)
    expect(stub.recorded[0]?.id).toBe(LOCATE_MENU_ID)
    expect(stub.recorded[0]?.id).toBe('fenix-dashboard-bridge.locate-in-project')
    expect(stub.recorded[0]?.target).toBe('file')
    expect(stub.recorded[0]?.order).toBe(90)
    expect(typeof stop).toBe('function')
    stop()
    expect(stub.unregistered).toEqual([LOCATE_MENU_ID])
  })

  it('命中：注入单项（label 文案钉），run 走 openProjectAt(深链)+selectProject', async () => {
    const stub = menuStub({ cwds: { s1: '/root/fenixd' } })
    const opened: Array<{ name: string; route: string }> = []
    const selected: string[] = []
    registerFileContextMenu(stub.ctx as never, {
      getProjectRows: () => [row('fenixd', '/root/fenixd')],
      openProjectAt: (name, route) => opened.push({ name, route }),
      selectProject: (name) => selected.push(name),
    })
    const actions = await stub.recorded[0]?.resolve({ sessionId: 's1', path: 'src/a.ts' }, new AbortController().signal)
    expect(actions).toHaveLength(1)
    expect(actions?.[0]?.label).toBe('在 fenixd 项目定位')
    expect(actions?.[0]?.failureLabel).toBe('定位失败，请重试')
    await actions?.[0]?.run?.()
    expect(opened).toEqual([{ name: 'fenixd', route: '#/projects/fenixd?tab=home&path=src%2Fa.ts' }])
    expect(selected).toEqual(['fenixd'])
  })

  it('iconKey 提供时 action 携 icon:{key}；缺席时无 icon 字段', async () => {
    const withIcon = menuStub({ cwds: { s1: '/root/fenixd' } })
    registerFileContextMenu(withIcon.ctx as never, {
      getProjectRows: () => [row('fenixd', '/root/fenixd')],
      openProjectAt: () => {},
      selectProject: () => {},
      iconKey: 'fenix-dashboard-bridge.locate-icon',
    })
    const actions = await withIcon.recorded[0]?.resolve({ sessionId: 's1', path: 'a.ts' }, new AbortController().signal)
    expect(actions?.[0]?.icon).toEqual({ key: 'fenix-dashboard-bridge.locate-icon' })

    const noIcon = menuStub({ cwds: { s1: '/root/fenixd' } })
    registerFileContextMenu(noIcon.ctx as never, {
      getProjectRows: () => [row('fenixd', '/root/fenixd')],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    const bare = await noIcon.recorded[0]?.resolve({ sessionId: 's1', path: 'a.ts' }, new AbortController().signal)
    expect(bare?.[0]?.icon).toBeUndefined()
  })

  it('openSidebarProjectTab 提供时为首选落点：openTab(name, rel)，main 面板路径不触发', async () => {
    const stub = menuStub({ cwds: { s1: '/root/fenixd' } })
    const sidebarCalls: Array<{ name: string; rel: string }> = []
    const opened: Array<{ name: string; route: string }> = []
    const selected: string[] = []
    registerFileContextMenu(stub.ctx as never, {
      getProjectRows: () => [row('fenixd', '/root/fenixd')],
      openSidebarProjectTab: (name, rel) => sidebarCalls.push({ name, rel }),
      openProjectAt: (name, route) => opened.push({ name, route }),
      selectProject: (name) => selected.push(name),
    })
    const actions = await stub.recorded[0]?.resolve({ sessionId: 's1', path: 'src/a.ts' }, new AbortController().signal)
    await actions?.[0]?.run?.()
    expect(sidebarCalls).toEqual([{ name: 'fenixd', rel: 'src/a.ts' }])
    expect(opened).toEqual([])
    expect(selected).toEqual([])
  })

  it('未命中/无项目/会话 cwd 缺席：resolve 返回空数组（原生菜单零污染）', async () => {
    const outside = menuStub({ cwds: { s1: '/root/other' } })
    registerFileContextMenu(outside.ctx as never, {
      getProjectRows: () => [row('fenixd', '/root/fenixd')],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    expect(await outside.recorded[0]?.resolve({ sessionId: 's1', path: 'a.ts' }, new AbortController().signal)).toEqual([])

    const noRows = menuStub({ cwds: { s1: '/root/fenixd' } })
    registerFileContextMenu(noRows.ctx as never, {
      getProjectRows: () => [],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    expect(await noRows.recorded[0]?.resolve({ sessionId: 's1', path: 'a.ts' }, new AbortController().signal)).toEqual([])

    const noSession = menuStub()
    registerFileContextMenu(noSession.ctx as never, {
      getProjectRows: () => [row('fenixd', '/root/fenixd')],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    expect(await noSession.recorded[0]?.resolve({ sessionId: 'ghost', path: 'a.ts' }, new AbortController().signal)).toEqual([])
  })

  it('run 内部错误：warn 后 rethrow（failureLabel 可见失败语义）', async () => {
    const stub = menuStub({ cwds: { s1: '/root/fenixd' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      registerFileContextMenu(stub.ctx as never, {
        getProjectRows: () => [row('fenixd', '/root/fenixd')],
        openProjectAt: () => {
          throw new Error('panel register exploded')
        },
        selectProject: () => {},
      })
      const actions = await stub.recorded[0]?.resolve({ sessionId: 's1', path: 'a.ts' }, new AbortController().signal)
      await expect(actions?.[0]?.run?.()).rejects.toThrow('panel register exploded')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('在 Fenix 项目中定位失败')
      expect(String(warn.mock.calls[0]?.[0])).toContain('panel register exploded')
    } finally {
      warn.mockRestore()
    }
  })

  it('服务缺失/形状漂移：整体 no-op 降级（不抛、返回可调用注销）', async () => {
    const missing = menuStub({ registerThrows: true })
    const stopMissing = registerFileContextMenu(missing.ctx as never, {
      getProjectRows: () => [],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    expect(typeof stopMissing).toBe('function')
    expect(() => stopMissing()).not.toThrow()

    const none = registerFileContextMenu({} as never, {
      getProjectRows: () => [],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    expect(() => none()).not.toThrow()

    // sessions 快照形状漂移（getSnapshot 抛错）：resolve 按解析失败降级返回 []。
    const drifted = menuStub()
    ;(
      drifted.ctx as { sessions?: { list: { getSnapshot(): unknown } } }
    ).sessions = {
      list: {
        getSnapshot() {
          throw new Error('snapshot shape drift')
        },
      },
    }
    registerFileContextMenu(drifted.ctx as never, {
      getProjectRows: () => [row('fenixd', '/root/fenixd')],
      openProjectAt: () => {},
      selectProject: () => {},
    })
    expect(
      await drifted.recorded[0]?.resolve({ sessionId: 's1', path: 'a.ts' }, new AbortController().signal),
    ).toEqual([])
  })
})
