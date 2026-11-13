# Design: optimize-session-advanced-search

## Context

插件已交付并安装（`/root/.dsh/profiles/web` link 安装，dsh 0.2.2-rc.1）。真实使用暴露双根因（实证复现见 proposal Why-1）与四项体验债。用户经两轮原型批注定稿 UI（round 2），立项 full 立即实施。

**界面原型（UI 真相源）：`specs/optimize-session-advanced-search/prototype/`**（含 index.html + annotator.js + 四态整页截图 05–08）。相关 Scenario 显式声明「界面以 prototype/ 为准」。仓库根当前无 `DESIGN.md`（界面设计宪法缺失），本 SPEC 设计约束来源 = 定稿原型 + DSH 官方主题令牌（`@deepseek-ai/dsh-client-ui-primitives` / 会话 composer bundle 实测值，见下）；后续 DESIGN.md 落地时以宪法为准回扫。

## Goals

1. 搜索从「卡 3.5 分钟 + 黑盒降级」变为「≤60s 硬上限（凭证缺失时即时）+ 原因明示 + 出路可操作」。
2. 搜索界面成为内容区一等视图（非模态弹窗），视觉与官方语言一致。
3. 分析过程对用户透明（步骤流 + 计时 + 中断）。

## Decisions

### D1 超时硬解耦：Promise.race 包裹整段流消费（修改 analyzer.ts）

现状 `rankCandidates` 的 `streamText` await 底层 `for await`，abort 不被惰性流观察 → 超时失效。改为：

```ts
const streamPromise = streamText(deps.llm, {...}, deadline.signal).catch((e) => { streamError = e; return '' })
raw = await Promise.race([
  streamPromise,
  new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutMarker()), deps.timeoutMs) }),
])
```

- 超时分支：race reject → `mechanicalFallback('timeout')`；败者 streamPromise 挂 `.catch` 吸收（防 unhandled rejection），不泄漏定时器（finally clearTimeout）。
- 外部取消（任务 DELETE）优先于超时：race 亦监听 `signal.aborted` → 返回取消语义（不降级不产出），行为与现状一致。
- 测试锚点：stub `llm.stream` 返回永不 resolve 且忽略 signal 的流，`timeoutMs=50`，断言 rankCandidates 在 ~timeoutMs+余量内 resolve 且 `degradedReason==='timeout'`。

### D2 凭证预检快速失败 + 路由可配置（analyzer.ts / config.schema.ts / host.ts）

- `AnalyzerDeps` 新增可选缝 `credentialProbe?: (provider: string) => boolean`（true=有凭证/未知）。`rankCandidates` 在发起调用前：`credentialProbe` 在位且返回 false → `mechanicalFallback('credential-missing')`，不发起调用。缝缺失（undefined）→ 跳过预检（D1 race 兜底）。
- `AnalysisOutcome['degradedReason']` 扩充 `'credential-missing'`。
- host 装配注入 `credentialProbe`：从 ctx.llm 侧 provider 配置读取该 provider 的 credential-ref（`apiKeyEnv`），校验 `process.env[apiKeyEnv]` 非空；读不到 provider 配置时返回 true（不误杀）。实现按 dsh 0.2.2-rc.1 实测缝自守（形状漂移 → 跳过预检 + warn 一次）。
- 插件配置（shared/config.schema.ts）新增可选 `analyzeRoute: { provider: string; model: string }`；`AnalyzerDeps.routeOverride` 装配透传，`resolveRoute` 优先级：`routeOverride` > `agentDefaultModel.currentSelection()`。用户可将分析路由指到有凭证 provider（如 deepseek）。
- 降级横幅文案按原因分类映射（client，UI_TEXT.degradedReasonText）：`credential-missing` →「分析模型路由 <provider/model> 缺少凭据（环境变量 <apiKeyEnv> 未配置）」+ 动作「前往模型设置配置凭证」（`uiWorkspace`/设置导航缝，不可用时降级为提示文案）+「仅重试 AI 分析」（重新 POST 同 query）；`timeout` →「60s 超时守卫已中断等待」；其余沿用简短说明。

### D3 内容区视图（重排 client：searchDialog.tsx → searchView.tsx）

- 移除 overlay 遮罩与模态语义。打开 = 在主内容区挂载搜索视图（React root 复用，容器绝对定位铺满内容区、z-index 低于官方浮层）；侧栏不受遮挡、可交互。
- 挂载锚：从官方搜索框入口（既有 ANCHOR 先例）出发向上定位内容区容器（属性子串选择器，容忍 hash 前缀漂移）；失配降级为右侧抽屉（fixed，避让侧栏实测宽度，仍非模态遮罩）+ warn 一次。
- 关闭途径：header X 按钮、Esc、候选点击跳转后自动关闭；关闭即卸载视图 + DELETE 在途任务（现状 cancelInFlight 语义保留）。
- 组件重命名 `SearchDialog` → `SearchView`，props 面保持 `{ open, onClose, onOpenSession, fetchImpl?, pollIntervalMs? }` 形状兼容，便于装配层最小改动。

### D4 视觉规格（对齐定稿原型 + 官方令牌）

- 官方主题令牌优先（`var(--dsw-alias-bg-base)` / `--dsw-alias-label-*` / `--dsw-static-deepseek-*` / `--dsw-radius-panel` 等），内联回退值（light：bg #fff、label #0f1115/#61666b/#adb2b8、accent #4176e6、divider #ebeef2）。
- 底部输入卡：居中 `max-width: min(calc(100% - 16px), 952px)`、radius 28px、border 1px rgba(0,0,0,.16)、focus 蓝环、圆 32px 发送按钮（IconSendOutline 几何，白色 stroke 1.3）。
- header：标题 + 关闭 X（官方 IconCloseOutline 几何，24×24 座、secondary 色、hover bg）。scope chips（工作区/近 7 天）形态沿用原型。
- 结果卡片：标题行 + ws chip + 时间 + 理由行（AI 语义命中高亮关键词 / 机械匹配）+ 置信度条（AI=蓝渐变、机械=灰）。
- 字号：正文 13px/20px、辅助 12px/16px；字体栈继承宿主。

### D5 分析过程可见（jobs.ts / routes.ts / searchView.tsx）

- `SearchJob` 新增 `progress: { step: string; detail?: string; at: number }[]`（有界：保留最近 50 条）。
- host 推进点：collecting 开始（解析查询意图/抽取关键词，detail=关键词列表）、filtering 完成（detail=`候选 N→M`，工作区分布摘要）、analyzing 开始（detail=`调用 AI 语义分析 · provider · model · M 个候选`）、完成（detail=置信度摘要/降级原因）。机械阶段即时追加，analyzing 阶段追加一次（LLM 单调用无中间 token 进度——不伪造流式假象）。
- GET 载荷携带 `progress`（守卫放行可选数组，元素形状校验），client 按序渲染步骤流（完成✓/进行中 spinner/等待○），本地起表计逐秒刷新；中断按钮 = 既有 DELETE 任务语义 UI 化，中断后视图回初始态。
- 降级横幅（D2 文案）置步骤流之下、结果列表之上。

### D6 入口图标官方几何（searchButton.ts）

- `ICON_SVG` 替换为官方 `IconSearchOutlineMedium` 路径（viewBox `0 0 16 16`、`fill:none; stroke:currentColor; stroke-width:1.3; stroke-linecap:round; stroke-linejoin:round`，渲染 15×15 保持槽内节奏），删除星标装饰路径。
- 按钮座保持 28×28 inline-flex、`color:inherit`，去 `opacity:.75`（官方按钮无此降透明，hover 反馈交由宿主 hover bg 对齐官方 clearButton 形态）。

## Risks

- **锚点漂移**：内容区容器选择器失配 → D3 右侧抽屉降级形态兜底，warn 限流（沿用 searchButton 先例）。
- **credentialProbe 缝形状不确定**：读不到 provider credential-ref 时返回 true 不误杀（D2）；预检只是快速失败优化，正确性由 D1 兜底。
- **协议向后兼容**：新增字段全部可选 + 守卫白名单；老 GET 消费方忽略新字段。
- **dsh-web 重启窗口**：client/host 半重载需重启 dsh-web（会杀运行时会话），实施合入后由人工窗口执行，README「安装（人工步骤）」补一行说明。
