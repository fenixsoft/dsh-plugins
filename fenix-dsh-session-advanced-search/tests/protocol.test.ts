/**
 * shared/protocol 协议守卫测试：请求载荷校验（空 query 拒绝、时间范围合法性）、
 * 阶段/候选/轮询响应守卫、API 路径常量。
 */
import { describe, expect, it } from 'vitest'
import {
  API_PREFIX,
  isSearchCandidate,
  isSearchPhase,
  isValidTimeRange,
  JOBS_PATH,
  parseJobStatus,
  parseSearchRequest,
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
})

describe('UI_TEXT', () => {
  it('进度文案覆盖 collecting/filtering/analyzing 三阶段', () => {
    expect(UI_TEXT.phaseText.collecting).toBe('正在收集会话…')
    expect(UI_TEXT.phaseText.filtering).toBe('正在预筛候选…')
    expect(UI_TEXT.phaseText.analyzing).toBe('agent 分析中…')
    expect(UI_TEXT.buttonTitle).toBe('高级搜索')
    expect(UI_TEXT.degradedBadge).toBe('LLM 分析不可用，已按机械匹配排序')
    expect(UI_TEXT.empty).toBe('未找到匹配的会话')
  })
})
