# Design: add-sidebar-tabs-plugin（侧栏顶部功能/工作区双Tab切换插件）

## Context

dsh web（`@deepseek-ai/dsh` 0.2.x）左侧栏由 `@deepseek-ai/dsh-client-ui-layout` / `dsh-client-ui-sidebar` / `dsh-client-ui-workspace` 以 React + CSS-modules 渲染（类值带构建哈希前缀，如 `bhn1Oq_`，升级漂移、键名稳定），无面向侧栏分区的公开插槽缝。仓内已有纯 client 端注入先例：fenix-dsh-settings-dock（几何停靠，锚 `[class*="sidebarCol"]`）、fenix-dsh-session-advanced-search（搜索框内注入，CSS-modules 键名子串匹配 + MutationObserver 维护）。本插件为第三例：分区可见性切换。

## Goals / Non-Goals

- **Goals**: 功能导航与会话列表分区直达；选择记忆；零破坏（官方行为、收起态、失配回退全部保守化）。
- **Non-Goals**: 不做 DOM reparent；不改窄轨（收起态）行为；不改任何官方入口的内部行为（搜索、树交互、导航路由均为官方 React 自管）；不做 dsh 本体修改；不做 i18n（标签中文直出）。

## Decisions

- **D1 零构建双半插件**：`index.js` 空 `apply()`（loader 条目需可加载 cordis 插件，先例 settings-dock/chat-polish）+ `client.js` 纯浏览器侧注入 + `cordis.patch.yml` 仅 `insert` 注册；不引入 tsdown/构建链。`package.json` 对齐 settings-dock 形态（`exports` 三入口、`engines.dsh` 钉 0.2.x、`dsh.bundle.patch` 指向 cordis.patch.yml、`dsh.client.platform=web`）。
- **D2 可见性切换而非 DOM 搬移**：全局导航容器与 Workspaces 区均为官方 React 管理子树，reparent 会与 reconciliation 冲突（官方条件重渲染时 tab 容器持有脱离的 stale 节点）。tab 切换仅切换两容器的 `display`（或等价 class），天然保持各自滚动位置与 React 更新能力。
- **D3 锚点策略（实现时以真实 DOM 实证钉死）**：侧栏列主锚 `[class*="sidebarCol"]`（settings-dock 已验证，展开/收起形态通用）；全局导航容器按 `<nav>` 元素 / aria-label 形态在侧栏列内识别；Workspaces 区按会话树 / 搜索框 / 标题文案容器的 CSS-modules **键名**子串匹配（`[class*="..."]`，哈希前缀免疫）。实现者 MUST 先对当前安装版 dsh 的 bundle（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js`）做 CSS-modules 映射核对，并把最终签名字证记入 README（升级重钉指引）。
- **D4 状态自愈**：MutationObserver 监听侧栏列子树，官方重渲染（会话增删、展开收起、布局切换）后重贴状态 class，保证 tab 态不被官方更新冲掉（对齐 advanced-search 的持续维护模式）。
- **D5 失配零副作用**：任一必需锚点未命中 → 不注入 tab 栏、不注入任何 style、打 warn 日志、零异常（对齐 settings-dock「失配退回官方形态」语义）。
- **D6 选择持久化**：localStorage 键 `fenix-dsh-sidebar-tabs.tab`，值 `'func' | 'workspace'`；读取到缺失/非法值一律按 `'workspace'`（无记忆默认工作区）。
- **D7 视觉与主题**：颜色/圆角全部引用 dsh 既有 CSS 变量 token（`var(--dsw-static-neutral-bluish-*)`、`var(--dsw-specific-sidebar-nav-item-active)`、deepseek 品牌色 `--dsw-static-deepseek-*`），暗/浅主题随官方变量自适应；布局基准 = 批准原型 `specs/add-sidebar-tabs-plugin/prototype/index.html`（分段控件：深色轨道 + 活动态圆角块 + 底部 2px 品牌色指示条；tab 高 30px、栏高 36px 含内边距、左右 12px 边距）。**原型为纯 HTML/CSS 仿样，视觉参照、无约束力**（dsh web 非 antd 栈，真组件通道不可用）；冲突时以本 SPEC Scenario 为准。
- **D8 标签文案**：硬编码中文「功能」「工作区」（用户定名；仓内插件先例为中文直出，不走官方 i18n）。

## DESIGN.md 引用与偏离声明

仓库根**无** `DESIGN.md`（界面设计宪法缺席，stack_profile `design_doc=null`）。本 SPEC 设计约束来源 = dsh bundle 提取 token + 批准原型（视觉参照）；无可声明偏离条目。若后续仓库补立 DESIGN.md，本插件配色以 dsh 官方 token 为准的裁定需在其能力域收录。

## Risks

- **dsh 升级锚点漂移** → D5 失配静默退出（功能消失不破坏侧栏）；README 记录签名字证与重钉方法。
- **官方未来自带侧栏 tab 化** → 双份 UI 重叠（低概率）；届时用户停用本插件即可（enabled=false 零动作）。
- **官方对导航/Workspaces 容器做条件卸载**（如虚拟化列表） → D4 自愈重贴可能闪断一帧，属可接受视觉抖动；MUST NOT 因此阻塞官方渲染。
