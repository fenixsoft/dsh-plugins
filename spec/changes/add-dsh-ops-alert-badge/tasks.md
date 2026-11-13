## Deliverables

```yaml
- path: fenix-dsh-dashboard-bridge/src/client/alertCount.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/src/client/panels.tsx
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/index.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/tests/alertCount.test.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/tests/opsBadge.test.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/lib/client.js
  kind: reference
- path: fenix-dsh-dashboard-bridge/lib/index.js
  kind: reference
```

## 1. 计数同步模块（alertCount.ts）

- [x] 1.1 新增 `src/client/alertCount.ts`：`fetchAlertCount(prefix)`——`GET <prefix>api/alerts`（AbortController 10s 超时 + !ok 抛错，同 `fetchProjectRowsWithTimeout` 口径），解析 `alerts[]` 中 `Array.isArray(choices) && choices.length > 0` 的条目数为计数（`alerts` 缺失/非数组按 0，不抛未处理异常）；同文件实现 `alertCountStore`（getSnapshot/subscribe/setCount 轻量模块级 store，同 `projectGroupStore` 模式）
- [x] 1.2 `alertCount.ts` 内实现 `startAlertCountSync`：60s 周期 + window focus 重拉（同 `startProjectSync` 节奏），拉取失败/超时保留 store 现值不归零不闪烁，且 MUST console.warn 落日志（同 `startProjectSync`「失败要吞但不能不可见」纪律，防静默失败不可排障）；返回停止函数收口全部计时器与 focus 监听；node 环境（无 window）整体跳过不产计时器泄漏

## 2. 徽标渲染与装配

- [x] 2.1 `panels.tsx`：`fenix-activities` 条目图标按 design D4 首选方案在 svg 内叠加计数徽标（`<g>` circle+text，坐标随 `size` 缩放、文字白描边保可读）——count>0 渲染、>99 显示 `99+`、0 或尚无成功拉取不渲染任何角标元素；图标组件保持无 hook 纯函数（读 `alertCountStore` 快照求值），其余 4 个固定条目图标与运维条目 glyph 本体、label、点击行为不变
- [x] 2.2 `index.ts` 装配：`apply` 内启动 `startAlertCountSync`；订阅 `alertCountStore`，计数变更时经 `ctx.slots.register` 以 priority -10 遮蔽重注册 `fenix-activities` 条目（`reorderOfficialPanels` 先例形态）；重注册前 MUST 先 dispose 上一次遮蔽注册（尚无在册遮蔽注册则跳过 dispose）——60s 轮询 + focus 下计数会多次变更，不逐次 dispose 旧注册会致 slots 同 id entries 无界堆积；注册抛错仅 console.warn 不崩、本轮放弃，后续计数变更自然再试（MUST NOT 因一次失败永久禁用重注册——与 `reorderOfficialPanels`「恒定错误不重试」不同，此处失败非恒定且计数是持续变化源）；`ClientPluginOptions` 增补 `fetchAlertCount` 桩注入口（同 `fetchProjects`/`timer` 桩模式）；停止函数收口计数同步、store 订阅与当前在册遮蔽注册（幂等）

## 3. 测试

- [x] 3.1 新增 `tests/alertCount.test.ts`：口径过滤（14 条未处理仅 1 条带 choices → 计数 1）、`alerts` 形状漂移按 0、失败/超时保留最后已知值、60s 周期与 focus 触发（timer 桩）、停止函数收口无残留计时器
- [x] 3.2 新增 `tests/opsBadge.test.ts`：元素树求值断言 count>0 渲染角标、0/未拉取隐匿、127 → `99+`；重注册幂等（同 id 二次注册不崩）；slots 缺席/形状漂移降级 no-op + console.warn 且既有条目注册不受影响
- [x] 3.3 防裁剪形态断言（spec 防裁剪条款）：svg 内绘制方案下断言徽标 `<g>`（circle+text）坐标域完全落于图标 svg viewBox 之内（元素树包含性断言）；若实现按 D4 退回 svg 外 DOM 角标方案，则 MUST 补几何断言证明角标矩形不被祖先 overflow 裁剪（clippedByAncestorOverflow=false）

## 4. 构建与全量验证

- [x] 4.1 在 `fenix-dsh-dashboard-bridge/` 内运行 `npm test`（vitest run）与 `npm run typecheck` 全绿、`npm run build`（tsdown）rc=0 且 `lib/client.js` 重建包含新增计数模块产物
