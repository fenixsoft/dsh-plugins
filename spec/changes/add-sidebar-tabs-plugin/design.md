# Design: add-sidebar-tabs-plugin（侧栏顶部功能/工作区双Tab切换插件）

## Context

dsh web（`@deepseek-ai/dsh` 0.2.x）左侧栏由 `@deepseek-ai/dsh-client-ui-layout` / `dsh-client-ui-sidebar` / `dsh-client-ui-workspace` 以 React + CSS-modules 渲染（类值带构建哈希前缀，如 `bhn1Oq_`，升级漂移、键名稳定），无面向侧栏分区的公开插槽缝。仓内已有纯 client 端注入先例：fenix-dsh-settings-dock（几何停靠，锚 `[class*="sidebarCol"]`）、fenix-dsh-session-advanced-search（搜索框内注入，CSS-modules 键名子串匹配 + MutationObserver 维护）。本插件为第三例：分区可见性切换。

## Goals / Non-Goals

- **Goals**: 功能导航与会话列表分区直达；选择记忆；零破坏（官方行为、收起态、失配回退全部保守化）。
- **Non-Goals**: 不做 DOM reparent；不改窄轨（收起态）行为；不改任何官方入口的内部行为（搜索、树交互、导航路由均为官方 React 自管）；不做 dsh 本体修改；不做 i18n（标签中文直出）。

## Decisions

- **D1 零构建双半插件**：`index.js` 空 `apply()`（loader 条目需可加载 cordis 插件，先例 settings-dock/chat-polish）+ `client.js` 纯浏览器侧注入 + `cordis.patch.yml` 仅 `insert` 注册；不引入 tsdown/构建链。`package.json` 对齐 settings-dock 形态（`exports` 三入口、`engines.dsh` 钉 0.2.x、`dsh.bundle.patch` 指向 cordis.patch.yml、`dsh.client.platform=web`）。
- **D2 可见性切换而非 DOM 搬移**：全局导航容器与 Workspaces 区均为官方 React 管理子树，reparent 会与 reconciliation 冲突（官方条件重渲染时 tab 容器持有脱离的 stale 节点）。tab 切换仅切换两容器的 `display`（或等价 class）——两容器互斥可见，侧栏根 flex 列的官方 DOM 序天然即正确视觉序（D9 修订后无 order 重排），天然保持各自滚动位置与 React 更新能力。
- **D3 锚点策略（实现时以真实 DOM 实证钉死）**：侧栏列主锚 `[class*="sidebarCol"]`（settings-dock 已验证，展开/收起形态通用）；全局导航容器按 `<nav>` 元素 / aria-label 形态在侧栏列内识别；Workspaces 区按会话树 / 搜索框 / 标题文案容器的 CSS-modules **键名**子串匹配（`[class*="..."]`，哈希前缀免疫）。实现者 MUST 先对当前安装版 dsh 的 bundle（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js`）做 CSS-modules 映射核对，并把最终签名字证记入 README（升级重钉指引）。
- **D4 状态自愈**：MutationObserver 监听侧栏列子树，官方重渲染（会话增删、展开收起、布局切换）后重贴状态 class，保证 tab 态不被官方更新冲掉（对齐 advanced-search 的持续维护模式）。
- **D5 失配零副作用**：任一必需锚点未命中 → 不注入 tab 栏、不注入任何 style、打 warn 日志、零异常（对齐 settings-dock「失配退回官方形态」语义）。
- **D6 选择持久化**：localStorage 键 `fenix-dsh-sidebar-tabs.tab`，值 `'func' | 'workspace'`；读取到缺失/非法值一律按 `'workspace'`（无记忆默认工作区）。
- **D7 视觉与主题**：颜色/圆角全部引用 dsh 既有 CSS 变量 token（`var(--dsw-static-neutral-bluish-*)`、deepseek 品牌色仅存留于 focus-visible 描边），暗/浅主题随官方变量自适应；布局基准 = 批准原型 `specs/add-sidebar-tabs-plugin/prototype/index.html`（分段控件：深色轨道 + 增白活动块、无指示条；tab 高 30px、栏高 36px 含内边距、左右 12px 边距）。**视觉演化（2026-11-24 用户反馈两则）**：①原「底部 2px 品牌色指示条」移除；②选中活动块背景由 `--dsw-specific-sidebar-nav-item-active`（浅 bluish-100/暗 bluish-750，与官方导航项同源）改为轨道上的**增白区分块**——浅 `bluish-00`（白）/ 暗 `bluish-700` #61666b（var `--fdx-sbt-active-bg` 主题内切换）。**原型为纯 HTML/CSS 仿样，视觉参照、无约束力**（dsh web 非 antd 栈，真组件通道不可用）；冲突时以本 SPEC Scenario 为准。
- **D8 标签文案**：硬编码中文「功能」「工作区」（用户定名；仓内插件先例为中文直出，不走官方 i18n）。
- **D9 footArea「更多」钉底常显（margin-top:auto，2026-11-24 用户验收反馈追加、2026-11-25 用户修正钉底对象）**：用户反馈「菜单栏最下方的『更多』菜单应一直保持在屏幕最底部」后，进一步澄清侧栏存在**两个「更多」**：① 全局导航末项「更多」（`dsw-icon-apps-add-outline-regular` 图标）是**普通导航项**——功能 tab 按官方顺序正常显示、工作区 tab 随导航整体隐藏，MUST NOT 特殊处理（2026-11-24 首版误将其钉底并隐前 7 项，已全部撤销）；② footArea 内 Account 菜单触发钮「更多」（`dsw-icon-ellipsis-outline-medium` 图标，footArea=footerActions+settingsArea 实证）才是常驻列底项。实现 = 展开态给 footArea 内联 `margin-top:auto`：功能 tab 下 regionArea display:none 使列内失去唯一 `flex:1 1 0%` 伸缩元素，auto margin 补位钉底（实测修复前 footTop=468 → 修复后钉列底 714/720）；工作区 tab 下 regionArea 吸满自由空间、auto margin 恒 0，两 tab 统一贴 auto 无害。零 reparent、零 order 重排（2026-11-24 首版的 order 1/2/3 重排经真机复核属多余——两容器互斥可见时官方 DOM 序即正确视觉序，已撤销）；无 absolute/pointer-events hack。窄轨/teardown 清钉底内联；footArea 为软锚点（缺席只降级钉底、不触发失配回退）。图标实证：官方图标为 `<use href="#dsw-icon-*">` + `data-icon` 属性（非 class），DOM 探针须用 `[data-icon*=…]` 而非类名子串。
- **D10 dsh 0.2.2-rc.5 侧栏滚动机改版适配（2026-11-25 live 升级实测追加）**：rc.5 将新会话容器改名 `controls`→`newSessionRow`（且不再自带下边距），内容区包上官方滚动机 `scrollRegion(margin-top:4px, flex:1 1 0%) > scrollArea(display:grid, overflow:auto)`，nav/region 移入其中；footArea 仍为根列末位。适配三则：① 侧栏根推导改 `nav.closest('[class*="root"]')`（原 `nav.parentElement` 在 rc.5 拿到 scrollArea，连锁失灵窄轨监测与钉底）；② tab 栏放置目标改 `nav.closest('[class*="scrollRegion"]') || nav`——插根列、scrollRegion 之前，**MUST NOT 进 scrollArea**（官方 grid 容器，外来子元素被 auto-flow 压扁至 6px 轨道且扰动行轨道）；③ 间距定稿 bar `margin: 12px 12px -4px`——上 12px 补 newSessionRow 失去的下边距（用户反馈「偏上」后 +12px、再上下各 -10px 收敛），下 -4px 精确抵消 scrollRegion 自带 `margin-top:4px`（用户定稿「下间距 0px」）。锚点选择器 `[class*="sidebarCol"/"panelList"/"regionArea"/"footArea"]` 键名两版通用，零改动。
- **D10b 间距双版本自适应（2026-11-26 daemon 降级事件后追加）**：fenixd daemon 曾按其旧白名单把 live dsh 从 rc.5 降回 rc.1（环境回归），用户裁定 rc.1/rc.5 双版本自适应 + daemon 健康门改下限制。插件侧把 bar 静态 margin 从 TABS_CSS 撤除，改由 placeTabbar 按结构探测内联注入：`scrollRegion` 在（rc.5）→ `12px 12px -4px`；不在（rc.1，nav 为根列直子、旧 controls 自带 margin-bottom:10px）→ `0 12px 8px`。两分支均已真机验证（rc.1: bar 114-150/foot 钉底；rc.5: bar 116-152/foot 674-714/窄轨往返/记忆恢复全绿）。

## DESIGN.md 引用与偏离声明

仓库根**无** `DESIGN.md`（界面设计宪法缺席，stack_profile `design_doc=null`）。本 SPEC 设计约束来源 = dsh bundle 提取 token + 批准原型（视觉参照）；无可声明偏离条目。若后续仓库补立 DESIGN.md，本插件配色以 dsh 官方 token 为准的裁定需在其能力域收录。

## Risks

- **dsh 升级锚点漂移** → D5 失配静默退出（功能消失不破坏侧栏）；README 记录签名字证与重钉方法。
- **官方未来自带侧栏 tab 化** → 双份 UI 重叠（低概率）；届时用户停用本插件即可（enabled=false 零动作）。
- **官方对导航/Workspaces 容器做条件卸载**（如虚拟化列表） → D4 自愈重贴可能闪断一帧，属可接受视觉抖动；MUST NOT 因此阻塞官方渲染。
- **与共装注入插件共存**：`fenix-dsh-settings-dock`（几何停靠，同锚 `[class*="sidebarCol"]` 测量列几何）与 `fenix-dsh-session-advanced-search`（Workspaces 区搜索框内注入）均已在真机共装。D2 display 级切换只改官方容器的可见性，不触碰两者的挂载点与测量基面（dock 以列元素几何定位、advanced-search 以搜索框容器为锚，均非本插件 display 目标的子节点改写方）；三方 MutationObserver 各自只维护自有元素，MUST NOT 互写对方 DOM。真机共装回归走查见 tasks.md 3.1。
