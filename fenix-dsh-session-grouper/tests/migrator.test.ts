/**
 * 迁移层全 Scenario 覆盖（task 4.3 / 5.1）。
 *
 * 装配策略（task 4.3 纪律：优先真实持久化包装配）：
 * - 持久化半 = **真实** dsh-session-persistence-jsonl@0.2.0-rc.2（本机安装包
 *   经绝对路径动态导入；该路径处于 node_modules 树内，vite-node 原生外置加载，
 *   其内部裸导入命中安装树自身解析——真实 cordis Context 独立装配，探针实证）。
 * - 注册表半 = 形状替身（真实 WorkspaceRegistry 需 dsh-storage 全套装配，
 *   不在 vitest 可装配面；headers/sessionPaths/invalidSessionPaths/attachSession
 *   消费面与发行包 .d.ts 逐字对齐——用例注明）。
 * - 全部产物落临时目录（mkdtemp），MUST NOT 对真实 ~/.dsh/sessions 读写。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildMigrationPlan } from '../src/shared/rules.js'
import { encodeSessionIdSegment, mangleProjectDirName } from '../src/shared/rules.js'
import { Migrator, parseLedger, readMigratedSessionIds, backupDirFor, ledgerPath } from '../src/host/migrator.js'
import type { MigrateLogger } from '../src/host/migrator.js'
import { rollbackSession, rollbackAll, runRollbackCli, rollbackableSessionIds } from '../src/host/rollback.js'
import { scanSessions } from '../src/host/sessionScan.js'
import type { DshSessionPersistence, DshWorkspaceRegistry, SessionId } from '../src/types/seam.js'

const DSH_INSTALL_ROOT = process.env.DSH_INSTALL_ROOT ?? '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const realAvailable = existsSync(`${DSH_INSTALL_ROOT}/dsh-session-persistence-jsonl/lib/index.js`)

// 真实安装包模块（beforeAll 动态导入；不可用时整组跳过并在报告中注明）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jsonl: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cordis: any
let FORMAT_VERSION = 4

beforeAll(async () => {
  if (!realAvailable) return
  jsonl = await import(/* @vite-ignore */ `${DSH_INSTALL_ROOT}/dsh-session-persistence-jsonl/lib/index.js`)
  cordis = await import(/* @vite-ignore */ `${DSH_INSTALL_ROOT}/cordis/lib/index.js`)
  const session = await import(/* @vite-ignore */ `${DSH_INSTALL_ROOT}/dsh-session/lib/index.js`)
  FORMAT_VERSION = session.SESSION_FORMAT_VERSION as number
})

const tmpRoots: string[] = []
afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 隔离环境：临时 sessions root + 两个临时项目根 + 临时 DSH_HOME。 */
function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'grouper-test-'))
  tmpRoots.push(base)
  const sessionsRoot = join(base, 'sessions')
  const projA = join(base, 'proj-a')
  const projB = join(base, 'proj-b')
  const projAWorktree = join(projA, '.claude', 'worktrees', 'impl-x-1')
  mkdirSync(projA, { recursive: true })
  mkdirSync(projB, { recursive: true })
  const dshHome = join(base, 'dsh-home')
  const backend: DshSessionPersistence = new jsonl.default(new cordis.Context(), { root: sessionsRoot, compression: 'zstd' })
  return { base, sessionsRoot, projA, projB, projAWorktree, dshHome, backend }
}

/** 形状替身注册表（消费面与发行包 .d.ts 对齐；createCalls/attach 可断言）。 */
interface StubWorkspace {
  id: string
  path: string
  title: string
  sessionIds: string[]
  attachCalls: SessionId[]
  attachSession(sessionId: SessionId): Promise<void>
}

interface StubRegistry {
  headers: Map<SessionId, unknown>
  sessionPaths: Map<SessionId, string>
  invalidSessionPaths: Map<SessionId, string>
  createCalls: Array<[string, string | undefined]>
  workspaces: StubWorkspace[]
  create(path: string, title?: string): Promise<StubWorkspace>
  list(): StubWorkspace[]
}

function stubRegistry(existing: ReadonlyArray<{ path: string; sessionIds?: readonly SessionId[] }> = []): StubRegistry {
  const workspaces: StubWorkspace[] = existing.map((e) => ({
    id: e.path,
    path: e.path,
    title: e.path.split('/').pop() ?? e.path,
    sessionIds: [...(e.sessionIds ?? [])],
    attachCalls: [],
    async attachSession(this: StubWorkspace, sessionId: SessionId) {
      this.attachCalls.push(sessionId)
      if (!this.sessionIds.includes(sessionId)) this.sessionIds = [sessionId, ...this.sessionIds]
    },
  }))
  const registry: StubRegistry = {
    headers: new Map(),
    sessionPaths: new Map(),
    invalidSessionPaths: new Map(),
    createCalls: [],
    workspaces,
    async create(path, title) {
      this.createCalls.push([path, title])
      let found = workspaces.find((w) => w.path === path)
      if (found === undefined) {
        found = {
          id: path,
          path,
          title: title ?? path.split('/').pop() ?? path,
          sessionIds: [],
          attachCalls: [],
          async attachSession(this: StubWorkspace, sessionId: SessionId) {
            this.attachCalls.push(sessionId)
            if (!this.sessionIds.includes(sessionId)) this.sessionIds = [sessionId, ...this.sessionIds]
          },
        }
        workspaces.push(found)
      }
      return found
    },
    list() {
      return workspaces
    },
  }
  return registry
}

function asRegistry(stub: StubRegistry): DshWorkspaceRegistry {
  return stub as unknown as DshWorkspaceRegistry
}

/**
 * 类型化透传包装（保持真实后端语义；包装点按 hooks 注入统计/变异）。
 * 用于模拟「准备期间产物被改写」（onStat）与「目标位冲突」（onPersistBatch）。
 */
function wrapPersistence(
  backend: DshSessionPersistence,
  hooks: { onStat?: () => Promise<void> | void; onPersistBatch?: () => Promise<void> | void } = {},
): DshSessionPersistence {
  return {
    get name() {
      return backend.name
    },
    list: (options) => backend.list(options),
    stat: async (id, options) => {
      await hooks.onStat?.()
      return backend.stat(id, options)
    },
    open: (id, access, options) => backend.open(id, access, options),
    resolveCurrentLog: async (id, signal) => backend.resolveCurrentLog?.(id, signal),
    readStoredLog: async (path, expectedId, signal) => backend.readStoredLog?.(path, expectedId, signal),
    persistBatch: async (header, events, isMaterialized, inheritedEventCount) => {
      await hooks.onPersistBatch?.()
      return backend.persistBatch?.(header, events, isMaterialized, inheritedEventCount)
    },
    persistHeader: async (header, inheritedEventCount) => backend.persistHeader?.(header, inheritedEventCount),
  }
}

function captureLogger(): MigrateLogger & { messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    warn: (m) => messages.push(m),
    error: (m) => messages.push(m),
    info: (m) => messages.push(m),
  }
}

/** 经真实后端造一个会话（0 或 2 条真实可回读事件），返回 id。 */
async function createSession(backend: DshSessionPersistence, cwd: string, eventCount = 0): Promise<SessionId> {
  const id = randomUUID()
  const t = Date.now()
  const h = await (backend as unknown as { create(header: unknown): Promise<{ append(events: unknown[]): Promise<void>; flush(): Promise<void>; close(): Promise<void> }> }).create({
    version: FORMAT_VERSION,
    id,
    createdAt: t,
    cwd,
    isSeeded: false,
  })
  // 真实发行行形态（与真实会话产物一致：permission/preset + sandbox/mode）——
  // 追加事件必须能被读侧 v4 解码器完整回放，否则读侧按 torn-tail 截断。
  const events = [
    { seq: 0, time: t, type: 'permission/preset', data: { preset: 'workspace-write' } },
    { seq: 1, time: t, type: 'sandbox/mode', data: { mode: 'workspace-write' } },
  ].slice(0, eventCount).map((e, i) => ({ ...e, seq: i }))
  if (events.length > 0) await h.append(events)
  await h.flush()
  await h.close()
  return id
}

/** 回拨产物 mtime（静默期控制）。 */
async function backdateArtifact(backend: DshSessionPersistence, id: SessionId, ageMs: number): Promise<void> {
  const log = await backend.resolveCurrentLog?.(id)
  if (log === undefined) throw new Error(`会话 ${id} 无产物`)
  const past = new Date(Date.now() - ageMs)
  utimesSync(log, past, past)
}

async function currentHeaderOf(backend: DshSessionPersistence, id: SessionId): Promise<{ cwd?: string } | undefined> {
  const snap = await backend.stat(id)
  return snap?.header
}

describe.skipIf(!realAvailable)('迁移层（真实 JSONL 后端装配）', () => {
  it('worktree 会话归入工程：header cwd 重写 + 产物归位 + 备份/台账/注册表校正/attach', async () => {
    const env = makeEnv()
    const id = await createSession(env.backend, env.projAWorktree, 2)
    await backdateArtifact(env.backend, id, 2 * 60 * 60_000)
    const registry = stubRegistry()
    const log = captureLogger()
    const migrator = new Migrator(env.backend, asRegistry(registry), log, env.dshHome)

    const outcome = await migrator.migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })

    expect(outcome).toMatchObject({ status: 'migrated', sessionId: id, toCwd: env.projA })
    // header cwd 已重写为项目根（经真实后端回读）。
    expect((await currentHeaderOf(env.backend, id))?.cwd).toBe(env.projA)
    // 产物归位：新目录在 mangle(projA) 下，旧目录已删。
    const newLog = await env.backend.resolveCurrentLog?.(id)
    expect(newLog).toContain(mangleProjectDirName(env.projA))
    expect(newLog).toContain(encodeSessionIdSegment(id))
    expect(existsSync(join(env.sessionsRoot, mangleProjectDirName(env.projAWorktree)))).toBe(false)
    // 事件随迁移完整搬运（2 条）。
    const rh = await env.backend.open(id, 'read')
    expect((await rh.read()).events).toHaveLength(2)
    await rh.close()
    // 备份落位：<DSH_HOME>/session-grouper-backups/<id>/（原产物副本）。
    const backupDir = backupDirFor(env.dshHome, id)
    expect(existsSync(backupDir)).toBe(true)
    expect(readdirSync(backupDir)).toContain('session.v4.jsonl.zstd')
    // 台账落位：migrations.jsonl 一行含 sessionId/原 cwd/目标 cwd/时间戳/status。
    const ledger = parseLedger(env.dshHome)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ sessionId: id, fromCwd: env.projAWorktree, toCwd: env.projA, status: 'migrated' })
    expect(typeof ledger[0]?.at).toBe('string')
    // 注册表实例状态校正：headers/sessionPaths 按新 header 更新。
    expect((registry.headers.get(id) as { cwd?: string } | undefined)?.cwd).toBe(env.projA)
    expect(registry.sessionPaths.get(id)).toBe(env.projA)
    // 官方 attach 归组：workspace.create(projA) + attachSession(id)。
    expect(registry.createCalls).toContainEqual([env.projA, 'proj-a'])
    expect(registry.workspaces.find((w) => w.path === env.projA)?.attachCalls).toEqual([id])
    // mangle 漂移守卫：rules 推导键 === 真实后端实际落位目录。
    expect(newLog?.startsWith(join(env.sessionsRoot, mangleProjectDirName(env.projA), encodeSessionIdSegment(id)))).toBe(true)
  })

  it('项目根直属会话归入工程：零重写零归位，直接 attach（归位幂等）', async () => {
    const env = makeEnv()
    const id = await createSession(env.backend, env.projB, 0)
    await backdateArtifact(env.backend, id, 60 * 60_000)
    const registry = stubRegistry()
    const log = captureLogger()
    const migrator = new Migrator(env.backend, asRegistry(registry), log, env.dshHome)
    const beforeLog = await env.backend.resolveCurrentLog?.(id)
    const outcome = await migrator.migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd: env.projB, isSeeded: false }, fromCwd: env.projB, toCwd: env.projB })
    expect(outcome).toMatchObject({ status: 'migrated' })
    // 产物原地未动（attach-only 分支）。
    expect(await env.backend.resolveCurrentLog?.(id)).toBe(beforeLog)
    // 无备份产生（未发生数据重写）。
    expect(existsSync(backupDirFor(env.dshHome, id))).toBe(false)
    // attach 调用 + 台账 migrated。
    expect(registry.workspaces.find((w) => w.path === env.projB)?.attachCalls).toEqual([id])
    expect(parseLedger(env.dshHome)[0]).toMatchObject({ sessionId: id, status: 'migrated', fromCwd: env.projB, toCwd: env.projB })
  })

  it('目录已删除的陈旧会话：header cwd 指向不存在目录仍完成迁移', async () => {
    const env = makeEnv()
    const goneCwd = join(env.projA, '.claude', 'worktrees', 'gone-forever')
    const id = await createSession(env.backend, goneCwd, 1)
    await backdateArtifact(env.backend, id, 3 * 60 * 60_000)
    expect(existsSync(goneCwd)).toBe(false)
    const migrator = new Migrator(env.backend, asRegistry(stubRegistry()), captureLogger(), env.dshHome)
    const outcome = await migrator.migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd: goneCwd, isSeeded: false }, fromCwd: goneCwd, toCwd: env.projA })
    expect(outcome).toMatchObject({ status: 'migrated', toCwd: env.projA })
    expect((await currentHeaderOf(env.backend, id))?.cwd).toBe(env.projA)
  })

  it('静默期内在飞会话跳过（扫描 + 计划联判），静默期满后迁移', async () => {
    const env = makeEnv()
    const inFlight = await createSession(env.backend, env.projAWorktree, 0)
    const quiet = await createSession(env.backend, join(env.projA, 'other-wt'), 0)
    utimesSync(join(env.sessionsRoot, mangleProjectDirName(env.projAWorktree), encodeSessionIdSegment(inFlight)), new Date(), new Date())
    // 修正：回拨要对产物文件而非目录；直接对两产物分别处理。
    await backdateArtifact(env.backend, inFlight, 5 * 60_000)
    await backdateArtifact(env.backend, quiet, 2 * 60 * 60_000)
    const registry = stubRegistry()
    const entries = await scanSessions(env.backend, asRegistry(registry))
    expect(entries).toHaveLength(2)
    const plan = buildMigrationPlan({
      sessions: entries,
      projects: [env.projA],
      quietMs: 30 * 60_000,
      now: Date.now(),
      migratedSessionIds: readMigratedSessionIds(env.dshHome),
      occupiedTargetSessionDirs: new Set(),
    })
    const byId = new Map(plan.map((p) => [p.sessionId, p]))
    expect(byId.get(inFlight)).toMatchObject({ kind: 'skip', reason: 'not-quiet' })
    expect(byId.get(quiet)).toMatchObject({ kind: 'migrate' })
    // 静默期满后的下一轮：in-flight 亦可迁移。
    await backdateArtifact(env.backend, inFlight, 31 * 60_000)
    const entries2 = await scanSessions(env.backend, asRegistry(registry))
    const plan2 = buildMigrationPlan({ sessions: entries2, projects: [env.projA], quietMs: 30 * 60_000, now: Date.now(), migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan2.find((p) => p.sessionId === inFlight)).toMatchObject({ kind: 'migrate' })
  })

  it('作用域外会话与已归组会话不迁移（扫描集仅含未归组树内会话）', async () => {
    const env = makeEnv()
    const outsideId = await createSession(env.backend, join(env.base, 'elsewhere'), 0)
    const groupedId = await createSession(env.backend, join(env.base, 'third-party-proj'), 0)
    const freeId = await createSession(env.backend, env.projAWorktree, 0)
    await backdateArtifact(env.backend, freeId, 60 * 60_000)
    const registry = stubRegistry([{ path: '/some/existing-ws', sessionIds: [groupedId] }])
    const entries = await scanSessions(env.backend, asRegistry(registry))
    const byId = new Map(entries.map((e) => [e.id, e]))
    expect(byId.get(groupedId)?.groupedPath).not.toBeNull()
    expect(byId.get(outsideId)?.groupedPath).toBeNull()
    const plan = buildMigrationPlan({ sessions: entries, projects: [env.projA], quietMs: 30 * 60_000, now: Date.now(), migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    const migrateIds = plan.filter((p) => p.kind === 'migrate').map((p) => p.sessionId)
    expect(migrateIds).toContain(freeId)
    expect(migrateIds).not.toContain(outsideId)
    expect(migrateIds).not.toContain(groupedId)
  })

  it('目标产物冲突：执行层拒绝覆盖并回滚，原产物完好', async () => {
    const env = makeEnv()
    const id = await createSession(env.backend, env.projAWorktree, 1)
    await backdateArtifact(env.backend, id, 60 * 60_000)
    // persistBatch 包装：物化调用瞬间目标位被他占产物占入（真实约束：同 id 双目录
    // 使 stat/findLog 直接 duplicate，故冲突只能在备份落位后出现——计划层
    // target-conflict 跳过是主防线，此处验证执行层兜底：物化拒绝 → 备份回滚 →
    // 原产物完好、目标占位清理）。
    const wrapped = wrapPersistence(env.backend, {
      onPersistBatch: () => {
        const targetDir = join(env.sessionsRoot, mangleProjectDirName(env.projA), encodeSessionIdSegment(id))
        mkdirSync(targetDir, { recursive: true })
        writeFileSync(join(targetDir, 'session.v4.jsonl.zstd'), 'placeholder-from-other-writer')
      },
    })
    const log = captureLogger()
    const migrator = new Migrator(wrapped, asRegistry(stubRegistry()), log, env.dshHome)
    const outcome = await migrator.migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })
    expect(outcome.status).toBe('failed')
    // 原产物完好可读（备份还原成功，无半迁移状态；目标占位目录已清理）。
    expect((await currentHeaderOf(env.backend, id))?.cwd).toBe(env.projAWorktree)
    const rh = await env.backend.open(id, 'read')
    expect((await rh.read()).events).toHaveLength(1)
    await rh.close()
    expect(existsSync(join(env.sessionsRoot, mangleProjectDirName(env.projA)))).toBe(false)
    expect(log.messages.some((m) => m.includes('迁移失败已回滚'))).toBe(true)
  })

  it('写竞争中止：准备期间产物被改写 → revision 校验拒绝本轮', async () => {
    const env = makeEnv()
    const id = await createSession(env.backend, env.projAWorktree, 1)
    await backdateArtifact(env.backend, id, 60 * 60_000)
    // stat 包装：第二次 stat（写前校验点）前同步改写产物 mtime（模拟他者写者）。
    let statCalls = 0
    const srcLog = await env.backend.resolveCurrentLog?.(id)
    if (srcLog === undefined) throw new Error('fixture 无产物')
    const wrapped = wrapPersistence(env.backend, {
      onStat: () => {
        statCalls += 1
        if (statCalls === 2) {
          const future = new Date(Date.now() + 5000)
          utimesSync(srcLog, future, future)
        }
      },
    })
    const migrator = new Migrator(wrapped, asRegistry(stubRegistry()), captureLogger(), env.dshHome)
    const outcome = await migrator.migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })
    expect(outcome).toMatchObject({ status: 'refused', reason: 'revision-changed' })
    // 产物保持原状（位置与 header 均未动）。
    expect((await currentHeaderOf(env.backend, id))?.cwd).toBe(env.projAWorktree)
    const logPath = await env.backend.resolveCurrentLog?.(id)
    expect(logPath).toContain(mangleProjectDirName(env.projAWorktree))
  })

  it('空事件会话走 persistHeader 通道迁移', async () => {
    const env = makeEnv()
    const id = await createSession(env.backend, env.projAWorktree, 0)
    await backdateArtifact(env.backend, id, 60 * 60_000)
    const migrator = new Migrator(env.backend, asRegistry(stubRegistry()), captureLogger(), env.dshHome)
    const outcome = await migrator.migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })
    expect(outcome).toMatchObject({ status: 'migrated' })
    expect((await currentHeaderOf(env.backend, id))?.cwd).toBe(env.projA)
  })

  it('单会话失败不中断整轮（错误隔离）：失败会话后其余会话继续迁移', async () => {
    const env = makeEnv()
    const goodId = await createSession(env.backend, env.projAWorktree, 0)
    await backdateArtifact(env.backend, goodId, 60 * 60_000)
    const migrator = new Migrator(env.backend, asRegistry(stubRegistry()), captureLogger(), env.dshHome)
    // 第一项：不存在的会话（失败）；第二项：正常会话。
    const failed = await migrator.migrate({ sessionId: randomUUID(), header: { version: FORMAT_VERSION, id: 'x', createdAt: 0, cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })
    expect(failed.status).toBe('failed')
    const ok = await migrator.migrate({ sessionId: goodId, header: { version: FORMAT_VERSION, id: goodId, createdAt: Date.now(), cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })
    expect(ok).toMatchObject({ status: 'migrated' })
    // 台账仅含成功项。
    expect(parseLedger(env.dshHome).map((e) => e.sessionId)).toEqual([goodId])
  })
})

describe.skipIf(!realAvailable)('回滚层（真实 JSONL 后端装配）', () => {
  it('回滚复现：恢复备份产物 + 还原 header cwd + 目标清理 + 台账标记', async () => {
    const env = makeEnv()
    const id = await createSession(env.backend, env.projAWorktree, 1)
    await backdateArtifact(env.backend, id, 60 * 60_000)
    const registry = stubRegistry()
    const log = captureLogger()
    const migrator = new Migrator(env.backend, asRegistry(registry), log, env.dshHome)
    expect(await migrator.migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })).toMatchObject({ status: 'migrated' })
    expect((await currentHeaderOf(env.backend, id))?.cwd).toBe(env.projA)

    const outcome = await rollbackSession(env.backend, asRegistry(registry), env.dshHome, log, id)
    expect(outcome).toMatchObject({ status: 'rolled-back', fromCwd: env.projAWorktree })
    // header cwd 复现迁移前状态（备份即原物）。
    expect((await currentHeaderOf(env.backend, id))?.cwd).toBe(env.projAWorktree)
    // 产物回到原 mangled 目录；目标目录不存在。
    const restoredLog = await env.backend.resolveCurrentLog?.(id)
    expect(restoredLog).toContain(mangleProjectDirName(env.projAWorktree))
    expect(existsSync(join(env.sessionsRoot, mangleProjectDirName(env.projA)))).toBe(false)
    // 注册表索引撤销。
    expect(registry.headers.has(id)).toBe(false)
    expect(registry.sessionPaths.has(id)).toBe(false)
    // 台账标记回滚；幂等去重集合不再含该 id。
    expect(parseLedger(env.dshHome).at(-1)).toMatchObject({ sessionId: id, status: 'rolled-back' })
    expect(readMigratedSessionIds(env.dshHome)).not.toContain(id)
    // 幂等重入：再次回滚 → skipped。
    expect(await rollbackSession(env.backend, asRegistry(registry), env.dshHome, log, id)).toMatchObject({ status: 'skipped' })
  })

  it('rollbackAll + CLI 入口：全部回滚逐会话执行，退出码与输出形态正确', async () => {
    const env = makeEnv()
    const ids: SessionId[] = []
    for (const cwd of [env.projAWorktree, join(env.projB, 'wt2')]) {
      const id = await createSession(env.backend, cwd, 0)
      await backdateArtifact(env.backend, id, 60 * 60_000)
      const registry = stubRegistry()
      expect(await new Migrator(env.backend, asRegistry(registry), captureLogger(), env.dshHome).migrate({ sessionId: id, header: { version: FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false }, fromCwd: cwd, toCwd: cwd.startsWith(env.projA) ? env.projA : env.projB })).toMatchObject({ status: 'migrated' })
      ids.push(id)
    }
    expect(rollbackableSessionIds(env.dshHome)).toEqual(ids)
    const log = captureLogger()
    const outcomes = await rollbackAll(env.backend, asRegistry(stubRegistry()), env.dshHome, log)
    expect(outcomes.map((o) => o.status)).toEqual(['rolled-back', 'rolled-back'])
    for (const id of ids) {
      expect((await currentHeaderOf(env.backend, id))?.cwd).not.toBe(env.projA)
      expect((await currentHeaderOf(env.backend, id))?.cwd).not.toBe(env.projB)
    }
    // CLI（新迁移 + 单会话回滚）：退出码 0，输出 `status\tsessionId`。
    const cliId = await createSession(env.backend, env.projAWorktree, 0)
    await backdateArtifact(env.backend, cliId, 60 * 60_000)
    expect(await new Migrator(env.backend, asRegistry(stubRegistry()), captureLogger(), env.dshHome).migrate({ sessionId: cliId, header: { version: FORMAT_VERSION, id: cliId, createdAt: Date.now(), cwd: env.projAWorktree, isSeeded: false }, fromCwd: env.projAWorktree, toCwd: env.projA })).toMatchObject({ status: 'migrated' })
    const lines: string[] = []
    const code = await runRollbackCli(env.backend, undefined, ['--session', cliId, '--root', env.sessionsRoot, '--dsh-home', env.dshHome], (line) => lines.push(line))
    expect(code).toBe(0)
    expect(lines[0]).toBe(`rolled-back\t${cliId}`)
    expect(existsSync(ledgerPath(env.dshHome))).toBe(true)
    // 台账解析回读（单行损坏跳过）。
    writeFileSync(ledgerPath(env.dshHome), `${readFileSync(ledgerPath(env.dshHome), 'utf8')}\n{broken json\n`, 'utf8')
    expect(readMigratedSessionIds(env.dshHome)).not.toContain(cliId)
  })

  it('回滚失败面：无台账记录 → skipped；备份缺失 → failed', async () => {
    const env = makeEnv()
    const log = captureLogger()
    const ghost = randomUUID()
    expect(await rollbackSession(env.backend, undefined, env.dshHome, log, ghost)).toMatchObject({ status: 'skipped' })
    // 造一条 migrated 台账但无备份目录。
    const { appendLedger } = await import('../src/host/migrator.js')
    appendLedger(env.dshHome, { sessionId: ghost, fromCwd: '/a', toCwd: '/b', at: new Date().toISOString(), status: 'migrated' })
    expect(await rollbackSession(env.backend, undefined, env.dshHome, log, ghost)).toMatchObject({ status: 'failed' })
  })
})
