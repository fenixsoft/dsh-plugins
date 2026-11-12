/**
 * client 半高级搜索弹窗（tasks 4.2，design D8）。
 *
 * - 构形：自绘轻量 overlay + 面板（dsh-client-ui-primitives 无 Dialog 原语，
 *   侦察结论）；Tooltip 原语复用于关闭按钮（观感一致，dashboard-bridge 先例
 *   同款基元）。全部样式内联（无外部 CSS 通道）。
 * - 交互契约（SPEC 枚举面）：描述输入（空/空白禁提交）、可选开始/结束日期、
 *   关闭按钮与 Esc、关闭重开状态重置、提交后 1s 轮询进度（阶段文案）、结果
 *   列表（标题/工作区/时间/理由/置信度）、degraded 标注、空态文案、候选点击
 *   回调（跳转与关弹窗由装配层串联）。
 * - 「同一 client 单在途」：重复提交前 DELETE 旧任务（tasks 4.4 语义在弹窗内
 *   实现，装配层只串组件）；关闭弹窗同样 DELETE 在途任务（弹窗内等待语义）。
 * - 网络：fetch 注入面（测试 stub；缺省全局 fetch）。宿主 enabled=false 或
 *   未装载时 POST 404 → 显式错误文案（client 无法感知 host 配置开关）。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { API_PREFIX, JOBS_PATH, UI_TEXT } from '../shared/protocol.js'
import type { SearchJobStatus, SearchRequest, SearchTimeRange } from '../shared/protocol.js'
import { parseJobStatus } from '../shared/protocol.js'

/** fetch 最小被消费面（注入 stub；缺省 globalThis.fetch）。 */
export interface FetchFace {
  (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    readonly ok: boolean
    readonly status: number
    json(): Promise<unknown>
  }>
}

export interface SearchDialogProps {
  /** 弹窗开合（false→true 之间状态重置由组件自管）。 */
  readonly open: boolean
  /** 关闭回调（关闭按钮 / Esc / 候选跳转后的装配层串联）。 */
  readonly onClose: () => void
  /** 候选点击回调（装配层接 jump + onClose）。 */
  readonly onOpenSession: (sessionId: string) => void
  /** fetch 注入面（测试 stub）。 */
  readonly fetchImpl?: FetchFace
  /** 轮询间隔毫秒（缺省 1000，design/spec 钉死值；测试可调）。 */
  readonly pollIntervalMs?: number
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10_000,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  background: 'rgba(0,0,0,.4)',
  padding: '10vh 16px 16px',
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: 560,
  maxWidth: '100%',
  maxHeight: '75vh',
  overflow: 'auto',
  background: 'var(--dsh-bg, #fff)',
  color: 'inherit',
  borderRadius: 12,
  padding: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,.25)',
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

const resultListStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' }

const resultItemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: '1px solid rgba(128,128,128,.3)',
  borderRadius: 8,
  padding: '8px 10px',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

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

/** 高级搜索弹窗。 */
export function SearchDialog(props: SearchDialogProps): ReactElement | null {
  const fetchImpl = props.fetchImpl ?? defaultFetch
  const pollMs = props.pollIntervalMs ?? 1000
  const [query, setQuery] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [status, setStatus] = useState<SearchJobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  /** 在途任务 id（提交成功后登记；重复提交/关闭时 DELETE）。 */
  const jobIdRef = useRef<string | null>(null)

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
  }, [props.open])

  // Esc 关闭（仅开窗期间监听）。
  useEffect(() => {
    if (!props.open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.open, props.onClose])

  // 1s 轮询（jobId 就绪后启动；终态/异常停轮）。
  useEffect(() => {
    if (jobId === null) return
    let stopped = false
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
          if (parsed.phase === 'done' || parsed.phase === 'error' || parsed.phase === 'cancelled') {
            stop()
            setBusy(false)
            setJobId(null)
            jobIdRef.current = null
          }
        } catch {
          if (stopped) return
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
    const request: SearchRequest = range.range === undefined ? { query: query.trim() } : { query: query.trim(), timeRange: range.range }
    setBusy(true)
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

  if (!props.open) return null

  const phaseHint = status !== null && busy ? UI_TEXT.phaseText[status.phase] : undefined
  const results = status?.phase === 'done' ? (status.results ?? []) : []

  return (
    <div role="presentation" style={overlayStyle}>
      <div role="dialog" aria-label={UI_TEXT.dialogTitle} style={panelStyle}>
        <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
          <strong>{UI_TEXT.dialogTitle}</strong>
          <Tooltip label="关闭" side="bottom">
            <button type="button" aria-label="关闭" onClick={props.onClose} style={iconButtonStyle}>
              ×
            </button>
          </Tooltip>
        </div>

        <textarea
          value={query}
          placeholder={UI_TEXT.queryPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
          rows={3}
          style={{ resize: 'vertical', padding: 8, borderRadius: 8, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit' }}
        />

        <div style={rowStyle}>
          <label>
            开始日期{' '}
            <input type="date" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
          </label>
          <label>
            结束日期{' '}
            <input type="date" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
          </label>
        </div>
        {!range.valid ? <div role="alert">时间范围无效：结束日期不能早于开始日期</div> : null}

        <div style={rowStyle}>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} style={{ padding: '6px 14px', borderRadius: 8, cursor: canSubmit ? 'pointer' : 'default' }}>
            {UI_TEXT.submit}
          </button>
          {busy ? <span role="status">{phaseHint ?? '正在提交…'}</span> : null}
        </div>

        {error !== null ? <div role="alert">{error}</div> : null}
        {status?.phase === 'error' ? <div role="alert">{UI_TEXT.failed}：{status.message ?? ''}</div> : null}
        {status?.phase === 'cancelled' ? <div role="status">{UI_TEXT.cancelled}</div> : null}
        {status?.phase === 'done' && status.degraded === true ? <div role="status">{UI_TEXT.degradedBadge}</div> : null}

        {status?.phase === 'done' && results.length === 0 ? <div role="status">{UI_TEXT.empty}</div> : null}
        {results.length > 0 ? (
          <ul style={resultListStyle}>
            {results.map((row) => (
              <li key={row.sessionId}>
                <button type="button" style={resultItemStyle} onClick={() => props.onOpenSession(row.sessionId)}>
                  <div style={{ fontWeight: 600 }}>{row.title === '' ? '（无标题）' : row.title}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    {row.workspacePath === '' ? '（未归组）' : row.workspacePath} · {formatActivityTime(row.activityTime)} · 置信度 {Math.round(row.confidence * 100)}%
                  </div>
                  <div style={{ fontSize: 12 }}>{row.reason}</div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

const iconButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontSize: 18,
  cursor: 'pointer',
  lineHeight: 1,
}
