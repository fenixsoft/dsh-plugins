# sidebar-tabs — 侧栏顶部功能/工作区双Tab切换

## ADDED Requirements

### Requirement: Tab 分段控件注入

插件 client 半 SHALL 在 dsh web 侧栏顶部（品牌区与「新会话」按钮之后、全局导航之前）注入一个「功能 / 工作区」双 tab 分段控件；标签文案 SHALL 为中文「功能」「工作区」。tab 栏 MUST NOT 破坏其上下相邻官方元素（品牌区、新会话按钮、全局导航、Account 菜单）的功能与点击行为。侧栏收起为窄轨形态时，tab 栏 SHALL 不渲染；恢复展开形态后 SHALL 重新出现并恢复当前选择的 tab。官方侧栏 DOM 与插件预期的锚点签名不符（缝漂移）时，插件 SHALL 打 warn 级日志并放弃注入，MUST NOT 抛错或注入残缺 UI。

#### Scenario: 注入成功

- **WHEN** 用户打开 dsh web、侧栏处于展开形态
- **THEN** 侧栏顶部（新会话按钮下方）出现「功能 / 工作区」分段控件
- **AND** 品牌区、新会话按钮、全局导航、Account 菜单行为均不变

#### Scenario: 收起态隐藏

- **WHEN** 用户把侧栏收起为窄轨
- **THEN** tab 分段控件消失，窄轨内容与现状一致

#### Scenario: 缝失配降级

- **WHEN** 官方侧栏 DOM 结构与插件锚点签名不匹配（如官方升级改版）
- **THEN** 插件记录 warn 日志且不注入任何 DOM 或样式，侧栏功能不受影响、无未捕获异常

### Requirement: 分区可见性切换

点击「工作区」tab SHALL 使全局导航容器不可见、Workspaces 区（会话搜索框、高级搜索入口、View options、Add workspace、会话树）可见；点击「功能」tab SHALL 反向切换。切换 SHALL 以容器可见性（display 级）实现，MUST NOT 搬移（reparent）任何官方 DOM 节点；切换 MUST NOT 改变两区块内部的官方交互行为。两个区块 SHALL 各自保持独立的纵向滚动，切换 tab 不重置未显示区块的滚动位置。当前活动 tab SHALL 有明确的视觉活动态（对齐批准原型 specs/add-sidebar-tabs-plugin/prototype/index.html 的分段控件样式，主题色随官方暗/浅主题变量自适应）。

#### Scenario: 切到工作区

- **WHEN** 用户点击「工作区」tab
- **THEN** 全局导航隐藏、Workspaces 区完整可见且可交互
- **AND** 滚动位置不因切换被重置

#### Scenario: 切到功能

- **WHEN** 用户点击「功能」tab
- **THEN** Workspaces 区隐藏、全局导航 8 项完整可见且可点

#### Scenario: 官方重渲染后状态维持

- **WHEN** 官方 React 因会话增删或布局切换重渲染侧栏
- **THEN** 插件自动恢复当前 tab 对应的可见性状态，tab 态不被冲掉

### Requirement: Tab 选择记忆与缺省

插件 SHALL 将当前 tab 选择持久化到浏览器 localStorage（键 `fenix-dsh-sidebar-tabs.tab`，值 `'func'` 或 `'workspace'`）；重启 dsh web 或刷新页面后 SHALL 恢复上次选择的 tab。localStorage 无记录或值非法时，SHALL 缺省显示「工作区」tab。持久化失败（如存储被禁用）MUST NOT 抛错，SHALL 退化为本次会话内记忆。

#### Scenario: 重启恢复

- **WHEN** 用户选中「功能」后刷新页面
- **THEN** 侧栏恢复显示「功能」tab 为活动态

#### Scenario: 无记忆缺省

- **WHEN** 新浏览器环境首次使用（localStorage 无记录或值非法）
- **THEN** 侧栏显示「工作区」tab 为活动态

### Requirement: 常显元素

「新会话」按钮与底部 Account 菜单 SHALL 在两种 tab 状态下保持常显，位置与行为不变；全局导航与 Workspaces 区之间的分区切换 MUST NOT 影响它们的可见性。Workspaces 区内的既有官方功能（含高级搜索入口）在「工作区」tab 下 SHALL 全部可用。

#### Scenario: 常显保障

- **WHEN** 用户在功能/工作区两个 tab 之间任意切换
- **THEN** 新会话按钮与 Account 菜单始终可见、可点
- **AND** 高级搜索等 Workspaces 区既有功能在工作区 tab 下正常可用

### Requirement: 失配回退与停用语义

任一必需锚点未命中时插件 SHALL 进入回退态：不注入 tab 栏、不修改任何官方元素样式、零异常，侧栏完全保持官方原生形态；插件 SHALL 打 warn 日志说明失配锚点以便重钉。插件配置 `enabled=false` 时 SHALL 零动作（不加载、不注入、不写 localStorage），侧栏保持官方原生形态。

#### Scenario: 部分失配回退

- **WHEN** 侧栏列锚点命中但 Workspaces 区锚点因官方改版未命中
- **THEN** 插件不注入 tab 栏也不切换任何容器可见性，侧栏为官方原生形态
- **AND** 日志含失配锚点名（warn 级）

#### Scenario: 停用零动作

- **WHEN** 用户将插件配置为 enabled=false 并重启 dsh web
- **THEN** 侧栏无 tab 控件、无样式改动，行为与未安装插件一致
