## Why

dsh web 的 Models 设置页要求手工逐个录入 provider（Provider ID / baseURL / 协议 / 模型 / API 密钥），而用户的 Claude Code provider 全量托管在 cc-switch（`~/.cc-switch/cc-switch.db`，本机 11 个 claude 形态 provider）。逐个重录一遍成本高且易错（密钥明文过手、模型别名 `[1M]` 后缀易踩网关别名陷阱），需要一个「从 Claude Code 导入」入口把这份清单自动装进 dsh。

## What Changes

- 新增 dsh 插件包 `cc-import`（本仓库首个插件，双半结构）：
  - Host 半：注册只读 Remote namespace `ccimport`，`scan` 方法用 `node:sqlite` 读 cc-switch.db 的 `providers` 表（`app_type='claude'`），解析 `settings_config` env 块返回候选列表；不做任何写入。
  - Client 半：经 `slots.inject("settings.models.footer", ...)` 在 Models 页注入「从 Claude Code 导入」按钮；对话框展示候选（勾选 / 已存在 / 跳过原因），确认后走官方写入路径 `writeSettings(pi-ai ns, [{op:"set", path:["providers",<id>], value:profile}], rev)` + `storeCredential(ref, key)`。
- 映射规则：route id 由 name slug 化（冲突加 `-2` 后缀）；`ANTHROPIC_BASE_URL` → `baseURL`；`ANTHROPIC_AUTH_TOKEN` → 只写凭据 `<ROUTE>_API_KEY`（patch 配置不落明文）；`ANTHROPIC_MODEL` → `models[0]`，`[1M]` 后缀拆出 `contextWindow: 1000000` 并从 id 剥离；协议恒 `anthropic-messages`。
- 跳过规则：无 baseURL 或无 AUTH_TOKEN 的候选（如 OAuth 型 Claude Official）标注原因，不导入。
- 幂等与只加不删：已存在的 route 默认不勾选并标「已存在」；导入是纯 `set` 追加，任何路径不 unset 既有 provider。
- 安装文档：人工安装步骤（pnpm 注册进 `/root/.dsh/profiles/web/` workspace + `cordis.patch.yml` loader 条目 + 重启 `dsh web`）落 `docs/help/`；真实 dsh web 的端到端人工验收步骤同文档。

## Capabilities

### New Capabilities

- `cc-import`: dsh web Models 页「从 Claude Code 导入」——cc-switch provider 扫描、映射、官方路径写入、只加不删幂等语义

### Modified Capabilities

（无——本工程为全新仓库，无既有能力。）

## Impact

- 本仓库新增 `cc-import/` 插件包源码与测试；不修改 dsh 本体、cc-switch、fenixd 框架代码。
- 运行时依赖：dsh 0.2.0-rc.2 的官方扩展面（client-modules 插件装载、slots 注入、settings Remote 写入、credentials 只写凭据）；cc-switch.db 只读（SQLite，`providers` 表）。
- 风界面：仅 dsh web Models 页 footer 新增一个按钮与对话框；不触碰既有 provider 数据（写入经官方 settings 路径且只有显式 `set`）。
- 部署：插件安装进 `/root/.dsh/profiles/web/`（人工步骤，见 docs/help），dsh web 重启后生效。
