## ADDED Requirements

### Requirement: 来源目录扫描与 skill 注册
插件装载时 SHALL 经 `ctx.skills.registerProvider(...)` 注册名为 `fenix-skill-provider` 的 skill provider；该 provider SHALL 扫描 config `sourceDir`（默认 `~/.claude/skills`，支持 `~` 展开为绝对路径）下名字匹配 config `pattern`（默认 `fenix-*`）的**目录**条目（含指向目录的符号链接），并对每个含 `SKILL.md` 的目录产出恰好一个 skill candidate。candidate SHALL 满足：`name` 与 `description` 取自 SKILL.md frontmatter；`invocation` 缺省为 `{ modelInvocable: true, userInvocable: true }`，frontmatter 显式声明时 SHALL 尊重（`user-invocable: false` → `userInvocable: false`；`disable-model-invocation: true` → `modelInvocable: false`）；`source` 为 `custom`；`resourceBase` 为 `{ kind: 'directory', path: <该 skill 目录绝对路径> }`；`locator` 指向该 SKILL.md 绝对路径；`rank` 取用户级量级（不得高于项目级扫描根 `dsh-skill-filesystem` 的 project 档 rank）。

#### Scenario: 默认配置注册 fenix skill
- **WHEN** 以默认 config（sourceDir=`~/.claude/skills`、pattern=`fenix-*`）装载插件，且来源目录下存在 8 个 `fenix-*` skill 目录（各含合法 SKILL.md）
- **THEN** provider `list()` 恰好返回 8 个 candidate，name 与来源目录名一一对应，description 与各 frontmatter 一致，`invocation` 均为 `{ modelInvocable: true, userInvocable: true }`，dsh web "/" 菜单出现全部 8 个 `fenix-*` 条目

#### Scenario: pattern 过滤不匹配条目
- **WHEN** 来源目录下同时存在 `fenix-new/` 与 `anysearch/`（后者含合法 SKILL.md），pattern 为默认 `fenix-*`
- **THEN** provider `list()` 只返回 `fenix-*` 匹配项，`anysearch` 不产生 candidate

#### Scenario: 非法条目跳过且互不影响
- **WHEN** 来源目录下某匹配目录缺 `SKILL.md`，另一匹配目录 frontmatter 缺 `name`，再一匹配目录 name 不符 dsh skill 命名语法（非 kebab-case），另有一合法 `fenix-new/`
- **THEN** 三个非法目录各自被跳过且日志各留一条 warn（含目录名与跳过原因），`fenix-new` 正常注册，插件不抛未处理异常

#### Scenario: 同 provider 内重名取首个
- **WHEN** 来源目录下存在两个匹配 pattern 的条目解析出相同 skill `name`（如 `fenix-x/` 与 `fenix-x.md` 平文件同名，或软链与真目录并存）
- **THEN** provider `list()` 只产出其中一个 candidate（取目录序靠前/首个），日志留一条 warn，不因重名抛错

### Requirement: 点选后按原生语义注入 skill 正文
对已注册的每个 skill，provider `get(candidate)` SHALL 读取该 candidate `locator` 指向的 SKILL.md，剥离 frontmatter 后以 `content` 字段返回 `SkillDefinition`（其余元数据字段与 candidate 一致）；文件已不存在或不可读时 SHALL 返回 `undefined`。dsh web 侧 "/" 菜单点选或手打 `/名字` 后由 dsh 原生机制发送字面文本并由 host 注入 `<skill_content>`——本插件 MUST NOT 侵入该链路，MUST NOT 新增 client 半代码或自定义菜单 UI。

#### Scenario: 菜单点选 fenix-new 注入正文
- **WHEN** 用户在 dsh web 输入框按 "/" 并点选 `fenix-new` 条目
- **THEN** 会话发送 `/fenix-new` 字面文本，host 注入的 skill 内容为该 SKILL.md 剥离 frontmatter 后的 Markdown 正文（无 frontmatter 残留）

#### Scenario: get 对已删除文件返回 undefined
- **WHEN** 某 candidate 已列入目录但其 SKILL.md 文件在 get 前被删除
- **THEN** `get()` 返回 `undefined`，不抛异常

### Requirement: 来源目录变化自动同步
provider SHALL 监听 `sourceDir` 目录变更（`fs.watch` 或等价机制）：监听事件经去抖（≥200ms 窗口）后调用注册时获得的 `control.invalidate()`，使注册表缓存失效并触发 `skills/change`。目录条目新增、删除、改名（进入或离开 pattern 匹配集）SHALL 在下次 catalog 读取时反映，无需重启 dsh web。对目录内 SKILL.md 内容编辑无实时性要求（`get()` 每次读盘，天然最新）。

#### Scenario: 新增 skill 自动出现
- **WHEN** 插件已装载且 "/" 菜单已展示 8 个 fenix 条目，随后在来源目录新建匹配 pattern 的 `fenix-demo/SKILL.md`（合法 frontmatter），数秒后在 dsh web 重新展开 "/" 菜单
- **THEN** 菜单出现 `fenix-demo` 条目（无需重启 dsh web）

#### Scenario: 移除 skill 自动消失
- **WHEN** 将来源目录下 `fenix-demo/` 删除（或改名为不匹配 pattern），数秒后重新展开 "/" 菜单
- **THEN** `fenix-demo` 条目消失，其余 8 条不受影响

### Requirement: config 可覆盖来源与模式
插件 config SHALL 支持两键并均有代码默认值：`sourceDir`（默认 `~/.claude/skills`；接受绝对路径与 `~` 起始路径）与 `pattern`（默认 `fenix-*`；仅支持段内 `*` 通配符语义，含其它 glob 元字符（如 `?`、`[`、`{`）时 MUST 在装载期给出可读错误并拒绝装载）。两键经 cordis.patch.yml loader 行 `config:` 覆盖。

#### Scenario: loader 行覆盖 pattern
- **WHEN** loader 条目 config 写 `pattern: openspec-*` 并重启 dsh web，来源目录存在 `openspec-propose/` 与 `fenix-new/`
- **THEN** "/" 菜单出现 `openspec-propose` 而不出现 `fenix-new`

#### Scenario: sourceDir 指向其它目录
- **WHEN** loader 条目 config 写 `sourceDir: /root/fenixd/skills`（pattern 默认）并重启 dsh web
- **THEN** "/" 菜单出现 7 个 fenix 条目，内容与来源目录一致

#### Scenario: 非法 pattern 拒绝装载
- **WHEN** loader 条目 config 写 `pattern: fen[x]-*`
- **THEN** 插件装载失败并输出含该键名与非法原因的可读错误，dsh web 其余功能不受影响

### Requirement: 容错与降级
来源目录不存在或不可读时，插件 SHALL 装载成功、provider `list()` 返回空集并留一条 warn 日志。`fs.watch` 初始化失败（如 inotify 上限、平台不支持）时，插件 SHALL 降级为「重启后生效」的静态注册语义并留一条 warn 日志，MUST NOT 抛未处理异常或影响 dsh web 其余功能。扫描单目录发生的 I/O 错误 SHALL 被包含（跳过该条目并 warn），不得让 `list()` 整体 reject。

#### Scenario: 来源目录缺失
- **WHEN** loader 行 config 写 `sourceDir: /nonexistent/dir` 并重启 dsh web
- **THEN** 插件装载成功、"/" 菜单不出现本插件条目、日志有一条含该路径的 warn，dsh web 会话与设置等其余功能不受影响

#### Scenario: watch 不可用降级
- **WHEN** `fs.watch(sourceDir)` 初始化抛错
- **THEN** 插件仍装载成功且 skill 正常注册，日志有一条 warn 说明自动同步已降级（重启生效），无未处理异常
