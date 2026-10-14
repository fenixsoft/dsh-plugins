## Why

cc-import 与 fenix-dsh-dashboard-bridge 两个 dsh 插件已完成实现与 mock 级验证，但真机（dsh web 0.2.0-rc.2）安装验证发现硬缺陷：cc-import 的 client 半在页面启动期激活失败（控制台报 `web boot: 1 entry did not activate / cc-import: failed`），导入入口完全不可用；同时真机安装过程中证伪了两份安装文档的关键步骤（loader 条目裸 `- id:/name:` 写法被 dsh patch 语义「unknown targets … skipped」静默跳过，实测必须用 `- insert:` 列表），且非 loopback 访问场景依赖社区插件 `dsh-plugin-loopback-trust` 这一前置从未被记录。bridge 的真机验收清单 12 项尚未逐项执行。本 SPEC 在真机环境闭环：查明并修复激活缺陷、逐项执行两插件真机验收、把文档修正为实测可行版本。

## What Changes

- 修复 cc-import client 半激活失败：在真机形态的隔离 dsh profile（临时 `DSH_HOME` + 独立端口 + worktree 构建产物）中复现、定位根因（初步证据指向 `apply` 内 `remote.$mount(TYPERT_REMOTE)` / locale 注册 / slot 注入链路之一在浏览器启动期 reject），修复并加回归防护
- 执行 fenix-dsh-dashboard-bridge 真机验收清单（侧栏条目 / iframe 深链 / 同源反代 / SSE / 502 降级 / 前缀外不接手等可自动化项），发现缺陷同批修复
- 执行 cc-import 真机验收清单（按钮可见 / 候选与 cc-switch 一致 / 全量导入 / Models 行 + 凭据绿点 / 重复导入幂等），在隔离 profile 上完成导入闭环（不触碰 live 实例数据）
- 修正 `docs/help/cc-import-install.md` 与 `docs/help/fenix-dashboard-bridge-install.md`：loader 条目改 `- insert:` 形式、补 `dsh-plugin-loopback-trust` 前置依赖（非 loopback 访问必需）与明文 HTTP 安全注记、按实测修正 pnpm workspace 注册写法（`pnpm add link:`）
- 新增真机验证方法论文档：隔离 profile 验证载体（临时 DSH_HOME + playwright-cli）的操作步骤与注意事项（pkill 自匹配陷阱、/etc/hosts 测试条目清理、token 从启动日志获取）

## Capabilities

### New Capabilities

- `dsh-plugin-rollout`: dsh 插件真机安装与验收能力——loader 注册的正确 patch 语法（insert 形式）、非 loopback 访问的 loopback-trust 前置、隔离 profile 验证载体、两插件真机验收清单的可自动化执行口径

### Modified Capabilities

- `cc-import`: 新增「client 半在 dsh web 启动期零激活错误」要求（现有能力只覆盖到 mock 层，真机激活失败暴露缺口）；验收场景从「对 mocks 的 ops 构造」扩展到「隔离真机 profile 的按钮可见 + 导入闭环」

## Impact

- `cc-import/src/client/`（激活缺陷修复，预计 `index.ts` 的 apply / $mount 链路）、`cc-import/tests/`（回归防护）
- `fenix-dsh-dashboard-bridge/src|tests/`（若验收发现缺陷）
- `docs/help/cc-import-install.md`、`docs/help/fenix-dashboard-bridge-install.md`（步骤修正）
- 运行环境（仓库外，不作为本仓交付物）：`/root/.dsh/profiles/web/`（已由人工完成 link + insert 注册 + loopback-trust 安装）、live dsh web 进程（127.0.0.1:3080，frp 经 home.icyfenix.cn 暴露）、上游 Fenix Dashboard（127.0.0.1:8787）
