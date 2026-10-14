# cc-import 插件安装与真机验收

`cc-import` 把 cc-switch 托管的 Claude Code provider 导入 dsh Models 设置页。本文记录**人工安装步骤**与**真机验收清单**；这些动作发生在本仓库之外的运行环境（`/root/.dsh/profiles/web/`），不由实现 Agent 执行。

## 前置条件

- dsh ≥ 0.2.0-rc.2（双面插件 loader）。
- Node ≥ 24（Host 半使用内置 `node:sqlite` 只读 cc-switch）。
- `~/.cc-switch/cc-switch.db` 存在且至少有一个含 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + 模型的 claude 行。
- `cc-import/` 已构建：`cd cc-import && pnpm install && pnpm build`，产出 `lib/index.js` 与 `lib/client.js`。

## 人工步骤（不由实现 Agent 执行）

1. **注册进 web profile 的 pnpm workspace**：把本仓库的 `cc-import/` 目录链接或复制进 `/root/.dsh/profiles/web/` 的 pnpm workspace（与其余 client 插件包同层，纳入该 profile 的 `pnpm-workspace.yaml` globs），并在该 profile 下执行 `pnpm install` 使 workspace 识别新包。
2. **加 loader 条目**：编辑该 profile 的 `cordis.patch.yml`，在插件 loader 清单中追加：

   ```yaml
   - id: cc-import
     name: cc-import
   ```

3. **重启**：`dsh web` 重启后打开 Web 界面（Host 半随主进程装载，Client 半 `lib/client.js` 由前端 ModuleLoader 注入）。

## 真机验收清单

按顺序逐项确认：

1. **按钮可见**：设置 → Models 页底部出现「从 Claude Code 导入」按钮。
2. **对话框候选与 cc-switch 一致**：点击按钮，对话框候选列表与 `sqlite3 ~/.cc-switch/cc-switch.db "SELECT name FROM providers WHERE app_type='claude'"` 一致（评审时实测该机 cc-switch 为 11 行 claude：10 个可导入——含 OpenCodeGo / bytedance-volces / bigmodel.cn 等，唯一跳过为缺 `ANTHROPIC_AUTH_TOKEN` 的 OAuth 型「Claude Official」）。
3. **导出全部可导入候选**：全选 → 导入，结果反馈「成功导入 10 个」且无失败明细。
4. **Models 页出现新行且密钥状态点绿色**：每个导入候选在 Models 列表出现为新 provider 行（api = Anthropic Messages），密钥状态点为绿色（凭据已入凭据库，而非 settings 文件）。
5. **既有 provider 未受影响**：导入前已配置的 provider 行原样保留（cc-import 只产生 `set` op，不 unset、不整体替换 `providers`）。
6. **重复导入行为**：再次打开对话框，已存在行默认不勾选并标「已存在」；显式勾选「将更新」后导入，同名 route 被覆盖而不是出现 `-2` 副本。
