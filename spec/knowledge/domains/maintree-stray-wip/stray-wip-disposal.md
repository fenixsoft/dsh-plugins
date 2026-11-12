# 主树散件 WIP 处置口径（maintree_stray_wip_stale）
> 最后更新：2026-11-12 13:51 UTC
> 来源：admin 处置轮 c97b6ddf8a51（2026-10-16 第 1 度）、298f844aee26（2026-11-12 第 2 度）、add1bdf366c0（2026-11-12 第 3 度）实证蒸馏；落地 evo-recurring-stray-remediation（框架域规则）在本项目的口径。

## 信号形态

- `maintree_stray_wip_stale`（major）：主树 tracked 未提交改动滞留超 30 分钟宽限，在飞实现车道（worktree 分支 diff）零命中即按无主告警。全局信号，裁决选项注册表仅两选项：`commit_stray_wip` / `untrack_stray_wip`。
- 归因盲区：持有者**直接改主树不入分支**的形态（人工会话、admin、主树内构建产物）分支 diff 必零命中——本项目该形态是常态（人工在主树做品牌/dashboard-bridge 策展型迭代），告警会反复出现，属预期而非异常。

## 处置规则

1. **源码散件 MUST NOT `untrack_stray_wip`**：该选项（git rm --cached + .gitignore）只为生成物类散件断根设计；对本项目手写源码（dashboard-bridge src/tests、brand-fenix client.js 等）出库会永久致盲版本控制，属仓库完整性破坏。本项目散件至今全部为源码，无一例生成物。
2. **同特征 untracked 兄弟文件随 tracked 清单一并收编**：人工会话特征集常含新模块 + 新测试（untracked），tracked 改动的 import 悬挂在这些文件上——只提交 tracked 清单会产出 import 悬空的断链快照。注意框架 `commit_stray_wip` 执行器明确拒绝裹挟 untracked（pathspec 必 fatal）且空交集报 error：
   - 手工收编时 MUST 包含同特征兄弟文件，处置记录回填 `suggested_choice`（而非 `choice_id`）——预提交后写 `choice_id` 会让框架重执行落空交集 error，产生「resolved 但执行必败」假收口；
   - untracked 兄弟文件若不收编、留给 untracked 族信号（archive/ignore/delete 三裁决），对源码全是错误归宿。
3. **收编前验证快照自洽**：进特征集根目录跑 `typecheck` + 测试套件（dashboard-bridge：`tsc --noEmit` + `vitest run`），全绿才提交；提交对象是 WIP 快照，非 merge，不要求跑全项目质量门。
4. **复发型（同文件 N≥2 度）MUST 提交 + 挂显式跟踪项**：仅提交禁止（evo-recurring-stray-remediation）；untrack 被规则 1 禁用 → 根治唯一形态是跟踪项。载体=本能力页 + admin_alerts 历史记录（跨月持久）；复查时机见下节。

## 跟踪项（2026-11-12 第 3 度处置挂载）

- 收编对象：brand-fenix SVG lockup（用户 2026-11-07 选定概念稿 A、2026-11-10 指定副标文案）+ dashboard-bridge rightTab/wsTooltip/locate/projectSync 特征集（9 tracked + 7 untracked 兄弟，typecheck 0 错、vitest 145/145）。
- 复查时机：同文件集第 4 度告警时，MUST NOT 再自动提交，改为**通知人类为该人工会话建立 worktree 车道**（人工直改主树是盲区根因，第 4 度起应修形态而非继续收编快照）。
- 若散件形态变为生成物类（如构建日志），按规则反转：`untrack_stray_wip` 即为正确根治。
