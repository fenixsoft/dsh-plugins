## Context

用户同时使用 Claude Code（provider 由 cc-switch 统一托管，SQLite 库 `~/.cc-switch/cc-switch.db`）与 dsh（DeepSeek Harness 0.2.0-rc.2，web GUI 的 Models 设置页管理 provider）。两侧 provider 清单重复，dsh 侧逐个手工录入成本高且易踩坑（密钥明文过手；`[1M]` 别名后缀是已知网关别名陷阱）。dsh 提供官方第三方插件机制：插件包经 `package.json` 的 `dsh.client` 声明（`platform: "web"` + `exports["./client"]`）由 host 装载到 `/plugins` 懒加载；client 侧有 slots 注入（已验证 Models 页暴露 `settings.models.footer` 等命名 slot）与 settings Remote 写入（已验证「自定义模型 API」表单的写入形态 `writeSettings(ns, [{op:"set", path:["providers",<id>], value:profile}], rev)` + `storeCredential`）。cc-switch 无对应导入功能（其 cc-switch 支持工具列表不含 dsh，feature request #6430 仍开放）。

已用真实代码验证的契约：
- cc-switch.db：`providers(id, app_type, name, settings_config, category, created_at…)`；claude 行的 `settings_config.env` 含 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`（各 10/11）；`ANTHROPIC_MODEL` 仅 2/11 行在册，带 `[1M]` 后缀的模型别名实测全在 `ANTHROPIC_DEFAULT_SONNET/OPUS/FABLE_MODEL` 键（10/11 行有 `ANTHROPIC_DEFAULT_OPUS_MODEL`，如 bigmodel.cn 为 `glm-5.3-flash[1M]`）。
- dsh client 插件：`ctx.slots.inject(slotName, factory)`；`ctx.locale.register(ns, {zh, en})`；服务经 cordis fiber inject（`remote`、`remote.settings`、`remote.credentials` 等）。
- Host 插件：cordis 插件注册 typert Remote namespace（先例 `@deepseek-ai/dsh-api-settings-controller`）。
- 安装位：`/root/.dsh/profiles/web/`（pnpm workspace + `cordis.patch.yml` loader 条目，样例 `ui-settings-general` 条目在册）。

## Goals / Non-Goals

**Goals:**
- dsh web Models 页一键把 cc-switch 的 claude 形态 provider 导入 dsh（只加不删）
- 全程走 dsh 官方扩展点与官方写入路径；密钥只进凭据库，patch 配置零明文
- 可重复增量导入：cc-switch 新增 provider 后再次导入只见新候选
- 插件包可构建、可单测、可独立演进（本仓库后续可加更多 dsh 插件）

**Non-Goals:**
- 不做 codex / gemini 形态 provider 导入（cc-switch 中存在但协议不同，本期只做 claude / anthropic-messages）
- 不做「从 dsh 回写 cc-switch」或双向同步
- 不做 provider 编辑 / 删除 UI（dsh Models 页已有编辑器）
- 不修改 dsh 本体、cc-switch、fenixd 框架的任何代码
- 不做凭据迁移（已存 token 原样复制到 dsh 凭据库，不做轮换/加密改造）

## Decisions

1. **单包双半**：`cc-import/` 一个插件包同时含 Host 半（cordis 插件，注册只读 `ccimport.scan`）与 Client 半（`dsh.client` web bundle，slot 注入 + 写入驱动）。dsh 插件装载机制天然支持一包双端；分两包会凭空增加安装面。
2. **写入权在 client 半**：扫描（host）与写入（client）分离。client 走与「自定义模型 API」表单完全相同的 `writeSettings` + `storeCredential` 官方路径，Host 半零写权限——最小权限，且 dsh 升级时写入契约变化由官方 UI 同款代码路径承担。
3. **协议恒 `anthropic-messages`**：cc-switch 的 claude 行全部是 Anthropic 兼容端点（11/11），pi-ai 原生支持该协议；OpenAI 形态导入留待后续 SPEC。
4. **候选模型解析链与 `[1M]` 后缀拆分**：候选模型取 `ANTHROPIC_MODEL`，缺失回退 `ANTHROPIC_DEFAULT_OPUS_MODEL`（评审实测：9/11 行无前者、10/11 行有后者，回退后可导入 10/11 而非仅 2），仍为空才标 `missing_model`。`glm-5.3-flash[1M]` → `{id:"glm-5.3-flash", contextWindow:1000000}`，拆分适用于任何来源键的值。理由：dsh 模型行有显式 `contextWindow` 字段；直接透传别名 id 会踩网关别名不识别陷阱（fenixd 实证）。
5. **凭据引用派生 `<ROUTE>_API_KEY`**：与 dsh 官方「自定义模型 API」表单同款派生规则，Models 页的密钥状态点（绿/红）因此直接可用。
6. **幂等策略 = 读后标态 + 纯 set 追加**：打开对话框时从 settings 快照读既有 providers 键集，已存在的候选默认不勾选标「已存在」；写入仅显式 `set`，批次中任何失败不回滚已成功项。
7. **SQLite 访问用 `node:sqlite`**：Node 24 内置，零新增原生依赖（dsh 插件原生依赖需 allowlist，能不加就不加）。
8. **构建用 tsdown**：dsh client-modules 的官方构建要求（`lib/client.js` 必须已构建，缺失则激活即报错）；Host 半 `lib/index.js` 同链路。
9. **真实 dsh web 的端到端验收为人工步骤**：worktree 隔离的 Agent 不能写 `/root/.dsh/profiles/web/`（仓库外路径），故自动化测试覆盖到「对 mocks 的 client 写入 ops 构造 + host 扫描全分支」，真机安装/按钮可见/实导出一轮由用户按 `docs/help/cc-import-install.md` 执行。

## Risks / Trade-offs

- **dsh 无正式第三方 client 插件 API 文档，契约靠读发行包源码钉死**→ 缓解：设计中每个契约点都经真实代码验证（slot 名、writeSettings 形态、manifest 字段）；实现时若发现契约与本文档不符，以发行包实际行为为准并在 `.fenix-run-result.json` 记录偏差。
- **cc-switch.db schema 无稳定性承诺**（第三方桌面应用，升级可能改表）→ 缓解：`scan` 对缺表/缺列返回结构化错误而非崩溃；SQL 只读打开；解析层对 `settings_config` 做 JSON 容错。
- **Models 页 slot 名（`settings.models.footer`）可能随 dsh 升级改名**→ 后果可控：slot 不存在时注入不生效，按钮消失但页面不崩；重装适配成本低。
- **凭据库写失败但 profile 已写**（两步写的一致性）→ 与官方表单同序（先 profile 后凭据），失败信息原样透出，用户重导同一候选即收敛（幂等覆盖）。
- **两个模型键（`ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL`）均缺失的候选不能导**（dsh profile 要求至少一个模型）→ 标 `missing_model` 跳过，UI 说明可先在 cc-switch 补模型再导（评审实测本机 11 行中无行落到此态；唯一被跳过的是缺 `ANTHROPIC_AUTH_TOKEN` 的 OAuth 型「Claude Official」）。
