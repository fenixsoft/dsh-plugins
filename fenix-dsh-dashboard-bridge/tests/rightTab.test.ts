/**
 * 右侧边栏「Fenix 项目」页签单测（2026-11-11 m02220 语义纠正批次）：
 * 路由纯函数、guide/definition 注册契约、body seat keyed 注册、iframe src
 * 随 navigation.params 深链、openTab 装配与服务缺席降级。
 */
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import {
  FENIX_TAB_ID,
  FENIX_TAB_KIND,
  createFenixProjectsBody,
  createSidebarProjectOpener,
  LOCATE_ICON_KEY,
  registerFenixRightTab,
  registerLocateMenuIcon,
  routeForSidebarParams,
} from '../src/client/rightTab.js'
import type { FenixTabBodyProps, SidebarRightTabsLike } from '../src/client/rightTab.js'

describe('routeForSidebarParams（params → dashboard hash 路由）', () => {
  it('params 缺席/空 project：项目总览单入口 #/projects', () => {
    expect(routeForSidebarParams(undefined)).toBe('#/projects')
    expect(routeForSidebarParams({})).toBe('#/projects')
    expect(routeForSidebarParams({ project: '', path: 'a/b' })).toBe('#/projects')
  })

  it('project + path：homeFileRouteFor 同形深链（rel 经 URI 编码）', () => {
    expect(routeForSidebarParams({ project: 'cloud-phone', path: 'client-windows/build' })).toBe(
      '#/projects/cloud-phone?tab=home&path=client-windows%2Fbuild',
    )
  })

  it('project 无 path：项目首页根路由（path 缺席视为项目根）', () => {
    expect(routeForSidebarParams({ project: 'fenixd' })).toBe('#/projects/fenixd')
    expect(routeForSidebarParams({ project: 'fenixd', path: '' })).toBe('#/projects/fenixd')
  })
})

/* ============ 注册契约（桩替身） ============ */

interface RecordedDefinition {
  readonly id: string
  readonly kind: string
  readonly keepMounted?: boolean
  readonly title: (address: string) => string
  readonly guide?: readonly {
    readonly id: string
    readonly order: number
    readonly title: () => string
    readonly description?: () => string
  }[]
}

/** sidebarRightTabs + slots.register 最小桩：记录 definition 与 body seat。 */
function tabStub() {
  const definitions: RecordedDefinition[] = []
  const seats: Array<{ name: string; key: string; component: unknown }> = []
  const disposed: string[] = []
  const ctx = {
    sidebarRightTabs: {
      register(definition: RecordedDefinition): () => void {
        definitions.push(definition)
        return () => {
          disposed.push(`definition:${definition.id}`)
        }
      },
    } satisfies SidebarRightTabsLike,
    slots: {
      register(options: { name: string; key: string }, component: unknown): () => void {
        seats.push({ ...options, component })
        return () => {
          disposed.push(`seat:${options.key}`)
        }
      },
    },
  }
  return { ctx, definitions, seats, disposed }
}

describe('registerFenixRightTab（definition + body seat 两段注册）', () => {
  it('注册契约：id/kind/keepMounted 钉值；title 与 guide 文案钉', () => {
    const stub = tabStub()
    registerFenixRightTab(stub.ctx, '/fenix-dashboard')
    expect(stub.definitions).toHaveLength(1)
    const def = stub.definitions[0]
    expect(def?.id).toBe(FENIX_TAB_ID)
    expect(def?.id).toBe('fenix-dsh-dashboard-bridge')
    expect(def?.kind).toBe(FENIX_TAB_KIND)
    expect(def?.kind).toBe('fenix-dashboard')
    expect(def?.keepMounted).toBe(true)
    expect(def?.title('/fenix-dashboard')).toBe('Fenix 项目')
    expect(def?.guide).toHaveLength(1)
    expect(def?.guide?.[0]?.id).toBe('projects')
    expect(def?.guide?.[0]?.title()).toBe('Fenix 项目')
    expect(def?.guide?.[0]?.description?.()).toContain('Fenix Dashboard')
  })

  it('body seat：slot 名 sidebar.right.pane.tab，key=definition id（契约钉）', () => {
    const stub = tabStub()
    registerFenixRightTab(stub.ctx, '/fenix-dashboard')
    expect(stub.seats).toHaveLength(1)
    expect(stub.seats[0]?.name).toBe('sidebar.right.pane.tab')
    expect(stub.seats[0]?.key).toBe('fenix-dsh-dashboard-bridge')
  })

  it('注销：definition disposer 与 body seat disposer 都被调用', () => {
    const stub = tabStub()
    const stop = registerFenixRightTab(stub.ctx, '/fenix-dashboard')
    stop()
    expect(stub.disposed).toEqual([
      `seat:${FENIX_TAB_ID}`,
      `definition:${FENIX_TAB_ID}`,
    ])
  })

  it('sidebarRightTabs 服务缺席：no-op 降级（注册不发生，返回幂等函数）', () => {
    const stop = registerFenixRightTab({}, '/fenix-dashboard')
    expect(typeof stop).toBe('function')
    expect(() => stop()).not.toThrow()
  })
})

describe('createFenixProjectsBody（iframe src 随 navigation.params 深链）', () => {
  const iframeSrcOf = (el: ReactElement): string => {
    const child = el.props.children as ReactElement
    return String(child.props.src)
  }

  it('guide 点击（无 useTabInfo/无 params）：iframe src 落项目总览 #/projects', () => {
    const body = createFenixProjectsBody('/fenix-dashboard')
    const el = body({})
    expect(iframeSrcOf(el)).toBe('/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects')
  })

  it('右键定位 params：iframe src 深链项目文件视图（buildPanelSrc 同形）', () => {
    const body = createFenixProjectsBody('/fenix-dashboard')
    const props: FenixTabBodyProps = {
      useTabInfo: () => ({
        tab: {
          navigation: {
            params: { project: 'cloud-phone', path: 'client-windows/build' },
            revision: 1,
          },
        },
      }),
    }
    expect(iframeSrcOf(body(props))).toBe(
      '/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects/cloud-phone?tab=home&path=client-windows%2Fbuild',
    )
  })

  it('useTabInfo 注入面抛错：按无 params 降级（项目总览），不崩', () => {
    const body = createFenixProjectsBody('/fenix-dashboard')
    const el = body({
      useTabInfo: () => {
        throw new Error('hook context exploded')
      },
    })
    expect(iframeSrcOf(el)).toContain('#/projects')
  })
})

describe('createSidebarProjectOpener（openTab 装配）', () => {
  it('服务在场：openTab(kind, {params}) 携 project/path', () => {
    const calls: Array<{ kind: string; params: unknown }> = []
    const opener = createSidebarProjectOpener({
      sidebarRight: {
        openTab(kind, options) {
          calls.push({ kind, params: (options as { params?: unknown } | undefined)?.params })
        },
      },
    })
    expect(typeof opener).toBe('function')
    opener?.('fenixd', 'src/a.ts')
    expect(calls).toEqual([{ kind: 'fenix-dashboard', params: { project: 'fenixd', path: 'src/a.ts' } }])
  })

  it('服务缺席/形状漂移：返回 undefined（locate 走 main 面板回退）', () => {
    expect(createSidebarProjectOpener({})).toBeUndefined()
    expect(createSidebarProjectOpener({ sidebarRight: {} as never })).toBeUndefined()
  })
})

describe('registerLocateMenuIcon（2026-11-11 用户需求：定位菜单项带图标）', () => {
  it('注册 contextMenu.icon keyed slot（key=LOCATE_ICON_KEY），组件渲染 crosshair svg', () => {
    const seats: Array<{ options: { name: string; key: string }; component: unknown }> = []
    const ctx = {
      slots: {
        register: (options: { name: string; key: string }, component: unknown) => {
          seats.push({ options, component })
          return () => {}
        },
      },
    }
    const stop = registerLocateMenuIcon(ctx as never)
    expect(seats).toHaveLength(1)
    expect(seats[0]?.options).toEqual({ name: 'contextMenu.icon', key: LOCATE_ICON_KEY })
    const el = (seats[0]?.component as () => ReactElement)()
    expect(el.type).toBe('svg')
    expect(JSON.stringify(el.props)).toContain('circle')
    stop()
  })

  it('注销：返回函数可反注册；slots 缺席返回 no-op', () => {
    let unregistered = 0
    const ctx = {
      slots: {
        register: () => () => {
          unregistered += 1
        },
      },
    }
    const stop = registerLocateMenuIcon(ctx as never)
    stop()
    expect(unregistered).toBe(1)
    expect(registerLocateMenuIcon({} as never)).toBeInstanceOf(Function)
  })
})
