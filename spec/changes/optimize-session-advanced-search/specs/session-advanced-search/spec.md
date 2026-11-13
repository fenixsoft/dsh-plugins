# session-advanced-search — 会话高级搜索（优化）

> **界面原型（UI 真相源）：`specs/optimize-session-advanced-search/prototype/`**（index.html + 四态整页截图 05–08）。
> 本 delta 中涉及界面的 Scenario **界面以 prototype/ 为准**（与「数值以 Scenario 为准」同纪律等级，冲突须升级用户裁决）。
> 仓库根无 `DESIGN.md`：设计约束来源 = 定稿原型 + DSH 官方主题令牌（`@deepseek-ai/dsh-client-ui-primitives`，16-viewBox/stroke-1.3 图标几何与 `--dsw-*` 变量）。

## MODIFIED Requirements

### Requirement: 搜索框内高级搜索入口注入

插件 client 半 SHALL 在官方侧栏会话搜索框（`@deepseek-ai/dsh-client-ui-sidebar` 渲染的搜索输入框）内部、清除（X）按钮的左侧注入一个仅显示图标的按钮（无文字），hover/焦点时 SHALL 给出「高级搜索」提示文案；注入 MUST NOT 改变官方搜索框自身的标题搜索行为。官方搜索框 DOM 签名与预期缝不符（缝漂移）时，插件 SHALL 打 warn 级日志并跳过注入，MUST NOT 抛错破坏侧栏其余功能。图标 SHALL 采用官方图标库的放大镜几何（`IconSearchOutlineMedium`：viewBox `0 0 16 16`、`fill:none`、`stroke:currentColor`、`stroke-width:1.3`、无额外装饰图形），按钮座 SHALL 为 28×28、`color:inherit`、无降透明处理，与相邻官方按钮线条粗细一致。

#### Scenario: 注入成功

- **WHEN** 用户在侧栏点击搜索、官方搜索框出现
- **THEN** 搜索框内 X 按钮左侧出现一个仅图标的「高级搜索」按钮，hover 显示「高级搜索」提示
- **AND** 官方标题搜索功能行为不变

#### Scenario: 图标风格一致

- **WHEN** 入口按钮渲染
- **THEN** 图标为官方放大镜几何（16 viewBox、stroke 1.3、纯线条、无星标等装饰），与相邻官方关闭（X）按钮风格一致

#### Scenario: 缝失配降级

- **WHEN** 官方搜索框 DOM 结构与插件预期的锚点签名不匹配（如官方升级改版）
- **THEN** 插件记录 warn 级日志且不注入按钮，侧栏与搜索框功能不受影响、无未捕获异常

### Requirement: 高级搜索内容区视图

点击「高级搜索」按钮 SHALL 在主内容区（侧栏右侧）打开高级搜索视图——MUST NOT 是模态弹窗：MUST NOT 渲染全屏遮罩，侧栏 SHALL 保持可见且可交互。视图（界面以 prototype/ 为准）包含：header（标题 + 关闭 X）、主体区（初始态/分析过程/降级横幅/结果列表）与底部输入卡（会话内容描述自由文本，必填；可选开始/结束日期范围；「开始搜索」提交按钮）。描述为空时提交按钮 SHALL 不可用。关闭途径 SHALL 至少含 header X 与 Esc；关闭后再次点击按钮 SHALL 能重新打开且状态重置。内容区容器锚点失配时，SHALL 降级为右侧抽屉形态打开（仍非模态遮罩）并 warn 限流一次。视图文案 SHALL 为中文。

#### Scenario: 打开内容区视图

- **WHEN** 用户点击搜索框内的「高级搜索」图标按钮
- **THEN** 侧栏右侧内容区呈现高级搜索视图（header + 底部输入卡），侧栏保持可见可交互，无全屏遮罩

#### Scenario: 空描述不可提交

- **WHEN** 描述输入为空或仅空白字符
- **THEN** 提交按钮不可用

#### Scenario: 关闭后重开状态重置

- **WHEN** 用户关闭视图后再次点击「高级搜索」按钮
- **THEN** 视图重新打开，输入与结果状态重置为初始态，会话内容视图还原

#### Scenario: 锚点失配降级

- **WHEN** 内容区容器锚点与插件预期签名不匹配
- **THEN** 视图以右侧抽屉形态打开（非模态遮罩、侧栏可交互），记录 warn 限流日志

### Requirement: 分析任务发起与进度展示

用户提交搜索后，client 半 SHALL 经同源 HTTP API 向 host 半发起分析任务（POST），视图 SHALL 进入进度态并轮询任务状态，展示阶段性进度文案（至少区分：收集会话、预筛候选、agent 分析中）。分析为独立后台任务：MUST NOT 把搜索请求或分析过程写入、依赖或展示于当前会话的对话上下文。同一 client 同时最多一个在途任务；在途时再次提交 SHALL 取消前一个任务并开始新任务。用户关闭视图 SHALL 允许（任务可继续在后台完成或按实现取消，MUST NOT 阻塞或报错打断用户）。任务在途时视图 SHALL 提供中断途径（中断 = DELETE 在途任务），中断后视图 SHALL 回到初始态且不再轮询。

#### Scenario: 提交后进入进度态

- **WHEN** 用户填写描述（可含时间范围）并提交
- **THEN** 视图显示阶段性进度文案与过程步骤流，且当前会话的对话记录中不出现本次搜索的任何痕迹

#### Scenario: 重复提交取消前任务

- **WHEN** 上一个分析任务仍在进行时用户修改描述并再次提交
- **THEN** 前一个任务被取消（其结果不再被采用），新任务开始执行

#### Scenario: 中断在途任务

- **WHEN** 任务在途时用户点击中断按钮
- **THEN** 在途任务被 DELETE、轮询停止，视图回到初始态，不报错

### Requirement: LLM 语义分析与结果排序

host 半 SHALL 对候选集中每个会话的摘要信息（至少含标题、活动时间、工作区路径、首条用户消息节选）与用户描述做语义匹配，返回按匹配度排序的 Top-N（默认 5，配置项约束）候选，每个候选 MUST 附匹配理由与置信度。分析路由 SHALL 按「插件配置 `analyzeRoute {provider, model}` > profile 默认路由（agent-default-model）」的优先级解析。LLM 调用 SHALL 受硬性超时上限约束：deadline 到点 MUST 在上限加小余量内返回降级结果（等价 Promise.race 语义），MUST NOT 依赖底层流闭合，败者流 MUST NOT 产生 unhandled rejection。host 半装配提供凭证探针时，SHALL 在发起调用前校验路由 provider 的凭据（credential-ref 指向的环境变量）：缺失时 MUST NOT 发起调用、立即降级，原因分类为 `credential-missing`；探针缺失或形状漂移时 SHALL 跳过预检（不误杀，由超时上限兜底）。LLM 服务不可用、凭证缺失、调用失败或超时、输出解析失败时，SHALL 回退为机械评分排序并返回候选，且降级原因分类（`llm-missing`/`credential-missing`/`timeout`/`call-failed`/`parse-failed`）SHALL 贯通至轮询载荷（`degradedReason` 可选字段）；结果界面 SHALL 按原因展示中文降级横幅——`credential-missing` 横幅 MUST 含「前往模型设置配置凭证」与「仅重试 AI 分析」两个动作入口。无任何匹配时 SHALL 展示空态文案。

#### Scenario: 命中目标会话

- **WHEN** 用户描述「上周修登录功能的会话」且候选集中存在该会话（stub LLM 按既有匹配返回其排名第一）
- **THEN** 结果列表第一位为该会话，且附匹配理由与置信度

#### Scenario: 超时硬上限

- **WHEN** 底层 LLM 流在 pending 中永不闭合（stub：忽略取消信号、永不 resolve）
- **THEN** 超时上限到点后立即返回降级结果（原因 `timeout`），等待时长不超过上限加小余量，无 unhandled rejection

#### Scenario: 凭证缺失快速失败

- **WHEN** 路由 provider 的凭据环境变量缺失且凭证探针在位
- **THEN** 不发起 LLM 调用、立即返回降级结果（原因 `credential-missing`），界面横幅标注缺凭证原因并提供「前往模型设置配置凭证」「仅重试 AI 分析」入口

#### Scenario: 路由覆盖

- **WHEN** 插件配置存在 `analyzeRoute {provider, model}`
- **THEN** 语义分析调用使用配置的 provider/model，而非 profile 默认路由

#### Scenario: LLM 失败回退

- **WHEN** LLM 调用失败或超时
- **THEN** 接口仍返回机械评分排序的候选，结果界面按原因标注降级说明，功能不报错中断

#### Scenario: 无匹配空态

- **WHEN** 预筛与 LLM 分析后无任何候选
- **THEN** 视图展示中文空态文案（如「未找到匹配的会话」），不展示空列表错误

### Requirement: 结果展示与一键跳转

结果列表中每个候选 SHALL 展示：会话标题、所属工作区、活动时间、匹配理由与置信度标注（界面以 prototype/ 为准：置信度以可视化条呈现，AI 排序为蓝色渐变、机械回退为灰色）。用户点击任一候选 SHALL 关闭搜索视图并把主视图切换到该会话（与在侧栏点击该会话同效），跳转 MUST NOT 要求用户先手动切换到该会话所属工作区；跨工作区会话 SHALL 可直接跳转。

#### Scenario: 点击候选跳转

- **WHEN** 用户点击结果列表中的某个候选
- **THEN** 搜索视图关闭，主视图切换为该会话的对话内容

#### Scenario: 跨工作区跳转

- **WHEN** 选中的会话不属于当前激活工作区
- **THEN** 跳转仍然生效，主视图直接呈现该会话内容

## ADDED Requirements

### Requirement: 分析过程步骤流展示

host 半 SHALL 在任务推进时记录过程步骤（`progress[]`：`{step, detail?, at}`，有界保留最近 50 条）：至少覆盖查询解析、机械预筛完成（detail 含候选数量变化）、LLM 分析发起（detail 含 provider 与 model）、分析完成（detail 含置信度摘要或降级原因）；轮询载荷 SHALL 携带该数组（可选字段，向后兼容）。client 半 SHALL 在视图内按序渲染 agent 对话风格步骤流（完成/进行中/等待三态），并展示自提交时刻起的本地计时（逐秒刷新），MUST NOT 伪造 LLM 流式中间进度。

#### Scenario: 步骤流渲染

- **WHEN** 任务从收集、预筛推进到分析
- **THEN** 视图步骤流按序呈现各步骤及 detail（预筛候选数变化、分析调用的 provider·model），完成态与进行中态视觉可区分

#### Scenario: 计时展示

- **WHEN** 任务处于分析中
- **THEN** 视图展示自提交起的本地计时并逐秒刷新，不依赖宿主时钟
