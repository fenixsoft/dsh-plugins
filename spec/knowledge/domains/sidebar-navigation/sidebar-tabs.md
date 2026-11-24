# 侧栏顶部功能/工作区双 Tab 切换
<!-- knowledge: capability=sidebar-tabs rev=1
     sources=spec/changes/add-sidebar-tabs-plugin -->

dsh web 侧栏顶部「功能 / 工作区」双 tab 分段控件（插件 fenix-dsh-sidebar-tabs）：把全局功能导航与 Workspaces 区两类异质内容按使用心智分区直达，纯浏览器侧展示层注入、零破坏官方行为。

## 规则

### 插件形态与注册

- fenix-dsh-sidebar-tabs 为零构建双半插件：`index.js` 空 `apply()`（Host 半仅需可加载）、`client.js` 纯浏览器侧注入、`cordis.patch.yml` 仅 `- insert:` 注册；`engines.dsh` 钉 0.2.x、`dsh.client.platform=web`、无新增依赖。
- 无业务配置项；唯一开关 = dsh 插件清单中本插件的 `enabled`。

### 注入位置与锚点签名

- tab 分段控件注入在侧栏顶部：品牌区与「新会话」按钮之后、全局导航之前；标签中文直出「功能」「工作区」（role=tablist/tab + aria-selected，不走官方 i18n）。注入 MUST NOT 破坏上下相邻官方元素（品牌区、新会话按钮、全局导航、Account 菜单）的功能与点击行为。
- 全部锚点用 CSS-modules 键名子串匹配（类值带构建哈希前缀、升级漂移、键名稳定，禁钉哈希前缀）：侧栏列 `[class*="sidebarCol"]`、全局导航容器 `nav[class*="panelList"]`（侧栏根直下唯一 `<nav>`）、Workspaces 区容器 `[class*="regionArea"]`；另要求结构完整性——nav 的父元素包含 regionArea（即侧栏根识别成功）。
- 侧栏根（SidebarRoot）子元素顺序：品牌区 logoRow → 新会话按钮容器 controls → 全局导航 panelList → Workspaces regionArea → 底部 footArea；窄轨时 root 附加 collapsed 类。签名实证基线为 dsh 0.2.2-rc.1。
- 全部必需锚点命中才注入；缺任一即走失配回退。

### 分区切换与状态自愈

- tab 切换 = 两容器内联 display 级可见性切换（隐藏方 `display:none`、显示方移除内联 display），MUST NOT reparent 官方 React 管理子树；两区块保持各自独立纵向滚动位置，隐藏侧官方照常渲染，切换不改两区块内部官方交互行为。
- 「功能」tab = 全局导航 8 项可见、Workspaces 区互斥隐藏；「工作区」tab = 反向；Workspaces 区既有官方功能（搜索框、高级搜索入口、View options、Add workspace、会话树）在「工作区」tab 下全部可用。
- 注入态由 MutationObserver 双通道自愈：documentElement 子树 childList（官方重渲染重建 nav/regionArea 后重贴 display 状态并把 tab 栏重插回 nav 之前）+ 侧栏根 class 属性（收起/展开翻转同步）；一次 mutation burst 经 microtask 去抖合并为一次维护；锚点恢复命中后自动重新注入。

### 选择记忆

- localStorage 键 `fenix-dsh-sidebar-tabs.tab`，值 `'func'` 或 `'workspace'`；重启 dsh web 或刷新页面恢复上次选择。
- 无记录或值非法 → 缺省「工作区」；持久化失败（如存储被禁用）不抛错，退化为本次会话内记忆。

### 收起态与常显

- 侧栏收起 56px 窄轨时 tab 栏不渲染、两容器恢复官方现状可见性，窄轨行为与官方一致；展开后恢复记忆 tab。响应式视口收窄触发的窄轨同语义。
- 「新会话」按钮与底部 Account/设置区不在 display 切换目标内，两种 tab 态常显、位置行为不变。

### 失配回退、启动宽限与停用

- 任一必需锚点未命中 → 零注入（不注 tab 栏、不注 style、不动任何官方元素）、零异常，侧栏保持官方原生形态。
- 失配告警为 warn 级且含失配锚点名，按锚点名限流：同锚只 warn 一次、命中恢复即复位、不同锚各自报；启动瞬态 MUST NOT 消耗限流吞掉真失配的锚点名。
- 侧栏列元素未挂载（应用启动中/无侧栏页面）走 15s 静默宽限期：首见缺失起表静默等待、超时仍缺才按失配告警；健康路径启动零告警噪声。
- `enabled=false` 零动作：loader 不装载插件，client 半不出现在 `/plugins/` 组合 bundle（该 URL 404），零注入、零样式、不写 localStorage，侧栏与未安装一致。

### 主题与共装共存

- 颜色全部引用 dsh 官方 CSS 变量 token：轨道 浅 `--dsw-static-neutral-bluish-150`/暗 bluish-850；活动块 `--dsw-specific-sidebar-nav-item-active`（与官方导航项活动态同源）；文字 `--dsw-alias-label-*`；指示条 浅 `--dsw-static-deepseek-500`/暗 deepseek-400；暗主题标记 `body[data-ds-dark-theme]`，随官方暗/浅主题自适应。
- 与 fenix-dsh-settings-dock 共装：两者同用 `[class*="sidebarCol"]`；本插件只改官方容器 display、不改列几何，dock 的 rAF 重测自动跟随。
- 与 fenix-dsh-session-advanced-search 共装：其注入点在 Workspaces 区搜索框内；本插件只切 regionArea 的 display、不触碰其挂载点，「工作区」tab 下高级搜索入口原位可用。
- 三方 MutationObserver 各自只维护自有元素，MUST NOT 互写对方 DOM。

### 升级重钉纪律

- 失配表现 = 侧栏无 tab 控件 + console warn 含失配锚点名。重钉步骤：读 warn 锚点名 → 在安装版 bundle grep 核对 CSS-modules 键名（`SidebarRoot_module_css_default.*` 等）→ 修改 `client.js` 顶部 `SEL` 对应选择器（保持 `[class*="<键名>"]` 子串形态；结构顺序变化时同步调整 root 推导）→ `node --check` 后按 plugin-rollout 口径从零重装走查。
- 重钉步骤经失配演练验证有效：锚点键改写为不存在键时零注入/零样式/零存储写入/零异常，warn 精确含改写键名。

## 代码锚点

- 主实现：`fenix-dsh-sidebar-tabs/client.js`（锚点发现、注入、display 切换、记忆、自愈、失配回退全部逻辑；顶部 `SEL` 为升级重钉第一修缝点）。
- 注册与形态：`fenix-dsh-sidebar-tabs/package.json`（exports 三入口、engines 钉 0.2.x、platform=web）、`fenix-dsh-sidebar-tabs/cordis.patch.yml`（insert 注册）、`fenix-dsh-sidebar-tabs/index.js`（Host 半空 `apply()`）。
- 签名字证与重钉指引：`fenix-dsh-sidebar-tabs/README.zh.md`（实锚命中记录、失配演练结果、重钉步骤）。
- 真机验收证据：`.fenix/verify-evidence/add-sidebar-tabs-plugin/`（13 场景隔离 profile 走查快照/JSON/截图）。

## 溯源

- 2026-11-24 add-sidebar-tabs-plugin（spec/changes/add-sidebar-tabs-plugin/）— 新建本页：tab 栏注入位置与锚点签名、display 级分区切换与自愈、选择记忆、收起态/常显、失配回退（按锚点名限流 + 侧栏列 15s 挂载宽限）与 enabled=false 停用语义。
