/**
 * Client 半单测：iframe src 契约逐字符断言（默认/非默认前缀两组）+ 条目注册
 * 断言（桩 slots 上 5 固定条目 id/label/order、项目不再平铺注册、main keyed
 * 注册一一对应、面板组件渲染出的 iframe 属性）+ 「项目」条目 Portal 化退化
 * 断言（条目组件 = Portal 分区组件）+ 降级浮层分组与 Portal 分区两条路径的
 * 纯渲染/交互契约 + 锚点/宿主/挂载状态机纯判定（node 桩替身，不依赖真实 DOM）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FIXED_ENTRIES,
  apply,
  projectIdFor,
  projectPanelSelector,
  projectRouteFor,
} from '../src/client/index.js'
import type { ClientPluginOptions } from '../src/client/index.js'
import { buildPanelSrc, resolveBridgeConfig } from '../src/shared/config.js'
import {
  PORTAL_DEGRADE_FAILURES,
  SECTION_ANCHOR_SELECTOR,
  SECTION_HOST_TESTID,
  clampSectionRowWidth,
  isAnchorReachable,
  isPortalActive,
  isWideSectionWidth,
  mountSectionHost,
  nextPortalMountState,
  projectGroupStore,
  projectGroupHandlers,
  renderProjectGroup,
  renderProjectSection,
  sidebarNavFrom,
} from '../src/client/panels.js'
import type { PortalMountState, ProjectGroupHandlers, SectionHostElement } from '../src/client/panels.js'
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

/** 按 data-testid 收集元素树命中的 React 元素。 */
function collectByTestId(node: unknown, testId: string, acc: ElementLike[] = []): ElementLike[] {
  if (node === null || node === undefined) return acc
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return acc
  if (Array.isArray(node)) {
    for (const child of node) collectByTestId(child, testId, acc)
    return acc
  }
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    const element = node as ElementLike
    if (element.props?.['data-testid'] === testId) acc.push(element)
    collectByTestId(element.props?.children, testId, acc)
  }
  return acc
}

interface Registration {
  readonly slotName: string
  readonly options: Record<string, unknown>
  readonly component: unknown
}

/** 最小 slots/layout 桩：记录注册、维护 live 表、注销登记、selectPanel 调用迹。 */
function stubSlotsCtx() {
  const registrations: Registration[] = []
  const removed: string[] = []
  const injectCalls: string[] = []
  const selectedPanels: (string | null)[] = []
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
    layout: {
      selectPanel(panelId: string | null) {
        selectedPanels.push(panelId)
      },
    },
  }
  return { ctx, registrations, removed, injectCalls, live, selectedPanels }
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

    // 固定条目组件：线性 svg 图标组件 ×4 + 「项目」Portal 分区组件（hook 组件，
    // 订阅分组 store + 锚点/宿主管理；降级浮层与分区纯渲染断言分别在
    // 「项目」分组块 / 「项目」Portal 分区 describe 内经纯渲染面覆盖）。
    for (const entry of fixed) {
      const rendered = (entry.component as (props: Record<string, unknown>) => unknown)({ size: 16 }) as ElementLike
      if (entry.options.id === 'fenix-projects') {
        expect(typeof rendered.type, '「项目」条目为 Portal 分区组件（函数组件）').toBe('function')
        expect((rendered.type as { name?: string }).name, '「项目」条目组件为 Portal 分区内部组件').toBe(
          'ProjectSectionEntry',
        )
        expect(collectByType(rendered, 'svg')).toHaveLength(0)
      } else {
        expect(collectByType(rendered, 'svg'), `${String(entry.options.id)} 应为线性图标组件`).toHaveLength(1)
      }
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

  it('项目分组化：不平铺顶层条目；main 面板深链直达；数据源驱动分组', async () => {
    // 故意乱序输入，验证数据源按名称序。
    const stub = await applied({ fetchProjects: () => Promise.resolve(['fenixd', 'dsh-plugins', 'cc-import']) })

    // spec「项目收纳进分组」：侧栏不出现平铺的项目顶层条目。
    const projects = sidebarEntries(stub, (options) => String(options.id).startsWith('fenix-project-'))
    expect(projects).toHaveLength(0)
    expect(sidebarEntries(stub)).toHaveLength(5)

    // main keyed 注册契约不变：每项目 iframe 深链直达。
    const projectPanel = mainEntries(stub).find((entry) => entry.options.key === 'fenix-project-fenixd')
    const iframe = iframeOf(projectPanel?.component)
    expect(iframe.props?.src).toBe('/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects/fenixd')
    expect(projectGroupStore.getSnapshot().projects).toEqual(['cc-import', 'dsh-plugins', 'fenixd'])

    // stop：项目 main 面板全部 dispose，固定条目不在 stop 范围（由 inject disposer 注销）。
    const projectPanelCount = mainEntries(stub).filter((entry) =>
      String(entry.options.key).startsWith('fenix-project-'),
    ).length
    stub.stop()
    expect(stub.removed).toHaveLength(projectPanelCount)
    for (const id of ['fenix-overview', 'fenix-projects', 'fenix-settings', 'fenix-activities', 'fenix-help']) {
      expect(stub.removed).not.toContain(`list:${id}`)
      expect(stub.removed).not.toContain(`main:${id}`)
    }
  })

  it('空列表/上游停机：不注册项目 main 面板、分组数据源清空，无未处理异常', async () => {
    projectGroupStore.setActiveProject('stale')
    const empty = await applied({ fetchProjects: () => Promise.resolve([]) })
    expect(mainEntries(empty).filter((entry) => String(entry.options.key).startsWith('fenix-project-'))).toHaveLength(0)
    expect(projectGroupStore.getSnapshot().projects).toEqual([])
    empty.stop()

    const failed = await applied({ fetchProjects: () => Promise.reject(new Error('upstream down')) })
    await flush()
    expect(mainEntries(failed).filter((entry) => String(entry.options.key).startsWith('fenix-project-'))).toHaveLength(0)
    failed.stop()
  })
})

describe('「项目」分组块（降级浮层路径：纯渲染 + 交互契约）', () => {
  const noopRef = { current: null }

  /** 构造仅带 stopPropagation 的伪事件（handlers 契约面只消费它）。 */
  const fakeEvent = (): Parameters<ProjectGroupHandlers['toggleHeader']>[0] => ({ stopPropagation() {} }) as never

  function groupView(overrides: Partial<Parameters<typeof renderProjectGroup>[0]> = {}) {
    return {
      projects: ['fenixd', 'dsh-plugins'],
      expanded: true,
      activeProject: null,
      wide: true,
      rowWidth: 260,
      glyphRef: noopRef,
      ...overrides,
    }
  }

  beforeEach(() => {
    projectGroupStore.reset()
  })

  it('宽态展开：项目行 = 首字母徽标 + 项目名；行可点且带 data-testid', () => {
    const tree = renderProjectGroup(groupView(), {
      toggleHeader: () => {},
      selectProject: () => {},
    })
    const list = collectByTestId(tree, 'fenix-projects-list')
    expect(list).toHaveLength(1)
    for (const name of ['fenixd', 'dsh-plugins']) {
      const row = collectByTestId(tree, `fenix-project-row-${name}`)
      expect(row, `项目行 ${name}`).toHaveLength(1)
      // 行内含首字母圆形徽标（span borderRadius 50%）与项目名文本。
      const style = row[0] && (collectByType(row[0], 'span').map((span) => span.props?.['style']) as (Record<string, unknown> | undefined)[])
      expect(style?.some((item) => item?.['borderRadius'] === '50%')).toBe(true)
    }
  })

  it('宽态折叠：列表不渲染；窄态（收起轨）仅徽标计数', () => {
    const collapsed = renderProjectGroup(groupView({ expanded: false }), { toggleHeader: () => {}, selectProject: () => {} })
    expect(collectByTestId(collapsed, 'fenix-projects-list')).toHaveLength(0)
    expect(collectByTestId(collapsed, 'fenix-projects-header')).toHaveLength(1)

    const rail = renderProjectGroup(groupView({ wide: false }), { toggleHeader: () => {}, selectProject: () => {} })
    const count = collectByTestId(rail, 'fenix-projects-rail-count')
    expect(count).toHaveLength(1)
    expect(collectByTestId(rail, 'fenix-projects-list')).toHaveLength(0)
  })

  it('空列表：分组呈现空态提示，不渲染项目行', () => {
    const tree = renderProjectGroup(groupView({ projects: [] }), { toggleHeader: () => {}, selectProject: () => {} })
    expect(collectByTestId(tree, 'fenix-projects-empty')).toHaveLength(1)
    expect(collectByTestId(tree, 'fenix-projects-list')).toHaveLength(1)
  })

  it('限高滚动：列表容器 maxHeight 有上限且 overflowY auto', () => {
    const tree = renderProjectGroup(groupView(), { toggleHeader: () => {}, selectProject: () => {} })
    const list = collectByTestId(tree, 'fenix-projects-list')[0]
    const style = list?.props?.['style'] as Record<string, unknown>
    expect(String(style?.['maxHeight'])).toMatch(/min\(\d+px/)
    expect(style?.['overflowY']).toBe('auto')
  })

  it('点击项目行：stopPropagation + selectProject(name)，当前行高亮', () => {
    const selected: string[] = []
    let propagationStopped = false
    const tree = renderProjectGroup(
      groupView({ activeProject: 'fenixd' }),
      projectGroupHandlers(projectGroupStore, {
        selectProject: (name) => {
          selected.push(name)
        },
      }),
    )
    const row = collectByTestId(tree, 'fenix-project-row-dsh-plugins')[0]
    const onClick = row?.props?.['onClick'] as (event: { stopPropagation(): void }) => void
    onClick({
      stopPropagation: () => {
        propagationStopped = true
      },
    })
    expect(selected).toEqual(['dsh-plugins'])
    expect(propagationStopped).toBe(true)
    // 当前高亮项目行 data-active 标记。
    const activeRow = collectByTestId(tree, 'fenix-project-row-fenixd')[0]
    expect(activeRow?.props?.['data-active']).toBe(true)
    const style = activeRow?.props?.['style'] as Record<string, unknown>
    expect(String(style?.['background'])).toContain('var(')
  })

  it('点击头部行：stopPropagation + 仅切换展开/折叠（不触发 selectProject）', () => {
    let selected = 0
    const tree = renderProjectGroup(
      groupView(),
      projectGroupHandlers(projectGroupStore, {
        selectProject: () => {
          selected += 1
        },
      }),
    )
    const header = collectByTestId(tree, 'fenix-projects-header')[0]
    const onClick = header?.props?.['onClick'] as (event: { stopPropagation(): void }) => void
    onClick({ stopPropagation: () => {} })
    expect(projectGroupStore.getSnapshot().expanded).toBe(false)
    expect(selected).toBe(0)
  })

  it('projectGroupHandlers：stopPropagation 后分别落 store 切换与 deps.selectProject', () => {
    const selected: string[] = []
    const handlers = projectGroupHandlers(projectGroupStore, { selectProject: (name) => selected.push(name) })
    handlers.toggleHeader(fakeEvent())
    expect(projectGroupStore.getSnapshot().expanded).toBe(false)
    handlers.selectProject('fenixd', fakeEvent())
    expect(selected).toEqual(['fenixd'])
    // store 高亮由 index.ts 的 selector 落（此处只验证 handler 不越权改高亮）。
    expect(projectGroupStore.getSnapshot().activeProject).toBeNull()
  })
})

describe('projectPanelSelector（点击 → layout.selectPanel 契约）', () => {
  beforeEach(() => {
    projectGroupStore.reset()
  })

  it('调用 layout.selectPanel(projectId) 并更新分组高亮', () => {
    const selectedPanels: (string | null)[] = []
    const ctx = {
      layout: {
        selectPanel(panelId: string | null) {
          selectedPanels.push(panelId)
        },
      },
    }
    projectPanelSelector(ctx as never)('fenixd')
    expect(selectedPanels).toEqual([projectIdFor('fenixd')])
    expect(projectGroupStore.getSnapshot().activeProject).toBe('fenixd')
  })

  it('layout.selectPanel 抛错（面板未注册）：吞掉 warn，不抛未处理异常', () => {
    const ctx = {
      layout: {
        selectPanel() {
          throw new Error('layout.selectPanel: main panel "fenix-project-x" is not registered')
        },
      },
    }
    expect(() => projectPanelSelector(ctx as never)('x')).not.toThrow()
    expect(projectGroupStore.getSnapshot().activeProject).toBeNull()
  })

  it('layout 服务缺失（异常环境）：静默降级，仅 warn 不抛', () => {
    expect(() => projectPanelSelector({} as never)('fenixd')).not.toThrow()
  })
})

/* ==================== 「项目」Portal 分区（spec 2026-11 Portal 化） ==================== */

describe('「项目」Portal 分区（纯渲染 + 交互契约）', () => {
  const noopHandlers: ProjectGroupHandlers = { toggleHeader: () => {}, selectProject: () => {} }

  function sectionView(overrides: Partial<Parameters<typeof renderProjectSection>[0]> = {}) {
    return {
      projects: ['fenixd', 'dsh-plugins'],
      expanded: true,
      activeProject: null,
      wide: true,
      rowWidth: 260,
      ...overrides,
    }
  }

  beforeEach(() => {
    projectGroupStore.reset()
  })

  it('宽态展开：常驻分区 = 标题行（项目 + 计数 + chevron）+ 首字母徽标项目行', () => {
    const tree = renderProjectSection(sectionView(), noopHandlers)
    const section = collectByTestId(tree, 'fenix-projects-section')
    expect(section).toHaveLength(1)
    const title = collectByTestId(tree, 'fenix-projects-section-title')[0]
    expect(title).toBeDefined()
    const titleTexts = collectByType(title, 'span').flatMap((span) =>
      typeof span.props?.children === 'string' ? [span.props.children] : [],
    )
    expect(titleTexts).toContain('项目')
    const count = collectByTestId(tree, 'fenix-projects-section-count')[0]
    expect(count?.props?.children).toBe(2)
    for (const name of ['fenixd', 'dsh-plugins']) {
      const row = collectByTestId(tree, `fenix-project-row-${name}`)
      expect(row, `项目行 ${name}`).toHaveLength(1)
      const styles = row[0] && (collectByType(row[0], 'span').map((span) => span.props?.style) as (Record<string, unknown> | undefined)[])
      expect(styles?.some((item) => item?.['borderRadius'] === '50%'), '行内含首字母圆形徽标').toBe(true)
    }
  })

  it('限高滚动：列表容器 maxHeight 有上限（min(…px, 46vh)）且 overflowY auto', () => {
    const tree = renderProjectSection(sectionView(), noopHandlers)
    const list = collectByTestId(tree, 'fenix-projects-list')[0]
    const style = list?.props?.['style'] as Record<string, unknown>
    expect(String(style?.['maxHeight'])).toMatch(/min\(\d+px, 46vh\)/)
    expect(style?.['overflowY']).toBe('auto')
  })

  it('点击项目行：stopPropagation + selectProject(name)；当前行高亮', () => {
    const selected: string[] = []
    let propagationStopped = false
    const tree = renderProjectSection(
      sectionView({ activeProject: 'fenixd' }),
      projectGroupHandlers(projectGroupStore, {
        selectProject: (name) => {
          selected.push(name)
        },
      }),
    )
    const row = collectByTestId(tree, 'fenix-project-row-dsh-plugins')[0]
    const onClick = row?.props?.['onClick'] as (event: { stopPropagation(): void }) => void
    onClick({
      stopPropagation: () => {
        propagationStopped = true
      },
    })
    expect(selected).toEqual(['dsh-plugins'])
    expect(propagationStopped).toBe(true)
    const activeRow = collectByTestId(tree, 'fenix-project-row-fenixd')[0]
    expect(activeRow?.props?.['data-active']).toBe(true)
    const style = activeRow?.props?.['style'] as Record<string, unknown>
    expect(String(style?.['background'])).toContain('var(')
  })

  it('点击分区标题行：仅切换展开/折叠（不触发 selectProject）', () => {
    let selected = 0
    const tree = renderProjectSection(
      sectionView(),
      projectGroupHandlers(projectGroupStore, {
        selectProject: () => {
          selected += 1
        },
      }),
    )
    const title = collectByTestId(tree, 'fenix-projects-section-title')[0]
    const onClick = title?.props?.['onClick'] as (event: { stopPropagation(): void }) => void
    onClick({ stopPropagation: () => {} })
    expect(projectGroupStore.getSnapshot().expanded).toBe(false)
    expect(selected).toBe(0)
  })

  it('折叠态：列表不渲染；窄态（收起轨）：标题收敛为计数、展开时徽标栈无项目名文本', () => {
    const collapsed = renderProjectSection(sectionView({ expanded: false }), noopHandlers)
    expect(collectByTestId(collapsed, 'fenix-projects-list')).toHaveLength(0)
    expect(collectByTestId(collapsed, 'fenix-projects-section-title')).toHaveLength(1)

    const rail = renderProjectSection(sectionView({ wide: false }), noopHandlers)
    expect(collectByTestId(rail, 'fenix-projects-section-count')[0]?.props?.children).toBe(2)
    const rows = collectByTestId(rail, 'fenix-project-row-fenixd')
    expect(rows).toHaveLength(1)
    // 徽标栈行：仅首字母徽标（文本=首字母，带 50% 圆角），无项目名文本 span。
    const spans = collectByType(rows[0], 'span')
    expect(spans.map((span) => span.props?.children)).toEqual(['F'])
    expect(
      spans.some((span) => (span.props?.style as Record<string, unknown> | undefined)?.['textOverflow'] === 'ellipsis'),
      '窄态行不含项目名（ellipsis）span',
    ).toBe(false)
  })

  it('空列表（宽态）：分区呈现空态提示，不渲染项目行', () => {
    const tree = renderProjectSection(sectionView({ projects: [] }), noopHandlers)
    expect(collectByTestId(tree, 'fenix-projects-empty')).toHaveLength(1)
    expect(collectByTestId(tree, 'fenix-projects-list')).toHaveLength(1)
  })
})

describe('「项目」分区锚点/宿主/挂载状态机（纯判定，node 桩替身）', () => {
  /** 桩锚点原点：closest('nav') 返回注入的候选。 */
  function fakeOrigin(nav: unknown): { closest(selectors: string): unknown } {
    return {
      closest(selectors: string) {
        return selectors === SECTION_ANCHOR_SELECTOR ? nav : null
      },
    }
  }

  function fakeHost(overrides: Partial<SectionHostElement> = {}): SectionHostElement {
    return {
      dataset: {},
      style: { cssText: '' },
      isConnected: true,
      remove() {},
      previousElementSibling: undefined,
      ...overrides,
    }
  }

  it('sidebarNavFrom：语义锚点 closest(nav) 命中；非 nav/缺失原点返回 null', () => {
    const nav = { tag: 'nav' }
    expect(sidebarNavFrom(fakeOrigin(nav))).toBe(nav)
    expect(sidebarNavFrom(fakeOrigin(undefined))).toBeNull()
    expect(sidebarNavFrom(null)).toBeNull()
    expect(sidebarNavFrom(undefined)).toBeNull()
  })

  it('isAnchorReachable：isConnected 判定可达性（null/非对象不可达）', () => {
    expect(isAnchorReachable(fakeHost())).toBe(true)
    expect(isAnchorReachable(fakeHost({ isConnected: false }))).toBe(false)
    expect(isAnchorReachable(null)).toBe(false)
    expect(isAnchorReachable('nav')).toBe(false)
  })

  it('mountSectionHost：宿主 div 插入 nav 紧后兄弟位并带 testid/收缩样式', () => {
    const host = fakeHost()
    const inserted: { position?: string; element?: unknown } = {}
    const nav = {
      insertAdjacentElement(position: string, element: unknown) {
        inserted.position = position
        inserted.element = element
        return element
      },
    }
    expect(mountSectionHost(nav, { createElement: () => host })).toBe(host)
    expect(inserted.position).toBe('afterend')
    expect(inserted.element).toBe(host)
    expect(host.dataset.testid).toBe(SECTION_HOST_TESTID)
    expect(host.style.cssText).toContain('min-height:0')
  })

  it('mountSectionHost：插入失败（返回 null，如 nav 断连）→ 返回 null 交状态机累计', () => {
    const nav = {
      insertAdjacentElement() {
        return null
      },
    }
    expect(mountSectionHost(nav, { createElement: () => fakeHost() })).toBeNull()
  })

  it('nextPortalMountState：连续失败达阈值置 degraded；成功清零；同态幂等同引用', () => {
    let state: PortalMountState = { status: 'seeking', failures: 0 }
    state = nextPortalMountState(state, false)
    expect(state).toEqual({ status: 'seeking', failures: 1 })
    state = nextPortalMountState(state, false)
    expect(state).toEqual({ status: 'seeking', failures: 2 })
    state = nextPortalMountState(state, false)
    expect(state, `连续 ${PORTAL_DEGRADE_FAILURES} 次失败置 degraded`).toEqual({ status: 'degraded', failures: 3 })
    // degraded 幂等：继续失败保持原态（轮询兜底持续运行，不无限累计）。
    expect(nextPortalMountState(state, false)).toBe(state)
    // 恢复：挂载成功 → active 且清零（degraded 可恢复而非永久停用）。
    const recovered = nextPortalMountState(state, true)
    expect(recovered).toEqual({ status: 'active', failures: 0 })
    // active 幂等：成功但已 active 返回同引用（React setState 天然去重）。
    expect(nextPortalMountState(recovered, true)).toBe(recovered)
  })

  it('isPortalActive：active + 宿主连接才生效；degraded/宿主被删均不生效', () => {
    expect(isPortalActive({ status: 'active', failures: 0 }, fakeHost())).toBe(true)
    expect(isPortalActive({ status: 'active', failures: 0 }, fakeHost({ isConnected: false }))).toBe(false)
    expect(isPortalActive({ status: 'degraded', failures: 3 }, fakeHost())).toBe(false)
    expect(isPortalActive({ status: 'seeking', failures: 1 }, fakeHost())).toBe(false)
    expect(isPortalActive({ status: 'active', failures: 0 }, null)).toBe(false)
  })

  it('宽窄态判定与行宽钳制阈值', () => {
    expect(isWideSectionWidth(280)).toBe(true)
    expect(isWideSectionWidth(120)).toBe(true)
    expect(isWideSectionWidth(56)).toBe(false)
    expect(clampSectionRowWidth(280)).toBe(280)
    expect(clampSectionRowWidth(400)).toBe(360)
    expect(clampSectionRowWidth(90)).toBe(160)
  })
})
