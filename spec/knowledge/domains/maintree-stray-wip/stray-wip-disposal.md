# 主树散件 WIP 处置口径（maintree_stray_wip_stale）

<!-- knowledge: capability=stray-wip-disposal rev=2 origin=prehistoric
     sources=git:e570dc3-..2026-11-12, 第4度回写 admin-dsh-plugins-1794625487 2026-11-14, 第5度回写 admin-dsh-plugins-1794878615 2026-11-17, 第6度回写 admin-dsh-plugins-1794886474 2026-11-17 -->

> 最后更新：2026-11-17 UTC+8
> 来源：admin 处置轮 c97b6ddf8a51（2026-10-16 第 1 度）、298f844aee26（2026-11-12 第 2 度）、add1bdf366c0（2026-11-12 第 3 度）实证蒸馏；落地 evo-recurring-stray-remediation（框架域规则）在本项目的口径。第 4 度回写见跟踪项小节（admin-dsh-plugins-1794625487，2026-11-14），第 5 度回写见其后小节（admin-dsh-plugins-1794878615，2026-11-17）。

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

### 第 4 度回写（2026-11-14 复查时机触发）

- 告警：first_seen=2026-11-14T02:34:09Z（指纹 c07a532fef7e6a49，宽限 30.1 分钟），dashboard-bridge 5 tracked 散件：src/client/index.ts、src/client/panels.tsx、src/types/dsh-runtime.d.ts、tests/opsBadge.test.ts、tests/srcContract.test.ts——其中 4 文件与历度字面同文件，第 4 度条款成立（信号 evidence 计「历史处置 2 轮」为同指纹 bf7abdde 口径，10-16 第 1 度指纹不同未计入；知识页按同文件集口径计度）。
- 改动内容：add-dsh-ops-alert-badge（2026-11-13 push 完结、交付物已入库）之后的策展改版——diff 注释载明「2026-11-13 用户指令：告警计数移到菜单文字后红底 pill 显示」（图标数字角标→存在圆点 + label pill，dsh-runtime.d.ts label 类型放宽 ReactNode，测试同步换血）；快照自洽实测全绿（tsc --noEmit 0 错、vitest 174/174）。
- 处置：按第 4 度条款零触碰（未 commit/stash/untrack，处置轮 admin-dsh-plugins-1794625487），escalate 通知人类建立人工会话 worktree 车道；注册表两选项（commit_stray_wip 第 4 度禁用、untrack_stray_wip 源码禁用）均不适用，回填 suggested_choice=notify_worktree_lane 供注册表演进。
- 复查时机（更新）：第 5 度起维持同一处置（零触碰 + 升级通知），直至人类建立车道或明示认领主树直改形态；MUST NOT 自动收编快照。

### 第 5 度回写（2026-11-17，第 4 度条款按复查时机再触发）

- 告警：first_seen=2026-11-17T00:52:34Z（指纹 9c72bf8edc2a6b1f，宽限 30.1 分钟），dashboard-bridge 1 tracked 散件：src/client/panels.tsx——同文件集口径第 5 度命中（信号 evidence 计「历史告警/处置 2 轮」为同指纹 9c72bf8e 自身口径；signal evidence 首见 11-17 00:52 前该指纹未告警过，度数仍按知识页同文件集口径计）。
- 改动内容：第 4 度 opsAlert 特征集策展迭代的延续——diff 注释载明「2026-11-17 用户指令两连改：①徽标缩小并成圆形（单字正圆盒 14×14、多字短胶囊 borderRadius 9999）②上对齐（verticalAlign text-top）」；同现场 untracked market.yml 为 playwright aria snapshot 转储残留（892 行，untracked 族信号管辖，非本信号清单）。
- 处置：按第 5 度条款零触碰（未 commit/stash/untrack，处置轮 admin-dsh-plugins-1794878615），escalate 通知人类建立 worktree 车道，suggested_choice=notify_worktree_lane（与第 4 度一致）。
- 复查时机（再确认）：第 6 度起维持零触碰 + 升级通知，直至人类建立车道或明示认领主树直改形态；若人类持续不响应，建议向人类提请流程约束升级（主树直改提醒或人工会话强制 worktree），而非继续逐度空转告警。

### 第 6 度回写（2026-11-17 03:00，零触碰 + 流程约束升级提请已发出）

- 告警：first_seen=2026-11-17T03:00:33Z（指纹 9c72bf8edc2a6b1f，宽限 30.1 分钟），同文件集口径第 6 度命中——panels.tsx 单文件，与第 5 度字节级同一改动集（同指纹，第 5 度告警 00:52 后约 2 小时复发）。
- 处置：零触碰（处置轮 admin-dsh-plugins-1794886474），suggested_choice=notify_worktree_lane 维持。
- 流程约束升级提请已发出：第 4 度（11-14）与第 5 度（11-17 00:52）升级通知均未获响应，按复查时机条款向人类提请二选一——人工会话强制/提醒 worktree 车道，或主树 tracked 直改提醒 hook；第 7 度起处置轮可直接引用本条，不必重新论证。
