## Why

两插件真机启用后暴露两处 UI 可用性问题：bridge 的项目动态条目平铺在侧栏末尾（排在「帮助」之后，无高度上限，项目多时无限拉长侧栏），与 dsh web 侧栏的信息组织方式脱节；cc-import 导入对话框宽度过小导致候选表格拥挤难读，且缺少反选操作（全选后无法一键清空）。

## What Changes

- bridge 侧栏项目条目改为「项目」分组样式：不再逐项目注册顶层条目，参照 dsh web「工作区」区域的视觉与交互（可折叠分组 + 首字母徽标行 + 最大高度滚动），点击项目行仍切换主面板 iframe，深链 `#/projects/<name>` 保留
- cc-import 导入对话框宽度提升到视口 80%，候选表格获得可读布局
- cc-import 对话框在「全选可导入」旁新增「取消全部选择」按钮（清空勾选集与「将更新」集），中英双语

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fenix-dash-bridge`: 「每项目动态条目」要求变更——项目不再注册为顶层侧栏条目，改为「项目」条目内的分组展示（工作区样式、最大高度滚动），main 面板与深链契约不变
- `cc-import`: 「Models 页导入入口」要求变更——对话框宽度 80% 视口、新增「取消全部选择」操作

## Impact

- `fenix-dsh-dashboard-bridge/src/client/`（条目注册结构与分组组件，`panels.tsx` / `index.ts` / `projectSync.ts`）、类型缝 `src/types/dsh-runtime.d.ts`（如需声明新的 slot/选中机制面）
- `cc-import/src/client/dialog.tsx`（宽度与按钮）、`src/client/locales.ts`（新文案键）
- 真机验证沿用 `docs/help/dsh-plugin-live-verification.md` 的隔离 profile 方法论
