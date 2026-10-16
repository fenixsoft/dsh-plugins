# fenix-skill-provider

把外部 Claude 风格 skill 目录（默认 `~/.claude/skills` 下 `fenix-*`）自动注册进 dsh web 原生 skill 体系：dsh web 输入框按 "/" 即见 `/fenix-new` 等条目，点选或手打 `/名字` 后由 dsh 原生机制注入 SKILL.md 正文。来源目录内新增/移除匹配 skill 无需重启 dsh web，数秒内自动反映到 "/" 菜单。

## 插件形态

dsh 0.2.0-rc.2 插件（对齐 `fenix-dsh-dashboard-bridge` 先例），**仅 host 半，零 client 代码**：

- **Host 半**（`src/host/`，`lib/index.js`，Node ESM）：cordis 插件类，装载时经
  `ctx.skills.registerProvider(...)` 注册名为 `fenix-skill-provider` 的 skill
  provider，把来源目录（默认 `~/.claude/skills`，即 Claude Code 用户级 skill
  目录——该目录不在 `dsh-skill-filesystem` 的任何默认扫描根内，故需本插件桥接）
  中匹配 pattern 的条目注册为 dsh skill。
- **无 client 半**："/" 菜单交互完全复用 dsh 原生 `dsh-client-ui-skill`
  （"/" 触发 → `skills/list` 取 `userInvocable` 条目 → 点选发送 `/名字` 字面文本
  → host 注入 `<skill_content>`），本插件不新增任何 UI、不侵入该链路。

## 机制

```
装载 → resolveProviderConfig（sourceDir / pattern，非法 pattern 拒绝装载）
     → ctx.skills.registerProvider(control => provider)
        ├─ list(options)：每次动态扫描 sourceDir（readdir withFileTypes →
        │   目录及指向目录的 symlink 且名字匹配 pattern → 读 <dir>/SKILL.md →
        │   受限 frontmatter 解析 → SkillCandidate）；abort 时尽早 settle 返回
        │   complete:false 观察；来源目录缺失返回空集 + warn
        ├─ get(candidate)：按 candidate.locator 读盘 → 剥 frontmatter →
        │   SkillDefinition（元数据与 candidate 一致）；文件已删除返回 undefined；
        │   每次读盘 = SKILL.md 正文编辑天然即时生效（元数据变更需重启，见已知限制）
        └─ fs.watch(sourceDir)（非递归）→ 事件 300ms 去抖 → control.invalidate()
            （失效注册表 collect 缓存并广播 skills/change）→ 下次展开 "/" 菜单重扫
```

- **candidate rank 取 500**（用户级档，与 `dsh-skill-filesystem` 的
  agentsHome/skills 同量级）：项目级 skill（rank 100/200）同名单时胜出；
  `source` 为 `custom`。
- **frontmatter 解析**：`dsh-skill-filesystem` 0.2.0-rc.2 未导出解析器（仅导出
  `Config / FileSystemSkillProvider / apply / inject / name`），故实现受限键值
  自解析（见「已知限制」）。
- **容错**：来源目录缺失/不可读 → 装载成功、`list()` 空集 + warn；`fs.watch`
  初始化失败（inotify 上限、平台不支持等）→ 降级为「重启后生效」的静态注册 +
  warn；单条目非法（缺 SKILL.md / frontmatter 解析失败 / 缺 name 或 description
  / 名字非 kebab-case / I/O 错误）→ 跳过该条目并 warn（含目录名与原因），互不
  影响、不让 `list()` 整体 reject；同 provider 内重名保留首个（目录序靠前）+ warn。
- **生命周期**：watch 随 provider registration 的 `control.signal` abort 注销，
  provider 随 fiber 卸载自动注销；插件无持久化，卸载 loader 条目重启即恢复原状。

## 配置键（loader 行 config，可省略）

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `sourceDir` | `~/.claude/skills` | skill 来源目录；接受绝对路径与 `~` 前缀路径（`~` 按 `os.homedir()` 展开），统一归一为绝对路径 |
| `pattern` | `fenix-*` | 目录名匹配模式；仅支持段内 `*` 通配（`*` → 不含 `/` 的任意序列，全串锚定）；含 `?` `[` `]` `{` `}` `\` 或 `/` 时**拒绝装载**并输出含键名的可读错误 |

loader 行示例：

```yaml
- insert:
    - id: fenix-skill-provider
      name: fenix-skill-provider
      # config 可整体省略（取上方默认值）；覆盖示例：
      # config:
      #   sourceDir: /root/fenixd/skills
      #   pattern: openspec-*
```

（注意 dsh patch 语义要求 `- insert:` 容器键，裸写 `- id:/name:` 列表项会被
静默跳过，见安装文档。）

## 已知限制

- **SKILL.md 为 Claude Code 语境原文注入**：正文引用的 `/fenix-*` 子命令、
  Claude Code 工具名按原文进入 dsh web 会话，会话 agent 只能按文字指引行动，
  部分步骤（如 slash 命令跳转）在 dsh 侧无对应物——范围止于「注册与注入」，
  语义偏差属使用层已知限制。
- **frontmatter 受限解析**：仅支持平直键值——`name` / `description` /
  `whenToUse`（字符串）、`user-invocable` / `disable-model-invocation`
  （布尔）、`metadata`（扁平键值）；不支持完整 YAML（多行折叠、引号转义、
  列表、深嵌套）。围栏缺失或结构不可解析按非法条目跳过并 warn。fenix 系
  skill frontmatter 为两键平直结构（已核实），默认来源全部可用。
- **pattern 仅段内 `*`**：不支持 `?` / `[]` / `{}` 等完整 glob 语法（装载期
  显式拒绝），不支持跨段匹配。
- **skill 名取自 frontmatter `name`** 而非目录名（目录名只用于 pattern 匹配）；
  名字须符 dsh-skill 命名语法（kebab-case）。
- **目录内文件变化无实时性**：`fs.watch` 非递归，仅监听来源目录一层条目增删/
  改名，不覆盖 skill 子目录内部；SKILL.md 正文编辑经 `get()` 每次读盘即时
  生效，但 name/description/invocation 等列表元数据来自 `list()` 的 candidate，
  注册表在两次 invalidate 之间缓存——就地编辑既有 skill 的 SKILL.md 元数据
  不触发失效，需重启宿主（或增删/改名条目触发 watch）后才生效。

## dsh 版本兼容表

| dsh 版本 | 兼容性 | 说明 |
| --- | --- | --- |
| 0.2.0-rc.2 | ✅ 唯一钉版 | 开发与验收基线（`ctx.skills.registerProvider` / SkillCandidate/Definition/SkillProviderControl 契约属该版 API 面） |
| 其它/升级 | ⚠️ 须同步重测 | provider 契约可能漂移；升级流程与 `dsh-bundle` 同规约：重装 peer（`@deepseek-ai/cordis ~4.0.4`）+ 全量冒烟（安装文档的真机验收清单） |

## 构建与测试

```sh
cd fenix-skill-provider
pnpm install && pnpm typecheck && pnpm build && pnpm test
```

- 构建：tsdown 单入口 host ESM → `lib/index.js`（`@deepseek-ai/cordis` 与
  `@deepseek-ai/dsh-skill` external：前者运行时随宿主解析，后者仅供类型
  ——`import type` 构建期擦除，运行时 `ctx.skills` 服务由 dsh host 提供）。
- 测试：vitest（35 例）——providerConfig（默认值 / `~` 展开 / 非法 pattern）、
  scanner（临时夹具目录：symlink / 平文件重名 / 非法条目族 / pattern 过滤 /
  I/O contained）、provider（mock host：list 空集 / get 剥离与 undefined /
  fake timers 去抖 invalidate / watch 降级）。
- 安装与真机验收：见 `docs/help/fenix-skill-provider-install.md`（人工步骤，
  不由实现 Agent 执行）。
