
/** 会话 id（安装包为品牌字符串；此处按字符串消费）。 */
export type SessionId = string

/** 会话持久化 header 的被消费面（安装包 SessionHeader 结构子集）。 */
export interface DshSessionHeader {
  readonly version: number
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
}

/** 事件（迁移只整块搬运，不解释内容）。 */
export interface DshSessionEvent {
  readonly seq: number
  readonly type: string
  readonly [key: string]: unknown
}

/** stat/list 快照的被消费面。 */
export interface DshSessionSnapshot {
  readonly header: DshSessionHeader
  readonly revision: string
  readonly eventCount?: number
  readonly sizeBytes?: number
}

/** 会话句柄的被消费面（读全量 + 关闭；写经后端 persistBatch 通道而非句柄 append）。 */
export interface DshSessionHandle {
  readonly id: SessionId
  readonly header: DshSessionHeader
  readonly access: 'read' | 'write'
  readonly inheritedEventCount: number
  read(offset?: number, length?: number): Promise<{ events: readonly DshSessionEvent[] }>
  close(): Promise<void>
}

/** `ctx.sessionPersistence` 服务缝的被消费面。 */
export interface DshSessionPersistence {
  /** 后端标签：JSONL 后端实例为 'session-persistence-jsonl'。 */
  readonly name?: string
  list(options?: { signal?: AbortSignal }): Promise<readonly DshSessionSnapshot[]>
  stat(id: SessionId, options?: { signal?: AbortSignal }): Promise<DshSessionSnapshot | undefined>
  open(id: SessionId, access: 'read' | 'write', options?: { signal?: AbortSignal }): Promise<DshSessionHandle>
  /** 重写通道：以传入 header 的 cwd 推导目标路径物化 header+事件（目标已存在即拒绝）。 */
  persistBatch?(header: DshSessionHeader, events: readonly DshSessionEvent[], isMaterialized: boolean, inheritedEventCount: number): Promise<void>
  persistHeader?(header: DshSessionHeader, inheritedEventCount: number): Promise<void>
  /** 当前 generation 产物路径（跨 project 目录按 id 搜索；duplicate 即抛错）。 */
  resolveCurrentLog?(id: SessionId, signal?: AbortSignal): Promise<string | undefined>
  /** 读取并校验指定路径的存储 log（identity 校验含 header.cwd 与路径一致性）。 */
  readStoredLog?(path: string, expectedId: SessionId, signal?: AbortSignal): Promise<unknown>
}

/** 工作区实体的被消费面。 */
export interface DshWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly SessionId[]
  attachSession(sessionId: SessionId): Promise<void>
}

/** `ctx.workspaceRegistry` 服务缝的被消费面。 */
export interface DshWorkspaceRegistry {
  create(path: string, title?: string): Promise<DshWorkspace>
  list(): DshWorkspace[]
  /** 实例 header 索引（探针确认：普通 Map 属性，运行时可校正）。 */
  headers?: Map<SessionId, DshSessionHeader>
  /** 实例 canonical cwd 索引（同上）。 */
  sessionPaths?: Map<SessionId, string>
  invalidSessionPaths?: Map<SessionId, string>
}

/** 事件快照 + 归组态的扫描行（本插件扫描层产物）。 */
export interface SessionScanEntry {
  readonly id: SessionId
  readonly header: DshSessionHeader
  /** 该会话当前产物路径；undefined = 未物化/仅历史 generation。 */
  readonly artifactPath?: string
  /** 产物目录 mtime（epoch ms）；undefined = 不可判定（按未静默处理）。 */
  readonly artifactMtimeMs?: number
  /** 已归入的工作区 canonical path；null = 未归组。 */
  readonly groupedPath: string | null
}
