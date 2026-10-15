## Context

dsh 0.2.0-rc.2 原生 skill 体系分三层：`@deepseek-ai/dsh-skill`（注册表服务，`ctx.skills.register / registerProvider / list / get`，provider 契约为 `{ name, list(options) → SkillCandidate[]|Observation, get(candidate, options) → SkillDefinition|undefined }`，配 `SkillProviderControl.invalidate()` 失效缓存并发 `skills/change`）；`@deepseek-ai/dsh-skill-filesystem`（磁盘发现 provider，扫描根按 rank：projectRoot/.dsh/skills(100) → projectRoot/.agents/skills(200) → customSkillDirs(300) → dshHome/skills(400) → agentsHome/skills(500) → bundled(600)，格式 `<name>/SKILL.md` 或顶层平文件）；`@deepseek-ai/dsh-client-ui-skill`（"/" 触发菜单，经 `skills/list` Remote 只取 `userInvocable` skill，点选发送 `/名字` 字面文本、host 注入 `<skill_content>`）。**`~/.claude/skills` 不在任何默认扫描根内**，故 fenix skill 现状对 dsh web 不可见。

fenix skill 侧：7 个 `fenix-*` 目录，真身在 `/root/fenixd/skills/`（fenixd 仓库 install.sh 管理），`/root/.claude/skills/fenix-*` 为指向它们的软链；SKILL.md frontmatter 仅 `name` + `description` 两键，无 `user-invocable` 等可选键。

本仓库插件先例：cc-import（host 半 `TypertRemoteService`）、fenix-dsh-dashboard-bridge（host 半 `Service` + webServer 注入，双入口构建）。本插件仅 host 半，结构对齐后者但无 client 入口。

## Goals / Non-Goals

**Goals:**
- dsh web 输入框按 "/" 能看到并点选来源目录中匹配 pattern 的 skill（默认 7 个 fenix-*）
- 来源目录增删 skill 无需重启 dsh web 自动反映
- 来源目录、匹配范围经 loader config 可配；所有异常路径可观测（warn 日志）且不外溢

**Non-Goals:**
- 不写 client 半、不自定义 "/" 菜单 UI（菜单交互完全复用 dsh 原生 `dsh-client-ui-skill`）
- 不解析/改写 SKILL.md 正文语义，不做 Claude Code → dsh 的指令翻译（SKILL.md 内 `/fenix-*` 等命令引用按原文注入，由 dsh web 会话 agent 按文字指引行动）
- 不替代 `dsh-skill-filesystem`、不触碰其扫描根与 customSkillDirs 配置
- 不提供远程 skill 源（HTTP/git）；仅本地目录

## Decisions

- **D1 仅 host 半，走 registerProvider 而非复用 dsh-skill-filesystem**：filesystem 包扫描根是固定 rank 序的配置面，把 `~/.claude/skills` 塞进去要么改 dsh 全局配置（影响面大、非插件形态），要么 symlink 进扫描根（零自动性）。provider 契约正是为「非默认位置来源」设计（README：when the source of skills is not the local filesystem）；注册表自身负责合并/去重/校验，插件只做「目录 → candidate」一件事。被否方案：零插件 symlink（不符「自动注册」与插件定位，用户已定调走插件路径）；commandUi 命令插件（要写 client 半、与原生 skill 注入并行，工作量大且失去 modelInvocable 语义）。
- **D2 `list()` 每次动态扫描、`get()` 每次读盘，provider 侧不缓存内容**：注册表的 collect 缓存按 revision 失效，`get()` 契约本就「Definitions are never cached——every load asks the provider for the current body」。这样 SKILL.md 内容编辑天然即时生效；目录增删由 D3 失效。locator = SKILL.md 绝对路径，get 按 candidate.locator 读文件，不依赖 list 时的目录状态。
- **D3 `fs.watch(sourceDir)`（非递归）+ 去抖 300ms + `control.invalidate()`**：目录条目增删/改名会触发 watch 事件；invalidate 使 collect 缓存失效并广播 `skills/change`，下次展开菜单即重扫。非递归足够：skill 目录内部文件变化无需实时（D2 已兜底），避免 inotify 递归开销。watch 初始化失败降级为静态注册 + warn（spec 容错条款）。
- **D4 frontmatter 解析：优先复用 `dsh-skill-filesystem` 的导出解析器，不可复用则实现受限键值解析**：fenix SKILL.md frontmatter 仅 `name: <str>` / `description: <str>` 两键的平直 YAML，受限解析覆盖 `name` / `description` / `whenToUse` / `user-invocable` / `disable-model-invocation` / `metadata`（值形态：字符串、布尔、嵌套键值）即可，不引第三方 YAML 依赖。实现时先查 `dsh-skill-filesystem/lib` 是否导出可复用的解析函数（同版 API 面，优先复用以保证与原生语义一致）；仅在其未导出或签名不稳时走自实现。frontmatter 缺失/解析失败按非法条目跳过。
- **D5 rank 取 500（用户级档），source 用 `custom`**：与 dsh-skill-filesystem 的 user 档（agentsHome/skills=500）同量级——外部用户目录语义一致，且保证项目级 skill（rank 100/200）同名单时胜出（「最近层胜出」+ rank 序）。`custom` 是类型面预留的 origin 桶，prompt 可见、语义如实。
- **D6 pattern 仅支持段内 `*` 通配，自实现匹配（`*` → 非分隔符任意序列），无新依赖**：默认 `fenix-*` 与可预见的 `openspec-*` 均是前缀通配；完整 glob 语法（`?`/`[]`/`{}`）显式判非法并在装载期拒绝（spec 有验收场景）。被否方案：引入 picomatch（多一个供应链依赖，收益仅是永远用不到的语法面）。
- **D7 依赖与构建对齐先例**：`@deepseek-ai/cordis` peer（~4.0.4，optional，与两先例一致）；`@deepseek-ai/dsh-skill` 作 devDependency 仅供类型（`ctx.skills` 模块增强、SkillCandidate/Definition/SkillProviderControl 类型），tsdown 构建将其与 cordis 一并 external 不打包；单入口 host ESM（无 `./client` export、无 `dsh.client` 清单键）。运行时 `ctx.skills` 服务由 dsh host 进程提供（dsh-skill 随主进程装载）。
- **D8 重名策略**：注册表已定义跨来源重名的层/rank 胜出规则，插件不做跨来源去重；仅 provider 自身 `list()` 内对解析出的同名 candidate 保留首个并 warn（注册表对同层重名按 rank+注册序裁决，provider 内先行去重让行为可预期）。

## Risks / Trade-offs

- [SKILL.md 是 Claude Code 语境（正文引用 `/fenix-*` 子命令、Claude Code 工具名），dsh web 会话 agent 只能按文字指引行动，部分步骤（如 slash 命令跳转）在 dsh 侧无对应物] → 接受：用户需求即「在 dsh web 调起 fenix 工作流」，fenixd 已有 dsh-bundle 先例证明跨 harness 可行；本插件范围止于「注册与注入」，语义偏差属使用层已知限制，写入 README 兼容表小节。
- [`fs.watch` 平台差异与 inotify 上限] → 降级路径入 spec（静态注册 + warn）；Linux 生产环境（本机）为主场景。
- [受限 frontmatter 解析不支持完整 YAML（如多行折叠、引号转义)] → fenix 系 skill frontmatter 为两键平直结构（已核实 7 个全部如此）；解析失败按非法条目跳过并 warn，不会错注册。若未来来源 skill 用了复杂 YAML，跳过日志会指明原因。
- [dsh-skill provider 契约为 0.2.0-rc.2 钉版 API，升级可能漂移] → 与仓库既有插件同一兼容表规约（README 声明唯一钉版 + 升级全量冒烟）。
- [`~/.claude/skills` 内 20+ 个非 fenix skill 与 pattern 共存] → 默认 pattern `fenix-*` 已过滤；config 可放开但属用户自担行为，README 注明。

## Migration Plan

- 部署（人工，见 docs/help 安装文档）：profile 内 `pnpm add link:<repo>/fenix-skill-provider` → cordis.patch.yml 追加 `- insert: - id: fenix-skill-provider / name: fenix-skill-provider` → 重启 dsh web。
- 回滚：移除 loader 条目并重启——provider 与 watch 随插件 disposer 注销，"/" 菜单恢复原状，无数据/状态残留（插件无持久化）。

## Open Questions

（无——实现路径、来源范围、执行模式与时机均已经用户确认；frontmatter 解析器的复用与否在 D4 内给出判定规则，实现 Agent 可自行决策，无需返询。）
