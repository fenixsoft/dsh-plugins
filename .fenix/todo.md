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
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：窗口内 10 个失败 run 中 9 个死于上游：6 个 TRANSPORT 流断（Stream ended without finish_reason，planner-plan 与 impl 的 -r3 重楼盘各 3 件）、3 个 bigmodel.cn 429 限流；瞬断触发全局派发熔断两轮各 600 秒，叠加 18 次 in-place retry（run 内退避重试，单次 30-120 秒）等待。
  - 证据：失败样本：planner-plan/impl-add-cc-import-plugin-*-r3 六件「TRANSPORT: Stream ended without finish_reason」；code-fix-1791999259、impl-polish-dsh-plugins-ui-1792050701-a1、admin-polish-dsh-plugins-ui-1792055791 三件 RATE_LIMIT 429；fenixd 日志「Global transient break TRIGGERED…freezing all new run dispatch for 600s」与「Probe FAILED…re-freezing…unseal count +1」；救回痕迹 in-place retry=18、provider switched=1（bigmodel.cn→inferaiapi.com，模型 glm-5.3-flash→deepseek-v4-flash）。
  - 调查评估：问题源横跨 add-cc-import-plugin、polish-dsh-plugins-ui、code-fix 批次与 admin 处置链，属上游网关容量问题（外因），非本工程代码缺陷。已核实：10:59 前后的瞬断触发全局冻结且探针复败续冻；429 甚至击杀处置 run 本身（admin-polish-1792055791），使 orphaned_state（无活动 run 驱动的停滞态探测）处置停在 pending 约 1 小时，才由后续真实状态核查收口（处置 7d48dc0945f2 已 resolved）；polish 链 16:42 吃 429、16:56 秒挂 3 连进冷却，最终 17:57 merge 收尾，救回机制有效。根因归属：外因主导，框架救回闭环。与存量关系：瞬断退避（fix-provider-transient-backoff）早已在位，add-cc-import 六连秒挂（12:13 起 20 秒内 3→6 连发）暴露的「秒挂冷却未盖全派发 lane」缺口已由 evo-add-instant-fail-cooldown-full-lane-gate 进化修复（10-15 凌晨落地，polish 16:56 的冷却日志已带该标签）。结论：损失已被救回机制托底，仅处置链自身被限流打断一处值得补强。
  - 建议：对 admin 处置 run 与自省 run 这类关键小 run 同样套用 provider 瞬断退避与失败自动重派，避免处置链被限流打断后只能靠升级告警兜底。

- **code-fix 批次三连空烧，20 条修复项两次注入两次落空**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
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
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
  - 影响：上一次每日自省（review-2026-10-15）运行 81 秒、5 turns 后被 daemon shutdown 打断，产出为零，10-15 自省整体缺失，本次回顾窗口被迫拉长到约 40 小时；浪费一个自省 run（约 1.85 万输入 token 加 2860 输出 token）。
  - 证据：run 档案 review-2026-10-15.jsonl 的 interrupted 事件（reason「daemon shutdown」，2026-10-14T18:05:47.175844Z，即本地 10-15 02:05:47）；同 run_metrics 记录 duration 81.1s、turns=5、bash×2+glob×1；紧随的 result 记录却为 subtype=success、is_error=False、num_turns=0；告警 33854db7f534（self_review_failed 升级：自省零产物 fail-closed，即无产物宁判失败不放过）；self_review_state.json 的 last_run_at 停在 10-14 02:32Z（我读核实）。
  - 调查评估：问题源是每日自省链路自身。已核实：中断由 daemon shutdown 引起；重启动机未定但时间耦合强——fenixd 框架修复 acb0a75a8 落地于 2 分钟前（02:03:35 本地），疑为加载修复而重启（未核实，无重启原因留痕）。更实质的缺陷在记账层：被中断的 run 终态记为 success（num_turns=0 与 metrics 的 5 turns 自相矛盾），零产物只能靠 fail-closed 门事后拦截升级。根因归属：停机时序为外因，终态记账缺陷为系统性——任何依赖 result 终态的下游（预算统计、重派判定）都会被误导。与存量关系：spec/changes 无相关条目；evo-api-stall-signal-grading 管停滞信号分级，不覆盖终态记账。结论：记账修正为小改，停机保护可顺势设计。
  - 建议：agent_runner 对 interrupted run 禁止记 success 终态（改记 interrupted 并保留 reason）；daemon 优雅停机时先中断在飞 run 并正确记账，重启后对自省等可重派 run 自动补跑。

### 可改进
- **验证型 spec 单 run 任务量超 turn 预算，宜按场景分批出题**
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
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
  - 自进化：问题成立 / 建议合理 / ✓ 值得立项 · 处理：待处理 · 删除：否
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
