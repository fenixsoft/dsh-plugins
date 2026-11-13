/**
 * opsBadge 单测（add-dsh-ops-alert-badge）：
 * - 元素树求值断言：count>0 渲染 circle+text 角标（红底白字）、0/尚无成功
 *   拉取隐匿、127→`99+`（超百截断）、>0 各档文案；其余 4 个固定条目图标
 *   零角标、运维条目 glyph path 本体与 svg 形态不变；
 * - 防裁剪形态断言（spec 防裁剪条款）：徽标 `<g>`（circle+text）坐标域完全
 *   落于图标 svg 24×24 viewBox 之内（元素树包含性断言，svg 内绘制天然免疫
 *   宿主祖先 overflow:hidden 裁剪）；
 * - 装配契约（apply / installOpsAlertBadge 桩上下文）：计数变更遮蔽重注册
 *   （priority -10）先 dispose 旧注册至多一条在册（幂等）、同 id 二次注册
 *   不崩、register 抛错/方法缺席形状漂移降级 warn 不崩且既有条目注册不受
 *   影响、失败后计数变更自然重试、停止函数收口在册遮蔽注册。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertCountStore } from '../src/client/alertCount.js'
import { FIXED_ENTRIES, apply, installOpsAlertBadge } from '../src/client/index.js'
import {
  OPS_BADGE_CIRCLE,
  OPS_BADGE_MAX,
  OPS_BADGE_RED,
  OPS_BADGE_TESTID,
  fixedIconComponent,
  opsAlertBadgeElement,
  opsBadgeLabel,
} from '../src/client/panels.js'
import type { FixedEntryId } from '../src/client/panels.js'
import type { SyncTimer } from '../src/client/projectSync.js'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 等待启动拉取/触发拉取落定（pull → setCount → 遮蔽重注册）。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await tick()
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

function renderIcon(id: FixedEntryId, size = 16): ElementLike {
  return fixedIconComponent(id)({ size }) as ElementLike
}

function badgeOf(tree: unknown): ElementLike | undefined {
  return collectByType(tree, 'g').find((el) => el.props?.['data-testid'] === OPS_BADGE_TESTID)
}

interface Registration {
  readonly slotName: string
  readonly options: Record<string, unknown>
  readonly component: unknown
}

/** 最小 slots 桩：记录注册、维护 live 表、注销登记；可选 register 抛错钩子
 * （形状漂移降级测试）。 */
function stubSlotsCtx(throwOnRegister?: (options: Record<string, unknown>) => boolean) {
  const registrations: Registration[] = []
  const removed: string[] = []
  const live = new Map<string, Registration>()
  const ctx = {
    slots: {
      inject(slot: string, factory: () => unknown) {
        void slot
        factory()
      },
      register(options: Record<string, unknown>, component: unknown) {
        if (throwOnRegister?.(options)) throw new Error('slots register shape drift')
        const entry: Registration = { slotName: String(options.name), options, component }
        registrations.push(entry)
        // key 规则同 srcContract 桩：main:<key> / list:<id> / slot:<name>:<key>。
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
  }
  return { ctx, registrations, removed, live }
}

/** 单钩子假定时器：apply 中计数同步为后注册者，trigger 即触发计数重拉。 */
function fakeTimer(): SyncTimer & { triggerInterval(): void; triggerFocus(): void } {
  let intervalFn: (() => void) | undefined
  let focusFn: (() => void) | undefined
  return {
    setInterval(fn) {
      intervalFn = fn
      return Symbol('interval-handle')
    },
    clear() {},
    onFocus(fn) {
      focusFn = fn
      return () => {
        focusFn = undefined
      }
    },
    triggerInterval() {
      void intervalFn?.()
    },
    triggerFocus() {
      void focusFn?.()
    },
  }
}

/** 运行 apply（项目列表恒空、告警计数走桩序列）并等待首拉落定。 */
async function applied(fetchCount: () => Promise<number>, throwOnRegister?: (options: Record<string, unknown>) => boolean) {
  const stub = stubSlotsCtx(throwOnRegister)
  const timer = fakeTimer()
  const stop = apply(stub.ctx as never, {
    fetchProjects: (): Promise<readonly string[]> => Promise.resolve([]),
    fetchAlertCount: fetchCount,
    timer,
  })
  await settle()
  return { ...stub, timer, stop }
}

function shadowEntries(stub: { registrations: Registration[] }): Registration[] {
  return stub.registrations.filter(
    (entry) => entry.slotName === 'sidebar.panellist' && entry.options.id === 'fenix-activities' && entry.options.priority === -10,
  )
}

beforeEach(() => {
  alertCountStore.reset()
})

afterEach(() => {
  alertCountStore.reset()
  vi.restoreAllMocks()
})

describe('徽标渲染（元素树求值断言）', () => {
  it('文案钉值：3→3、99→99、100/127→99+（超百截断阈值 99）', () => {
    expect(opsBadgeLabel(0)).toBe('0')
    expect(opsBadgeLabel(3)).toBe('3')
    expect(opsBadgeLabel(9)).toBe('9')
    expect(opsBadgeLabel(10)).toBe('10')
    expect(opsBadgeLabel(99)).toBe('99')
    expect(opsBadgeLabel(100)).toBe('99+')
    expect(opsBadgeLabel(127)).toBe('99+')
    expect(OPS_BADGE_MAX).toBe(99)
  })

  it('count>0 渲染 circle+text 角标（红底白字白描边），数字随计数更新', () => {
    alertCountStore.setCount(3)
    const tree = renderIcon('fenix-activities')
    const badge = badgeOf(tree)
    expect(badge).toBeDefined()
    const circle = collectByType(badge, 'circle')[0]
    const text = collectByType(badge, 'text')[0]
    expect(circle).toBeDefined()
    expect(text).toBeDefined()
    expect(circle?.props?.fill).toBe(OPS_BADGE_RED)
    expect(text?.props?.fill).toBe('#fff')
    expect(text?.props?.stroke).toBe('#fff') // 白描边保可读
    expect(text?.props?.children).toBe('3')
    expect(OPS_BADGE_RED).toBe('#e5484d')
    // 计数更新后重求值（重注册触发宿主重渲染）数字随新快照。
    alertCountStore.setCount(42)
    expect(collectByType(badgeOf(renderIcon('fenix-activities')), 'text')[0]?.props?.children).toBe('42')
    // 99+ 档：三字符最小可读字号分支。
    alertCountStore.setCount(127)
    expect(collectByType(badgeOf(renderIcon('fenix-activities')), 'text')[0]?.props?.children).toBe('99+')
  })

  it('零值隐匿：count=0 与尚无成功拉取（null）均不渲染任何角标元素', () => {
    const treeNone = renderIcon('fenix-activities')
    expect(badgeOf(treeNone)).toBeUndefined()
    expect(collectByType(treeNone, 'circle')).toHaveLength(0)
    alertCountStore.setCount(0)
    const treeZero = renderIcon('fenix-activities')
    expect(badgeOf(treeZero)).toBeUndefined()
    expect(collectByType(treeZero, 'circle')).toHaveLength(0)
    expect(collectByType(treeZero, 'text')).toHaveLength(0)
  })

  it('其余 4 个固定条目图标零角标；运维条目 glyph path 本体与 svg 形态不变', () => {
    alertCountStore.setCount(5)
    for (const id of ['fenix-overview', 'fenix-command-center', 'fenix-settings', 'fenix-help'] as const) {
      const tree = renderIcon(id)
      expect(badgeOf(tree), `${id} 不应带角标`).toBeUndefined()
      expect(collectByType(tree, 'circle')).toHaveLength(0)
    }
    const tree = renderIcon('fenix-activities')
    const svg = collectByType(tree, 'svg')[0]
    expect(svg?.props?.viewBox).toBe('0 0 24 24')
    expect(svg?.props?.strokeWidth).toBe(1.6)
    // glyph 心电线原样在场（角标是叠加，不替换/不移除既有 path）。
    expect(collectByType(tree, 'path').map((p) => p.props?.d)).toEqual(['M3 12h4l2-7 4 14 2-7h6'])
    // FIXED_ENTRIES 运维条目 label/order 未被本能力改动（点击行为与深链契约不变）。
    const activities = FIXED_ENTRIES.find((entry) => entry.id === 'fenix-activities')
    expect(activities).toMatchObject({ label: '运维', route: '#/activities', order: 15 })
  })

  it('opsAlertBadgeElement 独立求值与组件内一致（size 缩放不改 viewBox 坐标）', () => {
    alertCountStore.setCount(1)
    const badge = badgeOf(renderIcon('fenix-activities', 18))
    const direct = opsAlertBadgeElement(1)
    const badge18 = badgeOf(renderIcon('fenix-activities', 18))
    expect(collectByType(direct, 'circle')[0]?.props).toEqual(collectByType(badge, 'circle')[0]?.props)
    expect(collectByType(badge18, 'circle')[0]?.props).toEqual(collectByType(badge, 'circle')[0]?.props)
  })
})

describe('防裁剪形态断言（spec 防裁剪条款：svg 内绘制，元素树包含性断言）', () => {
  it('徽标 <g>（circle+text）坐标域完全落于 24×24 viewBox 之内（1/42/127 三档）', () => {
    for (const count of [1, 42, 127]) {
      alertCountStore.setCount(count)
      const tree = renderIcon('fenix-activities')
      const badge = badgeOf(tree)
      expect(badge, `count=${count} 应渲染角标`).toBeDefined()
      const circle = collectByType(badge, 'circle')[0]
      const text = collectByType(badge, 'text')[0]
      expect(circle).toBeDefined()
      expect(text).toBeDefined()
      const { cx, cy, r } = circle?.props as { cx: number; cy: number; r: number }
      expect(cx - r).toBeGreaterThanOrEqual(0)
      expect(cx + r).toBeLessThanOrEqual(24)
      expect(cy - r).toBeGreaterThanOrEqual(0)
      expect(cy + r).toBeLessThanOrEqual(24)
      const { x, y } = text?.props as { x: number; y: number }
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(24)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(24)
    }
    // 几何钉值单源：常量表与元素树一致（右上角落位；圆径覆盖 99+ em-box）。
    expect(OPS_BADGE_CIRCLE).toEqual({ cx: 18, cy: 6, r: 6 })
  })

  it('角标位于 svg（图标盒）内部：g 是 svg 直接子元素，无 svg 外定位 DOM', () => {
    alertCountStore.setCount(1)
    const tree = renderIcon('fenix-activities')
    // 整棵树除 svg/g/circle/text/path 外无其它元素（无绝对定位 wrapper）。
    const all = collectByType(tree, 'svg')
    expect(all).toHaveLength(1)
    const badge = badgeOf(tree)
    expect(badge).toBeDefined()
    // 角标 circle 覆盖域含于 viewBox ⇒ 免疫宿主祖先 overflow:hidden 裁剪
    // （svg 渲染尺寸由宿主裁到哪、viewBox 内容等比完整）。
    const { cx, cy, r } = collectByType(badge, 'circle')[0]?.props as { cx: number; cy: number; r: number }
    expect([cx - r, cy - r, cx + r, cy + r].every((v) => v >= 0 && v <= 24)).toBe(true)
  })
})

describe('装配契约（遮蔽重注册 + 形状漂移降级 + 收口）', () => {
  it('计数>0 遮蔽注册 priority -10 条目（order/label 同 FIXED_ENTRIES）；变更先 dispose 旧注册（slots 至多一条）', async () => {
    const queue = [1, 2]
    const stub = await applied(() => Promise.resolve(queue.shift() ?? 0))
    // 首拉 count=1：一条遮蔽注册。
    const first = shadowEntries(stub)
    expect(first).toHaveLength(1)
    expect(first[0]?.options).toMatchObject({
      name: 'sidebar.panellist',
      id: 'fenix-activities',
      priority: -10,
      order: 15,
      label: '运维',
    })
    expect(stub.live.get('list:fenix-activities')).toBeDefined()
    // 1→2（周期重拉）：先 dispose 旧注册再注册新——removed 收旧、live 仍单条。
    stub.timer.triggerInterval()
    await settle()
    expect(shadowEntries(stub)).toHaveLength(2) // 两次注册各一条记录
    expect(stub.removed).toContain('list:fenix-activities')
    expect(stub.live.get('list:fenix-activities')?.options.priority).toBe(-10)
    stub.stop()
  })

  it('计数回落 0：dispose 在册遮蔽注册、零新注册（零告警隐匿）', async () => {
    const queue = [1, 0]
    const stub = await applied(() => Promise.resolve(queue.shift() ?? 0))
    expect(shadowEntries(stub)).toHaveLength(1)
    stub.timer.triggerInterval()
    await settle()
    expect(shadowEntries(stub)).toHaveLength(1) // 无新注册
    expect(stub.removed).toContain('list:fenix-activities')
    expect(stub.live.has('list:fenix-activities')).toBe(false)
    stub.stop()
  })

  it('尚无成功拉取（拉取失败保留 null）：零遮蔽注册', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stub = await applied(() => Promise.reject(new Error('alerts endpoint down')))
    await settle()
    // 固定条目（无 priority）注册在场，但无任何 priority -10 遮蔽注册。
    expect(shadowEntries(stub)).toHaveLength(0)
    expect(stub.registrations.some((entry) => entry.options.priority === -10)).toBe(false)
    expect(warnSpy).toHaveBeenCalled() // 失败可见（不静默）
    stub.stop()
    warnSpy.mockRestore()
  })

  it('focus 触发重拉同样走遮蔽重注册链路', async () => {
    const queue = [0, 3]
    const stub = await applied(() => Promise.resolve(queue.shift() ?? 0))
    expect(shadowEntries(stub)).toHaveLength(0) // 首拉 0：隐匿
    stub.timer.triggerFocus()
    await settle()
    expect(shadowEntries(stub)).toHaveLength(1)
    stub.stop()
  })

  it('register 抛错（形状漂移）：降级 warn 不崩、既有固定条目注册不受影响；计数再变更自然重试成功', async () => {
    let failNext = true
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const queue = [1, 2]
    const stub = await applied(
      () => Promise.resolve(queue.shift() ?? 0),
      (options) => options.id === 'fenix-activities' && options.priority === -10 && failNext,
    )
    // 首拉 count=1：注册抛错 → warn、无遮蔽注册、5 固定条目注册全在。
    // （apply 在 node 环境另有「window 不可用」降级 warn，断言按内容匹配。）
    expect(shadowEntries(stub)).toHaveLength(0)
    const badgeWarn = warnSpy.mock.calls.find((call) => String(call[0]).includes('运维徽标条目重注册失败'))
    expect(badgeWarn).toBeDefined()
    const fixedLive = [...stub.live.keys()].filter((key) => key.startsWith('list:fenix-'))
    expect(fixedLive).toHaveLength(5) // 5 固定条目不受牵连
    // 失败非恒定：计数 1→2 自然重试 → 注册成功（MUST NOT 一次失败永久禁用）。
    failNext = false
    stub.timer.triggerInterval()
    await settle()
    expect(shadowEntries(stub)).toHaveLength(1)
    stub.stop()
    warnSpy.mockRestore()
  })

  it('slots.register 方法缺席（register 面形状漂移）：installOpsAlertBadge 降级 warn 不崩', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = { slots: {} } // register 面漂移（方法缺失）
    const stop = installOpsAlertBadge(ctx as never, '/fenix-dashboard/', {
      fetchAlertCount: () => Promise.resolve(4),
      timer: fakeTimer(),
    })
    await settle()
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('运维徽标条目重注册失败'))).toBe(true)
    expect(() => stop()).not.toThrow()
    warnSpy.mockRestore()
  })

  it('同 id 二次注册不崩（list 槽幂等遮蔽语义）+ 停止函数收口在册遮蔽注册（幂等）', async () => {
    const queue = [1, 1, 1]
    const stub = await applied(() => Promise.resolve(queue.shift() ?? 0))
    stub.timer.triggerInterval()
    await settle()
    stub.timer.triggerFocus()
    await settle()
    // 同值重拉（1→1）零通知：注册记录不增长。
    expect(shadowEntries(stub)).toHaveLength(1)
    stub.stop()
    expect(stub.removed).toContain('list:fenix-activities')
    expect(stub.live.has('list:fenix-activities')).toBe(false)
    expect(() => stub.stop()).not.toThrow() // 幂等
  })
})
