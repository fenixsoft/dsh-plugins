# Proposal: add-session-advanced-search（会话高级搜索插件）

## Why

dsh web 侧栏搜索只能匹配会话标题；用户经常只记得「聊过什么内容、大概什么时候」，而这些词未必出现在标题里，导致找不到历史会话。需要一个由 LLM（agent）分析会话记录内容的高级搜索：用户用自然语言描述会话大致内容与时间，系统分析会话记录定位目标会话并一键跳转。

## What Changes

- 新增 dsh 插件 `fenix-dsh-session-advanced-search`（client 半 + host 半）：
  - **client 半**（dsh.client, platform web）：
    - 在官方侧栏会话搜索框内部、清除（X）按钮左侧注入仅图标按钮「高级搜索」（hover 提示文案）；
    - 点击后弹出高级搜索弹窗：自由文本描述输入 + 可选开始/结束日期范围 + 提交；提交后弹窗内展示分析进度（阶段文案），完成后原地展示候选结果列表（标题/所属工作区/时间/匹配理由/置信度）；
    - 点击候选结果 → 关闭弹窗并把主视图快速切换到该会话（与侧栏点击该会话同效）。
  - **host 半**：
    - 经 `webServer.register` 注册同源 HTTP API：发起分析任务、轮询任务进度与结果；
    - 只读收集本 profile 全部会话产物（所有工作区，不限当前工作区），按可选时间范围与关键词机械预筛出候选集（数量有上限，控制成本）；
    - 调用 profile 既有 LLM 对候选会话摘要（标题/时间/工作区/首条用户消息节选等）做语义匹配排序，返回带匹配理由与置信度的 Top-N 候选；LLM 不可用/失败时回退为机械评分排序，功能不中断；
    - 分析为独立后台任务：不写入、不依赖、不污染当前会话上下文。
- 不修改官方标题搜索的既有行为；会话产物全程只读。

## Capabilities

### New Capabilities

- `session-advanced-search`: 会话高级搜索——搜索框图标按钮注入、高级搜索弹窗交互、host 侧会话收集/机械预筛/LLM 语义分析管线、候选结果展示与会话跳转、失败降级。

### Modified Capabilities

（无——归档与在途 SPEC 中均无既有会话搜索能力，见 spec/archive/*/specs/ 与 spec/changes/*/specs/ 检索记录）

## Impact

- **新增插件包** `fenix-dsh-session-advanced-search/`：package.json、src/client、src/host、src/shared、src/types、tests、README.zh.md（仓内交付物，随 SPEC 实现）。
- **依赖官方缝**（均为只读消费/既有公开缝）：
  - `@deepseek-ai/dsh-client-ui-sidebar` 搜索框 DOM 缝（图标按钮注入；DOM 缝，升级可能漂移，需 peer 钉版 + 缝失配显式降级）；
  - `webServer.register`（host HTTP API，fenix-dsh-auth 先例）；
  - `sessionPersistence`（会话产物只读枚举，fenix-dsh-session-grouper 先例）；
  - host 侧 LLM 服务（官方 dsh-experimental-session-titles-bundle 同模式）；
  - client 侧「打开既有会话」缝（主视图切会话，实现期按 dsh-client-ui-session 侦察钉死）。
- **profile 安装**：需把插件加入 `/root/.dsh/profiles/web/cordis.patch.yml` insert 列表——profile 运行时配置在仓库外，属人工步骤（记入 README/`.fenix/todo.md`，不进 Deliverables）。
- **成本与隐私**：LLM 分析消耗 token（候选集上限约束）；分析内容不进入任何会话记录。
