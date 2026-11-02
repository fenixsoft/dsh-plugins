/**
 * 扫描层：项目工作区幂等注册、未归组会话集合扫描、mtime 静默期过滤。
 *
 * 全部经官方服务缝消费（`ctx.workspaceRegistry` / `ctx.sessionPersistence`），
 * 不手写会话产物解析；产物 mtime 经 `resolveCurrentLog` 定位后由文件系统
 * stat 提供（stat 不属产物内容解析）。
 */
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DshSessionPersistence, DshWorkspaceRegistry, SessionScanEntry, SessionId } from '../types/seam.js'

/** 扫描层对日志的窄接口（插件体注入，测试可桩）。 */
export interface ScanLogger {
  warn(message: string): void
}

/**
 * 项目工作区幂等注册：逐根 `workspaceRegistry.create(root, basename(root))`
 * （官方语义：同 canonical 路径复用既有记录、不改 title）。单根失败（目录
 * 不存在等）记录警告并跳过，MUST NOT 中断其余根。
 * @returns 成功注册（含幂等复用）的项目根列表。
 */
export async function ensureProjectWorkspaces(
  registry: DshWorkspaceRegistry,
  projects: readonly string[],
  log: ScanLogger,
): Promise<readonly string[]> {
  const ensured: string[] = []
  for (const root of projects) {
    try {
      await registry.create(root, basename(root) || root)
      ensured.push(root)
    } catch (error) {
      log.warn(`fenix-dsh-session-grouper: 项目根 '${root}' 注册失败，跳过（其余项目根不受影响）：${errorMessage(error)}`)
    }
  }
  return ensured
}

/**
 * 未归组会话集合扫描：`sessionPersistence.list()` 全量快照 × 工作区账目，
 * 逐会话产出扫描行（header / 产物路径 / 产物 mtime / 归组态）。
 * 归组态判定 = 会话 id 出现在任一工作区实体的 sessionIds 投影中。
 * 单会话失败不中断整轮：该会话产出 `artifactPath: undefined` 的行，由计划层
 * 以 unmaterialized/not-quiet 口径保守跳过。
 */
export async function scanSessions(
  persistence: DshSessionPersistence,
  registry: DshWorkspaceRegistry,
): Promise<readonly SessionScanEntry[]> {
  const [snapshots, groupedIds] = await Promise.all([persistence.list(), collectGroupedSessionIds(registry)])
  const entries: SessionScanEntry[] = []
  for (const snapshot of snapshots) {
    const id = snapshot.header.id
    const grouped = groupedIds.has(id)
    const groupedPath = grouped ? (registry.sessionPaths?.get(id) ?? '(已归组)') : null
    entries.push(await toScanEntry(persistence, snapshot.header, groupedPath))
  }
  return entries
}

/** 已归入任意工作区的会话 id 集合（sessionIds 投影已按 canonical cwd 过滤）。 */
async function collectGroupedSessionIds(registry: DshWorkspaceRegistry): Promise<Set<SessionId>> {
  const grouped = new Set<SessionId>()
  for (const workspace of registry.list()) {
    for (const id of workspace.sessionIds) grouped.add(id)
  }
  return grouped
}

async function toScanEntry(
  persistence: DshSessionPersistence,
  header: SessionScanEntry['header'],
  groupedPath: string | null,
): Promise<SessionScanEntry> {
  const id = header.id
  try {
    const artifactPath = await persistence.resolveCurrentLog?.(id)
    if (artifactPath === undefined) {
      return { id, header, groupedPath, artifactPath: undefined }
    }
    const info = await stat(artifactPath)
    return {
      id,
      header,
      artifactPath,
      artifactMtimeMs: info.mtimeMs,
      groupedPath,
    }
  } catch {
    // 产物定位/stat 失败：保守按「不可判定」处理（计划层跳过），不中断整轮。
    return { id, header, artifactPath: undefined, groupedPath }
  }
}

/** 错误消息提取（Error.message 或 String 形态）。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
