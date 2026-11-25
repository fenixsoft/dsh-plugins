# Proposal: add-sidebar-tabs-plugin（侧栏顶部功能/工作区双Tab切换插件）

## Why

dsh web 左侧栏当前单列纵向堆叠两类异质内容：全局功能导航（概览/配置/Plugins/运维/指挥中心/Automation tasks/帮助/More）与 Workspaces 区（搜索框、高级搜索入口、View options、Add workspace、会话树）。功能入口与会话列表混杂，纵向滚动距离长，「找功能」与「找会话」两种使用心智无法分区直达。立项原话见 `request.md`。

## What Changes

- 新增 dsh web 插件 **fenix-dsh-sidebar-tabs**：零构建双半插件（client 端 DOM/CSS 注入，对齐 fenix-dsh-settings-dock 先例），不改 dsh 本体与其余插件
- 侧栏顶部（品牌区与 New Session 按钮下方）注入「功能 / 工作区」双 tab 分段控件
- 「功能」tab：承载现有全局导航（8 项）；「工作区」tab：承载现有 Workspaces 区整体（搜索框、高级搜索入口、View options、Add workspace、会话树）
- 切换实现为**容器可见性切换**（非 DOM 搬移，两容器互斥可见、无 order 重排）：两个区块保持官方 React 渲染的原生 DOM 位置与各自独立滚动位置
- tab 选择持久化（localStorage，记住上次选择）；无记忆时默认「工作区」
- New Session 按钮与底部 Account 菜单位置不变，两种 tab 状态下常显；footArea 内「更多」触发钮（ellipsis 图标）两态常显并钉在侧栏列底同一位置，全局导航末项「更多」（apps-add 图标）按普通导航项逻辑随导航整体显隐（2026-11-24 用户验收反馈、2026-11-25 用户修正钉底对象）
- 侧栏收起态（56px 窄轨）行为不变：tab 栏不渲染，窄轨维持现状；展开后恢复记忆 tab
- 锚点失配（dsh 升级结构漂移）时零注入退出，零副作用；`enabled=false` 零动作停用

## Capabilities

### New Capabilities

- `sidebar-tabs`: 侧栏顶部功能/工作区双 tab 切换——tab 栏注入、分区可见性切换与独立滚动、footArea「更多」钉底常显（nav 末项随导航整体显隐）、选择记忆与缺省 tab、常显元素保障、收起态行为、锚失配回退与停用语义

### Modified Capabilities

（无——既有能力需求不变：session-advanced-search 的高级搜索入口等随 Workspaces 区整体在「工作区」tab 内呈现，行为与位置语义不变；capability 全集已核对 `spec/changes/*/specs/` 与 `spec/archive/*/specs/`。）

## Impact

- 新增插件包 `fenix-dsh-sidebar-tabs/`（package.json、index.js、client.js、cordis.patch.yml、README.zh.md），共 5 个新文件；零构建、无新依赖
- 不改动 dsh 本体、仓内其余插件、任何 host 端路由/数据；纯浏览器侧展示层注入
- 真机安装与验收沿用既有 **plugin-rollout** 能力口径（见 `spec/knowledge/domains/plugin-rollout/`）
- UI 视觉基准：`specs/add-sidebar-tabs-plugin/prototype/`（纯 HTML/CSS 仿样，**视觉参照、无约束力**——dsh web 非 antd 栈，fenix-prototype 真组件通道不可用；界面布局决策由本 SPEC Scenario 文字钉死）
