# ADR-008：dsh web 展示层注入的官方 DOM 纪律

date: 2026-11-24
status: accepted

## Context

dsh web 界面由 React + CSS-modules 渲染，类值带构建哈希前缀（升级漂移、键名稳定），官方无面向局部区域的公开插槽缝。仓内展示层注入插件（settings-dock 几何停靠、session-advanced-search 搜索框注入、sidebar-tabs 分区切换）都需要钉住官方 React 管理子树；直接 reparent 官方子树会与 React reconciliation 冲突——官方条件重渲染时插件容器持有脱离的 stale 节点。多插件共装同一区域时还面临互踩风险。

## Decision

三条纪律对全部 dsh web 展示层注入插件成立：(1) DOM 锚定一律用 CSS-modules 键名子串匹配（`[class*="<键名>"]`），禁钉哈希前缀；(2) 对官方 React 管理子树的重组只走 display 级可见性切换，MUST NOT reparent；(3) 必需锚点未命中时零注入退出——不注入 DOM/style、不动官方元素、零异常，warn 含失配锚点名，签名字证快照与升级重钉指引落各插件 README。注入态由 MutationObserver 持续维护（官方重渲染后重贴状态）；多插件共装时各 observer 只维护自有元素、互不写对方 DOM。

## Consequences

dsh 升级锚点漂移时注入功能静默消失而非破坏界面，恢复路径是按重钉指引修缝；代价是每个注入插件必须维护签名字证与重钉文档，dsh 升级后需人工复核重钉。display 级切换保持官方子树的滚动位置与更新能力，但不适用于必须改变 DOM 层级的重组需求。
