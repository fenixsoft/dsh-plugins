/**
 * shared/protocol 协议守卫测试：请求载荷校验（空 query 拒绝、时间范围合法性）、
 * 阶段/候选/轮询响应守卫、API 路径常量。
 */
import { describe, expect, it } from 'vitest'
import {
  API_PREFIX,
  isSearchCandidate,
  isSearchDegradedReason,
  isSearchPhase,
  isSearchProgressStep,
  isValidTimeRange,
  JOBS_PATH,
  parseJobStatus,
  parseSearchRequest,
  PROGRESS_MAX_STEPS,
  SEARCH_DEGRADED_REASONS,
  SEARCH_PHASES,
  UI_TEXT,
} from '../src/shared/protocol.js'

describe('API 路径常量', () => {
  it('三端点都落在插件命名空间前缀下', () => {
    expect(API_PREFIX).toBe('/api/session-advanced-search')
    expect(JOBS_PATH).toBe('/api/session-advanced-search/jobs')
  })
})

describe('parseSearchRequest', () => {
  it('接受合法请求并 trim query', () => {
    expect(parseSearchRequest({ query: '  修登录功能的会话  ' })).toEqual({ query: '修登录功能的会话' })
  })

  it('接受带合法时间范围的请求', () => {
    const request = { query: 'q', timeRange: { start: 1_000, end: 2_000 } }
    expect(parseSearchRequest(request)).toEqual(request)
  })

  it('拒绝空 query / 纯空白 query', () => {
    expect(parseSearchRequest({ query: '' })).toBeUndefined()
    expect(parseSearchRequest({ query: '   ' })).toBeUndefined()
  })

  it('拒绝缺失 query 或非字符串 query', () => {
    expect(parseSearchRequest({})).toBeUndefined()
    expect(parseSearchRequest({ query: 42 })).toBeUndefined()
    expect(parseSearchRequest(null)).toBeUndefined()
    expect(parseSearchRequest('q')).toBeUndefined()
    expect(parseSearchRequest(undefined)).toBeUndefined()
  })

  it('拒绝非法时间范围（非数/逆序/负值/NaN）', () => {
    expect(parseSearchRequest({ query: 'q', timeRange: { start: 'a', end: 2 } })).toBeUndefined()
    expect(parseSearchRequest({ query: 'q', timeRange: { start: 2, end: 1 } })).toBeUndefined()
    expect(parseSearchRequest({ query: 'q', timeRange: { start: -1, end: 2 } })).toBeUndefined()
    expect(parseSearchRequest({ query: 'q', timeRange: { start: Number.NaN, end: 2 } })).toBeUndefined()
    expect(parseSearchRequest({ query: 'q', timeRange: null })).toBeUndefined()
    expect(parseSearchRequest({ query: 'q', timeRange: {} })).toBeUndefined()
  })
})

describe('isValidTimeRange', () => {
  it('start === end 不合法（空区间）', () => {
    expect(isValidTimeRange({ start: 5, end: 5 })).toBe(false)
    expect(isValidTimeRange({ start: 5, end: 6 })).toBe(true)
  })
})

describe('isSearchPhase', () => {
  it('全部枚举值可判真', () => {
    for (const phase of SEARCH_PHASES) expect(isSearchPhase(phase)).toBe(true)
  })

  it('未知值判假', () => {
    expect(isSearchPhase('running')).toBe(false)
    expect(isSearchPhase(undefined)).toBe(false)
    expect(isSearchPhase(42)).toBe(false)
  })
})

describe('isSearchCandidate', () => {
  const base = {
    sessionId: 's1',
    title: 't',
    workspacePath: '/root/fenixd',
    activityTime: 1,
    reason: 'r',
    confidence: 0.9,
  }

  it('接受完整候选行与可选 degraded', () => {
    expect(isSearchCandidate(base)).toBe(true)
    expect(isSearchCandidate({ ...base, degraded: true })).toBe(true)
  })

  it('拒绝缺字段/坏类型/越域 confidence', () => {
    expect(isSearchCandidate({ ...base, sessionId: '' })).toBe(false)
    expect(isSearchCandidate({ ...base, confidence: 1.5 })).toBe(false)
    expect(isSearchCandidate({ ...base, confidence: -0.1 })).toBe(false)
    expect(isSearchCandidate({ ...base, activityTime: Number.NaN })).toBe(false)
    expect(isSearchCandidate({ ...base, degraded: 'yes' })).toBe(false)
    expect(isSearchCandidate(null)).toBe(false)
  })
})

describe('isSearchDegradedReason', () => {
  it('全部枚举值可判真', () => {
    for (const reason of SEARCH_DEGRADED_REASONS) expect(isSearchDegradedReason(reason)).toBe(true)
  })

  it('未知值判假', () => {
    expect(isSearchDegradedReason('unknown')).toBe(false)
    expect(isSearchDegradedReason(undefined)).toBe(false)
    expect(isSearchDegradedReason(42)).toBe(false)
  })
})

describe('isSearchProgressStep', () => {
  it('接受合法步骤（含可选 detail）', () => {
    expect(isSearchProgressStep({ step: 'collecting', at: 1_000 })).toBe(true)
    expect(isSearchProgressStep({ step: 'filtering', detail: '候选 128→24', at: 2_000 })).toBe(true)
  })

  it('拒绝空 step / 坏类型 / 非有限 at', () => {
    expect(isSearchProgressStep({ step: '', at: 1 })).toBe(false)
    expect(isSearchProgressStep({ step: 's', detail: 3, at: 1 })).toBe(false)
    expect(isSearchProgressStep({ step: 's', at: Number.NaN })).toBe(false)
    expect(isSearchProgressStep({ step: 's' })).toBe(false)
    expect(isSearchProgressStep(null)).toBe(false)
    expect(isSearchProgressStep('collecting')).toBe(false)
  })
})

describe('PROGRESS_MAX_STEPS', () => {
  it('有界保留条数为 50（host 写入面上限）', () => {
    expect(PROGRESS_MAX_STEPS).toBe(50)
  })
})

describe('parseJobStatus', () => {
  it('接受合法轮询载荷（含 results 与 message）', () => {
    const status = {
      jobId: 'job-1',
      phase: 'done',
      results: [
        {
          sessionId: 's1',
          title: 't',
          workspacePath: '/w',
          activityTime: 1,
          reason: 'r',
          confidence: 0.8,
          degraded: true,
        },
      ],
      degraded: true,
      message: 'ok',
    }
    expect(parseJobStatus(status)).toEqual(status)
  })

  it('拒绝未知 jobId / 未知 phase / 非 results 数组', () => {
    expect(parseJobStatus({ jobId: '', phase: 'done' })).toBeUndefined()
    expect(parseJobStatus({ jobId: 'j', phase: 'running' })).toBeUndefined()
    expect(parseJobStatus({ jobId: 'j', phase: 'done', results: 'nope' })).toBeUndefined()
    expect(parseJobStatus({ jobId: 'j', phase: 'done', results: [{ sessionId: '' }] })).toBeUndefined()
    expect(parseJobStatus({ phase: 'done' })).toBeUndefined()
    expect(parseJobStatus(undefined)).toBeUndefined()
  })

  it('message 非字符串判假', () => {
    expect(parseJobStatus({ jobId: 'j', phase: 'error', message: 3 })).toBeUndefined()
  })

  it('接受带 degradedReason 与 progress 的新载荷', () => {
    const status = {
      jobId: 'job-2',
      phase: 'analyzing',
      degradedReason: 'credential-missing',
      progress: [
        { step: 'collecting', detail: '修复 / fenix', at: 1_000 },
        { step: 'filtering', detail: '候选 128→24', at: 2_000 },
      ],
    }
    expect(parseJobStatus(status)).toEqual(status)
  })

  it('degradedReason 白名单外 / progress 形状坏判假', () => {
    expect(parseJobStatus({ jobId: 'j', phase: 'done', degradedReason: 'aliens' })).toBeUndefined()
    expect(parseJobStatus({ jobId: 'j', phase: 'analyzing', progress: 'nope' })).toBeUndefined()
    expect(parseJobStatus({ jobId: 'j', phase: 'analyzing', progress: [{ step: '', at: 1 }] })).toBeUndefined()
    expect(parseJobStatus({ jobId: 'j', phase: 'analyzing', progress: [{ step: 's', at: 'x' }] })).toBeUndefined()
  })
})

describe('UI_TEXT', () => {
  it('进度文案覆盖 collecting/filtering/analyzing 三阶段', () => {
    expect(UI_TEXT.phaseText.collecting).toBe('正在收集会话…')
    expect(UI_TEXT.phaseText.filtering).toBe('正在预筛候选…')
    expect(UI_TEXT.phaseText.analyzing).toBe('调用 AI 语义分析…')
    expect(UI_TEXT.buttonTitle).toBe('高级搜索')
    expect(UI_TEXT.degradedBadge).toBe('LLM 分析不可用，已按机械匹配排序')
    expect(UI_TEXT.empty).toBe('未找到匹配的会话')
  })

  it('降级原因文案映射覆盖全部枚举；凭证缺失含两动作文案', () => {
    for (const reason of SEARCH_DEGRADED_REASONS) {
      expect(UI_TEXT.degradedReasonText[reason].length).toBeGreaterThan(0)
    }
    expect(UI_TEXT.degradedReasonText['credential-missing']).toContain('缺少凭证')
    expect(UI_TEXT.actionGoCredential).toBe('前往模型设置配置凭证')
    expect(UI_TEXT.actionRetryAiOnly).toBe('仅重试 AI 分析')
    expect(UI_TEXT.credentialHint).toContain('设置 → 模型')
  })
})
