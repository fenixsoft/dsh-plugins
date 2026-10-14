/**
 * Client 半单测：iframe src 契约逐字符断言（默认/非默认前缀两组）+ 条目注册
 * 断言（桩 slots 上 5 固定条目 id/label/order、项目条目名称序、main keyed
 * 注册 id 一一对应、面板组件渲染出的 iframe 属性）。
 */
import { describe, expect, it } from 'vitest'
import { FIXED_ENTRIES, apply, projectIdFor, projectRouteFor } from '../src/client/index.js'
import type { ClientPluginOptions } from '../src/client/index.js'
import { buildPanelSrc, resolveBridgeConfig } from '../src/shared/config.js'
import type { SyncTimer } from '../src/client/projectSync.js'

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

interface ElementLike {
  readonly type?: unknown
  readonly props?: { readonly children?: unknown; readonly [key: string]: unknown }
}

/** 深度收集元素树中 type 命中的 React 元素（含数组与嵌套 children）。 */
function collectByType(node: unknown, type: string, acc: ElementLike[] = []): ElementLike[] {
  if (node === null || node === undefined) return acc
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return acc
  if (Array.isArray(node)) {
    for (const child of node) collectByType(child, type, acc)
    return acc
  }
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    const element = node as ElementLike
    if (element.type === type) acc.push(element)
    collectByType(element.props?.children, type, acc)
  }
  return acc
}

interface Registration {
  readonly slotName: string
  readonly options: Record<string, unknown>
  readonly component: unknown
}

/** 最小 slots 桩：记录注册、维护 live 表、注销登记。 */
function stubSlotsCtx() {
  const registrations: Registration[] = []
  const removed: string[] = []
  const injectCalls: string[] = []
  const live = new Map<string, Registration>()
  const ctx = {
    slots: {
      inject(slot: string, factory: () => unknown) {
        injectCalls.push(slot)
        factory()
      },
      register(options: Record<string, unknown>, component: unknown) {
        const entry: Registration = { slotName: String(options.name), options, component }
        registrations.push(entry)
        const key = entry.slotName === 'main' ? `main:${String(options.key)}` : `list:${String(options.id)}`
        live.set(key, entry)
        return () => {
          if (live.delete(key)) removed.push(key)
        }
      },
    },
  }
  return { ctx, registrations, removed, injectCalls, live }
}

function fakeTimer(): SyncTimer {
  return {
    setInterval: () => Symbol('interval'),
    clear: () => {},
    onFocus: () => () => {},
  }
}

function noopFetch(): Promise<readonly string[]> {
  return Promise.resolve([])
}

/** 运行 apply 并等待启动拉取落定，返回桩上下文与 apply 停止函数。 */
async function applied(options: Omit<ClientPluginOptions, 'upstream'>) {
  const stub = stubSlotsCtx()
  const stop = apply(stub.ctx as never, { ...options, timer: fakeTimer() })
  await flush()
  return { ...stub, stop }
}

function sidebarEntries(stub: { registrations: Registration[] }, predicate?: (options: Record<string, unknown>) => boolean): Registration[] {
  return stub.registrations.filter(
    (entry) => entry.slotName === 'sidebar.panellist' && (predicate === undefined || predicate(entry.options)),
  )
}

function mainEntries(stub: { registrations: Registration[] }): Registration[] {
  return stub.registrations.filter((entry) => entry.slotName === 'main')
}

function iframeOf(component: unknown, props: Record<string, unknown> = {}): ElementLike {
  const tree = (component as (p: Record<string, unknown>) => unknown)(props)
  const iframes = collectByType(tree, 'iframe')
  if (iframes.length !== 1) throw new Error(`期望恰好一个 iframe，实际 ${iframes.length}`)
  return iframes[0] as ElementLike
}

describe('iframe src 契约（逐字符断言）', () => {
  it('默认前缀：5 固定条目深链 → src 形态与 specs Scenario 逐字符一致', () => {
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/settings')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/settings',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/activities')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/activities',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/help')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/help',
    )
  })

  it('非默认前缀：归一（补/去尾斜杠）后同一形态；apiBase 直拼不产生双斜杠', () => {
    expect(buildPanelSrc('/dash/', '#/projects')).toBe('/dash/?embed=1&apiBase=/dash#/projects')
    expect(buildPanelSrc('/dash', '#/projects')).toBe('/dash/?embed=1&apiBase=/dash#/projects')
    expect(buildPanelSrc('dash', '#/settings')).toBe('/dash/?embed=1&apiBase=/dash#/settings')

    // apiBase 直拼 '/api/...' 不产生双斜杠（默认与非默认前缀）。
    expect(`${resolveBridgeConfig().apiBase}/api/projects`).toBe('/fenix-dashboard/api/projects')
    expect(`${resolveBridgeConfig({ prefix: '/dash/' }).apiBase}/api/projects`).toBe('/dash/api/projects')

    // hashRoute 容错：带 # 与不带 # 等价。
    expect(buildPanelSrc('/dash/', '/projects')).toBe(buildPanelSrc('/dash/', '#/projects'))
  })

  it('项目条目深链：#/projects/<name>（name 经 URI 编码）', () => {
    expect(projectRouteFor('dsh-plugins')).toBe('#/projects/dsh-plugins')
    expect(projectRouteFor('my project')).toBe('#/projects/my%20project')
    expect(projectIdFor('dsh-plugins')).toBe('fenix-project-dsh-plugins')
    expect(buildPanelSrc('/fenix-dashboard/', projectRouteFor('fenixd'))).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects/fenixd',
    )
  })

  it('注册面板组件渲染出契约 src（默认前缀，逐字符）', async () => {
    const stub = await applied({ fetchProjects: noopFetch })
    const panel = mainEntries(stub).find((entry) => entry.options.key === 'fenix-projects')
    expect(panel).toBeDefined()
    const iframe = iframeOf(panel?.component)
    expect(iframe.props?.src).toBe('/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects')
    stub.stop()
  })

  it('注册面板组件渲染出契约 src（非默认前缀，逐字符）', async () => {
    const stub = await applied({ prefix: '/dash/', fetchProjects: noopFetch })
    const panel = mainEntries(stub).find((entry) => entry.options.key === 'fenix-help')
    const iframe = iframeOf(panel?.component)
    expect(iframe.props?.src).toBe('/dash/?embed=1&apiBase=/dash#/help')
    stub.stop()
  })

  it('iframe 面板铺满、无边框并预留顶部 clearance', async () => {
    const stub = await applied({ fetchProjects: noopFetch })
    const panel = mainEntries(stub)[0]
    const iframe = iframeOf(panel?.component)
    const style = iframe.props?.style as Record<string, unknown>
    expect(style?.['border']).toBe('none')
    expect(style?.['width']).toBe('100%')
    expect(style?.['height']).toBe('100%')
    const container = collectByType((panel?.component as () => unknown)(), 'div')[0]
    expect(container).toBeDefined()
    expect((container?.props?.style as Record<string, unknown>)?.['paddingTop']).toBe(
      'var(--dsh-frame-leading-clearance, 0px)',
    )
    stub.stop()
  })
})

describe('条目注册（桩 slots）', () => {
  it('5 固定条目 id/label/order 与 specs 一致；main keyed 注册 id 一一对应', async () => {
    const stub = await applied({ fetchProjects: noopFetch })

    expect(stub.injectCalls).toContain('sidebar.panellist')
    expect(stub.injectCalls).toContain('main')

    const fixed = sidebarEntries(stub, (options) => !String(options.id).startsWith('fenix-project-'))
    expect(fixed.map((entry) => entry.options.id)).toEqual([
      'fenix-overview',
      'fenix-projects',
      'fenix-settings',
      'fenix-activities',
      'fenix-help',
    ])
    expect(fixed.map((entry) => entry.options.label)).toEqual(['概览', '项目', '设置', '运维', '帮助'])
    expect(fixed.map((entry) => entry.options.order)).toEqual([10, 11, 12, 13, 14])

    const panels = mainEntries(stub)
    expect(panels.map((entry) => entry.options.key)).toEqual([
      'fenix-overview',
      'fenix-projects',
      'fenix-settings',
      'fenix-activities',
      'fenix-help',
    ])
    // main keyed 注册 id 与侧栏条目一一对应。
    expect(panels.map((entry) => entry.options.key)).toEqual(fixed.map((entry) => entry.options.id))

    // 固定条目组件是线性 svg 图标组件。
    for (const entry of fixed) {
      const rendered = (entry.component as (props: Record<string, unknown>) => unknown)({ size: 16 })
      expect(collectByType(rendered, 'svg')).toHaveLength(1)
    }
    stub.stop()
  })

  it('FIXED_ENTRIES 常量与 stub 注册一致（深链一一对应）', () => {
    expect(FIXED_ENTRIES.map((entry) => `${entry.id}${entry.route}${entry.order}`)).toEqual([
      'fenix-overview#/overview10',
      'fenix-projects#/projects11',
      'fenix-settings#/settings12',
      'fenix-activities#/activities13',
      'fenix-help#/help14',
    ])
  })

  it('项目动态条目：名称序 order 100 起、label=项目名、main 面板深链直达', async () => {
    // 故意乱序输入，验证注册按名称序。
    const stub = await applied({ fetchProjects: () => Promise.resolve(['fenixd', 'dsh-plugins', 'cc-import']) })

    const projects = sidebarEntries(stub, (options) => String(options.id).startsWith('fenix-project-'))
    expect(projects.map((entry) => entry.options.id)).toEqual([
      'fenix-project-cc-import',
      'fenix-project-dsh-plugins',
      'fenix-project-fenixd',
    ])
    expect(projects.map((entry) => entry.options.order)).toEqual([100, 101, 102])
    expect(projects.map((entry) => entry.options.label)).toEqual(['cc-import', 'dsh-plugins', 'fenixd'])

    const projectPanel = mainEntries(stub).find((entry) => entry.options.key === 'fenix-project-fenixd')
    const iframe = iframeOf(projectPanel?.component)
    expect(iframe.props?.src).toBe('/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects/fenixd')

    // 项目条目图标是首字母圆形徽标（span 内联样式）。
    const badge = (projects[0]?.component as (props: Record<string, unknown>) => unknown)({ size: 18 })
    const spans = collectByType(badge, 'span')
    expect(spans).toHaveLength(1)
    expect((spans[0]?.props?.style as Record<string, unknown>)?.['borderRadius']).toBe('50%')

    // stop：项目条目全部 dispose，固定条目不在 stop 范围（由 inject disposer 注销）。
    const projectCount = projects.length + mainEntries(stub).filter((entry) => String(entry.options.key).startsWith('fenix-project-')).length
    stub.stop()
    expect(stub.removed).toHaveLength(projectCount)
    for (const id of ['fenix-overview', 'fenix-projects', 'fenix-settings', 'fenix-activities', 'fenix-help']) {
      expect(stub.removed).not.toContain(`list:${id}`)
    }
  })

  it('拉取失败：仅固定条目存在，无未处理异常', async () => {
    const stub = await applied({ fetchProjects: () => Promise.reject(new Error('upstream down')) })
    await flush()
    const projects = sidebarEntries(stub, (options) => String(options.id).startsWith('fenix-project-'))
    expect(projects).toHaveLength(0)
    expect(sidebarEntries(stub)).toHaveLength(5)
    stub.stop()
  })

  it('空列表：不注册任何项目条目，固定条目照常', async () => {
    const stub = await applied({ fetchProjects: () => Promise.resolve([]) })
    expect(sidebarEntries(stub, (options) => String(options.id).startsWith('fenix-project-'))).toHaveLength(0)
    expect(sidebarEntries(stub)).toHaveLength(5)
    stub.stop()
  })
})
