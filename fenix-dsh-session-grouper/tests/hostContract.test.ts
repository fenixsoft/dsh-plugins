/**
 * Host 插件装载契约（task 3.2）：经 loader config 形态驱动
 * 装载即校验 / 合法停用（enabled=false、projects=[]）/ 服务缝漂移显式失败
 * 三类分支；注册表与持久化半均以形状替身（真实后端全装配已由
 * migrator.test.ts 覆盖，此处专注插件体控制流与停用语义）。
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FenixSessionGrouper, { SERVICE_NAME } from '../src/host/index.js'
import { mangleProjectDirName } from '../src/shared/rules.js'
import type { DshSessionPersistence, DshWorkspaceRegistry, SessionScanEntry } from '../src/types/seam.js'

const tmpRoots: string[] = []
afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grouper-contract-'))
  tmpRoots.push(dir)
  return dir
}

function fakeCtx(overrides: { registry?: DshWorkspaceRegistry; persistence?: DshSessionPersistence } = {}) {
  const info: string[] = []
  const warn: string[] = []
  const error: string[] = []
  // cordis logger 形态为 printf 风格（'%s', message）；桩取末个字符串实参。
  const take = (args: unknown[]) => String(args.at(-1))
  const logger = {
    debug: (...args: unknown[]) => void args,
    info: (...args: unknown[]) => info.push(take(args)),
    warn: (...args: unknown[]) => warn.push(take(args)),
    error: (...args: unknown[]) => error.push(take(args)),
  }
  const effects: Array<[() => void, string]> = []
  const ctx = {
    logger,
    // cordis effect 语义：立即调用工厂取得 dispose 回调（卸载时执行）。
    effect: (fn: () => () => void, label: string) => effects.push([fn(), label]),
    workspaceRegistry: overrides.registry,
    sessionPersistence: overrides.persistence,
  }
  return { ctx, logger: { info, warn, error }, effects }
}

interface StubWorkspace {
  id: string
  path: string
  title: string
  sessionIds: string[]
  attachCalls: string[]
  attachSession(sessionId: string): Promise<void>
}

function stubRegistry() {
  const workspaces: StubWorkspace[] = []
  const registry = {
    headers: new Map(),
    sessionPaths: new Map(),
    invalidSessionPaths: new Map(),
    createCalls: [] as Array<[string, string | undefined]>,
    workspaces,
    async create(path: string, title?: string): Promise<StubWorkspace> {
      this.createCalls.push([path, title])
      let found = workspaces.find((w) => w.path === path)
      if (found === undefined) {
        found = { id: path, path, title: title ?? path, sessionIds: [], attachCalls: [], async attachSession(this: StubWorkspace, sessionId: string) { this.attachCalls.push(sessionId); this.sessionIds = [sessionId, ...this.sessionIds] } }
        workspaces.push(found)
      }
      return found
    },
    list() {
      return workspaces
    },
  }
  return registry as unknown as DshWorkspaceRegistry & { createCalls: Array<[string, string | undefined]>; workspaces: StubWorkspace[]; headers: Map<string, unknown>; sessionPaths: Map<string, string> }
}

/** 形状替身持久化：可注入扫描行与可迁移会话（含可落盘的假物化）。 */
function stubPersistence(entries: readonly SessionScanEntry[] = [], migrateHooks: { onPersistBatch?: (header: unknown) => void } = {}) {
  const calls = { persistBatch: 0, persistHeader: 0 }
  let lastPersistedHeader: unknown
  const persistence = {
    name: 'session-persistence-jsonl',
    async list() {
      return entries.map((e) => ({ header: e.header, revision: `rev:${e.id}` }))
    },
    async stat(id: string) {
      const e = entries.find((x) => x.id === id)
      return e === undefined ? undefined : { header: e.header, revision: `rev:${id}` }
    },
    async open(id: string, access: 'read' | 'write') {
      void access
      const e = entries.find((x) => x.id === id)
      return {
        inheritedEventCount: 0,
        async read() {
          return { meta: e?.header, events: [{ seq: 0, type: 'permission/preset', data: { preset: 'workspace-write' } }] }
        },
        async close() {},
      }
    },
    resolveCurrentLog: async (id: string) => entries.find((x) => x.id === id)?.artifactPath ?? undefined,
    readStoredLog: async (path: string, expectedId: string) => {
      void path
      return { meta: lastPersistedHeader ?? { id: expectedId } }
    },
    async persistBatch(header: unknown) {
      calls.persistBatch += 1
      lastPersistedHeader = header
      migrateHooks.onPersistBatch?.(header)
    },
    async persistHeader(header: unknown) {
      calls.persistHeader += 1
      lastPersistedHeader = header
    },
  }
  return { persistence: persistence as unknown as DshSessionPersistence, calls }
}

function scanEntry(id: string, cwd: string, artifactPath: string | undefined, mtimeMs?: number): SessionScanEntry {
  return {
    id,
    header: { version: 4, id, createdAt: 0, cwd, isSeeded: false },
    artifactPath,
    artifactMtimeMs: mtimeMs,
    groupedPath: null,
  }
}

describe('FenixSessionGrouper 装载契约', () => {
  it('装载即校验：缝齐备时注册项目工作区并执行扫描轮（初始轮自动触发）', async () => {
    const home = tempDir()
    const proj = join(home, 'proj-a')
    mkdirSync(proj, { recursive: true })
    const registry = stubRegistry()
    const { persistence, calls } = stubPersistence([])
    const { ctx, logger } = fakeCtx({ registry, persistence })
    const plugin = new FenixSessionGrouper(ctx, { projects: [proj], quietMinutes: 30, intervalMinutes: 60, dshHome: join(home, 'dsh') })
    // 初始轮 setTimeout(0) 自动触发；轮询至注册完成（确定性经由 await vi.waitFor）。
    await vi.waitFor(() => expect(registry.createCalls).toEqual([[proj, 'proj-a']]))
    plugin.stop()
    expect(calls.persistBatch).toBe(0)
    expect(logger.error).toEqual([])
  })

  it('enabled=false：合法零动作停用（info 级记录，零注册零扫描）', async () => {
    const registry = stubRegistry()
    const { persistence, calls } = stubPersistence([])
    const { ctx, logger } = fakeCtx({ registry, persistence })
    const plugin = new FenixSessionGrouper(ctx, { enabled: false, dshHome: tempDir() })
    // 静置一拍确认无自动轮触发。
    await new Promise((r) => setTimeout(r, 20))
    expect(registry.createCalls).toEqual([])
    expect(calls.persistBatch).toBe(0)
    expect(logger.info.some((m) => m.includes('enabled=false'))).toBe(true)
    plugin.stop()
  })

  it('projects=[]：合法零动作停用（零注册零扫描）', async () => {
    const registry = stubRegistry()
    const { persistence } = stubPersistence([])
    const { ctx, logger } = fakeCtx({ registry, persistence })
    const plugin = new FenixSessionGrouper(ctx, { projects: [], dshHome: tempDir() })
    await new Promise((r) => setTimeout(r, 20))
    expect(registry.createCalls).toEqual([])
    expect(logger.info.some((m) => m.includes('projects=[]'))).toBe(true)
    plugin.stop()
  })

  it('服务缝漂移：workspaceRegistry 缺失 → error 级显式停用（不启动循环）', async () => {
    const { persistence } = stubPersistence([])
    const { ctx, logger } = fakeCtx({ persistence })
    const plugin = new FenixSessionGrouper(ctx, { dshHome: tempDir() })
    await new Promise((r) => setTimeout(r, 20))
    expect(logger.error.some((m) => m.includes('服务缝校验失败') && m.includes('workspaceRegistry'))).toBe(true)
    plugin.stop()
  })

  it('服务缝漂移：非 JSONL 后端（SQLite 形态）→ 显式停用', async () => {
    const registry = stubRegistry()
    const { persistence } = stubPersistence([])
    const drifted = { ...persistence, name: 'session-persistence-sqlite' } as unknown as DshSessionPersistence
    const { ctx, logger } = fakeCtx({ registry, persistence: drifted })
    const plugin = new FenixSessionGrouper(ctx, { dshHome: tempDir() })
    await new Promise((r) => setTimeout(r, 20))
    expect(logger.error.some((m) => m.includes('session-persistence-sqlite'))).toBe(true)
    plugin.stop()
  })

  it('服务缝漂移：peer 钉版不符（探测注入 0.3.0）→ 显式停用', async () => {
    const registry = stubRegistry()
    const { persistence } = stubPersistence([])
    const { ctx, logger } = fakeCtx({ registry, persistence })
    const plugin = new FenixSessionGrouper(ctx, {
      dshHome: tempDir(),
      peerVersionProbe: (pkg) => (pkg === '@deepseek-ai/dsh-session-persistence' ? '0.3.0' : '0.2.0-rc.2'),
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(logger.error.some((m) => m.includes('0.3.0') && m.includes('0.2.0-rc.2'))).toBe(true)
    plugin.stop()
  })

  it('单轮扫描：未归组树内会话被迁移（cwd 重写 + attach + 台账 + 注册表校正）', async () => {
    const home = tempDir()
    const proj = join(home, 'proj-a')
    const worktree = join(proj, 'wt-1')
    mkdirSync(worktree, { recursive: true })
    const sessionsRoot = join(home, 'sessions')
    const artifactPath = join(sessionsRoot, 'stale-dir', 'sess-1', 'session.v4.jsonl.zstd')
    mkdirSync(join(sessionsRoot, 'stale-dir', 'sess-1'), { recursive: true })
    writeFileSync(artifactPath, 'stub')
    // 产物 mtime 回拨到静默期外（扫描层 stat 真实文件 mtime）。
    const past = new Date(Date.now() - 2 * 60 * 60_000)
    utimesSync(artifactPath, past, past)
    const id = '11111111-2222-3333-4444-555555555555'
    const registry = stubRegistry()
    const { persistence, calls } = stubPersistence([scanEntry(id, worktree, artifactPath, Date.now() - 2 * 60 * 60_000)], {
      onPersistBatch: (header) => {
        // 形状替身物化：按 rules 复刻的 mangle 键把产物写到目标路径（漂移自校验）。
        const h = header as { cwd: string }
        mkdirSync(join(sessionsRoot, mangleProjectDirName(h.cwd), id), { recursive: true })
        writeFileSync(join(sessionsRoot, mangleProjectDirName(h.cwd), id, 'session.v4.jsonl.zstd'), 'rewritten')
      },
    })
    const { ctx, logger } = fakeCtx({ registry, persistence })
    const plugin = new FenixSessionGrouper(ctx, { projects: [proj], dshHome: join(home, 'dsh') })
    // 初始轮自动触发迁移；轮询至台账落位（确定性锚点）。
    const ledgerFile = join(home, 'dsh', 'session-grouper', 'migrations.jsonl')
    await vi.waitFor(() => expect(existsSync(ledgerFile)).toBe(true))
    plugin.stop()
    // header 以新 cwd 重写（persistBatch 收到的 header.cwd === 项目根）。
    expect(calls.persistBatch).toBe(1)
    // 官方 attach：workspace.create(proj) + attachSession(id)
    // （扫描轮注册一次 + 迁移 attach 路径一次，官方语义幂等复用同记录）。
    expect(registry.createCalls).toContainEqual([proj, 'proj-a'])
    expect(registry.workspaces[0]?.attachCalls).toEqual([id])
    // 注册表实例索引按新 header 校正。
    expect((registry.headers.get(id) as { cwd?: string }).cwd).toBe(proj)
    expect(registry.sessionPaths.get(id)).toBe(proj)
    // 台账落位（migrated 一行）。
    const ledger = readFileSync(ledgerFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { sessionId: string; status: string; toCwd: string })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ sessionId: id, status: 'migrated', toCwd: proj })
    // 旧源目录已清理。
    expect(existsSync(join(sessionsRoot, 'stale-dir', 'sess-1'))).toBe(false)
    void logger
  })

  it('卸载 effect 在位：ctx.effect 注册了 stop 清理（loader 卸载即停扫描）', async () => {
    const registry = stubRegistry()
    const { persistence } = stubPersistence([])
    const { ctx, effects } = fakeCtx({ registry, persistence })
    const plugin = new FenixSessionGrouper(ctx, { projects: [join(tempDir(), 'proj')], dshHome: tempDir() })
    expect(effects).toHaveLength(1)
    expect(effects[0]?.[1]).toContain(SERVICE_NAME)
    effects[0]?.[0]()
    expect((plugin as unknown as { timer?: unknown }).timer).toBeUndefined()
  })
})
