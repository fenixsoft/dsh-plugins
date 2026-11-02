# 验证报告：add-session-grouper-and-shell-polish

> ⚠️ 本报告由框架于 2026-11-02T13:48:13Z 自动合成（裁决 Agent 未写报告，已由框架合成），内容为结构化验证产物（report.json / .fenix-run-result.json）的忠实渲染。
> 报告时效标记（判定本报告是否属上一轮）：合成源轮次指纹：report.json@2026-11-02T13:30:47.407581+00:00+run-result@mtime1793627272771027581

## 结论：❌ 未通过（Bug Found）

**状态：bug-found — 12/17 场景通过，5 失败，0 错误（1 个真实产品 Bug）**

17 场景：12 过 5 败。1 个产品 bug（grouper 插件装载即崩、缺 static inject，critical）。4 个 web 场景 env：场景静态 ?token= 与本轮 serve 启动令牌轮换竞态致 401 空白页级联零渲染，豁免引用各场景 parallel_context（batch/peers/observed_parallel=5）。静态双汉字情报经源码核实均为误报（aria-label 属性选择器不受 autoInsertSpace 影响）；被驳回 2 场景已按派生 step_error 清单逐条申报 evidence.failed_assertions 与 assertion_triage。

| 指标 | 数量 |
| --- | --- |
| 通过 | 12 |
| 失败 | 5 |
| 错误 | 0 |
| 产品 Bug | 1 |
| 本链增量 Token（输入） | 1.24M |
| 本链增量 Token（输出） | 0.22M |


## 真实产品 Bug

### BUG-01（severity=critical）· exit_code/json_output

- 关联场景：grouper-smoke-registration-and-migration
- 描述：fenix-dsh-session-grouper 插件真机装载即崩：loader 报 cannot get property "workspaceRegistry" without inject，1 entry did not activate，注册/归组/迁移/备份/台账全量不可用（settled=0、migrations.jsonl 0 行）
- 根因：src/host/index.ts:105 checkServiceSeam 直取 this.ctx.workspaceRegistry，插件类未声明 static inject 依赖注入清单，dsh 0.2.0-rc.2 loader 构造期即抛错停用插件；单测以形状桩自供 ctx 故未拦截（hostContract 8 tests 全绿）
- 证据（场景 grouper-smoke-registration-and-migration 结构化证据，引用）：
  - failed_assertions: [{"type": "exit_code", "selector": "smoke-mig-run", "expected": 0, "actual": 1}, {"type": "exit_code", "selector": "smoke-mig-check", "expected": 0, "actual": 1}, {"type": "exit_code", "selector": "失败步骤聚合", "expected": 0, "actual": 1}, {"type": "json_output", "selector": "smoke-mig-run.settled", "expected": true, "actual": false}, {"type": "json_output", "selector": "smoke-mig-check.pass", "expected": true, "actual": false}, {"type": "json_output", "selector": "checks.wsFenixd", "expected": true, "actual": false}, {"type": "json_output", "selector": "checks.ledger2", "expected": true, "actual": false}, {"type": "json_output", "selector": "checks.movedU2", "expected": true, "actual": false}, {"type": "json_output", "selector": "checks.oldU2gone", "expected": true, "actual": false}, {"type": "json_output", "selector": "checks.backupU2", "expected": true, "actual": false}]
  - screenshots: []
  - first_failed_step: 步骤2 smoke-mig-run：120s 台账未落（settled=0,ticks=60）。根因：grouper-smoke-mig-web.log 装载即崩 Error: cannot get property "workspaceRegistry" without inject（checkServiceSeam lib/index.js:625）→ warning: 1 entry did not activate → 零注册零迁移


## 场景结果

| 场景 | 描述 | 状态 | 失败断言 | 分类 |
| --- | --- | --- | --- | --- |
| grouper-deliverables-present | 交付物在场：tasks.md Deliverables 清单中 fenix-dsh-session-grouper 包的 18 个新增文件（package.json/pnpm-workspace.yaml/pnpm-lock.yaml/tsconfig.json/tsdown.config.ts/vitest.config.ts/README.zh.md、src/types/dsh-runtime.d.ts、src/shared/rules.ts、src/host/ 五模块、tests/ 四套件）加 docs/help/dsh-session-grouper-install.md 人工安装文档全部落盘（bridge 侧三处 modify 文件为存量路径，由 bridge 场景核对内容）。lib/host.js 为 gitignored 构建产物（design.md 决策 9），由构建场景核对。插件安装形态为 web profile 的 link: 主树目录依赖（proposal.md:16），属 package.json 清单形态而非 UI 交互元素。出处：tasks.md:3-50 交付清单、declaration-baseline.json。 | pass | 0/2 | - |
| grouper-plugin-install-and-build | 工程可安装可构建（tasks.md:55 任务 1.2、tasks.md:84 任务 7.2 构建链）：镜像 bridge 的 pnpm 工作区形态——pnpm install 从落库 lockfile 装出依赖（peerDependencies 精确钉 0.2.0-rc.2）、tsc --noEmit 类型检查全绿、tsdown 构建产出 lib/host.js（纯 host 半单入口）。环境依赖：pnpm registry 网络可达，有 fallback: 依赖命中本机 pnpm store 时可 --offline 安装（对齐 bridge-install-and-build 先例）。出处：tasks.md:54-55、design.md:34（决策 9 交付形态）。 | pass | 0/4 | - |
| grouper-package-manifest-contract | 插件清单契约（design.md:32 决策 7、tasks.md:63 任务 3.1、tasks.md:35 任务 1.2）：package.json name=fenix-dsh-session-grouper、type=module、入口指向 lib/index.js（loader 按 package.json main 装载；lib/host.js 为回滚 CLI）；清单内嵌 config 声明段含四个配置键 projects/quietMinutes/intervalMinutes/enabled （bridge 的 dsh 段同款 loader config 通道，specs/session-grouper/spec.md:68）；缺省项目根 /root/fenixd 与 /root/dsh-plugins 在场（缺省即生效，design.md:32）；被消费包版本钉扎 0.2.0-rc.2（design.md:35 决策 10）。 | pass | 0/6 | - |
| grouper-install-doc-contract | 文档交付契约（tasks.md:84 任务 7.1、tasks.md:54 任务 1.1 实现笔记段、proposal.md:16）：docs/help/dsh-session-grouper-install.md 含人工安装步骤——主树 pnpm install + 两插件构建、web profile 增 link: 依赖（link: 为 profile 清单依赖形态，非 UI 元素）、systemctl restart dsh-web、真机验收清单（存量会话归入两工程分组且未分组仅剩作用域外会话、在飞 run 会话静默期不迁移、enabled=false 零动作、回滚演练一例）、bridge 两项合并后浏览器强刷即生效无需重启的标注、安装包契约探针实现笔记段；README.zh.md 含机制/配置/回滚/版本钉扎/已知限制。 | pass | 0/4 | - |
| bridge-src-contract-suite-green | bridge client 契约单测全绿且为 6 条目契约（tasks.md:80 任务 6.3）：tests/srcContract.test.ts 更新为6 条目契约——id/label/order/深链一一对应（fenix-command-center→#/command-center，指挥中心 order 11 位于概览与项目之间、其余条目 order 顺延）、分区容器无边框断言（sectionStyle 无 border、降级浮层分组列表 groupListStyle 边框保留，tasks.md:78 任务 6.1）。出处：specs/fenix-dash-bridge/spec.md:3-13、design.md:33（决策 8）。 | pass | 0/3 | - |
| bridge-client-bundle-six-entries | 构建产物 6 条目契约（tasks.md:79 任务 6.2、design.md:33 决策 8）：lib/client.js 构建产物含第 6 个固定条目全部标记——条目 id fenix-command-center、深链 #/command-center、label 指挥中心；main keyed 面板由既有循环自动注册（深链 iframe src 契约 <prefix>/?embed=1&apiBase=<apiBase>#/command-center 由 buildPanelSrc 单源拼装，src/shared/config.ts:89-96）。bridge lib 由验证契约 prepare 段从本仓库源码重建（.fenix/verify.yaml prepare），产物即本轮实现面。 | pass | 0/5 | - |
| bridge-sidebar-six-entries-order | 侧栏固定菜单条目 5→6（specs/fenix-dash-bridge/spec.md:3-8 Requirement 与「固定条目可见」Scenario）：bridge client 半装载完成后，dsh web 侧栏「全局面板」nav 内出现 6 个 bridge 固定条目（概览/指挥中心/项目/设置/运维/帮助，图标 + 中文 label），「指挥中心」位于「概览」与「项目」之间（order 10–15，design.md:33 决策 8、tasks.md:79 任务 6.2）。顺序以 CSS 兄弟组合器语义断言（概览~指挥中心、指挥中心~项目），不用第 n 个子元素。navigate 环境依赖与出处：目标为 dsh web 壳层入口 `/`（layout main + 侧栏 nav），端口 3080 为 design.md:3 记录的 dsh web 缺省端口——origin 由验证框架 BASE_URL 铁律改写到本轮 serve 实例（core/verify_contract.py rewrite_scenarios_origin，路径与 query 保留）；?token= 为 dsh web 浏览器鉴权启动令牌（@deepseek-ai/dsh-client-connection/lib/index.js authorizeIndex：根查询 token 换签名 cookie，dsh-web-app/lib/index.js:203 启动打印 `dsh web: <authenticatedUrl>`），token 已按本轮 serve boot 日志回填（fbaCvhCGQj91HqZRSllfhSrIm6_f3u0egfvfSa9nPoc，2026-11-02 裁决原地修复，curl 实测 303）；无 fallback（令牌为进程启动随机凭据，不可预测）。侧栏 DOM 出处：@deepseek-ai/dsh-client-ui-sidebar/lib/client.js——panellist 列表插槽渲染为 `nav[aria-label="全局面板"]`（zh 词条 panels.label），每条目为 `button[type=button][aria-label=<label>]`（PanelRow）。 | fail | 10/10 | env |
| grouper-built-host-seam-contract | 构建产物服务缝契约（specs/session-grouper/spec.md:3-4、:17、:50、tasks.md:68-69 任务 4.1/4.2）：lib/index.js 构建产物（loader 装载入口）含官方服务缝消费标记——workspaceRegistry（项目工作区注册/attach）、attachSession（官方归组门）、session-grouper-backups（备份目录字面量）、migrations.jsonl（迁移台账字面量）、quietMinutes（静默期配置消费）；纯 host 半、无 client 产物（proposal.md:11）。依赖构建场景先产出产物。 | pass | 0/6 | - |
| grouper-rules-suite-green | 纯规则层测试全绿且分支覆盖到位（tasks.md:59 任务 2.1）：tests/rules.test.ts 对 src/shared/rules.ts 纯函数的六个迁移 Scenario 分支全覆盖——路径包含归属判定（cwd==项目根或以 <项目根>/ 开头）、多项目根命中取最长前缀、mangled 会话目录名推导、迁移计划构造的 skip 项带机器可读 reason（作用域外/静默期不足/已归组/目标产物冲突）。vitest 以真实 TS 源执行，suite 退出码仲裁。出处：specs/session-grouper/spec.md:16-47 六个迁移 Scenario。 | pass | 0/3 | - |
| grouper-settings-suite-green | 配置解析层测试全绿（tasks.md:63 任务 3.1）：tests/settings.test.ts 覆盖 loader config 归一——projects 缺省 ['/root/fenixd','/root/dsh-plugins']、quietMinutes 缺省 30、intervalMinutes 缺省 10、enabled 缺省 true（缺省配置安全可用，specs/session-grouper/spec.md:68）；非法输入装载期显式抛错不静默取缺省（显式失败纪律，design.md:14）。 | pass | 0/3 | - |
| grouper-host-contract-suite-green | 装载/停用/服务缝漂移三分支测试全绿（tasks.md:64 任务 3.2）：tests/hostContract.test.ts 以形状桩覆盖——启动期服务缝存在性校验（ctx.workspaceRegistry / ctx.sessionPersistence 缺失或运行时版本与 peer 钉版0.2.0-rc.2 不符 → 显式错误停用扫描循环，MUST NOT 静默降级，specs/session-grouper/spec.md:77-78）；enabled=false 零动作零注册（specs/session-grouper/spec.md:70-73）；周期扫描循环可停止、单会话失败不中断整轮（错误隔离）。 | pass | 0/3 | - |
| grouper-migrator-suite-green | 扫描迁移层测试全绿且真机语义到位（tasks.md:70 任务 4.3、tasks.md:74 任务 5.1）：tests/migrator.test.ts 以临时 DSH_HOME（隔离目录）优先用真实持久化包装配（@deepseek-ai/dsh-session-persistence-jsonl / dsh-workspace 形缝，MUST NOT 直写真实 ~/.dsh/sessions），覆盖 spec session-grouper 全部 Scenario——worktree 会话归入工程、根直属会话归入、原目录已删除的陈旧会话、静默期内在飞跳过、目标产物冲突跳过、作用域外会话不动、备份与台账落位、写竞争中止、回滚后归属状态复现。出处：specs/session-grouper/spec.md:19-65 全部 Scenario、design.md:42（隔离测试纪律）。 | pass | 0/3 | - |
| grouper-smoke-registration-and-migration | 真机冒烟·注册与迁移归组（specs/session-grouper/spec.md:7-9、:19-32、:34-37、:44-47、:52-55 六 Scenario 的端到端载体；tasks.md:84 任务 7.2 冒烟口径）：隔离 DSH_HOME=/root/.fenix-verify/grouper-smoke-mig（与生产 ~/.dsh 零交集，真实 dsh 0.2.0-rc.2 CLI 装配 web profile + link: 插件 + loader insert 条目）内植入 4 个真实会话产物夹具——根直属会话（cwd=/root/dsh-plugins，静默期外）、fenixd worktree 会话（cwd 在 /root/fenixd 树内，静默期外）、在飞会话（mtime 5 分钟 < 缺省静默期 30 分钟）、作用域外会话（cwd=/root/activation-showcase，不在项目根树内）；插件经 workspaceRegistry.create 注册两项目工作区、重写冷会话 header cwd、产物归位、官方 attachSession 归组、备份 + migrations.jsonl 台账；在飞会话本轮跳过、作用域外会话不动且不注册其工作区。台账行含 sessionId/目标根/时间戳。 | failed（已修正） | 10/15 | product-bug |
| bridge-command-center-click-panel | 点击「指挥中心」切换主面板（specs/fenix-dash-bridge/spec.md:10-13「点击切换主面板」Scenario）：点击侧栏指挥中心条目后主面板切换为指挥中心 iframe，src 契约为 <prefix>/?embed=1&apiBase=<apiBase>#/command-center（buildPanelSrc 单源拼装，fenix-dsh-dashboard-bridge/src/shared/config.ts:89-96、src/client/index.ts FIXED_ENTRIES 深链注册）；条目呈激活态（aria-current=page）、概览条目退出激活态（回归点：切换后状态对比）；dsh web 会话入口（新建会话按钮）仍在，会话面板经 conversation 保留键可回到对话。navigate 环境依赖与出处：目标为 dsh web 壳层入口 `/`（layout main + 侧栏 nav），端口 3080 为 design.md:3 记录的 dsh web 缺省端口——origin 由验证框架 BASE_URL 铁律改写到本轮 serve 实例（core/verify_contract.py rewrite_scenarios_origin，路径与 query 保留）；?token= 为 dsh web 浏览器鉴权启动令牌（@deepseek-ai/dsh-client-connection/lib/index.js authorizeIndex：根查询 token 换签名 cookie，dsh-web-app/lib/index.js:203 启动打印 `dsh web: <authenticatedUrl>`），token 已按本轮 serve boot 日志回填（fbaCvhCGQj91HqZRSllfhSrIm6_f3u0egfvfSa9nPoc，2026-11-02 裁决原地修复，curl 实测 303）；无 fallback（令牌为进程启动随机凭据，不可预测）。侧栏 DOM 出处：@deepseek-ai/dsh-client-ui-sidebar/lib/client.js——panellist 列表插槽渲染为 `nav[aria-label="全局面板"]`（zh 词条 panels.label），每条目为 `button[type=button][aria-label=<label>]`（PanelRow）。 | fail | - | env |
| grouper-smoke-disabled-zero-action | 真机冒烟·开关关闭零动作（specs/session-grouper/spec.md:70-73 Scenario：enabled=false 时插件装载成功但不注册工作区、不迁移会话）：隔离 DSH_HOME=/root/.fenix-verify/grouper-smoke-dis 以 loader 行 config enabled:false 装载同一插件，植入同款 4 会话夹具后运行 dsh web 约 30 秒——不注册任何项目工作区、无 session-grouper 台账目录、无 session-grouper-backups 备份目录、4 个会话夹具全部保持在原 mangled 目录（零迁移）。 | pass | 0/8 | - |
| bridge-projects-section-borderless | 「项目」分区容器去边框（specs/fenix-dash-bridge/spec.md:22-26「分区容器无边框」Scenario、tasks.md:78 任务 6.1）：分区容器不渲染边框线（sectionStyle 移除 border——style 属性无 `border:` 声明，CSS 属性子串选择器区分 border: 与保留的 border-radius:/box-sizing: border-box，现值见 fenix-dsh-dashboard-bridge/src/client/panels.tsx:869-881），背景与圆角保留（style 属性仍含 border-radius）；分区常驻呈现且真实上游 6 项目各一行（首字母徽标 + 项目名）。「暂无项目」空态壳与窄态壳同容器渲染，其无边框由 srcContract 套件断言（bridge-src-contract-suite-green）。环境依赖：项目行数据来自真实上游 dashboard（127.0.0.1:8787，验证契约 ready 探针保障在场）；有 fallback: 无——上游失联时分区呈空态、行数断言如实失败，按环境问题升级处置，不得以 mock 掩盖。DOM 出处：panels.tsx:959 `<section data-testid="fenix-projects-section" aria-label="项目">`、navigate 环境依赖与出处：目标为 dsh web 壳层入口 `/`（layout main + 侧栏 nav），端口 3080 为 design.md:3 记录的 dsh web 缺省端口——origin 由验证框架 BASE_URL 铁律改写到本轮 serve 实例（core/verify_contract.py rewrite_scenarios_origin，路径与 query 保留）；?token= 为 dsh web 浏览器鉴权启动令牌（@deepseek-ai/dsh-client-connection/lib/index.js authorizeIndex：根查询 token 换签名 cookie，dsh-web-app/lib/index.js:203 启动打印 `dsh web: <authenticatedUrl>`），token 已按本轮 serve boot 日志回填（fbaCvhCGQj91HqZRSllfhSrIm6_f3u0egfvfSa9nPoc，2026-11-02 裁决原地修复，curl 实测 303）；无 fallback（令牌为进程启动随机凭据，不可预测）。侧栏 DOM 出处：@deepseek-ai/dsh-client-ui-sidebar/lib/client.js——panellist 列表插槽渲染为 `nav[aria-label="全局面板"]`（zh 词条 panels.label），每条目为 `button[type=button][aria-label=<label>]`（PanelRow）。 | fail | 5/6 | env |
| bridge-project-row-click-regression | 回归点·点击项目行切换面板契约不变（specs/fenix-dash-bridge/spec.md:27-31「点击项目行切换面板」Scenario）：点击分区内项目行「fenixd」后主面板切换为该项目 iframe（src 深链 #/projects/fenixd——本 SPEC 不改此契约），分区内该项目行呈高亮（data-active="true"）。这是去边框与 6 条目改动对既有交互的回归守卫。DOM 出处：panels.tsx:463-486（data-testid=fenix-project-row-<name>、data-active、navigate 环境依赖与出处：目标为 dsh web 壳层入口 `/`（layout main + 侧栏 nav），端口 3080 为 design.md:3 记录的 dsh web 缺省端口——origin 由验证框架 BASE_URL 铁律改写到本轮 serve 实例（core/verify_contract.py rewrite_scenarios_origin，路径与 query 保留）；?token= 为 dsh web 浏览器鉴权启动令牌（@deepseek-ai/dsh-client-connection/lib/index.js authorizeIndex：根查询 token 换签名 cookie，dsh-web-app/lib/index.js:203 启动打印 `dsh web: <authenticatedUrl>`），token 已按本轮 serve boot 日志回填（fbaCvhCGQj91HqZRSllfhSrIm6_f3u0egfvfSa9nPoc，2026-11-02 裁决原地修复，curl 实测 303）；无 fallback（令牌为进程启动随机凭据，不可预测）。侧栏 DOM 出处：@deepseek-ai/dsh-client-ui-sidebar/lib/client.js——panellist 列表插槽渲染为 `nav[aria-label="全局面板"]`（zh 词条 panels.label），每条目为 `button[type=button][aria-label=<label>]`（PanelRow）。 | fail | - | env |


## 断言级豁免清单

以下失败断言被归类为非产品缺陷（不记产品 Bug），逐条列出供人工复核豁免是否掩盖真实缺陷（场景级一句话归因不足以复核）。

| 场景 | 断言 | 归类 | 豁免理由 | 证据 |
| --- | --- | --- | --- | --- |
| bridge-sidebar-six-entries-order | element_visible 概览条目可见 | env | 环境因素（非产品缺陷） | aria-label=概览 条目零命中源于 401 鉴权失效（token 轮换竞态），非选择器缺陷；静态双汉字情报为误报——aria-label 属性值匹配不受 autoInsertSpace 影响（sidebar PanelRow 渲染 aria-label: label） |
| bridge-sidebar-six-entries-order | element_visible 指挥中心条目可见（新增第 6 条目） | env | 环境因素（非产品缺陷） | 指挥中心条目（bridge FIXED_ENTRIES order 11，src/client/index.ts:39）未渲染：401 致 nav[aria-label=全局面板] 不存在，非 bridge 注入缺陷 |
| bridge-sidebar-six-entries-order | element_visible 项目条目可见 | env | 环境因素（非产品缺陷） | 项目条目零命中同因：401 空白页（dominant_color 99.8%）DOM 为空，属性选择器与源码 PanelRow 一致 |
| bridge-sidebar-six-entries-order | element_visible 设置条目可见 | env | 环境因素（非产品缺陷） | 设置条目零命中同因：401 后页面无任何面板 DOM，wait_for 3000ms 超时属鉴权失效级联 |
| bridge-sidebar-six-entries-order | element_visible 运维条目可见 | env | 环境因素（非产品缺陷） | 运维条目零命中同因：本轮 serve 重启换发随机令牌，静态 token 失效致页面未装载 |
| bridge-sidebar-six-entries-order | element_visible 帮助条目可见 | env | 环境因素（非产品缺陷） | 帮助条目零命中同因：静态 token 失效致 401，非产品回归 |
| bridge-sidebar-six-entries-order | element_visible 指挥中心位于概览之后（兄弟序） | env | 环境因素（非产品缺陷） | 兄弟序组合选择器依赖两条目同时在场：401 空白页致零命中，非条目顺序缺陷 |
| bridge-sidebar-six-entries-order | element_visible 指挥中心位于项目之前（兄弟序） | env | 环境因素（非产品缺陷） | 同因：兄弟序断言依赖壳层渲染，401 级联零命中 |
| bridge-sidebar-six-entries-order | text_contains nav 内含指挥中心中文 label | env | 环境因素（非产品缺陷） | nav 文本 0 命中（wait_for attached 未命中）：壳层 401 未渲染；lib/client.js 已含指挥中心标记且 bridge-src-contract-suite-green 35 tests 全绿 |
| bridge-sidebar-six-entries-order | no_console_error | env | 环境因素（非产品缺陷） | 唯一 console error 为 401 资源加载失败：场景静态 token 与本轮 serve 启动令牌不匹配（基础设施令牌每轮轮换），非产品 JS 异常 |
| bridge-command-center-click-panel | step_error[步骤3(click nav[aria-label="全局面板"] button[aria-label="指挥中心"])] | env | 环境因素（非产品缺陷） | 步骤3 click 指挥中心条目超时：401 鉴权失效级联（静态 token 与本轮 serve boot 令牌不匹配，curl 复测静态 401/boot 303），壳层空白致侧栏 nav 零渲染；非交互契约或面板注册缺陷；assertions[2] 双汉字情报核实为误报（aria-label 属性值匹配，不受... |
| bridge-projects-section-borderless | element_visible 常驻项目分区可见 | env | 环境因素（非产品缺陷） | 分区容器零命中：401 空白页（token 轮换竞态），非 panels.tsx:959 section 渲染缺陷（DOM 出处与源码一致） |
| bridge-projects-section-borderless | element_visible 分区容器圆角保留 | env | 环境因素（非产品缺陷） | 圆角断言零命中同因：分区未渲染，样式断言无从谈起；无边框断言（element_not_exist border:）因零命中空过亦属同因 |
| bridge-projects-section-borderless | element_count 真实上游 6 项目各一行 | env | 环境因素（非产品缺陷） | actual=0：项目行依赖分区挂载与上游数据渲染，401 致零行，非上游失联（ready 探针已保障 8787 在场） |
| bridge-projects-section-borderless | text_contains 分区含项目名行 | env | 环境因素（非产品缺陷） | 文本 0 命中（wait_for attached 未命中）：同因壳层 401 未渲染 |
| bridge-projects-section-borderless | no_console_error | env | 环境因素（非产品缺陷） | 唯一 console error 为 401 资源加载：静态 token 失效所致，非产品 JS 异常 |
| bridge-project-row-click-regression | step_error[步骤3(click [data-testid='fenix-project-row-fenixd'])] | env | 环境因素（非产品缺陷） | 步骤3 click 项目行 fenixd 超时：401 鉴权失效级联（token 轮换竞态）致分区与项目行未渲染；非行 DOM 回归缺陷——panels.tsx:463-486 data-testid=fenix-project-row-<name>/data-active 与源码一致，选择器出处无误 |

## 本轮场景集变更

场景集与持久化集一致，无变更。

