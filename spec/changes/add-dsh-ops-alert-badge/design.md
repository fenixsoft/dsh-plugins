# Design: add-dsh-ops-alert-badge

## Context

- 桥插件 client 半已向 dsh web `sidebar.panellist` 注册 5 个固定条目（概览/配置/运维/指挥中心/帮助，order 10–18，`fenix-dsh-dashboard-bridge/src/client/index.ts` `FIXED_ENTRIES`）；「运维」= `fenix-activities`（order 15，深链 `#/activities`），图标组件由 `panels.tsx` `fixedIconComponent(id)` 提供（无 hook 纯函数，props `{size, active}`，返回 stroke 线性 svg）。
- 可复用的既有机制：`projectGroupStore` 轻量模块级 store 模式（getSnapshot/subscribe，`panels.tsx:284`）；`reorderOfficialPanels` 的 priority 遮蔽重注册先例（`index.ts`——panellist 为 list 槽，entries 按 priority 升序稳定重排后每 cell 取首个，同 id 更低 priority 胜出，零改 dist）；`startProjectSync` 60s 周期 + window focus 节奏与 `fetchProjectRowsWithTimeout` 10s 超时口径（`projectSync.ts` / `index.ts`）。
- 数据源现成：fenixd dashboard `GET /api/alerts`（跨项目聚合，`alerts[]` 各含 `choices`）；徽标口径权威出处 = fenixd 仓 `spec/changes/consolidate-alerts-to-ops-page/` 的运维徽标能力（当前实测：14 条未处理、1 条带 choices → 徽标 1）。
- 2026-11-13 fenixd 仓刚发生同型缺陷：dashboard 侧栏徽标 sup 绝对定位悬出文本盒，被祖先 `overflow:hidden` 裁成红弧，DOM 级断言全绿但像素不可读——本 SPEC 的防裁剪条款即该教训的直接镜像。
- dsh-plugins 仓**无 DESIGN.md**（设计宪法不存在，无从引用、不虚构）；界面形态约束以本 SPEC `specs/dsh-web-ops-alert-badge/spec.md` 条款为准。执行模式 fast-track（用户确认）。

## Goals / Non-Goals

**Goals:**
- dsh web 左侧栏「运维」条目上呈现与 fenix dashboard 徽标同口径、同数值的待裁决计数。
- 复用桥既有节奏（60s + focus）、超时口径（10s）、store 模式与降级纪律，增量最小。
- fenixd 仓、dsh web 宿主、桥 host 半零改动。

**Non-Goals:**
- 不做 SSE 实时推送（分钟级时效足够，dashboard 内嵌页已有实时通道）。
- 不做右缘「Fenix 项目」页签徽标（用户选定挂左栏运维条目）。
- 不修订 fenixd 嵌入态豁免条款、不给 dashboard embed 态加任何渲染。
- 不改运维条目点击行为/深链/图标 glyph 本体。

## Decisions

- **D1 口径镜像 dashboard 徽标（choices 非空计数），不用 `total_unhandled`**：双端同数避免「两个数字对不上」的用户困惑；`total_unhandled` 含知情类会虚高（实测 14 vs 1）。
- **D2 轮询而非 SSE**：复用 `startProjectSync` 同型节奏与 10s 超时口径，不引 EventSource 生命周期/断连重连复杂度；「等人裁决」是分钟级场景，60s + focus 滞后可接受（spec 已声明非实时承诺）。
- **D3 渲染驱动 = alertCountStore + 变更时 priority 遮蔽重注册**：新增模块级 `alertCountStore`（同 `projectGroupStore` 轻量模式：`getSnapshot/subscribe/setCount`）；计数变更时经 `ctx.slots.register({name:'sidebar.panellist', id:'fenix-activities', order:15, priority:-10, label:'运维'}, iconComponent)` 重注册同 id 条目（`reorderOfficialPanels` 已验证该机制：旧注册被遮蔽而非卸载，无闪断）。备选「宿主 React 订阅」被否：图标组件是无 hook 纯函数（仓库纪律，服务端/测试可直接求值元素树），无 hooks 消费面。
- **D4 徽标形态 = svg 内绘制为首选**：在 `fixedIconComponent('fenix-activities')` 返回的 svg 内，以 `<g>`（circle + text）于 viewBox 右上角落位计数（坐标随 `size` 缩放，文字加白描边保可读）——svg 整体天然落在图标盒内，免疫宿主祖先 `overflow:hidden` 裁剪（fenixd 红弧教训的根因规避）。备选 svg 外 DOM 绝对定位角标：仅当实现期实测 svg 内字号在 16px 图标下不可读时允许退回，但 MUST 附几何断言测试（spec 防裁剪条款的强制验收）。
- **D5 失败降级 = 保留最后已知值**：与 dashboard 侧断连降级轮询的保守显示哲学一致——不归零（假「无事发生」）、不闪烁（视觉噪音）；`alerts` 字段形状漂移按 0 处理属「口径不可判」，与「网络失败保旧值」区分（spec 两条款分别钉死）。

## Risks / Trade-offs

- [svg 内 16px 图标下计数文字偏小] → 首选方案实测不可读时按 D4 退回 DOM 角标 + 几何断言；窄态侧栏（仅显图标）仍完整渲染不裁剪。
- [`/api/alerts` 载荷大于 `/api/projects`] → 60s 低频只读 + 10s abort 不停摆；桥 host 反代流式透传无缓冲，无额外压力。
- [≤60s 与 dashboard 实时徽标短时不一致] → spec 明示分钟级时效承诺；focus 重拉缓解；不构成一致性契约。
- [priority 遮蔽重注册与其它插件冲突] → `fenix-activities` 仅本插件注册；机制已经 `reorderOfficialPanels` 实证。
- [dsh 升级 slots/响应形状漂移] → 沿用桥整体降级纪律（no-op + console.warn，页面不崩，桥其它能力不受牵连）。

## Migration Plan

单插件 client 半小改：实现分支完成 src + tests + `pnpm build`（tsdown 重建 gitignored 的 `lib/*.js`），merge-back 后 dsh web 重载插件即生效；回滚 = 还原提交并重建 lib，无数据/配置迁移。

## Open Questions

（无——挂载点/执行模式/执行时机三项均已获用户确认：左栏运维条目、fast-track、立即执行。）
