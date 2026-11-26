/**
 * Client 半单测（fenix-projects 条目恢复 + 文件右键定位批次后重整）：
 * - iframe src 契约逐字符断言（默认/非默认前缀两组）+ 条目注册断言（固定条目
 *   集合=6——「Fenix 项目」条目 2026-11-11 用户指令恢复（直达项目首页
 *   #/projects，与 2026-11-09 退役的逐项目平铺分区语义不同）、每项目 main
 *   keyed 注册契约不变）；
 * - `#panel=<未注册>` 深链未注册吞语义（deepLinkPanels，window 桩驱动
 *   hashchange 路径；fenix-projects 现已注册，改用真未注册 id 验证）；
 * - apply 桩上下文零网络（对齐依赖三缺一在测试桩上整段禁用的装配契约）；
 * - 文件右键「在 \<项目名\> 项目定位」装配契约（contextMenus/sessions 服务缺席
 *   → no-op 注销，无未处理异常；详测见 locate.test.ts）；
 * - 工作区行名称导航契约面（D1 锚点链 findNameTextElement node 桩替身、D2 判据
 *   四态 matchWorkspaceForProject、PROJECT_ROW_CSS 退役后形态、常量钉值）；
 * - projectSessionStarter 保留能力（行尾新会话 action 属官方 rowActions 链路）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  FIXED_ENTRIES,
  apply,
  deepLinkPanels,
  inject,
  projectIdFor,
  projectPanelSelector,
  projectRouteFor,
  projectSessionStarter,
  resolveWorkspaceIdForProject,
} from '../src/client/index.js'
import {
  PROJECT_SUMMARY_KEYS,
  buildProjectRowMap,
  matchWorkspaceForProject,
  normalizeWorkspacePath,
  parseProjectPath,
} from '../src/client/projectSync.js'
import type { ClientPluginOptions } from '../src/client/index.js'
import type { ProjectRowInfo, WorkspaceItemLike } from '../src/client/projectSync.js'
import { buildPanelSrc, resolveBridgeConfig } from '../src/shared/config.js'
import { createFenixProjectsBody } from '../src/client/rightTab.js'
import {
  PROJECT_ROW_CSS,
  WORKSPACE_NAV_OVERLAY_ATTR,
  WORKSPACE_NAV_RESCAN_DEBOUNCE_MS,
  WORKSPACE_ROW_KEY_PREFIX,
  WORKSPACE_ROW_SELECTOR,
  findNameTextElement,
  installWorkspaceNav,
  projectGroupStore,
} from '../src/client/panels.js'
import type { SyncTimer } from '../src/client/projectSync.js'
import {
  STATUS_LABEL_MAP,
  STATUS_PILL_MAX,
  STATUS_TONE_MAP,
  TIP_CARD_CSS,
  TIP_PILL_CSS,
  TONE_DARK,
  WORKSPACE_TIP_ATTR,
  WORKSPACE_TIP_DELAY_MS,
  WORKSPACE_TIP_GAP_PX,
  WORKSPACE_TIP_OFFSET_Y_PX,
  WORKSPACE_TIP_TESTID,
  WORKSPACE_TIP_WIDTH_PX,
  daemonPillOf,
  shouldRenderRichTip,
  statusPillsOf,
  tipCardSpec,
} from '../src/client/wsTooltip.js'
import type { ProjectSummaryProjection } from '../src/client/projectSync.js'

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

/** 最小 slots/layout 桩：记录注册、维护 live 表、注销登记（无 uiWorkspace/
 * workspaces 服务——对齐依赖在桩上整段禁用，零网络）。 */
function stubSlotsCtx() {
  const registrations: Registration[] = []
  const removed: string[] = []
  const injectCalls: string[] = []
  const runtimeInjectDeps: string[][] = []
  const live = new Map<string, Registration>()
  const ctx = {
    /** cordis 运行时 inject 桩（apply 经此装配 theme/locale follow，真实现 =
     * ctx.plugin({ inject, apply })，cordis lib/index.js:1672）：同步触发回调，
     * 子 ctx = 桩自身（theme/on 由 appliedWithTheme 经 Object.assign 后注入，
     * 回调闭包持同一对象引用，取到的即带服务的最终形态）。 */
    inject(deps: string[], callback: (c: unknown) => unknown) {
      runtimeInjectDeps.push(deps)
      const disposer = callback(ctx)
      return {
        dispose: typeof disposer === 'function' ? (disposer as () => void) : () => {},
      }
    },
    slots: {
      inject(slot: string, factory: () => unknown) {
        injectCalls.push(slot)
        factory()
      },
      register(options: Record<string, unknown>, component: unknown) {
        const entry: Registration = { slotName: String(options.name), options, component }
        registrations.push(entry)
        // key 规则：main 面板 main:<key>；具 id 条目 list:<id>；其余 keyed slot
        // （如 contextMenu.icon 定位图标）slot:<name>:<key>——同名无 id 注册
        // （右侧页签 seat 与图标 slot）不得互相覆盖。
        const key =
          entry.slotName === 'main'
            ? `main:${String(options.key)}`
            : options.id !== undefined
              ? `list:${String(options.id)}`
              : `slot:${entry.slotName}:${String(options.key)}`
        live.set(key, entry)
        return () => {
          if (live.delete(key)) removed.push(key)
        }
      },
    },
    layout: {
      selectPanel(panelId: string | null) {
        // 未注册面板抛错（对齐 dsh layout 真实行为，深链吞语义经此验证）。
        if (panelId !== null && !live.has(`main:${panelId}`)) {
          throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
        }
      },
    },
  }
  return { ctx, registrations, removed, injectCalls, runtimeInjectDeps, live }
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

/** 告警计数桩（零网络装配契约：apply 装配告警计数同步后桩上不触真实 fetch；
 * 返回 0 → 徽标隐匿，slots 里零遮蔽注册，既有条目计数断言不受影响）。 */
function noopAlertCount(): Promise<number> {
  return Promise.resolve(0)
}

/** 运行 apply 并等待启动拉取落定，返回桩上下文与 apply 停止函数。 */
async function applied(options: Omit<ClientPluginOptions, 'upstream'>) {
  const stub = stubSlotsCtx()
  const stop = apply(stub.ctx as never, { ...options, fetchAlertCount: noopAlertCount, timer: fakeTimer() })
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
  it('默认前缀：6 固定条目深链 → src 形态逐字符一致', () => {
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview',
    )
    // 「Fenix 项目」条目（2026-11-11 恢复）：项目总览单入口 #/projects。
    expect(buildPanelSrc('/fenix-dashboard/', '#/projects')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/command-center')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/command-center',
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

  it('每项目深链契约不变：#/projects/<name>（name 经 URI 编码）', () => {
    expect(projectRouteFor('dsh-plugins')).toBe('#/projects/dsh-plugins')
    expect(projectRouteFor('my project')).toBe('#/projects/my%20project')
    expect(projectIdFor('dsh-plugins')).toBe('fenix-project-dsh-plugins')
    expect(buildPanelSrc('/fenix-dashboard/', projectRouteFor('fenixd'))).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects/fenixd',
    )
  })

  it('注册面板组件渲染出契约 src（默认前缀，逐字符）', async () => {
    const stub = await applied({ fetchProjects: noopFetch })
    const panel = mainEntries(stub).find((entry) => entry.options.key === 'fenix-overview')
    expect(panel).toBeDefined()
    const iframe = iframeOf(panel?.component)
    expect(iframe.props?.src).toBe('/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview')
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
  it('固定条目集合=5：id/label/order 与 specs 一致；main keyed 注册一一对应；「Fenix 项目」不再在左侧 rail（m02220 语义纠正，移入右侧边栏页签）', async () => {
    const stub = await applied({ fetchProjects: noopFetch })

    expect(stub.injectCalls).toContain('sidebar.panellist')
    expect(stub.injectCalls).toContain('main')

    const fixed = sidebarEntries(stub, (options) => !String(options.id).startsWith('fenix-project-'))
    expect(fixed.map((entry) => entry.options.id)).toEqual([
      'fenix-overview',
      'fenix-command-center',
      'fenix-settings',
      'fenix-activities',
      'fenix-help',
    ])
    // label 全量 thunk 化（i18n 宿主语言跟随轮）：求值期经 pluginT 取菜单
    // 词典当前档；运维条目求值含告警计数 pill（原 2026-11-13 形态）。
    expect(fixed.map((entry) => entry.options.label)).toEqual([
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ])
    // 缺省（zh）档求值逐字=FIXED_ENTRIES 钉串
    const zhLabels = fixed.map((entry) => (entry.options.label as () => unknown)())
    expect(String(zhLabels[0])).toBe('概览')
    expect(String(zhLabels[1])).toBe('指挥中心')
    expect(String(zhLabels[2])).toBe('配置')
    expect(String(zhLabels[4])).toBe('帮助')
    expect(JSON.stringify(zhLabels[3])).toContain('运维')
    // order 段位（2026-11-05 重排）：概览10 / 配置13 / 运维15 / 指挥中心16 /
    // 帮助18。视觉序由 OFFICIAL_PANEL_REORDER 遮蔽段位（14/17）合成。
    expect(fixed.map((entry) => entry.options.order)).toEqual([10, 16, 13, 15, 18])

    const panels = mainEntries(stub)
    expect(panels.map((entry) => entry.options.key)).toEqual([
      'fenix-overview',
      'fenix-command-center',
      'fenix-settings',
      'fenix-activities',
      'fenix-help',
    ])
    // main keyed 注册 id 与侧栏条目一一对应。
    expect(panels.map((entry) => entry.options.key)).toEqual(fixed.map((entry) => entry.options.id))
    // m02220 语义纠正确认：左侧 rail 与 main 均无 fenix-projects（右侧边栏
    // 页签承载，见 rightTab.test.ts）。
    expect(panels.map((entry) => entry.options.key)).not.toContain('fenix-projects')

    // 固定条目组件：全部为线性 svg 图标组件。
    for (const entry of fixed) {
      const rendered = (entry.component as (props: Record<string, unknown>) => unknown)({ size: 16 }) as ElementLike
      expect(collectByType(rendered, 'svg'), `${String(entry.options.id)} 应为线性图标组件`).toHaveLength(1)
    }
    stub.stop()
  })

  it('FIXED_ENTRIES 常量与 stub 注册一致（条目集合=5；2026-11-05 重排段位；fenix-projects 已移出）', () => {
    expect(FIXED_ENTRIES.map((entry) => `${entry.id}${entry.route}${entry.order}`)).toEqual([
      'fenix-overview#/overview10',
      'fenix-command-center#/command-center16',
      'fenix-settings#/settings13',
      'fenix-activities#/activities15',
      'fenix-help#/help18',
    ])
    const ids = FIXED_ENTRIES.map((entry) => entry.id)
    expect(ids).toHaveLength(5)
    // m02220 语义纠正：「侧边栏」指对话界面右缘 dock——左侧 rail 不再携带
    // 「Fenix 项目」条目（FixedEntryId 联合与 FIXED_GLYPHS 均已移除该键）。
    expect(ids).not.toContain('fenix-projects')
    // 重排段位契约（2026-11-05 用户指令）：与 OFFICIAL_PANEL_REORDER 遮蔽改写
    // （plugins→14 / schedules→17）合成后，侧栏视觉序为
    // 概览/配置/插件/运维/指挥中心/自动化任务/帮助——桥接自身段位与官方遮蔽
    // 段位互不重叠。
    expect(Object.fromEntries(FIXED_ENTRIES.map((entry) => [entry.id, entry.order]))).toEqual({
      'fenix-overview': 10,
      'fenix-command-center': 16,
      'fenix-settings': 13,
      'fenix-activities': 15,
      'fenix-help': 18,
    })
  })

  it('项目分组化：不平铺顶层条目；每项目 main 面板深链直达；数据源驱动名称导航', async () => {
    // 故意乱序输入，验证数据源按名称序。
    const stub = await applied({ fetchProjects: () => Promise.resolve(['fenixd', 'dsh-plugins', 'cc-import']) })

    // spec「项目收纳进官方工作区列表」：侧栏不出现平铺的项目顶层条目。
    const projects = sidebarEntries(stub, (options) => String(options.id).startsWith('fenix-project-'))
    expect(projects).toHaveLength(0)
    // 5 固定条目（fenix-projects 已移出左侧 rail，m02220 语义纠正）。
    expect(sidebarEntries(stub)).toHaveLength(5)

    // main keyed 注册契约不变：每项目 iframe 深链直达（名称导航落点）。
    const projectPanel = mainEntries(stub).find((entry) => entry.options.key === 'fenix-project-fenixd')
    const iframe = iframeOf(projectPanel?.component)
    expect(iframe.props?.src).toBe('/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects/fenixd')
    // 名称导航数据源驱动（去重码点序）。
    expect(projectGroupStore.getSnapshot().projects).toEqual(['cc-import', 'dsh-plugins', 'fenixd'])

    // stop：项目 main 面板全部 dispose；stop 范围另含定位图标 keyed slot
    // （contextMenu.icon，2026-11-11 菜单图标批次）——右页签 definition 走
    // sidebarRightTabs 桩（本用例未装）不入 removed。
    const projectPanelCount = mainEntries(stub).filter((entry) =>
      String(entry.options.key).startsWith('fenix-project-'),
    ).length
    stub.stop()
    expect(stub.removed).toHaveLength(projectPanelCount + 1)
    expect(stub.removed).toContain('slot:contextMenu.icon:fenix-dashboard-bridge.locate-icon')
    for (const id of ['fenix-overview', 'fenix-settings', 'fenix-activities', 'fenix-command-center', 'fenix-help']) {
      expect(stub.removed).not.toContain(`list:${id}`)
      expect(stub.removed).not.toContain(`main:${id}`)
    }
  })

  it('apply 桩上下文零网络：对齐依赖（uiWorkspace/workspaces 服务）在桩上缺席 → fetchProjectRows 不被消费', async () => {
    // 装配契约：defaultFetchProjectRows 恒注入但依赖三缺一整段禁用——测试桩
    // 不产生任何真实 fetch 外呼（网络泄漏防线）。
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const stub = await applied({ fetchProjects: noopFetch })
    await flush()
    expect(fetchSpy).not.toHaveBeenCalled()
    stub.stop()
    fetchSpy.mockRestore()
  })

  it('空列表/上游停机：不注册项目 main 面板、数据源清空，无未处理异常', async () => {
    projectGroupStore.reset()
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

describe('deepLinkPanels：#panel=<未注册> 深链未注册吞语义', () => {
  /** 最小 window 桩：注入 globalThis.window 驱动 hashchange 读向路径，测试后摘除。 */
  function withFakeWindow<T>(hash: string, run: (listeners: Map<string, Array<() => void>>) => T): T {
    const listeners = new Map<string, Array<() => void>>()
    const win = {
      location: { hash, pathname: '/', search: '' },
      history: { replaceState: () => {} },
      addEventListener: (type: string, fn: () => void) => {
        const list = listeners.get(type) ?? []
        list.push(fn)
        listeners.set(type, list)
      },
      removeEventListener: () => {},
    }
    ;(globalThis as { window?: unknown }).window = win
    try {
      return run(listeners)
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  }

  it('hashchange 解析未注册面板 id：尝试 selectPanel 后吞错，维持当前视图，无未处理异常', () =>
    // fenix-projects 已随 m02220 语义纠正移出左侧 rail/main（右侧边栏页签
    // 承载）——恢复为「真未注册 id」验证未注册吞语义。
    withFakeWindow('#panel=fenix-projects', (listeners) => {
      const selected: (string | null)[] = []
      const originalSelect = (id: string | null): void => {
        selected.push(id)
        if (id === 'fenix-projects') {
          throw new Error('layout.selectPanel: main panel "fenix-projects" is not registered')
        }
      }
      const ctx = { layout: { selectPanel: originalSelect } }
      const restore = deepLinkPanels(ctx as never)
      expect(() => {
        for (const fn of listeners.get('hashchange') ?? []) fn()
      }).not.toThrow()
      // 尝试发生了（深链 id 解析正确），错误被吞（维持当前视图）。
      expect(selected).toEqual(['fenix-projects'])
      // 恢复函数还原原生 selectPanel（身份可逆，双层包装防残留）。
      restore()
      expect((ctx.layout as { selectPanel: unknown }).selectPanel).toBe(originalSelect)
    }))

  it('无 hash：applyHash 空操作（不触碰 selectPanel）', () =>
    withFakeWindow('', (listeners) => {
      const selected: (string | null)[] = []
      const ctx = { layout: { selectPanel: (id: string | null) => void selected.push(id) } }
      const restore = deepLinkPanels(ctx as never)
      for (const fn of listeners.get('hashchange') ?? []) fn()
      expect(selected).toEqual([])
      restore()
    }))
})

describe('projectPanelSelector（名称点击 → layout.selectPanel 契约）', () => {
  it('调用 layout.selectPanel(projectId)（每项目 keyed 面板，契约不变）', () => {
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
  })

  it('layout 服务缺失（异常环境）：静默降级，仅 warn 不抛', () => {
    expect(() => projectPanelSelector({} as never)('fenixd')).not.toThrow()
  })
})

/* ============ 工作区行名称导航（D1 锚点链 + D2 判据，node 桩替身） ============ */

describe('工作区行名称导航契约面', () => {
  const item = (workspaceId: string, path: string, title: string): WorkspaceItemLike => ({ workspaceId, path, title })

  it('常量钉值（语义锚点，非 CSS 哈希类名）', () => {
    expect(WORKSPACE_ROW_KEY_PREFIX).toBe('workspace:')
    expect(WORKSPACE_ROW_SELECTOR).toBe('[data-row-key^="workspace:"]')
    expect(WORKSPACE_NAV_OVERLAY_ATTR).toBe('data-fenix-wsnav')
    expect(WORKSPACE_NAV_RESCAN_DEBOUNCE_MS).toBe(300)
  })

  it('D2 判据①：归一化路径优先命中（分隔符/尾斜杠归一后相等）', () => {
    const items = [item('w1', '/root/fenixd/', 'fenixd'), item('w2', '/root/other', 'other')]
    expect(matchWorkspaceForProject(items, '/root/fenixd', 'fenixd')?.workspaceId).toBe('w1')
    expect(matchWorkspaceForProject(items, '/root\\fenixd', 'fenixd')?.workspaceId).toBe('w1')
  })

  it('D2 判据②：同名标题非同路径不命中（path 在场只认路径身份，标题不回落）', () => {
    // 用户自建同名标题工作区不是项目行（D2 刻意严于 resolveWorkspaceIdForProject
    // 的标题优先序——路径身份才是真项目行）。
    const items = [item('w-user', '/root/user-fenixd', 'fenixd')]
    expect(matchWorkspaceForProject(items, '/root/fenixd', 'fenixd')).toBeNull()
  })

  it('D2 判据③：title 回落——path 不可得时标题精确相等命中', () => {
    const items = [item('w1', '/root/renamed-dir', 'fenixd')]
    expect(matchWorkspaceForProject(items, null, 'fenixd')?.workspaceId).toBe('w1')
  })

  it('D2 判据④：未命中返回 null（空表/title 非精确相等）', () => {
    expect(matchWorkspaceForProject([], null, 'fenixd')).toBeNull()
    expect(matchWorkspaceForProject([item('w1', '/r/x', 'fenixd-renamed')], null, 'fenixd')).toBeNull()
  })

  it('normalizeWorkspacePath：反斜杠统一 + 去尾斜杠；不做 fs 规范化（无 realpath 承诺）', () => {
    expect(normalizeWorkspacePath('/root/fenixd')).toBe('/root/fenixd')
    expect(normalizeWorkspacePath('/root/fenixd/')).toBe('/root/fenixd')
    expect(normalizeWorkspacePath('/root\\fenixd\\')).toBe('/root/fenixd')
    expect(normalizeWorkspacePath('C:\\repo\\fenixd\\\\')).toBe('C:/repo/fenixd')
    expect(normalizeWorkspacePath('/')).toBe('')
  })

  it('buildProjectRowMap：workspaceId→项目名映射；rows 缺行走 title 兜底；项目不在列表不入 map', () => {
    const items = [
      item('w1', '/root/fenixd', 'fenixd'),
      item('w2', '/root/other-dir', 'dsh-plugins'), // title 精确相等（路径不可得时兜底命中）
    ]
    const rows: readonly ProjectRowInfo[] = [
      { name: 'fenixd', path: '/root/fenixd' },
      { name: 'dsh-plugins', path: null }, // 路径查询缺失 → title 兜底命中 w2
    ]
    const map = buildProjectRowMap(items, ['fenixd', 'dsh-plugins'], rows)
    expect(map.get('w1')).toBe('fenixd')
    expect(map.get('w2')).toBe('dsh-plugins')
    // 项目已删除（不在 projects）：其工作区行不入 map → 行失去拦截层回退原生。
    expect(buildProjectRowMap(items, ['fenixd'], rows).has('w2')).toBe(false)
  })

  it('D1 锚点链：无子元素且 trim 文本精确相等的元素命中（span.projectText > span.title 双层内层）', () => {
    const leaf = (text: string, childrenLength = 0) => ({ textContent: text, children: { length: childrenLength } })
    const row = {
      querySelectorAll: () => [
        leaf('fenixd', 1), // 外层 projectText（有子元素，跳过）
        leaf(' fenixd '), // 内层 title（trim 后精确相等，命中）
        leaf('other'),
      ],
    }
    expect(findNameTextElement(row, 'fenixd')).toEqual(leaf(' fenixd '))
  })

  it('D1 锚点缺失：名称文本不可定位返回 null（该行不装拦截层，静默降级）', () => {
    const miss = { querySelectorAll: () => [{ textContent: 'other', children: { length: 0 } }] }
    expect(findNameTextElement(miss, 'fenixd')).toBeNull()
    expect(findNameTextElement({ querySelectorAll: () => [] }, 'fenixd')).toBeNull()
    // 同文本多命中取文档序最深（最后一个无子元素命中）。
    const first = { textContent: 'fenixd', children: { length: 0 } }
    const second = { textContent: 'fenixd', children: { length: 0 } }
    const nested = { querySelectorAll: () => [first, second] }
    expect(findNameTextElement(nested, 'fenixd')).toBe(second)
  })

  it('installWorkspaceNav node 环境 no-op（无 document 不产观察器/定时器泄漏）', () => {
    expect(typeof document).toBe('undefined')
    const stop = installWorkspaceNav({} as never, { selectProject: () => {} })
    expect(() => stop()).not.toThrow()
    expect(() => stop()).not.toThrow() // 幂等
  })

  it('PROJECT_ROW_CSS 退役后形态：仅官方 regionArea 列表滚动条 5 规则（分区列表失效选择器已删）', () => {
    const rules = PROJECT_ROW_CSS.split('\n')
    expect(rules).toHaveLength(5)
    for (const rule of rules) {
      expect(rule).toContain('[class*="_regionArea"] [class*="_list"]::-webkit-scrollbar')
    }
    expect(PROJECT_ROW_CSS).toContain('width: 6px')
    expect(PROJECT_ROW_CSS).toContain('--dsh-scrollbar-thumb')
    expect(PROJECT_ROW_CSS).toContain('::-webkit-scrollbar-track { background-color: transparent; }')
    expect(PROJECT_ROW_CSS).toContain('::-webkit-scrollbar-button { display: none; }')
    // 分区面退役：testid 作用域选择器与行 hover/active 类规则不复存在。
    expect(PROJECT_ROW_CSS).not.toContain('[data-testid=')
    expect(PROJECT_ROW_CSS).not.toContain('.fenix-project-row')
  })
})

/* ============ 工作区行项目富提示（add-workspace-row-project-tooltip 契约面） ============ */

describe('工作区行项目富提示契约面', () => {
  const summaryOf = (overrides: Partial<ProjectSummaryProjection>): ProjectSummaryProjection => ({
    name: 'fenixd',
    path: '/root/fenixd',
    description: null,
    daemon: null,
    hosting: null,
    exists: true,
    discovered: false,
    error: null,
    status_counts: null,
    task_done: null,
    task_total: null,
    active_runs: null,
    ...overrides,
  })

  it('常量钉值（锚属性/testid/延迟 500ms/卡宽 300/行右间距 12/纵偏 -5/折叠上限 4）', () => {
    expect(WORKSPACE_TIP_ATTR).toBe('data-fenix-wstip')
    expect(WORKSPACE_TIP_TESTID).toBe('fenix-wstip-card')
    expect(WORKSPACE_TIP_DELAY_MS).toBe(500)
    expect(WORKSPACE_TIP_WIDTH_PX).toBe(300)
    expect(WORKSPACE_TIP_GAP_PX).toBe(12)
    expect(WORKSPACE_TIP_OFFSET_Y_PX).toBe(-5)
    expect(STATUS_PILL_MAX).toBe(4)
  })

  it('状态→tone 映射钉值（STATUS_META 单源 + blocked 分相 repairing/queued）', () => {
    expect(STATUS_TONE_MAP).toEqual({
      drafted: 'muted',
      ready: 'info',
      reviewing: 'aqua',
      implementing: 'warning',
      implemented: 'aqua',
      testing: 'info',
      verified: 'good',
      'bug-found': 'critical',
      blocked: 'critical',
      done: 'good',
      pushed: 'good',
      repairing: 'info',
      queued: 'warning',
    })
    // i18n 宿主跟随轮：STATUS_LABEL_MAP 值为 pluginLocale 词典键（显示名
    // 双语在 pluginLocale.ts 词典，渲染求值期经 pluginT 取当前档）。
    expect(STATUS_LABEL_MAP).toEqual({
      drafted: 'wsTooltip.status.drafted',
      ready: 'wsTooltip.status.ready',
      reviewing: 'wsTooltip.status.reviewing',
      implementing: 'wsTooltip.status.implementing',
      implemented: 'wsTooltip.status.implemented',
      testing: 'wsTooltip.status.testing',
      verified: 'wsTooltip.status.verified',
      'bug-found': 'wsTooltip.status.bugFound',
      blocked: 'wsTooltip.status.blocked',
      done: 'wsTooltip.status.done',
      pushed: 'wsTooltip.status.pushed',
      repairing: 'wsTooltip.status.repairing',
      queued: 'wsTooltip.status.queued',
    })
  })

  it('方案B 暗面派生色钉值（文字亮化 + 同相 16%~22% 透明底，原型定稿表逐值）', () => {
    expect(TONE_DARK).toEqual({
      info: ['#7aa2ff', 'rgba(37,99,235,.16)'],
      warning: ['#f0ac54', 'rgba(217,119,6,.16)'],
      critical: ['#ff8080', 'rgba(220,38,38,.18)'],
      good: ['#5fce8f', 'rgba(22,163,74,.16)'],
      aqua: ['#45c1dc', 'rgba(8,145,178,.16)'],
      muted: ['#a9b4c0', 'rgba(100,116,139,.22)'],
    })
  })

  it('投影键集合钉值（D1 + error 降级标记，键删除即红）', () => {
    expect([...PROJECT_SUMMARY_KEYS]).toEqual([
      'name',
      'path',
      'description',
      'daemon',
      'hosting',
      'exists',
      'discovered',
      'error',
      'status_counts',
      'task_done',
      'task_total',
      'active_runs',
    ])
  })

  it('深卡样式钉值：dsh 原生 tooltip 实测规格逐值在场；零 animation/transition（静态渲染红线）', () => {
    expect(TIP_CARD_CSS).toContain('background:#2C2C2E')
    expect(TIP_CARD_CSS).toContain('border-radius:16px')
    expect(TIP_CARD_CSS).toContain('padding:12px 16px')
    expect(TIP_CARD_CSS).toContain('box-shadow:rgba(0,0,0,.2) 0 0 1px 0,rgba(0,0,0,.02) 0 0 4px 0,rgba(0,0,0,.08) 0 12px 32px 0')
    expect(TIP_CARD_CSS).toContain('font-size:12px')
    expect(TIP_CARD_CSS).toContain('width:300px')
    expect(TIP_CARD_CSS).toContain('position:fixed')
    expect(TIP_CARD_CSS).toContain('display:none')
    expect(TIP_PILL_CSS).toContain('border-radius:999px')
    expect(TIP_PILL_CSS).toContain('font-size:12px')
    expect(TIP_PILL_CSS).toContain('padding:1px 9px')
    // 零动画声明：显隐纯 display 切换。
    expect(TIP_CARD_CSS).not.toContain('transition')
    expect(TIP_CARD_CSS).not.toContain('animation')
    expect(TIP_PILL_CSS).not.toContain('transition')
    expect(TIP_PILL_CSS).not.toContain('animation')
  })

  it('回退分支：投影缺失/exists:false/error 非空 → 不渲染富提示（回退原生提示）', () => {
    expect(shouldRenderRichTip(undefined)).toBe(false)
    expect(shouldRenderRichTip(summaryOf({ exists: false }))).toBe(false)
    expect(shouldRenderRichTip(summaryOf({ error: 'describe failed' }))).toBe(false)
    expect(shouldRenderRichTip(summaryOf({}))).toBe(true)
  })

  it('运行态胶囊判定（台账名称行同口径）：running 分托管、stopped 未运行、其他不渲染', () => {
    expect(daemonPillOf(summaryOf({ daemon: 'running', hosting: 'managed' }))).toEqual({ label: '运行中', tone: 'good' })
    expect(daemonPillOf(summaryOf({ daemon: 'running', hosting: 'unmanaged' }))).toEqual({
      label: '运行中·未托管',
      tone: 'warning',
    })
    expect(daemonPillOf(summaryOf({ daemon: 'stopped' }))).toEqual({ label: '未运行', tone: 'warning' })
    expect(daemonPillOf(summaryOf({ daemon: null }))).toBeNull()
    expect(daemonPillOf(summaryOf({ daemon: 'weird-health' }))).toBeNull()
  })

  it('状态胶囊组：非零筛选 + 确定序（STATUS_LABEL_MAP 键序、未知殿后）+ 超 4 折叠 +N；全零/缺失空组', () => {
    // 确定序：输入乱序，输出按 STATUS_LABEL_MAP 键序（drafted→…→pushed）。
    const pills = statusPillsOf({ pushed: 2, drafted: 3, blocked: 1 })
    expect(pills.map((pill) => `${pill.label} ${pill.count}`)).toEqual(['草稿 3', '阻塞 1', '已推送 2'])
    expect(pills.map((pill) => pill.tone)).toEqual(['muted', 'critical', 'good'])
    // 零值状态不渲染。
    expect(statusPillsOf({ done: 0, pushed: 1 }).map((pill) => pill.label)).toEqual(['已推送'])
    // 超 4 折叠：前 4 + +N muted。
    const folded = statusPillsOf({ drafted: 1, ready: 1, reviewing: 1, implementing: 1, implemented: 2 })
    expect(folded).toHaveLength(5)
    expect(folded[4]).toEqual({ status: '+N', label: '+1', tone: 'muted', count: 0 })
    // 全零/缺失：空组（胶囊组区域不渲染）。
    expect(statusPillsOf({ done: 0 })).toEqual([])
    expect(statusPillsOf(null)).toEqual([])
  })

  it('富卡内容规格：空简介「暂无简介」；任务/Agent null → 「—」；真实 0 照显；简介超长由渲染面 CSS 截断（单行）', () => {
    const empty = tipCardSpec(summaryOf({ description: '' }))
    expect(empty.description).toEqual({ text: '暂无简介', empty: true })
    expect(empty.tasks).toBeNull()
    expect(empty.activeRuns).toBeNull()
    const full = tipCardSpec(
      summaryOf({
        description: 'Fenix 主仓'.padEnd(300, '长'),
        task_done: 27,
        task_total: 31,
        active_runs: 0,
        status_counts: { implementing: 2 },
        daemon: 'running',
        hosting: 'managed',
      }),
    )
    expect(full.tasks).toBe('27/31')
    expect(full.activeRuns).toBe('0')
    expect(full.daemon).toEqual({ label: '运行中', tone: 'good' })
    expect(full.pills).toEqual([{ status: 'implementing', label: '实现中', tone: 'warning', count: 2 }])
    expect(full.description.empty).toBe(false)
  })
})

/* ============ projectSessionStarter（保留能力：行尾新会话 action 链路） ============ */

describe('projectSessionStarter 与配套解析（保留不动）', () => {
  it('resolveWorkspaceIdForProject：title 精确匹配优先，回落 path basename，未命中 null', () => {
    const items = [
      { workspaceId: 'w1', path: '/root/fenixd', title: 'fenixd' },
      { workspaceId: 'w2', path: '/root/dsh-plugins', title: 'dsh-plugins-renamed' },
    ]
    expect(resolveWorkspaceIdForProject(items, 'fenixd')).toBe('w1')
    // title 被改名过 → basename 口径兜底。
    expect(resolveWorkspaceIdForProject(items, 'dsh-plugins')).toBe('w2')
    expect(resolveWorkspaceIdForProject(items, 'missing')).toBeNull()
  })

  it('inject 声明：slots/layout/uiWorkspace/workspaces/sessions/contextMenus/sidebarRight/sidebarRightTabs 八键', () => {
    expect(inject).toContain('slots')
    expect(inject).toContain('layout')
    expect(inject).toContain('uiWorkspace')
    expect(inject).toContain('workspaces')
    // 文件右键「在 \<项目名\> 项目定位」（2026-11-11）新增消费面。
    expect(inject).toContain('sessions')
    expect(inject).toContain('contextMenus')
    // 右侧边栏「Fenix 项目」页签（2026-11-11 m02220 语义纠正）新增消费面。
    expect(inject).toContain('sidebarRight')
    expect(inject).toContain('sidebarRightTabs')
    // theme 不入 inject（2026-11-26 review 0920849798c7 核实：inject 为硬依赖声明，
    // 声明宿主不提供的服务=boot 期 waiting for service 永久 pending、D4 降级永不
    // 触发）——与 locale 同策略，由 installThemeFollow 运行时探测 + late-provide
    // 轮询兜底；旧版宿主缺席时静默降级 no-op。
    expect(inject).not.toContain('theme')
  })

  it('右侧边栏页签源码钉（rightTab.tsx）：两段注册契约与深链路由', () => {
    const src = readFileSync(new URL('../src/client/rightTab.tsx', import.meta.url), 'utf8')
    // definition 注册：id/kind 常量、keepMounted 保活、guide 文案。
    expect(src).toContain("export const FENIX_TAB_ID = 'fenix-dsh-dashboard-bridge'")
    expect(src).toContain("export const FENIX_TAB_KIND = 'fenix-dashboard'")
    expect(src).toContain('keepMounted: true')
    // guide/title 文案词典化（i18n 宿主跟随轮 + review e27cf35aea7b）：thunk 经
    // pluginT 渲染期求值（zh 档 'Fenix 项目' 由 rightTab.test.ts 行为钉兜底）。
    expect(src).toContain("title: () => pluginT('rightTab.title')")
    expect(src).toContain("id: 'projects'")
    // body seat：keyed slot 以 definition id 为 key（sidebar-right 契约）。
    expect(src).toContain("name: 'sidebar.right.pane.tab'")
    expect(src).toContain('key: FENIX_TAB_ID')
    // 深链路由：无 params → 项目总览；有 params → homeFileRouteFor 复用。
    expect(src).toContain("return '#/projects'")
    expect(src).toContain('homeFileRouteFor(')
    // 服务缺席降级：no-op unregister。
    expect(src).toContain('return () => {}')
  })

  it('文件右键定位源码钉（locate.ts）：openSidebarProjectTab 首选落点、main 面板回退', () => {
    const src = readFileSync(new URL('../src/client/locate.ts', import.meta.url), 'utf8')
    expect(src).toContain('openSidebarProjectTab')
    expect(src).toContain('typeof deps.openSidebarProjectTab === \'function\'')
    // 回退路径保留（sidebarRight 缺席环境）。
    expect(src).toContain('deps.openProjectAt(hit.name, route)')
    expect(src).toContain('deps.selectProject(hit.name)')
  })

  it('package.json dsh.client.inject：含 sidebar-right 与 theme 依赖包', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { inject?: string[] } }
    }
    const packages = pkg.dsh?.client?.inject ?? []
    expect(packages).toContain('@deepseek-ai/dsh-client-ui-sidebar-right')
    // 主题跟随（add-bridge-theme-channel）：注入主题包使 ctx.theme 服务可用。
    expect(packages).toContain('@deepseek-ai/dsh-client-ui-theme')
  })

  it('apply 桩上下文缺 contextMenus/sessions 服务：右键菜单注册 no-op 降级，stop 幂等', async () => {
    // 装配契约：registerFileContextMenu 服务缺失 → no-op unregister；apply 全链
    // （注册/stop）在最小桩上无未处理异常。
    const stub = await applied({ fetchProjects: noopFetch })
    expect(() => stub.stop()).not.toThrow()
    expect(() => stub.stop()).not.toThrow()
  })

  it('项目无工作区：自动按项目目录建工作区后 startSession（2026-11-03 用户反馈补齐）', async () => {
    const started: string[] = []
    const created: string[] = []
    const ctx = {
      uiWorkspace: {
        workspaces: {
          list: {
            getSnapshot: () => ({
              items: [{ workspaceId: 'w-known', path: '/root/fenixd', title: 'fenixd' }],
            }),
          },
        },
        startSession: (id: string) => {
          started.push(id)
        },
      },
      workspaces: {
        create: async (input: { path: string }) => {
          created.push(input.path)
          return { workspaceId: 'w-new' }
        },
      },
    }
    const fetches: string[] = []
    const starter = projectSessionStarter(ctx as never, '/fenix-dashboard/', {
      fetchProjectPath: (name) => {
        fetches.push(name)
        return Promise.resolve(name === 'newproj' ? '/root/newproj' : null)
      },
    })
    // 已有工作区：不建、不查路径，直接 startSession。
    starter('fenixd')
    await flush()
    expect(started).toEqual(['w-known'])
    expect(created).toEqual([])
    expect(fetches).toEqual([])
    // 无工作区：查路径 → create → startSession。
    starter('newproj')
    await flush()
    expect(fetches).toEqual(['newproj'])
    expect(created).toEqual(['/root/newproj'])
    expect(started).toEqual(['w-known', 'w-new'])
    // 目录不可得（exists=false/未注册）：warn 降级，不建不启。
    started.length = 0
    starter('ghost')
    await flush()
    expect(started).toEqual([])
    expect(created).toEqual(['/root/newproj'])
  })

  it('无工作区且 workspaces 服务缺失：warn 降级不外溢', async () => {
    const ctx = {
      uiWorkspace: {
        workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
        startSession: () => {},
      },
    }
    const starter = projectSessionStarter(ctx as never, '/fenix-dashboard/', {
      fetchProjectPath: () => Promise.resolve('/root/x'),
    })
    starter('orphan')
    await flush()
  })

  it('workspaces.create reject：warn 落日志不外溢', async () => {
    const ctx = {
      uiWorkspace: {
        workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
        startSession: () => {},
      },
      workspaces: {
        create: async () => {
          throw new Error('workspace create failed')
        },
      },
    }
    const starter = projectSessionStarter(ctx as never, '/fenix-dashboard/', {
      fetchProjectPath: () => Promise.resolve('/root/x'),
    })
    starter('boom')
    await flush()
  })

  it('parseProjectPath：exists 行取 path；exists=false/未命中/形状异常返回 null', () => {
    const payload = {
      projects: [
        { name: 'fenixd', path: '/root/fenixd', exists: true },
        { name: 'ghost', path: '/no/such/dir', exists: false },
        { name: 'nopath', exists: true },
      ],
    }
    expect(parseProjectPath(payload, 'fenixd')).toBe('/root/fenixd')
    expect(parseProjectPath(payload, 'ghost')).toBeNull()
    expect(parseProjectPath(payload, 'nopath')).toBeNull()
    expect(parseProjectPath(payload, 'missing')).toBeNull()
    expect(parseProjectPath({ projects: 'bad' }, 'fenixd')).toBeNull()
  })
})

/* ============ 宿主主题跟随（add-bridge-theme-channel 契约面） ============ */

/** 宿主主题快照桩（dsh-client-ui-theme ThemeSnapshot 最小形状）。 */
const themeSnapshotOf = (colorScheme: unknown): { active: { colorScheme: unknown } } => ({
  active: { colorScheme },
})

/** 宿主主题桩 ctx 组件：真实宿主 ctx 携 theme 服务 + cordis 事件总线的镜像
 * 形状（apply 内 installThemeFollow(ctx) 消费，接入点先于项目同步注册）。 */
function stubThemeHost(initial: string | undefined) {
  const listeners: Array<(snapshot: unknown) => void> = []
  return {
    theme: initial === undefined ? undefined : { getTheme: () => themeSnapshotOf(initial) },
    on: (event: string, listener: (snapshot: unknown) => void) => {
      expect(event).toBe('theme/change')
      listeners.push(listener)
      return () => {
        listeners.length = 0
      }
    },
    /** 手动派发宿主 theme/change（快照档触发缓存刷新 + 广播）。 */
    fire: (scheme: string): void => {
      for (const listener of [...listeners]) listener(themeSnapshotOf(scheme))
    },
  }
}

/** applied 变体：桩 ctx 携宿主主题服务（快照深/浅/缺席三档驱动）。 */
async function appliedWithTheme(
  initial: string | undefined,
  options: Omit<ClientPluginOptions, 'upstream'>,
) {
  const stub = stubSlotsCtx()
  const theme = stubThemeHost(initial)
  Object.assign(stub.ctx as Record<string, unknown>, { theme: theme.theme, on: theme.on })
  const stop = apply(stub.ctx as never, { ...options, fetchAlertCount: noopAlertCount, timer: fakeTimer() })
  await flush()
  return { ...stub, stop, fireTheme: theme.fire }
}

describe('宿主主题跟随（add-bridge-theme-channel）', () => {
  it('buildPanelSrc 新契约：白名单档拼 &theme= 段（apiBase 后 hash 前）；非法/缺省逐字符一致', () => {
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview', 'dark')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/overview',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview', 'light')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=light#/overview',
    )
    expect(buildPanelSrc('/dash/', '#/projects', 'dark')).toBe(
      '/dash/?embed=1&apiBase=/dash&theme=dark#/projects',
    )
    // 缺省/undefined/白名单外值：输出与既有契约逐字符一致（既有断言零改动的根据）。
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview', undefined)).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview',
    )
    expect(buildPanelSrc('/fenix-dashboard/', '#/overview', 'sepia')).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview',
    )
  })

  it('固定条目深链产出含 &theme= 段：快照深/浅两档（渲染期取缓存）', async () => {
    const dark = await appliedWithTheme('dark', { fetchProjects: noopFetch })
    const overview = mainEntries(dark).find((entry) => entry.options.key === 'fenix-overview')
    expect(iframeOf(overview?.component).props?.src).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/overview',
    )
    dark.stop()

    const light = await appliedWithTheme('light', { fetchProjects: noopFetch })
    const help = mainEntries(light).find((entry) => entry.options.key === 'fenix-help')
    expect(iframeOf(help?.component).props?.src).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=light#/help',
    )
    light.stop()
  })

  it('宿主主题 API 缺席：深链产出与既有契约逐字符一致（D4 降级零注入）', async () => {
    const stub = await appliedWithTheme(undefined, { fetchProjects: noopFetch })
    const overview = mainEntries(stub).find((entry) => entry.options.key === 'fenix-overview')
    expect(iframeOf(overview?.component).props?.src).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/overview',
    )
    stub.stop()
  })

  it('事件刷新缓存后：晚渲染固定面板与右缘页签注入最新档（先刷新缓存再广播）', async () => {
    const stub = await appliedWithTheme('light', { fetchProjects: noopFetch })
    stub.fireTheme('dark')
    const overview = mainEntries(stub).find((entry) => entry.options.key === 'fenix-overview')
    expect(iframeOf(overview?.component).props?.src).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/overview',
    )
    // 右缘页签 body 渲染惰性求值：同样注入最新档（spec「初始主题参数注入」
    // 三挂载点覆盖之一）。
    const body = createFenixProjectsBody('/fenix-dashboard')
    const iframe = collectByType(body({}), 'iframe')[0] as ElementLike | undefined
    expect(iframe?.props?.src).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/projects',
    )
    stub.stop()
  })

  it('项目面板注册期拼串取缓存：installThemeFollow 接入点先于项目同步注册（design D3）', async () => {
    const stub = await appliedWithTheme('dark', { fetchProjects: () => Promise.resolve(['fenixd']) })
    const projectPanel = mainEntries(stub).find((entry) => entry.options.key === 'fenix-project-fenixd')
    expect(iframeOf(projectPanel?.component).props?.src).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/projects/fenixd',
    )
    stub.stop()
  })

  it('三挂载点接线源码钉：固定条目/项目面板/右缘页签全量注入快照档 + 装配点先于注册', () => {
    const clientSrc = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    // 装配点在 apply 内、先于固定条目注入与项目同步（grep 对账：三处调用点
    // 全部注入，design Risks「三挂载点漏改」条款）。2026-11-26 起 theme/locale
    // follow 经运行时 inject 子上下文装配（服务闸：属性访问只对声明过该服务
    // 的 fiber 放行，静态声明受 fence 约束不得入——见 apply 服务闸注释）。
    expect(clientSrc).toContain(".inject(['theme'], (themeCtx) => {")
    expect(clientSrc).toContain(".inject(['locale'], (localeCtx) => {")
    expect(clientSrc).toContain('const stop = installThemeFollow(themeCtx as unknown as ThemeFollowContext)')
    expect(clientSrc).toContain('const stop = installLocaleFollow(localeCtx as unknown as LocaleFollowContext)')
    expect(clientSrc).toContain(
      'src: buildPanelSrc(prefix, entry.route, currentThemeScheme(), currentLocaleScheme()),',
    )
    expect(clientSrc).toContain(
      'const src = buildPanelSrc(prefix, route, currentThemeScheme(), currentLocaleScheme())',
    )
    const rightTabSrc = readFileSync(new URL('../src/client/rightTab.tsx', import.meta.url), 'utf8')
    expect(rightTabSrc).toContain(
      'buildPanelSrc(prefix, routeForSidebarParams(params), currentThemeScheme(), currentLocaleScheme()),',
    )
  })

  it('运行时 inject 装配行为钉：apply 经 ctx.inject 声明 [theme] [locale]，子 ctx 服务可达（服务闸实证形态）', async () => {
    const stub = await appliedWithTheme('dark', { fetchProjects: noopFetch })
    expect(stub.runtimeInjectDeps).toContainEqual(['theme'])
    expect(stub.runtimeInjectDeps).toContainEqual(['locale'])
    // 子 ctx（桩自身）携带 theme 服务：installThemeFollow 已取到初始档并落缓存
    const overview = mainEntries(stub).find((entry) => entry.options.key === 'fenix-overview')
    expect(iframeOf(overview?.component).props?.src).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard&theme=dark#/overview',
    )
    stub.stop()
  })
})
