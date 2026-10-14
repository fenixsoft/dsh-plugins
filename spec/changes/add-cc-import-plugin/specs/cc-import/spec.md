## ADDED Requirements

### Requirement: Host 扫描候选

插件 Host 半 SHALL 提供只读 Remote 方法 `ccimport.scan`：用 `node:sqlite` 只读打开 `~/.cc-switch/cc-switch.db`，取 `providers` 表中 `app_type='claude'` 的全部行，解析 `settings_config` JSON 的 `env` 块，返回候选数组。Host 半 SHALL NOT 实现任何写入方法。

#### Scenario: 只返回 claude 形态行

- **WHEN** cc-switch.db 同时含 `app_type` 为 `claude`（11 行）、`codex`（1 行）、`gemini`（1 行）的 providers
- **THEN** `scan` 返回的候选仅来自 `claude` 行，codex/gemini 行不出现

#### Scenario: 候选字段完整

- **WHEN** 某行 `settings_config.env` 同时含 `ANTHROPIC_BASE_URL` 与 `ANTHROPIC_AUTH_TOKEN`
- **THEN** 该候选含 `name`、`baseURL`、`model`（`ANTHROPIC_MODEL`，缺失回退 `ANTHROPIC_DEFAULT_OPUS_MODEL`，可为 null）与 `hasToken: true`，且响应中 SHALL NOT 含 token 明文（只报存在性）

#### Scenario: 不完整候选标跳过

- **WHEN** 某行缺 `ANTHROPIC_BASE_URL` 或缺 `ANTHROPIC_AUTH_TOKEN`（如 OAuth 型「Claude Official」）
- **THEN** 该候选 `importable: false` 且带机器可读原因（`missing_base_url` / `missing_token`）

#### Scenario: db 异常结构化报错

- **WHEN** cc-switch.db 不存在、无法打开或 `providers` 表缺失
- **THEN** `scan` 返回结构化错误（code + message），不抛未捕获异常；client 对此弹提示且不崩页面

### Requirement: 映射规则

client 由候选构造 dsh pi-ai provider profile 时 SHALL 遵循：route id = name slug 化（非 `[a-z0-9-]` 字符折叠为 `-`、小写、去首尾 `-`）；id 与既有 providers 键冲突时追加数字后缀（`-2`、`-3`…）；profile 形态 `{ displayName?, apiKeyEnv, api: "anthropic-messages", baseURL, models: [...] }`；候选模型 SHALL 取 `env.ANTHROPIC_MODEL`，缺失时回退 `env.ANTHROPIC_DEFAULT_OPUS_MODEL`，两者均空才标 `missing_model`；`[1M]` 后缀拆分 SHALL 适用于任何来源键的模型值；协议恒 `anthropic-messages`。

#### Scenario: `[1M]` 别名拆分

- **WHEN** 候选 model 为 `glm-5.3-flash[1M]`
- **THEN** 生成模型行 `{ id: "glm-5.3-flash", contextWindow: 1000000 }`，id 不含 `[1M]` 后缀

#### Scenario: 模型键回退

- **WHEN** 候选 `env` 无 `ANTHROPIC_MODEL` 但 `ANTHROPIC_DEFAULT_OPUS_MODEL` 为 `glm-5.3-flash[1M]`
- **THEN** 生成模型行 `{ id: "glm-5.3-flash", contextWindow: 1000000 }`，候选不标 `missing_model`

#### Scenario: 普通模型不设上下文窗

- **WHEN** 候选 model 为 `deepseek-v4-pro`（无后缀）
- **THEN** 模型行为 `{ id: "deepseek-v4-pro" }`，不含 `contextWindow` 字段

#### Scenario: id 冲突加后缀

- **WHEN** 目标 route id `bigmodel-cn` 已存在于 dsh providers，且又有一个同名候选待导入
- **THEN** 实际写入 id 为 `bigmodel-cn-2`；仍冲突则继续 `-3`

#### Scenario: 空模型保底

- **WHEN** 候选 `ANTHROPIC_MODEL` 与 `ANTHROPIC_DEFAULT_OPUS_MODEL` 均为 null 或空
- **THEN** 生成占位模型行（id 为空串的候选行不得写入——该候选标 `importable: false`，原因 `missing_model`）

### Requirement: Models 页导入入口

client 半 SHALL 经 `slots.inject("settings.models.footer", ...)` 在 dsh web Models 设置页 footer 注入「从 Claude Code 导入」按钮；点击打开候选对话框：每行含勾选框、名称 / baseURL / 模型摘要、状态标（可导入 / 已存在 / 跳过-原因）。文案 SHALL 经 `ctx.locale.register` 注册中英双语。

#### Scenario: 按钮出现于 Models 页

- **WHEN** 插件已启用且用户打开 dsh web 的 Models 设置页
- **THEN** 页面 footer 区域渲染「从 Claude Code 导入」按钮；插件禁用时按钮不出现且页面无报错

#### Scenario: 对话框状态标注

- **WHEN** 打开对话框且 `scan` 返回混合结果（可导入 2、已存在 1、跳过 1）
- **THEN** 四行分别渲染对应状态；跳过行无勾选框；可导入行默认勾选；已存在行默认不勾选

### Requirement: 官方路径写入

导入选中项 SHALL 逐个执行：`writeSettings(pi-ai namespace, [{op:"set", path:["providers", <routeId>], value: profile}], expectedRevision)` 写 profile，再 `storeCredential("<ROUTE>_API_KEY", token)` 写密钥（token 仅进凭据库）。任何一步 SHALL NOT 调用 `unset`、SHALL NOT 整体替换 providers 命名空间。

#### Scenario: 写入不含明文密钥

- **WHEN** 导入成功完成
- **THEN** settings namespace 中该 route 的值不含 token 明文，`apiKeyEnv` 指向派生凭据引用；token 仅存在于凭据库

#### Scenario: revision 冲突重试

- **WHEN** `writeSettings` 返回 conflict
- **THEN** 重读 settings 快照并重试一次；再冲突则对该候选展示 Host 诊断信息并继续处理其余候选（不中断批次）

#### Scenario: 单项失败不阻断批次

- **WHEN** 批量导入中某候选写入失败
- **THEN** 其余候选继续导入；结束后反馈「成功 N 个 + 失败明细（候选名 + 原因）」

### Requirement: 只加不删幂等

导入语义 SHALL 为纯追加：导入前后，除新写入的 route 键外，pi-ai providers 命名空间其余键值 SHALL 逐字节不变。

#### Scenario: 既有 provider 不受影响

- **WHEN** dsh 已有 provider A、B，导入候选 C
- **THEN** 导入后 A、B 的配置与凭据引用不变，新增 C；无任何 unset / 删除调用

#### Scenario: 重复导入为覆盖更新

- **WHEN** 对已存在的 route 再次导入同名候选（用户显式勾选「将更新」）
- **THEN** 仅 `set` 覆盖该 route 键，不报错，其余键不变；凭据引用同 ref 覆盖

#### Scenario: 勾选集之外的键零写入

- **WHEN** 用户仅勾选候选 C（对话框列出 5 个可导入）
- **THEN** 本次会话对 settings 的写入 ops 仅含 C 一条 `set`；未勾选候选不产生任何写调用
