## Deliverables

```yaml
- path: fenix-skill-provider/package.json
  kind: new
- path: fenix-skill-provider/pnpm-workspace.yaml
  kind: new
- path: fenix-skill-provider/tsconfig.json
  kind: new
- path: fenix-skill-provider/tsdown.config.ts
  kind: new
- path: fenix-skill-provider/vitest.config.ts
  kind: new
- path: fenix-skill-provider/pnpm-lock.yaml
  kind: new
- path: fenix-skill-provider/src/shared/providerConfig.ts
  kind: new
- path: fenix-skill-provider/src/host/frontmatter.ts
  kind: new
- path: fenix-skill-provider/src/host/scanner.ts
  kind: new
- path: fenix-skill-provider/src/host/index.ts
  kind: new
- path: fenix-skill-provider/tests/providerConfig.test.ts
  kind: new
- path: fenix-skill-provider/tests/scanner.test.ts
  kind: new
- path: fenix-skill-provider/tests/provider.test.ts
  kind: new
- path: fenix-skill-provider/README.zh.md
  kind: new
- path: docs/help/fenix-skill-provider-install.md
  kind: new
```

## 1. 插件包骨架

- [ ] 1.1 创建 `fenix-skill-provider/` 包骨架，对齐 `fenix-dsh-dashboard-bridge/` 先例：`package.json`（`main: lib/index.js`；`exports` 仅 `.` 与 `./package.json`——无 client 入口；无 `dsh.client` 键；`peerDependencies` 仅 `@deepseek-ai/cordis ~4.0.4`（optional）；`devDependencies` 含 `@deepseek-ai/dsh-skill`（类型增强与 SkillCandidate/Definition 类型，版本对齐 dsh 0.2.0-rc.2 内置版）+ `@types/node` + `tsdown` + `typescript` + `vitest`；scripts 对齐先例 build/typecheck/test）；`pnpm-workspace.yaml`（`allowBuilds: esbuild`）；`tsconfig.json`、`tsdown.config.ts`（单入口 host ESM，external `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-skill`）、`vitest.config.ts`；`pnpm install && pnpm typecheck && pnpm build` 在最小占位入口下可过（产出 `lib/index.js`）

## 2. 配置解析

- [ ] 2.1 实现 `src/shared/providerConfig.ts` 的 `resolveProviderConfig(input)`：`sourceDir` 默认 `~/.claude/skills`（`os.homedir()` 拼接；接受绝对路径与 `~` 前缀路径并展开为绝对路径）；`pattern` 默认 `fenix-*`，仅允许段内 `*` 通配，含其它 glob 元字符（`?` `[` `]` `{` `}` `\` 等）时抛含键名与非法原因的可读错误；并把 pattern 编译为正则（`*` → 不含 `/` 的任意序列，全串锚定）供 scanner 复用

## 3. 扫描与 frontmatter 解析

- [ ] 3.1 实现 `src/host/frontmatter.ts`：解析 SKILL.md 顶部 `---` 围栏 frontmatter，按 design D4 先确认 `@deepseek-ai/dsh-skill-filesystem` 是否导出可复用解析器（有则复用），否则受限键值自解析——覆盖 `name`/`description`/`whenToUse`（字符串）、`user-invocable`/`disable-model-invocation`（布尔）、`metadata`（扁平键值）；围栏缺失或解析失败返回 null（调用方按非法条目跳过）
- [ ] 3.2 实现 `src/host/scanner.ts` 的 `scanSkillDir(sourceDir, patternRe, log)`：`readdir(withFileTypes)`，取「目录及指向目录的 symlink」且名字匹配 pattern 的条目，读 `<dir>/SKILL.md` 并经 frontmatter 解析产出 SkillCandidate 数组——`name`/`description`/`whenToUse` 取 frontmatter，`invocation` 缺省 `{modelInvocable: true, userInvocable: true}` 且尊重 `user-invocable: false` / `disable-model-invocation: true`，`source: 'custom'`，`provider: 'fenix-skill-provider'`，`rank: 500`，`locator` 为 SKILL.md 绝对路径，`resourceBase` 为 `{kind:'directory', path: skill 目录绝对路径}`；非法条目（缺 SKILL.md / 解析失败 / 缺 name 或 description / name 非 kebab-case，语法对齐 dsh-skill `isSkillName`）跳过并各留一条含目录名与原因的 warn；同 provider 内重名保留首个并 warn；单条目 I/O 错误 contained（跳过 + warn），不让整体 reject

## 4. Provider 装配

- [ ] 4.1 实现 `src/host/index.ts`：默认导出 cordis 插件类（对齐 bridge 的 `Service` 形态与 loader 行 config 读取模式，经 `resolveProviderConfig` 解析 `sourceDir`/`pattern`；`resolveProviderConfig` 因非法 pattern 抛错时，插件以含键名的可读 error 拒绝注册 provider（即拒绝装载），不得以未捕获异常牵连同一 `- insert:` 列表中的其余条目）；`ctx.skills.registerProvider(control => provider)` 注册 `{ name: 'fenix-skill-provider', list, get }`——`list(options)` 调 scanner 并感知 `options.signal`（abort 时尽早 settle），`sourceDir` 不存在/不可读时返回空集 + 一条 warn；`get(candidate, options)` 按 `candidate.locator` 读文件、经 frontmatter 解析剥除围栏后返回 `SkillDefinition`（元数据字段与 candidate 一致），文件不存在/不可读返回 undefined；`fs.watch(sourceDir)`（非递归）事件 300ms 去抖后调 `control.invalidate()`，watch 初始化失败降级为静态注册 + warn（不抛未处理异常）；插件卸载时 watch 经 disposer 注销（provider 随 fiber 卸载自动注销）

## 5. 测试与构建验证

- [ ] 5.1 `tests/providerConfig.test.ts`：默认 sourceDir/pattern、`~` 展开、绝对路径透传、非法 pattern（如 `fen[x]-*`）的报错含键名
- [ ] 5.2 `tests/scanner.test.ts`：临时夹具目录覆盖——多个合法 skill 目录（含 symlink 指向目录）、平文件与目录重名、缺 SKILL.md、坏 frontmatter、缺 name、非 kebab-case name、pattern 不匹配、目录不可读 contained；断言 candidates 字段（invocation 缺省与显式覆盖、rank/locator/resourceBase/source）与 warn 行为
- [ ] 5.3 `tests/provider.test.ts`：list 对缺失 sourceDir 返回空集；get 剥离 frontmatter 且元数据一致、get 对已删除文件返回 undefined；watch → invalidate 去抖生效（fake timers）；watch 初始化失败降级不抛
- [ ] 5.4 `pnpm install && pnpm typecheck && pnpm build && pnpm test` 全绿，`lib/index.js` 产出（pnpm-lock.yaml 随 install 生成）

## 6. 文档

- [ ] 6.1 写 `fenix-skill-provider/README.zh.md`：对齐 `fenix-dsh-dashboard-bridge/README.zh.md` 结构——插件形态（仅 host 半）、机制小节（scan → registerProvider、get 读盘、fs.watch 去抖 invalidate）、配置键表（`sourceDir` / `pattern`：默认值、语法、覆盖方式）、loader 行示例（`- insert:` 容器键写法，config 省略即默认）、已知限制（SKILL.md 为 Claude Code 语境原文注入、frontmatter 受限解析、pattern 仅段内 `*`）、dsh 版本兼容表（0.2.0-rc.2 唯一钉版）、构建与测试
- [ ] 6.2 写 `docs/help/fenix-skill-provider-install.md`：人工安装步骤（profile 内 `pnpm add link:<repo>/fenix-skill-provider`、cordis.patch.yml `- insert:` 条目、重启；非 loopback 场景与 live 实例刷新引用 `cc-import-install.md` 对应小节）+ 真机验收清单（默认 config 下 "/" 菜单出现全部 fenix-* 匹配条目（当前实测 8 个）且描述与 SKILL.md 一致；点选 fenix-new 发送 `/fenix-new` 且注入内容无 frontmatter 残留；来源目录新增/移除 skill 后数秒内菜单自动增减、无需重启；`pattern: openspec-*` 覆盖生效；`sourceDir` 指向不存在目录时插件容错且 dsh 其余功能不受影响；卸载步骤与回滚）——真机执行部分明确标注「不由实现 Agent 执行」，对齐 `fenix-dashboard-bridge-install.md` 口径
