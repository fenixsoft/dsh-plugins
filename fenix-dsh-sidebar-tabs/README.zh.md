# fenix-dsh-sidebar-tabs

dsh web 侧栏顶部「功能 / 工作区」双 Tab 切换插件。侧栏当前单列纵向堆叠两类异质内容——全局功能导航（概览/配置/Plugins/运维等 8 项）与 Workspaces 区（搜索框、高级搜索入口、View options、Add workspace、会话树）——功能入口与会话列表混杂、纵向滚动距离长。本插件在侧栏顶部（品牌区与「新会话」按钮之后、全局导航之前）注入一个双 tab 分段控件，把两块内容分区直达。

零构建双半插件（对齐 fenix-dsh-settings-dock 形态）：`index.js` 空 `apply()`（Host 半仅需可加载），`client.js` 纯浏览器侧注入，`cordis.patch.yml` 仅 `- insert:` 注册。不修改 dsh 本体、不引入依赖、不动任何官方元素内部行为。

## 机制

### 注入与锚点

client.js 启动时按「CSS-modules 键名子串匹配」（类值带构建哈希前缀、会漂移，键名稳定）解析侧栏结构，全部必需锚点命中才注入：

| 锚点 | 选择器 | 官方元素 |
| --- | --- | --- |
| 侧栏列 | `[class*="sidebarCol"]` | dsh-client-ui-layout 布局列（settings-dock 同锚，展开/窄轨通用） |
| 全局导航容器 | `nav[class*="panelList"]` | SidebarRoot 直下唯一 `<nav>`（`aria-label=panels.label`，8 官方入口） |
| Workspaces 区容器 | `[class*="regionArea"]` | `renderSlot("sidebar.workspaces")` 挂载壳（搜索框/高级搜索/树） |

注入位置 = tab 栏插在 `nav.panelList` 之前（即新会话按钮容器 `controls` 之后）。官方侧栏结构（dsh-client-ui-sidebar `SidebarRoot`）：

```
div.<hash>_root          ← 侧栏根（!wide 窄轨时附加 <hash>_collapsed）
  div.<hash>_logoRow     ← 品牌区
  div.<hash>_controls    ← 新会话按钮容器
  nav.<hash>_panelList   ← 全局导航（8 项）
  div.<hash>_regionArea  ← Workspaces 区
  div.<hash>_footArea    ← 底部（footerActions + Account/设置区）
```

### 分区切换（display 级，不搬移）

点击 tab 只切换两容器的内联 `display`（隐藏方 `display:none`、显示方移除内联 display），MUST NOT reparent——全局导航与 Workspaces 区均为官方 React 管理子树，搬移与 reconciliation 冲突。display 级切换天然保持两区块各自独立滚动位置与官方更新能力（隐藏时官方仍正常渲染）。

### 选择记忆

- localStorage 键 `fenix-dsh-sidebar-tabs.tab`，值 `'func'` 或 `'workspace'`；重启/刷新后恢复。
- 无记录或值非法 → 缺省「工作区」。
- 持久化失败（如浏览器禁用存储）不抛错，退化为本次会话内记忆。

### 收起态与常显

- 侧栏收起为 56px 窄轨（root 附加 `collapsed` 类）：tab 栏 `display:none` 不渲染，两容器恢复官方现状可见性，窄轨行为与官方完全一致；展开后恢复记忆 tab。
- 「新会话」按钮（`controls`）与底部 Account/设置区（`footArea`）不在切换目标内，两种 tab 态下常显、位置与行为不变。

### 状态自愈

MutationObserver 双通道维护（对齐 fenix-dsh-session-advanced-search 持续维护模式）：

- `documentElement` 子树 `childList`：官方重渲染（会话增删、面板重挂载）重建 nav/regionArea 元素后，重贴 display 状态并把 tab 栏重插回 nav 之前；
- 侧栏根元素 `attributes[class]`：收起/展开翻转时同步 tab 栏渲染与两容器可见性。

一次 mutation burst 经 microtask 去抖合并为一次维护。失配后锚点恢复命中（如官方热修）会自动重新注入。

### 失配回退与停用

- 任一必需锚点未命中：不注入 tab 栏、不注入任何 `<style>`、不改动任何官方元素、零异常；`console.warn` 含失配锚点名，**按锚点名限流**（同锚只 warn 一次，命中恢复即复位，不同锚各自报）。侧栏列元素本身未挂载（应用启动中/无侧栏页面）走 **15s 静默宽限期**，超时仍缺才按失配告警——健康路径启动零告警噪声。
- 插件配置 `enabled=false`：loader 不装载本插件（client 半不出现在 `/plugins/` 组合 bundle，实测该 URL 404），零动作——不加载、不注入、不写 localStorage，侧栏与未安装一致。

## 配置项

无业务配置。唯一开关 = dsh 插件清单里本插件的 `enabled`（停用零动作，见上）。

## 签名字证与重钉指引

**实证快照**（签名字证的版本基线，升级 dsh 后首先复核本节）：

- dsh `@deepseek-ai/dsh` **0.2.2-rc.1**（`dsh-client-ui-sidebar` / `dsh-client-ui-layout` / `dsh-client-ui-workspace` 同版本），CSS-modules 哈希前缀形如 `bhn1Oq_`/`Xa_`（升级漂移、键名稳定）。
- 侧栏结构自 dsh-client-ui-sidebar bundle 的 `SidebarRoot_module_css_default.*` 键名实证：`root/logoRow/controls(HeaderLeadingControls)/panelList/regionArea/footArea/collapsed/newSession`；侧栏列 `sidebarCol` 来自 dsh-client-ui-layout。
- 主题 token 自 dsh-client-ui-theme bundle 实证（暗主题标记 = `body[data-ds-dark-theme]`）：轨道 浅 `--dsw-static-neutral-bluish-150` / 暗 `bluish-850`；活动块 `--dsw-specific-sidebar-nav-item-active`（浅 bluish-100 / 暗 bluish-750，官方导航项活动态同源）；文字 `--dsw-alias-label-primary/secondary`；指示条 浅 `--dsw-static-deepseek-500` / 暗 `deepseek-400`。

**真机实锚命中记录**（隔离 profile 实测，2026-11-24，dsh 0.2.2-rc.1）：

| 锚点 | 运行时类值（哈希前缀实例） | 命中形态 |
| --- | --- | --- |
| 侧栏列 `sidebarCol` | `bhn1Oq_sidebarCol`（布局列，56px 窄轨/展开全形态在位） | 命中 |
| 全局导航 `panelList` | `nav.hHd-Xa_panelList`（SidebarRoot 直下唯一 `<nav>`，8 个 button 子元素：概览/配置/Plugins/运维/指挥中心/Automation tasks/帮助/More） | 命中 |
| Workspaces 区 `regionArea` | `div.hHd-Xa_regionArea`（搜索框/高级搜索入口/View options/Add workspace/会话树挂载壳） | 命中 |
| 注入位置 | `.fdx-sbt-bar` 前邻 `button.hHd-Xa_newSession`、后邻 `nav.hHd-Xa_panelList`（新会话按钮容器之后、全局导航之前） | 命中 |
| 窄轨标记 | root 附加 `hHd-Xa_collapsed`（56px 列宽实测），tab 栏 `data-rail=true` display:none | 命中 |

**失配模拟演练结果**（2026-11-24，隔离 profile）：

- 把 Workspaces 区锚点键改写为不存在键（`fdxMissingWorkspaceKey`）链入重启：tab 栏零注入、零样式注入、localStorage 零写入、零未捕获异常，侧栏官方原生形态完整（导航 8 项/新会话/搜索框均在位）；console warn 精确含失配锚点名（`fdxMissingWorkspaceKey([class*="fdxMissingWorkspaceKey"]) 未命中`）。
- 演练曾抓到一个实现缺陷并已修复：失配告警原为「全局 warn-once」，client 早于侧栏布局挂载的启动瞬态（列未命中）会把限流消耗掉，真失配的锚点名反而进不了日志。现行为：侧栏列未挂载走 **15s 静默宽限期**（首见缺失起表、超时才按失配告警；含首见分支漏 `return` 落穿告警的返工），列存在后的失配**按锚点名限流**（同锚只 warn 一次，命中恢复复位，不同锚各自报）。修复后健康路径启动零告警、失配路径 warn 精确含改写键名。

**升级失配重钉步骤**（表现 = 侧栏无 tab 控件 + console warn 含失配锚点名）：

1. 打开 dsh web，console 读 warn 里的失配锚点名（形如 `regionArea([class*="regionArea"]) 未命中`）。
2. 在安装版 bundle 中核对键名：`grep -o 'SidebarRoot_module_css_default\.[A-Za-z0-9_]*' /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js | sort -u`（或对应包），确认旧键名是否改名、结构顺序是否变化。
3. 修改 `client.js` 顶部 `SEL` 中对应选择器为新键名（保持 `[class*="<键名>"]` 子串匹配形态，勿钉哈希前缀）；若结构顺序变化（nav 不再是 root 直子），同步调整 `ensure()` 的 root 推导。
4. `node --check client.js` 后按下方「验收」从零重装走查；warn 消失、tab 控件出现即重钉完成。

## 与共装注入插件的共存

- `fenix-dsh-settings-dock`：同用 `[class*="sidebarCol"]` 测量列几何定位。本插件只改官方容器 display，不改列几何；dock 的 rAF 重测自动跟随。
- `fenix-dsh-session-advanced-search`：注入点在 Workspaces 区搜索框内。本插件只切换 `regionArea` 的 display，不触碰其挂载点；「工作区」tab 下高级搜索入口原位可用。
- 三方 MutationObserver 各自只维护自有元素，互不写对方 DOM。

## 验收（plugin-rollout 口径）

真机安装与验收沿用 `spec/knowledge/domains/plugin-rollout/` 能力口径：隔离验证 profile（临时 `DSH_HOME` + 独立端口、`pnpm add link:` 链接本分支、`cordis.patch.yml` 以 `- insert:` 注册、复刻 live 关键面含 `dsh-plugin-loopback-trust` 与 `--trusted-host` 参数）+ playwright-cli 全 Scenario 走查；断言一律真实运行时实测值 + 条件轮询。

验收清单（对应 specs/sidebar-tabs，**2026-11-24 隔离 profile 全部实测通过**，13 场景）：

1. 注入成功+无记忆缺省：展开态侧栏顶部出现「功能 / 工作区」控件（前邻新会话按钮、后邻全局导航）；缺省「工作区」活动态；品牌区、新会话按钮、全局导航 8 项、Account 菜单行为不变；零控制台错误。
2. 切到功能：导航 8 项完整可见可点（点击「配置」实测主面板切换）、Workspaces 区互斥隐藏、aria-selected 翻转、localStorage 记忆写入。
3. 切到工作区：搜索框/高级搜索入口/View options/Add workspace/会话树完整可见可交互、导航隐藏。
4. 独立滚动保持：工作区列表 scrollTop=80 → 切功能 → 切回，scrollTop 保持 80、DOM 节点同一（内容稳定窗口内实测；对照实验证实官方列表自身有内容churn导致的归零，与切换无关）。
5. 官方重渲染后状态维持：功能活动态下新建会话（官方重渲染）后 tab 栏在位、状态不被冲掉。
6. 收起态隐藏+展开恢复：显式「Collapse sidebar」收起（root 带 collapsed 类、列宽 56px 实测）tab 栏 display:none（data-rail=true）、窄轨官方内容正常；展开后恢复记忆 tab。响应式视口收窄触发的窄轨同行为。
7. 刷新恢复：选「功能」→ reload → 「功能」恢复活动态。
8. 非法值缺省：localStorage 写入 `bogus-value` → reload → 缺省「工作区」。
9. 常显保障+高级搜索可用：两态切换中新会话按钮与 Account 菜单始终可见；高级搜索入口点击在内容区打开 iframe 视图（`/session-advanced-search`，1120px 宽实测）。
10. 共装回归：settings-dock 样式注入两态在位；dock 停靠几何完好（Settings 模态 dockLeftVar=280px=侧栏列右缘实测）；advanced-search 挂载点经两态反复切换不破坏。
11. localStorage 禁用降级：阻断 `Storage.setItem` 后点击「功能」不抛错（零 pageerror）、会话内切态生效；重载回缺省「工作区」（无持久化）。
12. 部分失配回退：Workspaces 区锚点键改写为不存在键 → 零注入/零样式/零存储写入/零异常，warn 精确含失配锚点名（见上方演练结果）。
13. `enabled=false` 零动作：loader 清单移除 insert 条目重启 → `/plugins/??fenix-dsh-sidebar-tabs/client.js` 404、页面无 tab 栏、无样式注入、localStorage 无键。

原始证据（快照/JSON/截图）存档：`.fenix/verify-evidence/add-sidebar-tabs-plugin/`。

## 已知限制

- 官方若对 Workspaces 区做条件卸载/虚拟化，自愈重贴可能闪断一帧，属可接受视觉抖动；不阻塞官方渲染。
- tab 文案为中文直出（「功能」「工作区」，不走官方 i18n），与仓内插件先例一致。
- 官方未来自带侧栏 tab 化时会出现双份 UI，届时停用本插件即可（`enabled=false` 零动作）。
