## ADDED Requirements

### Requirement: Client 半真机激活

cc-import 的 client 半（`lib/client.js`）在 dsh web（0.2.0-rc.2）页面启动期 SHALL 激活成功：boot 阶段不产生 `entry did not activate` / `cc-import: failed` 类错误；激活后 Remote 贡献（`ccimport.scan` / `ccimport.revealToken`）、词典注册与 `settings.models.footer` slot 注入全部就位。缺陷根因 SHALL 在仓库源码层修复（不是绕过宿主），修复 SHALL 附可在隔离真机 profile 上重复执行的复现与验证路径。

#### Scenario: 真机 profile 启动零激活错误

- **WHEN** 在隔离验证 profile（临时 `DSH_HOME`、独立端口、链接 worktree 构建产物、`cordis.patch.yml` 以 `- insert:` 注册本插件）上启动 `dsh web`，并以浏览器打开页面
- **THEN** 浏览器控制台无任何插件激活失败报错；`/plugins/` 组合 bundle 请求包含 `cc-import/client.js`；「从 Claude Code 导入」按钮在 Models 页 footer 渲染

#### Scenario: 激活失败可观测

- **WHEN** client 半激活被拒绝（任意环节 reject）
- **THEN** 能通过隔离 profile 的浏览器控制台 / 启动日志定位到具体 reject 点（服务、模块或描述符名），而非仅 `failed` 一词

## MODIFIED Requirements

### Requirement: Models 页导入入口

client 半 SHALL 经 `slots.inject("settings.models.footer", ...)` 在 dsh web Models 设置页 footer 注入「从 Claude Code 导入」按钮；点击打开候选对话框：每行含勾选框、名称 / baseURL / 模型摘要、状态标（可导入 / 已存在 / 跳过-原因）。文案 SHALL 经 `ctx.locale.register` 注册中英双语。真机口径：上述行为 SHALL 在 dsh web 0.2.0-rc.2 的隔离验证 profile 上端到端成立（候选来自真实 `~/.cc-switch/cc-switch.db`，导入写入落在该隔离 profile 自身的 settings/credentials，不触碰 live 实例数据）。

#### Scenario: 按钮出现于 Models 页

- **WHEN** 插件已启用且用户打开 dsh web 的 Models 设置页
- **THEN** 页面 footer 区域渲染「从 Claude Code 导入」按钮；插件禁用时按钮不出现且页面无报错

#### Scenario: 对话框状态标注

- **WHEN** 打开对话框且 `scan` 返回混合结果（可导入 2、已存在 1、跳过 1）
- **THEN** 四行分别渲染对应状态；跳过行无勾选框；可导入行默认勾选；已存在行默认不勾选

#### Scenario: 真机导入闭环（隔离 profile）

- **WHEN** 在隔离验证 profile 上打开对话框（本机 cc-switch 为 11 行 claude：10 可导入 + 1 缺 token 跳过），全选可导入并确认导入
- **THEN** 结果反馈成功 10、失败 0；Models 页出现 10 个新 provider 行且密钥状态为已配置（凭据已入该隔离 profile 的凭据库）；再次打开对话框时这 10 行默认不勾选并标「已存在」
