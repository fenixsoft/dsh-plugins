## Why

上一轮「项目」分组受 dsh 侧栏结构限制做成了点击展开的下拉浮层（`position:absolute`），与用户期望的官方「工作区」式常驻内嵌区域不符。经发行包源码级探索：`sidebar.workspaces`（single 槽）被官方占据且 `dsh-client-ui-workspace` 仅导出 `apply/inject`（抢占即丢工作区、无法重组），panellist 条目组件被嵌在固定行高 `<button>` 内（内嵌分组结构不可行）——需要 Portal 级方案把分区插到条目列表与工作区区域之间的兄弟位。

## What Changes

- bridge client 以 React Portal 在侧栏 `nav`（条目列表）与 `regionArea`（工作区）之间插入常驻「项目」分区：标题行 + 首字母徽标项目行 + 最大高度内部滚动 + 宽窄态适配；点击项目行切主面板、深链契约不变
- 现有「项目」条目浮层分组保留为锚点漂移时的自动降级路径
- 锚点定位基于语义元素（条目列表 `nav`），禁止依赖 CSS module 哈希类名

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fenix-dash-bridge`: 「每项目动态条目」展示形态从「条目内浮层分组」升级为「Portal 内嵌分区」，浮层分组转为降级路径

## Impact

- `fenix-dsh-dashboard-bridge/src/client/`（`panels.tsx` 分区组件与 Portal 挂载、`index.ts` 注册与锚点探测）、类型缝 `src/types/dsh-runtime.d.ts`
- 真机验证沿用 `docs/help/dsh-plugin-live-verification.md` 隔离 profile 方法论
