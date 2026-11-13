/**
 * host/collector 收集器测试：只读断言（夹具产物内容与 mtime 不变 + 无写通道
 * 调用）、时间范围过滤、计分截断（评分优先、同分取最近活跃）、零候选分支、
 * 首条用户消息节选 ≤2KB（UTF-8 字节安全）、controller 增强/缺失回退、
 * debug 级逐阶段数量日志。
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { byteTruncate, collectCandidates, extractFirstUserText, foldTitleFromEvents, TITLE_FOLD_MAX_SESSIONS, tokenize } from '../src/host/collector.js'
import type { CollectorLog } from '../src/host/collector.js'
import type { DshSessionController, DshSessionEvent, DshSessionHandle, DshSessionHeader, DshSessionPersistence, DshSessionSnapshot } from '../src/types/dsh-runtime.js'

/** 带调用台账的假 persistence（open 只支持 'read'；写通道存在即记账）。 */
class FakePersistence implements DshSessionPersistence {
  readonly name = 'session-persistence-jsonl'
  /** 方法调用台账（只读断言面）。 */
  readonly calls: { method: string; args: unknown[] }[] = []

  constructor(
    private readonly snapshots: readonly DshSessionSnapshot[],
    private readonly excerptById: ReadonlyMap<string, string>,
    private readonly eventsById: ReadonlyMap<string, readonly DshSessionEvent[]> = new Map(),
  ) {}

  list(options?: { signal?: AbortSignal }): Promise<readonly DshSessionSnapshot[]> {
    this.calls.push({ method: 'list', args: [options] })
    return Promise.resolve(this.snapshots)
  }

  stat(id: string): Promise<DshSessionSnapshot | undefined> {
    this.calls.push({ method: 'stat', args: [id] })
    return Promise.resolve(this.snapshots.find((snapshot) => snapshot.header.id === id))
  }

  open(id: string, access: 'read' | 'write', options?: { signal?: AbortSignal }): Promise<DshSessionHandle> {
    this.calls.push({ method: 'open', args: [id, access, options] })
    if (access !== 'read') throw new Error(`fixture: write access must never happen (got ${access})`)
    const header: DshSessionHeader = { version: 1, id, createdAt: 0, isSeeded: false }
    const custom = this.eventsById.get(id)
    const text = this.excerptById.get(id) ?? ''
    const events = custom ?? (text.length > 0 ? [{ seq: 1, type: 'user/message', content: [{ type: 'text', text }] }] : [])
    return Promise.resolve({
      id,
      header,
      access,
      read: () => {
        this.calls.push({ method: 'read', args: [id] })
        return Promise.resolve({ events: events as DshSessionEvent[] })
      },
      close: () => {
        this.calls.push({ method: 'close', args: [id] })
        return Promise.resolve()
      },
    })
  }
}

/** 记账 log 门面。 */
function makeLog(): CollectorLog & { debugs: string[]; warns: string[] } {
  const debugs: string[] = []
  const warns: string[] = []
  return {
    debugs,
    warns,
    debug: (m) => debugs.push(m),
    warn: (m) => warns.push(m),
  }
}

/** 夹具：真实 JSONL 产物文件（内容 + mtime 记账，供只读断言）。 */
class JsonlFixture {
  readonly dir: string
  readonly files = new Map<string, { path: string; content: string; mtimeMsBefore: number }>()

  constructor(sessionIds: readonly string[]) {
    this.dir = mkdtempSync(join(tmpdir(), 'sas-collector-'))
    for (const id of sessionIds) {
      const path = join(this.dir, `${id}.jsonl`)
      const content = [
        JSON.stringify({ version: 1, id, createdAt: 0, isSeeded: false }),
        JSON.stringify({ seq: 1, type: 'user/message', content: [{ type: 'text', text: `首条消息 of ${id}` }] }),
        JSON.stringify({ seq: 2, type: 'assistant/message', content: [] }),
      ].join('\n')
      writeFileSync(path, content, 'utf8')
      this.files.set(id, { path, content, mtimeMsBefore: statSync(path).mtimeMs })
    }
  }

  /** 断言全部夹具产物内容与 mtime 均未变化。 */
  assertUntouched(): void {
    for (const [id, file] of this.files) {
      expect(readFileSync(file.path, 'utf8'), `content of ${id}`).toBe(file.content)
      expect(statSync(file.path).mtimeMs, `mtime of ${id}`).toBe(file.mtimeMsBefore)
    }
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

/** 快照构造器。 */
function snapshot(id: string, createdAt: number, cwd?: string): DshSessionSnapshot {
  return { header: { version: 1, id, createdAt, isSeeded: false, cwd }, revision: 'r1' }
}

/** controller 增强行构造器。 */
function summary(id: string, updatedAt: number, title?: string): { sessionId: string; updatedAt: number; running: boolean; blank: boolean; projections?: { values?: Record<string, unknown> } } {
  return {
    sessionId: id,
    updatedAt,
    running: false,
    blank: false,
    projections: title === undefined ? undefined : { values: { title } },
  }
}

afterAll(() => {
  // 夹具目录由各用例自清理；此处兜底无操作。
})

describe('collectCandidates 只读纪律', () => {
  it('收集前后夹具产物内容与 mtime 不变，且从不触写通道', async () => {
    const fixture = new JsonlFixture(['s-a', 's-b'])
    const excerptById = new Map([
      ['s-a', 'first user text of a'],
      ['s-b', 'first user text of b'],
    ])
    const persistence = new FakePersistence([snapshot('s-a', 1000, '/root/fenixd'), snapshot('s-b', 2000, '/root/dsh-plugins')], excerptById)
    const log = makeLog()
    const request = { query: 'fenixd 登录' }

    const outcome = await collectCandidates({ persistence, log }, request, 30, new AbortController().signal)

    // 夹具产物未被改动（内容 + mtime）。
    fixture.assertUntouched()
    // 无任何写通道调用：只有 list / open('read') / read / close。
    const methods = persistence.calls.map((call) => call.method)
    expect(methods.filter((m) => m.startsWith('persist'))).toEqual([])
    for (const call of persistence.calls) {
      if (call.method === 'open') expect(call.args[1]).toBe('read')
    }
    // 候选带节选。
    expect(outcome.candidates.length).toBeGreaterThan(0)
    expect(outcome.candidates.every((row) => row.excerpt.length > 0)).toBe(true)
    fixture.dispose()
  })
})

describe('collectCandidates 时间范围过滤', () => {
  it('区间外会话（即使标题高度匹配）不进入候选', async () => {
    const persistence = new FakePersistence(
      [
        snapshot('in-range', 1_500, '/root/fenixd'),
        snapshot('out-range', 9_000, '/root/fenixd'),
      ],
      new Map([['in-range', '修复登录超时'],
        ['out-range', '修复登录超时 加强版']]),
    )
    const log = makeLog()
    const outcome = await collectCandidates(
      { persistence, log },
      { query: '登录', timeRange: { start: 1_000, end: 2_000 } },
      30,
      new AbortController().signal,
    )
    expect(outcome.stats.afterTimeFilter).toBe(1)
    expect(outcome.candidates.map((row) => row.sessionId)).toEqual(['in-range'])
  })

  it('活动时间优先取 controller updatedAt（覆盖 createdAt）', async () => {
    const persistence = new FakePersistence([snapshot('s1', 100, '/w')], new Map([['s1', '正文']]))
    const controller: DshSessionController = {
      list: () => Promise.resolve({ items: [summary('s1', 5_000, '标题甲')] }),
    }
    const outcome = await collectCandidates(
      { persistence, sessionController: controller, log: makeLog() },
      { query: '标题甲', timeRange: { start: 4_000, end: 6_000 } },
      30,
      new AbortController().signal,
    )
    // createdAt=100 落在范围外、updatedAt=5000 落在范围内：按增强活动时间保留。
    expect(outcome.candidates.map((row) => row.sessionId)).toEqual(['s1'])
    expect(outcome.candidates[0]?.activityTime).toBe(5_000)
    expect(outcome.candidates[0]?.title).toBe('标题甲')
  })

  it('无时间范围时全部通过', async () => {
    const persistence = new FakePersistence([snapshot('s1', 1), snapshot('s2', 2)], new Map())
    const outcome = await collectCandidates(
      { persistence, log: makeLog() },
      { query: '无命中词' },
      30,
      new AbortController().signal,
    )
    expect(outcome.stats.afterTimeFilter).toBe(2)
  })
})

describe('collectCandidates 计分与截断', () => {
  it('评分优先、同分取最近活跃，截断到 maxCandidates', async () => {
    const persistence = new FakePersistence(
      [
        snapshot('old-hit', 100, '/root/fenixd'), // 标题命中 +2（旧）
        snapshot('new-hit', 900, '/root/other'), // cwd+标题命中 +3
        snapshot('recent-zero', 800, '/root/x'), // 0 分（新）
        snapshot('old-zero', 700, '/root/y'), // 0 分（旧）
      ],
      new Map(),
    )
    const controller: DshSessionController = {
      list: () =>
        Promise.resolve({
          items: [
            summary('old-hit', 100, '登录修复'),
            summary('new-hit', 900, '登录修复 二次'),
            summary('recent-zero', 800, '无关'),
            summary('old-zero', 700, '无关'),
          ],
        }),
    }
    const outcome = await collectCandidates(
      { persistence, sessionController: controller, log: makeLog() },
      { query: '登录' },
      3,
      new AbortController().signal,
    )
    expect(outcome.stats.total).toBe(4)
    expect(outcome.stats.afterScoring).toBe(3)
    // new-hit(3) > old-hit(2) > 同 0 分取最近活跃 recent-zero。
    expect(outcome.candidates.map((row) => row.sessionId)).toEqual(['new-hit', 'old-hit', 'recent-zero'])
  })
})

describe('collectCandidates 零候选分支', () => {
  it('时间过滤后为空 → 空候选（且不读任何会话内容）', async () => {
    const persistence = new FakePersistence([snapshot('s1', 100, '/w')], new Map())
    const outcome = await collectCandidates(
      { persistence, log: makeLog() },
      { query: '登录', timeRange: { start: 2_000, end: 3_000 } },
      30,
      new AbortController().signal,
    )
    expect(outcome.candidates).toEqual([])
    expect(outcome.stats.afterTimeFilter).toBe(0)
    expect(persistence.calls.filter((call) => call.method === 'open')).toEqual([])
  })
})

describe('collectCandidates 首条用户消息节选', () => {
  it('节选 ≤2048 UTF-8 字节且不出现截半字符', async () => {
    const longText = '登录超时复现路径'.repeat(400) // 8 字 × 3 字节 × 400 = 9600 字节
    const persistence = new FakePersistence([snapshot('s1', 1, '/w')], new Map([['s1', longText]]))
    const outcome = await collectCandidates(
      { persistence, log: makeLog() },
      { query: '登录' },
      30,
      new AbortController().signal,
    )
    const excerpt = outcome.candidates[0]?.excerpt ?? ''
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(2048)
    expect(excerpt.endsWith('�')).toBe(false)
    expect(longText.startsWith(excerpt)).toBe(true)
  })

  it('无 user/message 事件 → 空节选', async () => {
    const persistence = new FakePersistence([snapshot('s1', 1, '/w')], new Map([['s1', '']]))
    const outcome = await collectCandidates(
      { persistence, log: makeLog() },
      { query: '登录' },
      30,
      new AbortController().signal,
    )
    expect(outcome.candidates[0]?.excerpt).toBe('')
  })

  it('事件流为存储 envelope 形态（真机 read 形状）→ 节选取 data.content（BUG-02 回归）', async () => {
    // 镜像真机 jsonl 后端 read 返回形态：payload 在 data 下（顶层无 content）。
    const envelopeEvents: DshSessionEvent[] = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      {
        seq: 1,
        type: 'user/message',
        data: { content: [{ type: 'text', text: '移动端登录按钮错位了。验证标记·乙' }], role: 'user', id: 'm-1' },
        surfaceOp: 'append',
      },
    ]
    const persistence = new FakePersistence(
      [snapshot('s1', 1, '/tmp/sas-ws-beta')],
      new Map(),
      new Map([['s1', envelopeEvents]]),
    )
    const outcome = await collectCandidates(
      { persistence, log: makeLog() },
      { query: '登录' },
      30,
      new AbortController().signal,
    )
    expect(outcome.candidates[0]?.excerpt).toBe('移动端登录按钮错位了。验证标记·乙')
  })

  it('单会话读取失败 warn 隔离，不中断整轮', async () => {
    // s1 更近活跃（同 0 分排序在前），读取失败仅其节选为空。
    const persistence = new FakePersistence([snapshot('s1', 50, '/w'), snapshot('s2', 40, '/w')], new Map([['s2', '正常节选']]))
    persistence.open = (id: string, access: 'read') => {
      persistence.calls.push({ method: 'open', args: [id, access] })
      if (id === 's1') return Promise.reject(new Error('boom'))
      const text = '正常节选'
      return Promise.resolve({
        id,
        header: { version: 1, id, createdAt: 0, isSeeded: false },
        access,
        read: () => Promise.resolve({ events: [{ seq: 1, type: 'user/message', content: [{ type: 'text', text }] }] }),
        close: () => Promise.resolve(),
      })
    }
    const log = makeLog()
    const outcome = await collectCandidates({ persistence, log }, { query: '登录' }, 30, new AbortController().signal)
    expect(outcome.candidates.map((row) => row.sessionId)).toEqual(['s1', 's2'])
    expect(outcome.candidates[0]?.excerpt).toBe('')
    expect(outcome.candidates[1]?.excerpt).toBe('正常节选')
    expect(log.warns.some((m) => m.includes('s1'))).toBe(true)
  })
})

describe('collectCandidates 缝缺失回退', () => {
  it('sessionController 缺失 → header-only（title 空、活动时间取 createdAt）', async () => {
    const persistence = new FakePersistence([snapshot('s1', 4_200, '/root/fenixd')], new Map([['s1', '正文']]))
    const log = makeLog()
    const outcome = await collectCandidates({ persistence, log }, { query: 'fenixd' }, 30, new AbortController().signal)
    expect(log.debugs.some((m) => m.includes('header-only'))).toBe(true)
    expect(outcome.candidates[0]).toMatchObject({ sessionId: 's1', title: '', workspacePath: '/root/fenixd', activityTime: 4_200 })
  })

  it('controller.list 抛错 → warn 回退 header-only，不中断', async () => {
    const persistence = new FakePersistence([snapshot('s1', 10, '/w')], new Map([['s1', '正文']]))
    const controller: DshSessionController = {
      list: () => Promise.reject(new Error('seam boom')),
    }
    const log = makeLog()
    const outcome = await collectCandidates({ persistence, sessionController: controller, log }, { query: '登录' }, 30, new AbortController().signal)
    expect(log.warns.some((m) => m.includes('回退 header-only'))).toBe(true)
    expect(outcome.candidates.length).toBe(1)
  })
})

describe('collectCandidates 逐级 debug 日志', () => {
  it('三级阶段数量逐级输出（收集总数→时间过滤后→计分截断后）', async () => {
    const persistence = new FakePersistence(
      [snapshot('s1', 100, '/w'), snapshot('s2', 200, '/w'), snapshot('s3', 300, '/w')],
      new Map(),
    )
    const log = makeLog()
    await collectCandidates(
      { persistence, log },
      { query: '登录', timeRange: { start: 0, end: 250 } },
      1,
      new AbortController().signal,
    )
    expect(log.debugs.some((m) => m.includes('收集会话 3 个'))).toBe(true)
    expect(log.debugs.some((m) => m.includes('时间过滤后 2 个'))).toBe(true)
    expect(log.debugs.some((m) => m.includes('计分截断后 1 个'))).toBe(true)
  })
})

describe('tokenize 与节选纯函数', () => {
  it('ASCII 词整词、CJK 按 2-gram 切', () => {
    expect(tokenize('fix login 页面')).toEqual(['fix', 'login', '页面'])
    expect(tokenize('修登录功能')).toEqual(['修登', '登录', '录功', '功能'])
  })

  it('byteTruncate 2KB 边界', () => {
    expect(byteTruncate('abc', 2)).toBe('ab')
    expect(byteTruncate('abc', 5)).toBe('abc')
    expect(Buffer.byteLength(byteTruncate('超'.repeat(1000), 2048), 'utf8')).toBeLessThanOrEqual(2048)
  })

  it('extractFirstUserText 跳过非 user/message 事件', () => {
    const events = [
      { seq: 0, type: 'session/title', content: [{ type: 'text', text: '标题' }] },
      { seq: 1, type: 'user/message', content: [{ type: 'text', text: '第一条' }, { type: 'text', text: '续行' }] },
      { seq: 2, type: 'user/message', content: [{ type: 'text', text: '第二条' }] },
    ]
    expect(extractFirstUserText(events)).toBe('第一条\n续行')
  })

  it('extractFirstUserText 读存储 envelope 形态（handle.read 实际返回 data.content；BUG-02 回归）', () => {
    // 真机 jsonl 后端 read 返回存储行形态：payload 在 data 下；行级 surfaceOp 与
    // data.role/id 为官方 v4 校验必需字段（真机 fail-closed 实证），此处全镜像。
    const events: DshSessionEvent[] = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      {
        seq: 1,
        type: 'user/message',
        data: {
          content: [{ type: 'text', text: '帮我看下登录功能报 500 的错误。验证标记·甲' }],
          source: { kind: 'user', rpcId: '00000000-0000-4000-8000-00000000dead' },
          role: 'user',
          id: '2161c98c-cc4a-49c7-add4-55305824f0f5',
        },
        surfaceOp: 'append',
      },
      { seq: 2, type: 'session/title', data: { title: '修复登录页 500 报错', messageSeqs: [1], source: { kind: 'fallback' } } },
    ]
    expect(extractFirstUserText(events)).toBe('帮我看下登录功能报 500 的错误。验证标记·甲')
    // envelope data.content 与顶层 content 同在场时以 envelope 为准
    expect(extractFirstUserText([{ seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '信封' }] }, content: [{ type: 'text', text: '顶层' }] }])).toBe('信封')
    // data 非 object / content 非数组 → 回退顶层（缺省 undefined → 空节选）
    expect(extractFirstUserText([{ seq: 1, type: 'user/message', data: 'corrupt' }])).toBe('')
    expect(extractFirstUserText([{ seq: 1, type: 'user/message', data: { content: 'not-array' }, content: [{ type: 'text', text: '顶层回退' }] }])).toBe('顶层回退')
  })

  it('foldTitleFromEvents last-wins：取最后一条 session/title 的 data.title（镜像官方 foldSessionTitle）', () => {
    expect(foldTitleFromEvents([
      titleEvent(1, '旧标题'),
      { seq: 2, type: 'user/message', content: [{ type: 'text', text: '正文' }] },
      titleEvent(3, '新标题'),
    ])).toBe('新标题')
  })

  it('foldTitleFromEvents 无 title 事件 / 缺 data / title 非字符串 → 空标题', () => {
    expect(foldTitleFromEvents([])).toBe('')
    expect(foldTitleFromEvents([{ seq: 1, type: 'user/message' }])).toBe('')
    expect(foldTitleFromEvents([{ seq: 2, type: 'session/title' }])).toBe('')
    expect(foldTitleFromEvents([{ seq: 3, type: 'session/title', data: { title: 42 } }])).toBe('')
  })
})

/** 夹具 session/title 事件（镜像生产行形态：data 嵌套 title/messageSeqs/source）。 */
function titleEvent(seq: number, title: string): DshSessionEvent {
  return { seq, type: 'session/title', data: { title, messageSeqs: [seq - 1], source: { kind: 'fallback' } } }
}

describe('collectCandidates cold 会话 title 折叠回退（BUG-01 回归）', () => {
  it('投影 title 空的 cold 会话经事件流折叠标题参与计分——双词命中且最近活跃者居首', async () => {
    // 复刻 BUG-01 失败形态：controller.list 全 cold 行（projections undefined
    // → 投影缓存无 title），实例自有空标题会话 createdAt 最新；修复前 title
    // 恒空 → 全零分 → 纯 recency，空会话压过 F1。修复后 F1/F3 折叠出标题
    // 各得 4 分（「登录」「修复」双词命中），同分取最近活跃 F1 居首。
    const now = Date.now()
    const day = 86_400_000
    const f3Created = Date.parse('2020-01-01T00:00:00Z')
    const persistence = new FakePersistence(
      [
        snapshot('f1', now - 2 * day, '/tmp/sas-ws-alpha'),
        snapshot('f3', f3Created, '/tmp/sas-ws-alpha'),
        snapshot('empty', now, '/root/fenix-server'),
      ],
      new Map(),
      new Map<string, readonly DshSessionEvent[]>([
        ['f1', [titleEvent(2, '修复登录页 500 报错'), { seq: 3, type: 'user/message', content: [{ type: 'text', text: '验证标记·甲' }] }]],
        ['f3', [titleEvent(2, '修复登录 token 过期逻辑')]],
        ['empty', []],
      ]),
    )
    const controller: DshSessionController = {
      list: () =>
        Promise.resolve({
          items: [
            summary('f1', now - 2 * day),
            summary('f3', f3Created),
            summary('empty', now),
          ],
        }),
    }
    const log = makeLog()
    const outcome = await collectCandidates(
      { persistence, sessionController: controller, log },
      { query: '登录 修复' },
      30,
      new AbortController().signal,
    )
    expect(outcome.candidates.map((row) => row.sessionId)).toEqual(['f1', 'f3', 'empty'])
    expect(outcome.candidates[0]).toMatchObject({ sessionId: 'f1', title: '修复登录页 500 报错' })
    // f1 的节选复用折叠阶段的读取（同会话至多 open 一次事件流）。
    const f1Opens = persistence.calls.filter((call) => call.method === 'open' && call.args[0] === 'f1')
    expect(f1Opens.length).toBe(1)
    expect(outcome.candidates.find((row) => row.sessionId === 'f1')?.excerpt).toBe('验证标记·甲')
  })

  it('折叠读取失败 warn 隔离：title 保持空、不中断整轮', async () => {
    const persistence = new FakePersistence([snapshot('bad', 200, '/w'), snapshot('good', 100, '/w')], new Map())
    persistence.open = (id: string, access: 'read') => {
      persistence.calls.push({ method: 'open', args: [id, access] })
      if (id === 'bad') return Promise.reject(new Error('fold boom'))
      return Promise.resolve({
        id,
        header: { version: 1, id, createdAt: 0, isSeeded: false },
        access,
        read: () =>
          Promise.resolve({ events: [titleEvent(2, '可折叠标题'), { seq: 3, type: 'user/message', content: [{ type: 'text', text: '正文' }] }] as DshSessionEvent[] }),
        close: () => Promise.resolve(),
      })
    }
    const log = makeLog()
    const outcome = await collectCandidates({ persistence, log }, { query: '可折叠' }, 30, new AbortController().signal)
    const byId = new Map(outcome.candidates.map((row) => [row.sessionId, row]))
    expect(byId.get('bad')?.title).toBe('')
    expect(byId.get('good')?.title).toBe('可折叠标题')
    // good 折叠出标题命中查询词 → 居首；bad 保持空标题仍以 header 路径在场。
    expect(outcome.candidates[0]?.sessionId).toBe('good')
    expect(log.warns.some((m) => m.includes('bad') && m.includes('折叠读取失败'))).toBe(true)
  })

  it(`折叠读取达上限 ${TITLE_FOLD_MAX_SESSIONS}：最近活跃优先，超限更早会话不读`, async () => {
    const total = TITLE_FOLD_MAX_SESSIONS + 5
    const snapshots = Array.from({ length: total }, (_, i) => snapshot(`s-${String(i).padStart(3, '0')}`, 1_000 + i, '/w'))
    const persistence = new FakePersistence(snapshots, new Map())
    const log = makeLog()
    // maxCandidates=30：截断集（全零分 → 最近活跃前 30）全部落在折叠缓存内，
    // 节选阶段零新读取 → open 总数恰为折叠上限。
    const outcome = await collectCandidates({ persistence, log }, { query: '无命中词' }, 30, new AbortController().signal)
    expect(outcome.candidates.length).toBe(30)
    const opened = new Set(persistence.calls.filter((call) => call.method === 'open').map((call) => call.args[0]))
    expect(opened.size).toBe(TITLE_FOLD_MAX_SESSIONS)
    // 最近活跃（createdAt 最大）者优先折叠；最老 5 个（createdAt 最小，
    // 数组前 5 个）不在读取集。
    for (const id of snapshots.slice(0, 5).map((row) => row.header.id)) {
      expect(opened.has(id)).toBe(false)
    }
    expect(log.debugs.some((m) => m.includes('cold title 折叠达上限'))).toBe(true)
  })
})
