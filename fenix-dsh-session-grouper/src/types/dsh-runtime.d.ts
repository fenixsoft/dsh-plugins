/**
 * dsh 运行时类型缝（ambient declarations + 探针结论注释）。
 *
 * 真相源：本机安装包 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
 * 下 `dsh-session-persistence-jsonl`、`dsh-session`、`dsh-session-persistence`、
 * `dsh-workspace` 的 `lib/` 与 `lib/types/*.d.ts`（0.2.0-rc.2，探针日期 2026-11-02）。
 * 本插件对这些包**零静态导入**（构建产物无任何 dsh 包引用；唯一例外为回滚 CLI
 * 的 JSONL 后端装配，声明见文末），运行时经 `ctx.sessionPersistence` /
 * `ctx.workspaceRegistry` 服务缝鸭子类型消费；结构类型面见 `src/types/seam.ts`。
 *
 * ── 探针结论（四件事） ─────────────────────────────────────────────
 *
 * 1. 会话 header 的读写句柄（native session handles）
 *    - `ctx.sessionPersistence`：`SessionPersistence` 服务（JSONL 后端类
 *      `JsonlSessionPersistence`，实例 `name === 'session-persistence-jsonl'`）。
 *      `open(id, 'read'|'write')` → `SessionHandle`：`{ id, header, access,
 *      inheritedEventCount, read(offset?, length?), append(events), flush(),
 *      close() }`。header 在句柄层不可变（fixed at create/open）。
 *    - `.jsonl.zstd` 形态：per-session 目录内 immutable generation 文件
 *      `session.vN.jsonl.zstd`（v0 名为 `session.jsonl`），首帧 = header 行
 *      （JSON + '\n' 的 zstd 帧），后续帧 = 事件行批。压缩帧结构由包内代码
 *      处理（本插件 MUST NOT 手写解析）。
 *    - `stat(id)` → `{ header, revision, eventCount?, sizeBytes? }`；
 *      `revision` 为后端自有的可比对字符串 token（fileRevision：
 *      `dev:ino:size:mtimeNs:ctimeNs`），同源实例内相等即可视为未变。
 *
 * 2. 产物目录命名（mangled cwd）与归位语义
 *    - 目录布局：`<root>/<projectKey(cwd)>/<encodeSegment(id)>/session.vN.jsonl.zstd`。
 *      `projectKey(cwd)`：`/` `\` `:` 连续段折叠为单个 `-`；`[A-Za-z0-9._-]` 保留
 *      （`~` 除外）；其余字符 `~XXXX` 大写十六进制转义；结果剥前导 `-`、截 251、
 *      空则 `root`，包成 `--<key>--`。`cwd` 缺省归 `<root>/_no-cwd`。
 *      （本插件 `src/shared/rules.ts` 复刻同构纯函数，探针实证与真实后端
 *      materialize 路径逐字一致；漂移由 tests/migrator.test.ts 守卫用例盯防。）
 *    - 归位语义：`assertStoredIdentity` 要求产物路径 ===
 *      `generationLogPath(root, header.cwd, id, version, compression)`——
 *      header cwd 与产物所在目录必须一致；`findLog` 跨全部 project 目录按 id
 *      搜索，**同 id 出现于两个目录即抛 duplicate 错**。因此迁移 = 以新 header
 *      物化新产物 → 校验 → 删除旧会话目录，顺序不可颠倒。
 *
 * 3. 写安全 / 修订校验可用面
 *    - 写句柄 = 跨进程内核写锁（session 目录内 `session.lock` 的 flock；持锁
 *      至 close，进程死亡内核释放）+ 进程内单写者声明；第二个 `open(id,'write')`
 *      抛 `SessionAlreadyOwnedError`。
 *    - 重写路径（包内公开方法）：`persistBatch(header, events,
 *      isMaterialized=false, inheritedEventCount)` / `persistHeader(header,
 *      inheritedEventCount)` 以传入 header 的 cwd 推导目标路径物化「header 行 +
 *      事件」，目标已有 generation 即拒绝（"refusing to materialize ... a log
 *      already exists on disk"）——天然构成目标冲突检测，MUST NOT 覆盖。
 *    - 写前修订校验：迁移前后各 `stat()` 一次，revision 不等即拒绝本轮
 *      （源在准备期间被改写）。
 *
 * 4. `ctx.workspaceRegistry` 服务签名
 *    - `create(path, title?)` → `Workspace`：幂等（同 canonical 路径复用既有
 *      记录、不改 title）；`realpathNormalize` 规范化，路径不存在/非目录抛错。
 *      新建记录 title 取传入值（缺省路径末段）。
 *    - 归组门（`WorkspaceEntity.attachSession(id)`）：读会话 header（live →
 *      实例 `headers` 缓存 → persistence 全量重索引）→ `realpathNormalize`
 *      (header.cwd) 必须**严格等于** workspace 记录的 canonical path，且该
 *      目录必须存在；成功后 `rememberSessionPath` 修正实例索引。
 *    - 实例私有映射表（运行时可校正的普通属性，非 `#` 私有字段）：
 *      `headers: Map<id, SessionHeader>`（header 索引）、`sessionPaths: Map<id,
 *      canonicalPath>`（canonical cwd 索引）、`invalidSessionPaths: Map<id,
 *      reason>`。数据重写后 `headers` 缓存陈旧会使 attach 以旧 cwd 校验而失败
 *      ——迁移后 MUST 按新 header 更新 `headers`/`sessionPaths`（缺失/非 Map
 *      形态 → 走台账 pending-attach 兜底，下次 dsh-web 重启全量重索引收敛）。
 *
 * 已确证的缓存语义（文档「实现笔记」同步项）：`sessionPersistence.list()` 无
 * 实例级陈旧缓存（每轮全量目录扫描）；句柄读路径的冷读 LRU（`coldLogMemo`）
 * 以 stat 修订为护栏，外来写入必失配；`workspaceRegistry` 两张映射表有实例级
 * 缓存（见 4）。
 */

declare module '@deepseek-ai/cordis' {
  /** 宿主侧最小 cordis Context 面（本插件触碰的 API）。 */
  export class Context {
    /** 注册一个随插件 fiber 卸载自动清理的副作用。 */
    effect(fn: () => void | (() => void | Promise<void>), label?: string): void
    /** 具名日志门面（printf 风格占位符）。 */
    readonly logger: {
      error(format?: unknown, ...params: unknown[]): void
      warn(format?: unknown, ...params: unknown[]): void
      info(format?: unknown, ...params: unknown[]): void
      debug(format?: unknown, ...params: unknown[]): void
    }
    /** 会话持久化服务缝（dsh-session-persistence 提供；未启动/缺失为 undefined）。 */
    readonly sessionPersistence?: import('./seam.js').DshSessionPersistence
    /** 工作区注册表服务缝（dsh-workspace 提供；未启动/缺失为 undefined）。 */
    readonly workspaceRegistry?: import('./seam.js').DshWorkspaceRegistry
  }

  /** cordis Service 基类：子类构造 (ctx, name) 完成服务注册。 */
  export class Service<T = unknown> {
    readonly ctx: Context
    /** 本服务注册在 ctx 下的名字。 */
    name: string
    constructor(ctx: Context, name?: string)
  }
}

declare module '@deepseek-ai/dsh-session-persistence-jsonl' {
  /**
   * JSONL 持久化后端类（回滚 CLI 直接装配用）。Config：`root`（会话文件根）
   * + `compression`（'zstd' 缺省 | 'none'）。独立可装配：`new Context()` +
   * `new JsonlSessionPersistence(ctx, config)`（探针实证）。
   */
  export interface Config {
    readonly root: string
    readonly compression?: 'none' | 'zstd'
  }
  export default class JsonlSessionPersistence {
    constructor(ctx: import('@deepseek-ai/cordis').Context, config: Config)
    readonly name: string
    list(options?: { signal?: AbortSignal }): Promise<readonly import('./seam.js').DshSessionSnapshot[]>
    stat(id: string, options?: { signal?: AbortSignal }): Promise<import('./seam.js').DshSessionSnapshot | undefined>
    open(id: string, access: 'read' | 'write', options?: { signal?: AbortSignal }): Promise<import('./seam.js').DshSessionHandle>
    persistBatch(header: import('./seam.js').DshSessionHeader, events: readonly import('./seam.js').DshSessionEvent[], isMaterialized: boolean, inheritedEventCount: number): Promise<void>
    persistHeader(header: import('./seam.js').DshSessionHeader, inheritedEventCount: number): Promise<void>
    resolveCurrentLog(id: string, signal?: AbortSignal): Promise<string | undefined>
    readStoredLog(path: string, expectedId: string, signal?: AbortSignal): Promise<unknown>
  }
}
