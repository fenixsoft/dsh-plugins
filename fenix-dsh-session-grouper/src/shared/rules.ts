/**
 * 纯规则层：路径归属判定、mangled 目录名推导、迁移计划构造。
 *
 * 零 I/O、零时钟、零随机：全部输入显式传入，输出为纯数据计划项，便于
 * 全分支单测（tests/rules.test.ts 对应 spec 六个迁移 Scenario 的纯函数分支）。
 *
 * `mangleProjectDirName` / `encodeSessionIdSegment` 复刻安装包
 * dsh-session-persistence-jsonl@0.2.0-rc.2 的 `projectKey` / `encodeSegment`
 * 结构（探针实证与真实后端 materialize 路径逐字一致；漂移由
 * tests/migrator.test.ts 的真实后端比对用例守卫）。
 */
import type { DshSessionHeader, SessionId, SessionScanEntry } from '../types/seam.js'

/** 单个迁移计划项：执行层据此执行，跳过项带机器可读 reason。 */
export type MigrationPlanItem =
  | {
      readonly kind: 'migrate'
      readonly sessionId: SessionId
      readonly header: DshSessionHeader
      /** 原 cwd（= header.cwd，重写基准与回滚目标目录推导键）。 */
      readonly fromCwd: string
      /** 目标 cwd（= 所属项目根，header 重写值与 attach 工作区路径）。 */
      readonly toCwd: string
    }
  | {
      readonly kind: 'skip'
      readonly sessionId: SessionId
      readonly reason: SkipReason
      readonly detail?: string
    }

/** 机器可读跳过原因（tests 与台账消费）。 */
export type SkipReason =
  | 'no-cwd'
  | 'out-of-scope'
  | 'already-grouped'
  | 'already-migrated'
  | 'not-quiet'
  | 'unmaterialized'
  | 'target-conflict'

/** 计划构造输入：扫描快照 + 配置 + 已知外部事实（台账、目标占用）。 */
export interface MigrationPlanInput {
  readonly sessions: readonly SessionScanEntry[]
  readonly projects: readonly string[]
  /** 静默期毫秒数（quietMinutes * 60_000，由调用方换算）。 */
  readonly quietMs: number
  /** 判定「此刻」的 epoch ms（测试显式传入）。 */
  readonly now: number
  /** 台账已登记（migrated/pending-attach 且未回滚）的会话 id。 */
  readonly migratedSessionIds: readonly SessionId[]
  /** 已被目标目录占用（存在产物）的「目标会话目录」键集合：`<mangle(toCwd)>/<encode(id)>`。 */
  readonly occupiedTargetSessionDirs: ReadonlySet<string>
}

/**
 * 路径包含归属判定：`cwd === root` 或 `cwd` 以 `<root>/` 开头。
 * 命中多个项目根取**最长前缀**（防御嵌套配置）。root 先剥尾随 `/` 再比较
 * （`/root/fenixd/` 与 `/root/fenixd` 同根）。返回 null = 不在任何根树内。
 */
export function resolveProjectRoot(cwd: string | undefined, projects: readonly string[]): string | null {
  if (cwd === undefined) return null
  let best: string | null = null
  for (const project of projects) {
    const root = stripTrailingSlash(project)
    if (root.length === 0) continue
    if (cwd === root || cwd.startsWith(`${root}/`)) {
      if (best === null || root.length > stripTrailingSlash(best).length) best = root
    }
  }
  return best
}

/** mangled 项目目录名（复刻 projectKey：分隔符折叠为 `-`、`~XXXX` 转义、`--key--` 包裹）。 */
export function mangleProjectDirName(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 会话 id 的路径安全段（复刻 encodeSegment：`~` 与非法字符 `~XXXX` 转义）。 */
export function encodeSessionIdSegment(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/** 会话 id 在目标 cwd 下的会话目录键（mangled 项目目录 / 会话段；执行层再拼 root）。 */
export function targetSessionDirKey(cwd: string, sessionId: SessionId): string {
  return `${mangleProjectDirName(cwd)}/${encodeSessionIdSegment(sessionId)}`
}

/**
 * 会话自身当前所在目录键（从产物路径 `<root>/<projectKey>/<sessionDir>/<file>`
 * 回推末两段；产物路径缺失时 undefined）。
 */
export function sessionDirKeyOf(artifactPath: string | undefined): string | undefined {
  if (artifactPath === undefined) return undefined
  const segs = artifactPath.split('/')
  const projectKey = segs.at(-3)
  const sessionSeg = segs.at(-2)
  if (projectKey === undefined || sessionSeg === undefined || projectKey.length === 0 || sessionSeg.length === 0) {
    return undefined
  }
  return `${projectKey}/${sessionSeg}`
}

/**
 * 迁移计划构造：逐会话判定 → migrate 项或带机器可读 reason 的 skip 项。
 * 判定顺序（先廉价后昂贵，短路返回首个命中原因）：
 * 1. `no-cwd`：header 无 cwd；
 * 2. `already-migrated`：台账已登记（幂等去重，恰迁移一次）；
 * 3. `already-grouped`：已归入任意工作区；
 * 4. `out-of-scope`：cwd 不在任何项目根树内（根直属 cwd === root 亦属树内）；
 * 5. `unmaterialized`：无当前产物（进程内未物化的在飞会话）；
 * 6. `not-quiet`：产物 mtime 距今不足静默期（在飞保护）；
 * 7. `target-conflict`：目标会话目录已有产物（双方产物保持原状）。
 */
export function buildMigrationPlan(input: MigrationPlanInput): readonly MigrationPlanItem[] {
  const migrated = new Set(input.migratedSessionIds)
  const items: MigrationPlanItem[] = []
  for (const entry of input.sessions) {
    const item = planOne(entry, input, migrated)
    if (item !== undefined) items.push(item)
  }
  return items
}

function planOne(
  entry: SessionScanEntry,
  input: MigrationPlanInput,
  migrated: ReadonlySet<SessionId>,
): MigrationPlanItem {
  const header = entry.header
  if (header.cwd === undefined) {
    return { kind: 'skip', sessionId: entry.id, reason: 'no-cwd' }
  }
  if (migrated.has(entry.id)) {
    return { kind: 'skip', sessionId: entry.id, reason: 'already-migrated' }
  }
  if (entry.groupedPath !== null) {
    return { kind: 'skip', sessionId: entry.id, reason: 'already-grouped' }
  }
  const root = resolveProjectRoot(header.cwd, input.projects)
  if (root === null) {
    return { kind: 'skip', sessionId: entry.id, reason: 'out-of-scope', detail: `cwd '${header.cwd}' 不在任何项目根树内` }
  }
  if (entry.artifactPath === undefined) {
    return { kind: 'skip', sessionId: entry.id, reason: 'unmaterialized' }
  }
  if (entry.artifactMtimeMs === undefined || input.now - entry.artifactMtimeMs < input.quietMs) {
    return {
      kind: 'skip',
      sessionId: entry.id,
      reason: 'not-quiet',
      detail: entry.artifactMtimeMs === undefined ? '产物 mtime 不可判定' : `静默期不足（距今 ${input.now - entry.artifactMtimeMs}ms < ${input.quietMs}ms）`,
    }
  }
  const targetKey = targetSessionDirKey(root, entry.id)
  // 目标冲突：目标目录已有产物，且**不是**该会话自身的现位（根直属会话的
  // 产物就在目标位 = 归位幂等的 attach-only 形态，不算冲突）。
  const ownKey = sessionDirKeyOf(entry.artifactPath)
  if (targetKey !== ownKey && input.occupiedTargetSessionDirs.has(targetKey)) {
    return {
      kind: 'skip',
      sessionId: entry.id,
      reason: 'target-conflict',
      detail: `目标会话目录已存在他占产物：${targetKey}`,
    }
  }
  return { kind: 'migrate', sessionId: entry.id, header, fromCwd: header.cwd, toCwd: root }
}

/** 剥尾随 `/`（根路径 `/` 剥成空串的调用方自行保证不传根分隔符）。 */
function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
