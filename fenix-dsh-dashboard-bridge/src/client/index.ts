/**
 * fenix-dsh-dashboard-bridge Client 半（dsh.client, platform web）：
 * 向 `sidebar.panellist` 列表插槽注册 5 个固定菜单条目（概览/项目/设置/运维/
 * 帮助，order 10–14）并在 layout `main` keyed 插槽以相同 id 挂对应 iframe
 * 面板（hash 深链直达）；启动时拉取 `<prefix>/api/projects` 生成每项目动态
 * 条目（label=项目名，id `fenix-project-<name>`，order 100 起名称序），60s
 * 周期 + window focus 重拉并幂等同步（见 projectSync.ts）。
 *
 * 注册形态对照发行包 @deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js：
 * `ctx.slots.inject(slotName, factory)` + `ctx.slots.register(options, component)`，
 * 侧栏条目组件为图标组件（props {size, active}），main 条目以 `key` 注册。
 * 插件卸载时：固定条目由 inject 工厂返回的 disposer 注销；项目条目由同步
 * 停止函数统一 dispose。
 */
import type { Context } from '@deepseek-ai/cordis'
import { buildPanelSrc, resolveBridgeConfig } from '../shared/config.js'
import type { BridgeConfigInput } from '../shared/config.js'
import { DashboardPanel, fixedIconComponent, projectBadgeComponent } from './panels.js'
import type { FixedEntryId } from './panels.js'
import { DEFAULT_POLL_INTERVAL_MS, parseProjectNames, startProjectSync } from './projectSync.js'
import type { ProjectEntrySink, ProjectListFetcher, SyncTimer } from './projectSync.js'

/** 本插件消费的 client 服务键（无 RPC 需求，不引 api-remotes）。 */
export const inject = ['slots']

/** 5 个固定条目：id 与深链一一对应，order 10–14（位于 dsh web 既有条目之后）。 */
export interface FixedEntry {
  readonly id: FixedEntryId
  readonly label: string
  readonly route: string
  readonly order: number
}

export const FIXED_ENTRIES: readonly FixedEntry[] = [
  { id: 'fenix-overview', label: '概览', route: '#/overview', order: 10 },
  { id: 'fenix-projects', label: '项目', route: '#/projects', order: 11 },
  { id: 'fenix-settings', label: '设置', route: '#/settings', order: 12 },
  { id: 'fenix-activities', label: '运维', route: '#/activities', order: 13 },
  { id: 'fenix-help', label: '帮助', route: '#/help', order: 14 },
]

/** 项目动态条目 id：`fenix-project-<name>`。 */
export function projectIdFor(name: string): string {
  return `fenix-project-${name}`
}

/** 项目条目深链：`#/projects/<name>`（name 经 URI 编码）。 */
export function projectRouteFor(name: string): string {
  return `#/projects/${encodeURIComponent(name)}`
}

/** apply 的可注入选项：prefix 供测试/定制，其余注入点仅供单测桩用。 */
export interface ClientPluginOptions extends BridgeConfigInput {
  /** 项目列表拉取桩（缺省 fetch `<prefix>api/projects`）。 */
  readonly fetchProjects?: ProjectListFetcher
  /** 轮询周期（缺省 60s）。 */
  readonly intervalMs?: number
  /** 计时/焦点钩子桩（缺省真实定时器 + window focus）。 */
  readonly timer?: SyncTimer
}

/** 默认项目列表拉取：GET `<prefix>api/projects` → parseProjectNames。 */
export function defaultFetchProjects(prefix: string): ProjectListFetcher {
  return async () => {
    const response = await fetch(`${prefix}api/projects`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`fenix-dsh-dashboard-bridge: 拉取项目列表失败 HTTP ${response.status}`)
    }
    return parseProjectNames(await response.json())
  }
}

/** 项目条目汇：ctx.slots 上注册（条目 + main 面板）与注销，支持整体清理。 */
export function projectEntrySink(ctx: Context, prefix: string): ProjectEntrySink & { disposeAll(): void } {
  const disposers = new Map<string, () => void>()
  return {
    addProject({ name, order }) {
      const id = projectIdFor(name)
      const src = buildPanelSrc(prefix, projectRouteFor(name))
      const disposeEntry = ctx.slots.register(
        { name: 'sidebar.panellist', id, order, label: name },
        projectBadgeComponent(name),
      )
      const disposePanel = ctx.slots.register({ name: 'main', key: id }, () =>
        DashboardPanel({ src }),
      )
      disposers.set(name, () => {
        disposeEntry()
        disposePanel()
      })
    },
    removeProject(name) {
      const dispose = disposers.get(name)
      if (dispose !== undefined) {
        dispose()
        disposers.delete(name)
      }
    },
    disposeAll() {
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
    },
  }
}

/**
 * Client 插件体：注册 5 固定条目与 main 面板，启动项目列表同步。
 * slot 形状漂移（dsh 升级改名）时注册不生效、页面不崩（design Risks）。
 *
 * @returns 停止函数：停同步循环并 dispose 全部项目条目（固定条目由 inject
 * 工厂 disposer 随插件卸载注销）。
 */
export function apply(ctx: Context, options?: ClientPluginOptions): () => void {
  const resolved = resolveBridgeConfig(options)
  const prefix = resolved.prefix

  // 5 固定侧栏条目（线性图标 + 中文名，order 10–14）。
  ctx.slots.inject('sidebar.panellist', () => {
    const disposers = FIXED_ENTRIES.map((entry) =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: entry.id, order: entry.order, label: entry.label },
        fixedIconComponent(entry.id),
      ),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // main keyed 插槽：与侧栏条目同 id 的 iframe 面板（深链直达）。
  ctx.slots.inject('main', () => {
    const disposers = FIXED_ENTRIES.map((entry) =>
      ctx.slots.register({ name: 'main', key: entry.id }, () =>
        DashboardPanel({ src: buildPanelSrc(prefix, entry.route) }),
      ),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // 每项目动态条目：启动拉取 + 60s 周期 + window focus 幂等同步。
  const sink = projectEntrySink(ctx, prefix)
  const stopSync = startProjectSync({
    fetchProjects: options?.fetchProjects ?? defaultFetchProjects(prefix),
    sink,
    intervalMs: options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    timer: options?.timer,
  })

  return () => {
    stopSync()
    sink.disposeAll()
  }
}
