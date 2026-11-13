# 会话高级搜索

<!-- knowledge: capability=session-advanced-search rev=1
     sources=spec/changes/add-session-advanced-search,spec/changes/optimize-session-advanced-search -->

会话高级搜索是 dsh web 侧栏的语义检索能力：用户以自然语言描述想找的会话，插件在全部工作区的历史会话上做「机械预筛 + LLM 语义排序」，给出带匹配理由与置信度的 Top-N 候选并支持一键跳转；全程只读，与当前会话的对话上下文完全隔离。

## 规则

### 入口注入（搜索框内）

- client 半在官方侧栏会话搜索框内部、清除（X）按钮左侧注入仅图标的「高级搜索」按钮（hover 提示「高级搜索」）；注入不改变官方标题搜索行为。
- 图标为官方 IconSearchOutlineMedium 几何：viewBox `0 0 16 16`、`fill:none`、`stroke:currentColor`、`stroke-width:1.3`、纯线条无装饰；按钮座 28×28、`color:inherit`、无降透明处理。
- 锚点签名（`input[class*="searchInput"]`，属性子串匹配容忍构建哈希漂移）失配时 warn 限流一次并放弃注入，不抛错；MutationObserver 持续维护在位，官方重渲染移除按钮后自动补插。

### 内容区视图（非模态）

- 点击入口在主内容区（侧栏右侧）打开高级搜索视图：无全屏遮罩，侧栏保持可见且可交互。视图含 header（标题 + 关闭 X）、主体区（初始态 / 步骤流 / 降级横幅 / 结果列表）与底部输入卡（居中 max 952px、radius 28px，对齐 DSH 官方 composer 卡）；文案为中文。
- 输入卡含会话内容描述（必填）与可选开始/结束日期范围；描述为空或仅空白字符时提交按钮不可用。
- 关闭途径：header X、Esc、点击候选跳转后自动关闭；关闭即重置输入与结果状态并还原内容区，重开为全新初始态。
- 内容区挂载锚 = 搜索框 input 最近侧栏祖先（`[class*="sidebar"]`）的相邻兄弟元素；失配时降级为右侧抽屉形态打开（fixed、避让侧栏实测宽度，仍非模态遮罩）并 warn 限流一次。

### 分析任务模型

- 同源 HTTP API 三端点：`POST /api/session-advanced-search/jobs` 建任务立即返回 jobId；`GET .../jobs/:id` 轮询状态；`DELETE .../jobs/:id` 取消（幂等，未知 id 404）。POST 请求体上限 64KB。
- 同一 client 同时最多一个在途任务：在途时再次提交先 DELETE 旧任务再建新任务；host 不做隐式取消，多在途并存、跨标签页天然隔离。
- 任务与当前会话的对话上下文完全隔离：不写入、不依赖、不展示于对话记录。
- 视图在途时提供中断按钮（= DELETE 在途任务）；中断后视图回初始态、停止轮询。关闭视图同样 DELETE 在途任务。
- 任务不跨重启持久：dsh web 重启丢任务，client 轮询 404 即按错误收尾。终态任务滞留表内按 TTL 1 小时惰性回收，容量上限 64 个（超限淘汰最老终态任务，在途任务不参与淘汰）。

### 收集与机械预筛（只读、全工作区）

- 只读收集本 profile 全部会话产物（覆盖所有工作区、含归档会话），全程绝不调用写通道、不以 write 模式打开会话；活动时间取 sessionController updatedAt、回退 header createdAt。
- 提供时间范围时仅保留活动时间落在 `[start, end)` 区间内的会话；描述切词后对标题（+2/词）与工作区路径（+1/词）命中计分。
- 候选集上限 `maxCandidates`（默认 30），评分优先、同分取最近活跃截断。
- cold 会话无投影 title 时回退为只读事件流折叠最后一条 `session/title` 事件（按最近活跃优先、上限 200 个会话，单会话失败 warn 隔离）；读取同时缓存首条用户消息供候选节选复用（≤2048 UTF-8 字节/会话）。

### LLM 语义分析与排序

- 候选摘要（标题/活动时间/工作区/首条用户消息节选）打包进单个 prompt，一次 LLM 调用返回 JSON 排名行（id + 中文 reason + confidence∈[0,1]），严格解析（id 白名单去重、非法行丢弃）后取 Top-N（`topN` 默认 5）。
- 分析路由优先级：插件配置 `analyzeRoute {provider, model}` 优先于 profile 默认路由（agent-default-model）。
- LLM 单调用受硬超时 `llmTimeoutMs`（默认 60000）约束：流消费 promise 与超时 marker `Promise.race` 竞速，deadline 到点立即返回降级结果、不依赖底层流闭合；败者流挂 `.catch` 吸收防 unhandled rejection；外部取消（任务 DELETE）优先于超时（不降级不产出）。输出 token 预算随候选数伸缩（每候选 200 + 基础 256，夹在 [2048, 8192]）。
- 凭证预检：host 装配注入 credentialProbe，读路由 provider 的 credential-ref（apiKeyEnv）查进程环境变量与凭据库快照（发起分析前预热）；均无值 → 不发起调用、立即降级 `credential-missing`；ref 不可得或缝形状漂移 → 跳过预检不误杀（由硬超时兜底）。
- 降级矩阵：LLM 服务缺失 / 凭证缺失 / 调用超时 / 调用失败 / 输出解析失败 → 回退机械评分排序（评分优先、同分最近活跃），原因分类 `llm-missing` / `credential-missing` / `timeout` / `call-failed` / `parse-failed` 经 `degradedReason` 贯通至轮询载荷（可选字段，向后兼容）。
- 结果界面按原因展示中文降级横幅；`credential-missing` 横幅必含「前往模型设置配置凭证」（uiWorkspace 设置导航缝，不可用时降级为提示文案）与「仅重试 AI 分析」（同 query 重新 POST）两个动作入口。无任何匹配时展示中文空态文案。

### 分析过程步骤流

- host 在推进点记录 `progress[]`（`{step, detail?, at}`，有界保留最近 50 条，GET 可选字段）：collecting（解析关键词）、filtering（候选 N→M + 工作区分布）、analyzing（provider·model·候选数）、done（置信度摘要或降级原因，credential-missing 附凭证引用）。
- client 按序渲染 agent 对话风格步骤流（完成 ✓ / 进行中 spinner / 等待 ○），并展示自提交时刻起的本地计时（0.1s 步进「分析中 · X.Xs」，不依赖宿主时钟）；不伪造 LLM 流式中间进度。

### 结果展示与跳转

- 候选卡片展示标题、工作区、活动时间、匹配理由与置信度可视化条（AI 排序蓝渐变、机械回退灰色）。
- 点击候选关闭视图并跳转该会话：`uiWorkspace.openSession` 优先、侧栏会话项 click 兜底；跨工作区直接跳转，不要求用户先切换到该会话所属工作区。

### 配置键

`enabled`（默认 true）/ `maxCandidates`（30）/ `topN`（5）/ `llmTimeoutMs`（60000）/ `analyzeRoute`（可选 {provider, model}）；任一键非法（类型不符或超范围）装载期抛 TypeError 拒绝插件装载，不带病运行。

## 关键行为

1. 提交 → POST 建任务 → 视图进入进度态（步骤流 + 本地计时），client 以 1s 周期轮询。
2. host 管线：collecting（只读收集 + 时间过滤 + cold title 折叠）→ filtering（关键词计分 + 截断）→ analyzing（路由解析 + 凭证预热/预检 + 单次 LLM 竞速排序）→ done（Top-N + 降级标注）。
3. 结果呈现：AI 排序或机械回退附原因横幅；点击候选 → 关闭视图 + 跨工作区跳转。

## 代码锚点

- 主实现：插件 `fenix-dsh-session-advanced-search`——client 半 `fenix-dsh-session-advanced-search/src/client/`（searchButton.ts 入口注入、searchView.tsx 内容区视图、index.ts 装配挂载、jump.ts 跳转）、host 半 `fenix-dsh-session-advanced-search/src/host/`（collector.ts 预筛收集、analyzer.ts 语义排序、jobs.ts 任务表、routes.ts HTTP 端点、index.ts 管线装配与凭证探针）。
- 协议与配置单源：`fenix-dsh-session-advanced-search/src/shared/protocol.ts`（载荷形状/守卫/降级文案）、`fenix-dsh-session-advanced-search/src/shared/config.schema.ts`（配置解析与校验）。
- 消费方：dsh web 侧栏搜索框与主内容区（DOM 注入面）、dsh-host-webserver route 注册面。
- 守卫测试：`fenix-dsh-session-advanced-search/tests/`（analyzer / jobs / routes / collector / protocol / view / searchButton 等套件）。

## 溯源

- 2026-11-12 add-session-advanced-search（spec/changes/add-session-advanced-search/）— 新建本页：入口注入 / 搜索视图 / 任务模型 / 只读预筛 / LLM 排序 / 结果跳转规则的初始蒸馏。
- 2026-11-13 optimize-session-advanced-search（spec/changes/optimize-session-advanced-search/）— 重写本页：模态弹窗更名内容区视图（禁遮罩 + 抽屉降级）、超时硬解耦、凭证预检 `credential-missing`、`analyzeRoute` 路由覆盖、`degradedReason`/`progress` 贯通、入口图标官方几何。
