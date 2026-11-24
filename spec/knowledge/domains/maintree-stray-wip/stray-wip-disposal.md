# 主树散件 WIP 处置口径（maintree_stray_wip_stale）

<!-- knowledge: capability=stray-wip-disposal rev=5
     sources=spec/changes/add-bridge-theme-channel -->

Admin 盘点信号 `maintree_stray_wip_stale`（主树 tracked 散件 WIP 无主滞留，major）在本项目的收编处置口径，兼作复发型散件显式跟踪项的跨月承载页；供 Admin 处置轮直接消费、缩短定位链。

## 规则

### 信号形态与归因盲区

- `maintree_stray_wip_stale`（major）：主树 tracked 未提交改动滞留超 30 分钟宽限，在飞实现车道（worktree 分支 diff）零命中即按无主告警。全局信号，裁决选项注册表仅两选项：`commit_stray_wip` / `untrack_stray_wip`。
- 持有者**直接改主树不入分支**的形态（人工会话、admin、主树内构建产物）分支 diff 必零命中——本项目该形态是常态（人工在主树做品牌/dashboard-bridge 策展型迭代），告警反复出现属预期而非异常。

### 处置规则

1. **源码散件 MUST NOT `untrack_stray_wip`**：该选项（git rm --cached + .gitignore）只为生成物类散件断根设计；对本项目手写源码（dashboard-bridge src/tests、brand-fenix client.js 等）出库会永久致盲版本控制，属仓库完整性破坏。本项目散件全部为源码，无一例生成物。
2. **同特征 untracked 兄弟文件随 tracked 清单一并收编**：人工会话特征集常含新模块 + 新测试（untracked），tracked 改动的 import 悬挂在这些文件上——只提交 tracked 清单会产出 import 悬空的断链快照。框架 `commit_stray_wip` 执行器明确拒绝裹挟 untracked（pathspec 必 fatal）且空交集报 error，故：
   - 手工收编时 MUST 包含同特征兄弟文件，处置记录回填 `suggested_choice`（而非 `choice_id`）——预提交后写 `choice_id` 会让框架重执行落空交集 error，产生「resolved 但执行必败」假收口；
   - untracked 兄弟文件若不收编、留给 untracked 族信号（archive/ignore/delete 三裁决），对源码全是错误归宿。
3. **收编前验证快照自洽**：进特征集根目录跑 `typecheck` + 测试套件（dashboard-bridge：`tsc --noEmit` + `vitest run`），全绿才提交；提交对象是 WIP 快照，非 merge，不要求跑全项目质量门。
4. **复发型（同文件集 ≥2 度）挂显式跟踪项**：框架禁「仅提交」（evo-recurring-stray-remediation），untrack 被规则 1 禁用 → 处置必须「收编提交 + 挂跟踪项」两件套，根治唯一形态是跟踪项；载体 = 本能力页 + admin_alerts 历史记录（跨月持久）。同文件集第 4 度告警起 MUST NOT 再自动提交/收编快照，处置动作收敛为**零触碰 + escalate 通知人类为该人工会话建立 worktree 车道**（人工直改主树是归因盲区根因，应修形态而非继续收编快照）；该口径维持至人类建立车道或明示认领主树直改形态。散件形态若为生成物类，按规则 1 反转：`untrack_stray_wip` 即为正确根治。
5. **mergeback_wip_overlap 碰撞解阻塞例外**：冻结 WIP（多日字节级零演进同指纹）阻塞在飞 SPEC 的 merge-back 时（信号 mergeback_wip_overlap，policy=escalate 重试闸门，其指引自身授权 commit/stash），零触碰口径让位于解阻塞：按规则 3 验证快照自洽 + `git stash create` 悬空探针与 `git merge-tree --write-tree` 无副作用预演干净后收编提交；commit 优于 stash（工作树字节不变零扰动人工现场、成果入史可溯、规避闸门所防 pop 冲突静默丢弃）。演进中的活 WIP（短期内有演进）不收编，维持规则 4 零触碰 + 升级。untrack 仍禁用（规则 1 不例外）。
6. **流程约束升级提请挂起中**：向人类的二选一提请（人工会话强制/提醒 worktree 车道，或主树 tracked 直改提醒 hook）待人类响应；处置轮直接引用本条，不重新论证；响应前处置轮动作面收敛为「本页回写 + 处置记录」二件套。

### 跟踪项（dashboard-bridge/brand-fenix 人工直改特征集）

- 监听对象：brand-fenix SVG lockup（用户选定概念稿 A 与副标文案的策展迭代）+ dashboard-bridge rightTab/wsTooltip/locate/projectSync 特征集（含 panels.tsx）。
- 现状：该特征集 tracked 面干净入库（panels.tsx 冻结 WIP 收编于 commit 0f995cb），同指纹告警 saga 不再活动；同现场 market.yml（aria snapshot 转储）属 untracked 族信号管辖，不入本清单。
- 复发口径：该文件集再现新的人工直改 WIP → 按同文件集口径重新计度并回到零触碰口径（活 WIP 不收编，冻结 WIP 走规则 5）。

### 度数台账（同文件集口径，各特征集处置度数起点）

- dashboard-bridge/brand-fenix 特征集：第 34 度（2026-11-24，run admin-dsh-plugins-1795499155）；第 4 度起零触碰口径维持中，见规则 4/6。
- fenix-dsh-chat-polish 特征集（README.zh.md/client.js/tests/client.test.mjs/tests/v0.2.2-baseline.css）：第 1 度（2026-11-24，run admin-dsh-plugins-1795512362）——0.3.x 迭代快照（设置分区更名「Fenix 插件设置」+ data-composer-input 宽度锚定修复 + settings-embed 嵌入设置页）测试自洽 33/33 后收编提交 923e430；无同特征 untracked 兄弟（rpc-guard 零引用，独立特征集归 untracked 族）。主树直改开发会话形态（写完离场），再现新 WIP 按同文件集口径计第 2 度并挂本页跟踪项。

## 关键行为

- 处置轮流程：读本页规则 → 归因（在飞 worktree 车道 diff、stash、在飞进程核查）→ 按度数选动作 → 回填处置记录（`suggested_choice`）→ 本页回写。
- 度数按本页同文件集口径计；信号 evidence 的「历史处置 N 轮」为同指纹口径，两者可不同，不得以 evidence 计数替代本页度数。

## 代码锚点

- 无独立实现载体（处置口径页）：信号实现位于 fenix 框架 evo-recurring-stray-remediation（框架域规则，不在本仓）；消费方为 Admin 盘点处置轮，承载载体为本页 + admin_alerts 历史记录。

## 溯源

- 2026-10-16 / 2026-11-12 admin 处置轮（c97b6ddf8a51、298f844aee26、add1bdf366c0）— 初始蒸馏本页：信号形态、处置规则 1-3、跟踪项挂载与复查时机条款。
- 2026-11-14 → 2026-11-24 admin 盘点处置轮第 4–34 度回写（run `admin-dsh-plugins-1794625487` → `1795499155`，共 31 轮）— 复查时机条款落地：第 4 度起零触碰 + escalate 转人工，逐度维持；逐度告警指纹/文件清单/处置明细存 admin_alerts 历史与本页 git 历史。
- 2026-11-24 add-bridge-theme-channel（spec/changes/add-bridge-theme-channel/）— mergeback_wip_overlap 碰撞解阻塞收编终局：panels.tsx 冻结 WIP 验证自洽（tsc 0 错、vitest 182/182）+ merge-tree 预演干净后提交 0f995cb，该改动集 saga 终结；沉淀处置规则 5 与规则 6 挂起口径。
- 2026-11-24 admin 处置轮（run admin-dsh-plugins-1795512362）— fenix-dsh-chat-polish 特征集第 1 度收编：0.3.x 迭代快照测试自洽 33/33 后提交 923e430，铁律 10 首次处置「提交+建议」口径实证；新增度数台账节承载各特征集本页度数。
