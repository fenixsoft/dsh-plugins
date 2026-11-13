/**
 * client 半高级搜索内容区视图（optimize 轮 tasks 3.1/3.2，design D6；界面以
 * specs/optimize-session-advanced-search/prototype/ 为准）。
 *
 * - 构形：**非模态内容区视图**（header + 滚动 body + 底部 composer 卡），
 *   替代旧模态弹窗（searchDialog.tsx 已删）——挂载位置由装配层决定（内容区
 *   锚点成功 = 占满内容区；失配降级右侧抽屉 + warn 限流一次），本组件只渲染
 *   面板自身（height 100% 自适应容器）。无遮罩、侧栏保持可交互。
 * - 步骤流（design D5）：按 canonical [collecting, filtering, analyzing, done]
 *   渲染 Agent 对话风格三态（完成✓ / 进行中 spinner / 等待○），文案与 detail
 *   取自轮询载荷 progress[]（host 报什么显示什么，**不伪造流式中间进度**）；
 *   status-pill 本地计时逐 0.1s 刷新「分析中 · X.Xs」。
 * - 中断：面板头「中断」按钮 = DELETE 在途任务 + 停轮 + 回初始态。
 * - 降级横幅：degradedReason 精确映射 UI_TEXT.degradedReasonText；缺项回退
 *   degradedBadge。credential-missing 附两动作：「前往模型设置配置凭证」
 *   （onOpenModelSettings 缝不可用时点击展示 credentialHint 提示文案）与
 *   「仅重试 AI 分析」（同 query 重新 POST）。
 * - composer：对齐 DSH 会话 composer 卡（居中 max 952px、radius 28px、32px
 *   圆形发送按钮、官方图标几何 15×15）；单行描述 + Enter 提交 + 可选起止日期。
 * - 交互契约保留：空/空白描述禁提交、Esc/X 关闭、关闭重开状态重置、关闭与
 *   重复提交均 DELETE 在途任务（「同一 client 单在途」）、网络失败连续 3 次
 *   停轮报错、POST 404 显式服务未启用文案。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { API_PREFIX, JOBS_PATH, UI_TEXT } from '../shared/protocol.js'
import type { SearchJobStatus, SearchPhase, SearchProgressStep, SearchRequest, SearchTimeRange } from '../shared/protocol.js'
import { parseJobStatus } from '../shared/protocol.js'

/** fetch 最小被消费面（注入 stub；缺省 globalThis.fetch）。 */
export interface FetchFace {
  (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    readonly ok: boolean
    readonly status: number
    json(): Promise<unknown>
  }>
}

export interface SearchViewProps {
  /** 视图开合（false→true 之间状态重置由组件自管）。 */
  readonly open: boolean
  /** 关闭回调（关闭按钮 / Esc / 候选跳转后的装配层串联）。 */
  readonly onClose: () => void
  /** 候选点击回调（装配层接 jump + onClose；title 供侧栏兜底匹配）。 */
  readonly onOpenSession: (sessionId: string, title: string) => void
  /** fetch 注入面（测试 stub）。 */
  readonly fetchImpl?: FetchFace
  /** 轮询间隔毫秒（缺省 1000；测试可调）。 */
  readonly pollIntervalMs?: number
  /** 设置导航缝（可选）：「前往模型设置」按钮回调；缺省点击展示 credentialHint 提示文案。 */
  readonly onOpenModelSettings?: () => void
}

/* ---------- 官方图标几何（specs/.../prototype ICONS 原样；design D6） ---------- */

/** IconSearchOutlineMedium（viewBox 0 0 16 16、stroke currentColor 1.3）。 */
const ICON_SEARCH = [
  '<svg width="SIZE" height="SIZE" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">',
  '<path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"/>',
  '<path d="M10.2991 10.3933L14.7783 14.8725"/>',
  '</svg>',
].join('')

/** IconCloseOutline（两对角线）。 */
const ICON_CLOSE = [
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">',
  '<path d="M2.5 2.5L13.5 13.5"/>',
  '<path d="M13.5 2.5L2.5 13.5"/>',
  '</svg>',
].join('')

/** 发送按钮箭头（原型原样几何）。 */
const ICON_SEND = [
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">',
  '<path d="M6.97211 1.94476C7.55785 1.35914 8.50767 1.35919 9.09343 1.94476L13.921 6.77228L13.2138 7.47939L8.38632 2.65187C8.19108 2.45682 7.87443 2.45677 7.67922 2.65187L2.74397 7.58711L2.03687 6.88L6.97211 1.94476Z"/>',
  '<path d="M7.97571 14.5732L8.02421 2.34139"/>',
  '</svg>',
].join('')

/** 步骤图标（完成✓/进行中 spinner/等待○/失败×）。 */
const ICON_STEP = {
  ok: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 8.5L6.5 12L13 4.5"/></svg>',
  run: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 1.5A6.5 6.5 0 1 1 1.5 8" class="fenix-sas-spin"/></svg>',
  wait: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/></svg>',
  fail: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5L11.5 11.5"/><path d="M11.5 4.5L4.5 11.5"/></svg>',
} as const

/** 警示图标（降级横幅）。 */
const ICON_WARN =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M8 1.5L15 14H1L8 1.5Z"/><path d="M8 6V9.5"/><path d="M8 11.6V11.7"/></svg>'

/* ---------- 样式（官方令牌优先 + 字面回退；无外部 CSS 通道，动画经内嵌 style） ---------- */

const BRAND = 'var(--ds-500, #4d6bfe)'
const BRAND_SOFT = 'var(--ds-50, rgba(77,107,254,.08))'
const AMBER_FG = 'var(--amber-fg, #92610a)'
const AMBER_BG = 'var(--amber-bg, rgba(245,158,11,.1))'
const GREEN_FG = 'var(--green-fg, #067647)'
const RED_FG = 'var(--red-fg, #d92d20)'
const DIVIDER = 'var(--dsw-alias-color-border, rgba(128,128,128,.3))'
const MUTED = 'var(--dsw-alias-color-text-tertiary, rgba(128,128,128,.85))'

const viewStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  background: 'var(--dsw-alias-color-bg-secondary, var(--dsh-bg, #f7f7f8))',
  color: 'inherit',
  fontFamily: 'inherit',
  textAlign: 'left',
}

const headerStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 20px',
  background: 'var(--dsh-bg, #fff)',
  borderBottom: `1px solid ${DIVIDER}`,
}

const bodyStyle: CSSProperties = { flex: '1 1 0%', minHeight: 0, overflowY: 'auto', padding: '14px 20px 24px' }

const composerStyle: CSSProperties = { flex: 'none', padding: '10px 20px 14px' }

const composerCardStyle: CSSProperties = {
  width: 'min(calc(100% - 16px), 952px)',
  margin: '0 auto',
  background: 'var(--dsh-bg, #fff)',
  border: `1px solid ${DIVIDER}`,
  borderRadius: 28,
  padding: '8px 10px 8px 16px',
  boxShadow: '0 1px 3px rgba(15,17,21,.05)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const composerRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

const composerInputStyle: CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  font: 'inherit',
  fontSize: 13,
  color: 'inherit',
  background: 'none',
  minWidth: 0,
}

const sendBtnStyle = (enabled: boolean): CSSProperties => ({
  width: 32,
  height: 32,
  flex: 'none',
  borderRadius: '50%',
  border: 'none',
  background: BRAND,
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: enabled ? 'pointer' : 'default',
  opacity: enabled ? 1 : 0.4,
})

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  padding: '0 8px',
  borderRadius: 999,
  background: 'var(--dsw-alias-color-bg-tertiary, rgba(128,128,128,.12))',
  color: MUTED,
  fontSize: 12,
}

const panelStyle: CSSProperties = {
  background: 'var(--dsh-bg, #fff)',
  border: `1px solid ${DIVIDER}`,
  borderRadius: 12,
  marginBottom: 14,
  overflow: 'hidden',
}

const panelHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderBottom: `1px solid ${DIVIDER}`,
  background: BRAND_SOFT,
}

const pillStyle = (kind: 'run' | 'done' | 'fail'): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 22,
  padding: '0 9px',
  borderRadius: 999,
  fontSize: 12,
  background: kind === 'run' ? BRAND_SOFT : kind === 'done' ? 'rgba(6,118,71,.1)' : AMBER_BG,
  color: kind === 'run' ? BRAND : kind === 'done' ? GREEN_FG : AMBER_FG,
})

const ghostBtnStyle = (danger: boolean): CSSProperties => ({
  height: 24,
  padding: '0 9px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  fontSize: 12,
  color: danger ? RED_FG : 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  cursor: 'pointer',
})

const stepRowStyle: CSSProperties = { display: 'flex', gap: 10, padding: '7px 14px', alignItems: 'flex-start' }

const bannerStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  background: AMBER_BG,
  border: '1px solid rgba(245,158,11,.4)',
  borderRadius: 8,
  padding: '10px 12px',
  marginBottom: 14,
}

const amberBtnStyle: CSSProperties = {
  height: 26,
  padding: '0 10px',
  borderRadius: 6,
  fontSize: 12,
  background: 'var(--dsh-bg, #fff)',
  border: '1px solid rgba(245,158,11,.4)',
  color: AMBER_FG,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  cursor: 'pointer',
}

const resultListStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' }

const resultCardStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'var(--dsh-bg, #fff)',
  border: `1px solid ${DIVIDER}`,
  borderRadius: 8,
  padding: '12px 14px',
  color: 'inherit',
  cursor: 'pointer',
}

/** 步骤流 canonical 顺序（host 推进点全集；渲染骨架 + 实报步骤三态）。 */
const CANONICAL_STEPS: readonly SearchPhase[] = ['collecting', 'filtering', 'analyzing', 'done']

/** 步骤三态类（文案/图标着色）。 */
type StepState = 'ok' | 'run' | 'wait' | 'fail'

/** POST 建任务响应守卫（{jobId:string}）。 */
function parseJobCreated(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const jobId = (value as Record<string, unknown>).jobId
  return typeof jobId === 'string' && jobId.length > 0 ? jobId : undefined
}

/**
 * 日期输入（YYYY-MM-DD）→ 活动时间闭开区间。
 * 只填开始：end 取 MAX_SAFE_INTEGER（开右端无上界）；只填结束：start=0；
 * 都填：[开始日 00:00, 结束日次日 00:00)（本地时区）；解析失败或 start≥end
 * 返回 valid:false（提交禁用）。无日期：valid:true 且不带 range。
 */
export function buildTimeRange(startAt: string, endAt: string): { valid: boolean; range?: SearchTimeRange } {
  const start = dayBoundaryMs(startAt, false)
  const end = dayBoundaryMs(endAt, true)
  if (startAt !== '' && Number.isNaN(start)) return { valid: false }
  if (endAt !== '' && Number.isNaN(end)) return { valid: false }
  if (startAt === '' && endAt === '') return { valid: true }
  const range: SearchTimeRange = {
    start: startAt === '' ? 0 : start,
    end: endAt === '' ? Number.MAX_SAFE_INTEGER : end,
  }
  return range.start < range.end ? { valid: true, range } : { valid: false }
}

/** 日界毫秒（本地时区）；endOfDay=true 取次日零点（开区间端点）。 */
function dayBoundaryMs(value: string, endOfDay: boolean): number {
  const parts = value.split('-')
  if (parts.length !== 3) return NaN
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) return NaN
  if (month < 1 || month > 12 || day < 1 || day > 31) return NaN
  return endOfDay ? new Date(year, month - 1, day + 1).getTime() : new Date(year, month - 1, day).getTime()
}

/** 活动时间展示（本地时区 YYYY-MM-DD HH:mm）。 */
export function formatActivityTime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 默认 fetch（globalThis；形态由调用方兜底，测试注入 stub 时不触达）。 */
const defaultFetch: FetchFace = (input, init) => globalThis.fetch(input, init as RequestInit | undefined)

/** 步骤实报条目（canonical 步骤 → 最近一条 progress 记录）。 */
function reportedStep(progress: readonly SearchProgressStep[] | undefined, step: SearchPhase): SearchProgressStep | undefined {
  const list = progress ?? []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.step === step) return list[i]
  }
  return undefined
}

/** 高级搜索内容区视图。 */
export function SearchView(props: SearchViewProps): ReactElement | null {
  const fetchImpl = props.fetchImpl ?? defaultFetch
  const pollMs = props.pollIntervalMs ?? 1000
  const [query, setQuery] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [status, setStatus] = useState<SearchJobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  /** 本地计时秒（status-pill「分析中 · X.Xs」；busy 期间 0.1s 步进）。 */
  const [elapsed, setElapsed] = useState(0)
  /** 在途任务 id（提交成功后登记；重复提交/关闭/中断时 DELETE）。 */
  const jobIdRef = useRef<string | null>(null)
  /** 计时起点（busy 置位时刻）。 */
  const startedAtRef = useRef(0)

  // 关闭（含 Esc/候选跳转触发的 onClose）：重置全部状态 + DELETE 在途任务。
  useEffect(() => {
    if (props.open) return
    cancelInFlight()
    setQuery('')
    setStartAt('')
    setEndAt('')
    setStatus(null)
    setError(null)
    setBusy(false)
    setJobId(null)
    setHint(null)
    setElapsed(0)
  }, [props.open])

  // Esc 关闭（仅开窗期间监听；视图非模态，不拦截焦点）。
  useEffect(() => {
    if (!props.open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.open, props.onClose])

  // 本地计时（busy 期间 0.1s 步进；原型 status-pill「分析中 · X.Xs」同频）。
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000)
    }, 100)
    return () => clearInterval(timer)
  }, [busy])

  // 轮询（jobId 就绪后启动；终态/异常停轮）。网络失败连续 ≤2 次容忍，连续 3 次停轮报错。
  useEffect(() => {
    if (jobId === null) return
    let stopped = false
    let consecutiveFailures = 0
    const stop = (): void => {
      stopped = true
    }
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetchImpl(`${JOBS_PATH}/${jobId}`, { method: 'GET' })
          if (stopped) return
          if (res.status === 404) {
            stop()
            setBusy(false)
            setJobId(null)
            jobIdRef.current = null
            setError('任务已丢失（宿主可能已重启），请重新搜索')
            return
          }
          if (!res.ok) {
            stop()
            setBusy(false)
            setJobId(null)
            setError(`轮询失败（HTTP ${res.status}）`)
            return
          }
          const parsed = parseJobStatus(await res.json())
          if (parsed === undefined) {
            stop()
            setBusy(false)
            setJobId(null)
            setError('任务状态响应异常')
            return
          }
          setStatus(parsed)
          consecutiveFailures = 0
          if (parsed.phase === 'done' || parsed.phase === 'error' || parsed.phase === 'cancelled') {
            stop()
            setBusy(false)
            setJobId(null)
            jobIdRef.current = null
          }
        } catch {
          if (stopped) return
          consecutiveFailures += 1
          if (consecutiveFailures < 3) return // 单次/前两次失败：继续下一轮，不计入停轮
          stop()
          setBusy(false)
          setJobId(null)
          setError('网络异常，轮询中断')
        }
      })()
    }, pollMs)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [jobId, pollMs, fetchImpl])

  const range = buildTimeRange(startAt, endAt)
  // busy 不禁提交：在途期间改描述重新提交 = DELETE 旧任务 + 新建（单在途语义）。
  const canSubmit = query.trim().length > 0 && range.valid
  const terminal = status !== null && (status.phase === 'done' || status.phase === 'error' || status.phase === 'cancelled')
  const showPanel = busy || status !== null
  const results = status?.phase === 'done' ? (status.results ?? []) : []
  const degraded = status?.phase === 'done' && status.degraded === true

  /** DELETE 在途任务（幂等尽力而为；响应不消费）。 */
  function cancelInFlight(): void {
    const current = jobIdRef.current
    if (current === null) return
    jobIdRef.current = null
    void fetchImpl(`${API_PREFIX}/jobs/${current}`, { method: 'DELETE' }).catch(() => {})
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return
    // 单在途语义：提交前取消旧任务（DELETE + 新建）；先置空 jobId 停旧轮询。
    cancelInFlight()
    setJobId(null)
    setError(null)
    setStatus(null)
    setHint(null)
    const request: SearchRequest = range.range === undefined ? { query: query.trim() } : { query: query.trim(), timeRange: range.range }
    setBusy(true)
    startedAtRef.current = Date.now()
    setElapsed(0)
    try {
      const res = await fetchImpl(JOBS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (res.status === 404) {
        setBusy(false)
        setError('高级搜索服务未启用（宿主 enabled=false 或插件未装载）')
        return
      }
      if (!res.ok) {
        setBusy(false)
        setError(`提交失败（HTTP ${res.status}）`)
        return
      }
      const created = parseJobCreated(await res.json())
      if (created === undefined) {
        setBusy(false)
        setError('提交响应异常')
        return
      }
      jobIdRef.current = created
      setJobId(created)
    } catch (cause) {
      setBusy(false)
      setError(`提交失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  /** 中断：DELETE 在途任务 + 停轮 + 回初始态（query 保留，结果/步骤清空）。 */
  function interrupt(): void {
    cancelInFlight()
    setJobId(null)
    setStatus(null)
    setError(null)
    setBusy(false)
    setElapsed(0)
  }

  if (!props.open) return null

  /** 步骤三态推导：error 终态最新实报标失败；其余终态实报即完成；busy 最新实报 → 进行中；否则等待。 */
  function stepState(step: SearchPhase, index: number): StepState {
    const progress = status?.progress
    if (status?.phase === 'error') {
      const latest = [...(progress ?? [])].reverse()[0]
      return latest !== undefined && latest.step === step ? 'fail' : reportedStep(progress, step) !== undefined ? 'ok' : 'wait'
    }
    if (terminal) return reportedStep(progress, step) !== undefined ? 'ok' : 'wait'
    if (!busy) return 'wait'
    if (reportedStep(progress, step) === undefined) return 'wait'
    // 进行中 = 已实报且后续 canonical 步骤均未实报。
    const later = CANONICAL_STEPS.slice(index + 1).some((name) => reportedStep(progress, name) !== undefined)
    return later ? 'ok' : 'run'
  }

  const timeChipLabel = startAt === '' && endAt === '' ? '全部时间' : startAt !== '' && endAt !== '' ? `${startAt} ~ ${endAt}` : startAt !== '' ? `${startAt} 起` : `${endAt} 止`
  const degradedText = status?.degradedReason !== undefined ? (UI_TEXT.degradedReasonText[status.degradedReason] ?? UI_TEXT.degradedBadge) : UI_TEXT.degradedBadge
  const stepNodes = CANONICAL_STEPS.map((step, index) => {
    const state = stepState(step, index)
    const reported = reportedStep(status?.progress, step)
    // done 步骤无 phaseText 键（host 仅在非终态推进时使用），文案本地固定。
    const label = step === 'done' ? '完成' : (UI_TEXT.phaseText[step] ?? step)
    return (
      <div key={step} data-fenix-sas="step" data-step={step} data-state={state} style={{ ...stepRowStyle, color: state === 'run' ? BRAND : state === 'fail' ? AMBER_FG : 'inherit' }}>
        <span style={{ marginTop: 2, color: state === 'ok' ? GREEN_FG : state === 'run' ? BRAND : state === 'fail' ? RED_FG : MUTED, display: 'inline-flex' }}>
          <span
            style={state === 'run' ? { display: 'inline-flex', animation: 'fenixSasSpin 1s linear infinite' } : { display: 'inline-flex' }}
            dangerouslySetInnerHTML={{ __html: state === 'ok' ? ICON_STEP.ok : state === 'run' ? ICON_STEP.run : state === 'fail' ? ICON_STEP.fail : ICON_STEP.wait }}
          />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13 }}>{label}</span>
          {reported?.detail !== undefined ? (
            <span style={{ display: 'block', fontSize: 12, lineHeight: '16px', color: MUTED, marginTop: 1 }}>{reported.detail}</span>
          ) : null}
          {reported?.at !== undefined ? (
            <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 2, fontFamily: 'var(--dsw-font-mono, monospace)' }}>{formatActivityTime(reported.at)}</span>
          ) : null}
        </span>
      </div>
    )
  })

  const pillKind: 'run' | 'done' | 'fail' = busy ? 'run' : status?.phase === 'done' ? (degraded ? 'fail' : 'done') : 'fail'
  const pillText = busy
    ? `分析中 · ${elapsed.toFixed(1)}s`
    : status?.phase === 'done'
      ? degraded
        ? '机械搜索 · 已完成'
        : 'AI 分析完成'
      : status?.phase === 'cancelled'
        ? UI_TEXT.cancelled
        : status?.phase === 'error'
          ? UI_TEXT.failed
          : ''

  return (
    <section data-fenix-sas="view" aria-label={UI_TEXT.dialogTitle} style={viewStyle}>
      <style dangerouslySetInnerHTML={{ __html: buildKeyframesCss() }} />

      {/* header：标题（官方搜索图标）+ 范围 chips + 关闭 X（官方 IconCloseOutline 几何） */}
      <header data-fenix-sas="header" style={headerStyle}>
        <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', color: MUTED }} dangerouslySetInnerHTML={{ __html: ICON_SEARCH.replace(/SIZE/g, '16') }} />
          {UI_TEXT.dialogTitle}
        </div>
        <span data-fenix-sas="scope-workspace" style={chipStyle}>全部工作区</span>
        <span data-fenix-sas="scope-time" style={chipStyle}>{timeChipLabel}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="关闭"
          title="关闭高级搜索"
          onClick={props.onClose}
          style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: ICON_CLOSE }} />
        </button>
      </header>

      {/* body：初始态 / AI 分析面板 + 降级横幅 + 结果列表 */}
      <div data-fenix-sas="body" style={bodyStyle}>
        {error !== null ? (
          <div role="alert" data-fenix-sas="error" style={{ marginBottom: 14, fontSize: 13, color: RED_FG }}>
            {error}
          </div>
        ) : null}

        {!showPanel && results.length === 0 ? (
          <div data-fenix-sas="initial" style={{ padding: '40px 0 0', textAlign: 'center', color: MUTED }}>
            <div style={{ margin: '0 auto 12px', width: 44, height: 44, borderRadius: 8, background: 'var(--dsh-bg, #fff)', border: `1px solid ${DIVIDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED }}>
              <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: ICON_SEARCH.replace(/SIZE/g, '20') }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>用自然语言搜索历史会话</div>
            <div style={{ fontSize: 12 }}>先机械预筛，再由 AI 按语义相关性排序；分析过程实时可见，随时可中断</div>
          </div>
        ) : null}

        {showPanel ? (
          <div data-fenix-sas="ai-panel" style={panelStyle}>
            <div style={panelHeadStyle}>
              <span data-fenix-sas="panel-title" style={{ fontSize: 13, fontWeight: 600 }}>AI 语义分析</span>
              <span data-fenix-sas="status-pill" data-pill={pillKind} style={pillStyle(pillKind)}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                <span data-fenix-sas="pill-text">{pillText}</span>
              </span>
              <span style={{ flex: 1 }} />
              {busy ? (
                <button type="button" data-fenix-sas="interrupt" onClick={interrupt} style={ghostBtnStyle(true)}>
                  {UI_TEXT.actionInterrupt}
                </button>
              ) : null}
            </div>
            <div data-fenix-sas="steps">{stepNodes}</div>
          </div>
        ) : null}

        {degraded && status !== null ? (
          <div role="status" data-fenix-sas="degrade-banner" style={bannerStyle}>
            <span style={{ color: 'var(--amber-dot, #dc6803)', marginTop: 1, display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: ICON_WARN }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: AMBER_FG }}>{degradedText}</div>
              {hint !== null ? <div style={{ fontSize: 12, color: AMBER_FG, opacity: 0.85, marginTop: 2 }}>{hint}</div> : null}
              {status.degradedReason === 'credential-missing' ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    data-fenix-sas="go-credential"
                    onClick={() => {
                      if (props.onOpenModelSettings !== undefined) {
                        props.onOpenModelSettings()
                        return
                      }
                      setHint(UI_TEXT.credentialHint)
                    }}
                    style={amberBtnStyle}
                  >
                    {UI_TEXT.actionGoCredential}
                  </button>
                  <button type="button" data-fenix-sas="retry-ai" onClick={() => void submit()} style={amberBtnStyle}>
                    {UI_TEXT.actionRetryAiOnly}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {status?.phase === 'error' ? <div role="alert">{UI_TEXT.failed}：{status.message ?? ''}</div> : null}
        {status?.phase === 'cancelled' && !busy ? <div role="status">{UI_TEXT.cancelled}</div> : null}
        {status?.phase === 'done' && results.length === 0 ? <div role="status" data-fenix-sas="empty">{UI_TEXT.empty}</div> : null}

        {results.length > 0 && status !== null ? (
          <div data-fenix-sas="results">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 2px 10px' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>搜索结果</span>
              <span style={{ fontSize: 12, color: MUTED }}>{results.length} 个会话</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: MUTED }}>{degraded ? '按机械匹配排序' : '按 AI 相关性排序'}</span>
            </div>
            <ul style={resultListStyle}>
              {results.map((row) => {
                const pct = Math.round(Math.min(1, Math.max(0, row.confidence)) * 100)
                const mech = row.degraded === true
                return (
                  <li key={row.sessionId}>
                    <button type="button" data-fenix-sas="result" onClick={() => props.onOpenSession(row.sessionId, row.title)} style={resultCardStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.title === '' ? '（无标题）' : row.title}
                        </span>
                        <span data-fenix-sas="conf" data-mech={mech ? 'true' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                          <span style={{ width: 64, height: 4, borderRadius: 2, background: 'rgba(128,128,128,.18)', overflow: 'hidden' }}>
                            <span style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 2, background: mech ? 'rgba(128,128,128,.45)' : 'linear-gradient(90deg, var(--ds-400, #6b8afd), var(--ds-500, #4d6bfe))' }} />
                          </span>
                          <span style={{ fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: 11, color: mech ? MUTED : BRAND, width: 30, textAlign: 'right' }}>{pct}%</span>
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 12, color: MUTED, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: 11, background: 'rgba(128,128,128,.1)', borderRadius: 5, padding: '1px 6px' }}>
                          {row.workspacePath === '' ? '（未归组）' : row.workspacePath}
                        </span>
                        <span>{formatActivityTime(row.activityTime)}</span>
                        <span>{mech ? '机械匹配排序' : 'AI 相关性排序'}</span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12 }}>{row.reason}</div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {/* composer：对齐 DSH 会话 composer 卡（居中 max 952px / radius 28px / 32px 圆形发送按钮） */}
      <footer data-fenix-sas="composer" style={composerStyle}>
        <div style={composerCardStyle}>
          <div style={composerRowStyle}>
            <span style={{ color: MUTED, display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: ICON_SEARCH.replace(/SIZE/g, '16') }} />
            <input
              data-fenix-sas="query"
              value={query}
              placeholder={UI_TEXT.queryPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
              style={composerInputStyle}
            />
            <button type="button" data-fenix-sas="submit" title={UI_TEXT.submit} onClick={() => void submit()} disabled={!canSubmit} style={sendBtnStyle(canSubmit)}>
              <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: ICON_SEND }} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: MUTED, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              开始
              <input data-fenix-sas="date-start" type="date" value={startAt} onChange={(event) => setStartAt(event.target.value)} style={{ font: 'inherit', color: 'inherit', background: 'none' }} />
            </label>
            <label style={{ fontSize: 12, color: MUTED, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              结束
              <input data-fenix-sas="date-end" type="date" value={endAt} onChange={(event) => setEndAt(event.target.value)} style={{ font: 'inherit', color: 'inherit', background: 'none' }} />
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: MUTED }}>Enter 搜索</span>
          </div>
          {!range.valid ? <div role="alert" style={{ fontSize: 12, color: RED_FG }}>时间范围无效：结束日期不能早于开始日期</div> : null}
        </div>
      </footer>
    </section>
  )
}

/** 内嵌 keyframes CSS（spinner 旋转；仅首组件渲染一份即可，重复无害）。 */
function buildKeyframesCss(): string {
  return '@keyframes fenixSasSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'
}
