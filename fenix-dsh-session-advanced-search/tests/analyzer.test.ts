/**
 * host/analyzer 分析器测试（stub LLM）：命中排序、Markdown 围栏容错解析、
 * 服务缺失/超时/调用失败/解析失败四类降级（warn 分类日志）、空候选零调用、
 * topN 截断、机械回退归一化置信度。
 */
import { describe, expect, it } from 'vitest'
import { buildUserPrompt, parseLlmRanking, rankCandidates, resolveRoute } from '../src/host/analyzer.js'
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

/** 顽固挂起 stub LLM（2.5 超时硬上限用例）：**忽略 abort 信号**、永不产出永不闭合——超时返回不得依赖底层流闭合。 */
function stubbornLlm(lateRejectAfterMs?: number): DshLlmRuntime {
  return {
    stream() {
      return (async function* () {
        await new Promise<void>((resolve, reject) => {
          if (lateRejectAfterMs === undefined) {
            // 永不结算（连 abort 也不观察）：race 必须由超时侧独立胜出。
            return
          }
          // 迟到 reject：超时胜出后败者流的错误必须被 .catch 吸收，
          // 绝不能外泄为 unhandled rejection（vitest 会令测试失败）。
          setTimeout(() => reject(new Error('late stream failure')), lateRejectAfterMs)
        })
      })()
    },
  }
}

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

  it('未知 id 行被丢弃；同 id 后续合法行可入榜；越域 confidence 归一', async () => {
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
    // ghost 不在候选集 → 丢弃；s1(1.5) 归一夹取 1 → 先入榜；s1 重复行跳过；s2(0.6) 保留。
    expect(outcome.results.map((row) => row.sessionId)).toEqual(['s1', 's2'])
    expect(outcome.results[0]).toMatchObject({ confidence: 1, reason: 'ok' })
    expect(outcome.results[1]).toMatchObject({ confidence: 0.6, reason: 'good' })
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

  it('瞬时调用失败重试一次：第二次成功 → degraded=false（有限重试）', async () => {
    const log = makeLog()
    const calls: { user: string }[] = []
    const valid = JSON.stringify({ results: [{ id: 's1', reason: '命中', confidence: 0.9 }] })
    let n = 0
    const flaky = stubLlm((_user: string) => {
      n += 1
      if (n === 1) throw new Error('transient 429')
      return valid
    }, calls)
    const outcome = await rankCandidates({ llm: flaky, agentDefaultModel: ROUTE, log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(false)
    expect(outcome.results[0]).toMatchObject({ sessionId: 's1' })
    expect(calls).toHaveLength(2)
    expect(log.warns.some((m) => m.includes('重试中'))).toBe(true)
  })

  it('解析失败重试一次仍零行 → parse-failed（重试不无限）', async () => {
    const log = makeLog()
    const calls: { user: string }[] = []
    const garbage = stubLlm(() => '我觉得没有匹配的会话。', calls)
    const outcome = await rankCandidates({ llm: garbage, agentDefaultModel: ROUTE, log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('parse-failed')
    expect(calls).toHaveLength(2)
    expect(log.warns.filter((m) => m.includes('解析失败')).length).toBeGreaterThanOrEqual(2)
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

  it('matchedKeywords 贯通：AI 与降级两路候选均带机械命中词（无命中省略）', async () => {
    const withKw: PrefilteredSession = { ...row('s1', 2), matchedKeywords: ['fenix', '修复'] }
    const withoutKw = row('s2', 1)
    const llm = stubLlm(JSON.stringify({ results: [{ id: 's1', reason: 'r', confidence: 0.9 }] }))
    const ai = await rankCandidates(
      { llm, agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5 },
      'q',
      [withKw, withoutKw],
      SIGNAL,
    )
    expect(ai.results.map((row) => row.sessionId)).toEqual(['s1'])
    expect(ai.results[0]?.matchedKeywords).toEqual(['fenix', '修复'])
    const degraded = await rankCandidates(
      { llm: failingLlm(new Error('x')), agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5 },
      'q',
      [withKw, withoutKw],
      SIGNAL,
    )
    expect(degraded.results.find((row) => row.sessionId === 's1')?.matchedKeywords).toEqual(['fenix', '修复'])
    expect(degraded.results.find((row) => row.sessionId === 's2')?.matchedKeywords).toBeUndefined()
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

describe('rankCandidates 超时硬解耦（optimize 轮 2.5）', () => {
  const CANDIDATES = [row('s1', 4, 900), row('s2', 2, 800)]

  it('stub 忽略 signal 永不 resolve 的流：按时返回 degradedReason=timeout，不依赖底层流闭合', async () => {
    const log = makeLog()
    const started = Date.now()
    const outcome = await rankCandidates({ llm: stubbornLlm(), agentDefaultModel: ROUTE, log, timeoutMs: 50, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    const elapsed = Date.now() - started
    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('timeout')
    expect(outcome.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(outcome.results).toHaveLength(2)
    // 按时返回：远小于「等待底层流闭合」才可能出现的秒级挂起。
    expect(elapsed).toBeLessThan(2000)
    expect(log.warns.some((m) => m.includes('超时') && m.includes('50ms'))).toBe(true)
  })

  it('败者流迟到 reject 被 .catch 吸收，无 unhandled rejection', async () => {
    const log = makeLog()
    const outcome = await rankCandidates({ llm: stubbornLlm(30), agentDefaultModel: ROUTE, log, timeoutMs: 10, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degradedReason).toBe('timeout')
    // 等迟到 reject 发生：若未被吸收，vitest 将以 unhandled rejection 判本测试失败。
    await new Promise((resolve) => setTimeout(resolve, 80))
  })
})

describe('rankCandidates 凭证预检（optimize 轮 2.5）', () => {
  const CANDIDATES = [row('s1', 4), row('s2', 2)]

  it('credentialProbe 返回 false → 不发起调用立即降级 credential-missing，route 可见', async () => {
    let called = false
    const llm: DshLlmRuntime = {
      stream() {
        called = true
        return (async function* () {})()
      },
    }
    const log = makeLog()
    const outcome = await rankCandidates({ llm, agentDefaultModel: ROUTE, credentialProbe: () => false, log, timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(called).toBe(false)
    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('credential-missing')
    expect(outcome.route).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(outcome.results.every((row) => row.degraded === true)).toBe(true)
    expect(log.warns.some((m) => m.includes('凭证缺失') && m.includes('deepseek/deepseek-chat'))).toBe(true)
  })

  it('credentialProbe 返回 true → 放行正常调用（不降级）', async () => {
    const llm = stubLlm(JSON.stringify({ results: [{ id: 's1', reason: 'r', confidence: 0.8 }] }))
    const outcome = await rankCandidates({ llm, agentDefaultModel: ROUTE, credentialProbe: () => true, log: makeLog(), timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(false)
    expect(outcome.results.map((row) => row.sessionId)).toEqual(['s1'])
  })

  it('credentialProbe 缺失（undefined）→ 跳过预检照常发起调用', async () => {
    const llm = stubLlm(JSON.stringify({ results: [{ id: 's2', reason: 'r', confidence: 0.7 }] }))
    const outcome = await rankCandidates({ llm, agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5 }, 'q', CANDIDATES, SIGNAL)
    expect(outcome.degraded).toBe(false)
    expect(outcome.results.map((row) => row.sessionId)).toEqual(['s2'])
  })
})

describe('rankCandidates 路由覆盖（optimize 轮 2.5）', () => {
  it('routeOverride 优先于 agentDefaultModel，调用与 route 均取覆盖路由', async () => {
    const calls: { user: string; provider?: string; model?: string }[] = []
    const llm = stubLlm(JSON.stringify({ results: [{ id: 's1', reason: 'r', confidence: 0.9 }] }), calls)
    const outcome = await rankCandidates(
      { llm, agentDefaultModel: ROUTE, routeOverride: { provider: 'kimi', model: 'moonshot-v1-8k' }, credentialProbe: () => true, log: makeLog(), timeoutMs: 1000, topN: 5 },
      'q',
      [row('s1', 1)],
      SIGNAL,
    )
    expect(outcome.degraded).toBe(false)
    expect(calls[0]?.provider).toBe('kimi')
    expect(calls[0]?.model).toBe('moonshot-v1-8k')
    expect(outcome.route).toEqual({ provider: 'kimi', model: 'moonshot-v1-8k' })
  })

  it('routeOverride 覆盖到凭证缺失路由时，降级 reason=credential-missing 且 route=覆盖路由', async () => {
    const outcome = await rankCandidates(
      { llm: stubLlm('{}'), agentDefaultModel: ROUTE, routeOverride: { provider: 'bare', model: 'm' }, credentialProbe: () => false, log: makeLog(), timeoutMs: 1000, topN: 5 },
      'q',
      [row('s1', 1)],
      SIGNAL,
    )
    expect(outcome.degradedReason).toBe('credential-missing')
    expect(outcome.route).toEqual({ provider: 'bare', model: 'm' })
  })
})

describe('resolveRoute 导出面（optimize 轮 2.5）', () => {
  it('routeOverride 合形 → 直接采用', () => {
    expect(resolveRoute({ log: makeLog(), timeoutMs: 1000, topN: 5, routeOverride: { provider: 'p1', model: 'm1' } })).toEqual({ provider: 'p1', model: 'm1' })
  })

  it('无 override → agentDefaultModel 默认路由', () => {
    expect(resolveRoute({ agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5 })).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('override 形状非法（空 provider）→ 回退默认路由', () => {
    expect(resolveRoute({ agentDefaultModel: ROUTE, log: makeLog(), timeoutMs: 1000, topN: 5, routeOverride: { provider: '  ', model: 'm1' } })).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('currentSelection 抛异常 → undefined', () => {
    const explosive: DshAgentDefaultModel = { currentSelection: () => { throw new Error('boom') } }
    expect(resolveRoute({ agentDefaultModel: explosive, log: makeLog(), timeoutMs: 1000, topN: 5 })).toBeUndefined()
  })

  it('两缝皆缺 → undefined', () => {
    expect(resolveRoute({ log: makeLog(), timeoutMs: 1000, topN: 5 })).toBeUndefined()
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

  it('results 非数组且无备选数组/整体无 JSON → 空行', () => {
    expect(parseLlmRanking('{"results":"nope"}', new Set(['a']))).toEqual([])
    expect(parseLlmRanking('', new Set(['a']))).toEqual([])
    expect(parseLlmRanking('完全不是 JSON', new Set(['a']))).toEqual([])
  })

  it('顶层数组直接作为排名行', () => {
    const rows = parseLlmRanking('[{"id":"a","reason":"r","confidence":0.7},{"id":"ghost"}]', new Set(['a']))
    expect(rows).toEqual([{ id: 'a', reason: 'r', confidence: 0.7 }])
  })

  it('备选键名 results/ranking/items/data/任意数组值', () => {
    const row = '{"id":"a","reason":"r","confidence":0.5}'
    expect(parseLlmRanking(`{"ranking":[${row}]}`, new Set(['a']))).toHaveLength(1)
    expect(parseLlmRanking(`{"items":[${row}]}`, new Set(['a']))).toHaveLength(1)
    expect(parseLlmRanking(`{"data":[${row}]}`, new Set(['a']))).toHaveLength(1)
    expect(parseLlmRanking(`{"other":[${row}]}`, new Set(['a']))).toHaveLength(1)
  })

  it('confidence 形态容错：字符串数值/百分制/缺省 0.5；reason 非字符串保留空串', () => {
    const rows = parseLlmRanking(
      '{"results":[{"id":"a","reason":"0.25 字符串","confidence":"0.25"},{"id":"b","reason":"百分制 85","confidence":85},{"id":"c"},{"id":"d","reason":123,"confidence":0.9}]}',
      new Set(['a', 'b', 'c', 'd']),
    )
    expect(rows).toEqual([
      { id: 'a', reason: '0.25 字符串', confidence: 0.25 },
      { id: 'b', reason: '百分制 85', confidence: 0.85 },
      { id: 'c', reason: '', confidence: 0.5 },
      { id: 'd', reason: '', confidence: 0.9 },
    ])
  })

  it('负值夹取 0、越上界夹取 1', () => {
    const rows = parseLlmRanking(
      '{"results":[{"id":"a","confidence":-3},{"id":"b","confidence":999}]}',
      new Set(['a', 'b']),
    )
    expect(rows).toEqual([
      { id: 'a', reason: '', confidence: 0 },
      { id: 'b', reason: '', confidence: 1 },
    ])
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
