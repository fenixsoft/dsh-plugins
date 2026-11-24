# Proposal: add-chat-polish-settings-toggles

## Why

`fenix-dsh-chat-polish`（v0.2.2）的 6 个功能（留白 24px、滚动条样式、输入框 80% 宽度、用户消息 Markdown 渲染、hero 工作区行对齐、输入框 ↑/↓ 历史导航）目前全部无条件生效，用户对任何一项有偏好差异（如不想要 80% 输入框宽度、不习惯 ↑/↓ 召回）时没有任何关闭途径，只能整插件停用（牺牲全部功能）或改源码。需要在 dsh web 官方设置页为本插件增加一个分区菜单，对每个功能提供独立开关。

用户已确认（2026-11-24）：6 个功能全部提供开关、默认全开（等于当前行为）、关闭即回退官方形态；执行模式 fast-track；立项后立即调度。

## What Changes

- **新增设置分区菜单**：插件 client 半经官方 keyed 插槽 `settings.section` + `settings.section.icon`（仓内先例 `fenix-dsh-auth` 的「登录」分区）注册「对话区打磨」分区，面板内渲染 6 个功能行，各带独立开关。
- **开关状态持久化**：localStorage 按浏览器持久化（key 形如 `fenix-chat-polish.toggles`，JSON `{功能ID: bool}`），缺省/损坏一律回退全开；存储不可用（隐私模式等）时降级为会话内生效、不报错。
- **插件核心条件化重构**：单体 `POLISH_CSS + VIEW_CSS` 样式串拆分为按功能命名的分块，样式标签内容按「开启集合」重建；插槽渲染器与文档级监听器按开关状态条件化——**开关切换即时生效（无需刷新页面）**，关闭某功能 = 该功能回退官方原生形态。
- **默认行为不变**：全部开关默认开启时，插件行为与 v0.2.2 完全一致；嵌入形态（fenixd dashboard embed，root 带 `.embeddedBody`）的整体验免不受任何开关影响。
- **文档与版本**：`README.zh.md` 增补功能开关说明；`package.json` 版本号与功能描述同步演进。

## Capabilities

### New Capabilities
- `chat-polish-feature-toggles`: 对话区打磨插件的设置页独立开关能力——官方设置页分区菜单、6 功能独立开关、localStorage 持久化与降级、即时生效语义、嵌入豁免不受开关影响。

### Modified Capabilities

（无——已搜索 `spec/changes/*/specs/` 与 `spec/archive/*/specs/`，`fenix-dsh-chat-polish` 既有功能从未立过能力 SPEC，本 Change 新建唯一能力页。）

## Impact

- **代码**：`fenix-dsh-chat-polish/client.js`（主要改动面：CSS 分块重构、开关 store、插槽/监听器条件化、设置分区 UI）；`fenix-dsh-chat-polish/package.json`（版本/描述）；`fenix-dsh-chat-polish/README.zh.md`（功能开关文档）。
- **不改动**：宿主 dsh 包、loader 注册清单（插件已装入 live profile，无新注册）、其他插件。零新依赖。
- **兼容性**：官方设置页结构漂移时仅菜单缺席（插槽失配自动降级），6 个功能的默认行为不受影响；`settings.section` 插槽契约与 order 探测写法以 `fenix-dsh-auth/client.js` 真机验证过的先例为锚。
- **验证载体**：按知识域 `plugin-rollout` 纪律走隔离 profile 真机验证（临时 `DSH_HOME` + 独立端口 + playwright-cli）；live 实例刷新是文档化人工步骤，不作为实现任务。
