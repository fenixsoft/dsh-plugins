/**
 * host/analyzer 分析器测试（stub LLM）：命中排序、Markdown 围栏容错解析、
 * 服务缺失/超时/调用失败/解析失败四类降级（warn 分类日志）、空候选零调用、
 * topN 截断、机械回退归一化置信度。
 */
import { describe, expect, it } from 'vitest'
import { buildUserPrompt, parseLlmRanking, rankCandidates } from '../src/host/analyzer.js'
import type { AnalyzerLog } from '../src/host/analyzer.js'
import type { DshAgentDefaultModel, DshLlmRuntime } from '../src/types/dsh-runtime.js'
import type { PrefilteredSession } from '../src/host/collector.js'

/** 记账 log。 */
function makeLog(): AnalyzerLog & { warns: string[]; debugs: string[] } {
  const warns: string[] = []
  const debugs: string[] = []
  return { warns, debugs, warn: (m) => warns.push(m), debug: (m) => debugs.push(m) }
}

/** 默认路由 stub。 */
const ROUTE: DshAgentDefaultModel = {
  currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
}

/** 文本流 stub LLM（记录收到的 prompt，按脚本回放文本）。 */
function stubLlm(replies: string | ((user: string) => string), calls?: { user: string; provider?: string; model?: string; system?: string }[]): DshLlmRuntime {
  return {
    stream(options) {
      calls?.push({
        user: options.messages[0]?.content[0]?.type === 'text' ? options.messages[0].content[0].text : '',
        provider: options.provider,
        model: options.model,
        system: options.system,
      })
      const text = typeof replies === 'string' ? replies : replies(options.messages[0]?.content[0]?.type === 'text' ? options.messages[0].content[0].text ?? '' : '')
      return (async function* () {
        yield { type: 'text-delta', text }
      })()
    },
  }
}

/** 抛错 stub LLM。 */
function failingLlm(error: Error): DshLlmRuntime {
  return {
    stream() {
      return (async function* () {
        throw error
      })()
    },
  }
}

/** 挂起 stub LLM（永不产出，供超时路径）。 */
function hangingLlm(): DshLlmRuntime {
  return {
    stream(options) {
      return (async function* () {
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return
        yield { type: 'text-delta', text: '' } // eslint-disable-line no-unreachable
      })()
    },
  }
}

/** 候选行构造器。 */
function row(sessionId: string, score: number, activityTime = 100): PrefilteredSession {
  return { sessionId, title: `标题-${sessionId}`, workspacePath: `/w/${sessionId}`, activityTime, score, excerpt: `${sessionId} 的首条消息` }
}

const SIGNAL = new AbortController().signal

describe('rankCandidates 命中排序', () => {
  it('LLM 排名决定顺序，reason/confidence 透传，degraded=false', async () => {
    const calls: { user: string; provider?: string; model?: string; system?: string }[] = []
    const llm = stubLlm(
      JSON.stringify({
        results: [
          { id: 's2', reason: '描述提到调试超时，该会话首条消息完全吻合', confidence: 0.92 },
          { id: 's1', reason: '仅标题弱相关', confidence: 0.3 },
        ],
      }),
      calls,
    )
    const deps = { llm, agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5 }
    const outcome = await rankCandidates(deps, '上周调试登录超时的会话', [row('s1', 2), row('s2', 1)], SIGNAL)
    expect(outcome.degraded).toBe(false)
    expect(outcome.results.map((row) => row.sessionId)).toEqual(['s2', 's1'])
    expect(outcome.results[0]).toMatchObject({ reason: '描述提到调试超时，该会话首条消息完全吻合', confidence: 0.92 })
    expect(outcome.results[0]?.degraded).toBeUndefined()
    // 单调用：prompt 含用户描述与全部候选摘要（id/标题/时间/工作区/节选）。
    expect(calls).toHaveLength(1)
    expect(calls[0]?.user).toContain('上周调试登录超时的会话')
    expect(calls[0]?.user).toContain('"id":"s1"')
    expect(calls[0]?.user).toContain('s1 的首条消息')
    expect(calls[0]?.provider).toBe('deepseek')
    expect(calls[0]?.model).toBe('deepseek-chat')
  })

  it('Markdown 围栏包裹的 JSON 也能解析', async () => {
    const llm = stubLlm('好的，以下是排序：\n```json\n{"results":[{"id":"s1","reason":"命中","confidence":0.5}]}\n```')
    const deps = { llm, agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5 }
    const outcome = await rankCandidates(deps, 'q', [row('s1', 1)], SIGNAL)
    expect(outcome.degraded).toBe(false)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]?.confidence).toBe(0.5)
  })

  it('未知 id / 坏 confidence 行被丢弃；同 id 后续合法行可入榜', async () => {
    const llm = stubLlm(
      JSON.stringify({
        results: [
          { id: 'ghost', reason: '不在候选集', confidence: 1 },
          { id: 's1', reason: 'ok', confidence: 1.5 },
          { id: 's1', reason: 'retried', confidence: 0.4 },
          { id: 's2', reason: 'good', confidence: 0.6 },
        ],
      }),
    )
    const deps = { llm, agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5 }
    const outcome = await rankCandidates(deps, 'q', [row('s1', 1), row('s2', 0)], SIGNAL)
    // ghost 不在候选集、s1(1.5) 越域 → 丢弃；s1(0.4) 与 s2(0.6) 依 LLM 顺序保留。
    expect(outcome.results.map((row) => row.sessionId)).toEqual(['s1', 's2'])
    expect(outcome.results[0]).toMatchObject({ confidence: 0.4, reason: 'retried' })
  })

  it('topN 截断', async () => {
    const llm = stubLlm(
      JSON.stringify({
        results: [
          { id: 's1', reason: 'r', confidence: 0.9 },
          { id: 's2', reason: 'r', confidence: 0.8 },
          { id: 's3', reason: 'r', confidence: 0.7 },
        ],
      }),
    )
    const deps = { llm, agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 2 }
    const outcome = await rankCandidates(deps, 'q', [row('s1', 1), row('s2', 1), row('s3', 1)], SIGNAL)
    expect(outcome.results.map((row) => row.sessionId)).toEqual(['s1', 's2'])
  })
})

describe('rankCandidates 降级矩阵', () => {
  const CANDIDATES = [row('s1', 4, 900), row('s2', 2, 800), row('s3', 0, 700)]

  it('LLM 服务缺失 → 机械回退 + degraded + 分类 warn（llm-missing）', async () => {
    const log = makeLog()
    const outcome = await rankCandidates({ log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('llm-missing')
    expect(log.warns.some((m) => m.includes('LLM 服务缺失'))).toBe(true)
    expect(outcome.results.map((row) => row.sessionId)).toEqual(['s1', 's2', 's3'])
    expect(outcome.results.every((row) => row.degraded === true)).toBe(true)
  })

  it('agentDefaultModel 缺失 → 同 llm-missing', async () => {
    const log = makeLog()
    const llm = stubLlm('{}')
    const outcome = await rankCandidates({ llm, log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degradedReason).toBe('llm-missing')
    expect(outcome.results).toHaveLength(3)
  })

  it('LLM 超时 → 机械回退 + 分类 warn（timeout）', async () => {
    const log = makeLog()
    const outcome = await rankCandidates({ llm: hangingLlm(), agentDefaultModel: ROUTE, log, timeoutMs: 30, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('timeout')
    expect(log.warns.some((m) => m.includes('超时'))).toBe(true)
    expect(outcome.results).toHaveLength(3)
  })

  it('LLM 调用失败 → 机械回退 + 分类 warn（call-failed）', async () => {
    const log = makeLog()
    const outcome = await rankCandidates({ llm: failingLlm(new Error('network down')), agentDefaultModel: ROUTE, log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('call-failed')
    expect(log.warns.some((m) => m.includes('调用失败') && m.includes('network down'))).toBe(true)
  })

  it('解析失败（非 JSON/零有效行）→ 机械回退 + 分类 warn（parse-failed）', async () => {
    const log = makeLog()
    const garbage = stubLlm('我觉得没有匹配的会话。')
    const outcome = await rankCandidates({ llm: garbage, agentDefaultModel: ROUTE, log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('parse-failed')
    expect(log.warns.some((m) => m.includes('解析失败'))).toBe(true)
  })

  it('机械回退置信度 = score/maxScore 归一化，理由含命中摘要', async () => {
    const log = makeLog()
    const outcome = await rankCandidates({ log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.results[0]).toMatchObject({ sessionId: 's1', confidence: 1, degraded: true })
    expect(outcome.results[0]?.reason).toContain('4 分')
    expect(outcome.results[2]).toMatchObject({ sessionId: 's3', confidence: 0 })
    expect(outcome.results[2]?.reason).toContain('最近活跃')
  })

  it('任务取消（外部 signal）→ 中断且不降级不产出', async () => {
    const controller = new AbortController()
    const log = makeLog()
    const promise = rankCandidates({ llm: hangingLlm(), agentDefaultModel: ROUTE, log, timeoutMs: 10_000, topN: 5 }, 'q', CANDIDATES, controller.signal)
    controller.abort()
    const outcome = await promise
    expect(outcome.degraded).toBe(false)
    expect(outcome.results).toEqual([])
  })
})

describe('rankCandidates 空候选', () => {
  it('零候选不触发 LLM 调用，非降级空结果', async () => {
    let called = false
    const llm: DshLlmRuntime = {
      stream() {
        called = true
        return (async function* () {})()
      },
    }
    const log = makeLog()
    const outcome = await rankCandidates({ llm, agentDefaultModel: ROUTE, log, timeoutMs: 1000, topN: 5 }, 'q', [], SIGNAL)
    expect(called).toBe(false)
    expect(outcome).toEqual({ results: [], degraded: false })
  })
})

describe('parseLlmRanking 纯函数', () => {
  it('整体 JSON 直接解析', () => {
    const rows = parseLlmRanking('{"results":[{"id":"a","reason":"r","confidence":0.5}]}', new Set(['a']))
    expect(rows).toEqual([{ id: 'a', reason: 'r', confidence: 0.5 }])
  })

  it('前后缀噪声截取首个 JSON 对象', () => {
    const raw = '前缀 {"results":[{"id":"a","reason":"r","confidence":0.5}]} 后缀'
    expect(parseLlmRanking(raw, new Set(['a']))).toHaveLength(1)
  })

  it('results 非数组/整体非对象 → 空行', () => {
    expect(parseLlmRanking('{"results":"nope"}', new Set(['a']))).toEqual([])
    expect(parseLlmRanking('[]', new Set(['a']))).toEqual([])
    expect(parseLlmRanking('', new Set(['a']))).toEqual([])
  })
})

describe('buildUserPrompt', () => {
  it('包含描述与逐候选 JSONL 摘要（无标题/未归组占位）', () => {
    const prompt = buildUserPrompt('找登录会话', [
      { sessionId: 's1', title: '', workspacePath: '', activityTime: 0, score: 1, excerpt: '正文' },
    ])
    expect(prompt).toContain('找登录会话')
    expect(prompt).toContain('"title":"（无标题）"')
    expect(prompt).toContain('"workspace":"（未归组）"')
    expect(prompt).toContain('"excerpt":"正文"')
  })
})
