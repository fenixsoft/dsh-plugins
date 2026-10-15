## Deliverables

```yaml
- path: fenix-dsh-dashboard-bridge/src/client/index.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/panels.tsx
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/projectSync.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/types/dsh-runtime.d.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/tests/projectSync.test.ts
  kind: modify
- path: cc-import/src/client/dialog.tsx
  kind: modify
- path: cc-import/src/client/locales.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/lib/client.js
  kind: reference
- path: cc-import/lib/client.js
  kind: reference
```

## 1. bridge：项目条目改「项目」分组（工作区样式）

- [x] 1.1 读 `dsh-client-ui-layout` / `dsh-client-ui-sidebar` 发行包源码，确认 panellist 条目选中→main keyed 面板切换的程序化入口（或 hash 路由事实源），把最小可用面固化进 `src/types/dsh-runtime.d.ts`；若确认不可行，记录证据并按 design 决策 2 降级方案实施
- [x] 1.2 重构项目条目注册：移除每项目顶层 `sidebar.panellist` 注册，「项目」条目（order 11）组件改为分组块——可折叠、首字母徽标 + 项目名行、最大高度内部滚动、窄态（collapsed）仅显徽标计数、当前项目行高亮；`projectSync` 差异同步改为驱动分组数据源（幂等/移除清理语义不变）
- [x] 1.3 点击项目行切换主面板为该项目 iframe（深链 `#/projects/<name>` 不变）；`tests/projectSync.test.ts` 契约测试随数据流改写，`pnpm test` / `pnpm typecheck` 全绿
- [x] 1.4 隔离 profile 真机验证：项目不平铺在「帮助」之后、分组折叠与限高滚动生效、点击项目行面板切换且行高亮、空列表/上游停机无未处理异常

## 2. cc-import：对话框 80% 宽 + 取消全部选择

- [x] 2.1 `ImportDialog` 的 Modal 提升为视口宽 80%（优先 Modal 既有 props/`contentClassName`，不支持则以包裹层样式实现），常见桌面视口下候选行无换行挤压
- [x] 2.2 操作区「全选可导入」旁新增「取消全部选择」：清空勾选与「将更新」集、无勾选时按钮禁用、导入按钮计数归零禁用；新增文案键 `dialog.deselectAll`（zh/en）
- [x] 2.3 隔离 profile 真机验证：宽度生效、全选→取消全部选择→导入按钮禁用的完整交互链、中英文案随界面语言切换
