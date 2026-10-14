# cc-import

把 [cc-switch](https://github.com/farion1231/cc-switch) 托管的 Claude Code provider 一键导入 dsh 的 Models 设置页（pi-ai provider），复用 dsh 官方「自定义模型 API」写入路径。

## 插件形态

dsh 0.2.0-rc.2 双面插件：

- **Host 半**（`src/host/`，`lib/index.js`，Node ESM）：注册只读 Typert Remote namespace `ccimport`，提供
  - `scan()`：只读扫描 `~/.cc-switch/cc-switch.db`（`providers` 表 `app_type='claude'` 行），产出候选 `{name, baseURL, model, hasToken, importable, skipReason?}`——**响应不含 token 明文**；
  - `revealToken(providerName)`：导入确认后按候选名读取 `ANTHROPIC_AUTH_TOKEN` 明文，专供 client 半走 `storeCredential` 官方落库路径；Host 半自身不实现任何写入方法。
- **Client 半**（`src/client/`，`lib/client.js`，浏览器 CJS）：向 Models 设置页 `settings.models.footer` 插槽注入「从 Claude Code 导入」按钮，打开导入对话框（勾选候选 → 批量导入）。

## 映射规则

| cc-switch 字段 | dsh pi-ai 字段 | 规则 |
| --- | --- | --- |
| `name` | route id | slug 化：小写、非 `[a-z0-9-]` 折叠为 `-`、去首尾 `-`（`bigmodel.cn` → `bigmodel-cn`）；与既有 providers 键冲突时加 `-2`/`-3` 递增后缀 |
| `name` | `displayName` | 仅当 slug ≠ 原名时携带原名 |
| `settings_config.env.ANTHROPIC_BASE_URL` | `baseURL` | 必填，缺失标 `missing_base_url` 跳过 |
| `settings_config.env.ANTHROPIC_AUTH_TOKEN` | 凭据库 `<ROUTE>_API_KEY` | 必填，缺失标 `missing_token` 跳过；不进 settings 文件 |
| `env.ANTHROPIC_MODEL`，缺失回退 `env.ANTHROPIC_DEFAULT_OPUS_MODEL` | `models[]` | 两键均空标 `missing_model` 跳过；`xxx[1M]` 后缀拆为 `{id: "xxx", contextWindow: 1000000}`，无后缀只给 `id` |
| — | `api` | 固定 `anthropic-messages` |

## 导入语义

- 写入走官方路径：`writeSettings("llm-pi-ai", [{op:"set", path:["providers",<id>], value:profile}], expectedRevision)` → `storeCredential(<ROUTE>_API_KEY, token)`。
- **只加不删**：只产生 `set` op，不 unset、不整体替换 `providers`；对 dsh 既有 provider 零影响。
- 重复导入同 slug：默认写 `-2` 新 route；对话框中对已存在行显式勾选「将更新」才同键覆盖。
- conflict 时重读快照重试一次；单项失败记入失败明细，不阻断批次。

## 构建与测试

```bash
cd cc-import
pnpm install        # 生成 pnpm-lock.yaml
pnpm build          # tsdown 双入口 → lib/index.js + lib/client.js
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest（37 个用例：扫描四场景 / 映射规则 / 写入计划）
```

环境要求：Node ≥ 24（内置 `node:sqlite`）、pnpm ≥ 10。

测试不依赖真实 cc-switch：`tests/cc-switch-fixture.ts` 用 `node:sqlite` 在临时目录生成 fixture db（claude/codex/gemini 混合行、缺字段行、`[1M]` 模型行）。联调真实库可用环境变量 `CC_IMPORT_CC_SWITCH_DB` 覆盖默认路径。

## 安装

见 [docs/help/cc-import-install.md](../docs/help/cc-import-install.md)。
