## ADDED Requirements

### Requirement: loader 注册 patch 语法

dsh 插件向 profile `cordis.patch.yml` 注册新插件条目 SHALL 使用 `- insert:` 列表形式（裸 `- id:/name:` 是对既有条目的覆盖补丁，目标不存在时被 dsh 静默跳过——dsh-app-boot patchStructure：「Unknown targets … are warned and skipped」）。安装文档中该步骤的 YAML SHALL 与此语义一致，且文档声明的每个步骤 SHALL 经过真机实测。

#### Scenario: insert 形式注册生效

- **WHEN** 在 profile 的 `cordis.patch.yml` 追加 `- insert: [- id: <plugin>, name: <plugin>]` 并重启 dsh web
- **THEN** 插件 host 半随主进程装载（其远程/路由面可探测），client 半出现在 `/plugins/` 组合 bundle 中

#### Scenario: 裸 id 形式被跳过（已证伪口径）

- **WHEN** 仅以裸 `- id: <plugin>, name: <plugin>` 追加且该 id 不在既有插件树中，重启 dsh web
- **THEN** 插件 host 半不装载、client 半不出现在 bundle 清单（该行为即本次证伪的文档缺陷）

### Requirement: 非 loopback 访问前置

经非 loopback 主机名访问 dsh web 时（settings 镜像 memory 模式），settings 读写面整体不可用；安装文档 SHALL 声明此限制与社区插件 `dsh-plugin-loopback-trust`（engines `>=0.1.7 <0.3`，已实测 0.2.0-rc.2）的前置关系、安装命令与明文 HTTP 暴露的安全注记。依赖 settings 写入的插件（含 cc-import）在非 loopback 访问下 SHALL 在装好该前置后验收。

#### Scenario: 非 loopback 下 Models 页可用

- **WHEN** 浏览器经非 loopback 主机名访问已安装 loopback-trust 的 dsh web 并打开 Models 设置页
- **THEN** 无「加载提供商目录失败: settings are unavailable in this browser」横幅，提供商目录正常渲染

### Requirement: 隔离 profile 验证载体

真机验收 SHALL 使用隔离验证 profile 执行：临时 `DSH_HOME` + 独立端口启动 `dsh web`，以 `pnpm add link:` 链接待验插件构建产物、`cordis.patch.yml` 以 insert 形式注册；浏览器自动化经 playwright-cli 驱动；不触碰 live 实例（127.0.0.1:3080）的数据与进程。验证用临时状态（`/etc/hosts` 测试条目、浏览器会话）SHALL 在收尾清理；重启 live 实例属文档化人工步骤，SHALL NOT 作为实现任务。

#### Scenario: 隔离 profile 导入不污染 live

- **WHEN** 在隔离 profile 完成全量导入验收
- **THEN** live 实例（3080）的 settings/credentials 未变化，验证产物全部落在临时 `DSH_HOME` 内

### Requirement: bridge 真机验收清单执行

fenix-dsh-dashboard-bridge SHALL 在隔离 profile 上逐项执行可自动化验收项：侧栏 5 固定条目 + 项目条目与上游 API 一致、点击切换主面板 iframe 且深链正确（`/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/<view>`）、会话面板可回、静态资源与 POST 经前缀反代一致、上游停机 502 提示页且 dsh 其余功能不受影响、前缀外路径行为不变。发现缺陷 SHALL 同批修复并回归。

#### Scenario: 侧栏条目与深链

- **WHEN** 上游 dashboard（127.0.0.1:8787）运行时打开隔离 profile 的 dsh web
- **THEN** 侧栏出现 概览/项目/设置/运维/帮助 5 固定条目，项目条目与 `GET /fenix-dashboard/api/projects` 返回一致；点击各条目主面板切换为 iframe 且 src hash 为 `#/overview` / `#/projects` / `#/settings` / `#/activities` / `#/help`

#### Scenario: 上游停机 502 降级

- **WHEN** 停掉上游 dashboard 进程后刷新面板
- **THEN** 面板收到 502 与「Fenix Dashboard 未启动」提示页；dsh web 会话与设置功能不受影响；恢复上游后面板恢复正常

### Requirement: cc-import 真机验收清单执行

cc-import SHALL 在隔离 profile 上逐项执行真机验收：按钮可见、候选与 cc-switch 一致（10 可导入 + 1 跳过）、全选导入成功 10 失败 0、Models 新行密钥已配置、重复导入标「已存在」默认不勾选、显式「将更新」覆盖同 route 不产生 `-2` 副本。

#### Scenario: 重复导入覆盖语义

- **WHEN** 首轮导入 10 个后再次打开对话框，勾选其中 1 行的「将更新」并导入
- **THEN** 该 route 被同键覆盖（providers 中不出现 `-2` 后缀副本），其余 9 行不变

### Requirement: 安装文档与真机一致

两份安装文档（`docs/help/cc-import-install.md`、`docs/help/fenix-dashboard-bridge-install.md`）SHALL 修正为实测可行版本：workspace 注册写法（`pnpm add link:`）、loader 条目 insert 形式、loopback-trust 前置小节、live 实例刷新的人工步骤（重启即加载新构建）；新增隔离 profile 验证方法论文档（含 pkill 自匹配陷阱、临时 hosts 条目清理、token 从启动日志获取）。文档修正 SHALL 与本 SPEC 实测过程互为印证。

#### Scenario: 按文档从零重装可复现

- **WHEN** 依修正后文档在全新临时 profile 上执行安装步骤
- **THEN** 全部步骤无歧义可执行，插件装载且验收清单可走通
