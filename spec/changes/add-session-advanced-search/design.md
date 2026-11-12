# Design: add-session-advanced-search（会话高级搜索插件）

## Context

- dsh `0.2.2-rc.1`，插件仓 `/root/dsh-plugins` 已有 8 个成熟插件可循先例。
- 官方侧栏会话搜索在 `@deepseek-ai/dsh-client-ui-sidebar`（构建产物 bundle，**无**面向搜索框的公开插槽缝）；侧栏条目/面板类缝（`ctx.slots.inject/register`）不覆盖搜索输入框内部。
- 会话产物为 `~/.dsh/sessions` 下 JSONL（`sessionPersistence.list()` 可只读枚举 header，fenix-dsh-session-grouper 已验证）。
- host↔client 通信既有先例：host 半 `ctx.webServer.register({kind:'exact', path, handler})` 注册同源 HTTP API，client 半 `fetch` 直调（fenix-dsh-auth）。
- host 侧调用 LLM 分析会话有官方先例：`dsh-experimental-session-titles-bundle`（直调 profile 既有 LLM，不进会话上下文）。
- 本仓**无**根级 `DESIGN.md` 界面宪法；UI 风格约束以仓内既有插件实践为准（复用 `@deepseek-ai/dsh-client-ui-primitives` 基元，fenix-dsh-auth D5 同款）。

## Goals / Non-Goals

**Goals:**
- 用户以自然语言描述内容+可选时间范围，跨全部工作区定位历史会话并一键跳转。
- 全程只读会话产物；分析为独立后台任务，不触碰当前会话上下文。
- 缝失配/LLM 失败等异常路径显式降级，不破坏官方侧栏。

**Non-Goals:**
- 不做持久化全文索引/嵌入库（每次即时分析；未来可加）。
- 不修改官方标题搜索行为、不修改任何会话产物。
- 不做多语言（界面中文）、不做结果深链路由（本期直接切主视图）。

## Decisions

- **D1 入口注入走 DOM 缝**：MutationObserver + 锚点签名定位官方搜索输入框容器，在清除(X)按钮左侧插入图标按钮。理由：官方包无注槽，改 dist/fork 必碎于升级；DOM 注入是仓内已验证模式（dashboard-bridge installWorkspaceNav）。备选（否决）：给上游提槽位（周期不可控）。降级：锚点签名失配 → warn 日志 + 放弃注入（spec 缝失配场景）；package.json `engines.dsh` 钉 `>=0.2.2-rc.1 <0.3`。
- **D2 双半通信走 HTTP API**：`POST /api/session-advanced-search/jobs`（body: `{query, timeRange?}` → `{jobId}`）；`GET /api/session-advanced-search/jobs/:id`（`{phase: collecting|filtering|analyzing|done|error|cancelled, results?, degraded?}`）；`DELETE /api/session-advanced-search/jobs/:id` 取消。client 半 1s 间隔轮询。理由：仓内唯一已验证双半缝；备选（否决）：SSE 流式（一个弹窗轮询不值得）、cordis client RPC（无仓内先例）。API 路径带 `/api/session-advanced-search` 前缀避免与官方/其它插件路由冲突（webServer.register kind:'exact' 语义）。
- **D3 LLM 单调用排序**：候选集摘要打包进一个 prompt，一次 LLM 调用返回 JSON 排名（id+reason+confidence）。成本 O(1) 次调用；超时 `llmTimeoutMs=60000`，解析失败/超时 → 回退机械排序并置 `degraded` 标记。理由：逐会话调用成本 O(n)；本地嵌入索引属 Non-Goal。LLM 服务从宿主 dsh 既有 LLM 服务缝获取（session-titles 同模式），不自带 provider 配置。
- **D4 预筛管线（只读）**：`sessionPersistence.list()` 全量 header → 可选时间范围过滤（header 时间戳）→ 关键词计分（标题+cwd；命中加分）→ 截断 `maxCandidates=30`（评分优先、同分取最近活跃）。摘要构造只读 header + 首条用户消息节选（限前 2KB/会话），不整段读大会话。
- **D5 跳转缝（实现期侦察钉死）**：目标为「主视图切到既有会话」。`startSession()` 只开新会话不可用；实现期第一优先侦察 `dsh-client-ui-session`/侧栏选中态缝（如 sessions 服务 open/select 或侧栏列表项受控行为）。缝不存在时兜底：UI 层触发侧栏对应列表项 click。此侦察是 tasks 1.x 首个任务，结论回填本节。
- **D6 任务模型**：host 进程内 `Map<jobId, Job>`，AbortController 取消；不跨重启持久（弹窗内等待语义，重启丢任务可接受，client 轮询 404 即按 error 收尾）。多标签页天然隔离：jobId 只回发起方；「同一 client 单在途」约束由 client 半提交前 DELETE 旧任务保证（4.4），host 不做隐式取消（避免跨标签页互踩）。
- **D7 配置（loader config）**：`enabled`(true)、`maxCandidates`(30)、`topN`(5)、`llmTimeoutMs`(60000)。非法值装载期显式抛错（session-grouper 纪律）。
- **D8 弹窗构形**：client 半复用 `dsh-client-ui-primitives` 基元（Button/Input 等）保证观感一致；无 Dialog 原语时自绘轻量 overlay + Esc 关闭。图标按钮用内联 SVG 放大镜+星标形态（仅图标，title=「高级搜索」）。

## Risks / Trade-offs

- [官方搜索框 DOM 缝漂移] → 锚点签名失配即 warn 降级；peer/engines 钉版；README 记录锚点签名便于未来修缝。
- [LLM 输出不合规/超时] → 严格 JSON 校验，失败即回退机械排序 + `degraded` 标注（spec 已覆盖）。
- [大会话读取成本] → 只读 header + 首条用户消息节选（字节数上限），不整段读产物。
- [跳转缝缺失] → D5 兜底路径；实现期确认不可达时按 `.fenix-run-result.json` unattainable 纪律申报，不硬编。
- [即席分析延迟（秒级~几十秒）] → 弹窗内阶段进度文案缓解等待感；候选上限控制 LLM 输入规模。
- [token 成本] → 单调用打包（D3）+ maxCandidates 上限双闸。

## Migration Plan

- 纯新增插件，无数据迁移。安装（人工步骤，写入 README「安装」节，参照 docs/help/dsh-session-grouper-install.md 体例）：目录进 profile pnpm workspace + `cordis.patch.yml` insert 列表登记 + 重启 profile。
- 回滚：从 insert 列表移除并重启即完全卸载，无残留状态（任务不持久）。

## Open Questions

- 既有会话打开缝的确切服务键/方法名（D5，实现期侦察后回填并钉死）。
- 官方搜索框锚点签名的稳定选择器组合（实现期 bundle 侦察后回填）。
