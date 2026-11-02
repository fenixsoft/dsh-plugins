## MODIFIED Requirements

### Requirement: 侧栏固定菜单条目
Client 半 SHALL 向 `sidebar.panellist` 列表插槽注册 6 个固定条目，id 与深链一一对应：`fenix-overview→#/overview`、`fenix-command-center→#/command-center`、`fenix-projects→#/projects`、`fenix-settings→#/settings`、`fenix-activities→#/activities`、`fenix-help→#/help`；label 为对应中文名（概览/指挥中心/项目/设置/运维/帮助），order 取 10–15（指挥中心位于概览之后、项目之前，其余顺延）；每个条目 SHALL 配同风格线性图标（24×24 viewBox stroke 风格）并在 layout `main` keyed 插槽以相同 id 注册 iframe 面板。

#### Scenario: 固定条目可见
- **WHEN** 插件 client 半装载完成
- **THEN** dsh web 侧栏出现 6 个条目，图标 + 中文名，顺序位于 dsh web 既有条目之后，「指挥中心」位于「概览」与「项目」之间

#### Scenario: 点击切换主面板
- **WHEN** 用户点击「指挥中心」条目
- **THEN** 主面板切换为指挥中心 iframe（src 契约为 `<prefix>/?embed=1&apiBase=<apiBase>#/command-center`），dsh web 会话面板经 conversation 保留键仍可回到对话

### Requirement: 每项目动态条目
Client 半 SHALL 启动时经 `<prefix>/api/projects` 拉取项目列表，项目 SHALL NOT 逐个注册为顶层侧栏条目，SHALL 以**侧栏内嵌分区**展示：经 React Portal 把「项目」分区插入 dsh 侧栏条目列表（`nav`）与「工作区」区域（`regionArea`）之间的兄弟位，视觉与交互参照官方「工作区」区域——常驻内嵌（非下拉浮层）、每项目一行为首字母徽标 + 项目名、分区列表 SHALL 有最大高度并以内部滚动容纳超出行数、随侧栏宽窄态适配（窄态仅显徽标）。分区容器 SHALL NOT 渲染边框（无 border 线，与官方「工作区」区域的无边框视觉一致；背景与圆角不受此约束）；降级路径浮层分组列表的边框不受本约束（浮层叠加在内容上方需要分界）。点击项目行 SHALL 把主面板切换为该项目 iframe（深链 `#/projects/<name>` 契约不变）；点击分区标题行 SHALL 仅切换展开/折叠态，不切换主面板；分区态（展开/折叠、当前高亮项目）SHALL 在交互后保持一致。DOM 锚点 MUST 基于语义元素定位（如条目列表 `nav`），MUST NOT 依赖 CSS module 哈希类名；锚点不可达或结构漂移时 SHALL 自动降级回「项目」条目内的浮层分组（现实现），两条路径的切换对用户数据零影响。项目数据仍由轮询同步机制维护（见「项目列表轮询同步」）；对应 `main` keyed 面板注册契约不变。`sidebar.workspaces`（single 槽，官方工作区占据）MUST NOT 被抢占。

#### Scenario: 项目分区常驻内嵌

- **WHEN** 上游项目列表含 fenixd、dsh-plugins 两个项目，用户展开 dsh web 侧栏
- **THEN** 条目列表与「工作区」区域之间呈现常驻「项目」分区（非点击弹出的下拉浮层），含 2 个项目行（首字母徽标 + 项目名）；项目行不出现在「帮助」之后的条目区

#### Scenario: 分区容器无边框

- **WHEN** 用户展开 dsh web 侧栏，「项目」分区呈现
- **THEN** 分区容器不渲染边框线（无 1px border），视觉与官方「工作区」区域一致；「暂无项目」空态壳同样无边框

#### Scenario: 点击项目行切换面板

- **WHEN** 用户点击分区内项目行「fenixd」
- **THEN** 主面板切换为该项目 iframe（src 深链 `#/projects/fenixd`），分区内该项目行呈高亮

#### Scenario: 分区高度有上限

- **WHEN** 上游项目数量超出分区最大高度可容纳行数
- **THEN** 分区列表以内部滚动呈现其余项目，侧栏整体高度不被撑破

#### Scenario: 窄态适配

- **WHEN** 侧栏折叠为窄轨
- **THEN** 分区收敛为与侧栏窄态一致的紧凑形态（如徽标栈/计数），不横向溢出

#### Scenario: 锚点漂移自动降级

- **WHEN** dsh 升级导致语义锚点（条目列表 `nav` 兄弟位）不可达
- **THEN** Portal 分区不再渲染，自动回落到「项目」条目内的浮层分组（现实现），无控制台未处理异常；恢复锚点后分区重新出现

#### Scenario: 空列表不出错

- **WHEN** 上游返回空项目列表或拉取失败
- **THEN** 分区呈现空态（或收起），侧栏与控制台无未处理异常
