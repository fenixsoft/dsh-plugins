# Proposal: add-dsh-ops-alert-badge

## Why

用户在 dsh web 侧看不到「待人工裁决告警」的数量：fenixd 仓 consolidate-alerts-to-ops-page SPEC 的 ops-alert-badge 徽标按「嵌入态豁免」条款只渲染在 dashboard 独立页侧栏（embed=1 必须不渲染），dsh web 菜单上没有任何计数提示——用户必须主动打开 dashboard 的运维页才知道有几位 SPEC 在等人工裁决（2026-11-13 用户立项原话见 request.md）。把该计数挂到 dsh web 左侧栏既有「运维」菜单条目上，与 dashboard 徽标形成同口径双端可见。

## What Changes

- 新增：桥插件 client 半在 dsh web 左侧栏「运维」固定条目（`fenix-activities`）图标上叠加数字徽标——红底白字角标，计数 >99 显示 `99+`，计数为 0 不渲染（零告警隐匿）。
- 新增：告警计数轮询模块——`GET <prefix>api/alerts`（复用 host 半既有同源反代），计数口径与 fenixd dashboard 徽标逐字一致（`alerts[]` 中 `choices` 非空的条数）；60s 周期 + window focus 重拉（与既有项目同步同节奏）；拉取失败保留最后已知值，不显示假数。
- 修改：`panels.tsx` 运维条目图标组件支持徽标渲染（含防宿主容器 overflow 裁剪的形态约束）；`index.ts` 装配计数同步、条目重注册联动与卸载收口。
- **零改动面**：fenixd 仓零改动（消费既有 `GET /api/alerts`，不新增端点）；dsh web 宿主零改动（全部经插件插槽机制，沿用桥「形状漂移降级不崩」纪律）。

## Capabilities

### New Capabilities

- `dsh-web-ops-alert-badge`: dsh web 左侧栏「运维」条目的待裁决告警计数徽标——计数口径与数据源、徽标渲染与零值隐匿、轮询节奏与失败降级、防裁剪形态约束、形状漂移自守。

### Modified Capabilities

（无——桥既有能力（固定条目注册、项目轮询同步、右缘页签、文件右键定位、内嵌项目分区）的 Requirements 均不变；本 SPEC 只新增能力，已核对 `spec/changes/*/specs/` 与 `spec/archive/*/specs/` 无同域既有能力。）

## Impact

- **代码**：`fenix-dsh-dashboard-bridge/src/client/alertCount.ts`（新增）、`fenix-dsh-dashboard-bridge/src/client/panels.tsx`（修改）、`fenix-dsh-dashboard-bridge/src/client/index.ts`（修改）；测试新增 `fenix-dsh-dashboard-bridge/tests/alertCount.test.ts`、`fenix-dsh-dashboard-bridge/tests/opsBadge.test.ts`。
- **API 消费**：`GET <prefix>/api/alerts`（fenixd dashboard 既有跨项目聚合端点，只读；响应含 `total_unhandled` 与 `alerts[]`，徽标只消费 `alerts[].choices`）。
- **构建产物**：`fenix-dsh-dashboard-bridge/lib/*.js` 由 tsdown 重建（gitignored，非 git 交付物）。
- **无影响**：fenixd 仓、dsh web 宿主、桥 host 半反代、既有测试契约均不动。
