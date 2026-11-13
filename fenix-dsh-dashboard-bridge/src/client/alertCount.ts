/**
 * Client 半待裁决告警计数同步（add-dsh-ops-alert-badge）：
 * `GET <prefix>api/alerts`（fenixd dashboard 既有跨项目聚合端点，经 host 半
 * 既有同源反代透传，零新增端点）→ 解析 `alerts[]` 中 `choices` 非空的条目数
 * 为运维条目徽标计数。口径与 fenixd 仓 consolidate-alerts-to-ops-page 的
 * dashboard 侧栏运维徽标逐字一致（未处理且裁决 choices 非空；知情类/已处理/
 * superseded 不计）；刻意不用 `total_unhandled`（含知情类会虚高，双端同数
 * 避免「两个数字对不上」的用户困惑）。
 *
 * 节奏与降级同 startProjectSync 先例：60s 周期 + window focus 重拉、单次拉取
 * 10s 超时（超时 abort）；拉取失败/超时保留 store 现值（不归零、不伪造、
 * 不闪烁），warn 落日志防静默失败不可排障。计数时效承诺为分钟级（非实时）。
 */
import { defaultTimer, normalizeIntervalMs } from './projectSync.js'
import type { SyncTimer } from './projectSync.js'

/** 告警计数拉取器（ClientPluginOptions 桩注入口，同 ProjectListFetcher 模式）。 */
export type AlertCountFetcher = () => Promise<number>

/** 默认告警计数拉取超时（毫秒）：同项目列表拉取口径（悬挂请求超时后 abort）。 */
export const FETCH_ALERTS_TIMEOUT_MS = 10_000

/**
 * 解析 `/api/alerts` 应答为待裁决计数（纯函数，独立单测）：`alerts[]` 中
 * `Array.isArray(choices) && choices.length > 0` 的条目数。`alerts` 字段缺失
 * 或非数组按 0（spec「响应形状漂移按零处理」——口径不可判按零、徽标隐匿，
 * 与「网络失败保留旧值」是两条不同条款），MUST NOT 抛出未处理异常。
 */
export function parseAlertCount(payload: unknown): number {
  const alerts = (payload as { alerts?: unknown } | null | undefined)?.alerts
  if (!Array.isArray(alerts)) return 0
  let count = 0
  for (const item of alerts) {
    const choices = (item as { choices?: unknown } | null | undefined)?.choices
    if (Array.isArray(choices) && choices.length > 0) count += 1
  }
  return count
}

/**
 * 默认告警计数拉取：GET `<prefix>api/alerts` → parseAlertCount
 * （AbortController + 10s 超时 + !ok 抛错，同 fetchProjectRowsWithTimeout 口径）。
 */
export async function fetchAlertCount(prefix: string): Promise<number> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_ALERTS_TIMEOUT_MS)
  try {
    const response = await fetch(`${prefix}api/alerts`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`fenix-dsh-dashboard-bridge: 拉取告警计数失败 HTTP ${response.status}`)
    }
    return parseAlertCount(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

/* ===================== 告警计数 store（徽标渲染数据源） ===================== */

/**
 * 告警计数共享快照：`count=null` 表示尚无任何成功拉取（徽标不渲染，与
 * 「成功拉取到 0」的零值隐匿同观感但状态可区分——两者都无角标元素）。
 */
export interface AlertCountSnapshot {
  readonly count: number | null
}

type Listener = () => void

function createAlertCountStore() {
  let snapshot: AlertCountSnapshot = { count: null }
  const listeners = new Set<Listener>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: (): AlertCountSnapshot => snapshot,
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** 写入最新计数；无变化零通知（重注册驱动以真变更为准）。 */
    setCount(count: number): void {
      if (snapshot.count === count) return
      snapshot = { count }
      emit()
    },
    /** 测试隔离用：恢复初始快照（不动订阅者）。 */
    reset(): void {
      snapshot = { count: null }
      emit()
    },
  }
}

/** 告警计数 store 类型（测试注入面，同 store 模式先例）。 */
export type AlertCountStore = ReturnType<typeof createAlertCountStore>

/** 告警计数 store 单例（panels.tsx 徽标组件消费；同步循环驱动）。 */
export const alertCountStore = createAlertCountStore()

export interface AlertCountSyncOptions {
  /** 告警计数拉取（默认实现 fetch `<prefix>api/alerts` 并解析）。 */
  readonly fetchCount: AlertCountFetcher
  /** 轮询周期；缺省 60s（归一口径同 startProjectSync：非法回退缺省、低于 5s 钳到 5s）。 */
  readonly intervalMs?: number
  /** 计时/焦点钩子；缺省真实 setInterval + window focus。 */
  readonly timer?: SyncTimer
  /** 计数落点 store；缺省模块单例 alertCountStore（测试可注入隔离）。 */
  readonly store?: AlertCountStore
}

/**
 * 启动告警计数同步循环：立即拉取一次，随后 60s 周期 + window focus 重拉
 * （同 startProjectSync 节奏与在飞防重入）。拉取失败/超时保留 store 现值
 * （不归零、不伪造、不闪烁，等下一轮/聚焦重试），warn 落日志（失败要吞但
 * 不能不可见）。node 环境（无 window 且未注入 timer 桩）整体跳过，不产
 * 计时器泄漏（bootToNewSession 先例口径；注入 timer 桩的单测不受影响）。
 *
 * @returns 停止函数：清定时器、退订焦点；再次调用安全。
 */
export function startAlertCountSync(options: AlertCountSyncOptions): () => void {
  if (options.timer === undefined && typeof window === 'undefined') return () => {}
  const intervalMs = normalizeIntervalMs(options.intervalMs)
  const timer = options.timer ?? defaultTimer()
  const store = options.store ?? alertCountStore

  let stopped = false
  let inFlight = false

  const pull = async (): Promise<void> => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const count = await options.fetchCount()
      if (!stopped) store.setCount(count)
    } catch (error) {
      // 失败/超时：保留 store 现值（不归零不闪烁），等下一轮/聚焦重试；
      // 失败要吞但不能不可见：warn 出状态便于排障。
      console.warn(
        `[fenix-dsh-dashboard-bridge] 拉取告警计数失败（保留既有计数，等下一轮/聚焦重试）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      inFlight = false
    }
  }

  const handle = timer.setInterval(() => {
    void pull()
  }, intervalMs)
  const unfocus = timer.onFocus(() => {
    void pull()
  })
  void pull()

  return () => {
    stopped = true
    timer.clear(handle)
    unfocus()
  }
}
