## Context

真机（dsh web 0.2.0-rc.2，live 实例 3080）上两插件已激活可用。侧栏槽位实测（读发行包 `dsh-client-ui-sidebar/lib/client.js`）：

- 内容槽位全集：`sidebar.brand.*`、`sidebar.panellist`（list，条目 = 图标组件，props `{size, active}`）、`sidebar.workspaces`（**single**，已被官方 `dsh-client-ui-workspace` 占据——渲染于 regionArea，props `{wide, expandSidebar}`）、`sidebar.settings`（single）、`sidebar.footer.*`。
- 现 bridge 实现：5 固定条目 order 10–14 + 每项目一条 `sidebar.panellist` 条目 order 100 起名称序——order 100 > 帮助的 14，故项目平铺到「帮助」之后；panellist 为统一行渲染，分组/折叠/限高均无承载。
- cc-import 现状：`ImportDialog` 用 `Modal`（`dsh-client-ui-primitives`，type seam 声明含 `contentClassName`），无宽度设定；操作区已有 全选可导入 / 关闭 / 导入所选。

隔离 profile 验证方法论已就绪（`docs/help/dsh-plugin-live-verification.md`），fast-track 单 Agent 实现与验证同担。

## Goals / Non-Goals

**Goals**

- 项目收纳进「项目」条目的分组（工作区样式：可折叠、首字母徽标行、最大高度内部滚动），点击项目行切换 main 面板，深链与轮询同步契约不变
- cc-import 对话框 80% 视口宽 + 「取消全部选择」
- 隔离 profile 真机验收通过

**Non-Goals**

- 不抢占/替换官方 Workspaces 区域（`sidebar.workspaces` single 槽已被占据）
- 不改 bridge 反代、502 降级等 host 半行为；不改 cc-import 写入语义
- 不处理 frp TLS（用户延后）

## Decisions

1. **分组承载 = 单个 `sidebar.panellist` 条目「项目」+ 自定义分组组件**。`sidebar.panellist` 条目组件本就是插件自给组件（现即徽标/图标组件），把「项目」条目的组件替换为分组块（头部行 + 限高滚动列表）：不与官方 Workspaces 争槽，不动 single 槽。条目 `label` 仍为「项目」，order 维持 11。
2. **主面板切换机制 = 复用条目选中路径**：panellist 条目的 active/点击选中由 sidebar/layout 内部状态驱动；实现期 MUST 读 `dsh-client-ui-layout` / `dsh-client-ui-sidebar` 发行包源码确认「以既有 id 激活 main keyed 面板」的程序化入口（候选：layout 服务 API、选中 store、或以 hash 路由为事实源），并把结论固化进 `src/types/dsh-runtime.d.ts` 类型缝。若确认无程序化入口（不可行），**降级方案**：项目恢复逐条 panellist 注册但 order 紧随「项目」（11.01 起名称序）解决「排在帮助后」，分组/限高以条目组件内滚动近似，取舍记入收工结果并更新文档——用户诉求的完整形态优先级高于降级形态。
3. **项目行数据流不变**：`projectSync` 的拉取/轮询/幂等差异同步保留，同步目标从「slot 注册/注销」改为「分组组件数据源」（React 状态或轻量 store），60s + focus 时机、幂等语义、移除项目清理全部沿用；`projectSync.test.ts` 契约测试同步改写。
4. **对话框宽度与反选 = 纯展示层改动**：宽度优先用 Modal 既有 props（`contentClassName` 或等价物）注入 `width: 80vw`，Modal 不支持时以包裹层样式实现；「取消全部选择」置灰逻辑 = 无勾选项时 disabled，点击清 `names` 与 `updateNames` 两个集合；新文案键 `dialog.deselectAll`（zh：取消全部选择 / en：Deselect all）。

## Risks / Trade-offs

- [panellist 条目容器样式可能裁剪自定义分组块（限高/滚动失效）] → 实现期在隔离 profile 以真实渲染验证；必要时以条目组件内嵌固定最大高度容器 + `overflowY:auto` 兜底
- [程序化切换 main 面板机制不存在或为私有面] → 决策 2 的降级方案兜底；类型缝只声明实际可用的最小面
- [分组块在侧栏窄态（collapsed）下溢出] → 参照 renderSlot 传入的 `{wide}` 形态适配：窄态仅显示图标徽标数，展开态渲染完整分组
- [fast-track 单 Agent 范围跨度（两插件）] → 任务按插件分组推进，cc-import 侧改动小先易后难；两插件互不阻塞

## Migration Plan

纯前端展示层改动，随实现分支 merge-back 进主树后，人工按安装文档重启 live dsh web 即生效；回滚 = revert 对应提交再重启。

## Open Questions

- 「程序化激活 main keyed 面板」的确切入口（实现期读发行包定夺，决策 2 已给降级路径）
