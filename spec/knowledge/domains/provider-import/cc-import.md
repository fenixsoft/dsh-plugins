# cc-import：cc-switch Provider 导入 dsh web
<!-- knowledge: capability=cc-import rev=3
     sources=spec/archive/2026-10-30-add-cc-import-plugin -->

cc-import 是 dsh web Models 设置页的「从 Claude Code 导入」能力：扫描本机 cc-switch（`~/.cc-switch/cc-switch.db`）托管的 claude 形态 provider，映射为 dsh pi-ai provider profile，经 dsh 官方写入路径装入，支持初始导入与后续增量导入。

## 规则

### 扫描（ccimport.scan）

- Host 半注册只读 Remote namespace `ccimport`：`scan` 用 `node:sqlite` 只读打开 `~/.cc-switch/cc-switch.db`，取 `providers` 表中 `app_type='claude'` 的全部行，解析 `settings_config` JSON 的 `env` 块返回候选数组；codex / gemini 形态行不返回。
- Host 半不实现任何写入方法，对 dsh settings 与 cc-switch.db 均零写权限。
- 候选响应只报 token 存在性（`hasToken`），不含 token 明文。
- 缺 `ANTHROPIC_BASE_URL` 或 `ANTHROPIC_AUTH_TOKEN` 的候选（如 OAuth 型 Claude Official）标 `importable: false` 并带机器可读原因 `missing_base_url` / `missing_token`，不导入。
- cc-switch.db 不存在、无法打开或 `providers` 表缺失时，`scan` 返回结构化错误（code + message），不抛未捕获异常；client 据此弹提示且不崩页面。

### 映射规则

- route id = 候选 name slug 化：非 `[a-z0-9-]` 字符折叠为 `-`、转小写、去首尾 `-`；与既有 providers 键冲突时追加数字后缀（`-2`、`-3`…）。
- profile 形态为 `{ displayName?, apiKeyEnv, api: "anthropic-messages", baseURL, models: [...] }`，协议恒为 `anthropic-messages`。
- 候选模型取 `env.ANTHROPIC_MODEL`，缺失回退 `env.ANTHROPIC_DEFAULT_OPUS_MODEL`，两者均为空的候选标 `missing_model`，不导入（dsh profile 要求至少一个模型行）。
- `[1M]` 后缀拆分适用于任何来源键的模型值：`glm-5.3-flash[1M]` 生成模型行 `{ id: "glm-5.3-flash", contextWindow: 1000000 }`；无后缀的模型行不含 `contextWindow` 字段。
- 凭据引用派生为 `<ROUTE>_API_KEY`（ROUTE 为大写化的 route id），与 dsh 官方「自定义模型 API」表单同款，Models 页密钥状态点因此直接可用。

### Models 页导入入口

- client 半经 `slots.inject("settings.models.footer", ...)` 在 Models 设置页 footer 注入「从 Claude Code 导入」按钮；插件禁用时按钮不出现且页面无报错。
- 对话框每行含勾选框、名称 / baseURL / 模型摘要与状态标：可导入行默认勾选；已存在行默认不勾选；跳过行无勾选框并展示原因。
- 全部文案经 `ctx.locale.register` 注册中英双语。

### 写入语义

- 导入选中项逐个执行两步：先 `writeSettings(pi-ai namespace, [{op:"set", path:["providers", <routeId>], value: profile}], expectedRevision)` 写 profile，再 `storeCredential("<ROUTE>_API_KEY", token)` 写密钥；token 仅进凭据库，settings 中不含明文。
- 写入只允许显式 `set`：任何路径不调用 `unset`，不整体替换 providers 命名空间。
- `writeSettings` 返回 conflict 时重读 settings 快照重试一次；再冲突则展示诊断信息并继续处理其余候选。
- 批次内单项失败不阻断批次；结束后反馈成功数量与失败明细（候选名 + 原因）。

### 幂等与只加不删

- 导入是纯追加：导入前后除新写入的 route 键外，pi-ai providers 命名空间其余键值逐字节不变。
- 已存在候选默认不勾选并标「已存在」；用户显式勾选再次导入时仅 `set` 覆盖该 route 键，凭据同 ref 覆盖。
- 勾选集之外的候选零写入：本次会话的写入 ops 仅含勾选项的 `set`。

### 能力边界

- 只做单向导入（cc-switch → dsh）：不回写 cc-switch，不做双向同步，不做凭据轮换或迁移改造，不提供 provider 编辑 / 删除 UI。

### 部署与验收

- 插件安装位为 `/root/.dsh/profiles/web/`：注册进 pnpm workspace、在 `cordis.patch.yml` 增加 loader 条目、重启 dsh web 后生效；人工安装与真机验收步骤见 `docs/help/cc-import-install.md`。
- client 半的 `lib/client.js` 必须在安装前构建完成，缺失则插件激活即报错。
- 真机端到端验收（按钮可见、候选与 cc-switch 一致、新导入行密钥状态点绿色、既有 provider 不受影响）为人工步骤，不由实现 Agent 执行。

## 关键行为

1. 打开 Models 页 → 点击「从 Claude Code 导入」→ client 调 `ccimport.scan` 拿候选，同时从 settings 快照读既有 providers 键集做「已存在」标态。
2. 用户勾选并确认 → client 逐个构造 profile，按映射规则定 route id，先写 profile 后写凭据；conflict 重试一次，单项失败继续。
3. 批次结束反馈「成功 N 个 + 失败明细」；再次打开对话框时已导入候选标「已存在」，只见增量。

## 溯源

- 2026-10-30 add-cc-import-plugin（归档：`spec/archive/2026-10-30-add-cc-import-plugin`）— 新建本页：扫描 / 映射 / 导入入口 / 写入 / 幂等 / 部署验收全部规则的初始蒸馏。
