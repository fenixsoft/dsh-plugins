## Deliverables

```yaml
- path: cc-import/package.json
  kind: new
- path: cc-import/tsconfig.json
  kind: new
- path: cc-import/tsdown.config.ts
  kind: new
- path: cc-import/vitest.config.ts
  kind: new
- path: cc-import/pnpm-lock.yaml
  kind: new
- path: cc-import/src/host/index.ts
  kind: new
- path: cc-import/src/host/scan.ts
  kind: new
- path: cc-import/src/shared/mapping.ts
  kind: new
- path: cc-import/src/client/index.ts
  kind: new
- path: cc-import/src/client/dialog.tsx
  kind: new
- path: cc-import/src/client/importer.ts
  kind: new
- path: cc-import/src/client/locales.ts
  kind: new
- path: cc-import/tests/cc-switch-fixture.ts
  kind: new
- path: cc-import/tests/host-scan.test.ts
  kind: new
- path: cc-import/tests/mapping.test.ts
  kind: new
- path: cc-import/tests/importer.test.ts
  kind: new
- path: cc-import/README.zh.md
  kind: new
- path: docs/help/cc-import-install.md
  kind: new
- path: .gitignore
  kind: modify
```

## 1. 包骨架与构建链

- [ ] 1.1 创建 `cc-import/package.json`：name `cc-import`、type module、devDependencies（typescript、tsdown、vitest、@types/react、react——版本对齐 dsh 0.2.0-rc.2 发行包所用基线）、`exports` 含 `.` 与 `./client`、`dsh: { client: { platform: "web", inject: [] } }` 起步骨架
- [ ] 1.2 创建 `cc-import/tsconfig.json`、`cc-import/tsdown.config.ts`（双入口 `src/host/index.ts` → `lib/index.js`、`src/client/index.tsx` → `lib/client.js`）、`cc-import/vitest.config.ts`；`pnpm install` 成功（`cc-import/pnpm-lock.yaml` 落库）且 `pnpm build` 产出两个入口
- [ ] 1.3 `.gitignore` 追加 `node_modules/`、`lib/`、`*.tsbuildinfo` 规则

## 2. Host 半：cc-switch 扫描

- [ ] 2.1 `cc-import/src/host/scan.ts`：`node:sqlite` 只读打开 `~/.cc-switch/cc-switch.db`，读 `providers` 表 `app_type='claude'` 行，解析 `settings_config` JSON env 块，产出候选 `{name, baseURL, model, hasToken, importable, skipReason?}`；db 缺失/缺表/坏 JSON 一律返回结构化错误（code + message），响应不含 token 明文
- [ ] 2.2 `cc-import/src/host/index.ts`：cordis 插件注册 typert Remote namespace `ccimport` 暴露 `scan` 方法（对齐 `@deepseek-ai/dsh-api-settings-controller` 的 Remote 注册形态），`pnpm build` 通过

## 3. 共享映射纯函数层

- [ ] 3.1 `cc-import/src/shared/mapping.ts`：实现 `slugifyRouteId(name)`、`resolveRouteIdConflict(id, existingKeys)`（`-2`/`-3` 递增）、`splitModelAlias(model)`（`[1M]` 后缀 → `{id, contextWindow: 1000000}`，无后缀不含 contextWindow）、`buildProviderProfile(candidate)`（`{displayName?, apiKeyEnv, api:"anthropic-messages", baseURL, models:[...]}`，`apiKeyEnv` 派生 `<ROUTE>_API_KEY`）；全部为无副作用纯函数

## 4. Client 半：注入与导入

- [ ] 4.1 `cc-import/src/client/importer.ts`：候选 → 写入计划构造（`writeSettings` ops `{op:"set", path:["providers",<id>], value:profile}` + `storeCredential` 调用参数），基于既有 providers 键集做冲突 id 解析与「已存在」态判定（纯函数，可单测）
- [ ] 4.2 `cc-import/src/client/dialog.tsx`：导入对话框组件——候选行（勾选框、名称/baseURL/模型摘要、状态标：可导入/已存在/跳过-原因）、已存在行默认不勾选、跳过行无勾选框、批次结果反馈（成功 N + 失败明细）
- [ ] 4.3 `cc-import/src/client/index.ts` + `cc-import/src/client/locales.ts`：`ctx.slots.inject("settings.models.footer", ...)` 注入「从 Claude Code 导入」按钮并挂对话框；`ctx.locale.register` 注册中英文案；导入执行走 `writeSettings(pi-ai ns, ops, expectedRevision)` + `storeCredential`，conflict 时重读快照重试一次，单项失败不阻断批次

## 5. 测试

- [ ] 5.1 `cc-import/tests/cc-switch-fixture.ts`：测试内用 `node:sqlite` 在临时路径生成含 claude/codex/gemini 混合行、缺字段行、`[1M]` 模型行的 fixture db（不提交二进制 db）
- [ ] 5.2 `cc-import/tests/host-scan.test.ts`：覆盖 spec 四个扫描 Scenario（只返回 claude 行、字段完整且无 token 明文、跳过标注、db 异常结构化错误）
- [ ] 5.3 `cc-import/tests/mapping.test.ts`：覆盖 `[1M]` 拆分、无后缀不设 contextWindow、id 冲突 `-2` 递增、缺失模型标 `missing_model`、profile 形态与 apiKeyEnv 派生
- [ ] 5.4 `cc-import/tests/importer.test.ts`：覆盖写入计划构造（set-only、勾选集之外零 ops、已存在判定、displayName 携带规则）；`pnpm test` 全绿

## 6. 文档与安装交付

- [ ] 6.1 `cc-import/README.zh.md`：插件用途、映射规则表、构建与测试命令
- [ ] 6.2 `docs/help/cc-import-install.md`：人工安装步骤（源码注册进 `/root/.dsh/profiles/web/` pnpm workspace → `cordis.patch.yml` 加 loader 条目 → 重启 `dsh web`）与真机验收清单（按钮可见 → 对话框候选与 cc-switch 一致 → 导出 2 个 provider → Models 页出现新行且密钥状态点绿色 → 既有 provider 未受影响），文末「人工步骤」小节明确这些动作不由实现 Agent 执行
