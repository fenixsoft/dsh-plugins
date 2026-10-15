## Why

fenix 工作流的 8 个 skill（fenix-new / fenix-setup / fenix-status / fenix-process / fenix-ready / fenix-approve / fenix-archive / fenix-dashboard，真身在 `/root/fenixd/skills/`，`~/.claude/skills/fenix-*` 多为指向它们的软链，`fenix-ready` 为真目录）目前只能在 Claude Code 侧使用。dsh web 原生 skill 体系的磁盘扫描根不含 `~/.claude/skills`，这些 skill 对 dsh web 完全不可见——用户无法在 dsh web 输入框按 "/" 直接调起 fenix 命令。需要一个 dsh 插件把外部 Claude 风格 skill 目录自动注册进 dsh，使 fenix 工作流在 dsh web 会话中可用。

## What Changes

- 新增 dsh 插件 `fenix-skill-provider`（**仅 host 半**，零 client 代码）：装载时经 `ctx.skills.registerProvider(...)` 注册一个 skill provider，动态扫描可配置来源目录下匹配通配模式的 skill 目录，解析各 `SKILL.md` frontmatter 后注册为 skill。
- dsh web 输入框按 "/" 即出现注册的 skill 条目（如 `/fenix-new`）；点选后按 dsh 原生 skill 语义发送 `/名字` 字面文本并由 host 注入 SKILL.md 正文——本插件不新增任何 UI。
- 自动同步：provider `list()` 每次动态扫描来源目录，`fs.watch` 监听目录变化经 `control.invalidate()` 失效注册表缓存——来源目录内新增/移除匹配 skill 无需重启 dsh web 即反映到 "/" 菜单。
- 插件 config 两键：`sourceDir`（默认 `~/.claude/skills`）、`pattern`（默认 `fenix-*`），经 cordis.patch.yml loader 行可覆盖。
- 容错：来源目录缺失、条目非法（缺 SKILL.md / frontmatter 缺 name 或 description / 名字不符 skill 命名语法 / 同名冲突）一律跳过并留日志，不影响 dsh web 其余功能。
- 新增安装与真机验收文档（对齐 cc-import / fenix-dsh-dashboard-bridge 先例）。

## Capabilities

### New Capabilities

- `fenix-skill-provider`: 把外部 Claude 风格 skill 目录（来源目录 + 通配模式可配置）动态注册进 dsh web 原生 skill 体系的能力——覆盖来源扫描与注册规则、"/" 菜单可见与点选注入、来源目录变化自动同步、config 覆盖、容错降级。

### Modified Capabilities

（无：`spec/changes/` 与 `spec/archive/` 下既有能力均不涉及 skill 注册，本能力为纯新增。）

## Impact

- 新增插件目录 `fenix-skill-provider/`（package.json / tsdown / tsconfig / src/host / src/shared / tests / README.zh.md），对齐 fenix-dsh-dashboard-bridge 先例的包结构与构建链（pnpm + tsdown + vitest）。
- 类型依赖：`@deepseek-ai/dsh-skill`（devDep，供 `ctx.skills` 类型增强与 SkillCandidate/Definition 类型）；运行时 `ctx.skills` 服务由 dsh host 提供，构建 external 不打包。`@deepseek-ai/cordis` 为 peer（~4.0.4，对齐先例）。
- 运行环境：安装在 `/root/.dsh/profiles/web/` profile（pnpm add link + cordis.patch.yml `- insert:` loader 条目 + 重启），这些人工步骤记录于 `docs/help/`，不由实现 Agent 执行。
- 不修改既有插件（cc-import、fenix-dsh-dashboard-bridge）、不修改 dsh 本体与其余路由行为。
- dsh 版本钉版 0.2.0-rc.2（与仓库既有插件同一兼容表口径；skill registry / provider 契约属该版 API 面）。
