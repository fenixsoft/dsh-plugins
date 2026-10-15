## Context

上轮实现把「项目」分组做成了「项目」条目（`sidebar.panellist` order 11）内的 absolute 下拉浮层。用户期望官方「工作区」式的常驻内嵌区域。源码级事实（dsh 0.2.0-rc.2 发行包）：

- 侧栏根为 flex 列：`nav.panelList`（条目列表）→ `div.regionArea`（`renderSlot("sidebar.workspaces", {wide, expandSidebar})`）→ `div.footArea`（`sidebar.footer.action` list + `sidebar.settings` single）。
- `sidebar.workspaces` 为 **single** 槽且被 `dsh-client-ui-workspace` 占据；该包仅导出 `apply/inject`，抢占无法重组官方工作区（会直接丢失工作区 UI）。
- panellist 条目组件渲染于 `PanelRow` 的 `<button class="panelRow"><span class="panelGlyph">{组件}</span>…` 内：行高钉死、按钮内嵌交互元素非法——内嵌分区的结构死角，浮层是上轮唯一出路。
- `regionArea`/`panelList` 的 class 名是 CSS module 哈希（构建期生成，升级即变），不可作定位依据；`<nav aria-label>`（条目列表）是语义元素，稳定。
- 我方已挂载点：「项目」条目组件运行于侧栏 React 树内（可 `closest('nav')`）；`DashboardPanel` 运行于主区。项目数据源 `projectGroupStore`（模块级轻量 store）已存在，60s + focus 轮询同步不变。

## Goals / Non-Goals

**Goals**

- 「项目」以常驻内嵌分区呈现在条目列表与工作区之间（工作区同款视觉：标题行、徽标行、限高滚动、宽窄态适配）
- 点击项目行切主面板（复用 `layout.selectPanel` 路径）、深链与轮询契约不变
- 锚点漂移自动降级回现浮层分组，无未处理异常

**Non-Goals**

- 不抢占 `sidebar.workspaces`/`sidebar.settings` single 槽；不修改 dsh 本体与官方工作区
- 不做上游 feature request 的落地（可另行在仓库 docs 记录提请文案，非本 SPEC 交付门槛）

## Decisions

1. **挂载机制 = React Portal + 语义锚点兄弟位**：从「项目」条目组件（已确认运行于侧栏树内）`ref.closest('nav')` 取条目列表元素，`insertAdjacentElement('afterend', hostDiv)` 创建宿主，`createPortal(<ProjectSection/>, hostDiv)` 渲染分区（位于条目列表与工作区之间；备选位置 regionArea 之后，实现期按视觉效果二选一，默认前者）。宿主由插件创建/清理，分区状态存既有 `projectGroupStore`（跨 portal 存活）。
2. **锚点自愈 = 失败重试 + 周期巡检**：挂载失败（锚点未找到/宿主被移除）时按退避重试（如 MutationObserver 监听侧栏根 + 轮询兜底）；连续不可达即停用 Portal 并置 `degraded` 标志——浮层分组路径自动接管（现实现保留为组件，不删）。dsh 升级导致语义结构变化时表现为「分区消失、浮层回归」，响亮且可用。
3. **宽窄态信号**：Portal 分区无法从 renderSlot 拿 `{wide}`，改从宿主宿侧栏容器实际宽度推断（`ResizeObserver` 观测宿主或根容器，阈值对齐现有 `wide` 判定）；窄态渲染徽标栈/计数紧凑形态。
4. **分区视觉对齐官方工作区**：标题行（项目 + 计数）、行 = 圆形首字母徽标 + 名称 + hover 态、`max-height: min(7行, 46vh)` + 内部滚动；样式变量沿用 `--dsw-*` alias（与上轮浮层一致），不引新依赖。
5. **降级双路径同仓**：浮层分组组件保留并共享 `projectGroupStore` 与 `layout.selectPanel` 回调；Portal 优先、浮层兜底，二者互斥渲染（Portal 生效时「项目」条目退化为图标直选「项目」主面板）。

## Risks / Trade-offs

- [dsh 升级改动侧栏语义结构（nav 不复存在/层级重排）] → 锚点自愈降级为浮层；语义标签比 CSS hash 抗性强得多
- [Portal 内容与侧栏滚动/折叠动画时序竞争（宿主被过渡动画移除重挂）] → 巡检兜底重挂宿主；分区状态在 store 中不受影响
- [侧栏整体高度：新增常驻分区挤压工作区/条目区] → 分区限高 + 内部滚动；整体高度行为与官方工作区自身一致（其自身即限高滚动）
- [fast-track 单 Agent 跨 DOM 探测与 React 生命周期] → 验收场景含锚点漂移模拟（运行期删除宿主 DOM 验证自动降级与恢复）

## Migration Plan

随实现分支 merge-back 后人工重启 live dsh web 即生效（systemd `systemctl restart dsh-web`，token 轮换取 `/var/log/dsh-web.log`）；回滚 = revert + 重启。

## Open Questions

- 分区插入位置默认取「条目列表之后、工作区之前」，实现期在隔离 profile 里与「工作区之后」二选一（视觉评审口径：与「工作区」同级的第二分区）。
