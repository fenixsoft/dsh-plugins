/**
 * 纯规则层全分支覆盖（spec session-grouper 六个迁移 Scenario 的纯函数分支）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildMigrationPlan,
  encodeSessionIdSegment,
  mangleProjectDirName,
  resolveProjectRoot,
  sessionDirKeyOf,
  targetSessionDirKey,
} from '../src/shared/rules.js'
import type { SessionScanEntry } from '../src/types/seam.js'

const PROJECTS = ['/root/fenixd', '/root/dsh-plugins']
const QUIET_MS = 30 * 60_000
const NOW = 1_000_000_000_000

let seq = 0
function entry(overrides: Partial<SessionScanEntry> & { cwd?: string }): SessionScanEntry {
  seq += 1
  const id = overrides.header?.id ?? `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${String(seq).padStart(2, '0')}`
  const cwd = overrides.cwd
  return {
    id,
    header: { version: 4, id, createdAt: NOW, cwd, isSeeded: false },
    artifactPath: overrides.artifactPath ?? (cwd === undefined ? undefined : `/sessions/${mangleProjectDirName(cwd)}/${id}/session.v4.jsonl.zstd`),
    artifactMtimeMs: overrides.artifactMtimeMs ?? NOW - 2 * 60 * 60_000,
    groupedPath: overrides.groupedPath ?? null,
    ...overrides,
  } as SessionScanEntry
}

describe('resolveProjectRoot 路径包含归属判定', () => {
  it('cwd 恰为项目根 → 命中', () => {
    expect(resolveProjectRoot('/root/fenixd', PROJECTS)).toBe('/root/fenixd')
  })

  it('cwd 位于项目根树内 → 命中', () => {
    expect(resolveProjectRoot('/root/fenixd/.claude/worktrees/impl-x-1', PROJECTS)).toBe('/root/fenixd')
  })

  it('cwd 不在任何项目根树内 → null', () => {
    expect(resolveProjectRoot('/tmp/dshacc-xyz', PROJECTS)).toBeNull()
    expect(resolveProjectRoot('/root/fenixd-other', PROJECTS)).toBeNull()
  })

  it('cwd 无 cwd（undefined）→ null', () => {
    expect(resolveProjectRoot(undefined, PROJECTS)).toBeNull()
  })

  it('命中多个项目根取最长前缀（嵌套配置防御）', () => {
    expect(resolveProjectRoot('/root/fenixd/.claude/worktrees/x', ['/root', '/root/fenixd/.claude', '/root/fenixd'])).toBe('/root/fenixd/.claude')
  })

  it('项目根尾随斜杠归一（/root/fenixd/ 与 /root/fenixd 同根）', () => {
    expect(resolveProjectRoot('/root/fenixd/sub', ['/root/fenixd/'])).toBe('/root/fenixd')
  })

  it('空前缀不参与命中', () => {
    expect(resolveProjectRoot('/root/x', [''])).toBeNull()
  })
})

describe('mangleProjectDirName / encodeSessionIdSegment 复刻推导', () => {
  it('常规路径：分隔符折叠为单 -，包裹 --key--（探针实证形态）', () => {
    expect(mangleProjectDirName('/root/fenixd/.claude/worktrees/impl-fake-123')).toBe(
      '--root-fenixd-.claude-worktrees-impl-fake-123--',
    )
  })

  it('非法字符 ~XXXX 大写十六进制转义', () => {
    // '+' 是非法字符 → ~002B
    expect(mangleProjectDirName('/a+b')).toBe('--a~002Bb--')
  })

  it('前导分隔符剥离（前导 - 去除）', () => {
    expect(mangleProjectDirName('/x')).toBe('--x--')
  })

  it('全分隔符路径退化为 root', () => {
    expect(mangleProjectDirName('///')).toBe('--root--')
  })

  it('超长路径截 251', () => {
    const long = `/${'a'.repeat(300)}`
    const key = mangleProjectDirName(long)
    expect(key.length).toBe(2 + 251 + 2)
    expect(key.startsWith('--')).toBe(true)
    expect(key.endsWith('--')).toBe(true)
  })

  it('空路径抛错（与后端一致）', () => {
    expect(() => mangleProjectDirName('')).toThrow()
  })

  it('UUID 会话 id 段不变换', () => {
    expect(encodeSessionIdSegment('74c896cd-6996-4289-a3cd-a3fe1eb03f00')).toBe('74c896cd-6996-4289-a3cd-a3fe1eb03f00')
  })

  it('非法字符会话 id 走 ~XXXX 转义', () => {
    expect(encodeSessionIdSegment('a~b')).toBe('a~007Eb')
  })

  it('targetSessionDirKey 组合', () => {
    expect(targetSessionDirKey('/root/dsh-plugins', 'id-1')).toBe('--root-dsh-plugins--/id-1')
  })

  it('sessionDirKeyOf 从产物路径回推末两段', () => {
    expect(sessionDirKeyOf('/r/--k--/sess/file.jsonl')).toBe('--k--/sess')
    expect(sessionDirKeyOf(undefined)).toBeUndefined()
    expect(sessionDirKeyOf('/short')).toBeUndefined()
  })
})

describe('buildMigrationPlan 迁移计划构造', () => {
  it('worktree 会话 → migrate 项（cwd 重写为项目根）', () => {
    const e = entry({ cwd: '/root/fenixd/.claude/worktrees/impl-add-foo-123' })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ kind: 'migrate', sessionId: e.id, fromCwd: '/root/fenixd/.claude/worktrees/impl-add-foo-123', toCwd: '/root/fenixd' })
  })

  it('根直属会话 → migrate 项（fromCwd === toCwd，attach-only）', () => {
    const e = entry({ cwd: '/root/dsh-plugins' })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set([targetSessionDirKey('/root/dsh-plugins', e.id)]) })
    expect(plan[0]).toMatchObject({ kind: 'migrate', toCwd: '/root/dsh-plugins' })
  })

  it('no-cwd：header 无 cwd → skip no-cwd', () => {
    const e = entry({ cwd: undefined })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'no-cwd' })
  })

  it('already-migrated：台账已登记 → skip already-migrated（幂等去重）', () => {
    const e = entry({ cwd: '/root/fenixd/sub' })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [e.id], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'already-migrated' })
  })

  it('already-grouped：已归组 → skip already-grouped', () => {
    const e = entry({ cwd: '/root/fenixd/sub', groupedPath: '/root/activation-showcase' })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'already-grouped' })
  })

  it('out-of-scope：树外 cwd → skip out-of-scope', () => {
    const e = entry({ cwd: '/tmp/dshacc-xyz' })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'out-of-scope' })
  })

  it('unmaterialized：无当前产物 → skip unmaterialized', () => {
    const e = entry({ cwd: '/root/fenixd/sub', artifactPath: undefined })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'unmaterialized' })
  })

  it('not-quiet：静默期不足 → skip not-quiet（mtime 距今 5 分钟 < 30 分钟）', () => {
    const e = entry({ cwd: '/root/fenixd/sub', artifactMtimeMs: NOW - 5 * 60_000 })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'not-quiet' })
  })

  it('not-quiet 边界：恰满静默期 → migrate', () => {
    const e = entry({ cwd: '/root/fenixd/sub', artifactMtimeMs: NOW - QUIET_MS })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'migrate' })
  })

  it('not-quiet：mtime 不可判定 → skip not-quiet', () => {
    const e = entry({ cwd: '/root/fenixd/sub', artifactMtimeMs: undefined })
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'not-quiet' })
  })

  it('target-conflict：目标目录被他占产物占用 → skip target-conflict', () => {
    const e = entry({ cwd: '/root/fenixd/wt' })
    const targetKey = targetSessionDirKey('/root/fenixd', e.id)
    const plan = buildMigrationPlan({ sessions: [e], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set([targetKey]) })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'target-conflict' })
  })

  it('目标被占但为自身现位（根直属）→ 不算冲突（attach-only）', () => {
    // 自身现位 = 目标键（产物恰在 mangle(根)/id 下）→ attach-only，不算冲突。
    const fixedId = '11111111-2222-3333-4444-555555555555'
    const ownHeader = { version: 4, id: fixedId, createdAt: NOW, cwd: '/root/fenixd', isSeeded: false }
    const atTarget: SessionScanEntry = {
      id: fixedId,
      header: ownHeader,
      artifactPath: `/sessions/${targetSessionDirKey('/root/fenixd', fixedId)}/session.v4.jsonl.zstd`,
      artifactMtimeMs: NOW - 2 * 60 * 60_000,
      groupedPath: null,
    }
    const plan = buildMigrationPlan({ sessions: [atTarget], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set([targetSessionDirKey('/root/fenixd', fixedId)]) })
    expect(plan[0]).toMatchObject({ kind: 'migrate', toCwd: '/root/fenixd' })
    // 对照：产物在别处、目标键被占（他者产物在目标位）→ 冲突。
    const movedId = '66666666-7777-8888-9999-000000000000'
    const moved: SessionScanEntry = {
      id: movedId,
      header: { ...ownHeader, id: movedId },
      artifactPath: `/sessions/--elsewhere--/${movedId}/session.v4.jsonl.zstd`,
      artifactMtimeMs: NOW - 2 * 60 * 60_000,
      groupedPath: null,
    }
    const plan2 = buildMigrationPlan({ sessions: [moved], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set([targetSessionDirKey('/root/fenixd', movedId)]) })
    expect(plan2[0]).toMatchObject({ kind: 'skip', reason: 'target-conflict' })
  })

  it('混合批次：migrate 与 skip 逐会话独立产出', () => {
    const inScope = entry({ cwd: '/root/fenixd/wt-a' })
    const fresh = entry({ cwd: '/root/dsh-plugins/wt-b', artifactMtimeMs: NOW - 60_000 })
    const outside = entry({ cwd: '/tmp/other' })
    const plan = buildMigrationPlan({ sessions: [inScope, fresh, outside], projects: PROJECTS, quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan).toHaveLength(3)
    expect(plan.map((p) => (p.kind === 'migrate' ? 'migrate' : p.reason))).toEqual(['migrate', 'not-quiet', 'out-of-scope'])
  })

  it('projects=[]：全部会话 out-of-scope', () => {
    const e = entry({ cwd: '/root/fenixd' })
    const plan = buildMigrationPlan({ sessions: [e], projects: [], quietMs: QUIET_MS, now: NOW, migratedSessionIds: [], occupiedTargetSessionDirs: new Set() })
    expect(plan[0]).toMatchObject({ kind: 'skip', reason: 'out-of-scope' })
  })
})
