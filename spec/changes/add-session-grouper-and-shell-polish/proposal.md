## Why

dsh web 侧栏的「项目」分区（fenix-dsh-dashboard-bridge Portal 内嵌分区）目前带一圈边框，与官方「工作区」区域的无边框视觉不一致，观感突兀；指挥中心（fenixd dashboard 2026-10-31 新增页面 `#/command-center`）未进入侧栏菜单，入口缺失。更严重的是：dsh web 的 workspace 归属要求会话 cwd **严格等于** workspace 注册路径，而 fenixd 派发的 run 全部发生在 worktree（`/root/fenixd/.claude/worktrees/impl-<spec>-<ts>`），路径永不相等——`~/.dsh/sessions` 中 265 个会话里约 235 个 fenixd 会话与 20 个 dsh-plugins 会话全部堆积在「未分组」桶里，无法按工程归类。

用户明确要求**外挂式**方案（不动 dsh 本体安装文件、不影响升级）。生态调研证实可行：社区插件 `dsh-tool-github` 直接经 `ctx.workspaceRegistry.create` 注册工作区、`dsh-session-workspace` / `dsh-session-move` 以「重写会话持久化 header 的 cwd + 官方 attach」完成跨工作区迁移（带备份/回滚/写租约），全部零本体改动。本机为 per-session JSONL 持久化后端，符合迁移类插件的前置要求。

## What Changes

- fenix-dsh-dashboard-bridge「项目」分区容器去除边框（`border` 移除，保留背景与圆角），与官方工作区区域视觉对齐；降级路径的浮层列表边框保留（浮层叠加在内容上方需要分界）。
- fenix-dsh-dashboard-bridge 侧栏固定菜单条目从 5 个扩为 6 个：新增「指挥中心」条目（深链 `#/command-center`，位于「概览」之后），配同风格线性图标；main keyed 面板与深链机制自动生效。
- 新增第三只 host-side 插件 `fenix-dsh-session-grouper`（纯 host 半，无 client UI）：
  - 按**可配置项目根列表**（缺省 `/root/fenixd`、`/root/dsh-plugins`）经官方 `ctx.workspaceRegistry.create` 幂等保障项目工作区存在；
  - 周期扫描未归组且已静默（冷）的会话，按 cwd 包含关系（cwd == 项目根 或 cwd 位于项目根目录树内）将其持久化 header 的 cwd **重写为项目根**，随后经官方 `attachSession` 归组（cwd 相等门自然通过）；
  - 迁移前备份原 cwd 到插件本地映射表 + 原会话产物到 `$DSH_HOME` 下备份目录，支持按映射表回滚；
  - 在飞会话（mtime 新鲜 / 写租约占用）跳过，待静默期后下一轮迁移。
- 插件安装进 web profile（`link:` 主树目录形态，与既有三插件一致）+ dsh-web 重启为**人工步骤**，落 `docs/help/` 安装文档（仓库既有惯例，参照 `fenix-dashboard-bridge-install.md`）。

## Capabilities

### New Capabilities

- `session-grouper`: host-side 会话归组插件——项目工作区幂等注册、未归组冷会话识别与 cwd 归属重写迁移（含静默期/写安全/冲突跳过）、官方 attach 归组、备份映射与回滚、配置项（项目根列表/静默期/扫描周期/开关）、dsh 服务缝漂移时显式失败不静默。

### Modified Capabilities

- `fenix-dash-bridge`: 「每项目动态条目」分区容器去边框（新增无边框视觉约束与 Scenario）；「侧栏固定菜单条目」从 5 固定条目扩为 6（新增指挥中心条目：id/label/深链/图标/order 及切换语义）。

## Impact

- `fenix-dsh-dashboard-bridge/src/client/panels.tsx`（sectionStyle 去 border）、`src/client/index.ts`（FIXED_ENTRIES/Glyphs 加指挥中心）——纯 client 半改动，合并后浏览器强刷即生效，无需重启 dsh-web。
- 新增 `fenix-dsh-session-grouper/`（package.json（含插件清单/config 声明段）、tsconfig、tsdown、vitest、src/host/*、src/shared/*、src/types/dsh-runtime.d.ts、tests/*）——与既有三插件同构的双半插件骨架（本插件仅 host 半）。
- 运行时影响：`~/.dsh/profiles/web/package.json` 增一条 `link:` 依赖 + `systemctl restart dsh-web`（人工步骤，文档化）；迁移会改写历史会话 header cwd 与会话目录归位（原产物备份），不影响 fenixd 车道自身调度（fenixd 读 run jsonl，不读 dsh web 工作区归属）。
- 无 dsh 本体文件改动；对 `@deepseek-ai/*` 仅消费既有公开服务缝（`ctx.workspaceRegistry` / `ctx.sessionPersistence` / ctx 存储域），版本钉扎沿用 dsh 0.2.0-rc.2 纪律，缝漂移时插件显式报错停用。
- 归档检索：能力判定已核对 `spec/changes/*/specs/` 与 `spec/archive/*/specs/`（`session-grouper` 为全新能力，`fenix-dash-bridge` 既有，见 archive/2026-10-30-add-dsh-dashboard-bridge 与 changes/bridge-projects-inline-section）。
