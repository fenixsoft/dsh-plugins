# Proposal: optimize-session-advanced-search — 优化会话高级搜索体验

## Why

`add-session-advanced-search` SPEC 已交付并安装（22/22 验证通过），但真实使用暴露 5 项体验问题（用户 2026-11-13 立项原话见 request.md，需求细节经原型两轮批注确认）：

1. **搜索慢且降级原因不明**：点击搜索后长时间卡「分析中」（实测 ~3.5 分钟），最终提示「LLM 分析不可用，已按机械匹配排序」，无原因、无出路。实证双根因：
   - **根因 A（路由无凭证）**：分析路由取 `agent-default-model` = `bigmodel-cn/glm-5.3-flash`，该 provider 依赖环境变量 `BIGMODEL_CN_API_KEY`，而 dsh-web 进程（systemd，无 EnvironmentFile）无此变量 → 每次调用必然失败，且失败前长时间悬挂。
   - **根因 B（超时守卫失效）**：`src/host/analyzer.ts` 的超时 deadline（AbortController + setTimeout）会 abort，但 pi-ai 的惰性流在 pending 中不观察 signal，`for await` 永不返回 → 60s 守卫到点后调用方仍在等底层流闭合，超时形同虚设。
2. **弹窗形态卡死用户**：高级搜索是模态弹窗（overlay + panel），打开后遮挡并阻断会话区交互。
3. **UI 粗糙**：原生 textarea/date 控件裸拼，未对齐 DSH 官方视觉语言。
4. **分析过程黑盒**：仅有三个阶段文案（正在收集/预筛/agent 分析中），用户不知道 AI 在做什么、调用哪个模型、还要多久。
5. **入口图标风格突兀**：自绘 24-viewBox 放大镜+星标与官方 X（clearButton）并排，viewBox 比例、描边粗细、装饰复杂度三重不一致。

原型两轮迭代后用户明示定稿（`specs/optimize-session-advanced-search/prototype/`，frp 入口 `?proto_round=2`）。

## What Changes

- **超时硬解耦**：analyzer 用 `Promise.race` 把「LLM 单调用」与「超时/取消」解耦——deadline 到点必须立即返回降级结果，不再依赖底层流闭合；败者流挂 `catch` 吸收防 unhandled rejection。
- **凭证预检快速失败**：新增 `credentialProbe` 缝，host 装配时从 provider 配置读取 credential-ref（`apiKeyEnv`）并查 `process.env`；缺失则不发起调用，立即降级并标注新原因分类 `credential-missing`。
- **分析路由可配置**：插件配置新增 `analyzeRoute {provider, model}` 覆盖项，设置时优先于 `agent-default-model`（用户可指到有凭证的 provider）。
- **降级原因明示**：`degradedReason` 贯通 AnalysisOutcome → job → GET 载荷 → 客户端降级横幅（琥珀色，含原因说明 + 「前往模型设置配置凭证」「仅重试 AI 分析」动作）。
- **弹窗改内容区视图**：搜索界面从模态弹窗改为**主内容区视图**（侧栏保持可见可交互），X/Esc 关闭还原；锚点失配降级为右侧抽屉形态（仍非模态遮罩）。
- **UI 对齐定稿原型**：底部 composer 输入卡（居中 max 952px、28px 圆角、官方令牌）、header scope chips、结果卡片（置信度条/命中关键词 chips）、分析过程步骤流。
- **分析过程可见**：GET 载荷新增 `progress[]`（解析意图 → 机械预筛 N→M → 调用 AI provider·model → 重排），客户端渲染 agent 对话风格步骤流 + 本地计时 + 中断按钮。
- **入口图标官方几何**：采用官方 `IconSearchOutlineMedium` 路径（viewBox 0 0 16 16、stroke 1.3），去星标装饰，尺寸/颜色对齐官方 searchButton。

## Capabilities

- 修改既有能力 `session-advanced-search`（来源：`spec/changes/add-session-advanced-search/specs/session-advanced-search/spec.md`，已搜索 changes/ 与 archive/，无其他同名能力）。

## Impact

- 插件 `fenix-dsh-session-advanced-search`：client 4 文件重排（searchDialog.tsx → searchView.tsx）、host 4 文件、shared 2 文件、tests 6 文件、README。
- 不新增/删除 API 端点；GET 载荷为向后兼容扩展（新增可选字段 `degradedReason`、`progress`）。
- 协议新增可选字段均有守卫与测试；老客户端忽略新字段不受影响。
