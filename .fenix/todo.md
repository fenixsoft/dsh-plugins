## 2026-10-14

- 自上次自省以来无 SPEC 活动，跳过自省。


## 2026-10-16

### 浪费
- **真机验证 spec 并行件烧尽 600 turns，一个件 4025 秒全额报废**
  - 自进化：问题部分成立 / 建议部分合理 / — 不需要
  - 影响：verify-dsh-plugins-live 的并行实现双件各消耗 4025.571 秒（约为同 agent_type 组中位 866 秒的 4.6 倍），其中一件以 Max turns 耗尽告终、600 turns 与全额 token 报废，靠孪生件成功才免于整轮重做；这是窗口内最大单笔 run 时长浪费。
  - 证据：run impl-verify-dsh-plugins-live-1791992263-a1 中途 error「Max turns (600) reached — turn extension budget exhausted (2/2) | remaining_tasks=17」（数据摘要失败样本与深扫中途 error 一致）；a1/a2 记录时长均 4025.571s，与处置记录所述实现窗口（23:37:43 起、00:44:48 止，约 67 分钟）吻合；a2 成功收尾并随分支 fenix/verify-dsh-plugins-live-1791992264 于 10-15 00:44 merge（提交 2519ba2、44089c8）。
  - 调查评估：问题源是 verify-dsh-plugins-live（对已上线双插件做 17 项真机验证的重型 spec）。已核实：a1 以 Max turns（单 run 回合数上限）耗尽且余 17 项任务，孪生件 a2 同窗成功并 merge，tasks.md 现存 17 项勾选（我读 tasks.md 核实 [x]=17），说明任务本身可完成但失败件全额报废。根因形态：17 项验证任务每项含隔离 profile 启动 dsh web 加 playwright 实操，单 run 600 turns 加 2 次延期仍装不下，属任务规模与 turn 预算的结构性错配；单任务级 turn 开销无逐项明细可核（未核实）。与存量关系：spec/changes 活跃区与空归档区无同类立项，fenixd 侧窗口内落地的 evo-api-stall-signal-grading 只做停滞信号分级、不涉 turn 预算。结论：浪费确凿且可复发，支撑分批立项（见 improvements 对应条目）。
  - 建议：对验证型 spec 按场景分批出题或单独调高 turn/墙钟预算（立项方向见 improvements）；近期同类 spec 派发前先人工评估任务数与预算的匹配度作止损。

- **上游限流与瞬断风暴连烧 9 个 run，全局熔断两轮共 20 分钟**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：是
  - 影响：窗口内 10 个失败 run 中 9 个死于上游：6 个 TRANSPORT 流断（Stream ended without finish_reason，planner-plan 与 impl 的 -r3 重楼盘各 3 件）、3 个 bigmodel.cn 429 限流；瞬断触发全局派发熔断两轮各 600 秒，叠加 18 次 in-place retry（run 内退避重试，单次 30-120 秒）等待。
  - 证据：失败样本：planner-plan/impl-add-cc-import-plugin-*-r3 六件「TRANSPORT: Stream ended without finish_reason」；code-fix-1791999259、impl-polish-dsh-plugins-ui-1792050701-a1、admin-polish-dsh-plugins-ui-1792055791 三件 RATE_LIMIT 429；fenixd 日志「Global transient break TRIGGERED…freezing all new run dispatch for 600s」与「Probe FAILED…re-freezing…unseal count +1」；救回痕迹 in-place retry=18、provider switched=1（bigmodel.cn→inferaiapi.com，模型 glm-5.3-flash→deepseek-v4-flash）。
  - 调查评估：问题源横跨 add-cc-import-plugin、polish-dsh-plugins-ui、code-fix 批次与 admin 处置链，属上游网关容量问题（外因），非本工程代码缺陷。已核实：10:59 前后的瞬断触发全局冻结且探针复败续冻；429 甚至击杀处置 run 本身（admin-polish-1792055791），使 orphaned_state（无活动 run 驱动的停滞态探测）处置停在 pending 约 1 小时，才由后续真实状态核查收口（处置 7d48dc0945f2 已 resolved）；polish 链 16:42 吃 429、16:56 秒挂 3 连进冷却，最终 17:57 merge 收尾，救回机制有效。根因归属：外因主导，框架救回闭环。与存量关系：瞬断退避（fix-provider-transient-backoff）早已在位，add-cc-import 六连秒挂（12:13 起 20 秒内 3→6 连发）暴露的「秒挂冷却未盖全派发 lane」缺口已由 evo-add-instant-fail-cooldown-full-lane-gate 进化修复（10-15 凌晨落地，polish 16:56 的冷却日志已带该标签）。结论：损失已被救回机制托底，仅处置链自身被限流打断一处值得补强。
  - 建议：对 admin 处置 run 与自省 run 这类关键小 run 同样套用 provider 瞬断退避与失败自动重派，避免处置链被限流打断后只能靠升级告警兜底。

- **code-fix 批次三连空烧，20 条修复项两次注入两次落空**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：是
  - 影响：3 个 code-fix run（台账自动修复批处理）连续报废：两次产物硬门拦截加一次 429，20 条 code-review 修复项两次注入零产出，从首次失败到救回间隔约 1.4 小时（10-15 01:19 → 02:43），期间台账修复完全停滞。
  - 证据：硬门日志两次「注入清单 20 条但 out 文件不存在（fix-out-code-fix-1791997942 / 1792001059.jsonl）」；run 档案 code-fix-1791997942.jsonl 末条 result 自述「现等待 5 个组子代理返回，逐组落盘并 commit」且会话以 final 正常终态结束、turns=22；第二 run 失败时刻 18:05:47.361025Z 与 daemon shutdown 中断事件 18:05:47.175844Z 同秒；救回提交 981253f-57cce61 五件与 merge 33f3b69（02:43-02:53，重启后 38 分钟内）。
  - 调查评估：问题源是 code-review 台账修复链。已核实第一 run 形态：主代理在 5 个后台子代理未返回时结束回合（final 正常），out 产物从未落盘——headless 会话（claude -p）主代理结束回合即判 run 终态，等待中的子代理产物随之丢失，此为档案直接可见的形态而非臆测；第二 run 与 daemon shutdown 同秒，「被重启打断」为强时间耦合假说（restart_history 不覆盖该时点，未定）。根因评估：第一 run 暴露「主代理可在产物落盘前结束回合」的执行契约缺口（系统性）；第二 run 属停机次生损失。与存量关系：spec/changes 活跃区与归档区无相关条目，fenixd 侧窗口内大量 code-fix 提交均为台账内容修复、非机制修复。结论：产物先落盘的硬约束值得立项，同时说明重启窗口会误伤在飞批处理。
  - 建议：在 code-fix 提示词与框架收工门中强制：注入清单大于 0 时必须先同步写出 fix-out jsonl 再允许结束回合；框架对「final 正常但 out 缺失」的 run 标记可直接重派并优先补偿派发。

### 失误
- **打回重派撞泄漏锁遭熔断冻结，处置 choice 未生效致修复循环搁置 32 小时**
  - 自进化：问题部分成立 / 建议部分合理 / — 不需要
  - 影响：verify-dsh-plugins-live 的失败修复循环（tasks 3 项未勾）被冻结搁置逾 32 小时（10-15 01:43 冻结至今未解），实现预算空烧至 4/4 全额；Administrator 选了解冻 choice 但因作用域错配被静默跳过，解冻从未发生，同因重派熔断告警至今 handled:False。
  - 证据：处置 6f3472d917a4（daemon_errors 处置记录）error 字段「choice 执行未生效（continue_auto_fix）：全局信号（spec='global'）不可执行 spec 作用域动作，已跳过」，诊断载明「16:44:48Z implementer 成功收工 cleanup(success=True) 锁未释放…17:43:12Z 重派 implementer 撞锁（lock age 7529s）1 秒 3 连失败」；告警 517524d58046（同因重派熔断，指纹 59c551238074，handled:False，我读 admin_alerts.json 核实）；STATE.md 该 spec frozen:True、budget_used 4/4（我读核实）；tasks.md 17 勾 3 未勾（我读核实）。
  - 调查评估：问题源是 verify-dsh-plugins-live 验证后的修复循环。已核实时间线：00:44 实现收工并 merge（2519ba2/44089c8，17 项验证任务勾选），但 worktree（隔离工作树）锁因框架形状误判泄漏未释放；01:43 verifier 打回（验证发现缺陷后原地重派实现）撞泄漏锁，触发同因重派熔断（同一失败指纹连续 3 轮即冻结转人工）而冻结；02:03 框架根因修复落地（fenixd acb0a75a8），但解冻 choice 因挂在 global 信号上被跳过，冻结与 3 项修复任务（复核失败有效性/按结论修复/重跑验证）滞留至今。根因双层：锁泄漏已由框架修复闭环；解冻丢失属处置作用域错配的系统性缺口（见 improvements 对应条目）。与存量关系：孤儿处置组 admin-global-1791951472 生效核查失败升级人工（处置 e2ecbb39f234，status=escalated）同样未处理，同族遗留。结论：实现成果已入库无损失，但修复循环停摆需人工接手，机制漏洞需堵。
  - 建议：人工对 verify-dsh-plugins-live 执行解冻收口：核对 3 项修复循环任务去留（修复或显式豁免留痕）；机制侧修复见 improvements「global 信号处置应禁选 spec 作用域 choice」。

- **worktree 形状误判锁泄漏烧尽实现预算并冻结 spec（框架已修复）**
  - 自进化：问题部分成立 / 建议部分合理 / — 不需要
  - 影响：verify-dsh-plugins-live 重派 implementer 一秒内三连秒挂（进程启动即死），实现预算空烧至 4/4 全额，spec 被熔断冻结、管道停摆约 20 分钟直至框架修复与重启；事故链同时波及同夜 code-fix 批次。
  - 证据：告警 517524d58046（同因重派熔断，指纹 59c551238074，retries 3/3，final_error「Failed to create worktree (gave up: parallel run or manual freeze)」）；处置 6f3472d917a4 诊断根因：cleanup finally 裸前缀 startswith("fenix/verify-") 把 verify- 开头 spec 名的实现分支误判为 verifier 形状只摘 :verifier 族锁，叠加 _spec_from_branch 剥前缀错位，双层独立导致 implementer 锁释放失效；框架修复提交 acb0a75a8（2026-10-15 02:03「worktree 形状消歧修复 implementer 锁泄漏」，我 git show 核实）。
  - 调查评估：问题源是 verify-dsh-plugins-live——spec 名以 verify- 开头撞上框架分支前缀启发式（我核实 fenixd 仓库 shape.py/lifecycle.py 已写入消歧注释与修复）。已核实：锁泄漏根因属框架系统性缺陷（命名歧义加无陈锁清扫兜底），非操作失误，且已在本窗口内由 admin 处置 run admin-global-1791999865 产出修复并提交。与存量关系：fenixd 另有 evo-add-worktree-acquire-backoff（锁让路退避等待，2026-09-27）为互补早序工作；dsh 侧 spec/changes 与归档区无相关条目，无需重复立项。结论：失误已闭环，其残余后果（冻结未收口）已单列为上一条；本条留档为「verify- 命名触发框架缺陷」的实证。
  - 建议：框架侧无需新立项（已修复）；dsh 侧可加 spec 命名守卫（拒绝 verify-、impl- 等框架保留前缀开头的 spec 名）作纵深防御。

- **daemon 重启打断自省 run，零产物后终态仍误记 success**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：是
  - 影响：上一次每日自省（review-2026-10-15）运行 81 秒、5 turns 后被 daemon shutdown 打断，产出为零，10-15 自省整体缺失，本次回顾窗口被迫拉长到约 40 小时；浪费一个自省 run（约 1.85 万输入 token 加 2860 输出 token）。
  - 证据：run 档案 review-2026-10-15.jsonl 的 interrupted 事件（reason「daemon shutdown」，2026-10-14T18:05:47.175844Z，即本地 10-15 02:05:47）；同 run_metrics 记录 duration 81.1s、turns=5、bash×2+glob×1；紧随的 result 记录却为 subtype=success、is_error=False、num_turns=0；告警 33854db7f534（self_review_failed 升级：自省零产物 fail-closed，即无产物宁判失败不放过）；self_review_state.json 的 last_run_at 停在 10-14 02:32Z（我读核实）。
  - 调查评估：问题源是每日自省链路自身。已核实：中断由 daemon shutdown 引起；重启动机未定但时间耦合强——fenixd 框架修复 acb0a75a8 落地于 2 分钟前（02:03:35 本地），疑为加载修复而重启（未核实，无重启原因留痕）。更实质的缺陷在记账层：被中断的 run 终态记为 success（num_turns=0 与 metrics 的 5 turns 自相矛盾），零产物只能靠 fail-closed 门事后拦截升级。根因归属：停机时序为外因，终态记账缺陷为系统性——任何依赖 result 终态的下游（预算统计、重派判定）都会被误导。与存量关系：spec/changes 无相关条目；evo-api-stall-signal-grading 管停滞信号分级，不覆盖终态记账。结论：记账修正为小改，停机保护可顺势设计。
  - 建议：agent_runner 对 interrupted run 禁止记 success 终态（改记 interrupted 并保留 reason）；daemon 优雅停机时先中断在飞 run 并正确记账，重启后对自省等可重派 run 自动补跑。

### 可改进
- **验证型 spec 单 run 任务量超 turn 预算，宜按场景分批出题**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：是
  - 影响：复发敞口：验证型 spec 任务数达到 17 项时，单 run 大概率烧满 600 turns 加 2 次延期后整件报废，参照本次实测单件约 4025 秒加全额 token 的代价。
  - 证据：impl-verify-dsh-plugins-live-1791992263-a1 终态「Max turns (600) reached — turn extension budget exhausted (2/2) | remaining_tasks=17」；该 spec tasks.md 17 项已勾任务每项均要求隔离 profile 启动 dsh web 并以 playwright-cli 实操留证（我读 tasks.md 1.1 核实）。
  - 调查评估：已核实任务密度：验证型任务平均含「起服务+浏览器实操+留证」多步，600 turns 装不下 17 项属结构性约束而非执行低效——孪生件同批任务能完成恰说明单件容量是瓶颈。与存量关系：活跃区其余 5 个 spec 均为功能型，无同类验证型 spec 在飞；fenixd 侧窗口内落地的进化（秒挂全 lane 冷却门、stall 分级）均不涉 turn 预算。结论：出题侧分批是低成本改法，够格直接起草进化提案。
  - 建议：起草进化 SPEC：planner 对验证型 spec 按场景分批出题（建议单 run 不超过 6 个场景），或为验证型 agent_type 设独立更高的 turn/墙钟预算，并在收工结果中记录逐场景 turn 开销以积累容量基线。

- **global 信号处置组应禁选 spec 作用域 choice，跳过不得静默**
  - 自进化：问题部分成立 / 建议部分合理 / — 不需要
  - 影响：复发敞口：global 信号（无归属 spec 的全局信号）处置若误选 spec 作用域 choice 即被静默跳过——本次直接后果是解冻丢失、verify spec 修复循环搁置逾 32 小时；窗口内处置记录共 19 条，作用域错配面不小。
  - 证据：处置 6f3472d917a4 error 字段「choice 执行未生效（continue_auto_fix）：全局信号（spec='global'）不可执行 spec 作用域动作，已跳过」；告警 517524d58046 的 choices 四项（continue_auto_fix 等）均 spec_scoped=True，却仍呈现在 global 处置组可选项中（我读 admin_alerts.json 核实）。
  - 调查评估：已核实：跳过发生在执行层且静默——仅 error 字段留痕，处置 result 仍记 partially-resolved，选择端无任何拦截或提示。根因归属：系统性缺口，处置组生成时未按信号作用域过滤 choices，执行时的静默跳过又掩盖了未生效事实。与存量关系：spec/changes 与 fenixd 窗口内提交均无处置链 choice 作用域相关工作（未穷尽检索更早历史）。结论：小而确定的机制修复，可与「升级人工待办提醒」一并立项。
  - 建议：处置组生成时按信号作用域过滤 choices（global 信号只呈现全局动作）；无法匹配时显式降级为「转人工」而非静默跳过，并在处置详情中突出显示未生效的 choice 及原因。

- **升级人工条目缺龄期提醒，最长 pending 逾 32 小时无人跟进**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：是
  - 影响：复发敞口：升级人工的处置与告警若无跟进通道即无限期滞留——本窗口两条：admin-global-1791951472 孤儿处置组自 10-14 18:05Z 升级人工至今未处理，告警 517524d58046（verify spec 熔断冻结）handled:False 逾 32 小时。
  - 证据：处置 e2ecbb39f234（status=escalated，AdminMonitor 孤儿处置收敛核查结论「生效核查未通过，维持滞留并升级人工，终结收敛尝试」，对账窗口内无解冻族 Transition 留痕）；告警 517524d58046 handled:False、handled_at:None（我读 admin_alerts.json 核实）。
  - 调查评估：已核实：AdminMonitor（守护内管理员监控器）把核查不通的处置升级人工后「终结收敛尝试」，此后无任何龄期展示或重复提醒通道，只能等每日自省被动重列（本条目即补位）。根因归属：系统性缺口——人工待办缺少专区、龄期排行与超时重复通知。与存量关系：fenixd 侧已有「audit 疑点升级待人工（聚合）：10 条待人工仲裁」的聚合提交（7dbe81ded），知识库面有雏形、admin 告警面尚无对应机制，互补不重复。结论：值得立项，可直接复用聚合思路。
  - 建议：在 admin 台账/dashboard 增加「待人工」专区：未处理升级条目按龄期倒序排列、超 24 小时重复告警一次，并在每日自省数据摘要固定注入该清单。

- **planner 出题应前置校验 verify.yaml serve 段，免执行期打回**
  - 自进化：问题不成立 / 建议部分合理 / — 不需要
  - 影响：复发敞口：出题含 api/cli/web 场景而 .fenix/verify.yaml（验证契约）无 serve 段（声明被验证应用可启动服务的配置段）时，场景执行期才被一致性门打回——本次实测一轮打回，31 分钟后（10-14 18:05 打回 → 18:36）由 admin 手工补契约解锁。
  - 证据：pm_engine 日志「契约 serve 一致性门打回 'add-dsh-dashboard-bridge'…场景 kind 集含 api、cli、web（需被验证应用可服务），但 .fenix/verify.yaml 无 serve 段且 config commands.start 无有效兜底」；admin 提交 aee75fa（10-14 18:36「起草验证契约 add-dsh-dashboard-bridge——补 serve/ready 段与 regression 段」）。
  - 调查评估：已核实：一致性门位于场景执行前（fail-fast 阻断、不触发 replan），缺口发现被结构性推迟到执行期，补契约靠 admin 人工。根因归属：出题与契约校验的时序错配（系统性），非出题质量失误。与存量关系：.fenix/verify_contract.py 与 verify_contract_template.yaml 已在（我核实文件存在），框架已有一致性门本体，缺的只是把校验前移到出题落盘后立即执行。结论：低成本前移，适合小进化提案。
  - 建议：planner 出题落盘后立即运行 serve 一致性校验（而非等到场景执行），不合格当轮内重排出题或要求补 serve 段，消除执行期打回的往返浪费。

- **离群检测组中位基线被轻量 run 主导，重型 run 全数误标**
  - 自进化：问题成立 / 建议部分合理 / — 不需要
  - 影响：复发敞口：每次重型真机验证 run 都触发离群标记——本次 6 条初筛离群全部来自同一验证 spec 且终态全部成功，其中 verifier 组比值达 108 倍，离群信号被稀释，真正异常的 run 会被淹没。
  - 证据：数据摘要第 6 节：verify-verify-dsh-plugins-live-1791997595-a1 时长 2196.227s 对 verifier 组中位 20.254s（108 倍）、planner-plan-verify-dsh-plugins-live-1791992263-a1 3598.203s 对组中位 867.27s（4.1 倍）；6 条离群 run 均 stall=0 且成功收尾。
  - 调查评估：已核实：离群阈值为组中位 3 倍，而 verifier 组中位 20.254s 表明该组由轻量复核 run 主导，重型 run 必然越线——指标基线未按 run 性质分层（系统性）。与存量关系：fenixd 已落地 evo-api-stall-signal-grading（10-15，stall 信号分级与成功 run latency 统计），本条是同族的上游另一维度（离群初筛），互补不重复。结论：基线分层可与 stall 分级一并推进，属自省数据质量类小进化。
  - 建议：run_metrics 离群基线按 agent_type 乘 spec 类型（验证型/功能型）分层计算，或剔除 P25-P75 外尾部后再取中位；离群标记附该组历史分布上下文以降低误报。


## 2026-10-17

### 浪费
- **两个 code-fix run 零产出空转，管线滞留待重试**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：是
  - 影响：一个已被上一 run 处置过的 code-review 台账条目仍按 open 条目重修，连烧 2 个零产出 run：合计约 268 秒 run 时长、$0.89，另遗留 2 个未清理的 worktree 与同名分支；修复管线被置为 blocked，下轮还将对同一已处置条目再烧一次。
  - 证据：fenixd.log 17:23:14Z 与 17:47:55Z（本地 01:23/01:47）两条「code-fix 零有效修复（fixed=0, commits=0, ignored=0），拒合回」，分别对应 run code-fix-1792171264（修 code-review 发现的修复 run，123 秒、$0.39）与 code-fix-1792172724（144 秒、$0.50）；fix-progress.json 记 total=1、done=0、chain_skipped（修复链内跳过）=["5ae61ac429c4"]、reason=failed_batch_retained（零有效修复批次留存待重试）；git worktree list 仍列出 impl-code-review-fix-1792171264/-1792172724 两个残留目录及分支。
  - 调查评估：问题源：处置第 2 轮周期代码评审 code-review-1792170044（01:11 本地产出 12 条台账）的修复链。已核实事实：批 1 run code-fix-1792170715（01:11-01:21）resolved 11/12 并合回（7c1415f），其中 01cbd8f 已给剩余条目对应的 fenix-skill-provider/src/host/frontmatter.ts 落了 [fenix-ignore:5ae61ac429c4] 豁免注释（fenix-ignore，代码注释形式的评审条目豁免标记，判定原发现「引号值含空格+# 被拒」不成立——成对引号值在引号分支提前返回，已核对现码）；其后两个 run 均因无可修内容产出为零被拒合回。根因（形态层）：台账 items.jsonl 该条目仍 status=open，fenix-ignore 注释未被任何环节折算成台账 resolved/ignored，调度器遂反复重派——系统性闭环缺口而非单次失误，至于是 fixer 未上报处置动作还是 runner 未解析注释，本次证据不足以裁决（详见改进条）。与存量工作关系：spec/changes/ 活跃区无覆盖 code-review 闭环机制的 SPEC。结论：本次直接损失小（$0.89、约 4.5 分钟、2 个 worktree 残留），但「下轮自动重试」使其成为每轮评审遇无效/已处置条目必复发的空转循环；另注意 6 个 run 终态全部 success，终态统计对这类零产出空转完全失明。
  - 建议：为 code-fix 增加无效条目闭环：fixer 判定条目不成立时以结构化输出上报（而非只写 fenix-ignore 注释），runner 据此把台账条目置 ignored 并终止重试；派发前扫描目标文件是否已带 [fenix-ignore:条目id] 注释，命中即跳过；并清理 1792171264/-1792172724 两个残留 worktree 与分支。

### 失误
- **散件 WIP 收编双路径重放，空转误报 ERROR**
  - 自进化：问题成立 / 建议部分合理 / — 不需要
  - 影响：主树散件 WIP 已被 admin run 手动提交成功 41 秒后，框架又重放同一裁决选项（choice，管理员预置的一键处置动作），命中陈旧清单守卫空转一次，落 1 条 ERROR 日志和 1 条 result=failed 处置记录——本次无实际损失（守卫拦住了空提交），但错误统计被污染，双路径重放仅靠守卫兜底。
  - 证据：ERROR 日志 2026-10-16T13:24:26.720756Z（admin_monitor：「处置 choice 执行失败 choice_id=commit_stray_wip…清单陈旧，不产生空提交」，本地 21:24:26）；admin_alerts.json 中处置 4919170f0cb9（result=failed）与 c97b6ddf8a51（result=resolved，附提交 42e0673）相隔 31 毫秒；admin run 存档 admin-dsh-plugins-1792156839.jsonl 记录 13:23:45Z 执行 git add+commit（提交 42e0673，2 文件 +94/-179，提交前 pnpm test 60/60）。
  - 调查评估：问题源：处置 maintree_stray_wip_stale 信号（主树散件未提交改动滞留告警：2 个 tracked 文件无主滞留 30.1 分钟，信号 91d365247837，21:19 升级）。已核实事实链：admin run 读裁决选项源码后于 21:23:45 直接 git add+commit 完成收编，21:24:26 monitor 侧再执行推荐选项 commit_stray_wip，发现清单文件已全部不在工作区，守卫拒绝空提交并记 ERROR+failed；信号本体至今 handled=False、result=failed、escalated=True，处置 resolved 未回写信号。根因（形态层）：同一处置动作存在「agent 手动等价执行」与「monitor 重放推荐选项」两条路径，后者执行前不核对清单是否已生效——归因只能到此，至于是 agent 绕过选项机制违约、还是 monitor 缺「已等效处置则跳过」逻辑，证据不足、两假说并存。与存量工作关系：无在飞 SPEC 覆盖 admin 处置链路。结论：一次性形态但结构性可复发（凡 agent 手动等价执行即复现），属低危高噪失误。
  - 建议：monitor 重放 choice 前先核对信号清单文件是否已不在工作区改动中，命中时记「守卫生效/已等效处置」INFO 并把处置与信号回写 resolved；约定 Administrator 收工时输出「已手动等价执行」标记供 monitor 跳过重放；修正信号 91d365247837 的 handled/result 状态。

### 可改进
- **评审 run API 停滞占墙钟过半，无处置只记日志**
  - 自进化：问题部分成立 / 建议部分合理 / — 不需要
  - 影响：最近两轮周期代码评审 run 连续出现多分钟级 API 停滞（stall，单轮往返超阈值）：窗口内 run 停滞 3 轮共 386.1 秒、单次最长 227.4 秒，占该 run 671.5 秒墙钟的约 57%；前一日轮次也停滞 4 轮（最长 125.4 秒）——复发敞口为每轮评审白等 5-7 分钟。
  - 证据：fenixd.log 3153-3154 行（2026-10-16T17:07Z「API round-trip stall: 227.4s (round #6 > 120s)」及「16 rounds…stalls>60s=3 (19%)」，run code-review-1792170044）；2587/2593 行为前一日 code-review-1792083770 同类记录（28 轮停滞 4 轮、max 125.4 秒）；窗口内 code-fix-1792158323 另有 1 次 75.2 秒停滞；两 run provider 均为 bigmodel.cn。
  - 调查评估：问题源：code-review agent（周期代码评审）运行期。已核实事实：停滞由 agent_runner 的 api_round_stall 探测捕获，但 grade=info 仅落日志，无任何处置动作；停滞集中出现在长上下文低轮数的评审 run。根因写到形态层：单轮往返 2-4 分钟（服务端排队/长上下文 prefill/本地网络，现有证据不足未裁决）；框架停留在观测面、无止损。与存量工作关系：spec/changes/ 活跃区无 stall 处置相关 SPEC。结论：系统性缺口，评审 run 是最易吃满停滞的形态，值得立项。
  - 建议：agent_runner 对单 run 累计停滞 >300 秒或单次 >180 秒升级 warning 并进 admin 信号面；同 run 内触发一次受控重试（该轮重发或收窄上下文），并把 stall 计数纳入 run 质量门，避免 6/6 全 success 的终态统计掩盖纯等待。

- **cost 计量与 token 量纲失真，离群初筛误报**
  - 自进化：问题部分成立 / 建议部分合理 / — 不需要
  - 影响：窗口内唯一初筛离群 run（批量修复 19 条台账）被按 cost_usd 为组中位 3.6 倍（$7.45 vs $2.06）标记，但其 token 量（input 1,155 + output 532 + cache_read 缓存命中 263,744）反小于随后 $3.62 的 run（约 565k tokens），单位成本相差约 4.4 倍；按条目摊薄 $0.39/条 vs $0.33/条基本持平——离群信号是计量/口径失真而非真实浪费。
  - 证据：fenixd.log 3101 行 run_metrics：code-fix-1792158323 cost_usd=7.445 对应 input_tokens=1155、output_tokens=532、cache_read=263744；对比 3167 行 code-fix-1792170715 cost 3.618 对应 input 104,080 + cache_read 461,248 + output 10,685；离群判定（组中位 2.060546 ×3）引自数据摘要第六节。
  - 调查评估：问题源：code-review 台账（评审发现清单）批量修复线的成本观测。已核实事实：同 agent_type 两次 run 的 cost/token 单位成本差 4.4 倍；初筛阈值按绝对 cost_usd ×组中位触发，而 code-fix 成本近似与条目数线性（本 run 19 条 vs 组内中位批约 5-6 条）。根因多假说并存：子 agent（该 run 派了 7 个 Agent）计费归并口径、模型档位差异、长上下文溢价、输出 token 漏计——现有 cost 记录无 model 字段，无法裁决。与存量工作关系：无在飞 SPEC。结论：观测口径缺陷，既会误报批量 run 也会漏报真实异常。
  - 建议：run_metrics/cost 记录补 model 字段、cache 计费细分与子 run 归并标记（先取证再改阈值）；离群初筛改按 cost/台账条目归一（或同 batch size 分组）后再乘阈值。

- **已收工 SPEC 滞留 blocked 态 3 天未清算**
  - 自进化：问题成立 / 建议部分合理 / — 不需要
  - 影响：一个工作已入库的 SPEC 在 STATE 里挂 blocked（因异常冻结的终态，此处为 worktree 创建失败重派循环）近 3 天，日数据持续占着「blocked: 1」却无任何机制消化——状态与实绩脱节，稀释后续真实 blocked 信号的辨识度。
  - 证据：.fenix/STATE.md 记 verify-dsh-plugins-live status=blocked、updated=2026-10-14T17:43:13、error「Failed to create worktree (gave up: parallel run or manual freeze)」（指纹 59c551238074 连续同因 3 轮）；而提交 2519ba2（10-15 00:44 合回）、44089c8（收工结果定稿 17/17）、ec996f5（10-15 01:43 verification-report 入库）证明工作已完成；STATE.md 顶部 Last updated 停在 2026-10-15T12:53。
  - 调查评估：问题源：日终 STATE 快照对账。已核实事实：blocked 由 10-14 的 worktree 并发冲突同因重派循环触发，其后实现车道照常完成并合回主树，STATE 再未更新；spec/changes/verify-dsh-plugins-live/tasks.md 尚有「原地打回第 1 轮」3 个未勾项，与已入库的 verification-report.md（内含上轮 5 个 fail 判定的复核更正、30 场景重跑，结论 bug-found 仅 1 个 minor 文档缺口）互不回写——无论哪边是最新事实，两边都停在中间态。根因（形态层）：SPEC 状态机缺「工作已落地后的 blocked 清算」路径；是 daemon 巡检缺口还是状态转移规则缺口未再深查。与存量工作关系：spec/changes/ 活跃区无相关 SPEC。结论：事件在窗前、状态在本窗仍占位的跨窗残留，系统性改进点，宜轻量立项。
  - 建议：daemon 日终对 blocked 超 24 小时的 SPEC 做对账：分支已合回且收工结果/验证报告在库的自动转 done，未勾残余项（如该 minor 文档缺口）转 code-review 台账或新 SPEC，并把对账动作写入 STATE 变更日志留痕。

## 2026-10-18

### 浪费
- **code-fix 链对已豁免条目又空转 10 个 run 才收敛**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：接受 · 删除：否
  - 影响：一条已被源码豁免标记（fenix-ignore 注释，代码注释形式的评审豁免标记）判误报的评审台账条目（code-review 发现清单条目）滞留 open，本窗 30 分钟一班的投递闸又空烧 10 个零产出 run 加 1 个收尾 run，合计约 26.8 分钟 runner 时长、$5.29；加上前窗 2 个 run，同一条目全链累计 13 个 run、约 $6.18。13 个 run 终态全部 success、零告警，终态统计对这类空转完全失明。
  - 证据：fenixd.log 18:18:36Z 至 22:48:28Z 共 9 条 chain rollup（链收尾汇总日志）均为 trigger=chain_exhausted、resolved=0、ignored=0，覆盖 code-fix-1792174524 至 code-fix-1792190725 共 10 个零产出 run（时长 185.4/168.4/132.3/124.3/171.4/147.3/119.3/124.3/111.3/175.4 秒，合计 1459.4 秒、$4.80）。各 run 存档产物行均写 skipped 且 skip_reason 带解释后缀（如 code-fix-1792188925 写 'false_positive (位置已有 fenix-ignore:5ae61ac429c4 标记…)'）。收尾 run code-fix-1792192525（146.3 秒、$0.49）恰写裸枚举 'skip_reason':'false_positive'，23:18:00Z rollup 随即变 chain_converged、ignored=1，台账条目 5ae61ac429c4（条目指纹 id）转 ignored。
  - 调查评估：问题源：处置周期评审 code-review-1792170044（上窗产出 12 条台账）修复链的遗留条目 5ae61ac429c4『成对引号值含空白+# 被误判』。已核实事实：fenixd/core/code_fix.py:125 白名单 IGNORE_ELIGIBLE_SKIP_REASONS={'false_positive','not_worth_fixing'}，:2812 对产物行 skip_reason 整串精确匹配；而 fixer 模板 agents/code-fix.md:84 要求 skip_reason 取裸枚举之一、:97 却自带『末尾附 (no_marker)』的后缀先例——模板自己示范了枚举可带后缀，模型自然附带解释文本，精确匹配必脱靶（(no_marker) 形态同样过不了白名单，读侧无任何前缀归一），脱靶 skipped 行被静默丢弃、零日志，条目保持 open，30 分钟闸次再派。根因（已裁决，单一）：fixer 模板契约与 runner 白名单口径不一致，链收敛只能靠模型偶然写裸值，第 11 轮才命中。与存量工作关系：10-17 浪费条（同链前 2 个 run）建议的『结构化上报』实际已存在（fix-out 产物行机制），本条以产物行原文加源码行号更正其双假说——fixer 已上报、runner 已解析，卡点纯在枚举匹配口径；spec/changes/ 活跃区 5 个 SPEC 均为业务插件，无覆盖本车道。结论：机制确定、可根治；复发敞口=每个带后缀的 skipped 判定至少再烧一班约 150 秒/$0.5 的 run，本链还靠夜静窗守卫（code-fix 每日 04:15-04:45 本地停投闸，告警 2a250e5f4ba1 与 14e301e34244 为入窗/出窗通知）才少烧一班。
  - 建议：① code_fix.py 白名单改前缀归一：skip_reason 以枚举值开头即命中，完整原文存入 mark_ignored 的 reasons；② code-fix.md 统一口径：skip_reason 只允许裸枚举、解释挪独立 reason 字段，并同步修正 (no_marker) 后缀规则与读侧口径；③ 链级护栏：同链连续 2 轮 resolved+ignored=0 即发 admin 信号并暂停自动重派，不再依赖夜静窗偶然省班；④ 顺手清理已合并未删的 6 个 fenix/code-review-fix-* 分支。

### 失误
- （当日无）

### 可改进
- **离群初筛连续第二窗误报批量 run，纯文本轮通胀无维度覆盖**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：接受 · 删除：否
  - 影响：批量修复 run code-fix-1792257163（一次修 9 条台账）被离群初筛按绝对 cost 标为组中位 7.1 倍的异常——连续第二个窗口对批量 run 误报；该 run 实际摊薄 $0.38/条、58 秒/条，与基线批 $0.33/条、49 秒/条基本持平，无真实浪费，而本轮真正的过程异常——204 轮中 125 轮（61%）是无工具调用的纯文本轮（基线批仅 21%）——现有 cost/时长离群维度完全观测不到。
  - 证据：数据摘要第六节初筛离群行：cost_usd=3.401 对组中位 0.483、duration_seconds=521.2 对组中位 146.9；fenixd.log 17:21:24Z run_metrics：turns=204、tool_uses=79、text_turns=125、latency_stalls=0（事件流深扫 max_gap 仅 19.7 秒，即离群与 API 停滞无关）；基线为上窗批量 run code-fix-1792170715（修 11 条：$3.62、541.2 秒、turns=104、text_turns=22、tools=82）。
  - 调查评估：问题源：code-fix 批量收尾 run 的离群初筛（run 指标超同型组中位 3 倍即标离群）。已核实事实：本 run 与基线批的条目摊薄成本/时长持平，×3 组中位绝对阈值对批量 run 连续第二窗误报（上窗 code-fix-1792158323 修 19 条被标 $7.45 异常，即 10-17 改进条『cost 计量与 token 量纲失真』，其按条目归一建议未落地）；本 run 零停滞，轮数较基线接近翻倍全部来自纯文本轮通胀，是模型输出行为漂移的可见信号，但现有观测面（cost/时长/停滞）都不捕获。与存量工作关系：10-17 改进条已立『离群按条目归一』，本条为其复发佐证加维度扩展，不另立重复 SPEC。结论：维持原建议并扩展一个维度即可，落地成本低。
  - 建议：落地 10-17 条建议（离群初筛按 cost/台账条目归一、run_metrics 补 model 字段）时，一并把 text_turns 占比纳入离群维度（如 turns>100 且纯文本轮占比>50% 即标记），让这类无停滞的轮次通胀可观测。

## 2026-10-19

### 浪费
- **周期评审 run 两轮停滞白等 530 秒，占墙钟八成仍不处置**
  - 自进化：问题成立 / 建议部分合理 / — 不需要
  - 影响：周期代码评审 run code-review-1792342923（code-review 评审链，产出台账即评审发现清单）两轮 API 停滞（stall，单轮 API 往返超 120 秒阈值）合计 530.4 秒纯等待，占该 run 664.5 秒墙钟的 79.8%，实际工作时间仅约两分钟；这是已实现的浪费，且为连续第三窗复发、逐窗加重（前两窗墙钟占比 57%，白等 386.1 秒）。
  - 证据：fenixd.log 4406-4408 行：run code-review-1792342923 于 17:07:07Z 停滞 253.9 秒（round #5）、17:12:03Z 停滞 276.5 秒（round #9），汇总「12 rounds, median 4.9s, p90 230.1s, max 276.5s, stalls>60s=2 (17%), warning=0 info=2」；4410 行 run metrics 记时长 664.6 秒、provider bigmodel.cn。两轮均 grade=info（仅留痕级）；另 4409 行 context metrics 记 stalls=2、max=276.5，而 4410 行终态 run_metrics 的 latency_stalls=0、latency_max=null——停滞量在终态记账里被清零。
  - 调查评估：问题源是周期代码评审链（code-review agent，对上窗变更文件出台账）。已核实：两轮停滞为日志直接记录，530.4/664.5=79.8% 为本窗最大单笔过程浪费；中位往返 4.9 秒而 p90 230.1 秒，停滞集中于个别超长往返。根因写到形态层：单轮 4-5 分钟往返（服务端排队/长上下文 prefill/本地网络，现有证据不足未裁决，与前两窗同形态）。与存量工作关系：10-17 改进条「评审 run API 停滞占墙钟过半，无处置只记日志」已立且建议未落地——其建议线（单次 >180 秒或累计 >300 秒升 warning 进 admin 信号面，即管理员告警处置面板）本轮双双越过（单次 276.5 秒、累计 530.4 秒）却仍 grade=info、零信号；fenixd 活跃区仅 evo-api-stall-signal-grading（停滞分级观测）在位，无处置类 SPEC。结论：复发确凿且加重，沿 10-17 条建议推进即可，不另立方向；终态记账清零一并列为其观测面修补项。
  - 建议：落地 10-17 条建议：停滞累计 >300 秒或单次 >180 秒升 warning 并进 admin 信号面，同 run 触发一次受控重试；终态 run_metrics 记录如实带入 latency_stalls/latency_max（当前被清零），供离群初筛与质量门消费。

### 失误
- **自省收尾 push 每日必败：仓库未配远程仍天天尝试**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：每日自省收尾的 git push 步骤在本仓无远程配置的前提下必然失败，连续至少 4 天每天落一条必然失败的 WARNING；commit 均已产生、无数据损失，但属每日必跑的必败空转步骤，且「降级 WARNING 不阻断」的设计让该配置缺口永久静默。
  - 证据：fenixd.log 2026-10-17T18:17:57.517511Z（本地 10-18 02:17:57，上窗自省收尾）WARNING self_review「git push 失败（降级 WARNING，commit 已产生）: fatal: No configured push destination」；同款记录另见 10-15T18:16Z、10-16T18:12Z（grep 共计 4 条）；git remote -v 对 /root/dsh-plugins 输出为空，确认从未配置远程。
  - 调查评估：问题源是每日自省链路（self_review）。已核实：仓库无任何 remote，push 步骤按「有远程」假设写死，失败被显式降级为 WARNING 只留痕——设计容忍了永久失败而非消除前置条件。根因归属：配置缺口（系统性），非单次执行失误。与存量工作关系：todo.md 既有条目与 spec/changes 活跃区均无覆盖此步。结论：零成本卫生问题，二选一即可根治（补配远程或无远程时跳过）。
  - 建议：self_review 收尾前先查 git remote：为空即跳过 push 并记 INFO「无远程，仅本地提交」；若确有异地备份需求则配置 remote。二选一消除每日必败路径。

### 可改进
- **.claude/ 散件滞留 5 天：低于阈值仅一次提示无跟进**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：复发敞口：主树 untracked（未跟踪）散件目录 .claude/（2 个 harness agent 定义文件，15842 字节）自 10-14 滞留至今 5 天无人收口——低于散件告警阈值（缺省 5 个条目）的集合按当前设计只发一次首现提示，此后无任何机制再提，同类散件每次都可无限期滞留；`?? .claude/` 还持续污染每次 git status 与 worktree diff 的状态面。
  - 证据：首现提示信号 maintree_untracked_stray_first_sight（untracked 散件首现提示，info 级只提示不处置）2026-10-14T02:33:49Z 发出，evidence 自带 gitignore 草案「.claude/（运行时产物目录，2 个未跟踪 entry 15842 字节，预防性 ignore）」至今未被执行；.fenix/stray_untracked_registry.json 该集合 escalated_signal_at=""（升级信号从未发出）；fenixd core/worktree_manager/stray_wip.py:899 对低于阈值的集合早退（:838 注释阈值为条目数、缺省 5），:939-953 的滞留 24 小时/体积升级判定对 2 条目集合永不进入；git status 现仍显示 ?? .claude/。
  - 调查评估：问题源是主树散件盘点链（maintree-stray-wip-sweep）。已核实：检测、提示、ignore 草案三要素齐全，缺的是「提示无人消费后的跟进」——首现提示不进处置流（无裁决选项、不唤起人工）、同目录仅提示一次、升级档只覆盖达到阈值（5 条目）的集合，2 条目集合结构性免于一切后续。根因归属：机制缺口（系统性），非单次失误。与存量工作关系：fenixd 活跃区 evo-stray-untracked-escalation 只管达到阈值集合的升级，evo-recurring-stray-remediation 只管 tracked 散件复发根治，evo-stray-first-sight-prevention 只管首现提示本体——低于阈值的 untracked 长尾三者均不覆盖，互补不重复。结论：小而确定；收口动作一行 ignore 即可，机制补强可并入散件族任一在飞进化。
  - 建议：短期：核对 .claude/ 归属（harness 运行时 agent 定义）后按草案把 .claude/ 追加进 .gitignore（worktrees 已单独 ignore，不冲突），或显式入库；机制：低于阈值的 untracked 集合将首现提示纳入每日自省数据摘要固定注入（或滞留超 24 小时重提示一次），消除「提示一次即永久静默」。

- **框架自研链 5 连写代码，守护 109 分钟跟随重启 5 次无合流**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：接受 · 删除：否
  - 影响：复发敞口：dsh 守护进程（本仓 .fenix 的 fenixd）在 10-18 09:02-10:51 本地的 109 分钟内，因框架仓 /root/fenixd 自家修复链 5 批代码先后合入而连续重启 5 次，每批修复都先空等 600 秒空闲闸才生效、每次重启加载的版本 9-17 分钟后即被下一批作废；本窗 5 次 drain（优雅排水重启窗口）均 waiting runs=[] 未实际伤及在飞 run，但先例（10-15 自省 run 被重启打断零产物）表明任一窗口被撞上即报废一个 run，且同型突发（4-6 连重启）已连续 3 天出现。
  - 证据：fenixd.log 4028-4177 行：陈旧检测（磁盘代码 mtime 超进程基线）01:02:51Z/01:27:31Z/01:55:13Z/02:22:25Z/02:41:36Z 共 5 次，陈旧自愈（stale_code_selfheal：检测到磁盘代码比进程内新时空闲 600 秒自动重启）触发与重启各 5 次，末次 02:51:46Z 起为当前进程（daemon_runtime.json pid 2769021）；/root/fenixd core/*.py mtime 突变五批（本地 09:02:34/09:27:07/09:55:04/10:22:23/10:41:28），各先于对应检测 2-44 秒；其中 10:22:23 与 10:41:28 两批正是该仓 merge 提交 49218d6ab（10:22 合入 fenix/code-review-fix-1792288536）与 fdedb5ee2（10:41 合入 fenix/code-review-fix-1792290176）的检出时点（我 git log 核实）。
  - 调查评估：问题源在框架仓 /root/fenixd 的自研修复链（框架仓自己也跑 code-review→code-fix 管线）。已核实：五连重启非误报——每批 mtime 突变先于检测数秒，属「真实变更→跟随重启」的正确因果；浪费在模式而非单次：修复链 17-27 分钟一批连发时，重启被逐批稀释，修复生效被 600 秒空闲闸逐批推迟，且框架自研时段固定制造每日 4-6 个重启窗口。根因归属：系统性（自愈以单次变更为设计假设，无批处理合流），非执行失误。与存量工作关系：fenixd 活跃区 add-stale-code-selfheal（自愈本体）与 evo-add-key-path-stale-code-preflight（关键路径旗标转发）均不涉重启合流；重启伤 run 的既有先例已由 10-15 失误条单独跟踪。结论：本窗直接损失为零，但复发敞口真实且高频，值得轻量立项。
  - 建议：自愈重启加合流窗：同一陈旧周期内已自愈重启过一次后，后续陈旧边沿把空闲闸从 600 秒提至更长（如 30 分钟），或挂起重启直至框架仓 code-fix 链 rollup（链收尾汇总信号）后再执行，把「N 批连发」收敛为「末批后一次重启」；在飞 run 保护沿用既有 drain 机制不动。

## 2026-10-20

### 浪费
- **评审 run 停滞白等 701 秒占墙钟九成，升 warning 后仍零处置**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：周期代码评审 run code-review-1792429231（code-review agent，对本窗变更文件产出台账）两次 API 停滞（stall，单轮 API 往返超 120 秒阈值）合计 701.0 秒纯等待，占该 run 772.8 秒墙钟的 90.7%，实际工作时间仅约 72 秒；连续第 4 窗复发且逐窗加重（前三窗墙钟占比 57%→79.8%→90.7%）。
  - 证据：fenixd.log 4771 行（2026-10-19T17:05:59Z）round #6 停滞 312.6 秒、4772 行（17:12:33Z）round #8 停滞 388.5 秒，两条 grade 均为 warning-escalated；4773 行汇总「11 rounds, median 1.4s, p90 312.6s, stalls>60s=2 (18%), warning=2」；4775 行终态 run metrics 记时长 772.8 秒；数据摘要 api-stall 聚合 total=701.0s 三方一致。同窗 code-fix-1792430442（台账修复 run）另有 1 次 68.1 秒停滞，占其 199.4 秒墙钟的 34%（fenixd.log 4796 行）。
  - 调查评估：问题源是周期代码评审链（每日凌晨对上窗变更跑的 code-review→code-fix 管线）。已核实事实：日志、终态 metrics、数据摘要三方停滞数字一致，浪费确凿。本窗有一处改进已落地：停滞 grade 从上窗的 info 升为 warning-escalated（warning-escalated，单次超 180 秒的告警升级档），说明 10-17/10-19 两条既有建议的分级观测半已生效。但两处未动：其一，数据摘要明示「窗口内无 admin 记录」，升 warning 仍止步于日志，admin 信号面（管理员告警处置面板）无消费端，受控重试未实现；其二，4775 行终态 run metrics 仍记 latency_stalls=0、latency_max=null，与其 4 行之前 4773 行 INFO 汇总（stalls=2、max=388.47）直接矛盾——终态记账清零 bug 未修，下游离群初筛与质量门若只读终态行则永远看不到停滞。根因写到形态层：单次 5-6.5 分钟的 API 往返（服务端排队/长上下文 prefill/本地网络，现有证据不足未裁决，与前三窗同形态）。与存量工作关系：10-19 既有条「停滞白等 530 秒仍不处置」建议两半——分级观测半已落地，处置半（admin 信号面+受控重试+终态记账透传）未落地，本窗是其恶化延续，不另立方向。结论：复发确凿且占比逐窗恶化，缺口只剩处置半边。
  - 建议：落地既有条处置半边：warning-escalated 停滞写入 admin 信号面并触发一次受控重试；同轮修复终态 run metrics 的 latency_stalls/latency_max 清零 bug（4773 行 INFO 汇总已有正确值，透传即可），让离群初筛与质量门能直接从终态行消费停滞数据。

### 失误
- **自省收尾 push 无远程必败第 5 天，跳过判仍未加（延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：每日自省收尾的 git push 步骤在本仓库无远程配置的前提下必然失败，已连续 5 天每天落一条必然失败的 WARNING（10-15 至 10-19 收尾各 1 条）；commit 均已产生、无数据损失，但属每日必跑的必败空转步骤，失败被降级设计永久静默。
  - 证据：fenixd.log 最新一条 2026-10-18T18:15:02Z（本地 10-19 02:15:02，恰落本窗起点）WARNING「git push 失败（降级 WARNING，commit 已产生）: fatal: No configured push destination」；我以 git remote -v 核实 /root/dsh-plugins 输出为空；grep 全日志同类记录共 5 条（10-15/16/17/18 四个收尾时点加本次）。
  - 调查评估：问题源是每日自省链路（self_review，即本任务所在链路）。已核实事实：本窗窗口起点后 2 秒即发生第 5 次，远程至今未配置，10-19 既有条建议（push 前查 remote，为空即跳过记 INFO）未落地。根因归属：配置缺口（系统性），push 步骤按「有远程」假设写死，非单次执行失误。与存量工作关系：10-19 既有失误条已完整覆盖，本窗重述标延续，第 5 天。结论：零成本卫生问题，维持原建议即可。
  - 建议：同既有条：self_review 收尾前先查 git remote，为空即跳过 push 并记 INFO「无远程，仅本地提交」；若确有异地备份需求则补配远程。二选一消除每日必败路径。

### 可改进
- **.claude/ 散件第 6 天滞留，首现提示后仍无跟进机制（延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：复发敞口：主树 untracked（未跟踪）散件目录 .claude/（2 个 harness agent 定义文件）自 10-14 滞留至今第 6 天无人收口；低于散件告警阈值（缺省 5 条目）的集合按当前设计只发一次首现提示，此后无任何机制再提，同类散件每次都可无限期滞留，且 ?? .claude/ 持续污染每次 git status 与 worktree diff 的状态面。
  - 证据：本窗起点的 gitStatus 快照与我会话内 git status --short 输出均确认 ?? .claude/ 仍在；首现提示 maintree_untracked_stray_first_sight（untracked 散件首现提示，info 级只提示不处置）2026-10-14T02:33:49Z 发出，其自带的 gitignore 草案至今未被执行。
  - 调查评估：问题源是主树散件盘点链（maintree-stray-wip-sweep，对主树未跟踪散件的周期盘点）。已核实事实：散件原地滞留第 6 天，机制缺口（低于阈值集合只首现提示一次、升级档只覆盖达阈值集合）未补。根因归属：机制缺口（系统性），非单次失误。与存量工作关系：10-19 既有改进条已完整覆盖根因与两个修法（首现提示纳入每日自省数据摘要固定注入，或滞留超 24 小时重提示一次），本窗重述标延续。结论：收口动作一行 ignore 即可，机制补强沿既有条推进。
  - 建议：同既有条：短期核对 .claude/ 归属（harness 运行时 agent 定义）后按首现提示自带草案追加进 .gitignore，或显式入库；机制上把低于阈值的 untracked 集合首现提示纳入每日自省摘要固定注入（或滞留超 24 小时重提示一次），消除「提示一次即永久静默」。

## 2026-10-21

### 浪费
- **三 run API 停滞白等 751 秒，评审件八成墙钟空转（延续）**
  - 自进化：问题成立 / 建议部分合理 / — 不需要
  - 影响：窗口内 3 个成功 run 合计被 API 长尾停滞（stall，单轮 API 往返超阈值的纯等待）拖住 751.5 秒，其中周期评审 run code-review-1792515780（对上窗变更文件产出台账的每日凌晨评审）单轮停滞 484.3 秒、占其墙钟 613.5 秒的 78.9%；停滞总量已连续第三窗上升（530.4→701.0→751.5 秒），且从评审 run 扩散到 code-fix run。
  - 证据：fenixd.log 5351 行（2026-10-20T17:12:12Z）「API round-trip stall: 484.3s (round #5 > 120s)」grade=warning-escalated；5364 行 code-fix-1792516393（台账自动修复批处理 run）停滞 177.0 秒 grade=info；5375 行 code-fix-1792517418 停滞 90.2 秒；同一评审 run 的轮次中位往返仅 10.2 秒（5352 行），484 秒单轮约为中位 47 倍；窗口内无 in-place retry（run 内原地退避重试）、无 provider switched（更换供应商）记录，非瞬断风暴。
  - 调查评估：问题源是每日凌晨周期评审→修复链（code-review→code-fix）。已核实：三 run 终态均 success，停滞为日志直接记录；窗口内无上游瞬断与限流（秒挂/超时/丢弃全为 0，日志无 Global transient break 全局熔断），形态为单轮长尾延迟而非故障风暴；根因未定、多假说并存——上游网关排队或大上下文推理变慢（该链 cache_read 达 22.7 万~63.0 万 token/件），本窗证据不足以裁决，因停滞轮的 prompt 规模无留痕。与存量关系：10-19、10-20 两条既有条目已建议「warning-escalated 停滞写入 admin 信号面并触发受控重试」，本窗 5351 行 warning-escalated 已发生而数据摘要第 3 节 admin 信号 0 条，证明建议仍未落地，属延续且恶化。结论：浪费确凿、复发近确定，机制侧缺口单列为 improvements 对应条目。
  - 建议：落地既有建议：warning 级停滞进 admin 信号面并触发一次受控重试；短期先让 stall 事件记录当轮上下文规模与 provider，积累归因证据后再决定是否做针对性优化。

### 失误
- **自省收尾 push 无远程必败第 6 天，跳过判仍未加（延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：每日自省收尾的 git push 在本仓库无任何远程配置的前提下必然失败，本窗起点后 25 秒又落第 6 条必然失败的 WARNING；commit 均已产生、无数据损失，仅持续污染日志告警面并消耗一次必败步骤。
  - 证据：fenixd.log 4833 行 WARNING self_review「git push 失败（降级 WARNING，commit 已产生）: fatal: No configured push destination」，时间 2026-10-19T18:05:25Z（本地 10-20 02:05:25 收尾，恰落本窗起点后 25 秒），为此链第 6 条（前 5 条含 3929、4448 行）；我以 git remote -v 核实本仓确无远程，10-19 既有条目建议的「先查 remote 为空即跳过」至今未落地。
  - 调查评估：问题源是每日自省链路（self-review）自身的收尾脚本。已核实：失败为确定性必败（无远程仍执行 push），被降级为 WARNING 只留痕不处置，连续 6 天每日重复，机制修正成本极低（收尾前一次 remote 检查）却未排上。根因归属：系统性缺口（收尾步骤按「有远程」假设写死），非单次失误。与存量关系：10-19、10-20 两条既有条目已完整描述根因与改法，本窗仅新增第 6 条实例，无新信息。结论：延续留痕维持可见性，应立即落地跳过判，无需新立项。
  - 建议：self_review 收尾前先查 git remote：为空即跳过 push 并记 INFO「无远程，仅本地提交」；若确有异地备份需求则补配远程，二选一消除每日必败路径。

### 可改进
- **停滞升级信号未接处置面，终态指标清零 bug 未修（延续）**
  - 自进化：问题成立 / 建议部分合理 / — 不需要
  - 影响：复发敞口：warning 级停滞升级（grade=warning-escalated，停滞分级中的需升级关注档）发生后无任何处置入口——本窗 484.3 秒停滞已升级而 admin 信号面 0 条，同类停滞每窗复发即白等 500~750 秒无干预；叠加终态 run metrics 停滞字段清零 bug，消费终态数据的下游（预算统计、重派判定）完全看不到停滞。
  - 证据：fenixd.log 5351 行 grade=warning-escalated 与数据摘要第 3 节「信号 0 条」并存；终态行 5354/5369/5377 行 latency_rounds=0、latency_stalls=0、latency_max=null，而同 run 的过程 context metrics 行（5353/5368/5376 行）记录 9/80/28 轮、停滞峰值 484.3/177.0/90.2 秒，清零形态与 10-20 既有条目点名时（4773 行）完全一致。
  - 调查评估：问题源是评审→修复链的停滞观测处置闭环。已核实：分级器已把 484.3 秒评为 warning-escalated，但升级只停在日志层，admin 信号面（管理员处置信号清单）无对应条目，升级链路在「日志→信号面」环节断开；终态 run metrics（run 收尾落盘的指标行）与过程 context metrics 双口径并存且终态行 latency 字段恒为零，10-20 条目点名的 bug 原样复现。根因归属：两处均为系统性缺口（升级事件未接处置总线、终态指标行未透传过程指标），非本次执行失误。与存量关系：10-19/10-20 既有条目已提出同一改法且本窗证明未落地，互补不重复，维持立项价值。结论：两处小改即可把「记录到的浪费」变成「可处置的浪费」，够格直接起草进化提案。
  - 建议：起草进化 SPEC：api_round_stall 的 warning-escalated 事件写入 admin 信号面并触发一次受控重试；run 收尾落盘的终态 metrics 如实透传 latency_rounds/stalls/max，消除终态清零。

- **.claude/ 散件第 7 天滞留，首现提示仍无人消费（延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：复发敞口：主树 untracked（未跟踪）散件目录 .claude/（2 个 harness agent 定义文件，约 1.6 万字节）自 10-14 滞留至今第 7 天，仍低于散件告警阈值、无任何跟进动作；同类低于阈值的散件今后仍会无限期静默滞留。
  - 证据：本窗起点 gitStatus 快照仍列「?? .claude/」（我会话内 git status --short 同样确认）；首现提示 maintree_untracked_stray_first_sight（untracked 散件首现一次性提示，info 级只提示不处置）2026-10-14T02:33:49Z 已自带 gitignore 草案，此后无任何机制跟进。
  - 调查评估：问题源是主树散件盘点链（maintree-stray-wip-sweep）。已核实：滞留进入第 7 天，10-19/10-20 两条既有条目点名的机制缺口（低于阈值仅首现提示一次、无龄期展示与超时跟进）未有任何变化，短期动作（按草案追加 .gitignore 或显式入库）零成本可做而未做。根因归属：机制缺口（提示无消费闭环），非新增失误。与存量关系：与 10-19「升级人工条目缺龄期提醒」同族——都是「提示/升级发出后无人跟进」，可合并立项。结论：本条无新增事实，纯延续留痕维持可见性。
  - 建议：同既有条：短期核对 .claude/ 归属（harness 运行时 agent 定义）后按首现提示草案追加进 .gitignore 或显式入库；机制上把低于阈值的 untracked 散件纳入带龄期的待办清单并超时重复提醒。

## 2026-10-22

### 浪费
- **评审 run 停滞白等 487 秒占墙钟九成，第 5 窗延续**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：窗口内 2 个成功 run 合计被 API 长尾停滞（stall，单轮 API 往返超阈值的纯等待）拖住 737.5 秒（约 12.3 分钟），其中周期评审 run code-review-1792602148（每日凌晨对上窗变更文件产出台账的评审件）两轮停滞 486.9 秒、占其 537.3 秒墙钟的 90.6%，基本并列历史最高（上上窗 90.7%）；评审件墙钟空转占比已连续 5 窗记录在案：57%→79.8%→90.7%→78.9%→90.6%，总白等量 386.1→530.4→701.0→751.5→737.5 秒维持高位。
  - 证据：fenixd.log 5912 行（2026-10-21T17:09:25Z）「API round-trip stall: 400.4s (round #6 > 120s)」grade=warning-escalated（停滞分级中的需升级关注档），为日志史上第二大单轮往返（纪录 484.3 秒）；5913 行汇总「10 rounds, median 1.0s, p90 117.9s, max 400.4s, stalls>60s=2」——单轮 400 秒约为中位往返的 400 倍；5924 行 code-fix-1792602685（台账自动修复批处理 run）汇总「47 rounds, stalls>60s=3, max 94.3s」合计 250.6 秒、占其 571.3 秒墙钟的 43.9%（info 级）；两 run 归档（.fenix/runs/archive/code-review-1792602148.jsonl、code-fix-1792602685.jsonl）无 in-place retry（run 内原地退避重试）与 provider switched（更换供应商）记录，纯静等。
  - 调查评估：问题源是每日凌晨周期评审→修复链（code-review→code-fix）。已核实：日志、数据摘要、run 归档三方停滞数字一致，两 run 终态均 success 且产出真实（4 条台账条目全部 resolved 并随 merge 提交 92167b5 合入主树），损失仅为墙钟空等、无 token 报废。根因维持形态层结论：单轮数百秒的长尾往返，上游网关排队、长上下文推理变慢、本地网络三类假说并存——停滞轮的 prompt 规模与流式字节流动均无留痕，现有证据不足以裁决（与前 4 窗同形态，不单独归因）。与存量工作关系：10-19/10-20/10-21 三条既有条目已给出处置方向（升级进 admin 信号面+受控重试），本窗 warning-escalated 再次发生而数据摘要第 3 节 admin 信号 0 条，证明处置半边仍未落地，属延续且无新增根因信息。结论：浪费确凿、复发近乎确定，无需另立方向，沿既有条推进即可。
  - 建议：落地既有建议：warning 级停滞写入 admin 信号面并触发一次受控重试；短期先让 api_round_stall（单轮 API 往返超 120 秒的停滞事件）补记当轮上下文规模与 provider 信息，积累归因证据后再决定是否做针对性优化。

### 失误
- **自省收尾 push 无远程必败第 7 天，跳过判仍未加（延续）**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：每日自省收尾的 git push 在本仓库无任何远程配置的前提下必然失败，本窗起点时刻（10-21 02:09 自省收尾）又落第 7 条必然失败的 WARNING；commit 均已产生、无数据损失，仅每日空跑一次必败步骤并持续污染日志告警面。
  - 证据：fenixd.log 5399 行 WARNING self_review「git push 失败（降级 WARNING，commit 已产生）: fatal: No configured push destination」，时间 2026-10-20T18:09:15Z（本地 10-21 02:09:15，恰为本窗起点收尾时点）；我以 git remote -v 核实 /root/dsh-plugins 仍无任何远程配置。
  - 调查评估：问题源是每日自省链路（self_review）自身的收尾脚本。已核实：10-19 既有条建议（push 前查 remote，为空即跳过并记 INFO）至本窗仍未落地，失败被「降级 WARNING」设计静默容忍。根因归属：系统性配置缺口（收尾步骤按「有远程」假设写死），非单次执行失误。与存量工作关系：10-19/10-20/10-21 三条既有条目已完整覆盖根因与两个修法，本窗仅新增第 7 条实例，无新信息。结论：延续留痕维持可见性，改动成本极低（收尾前一次 remote 检查），应尽快落地。
  - 建议：self_review 收尾前先查 git remote：为空即跳过 push 并记 INFO「无远程，仅本地提交」；确有异地备份需求则补配远程，二选一消除每日必败路径。

### 可改进
- **停滞升级仍未接处置面，终态指标清零 bug 未修（延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：复发敞口：warning 级停滞升级（warning-escalated，停滞分级中需升级关注的事件档位）发生后仍无任何处置入口——本窗 400.4 秒停滞已升级而数据摘要第 3 节 admin 信号 0 条，同类停滞每窗复发即白等 500~750 秒无干预；叠加终态 run metrics 停滞字段清零 bug，只读终态行的下游（预算统计、重派判定、离群初筛）完全看不到停滞。
  - 证据：fenixd.log 5912 行 grade=warning-escalated 与数据摘要第 3 节「信号 0 条、升级告警 0 条」并存；终态行 5915/5926 行（run 收尾落盘的指标行）记 latency_rounds=0、latency_stalls=0、latency_max=null，而同 run 数行之前的过程指标行 5913/5924 行记录 10 轮/2 停滞/400.4 秒与 47 轮/3 停滞/94.3 秒，清零形态与 10-20/10-21 两窗点名时完全一致。
  - 调查评估：问题源是评审→修复链的停滞观测处置闭环。已核实：10-21 既有条目立项方向（warning 停滞写 admin 信号面、触发受控重试、终态 metrics 如实透传）本窗无任何落地迹象，两处缺口原样复现。根因归属：两处均为系统性缺口（升级事件断在「日志→信号面」环节、终态指标行未透传过程指标），非执行失误。与存量工作关系：10-21 既有改进条已给出完整改法，本窗为其第 2 窗延续，互补不重复。结论：两处小改即可把「记录到的浪费」变成「可处置的浪费」，够格直接起草进化提案。
  - 建议：同 10-21 既有条：api_round_stall（单轮 API 往返超 120 秒的停滞事件）的 warning-escalated 事件写入 admin 信号面并触发一次受控重试；run 收尾落盘的终态 metrics 如实透传 latency_rounds/stalls/max，消除终态清零。

- **.claude/ 散件第 8 天滞留，首现提示仍无人消费（延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：复发敞口：主树 untracked（未跟踪）散件目录 .claude/（含 harness agent 定义与运行时 worktree 目录）自 10-14 滞留至今第 8 天无人收口，仍低于散件告警阈值（缺省 5 条目）、无任何跟进动作；「?? .claude/」持续污染每次 git status 与 worktree diff 的状态面。
  - 证据：本窗起点 gitStatus 快照与我会话内 git status --porcelain 输出均确认 ?? .claude/ 仍在；我以 git check-ignore 核实 .claude/ 未被 .gitignore 覆盖；.fenix/stray_untracked_registry.json 该集合 escalated_signal_at 仍为空（升级信号从未发出），首现提示 maintree_untracked_stray_first_sight（untracked 散件首现一次性提示，info 级只提示不处置）2026-10-14T02:33:49Z 自带的 gitignore 草案至今未执行。
  - 调查评估：问题源是主树散件盘点链（maintree-stray-wip-sweep）。已核实：滞留进入第 8 天，10-19/10-20/10-21 既有条目点名的机制缺口（低于阈值集合仅首现提示一次、无龄期展示与超时跟进）无任何变化，短期收口动作（按草案追加 ignore 或显式入库）零成本可做而未做。根因归属：机制缺口（提示无消费闭环），非新增失误。与存量工作关系：既有条已给两个修法，本窗纯延续留痕、无新增事实。结论：收口动作一行配置即可，机制补强沿既有条推进即可。
  - 建议：同既有条：短期核对 .claude/ 归属后按首现提示草案追加进 .gitignore，或显式入库；机制上把低于阈值的 untracked 散件纳入带龄期的待办清单并超时重复提醒。

## 2026-10-23

### 浪费
- **评审 run 单轮 API 停滞 513.6 秒创日志新高，占墙钟 86%（第 6 窗延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：周期评审 run code-review-1792688525（每日凌晨对上窗变更产出台账的评审件）被单轮 API 停滞（stall，单轮 API 往返超 120 秒阈值的纯等待）拖住 513.6 秒，占其 595.4 秒墙钟的 86.3%，创日志史上单轮往返新高（前纪录 484.3 秒）；评审件停滞白等占比连续 6 窗记录在案：57%→79.8%→90.7%→78.9%→90.6%→86.3%，复发敞口为每窗评审白等 6-12 分钟。
  - 证据：fenixd.log 6431 行（2026-10-22T17:10:53Z）「API round-trip stall: 513.6s (round #5 > 120s)」grade=warning-escalated（停滞分级中的需升级关注档）；6432 行汇总「10 rounds, median 4.2s, p90 57.9s, max 513.6s, stalls>60s=1」——单轮约为中位往返的 122 倍；6434 行显示 provider 为 bigmodel.cn；数据摘要第 6 节 api-stall 记录（total=513.6s）与日志一致。
  - 调查评估：问题源是每日凌晨周期评审→修复链（code-review→code-fix）。已核实：日志与数据摘要数字一致；run 终态 success 且产出真实（6436 行 inserted=5，5 条台账条目经修复提交 8732450/7f3d5e4/5564f76 随 merge 94e57f6 于 10-23 01:21 合入主树），损失纯为墙钟空等、无 token 报废；run 归档内无 in-place retry（原地重试）与 provider switched（换供应商）记录，纯静等。根因维持形态层结论：单轮数百秒长尾的上游网关排队、长上下文推理变慢、本地网络三假说并存——停滞轮的上下文规模仍无留痕，证据不足以裁决（与前 5 窗同形态，不单独归因）。与存量工作关系：10-17 立项方向（停滞进 admin 信号面+受控重试）至本窗第 6 次复现仍未落地——warning-escalated 已触发而数据摘要第 3 节 admin 信号 0 条；本窗新增事实仅「单轮 513.6 秒破纪录」，无新根因信息。结论：延续留痕维持可见性，沿既有条推进即可，无需另立方向。
  - 建议：同既有条：api_round_stall（单轮 API 往返超 120 秒的停滞事件）的 warning-escalated 写入 admin 信号面并触发一次受控重试（该轮重发或收窄上下文）；停滞事件补记当轮上下文规模与 provider 信息，积累归因证据。

### 失误
- **自省收尾 push 无远程必败第 8 次，remote 预检仍未加（延续）**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：每日自省收尾的 git push 在仓库无远程配置的前提下必然失败，本窗起点（10-22 02:08:15 自省收尾）落第 8 条必败 WARNING；commit 均已产生、无数据损失，仅每日空跑一次必败步骤并持续污染日志告警面。
  - 证据：fenixd.log 5953 行 WARNING self_review「git push 失败（降级 WARNING，commit 已产生）: fatal: No configured push destination」，时间 2026-10-21T18:08:15Z（本地 10-22 02:08:15，恰为本窗起点收尾时点）；我以 git remote -v 核实 /root/dsh-plugins 仍无任何远程配置（输出为空）。
  - 调查评估：问题源是每日自省链路（self_review）的收尾脚本。已核实：10-19 既有条建议（push 前查 remote，为空即跳过并记 INFO）至本窗仍未落地，失败被「降级 WARNING」设计静默容忍；我全量聚合窗口内 WARNING 仅 3 族共 7 条（push 必败 1、陈旧代码自愈重启 5、API 停滞 1），本条是其中唯一的执行面必败路径。根因归属：系统性配置缺口（收尾步骤按「有远程」假设写死），非单次执行失误。与存量工作关系：10-19/10-20/10-21/10-22 四条既有条目已完整覆盖根因与修法，本窗仅新增第 8 条实例，无新信息。结论：改动成本极低（收尾前一次 remote 检查），连续第 5 窗点名应尽快落地。
  - 建议：self_review 收尾先查 git remote：为空即跳过 push 并记 INFO「无远程，仅本地提交」；确有异地备份需求则补配远程，二选一消除每日必败路径。

### 可改进
- **停滞升级未接处置面、终态停滞指标清零，双缺口第 3 窗延续**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：复发敞口：warning 级停滞升级（warning-escalated）发生后仍无任何处置入口——本窗 513.6 秒破纪录停滞已升级而数据摘要第 3 节 admin 信号仍 0 条；叠加终态 run metrics 停滞字段清零 bug，下游（预算统计、重派判定、离群初筛）在终态行完全看不到停滞，每窗复发即白等 500-750 秒无干预。
  - 证据：终态清零新证据：fenixd.log 6432 行过程指标（code-review-1792688525：10 轮/1 停滞/max 513.6 秒）与 6434 行终态 run metrics（latency_rounds=0、latency_stalls=0、latency_max=null）同 run 自相矛盾；code-fix-1792689120（台账自动修复批处理 run）同形态（6443 行 51 轮/1 停滞/61.7 秒 对 6444 行全 0/null）；升级断链证据：6431 行 grade=warning-escalated 与数据摘要第 3 节「信号 0 条」并存。
  - 调查评估：问题源是评审→修复链的停滞观测处置闭环。已核实：两 run 的过程/终态指标行矛盾形态与 10-20/10-21/10-22 三窗点名时完全一致，处置断链形态也与前三窗一致。根因归属：均为系统性缺口（升级事件断在「日志→信号面」环节；终态指标行未透传过程指标），非执行失误。与存量工作关系：10-21 既有改进条已给出完整改法（warning 停滞写 admin 信号面、触发受控重试、终态 metrics 如实透传），10-22 为第 2 窗延续，本窗第 3 窗，无新缺口信息。结论：两处均为小改，够格直接起草进化提案；本条与 waste 条目互为表里（同一事件的记录面与处置面）。
  - 建议：同 10-21 既有条：api_round_stall 的 warning-escalated 写入 admin 信号面并触发一次受控重试；run 收尾落盘的终态 metrics 如实透传 latency_rounds/latency_stalls/latency_max，消除终态清零。

- **.claude/ 散件第 9 天滞留主树，ignore 草案仍未执行（延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：复发敞口：主树 untracked（未跟踪）散件目录 .claude/（含 harness agent 定义与运行时 worktree 目录）自 10-14 滞留第 9 天，仍低于散件告警阈值（缺省 5 条目）、无任何跟进动作；持续污染每次 git status 与 worktree diff 的状态面。
  - 证据：本窗起点 gitStatus 快照仍记「?? .claude/」；我以 git status --porcelain 与 git check-ignore 核实：该目录仍在且未被 .gitignore 覆盖；.fenix/stray_untracked_registry.json 中该集合的升级信号时间戳仍为空（首现提示 maintree_untracked_stray_first_sight，untracked 散件首现一次性提示，2026-10-14 自带的 gitignore 草案至今未执行）。
  - 调查评估：问题源是主树散件盘点链（maintree-stray-wip-sweep）。已核实：10-19/10-20/10-21/10-22 四条既有条目点名的机制缺口（低于阈值集合仅首现提示一次、无龄期展示与超时跟进）无变化，短期收口动作零成本可做而未做。根因归属：机制缺口（提示无消费闭环），非新增失误。与存量工作关系：既有条已给两个修法，本窗纯延续、无新增事实。结论：一行配置即可收口，机制补强沿既有条推进。
  - 建议：同既有条：核对 .claude/ 归属后按首现提示草案追加进 .gitignore，或显式入库；机制上把低于阈值的 untracked 散件纳入带龄期待办清单并超时重复提醒。

- **全部 6 个 SPEC 终态仍滞留活跃区 8-9 天，归档区从未启用（新）**
  - 自进化：问题部分成立 / 建议部分合理 / — 不需要
  - 影响：活跃区对「在飞工作」的辨识价值归零：STATE 每日快照连续多日输出同一份「blocked: 1, done: 5」静态噪声（本窗数据摘要第 1 节即此），最新 done SPEC 已滞留约 8 天；无直接经济损失，属状态面卫生与信号稀释问题。
  - 证据：STATE.md 5 个 done SPEC（add-cc-import-plugin、add-dsh-dashboard-bridge、add-fenix-skill-provider-plugin、polish-dsh-plugins-ui、bridge-projects-inline-section）的 updated 停在 2026-10-14 04:38 ~ 10-15 12:53；spec/changes/ 现存 6 个目录全部对应终态 SPEC（上述 5 done + verify-dsh-plugins-live 冻结 blocked，后者已由 10-17 既有条目点名）；我 ls 核实 spec/archive/ 为空——项目 10-14 启动以来从未归档过任何 SPEC。
  - 调查评估：问题源是 SPEC 生命周期的收尾环节（归档）。已核实：done 件交付后 6.5-9 天无任何归档动作，.fenix/todo.md 历史也从未出现过 done 归档类条目。与存量关系：10-17 既有条目只覆盖 blocked 件清算，done 件归档滞留未被点名过，互补不重复。根因归属：机制缺口（归档依赖人工调用 fenix-archive skill，日终对账只盯 blocked 不看终态超龄），非执行失误。结论：低危卫生项——一次批量归档即可清零存量；鉴于本工程近期无人工介入节奏，机制上值得并入日终对账。
  - 建议：用 fenix-archive 批量归档 5 个 done SPEC；daemon 日终对账增加「终态超 48 小时未归档」提示面（可与 10-17 既有条的 blocked 对账建议合并为同一对账点）。

## 2026-10-24

### 浪费
- **周期评审整轮报废：审查完成但产物零行被硬门拦截，$2.31 零产出**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：本窗唯一 agent run——10-24 01:01 的每日凌晨周期评审（code-review，对上窗变更文件产出台账的评审件）整轮报废：审查工作实际完成（3/3 文件）但产物文件无法创建，硬门判零有效行，inserted/updated/resolved 全为 0；直接损失 $2.31 与 951 秒墙钟，且 10-23 01:02 以来 3 个变更文件的评审静默丢失——无重派，也没有「评审缺失」层面的告警。
  - 证据：run code-review-1792774902（manifest 3 文件：cc-import/src/shared/mapping.ts、fenix-skill-provider/src/host/frontmatter.ts、fenix-dsh-dashboard-bridge/src/client/panels.tsx，redispatch_of=null）；fenixd.log 6894 行 ERROR「产物硬门拦截……零有效行（repo-code-review-gate，审查产物硬门：主产物+分片合计零有效行即判失败）」、6895 行终态 terminal=error（cost_usd=2.308、951.2 秒、输入 224,230 + 缓存读 251,840 + 输出 42,447 tokens）；归档 transcript（.fenix/runs/archive/code-review-1792774902.jsonl）尾段证实 agent 完成五维度审查但无写盘工具，3 条结论行只存在于终局文本消息里，out-code-review-1792774902.jsonl 至今不存在。
  - 调查评估：问题源是每日凌晨周期评审→修复链（code-review→code-fix）的评审件。已核实事实：会话中仅有 Read、ToolSearch（延迟工具检索）与 15 个延迟加载工具（任务/定时/网络族，deferred tools），无任何 Bash/Write/Edit——agent 用 6 次 ToolSearch 穷举检索写工具全部落空，又 Read 探测产物路径确认不存在，最终以如实失败报告收尾（stop_reason=end_turn）。根因（为何本 session 缺写工具）未定、多假说并存：两 run 之间已核实的环境变更有两处——框架代码合并+daemon 重启（10-23 03:22/03:45/03:56）与 claude CLI 升级 2.1.308（符号链接 10-23 14:48 切换）——前者可排除（同新代码的自省 session 工具集正常），后者为首要假说但同版本自省 session 仍有 Bash，单因不成立，详见 improvements 对应条。 admin 告警 f9d0a5bd0839 的「async 子代理等待收工」假设与 transcript 直接矛盾（全程 0 次子代理派发），不采信。与存量工作关系：spec/changes/ 六件均为 10-15 前终态旧 SPEC，无在飞工作覆盖本缺口。结论：报废确凿且当日审查成果仅存于归档文本，评审链当窗静默失效。
  - 建议：从归档 transcript 终局消息提取 3 条 JSONL 结论行回填台账（本轮审查成果可完全抢救）；手动或自动重派该窗评审（带 redispatch_of 链），修复前每晚 01:01 大概率重演报废。

- **评审 run 单轮 API 停滞 726.3 秒创日志新高，占墙钟 89.3%（第 7 窗延续）**
  - 自进化：问题成立 / 建议合理 / — 不需要
  - 影响：报废评审 run 的 951.2 秒墙钟里 849.4 秒（89.3%）是 API 长尾停滞（stall，单轮 API 往返超 120 秒阈值的纯等待），其中 round #4 单轮 726.3 秒创日志史上新高（前纪录 513.6 秒）；评审件停滞白等占比连续 7 窗记录在案：57%→79.8%→90.7%→78.9%→90.6%→86.3%→89.3%，复发敞口为每窗评审白等 10-14 分钟。
  - 证据：fenixd.log 6889 行（17:14:04Z）「API round-trip stall: 726.3s (round #4 > 120s)」grade=warning-escalated（停滞分级中需升级关注的档位）；6891 行 round #9 再停滞 123.1 秒；6892 行汇总「10 rounds, median 7.4s, p90 183.4s, max 726.3s, stalls>60s=2」——单轮约为中位往返的 98 倍；我 grep 该 run 归档 in-place retry（原地重试）/provider switched（换供应商）均 0 命中，纯静等；数据摘要第 6 节 api-stall（total=849.4s）与日志一致。
  - 调查评估：问题源是每日凌晨周期评审→修复链。已核实：停滞数字日志、摘要、run 归档三方一致，且本窗停滞发生在报废 run 上——约 12 分钟的 provider 侧（bigmodel.cn）长尾往返叠加落盘失败，放大了整轮损失。根因维持形态层结论：单轮数百秒长尾的上游网关排队、长上下文推理变慢、本地网络三类假说并存，停滞轮的上下文规模仍无留痕，证据不足以裁决（与前 6 窗同形态，不单独归因）。与存量工作关系：10-17 起的「停滞进 admin 信号面+受控重试」立项方向至本窗第 7 次复现仍未落地——6889 行 warning-escalated 已触发而数据摘要第 3 节 admin 信号 0 条。结论：延续留痕维持可见性，沿既有条推进即可，无新根因信息。
  - 建议：落地既有建议：warning 级停滞写入 admin 信号面并触发一次受控重试；api_round_stall 事件补记当轮上下文规模与 provider，积累归因证据。

### 失误
- （当日无）

### 可改进
- **评审车道无写工具预检与零产物自动重派，CLI 升级首跑即报废**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：复发敞口：评审车道按每日 01:01 定时触发，写工具缺失不修复则 10-25 起每晚报废一轮（参照本窗实测 $2.31/16 分钟/零入账），且评审缺口静默累积——唯一的升级告警归因错误且无处置闭环，评审缺失本身没有任何告警面。
  - 证据：归档 transcript（code-review-1792774902.jsonl）尾段：agent 6 次 ToolSearch 穷举（"bash|shell|write|edit"、"file|json|append|create|save"、"." 等，total_deferred_tools=15 全为任务/定时/网络族）确认无写工具；对照前一日归档 code-review-1792688525.jsonl：同车道 Bash 经 ToolSearch 浮现并使用 5 次（python3 heredoc 逐文件落盘）；/root/.local/bin/claude 符号链接 10-23 14:48 切至 2.1.308（versions/ 仅存 2.1.304/306/308），为两 run 之间唯一无法排除的环境变更；升级告警 f9d0a5bd0839（code_review_stall，评审零进度探测）至窗末仍未处置。
  - 调查评估：问题源是每日凌晨周期评审→修复链的评审件 spawn 与收尾环节。已核实事实：两日模型同为 glm-5.3-flash、权限模式同为 bypassPermissions（runner.py:6038 统一注入）、框架代码相同（daemon 10-23 03:56 重启后两 run 同代码），差异只在 CLI 2.1.306→2.1.308 与 session 工具集（前日 deferred 含 Bash、当日 15 个 deferred 全为任务/定时/网络族）——但与报废 run 同版本、同 runner、同配置目录的本自省 session 仍有 Bash，「2.1.308 全局移除」单因假说不成立，根因（CLI 对特定 spawn 形态的工具面 gating 变化 vs 车道级配置差异被新版激活）未定、多假说并存，需取证裁决。此处显式更正既有归因：告警 f9d0a5bd0839 文案写「疑似 async 子代理等待收工模式」，transcript 证明全程 0 次子代理派发、终局为如实失败报告，该假设不成立（不回改告警原文，以本条为准）。与存量工作关系：agents/code-review.md 已有分片直写纪律（add-code-review-sharded-out）但其前提是写工具存在，未覆盖「写工具缺失」场景；硬门（repo-code-review-gate）正确拦下了零行产物，但拦截后无自动重派。结论：系统性缺口（环境单点变更无预检、硬门拒绝无重派、发现无抢救机制），证据足以支撑立项；告警文案也应避免在证据不足时写入单因假设。
  - 建议：四步止损（不依赖未定根因）：① spawn 后先做写工具存在性探测，缺失即 fail-fast，省掉 16 分钟白做的审查；② 硬门零行拒绝后自动重派一次（带 redispatch_of 链）并升级信号；③ 从归档 transcript 终局消息提取结论行回填台账；④ 取证：对比两日 session 的 spawn argv/env 与 CLI 2.1.308 工具装配变更，定位缺席机制后再决定显式开启或锁版本。

- **runs 统计按退出口径把报废评审计为成功，硬门 error 终态不可见**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：数据摘要 runs 统计把本窗唯一 run 计为「成功: 1、失败: 0」，而该 run 实际终态为 error（硬门拒绝）——本窗唯一的失败在统计面完全不可见，直接污染每日自省的证据基座（本次若非深查日志即被误报误导），同类失败今后每窗都会被统计误报。
  - 证据：数据摘要第 2 节「总 run 数: 1、成功: 1、失败: 0、其他终态: 0」对 fenixd.log 6895 行终态 run_metrics（run 收尾落盘的指标行）terminal="error"、消息「run metrics: code-review error 'code-review'」；6896 行 admin 记录同样记 error=审查产物为零有效行。
  - 调查评估：问题源是 runs 统计聚合（数据摘要生成器的终态分类）。已核实：聚合口径与进程退出码（0）一致而与终态 run_metrics 的 terminal 字段脱节——硬门把「退出码 0 但产物无效」改判 error 后，统计面没有跟随。根因归属：系统性缺口（统计口径未采信 gate 裁决），非本窗执行失误。与存量工作关系：近三日条目无同类点名（我只读核查 .fenix/todo.md 10-21~10-23 各节确认），互补不重复。结论：一行口径修正即可，且它是评审链失效（见浪费/改进条）被静默化的放大器，够格小改立项。
  - 建议：runs 统计聚合改以终态 run_metrics 的 terminal 字段为准（error 归失败桶），退出码仅作过程参考；数据摘要生成后可与 admin 告警面交叉校验一次。

- **停滞升级仍未接信号面、终态停滞指标清零（第 4 窗延续）**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：接受 · 删除：否
  - 影响：复发敞口：warning 级停滞升级（warning-escalated）发生后仍无任何处置入口——本窗 726.3 秒破纪录停滞已升级而数据摘要第 3 节 admin 信号面（管理员处置信号清单）仍 0 条；叠加终态停滞字段清零 bug，只读终态行的下游（预算统计、重派判定、离群初筛）完全看不到停滞，每窗复发即白等 10-14 分钟无干预。
  - 证据：升级断链证据：fenixd.log 6889 行 grade=warning-escalated 与数据摘要第 3 节「信号: 0 条」并存；终态清零新证据：6893 行过程指标（10 轮/2 停滞/max 726.3 秒）与 6895 行终态 run_metrics（latency_rounds=0、latency_stalls=0、latency_max=null）同 run 自相矛盾，形态与 10-20 至 10-23 三窗点名时完全一致。
  - 调查评估：问题源是评审→修复链的停滞观测处置闭环。已核实：升级断链与终态清零两处缺口原样复现，10-21/10-22/10-23 三条既有条目已给出完整改法（warning 停滞写 admin 信号面并触发一次受控重试；终态 metrics 如实透传 latency_rounds/stalls/max），本窗无任何落地迹象。根因归属：均为系统性缺口（升级事件断在「日志→信号面」环节、终态指标行未透传过程指标），非执行失误。与存量工作关系：与 10-21 既有改进条同一缺口第 4 窗延续，互补不重复。结论：两处小改即可把「记录到的浪费」变成「可处置的浪费」，沿既有条推进、够格直接起草进化提案；本条与 waste 停滞条互为表里。
  - 建议：同 10-21 既有条：api_round_stall 的 warning-escalated 写入 admin 信号面并触发一次受控重试；run 收尾落盘的终态 metrics 如实透传 latency_rounds/latency_stalls/latency_max，消除终态清零。

## 2026-10-25

- 自上次自省以来无 SPEC 活动，跳过自省。

## 2026-10-26

- 自上次自省以来无 SPEC 活动，跳过自省。

## 2026-10-27

- 自上次自省以来无 SPEC 活动，跳过自省。

## 2026-10-28

- 自上次自省以来无 SPEC 活动，跳过自省。

## 2026-10-29

- 自上次自省以来无 SPEC 活动，跳过自省。

## 2026-10-30

- 自上次自省以来无 SPEC 活动，跳过自省。
