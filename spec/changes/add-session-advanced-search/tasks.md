# Tasks: add-session-advanced-search（会话高级搜索插件）

## Deliverables

```yaml
- path: fenix-dsh-session-advanced-search/package.json
  kind: new
- path: fenix-dsh-session-advanced-search/cordis.patch.yml
  kind: new
- path: fenix-dsh-session-advanced-search/pnpm-workspace.yaml
  kind: new
- path: fenix-dsh-session-advanced-search/pnpm-lock.yaml
  kind: new
- path: fenix-dsh-session-advanced-search/tsconfig.json
  kind: new
- path: fenix-dsh-session-advanced-search/tsdown.config.ts
  kind: new
- path: fenix-dsh-session-advanced-search/vitest.config.ts
  kind: new
- path: fenix-dsh-session-advanced-search/README.zh.md
  kind: new
- path: fenix-dsh-session-advanced-search/src/shared/protocol.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/shared/config.schema.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/types/dsh-runtime.d.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/host/index.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/host/jobs.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/host/collector.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/host/analyzer.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/host/routes.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/client/index.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/client/searchButton.ts
  kind: new
- path: fenix-dsh-session-advanced-search/src/client/searchDialog.tsx
  kind: new
- path: fenix-dsh-session-advanced-search/src/client/jump.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/protocol.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/jobs.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/collector.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/analyzer.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/routes.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/searchButton.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/dialog.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/tests/jump.test.ts
  kind: new
- path: spec/changes/add-session-advanced-search/design.md
  kind: modify
```

## 1. 缝侦察与插件脚手架

- [x] 1.1 侦察官方缝并把结论回填 `spec/changes/add-session-advanced-search/design.md`（D5/Open Questions 节，含精确形态）：① `dsh-client-ui-sidebar` bundle 中侧栏搜索输入框与清除(X)按钮的稳定 DOM 锚点签名（用于 MutationObserver 注入）；② 既有会话打开缝——`dsh-client-ui-session`/侧栏选中态服务键与方法名（若无缝则确定侧栏列表项 UI click 兜底路径）；③ host 侧 LLM 服务缝键名（对照 `dsh-experimental-session-titles-bundle` 的获取方式）
- [x] 1.2 创建插件包脚手架 `fenix-dsh-session-advanced-search/`：package.json（name=`fenix-dsh-session-advanced-search`，exports `.` + `./client`，engines `dsh >=0.2.2-rc.1 <0.3`，`dsh.bundle.patch` 与 `dsh.client{platform:'web',inject:[...]}` 声明，peer/devDeps 按仓内插件惯例钉 `0.2.2-rc.1`）、tsconfig.json、tsdown.config.ts（产出 lib/host.js + lib/client.js）、vitest.config.ts（含 jsdom 环境）、pnpm-workspace.yaml、cordis.patch.yml（host/client 装配 patch）
- [x] 1.3 创建 `src/types/dsh-runtime.d.ts`：消费缝类型（slots/layout/sessions/webServer/sessionPersistence/LLM 服务缝，含锚点缝与侦察结论注释）

## 2. shared 契约与配置

- [x] 2.1 `src/shared/protocol.ts`：分析任务协议类型——SearchRequest（query 必填非空、timeRange?{start,end}）、任务状态 phase 枚举（collecting/filtering/analyzing/done/error/cancelled）、Candidate 结果结构（sessionId/title/workspacePath/activityTime/reason/confidence/degraded?）、HTTP API 请求/响应载荷（POST /api/session-advanced-search/jobs、GET/DELETE /api/session-advanced-search/jobs/:id）
- [x] 2.2 `src/shared/config.schema.ts`：loader config 解析与校验（enabled=true、maxCandidates=30、topN=5、llmTimeoutMs=60000；非法值类型/范围装载期显式抛错）
- [x] 2.3 `tests/protocol.test.ts`：协议类型守卫与请求载荷校验（空 query 拒绝、时间范围合法性）

## 3. host 半：任务、收集、分析、路由

- [x] 3.1 `src/host/jobs.ts` + `tests/jobs.test.ts`：进程内任务表（Map<jobId,Job> + AbortController，支持多在途任务并存）；「同一 client 单在途、重复提交取消旧任务」语义由 client 半保证（见 4.4 提交前 DELETE 旧任务；host 不做隐式取消，避免跨标签页互踩，与 design D6 多标签页隔离一致）；DELETE 取消；GET 未知 jobId 返回 404 语义；任务状态机与终态幂等
- [x] 3.2 `src/host/collector.ts` + `tests/collector.test.ts`：只读收集（sessionPersistence.list 全量 header，覆盖全部工作区）→ 可选时间范围过滤 → 关键词计分（标题+cwd 命中加分）→ maxCandidates 截断（评分优先、同分取最近活跃）；首条用户消息节选 ≤2KB；管线逐级可观测（采集链路交付项）：收集总数→时间过滤后→计分截断后各阶段候选数量以 debug 级日志逐级输出；测试含只读断言（收集前后测试夹具产物的内容与 mtime 不变）与时间过滤/截断/零候选分支
- [x] 3.3 `src/host/analyzer.ts` + `tests/analyzer.test.ts`：LLM 单调用排序（候选摘要打包单 prompt，严格 JSON 解析出 id+reason+confidence，按 topN 截取）；LLM 缺失/超时/解析失败 → 机械评分排序回退并置 degraded=true，且按原因分类记录 warn 级日志（服务缺失/超时/解析失败）映射进 degraded 原因；测试用 stub LLM 覆盖命中排序、失败回退、空候选、topN 截断
- [x] 3.4 `src/host/routes.ts` + `tests/routes.test.ts`：webServer.register 三端点契约（POST 建 job 立即返回 jobId；GET 轮询 phase/results/degraded；DELETE 取消）；路径前缀 `/api/session-advanced-search`；与测试桩 webServer 缝对账
- [x] 3.5 `src/host/index.ts`：host 半装配（config 解析、依赖缝缺失 error 级显式停用不注册路由、注册/卸载对称）

## 4. client 半：注入、弹窗、跳转

- [x] 4.1 `src/client/searchButton.ts` + `tests/searchButton.test.ts`（jsdom）：MutationObserver + design.md 回填的锚点签名，在 X 按钮左侧插入仅图标按钮（内联 SVG、title/hover 提示「高级搜索」）；锚点失配 → warn 日志 + 放弃注入不抛错；测试覆盖注入成功位置、hover 提示、失配降级、卸载清理（observer 断开、按钮移除）
- [x] 4.2 `src/client/searchDialog.tsx` + `tests/dialog.test.ts`（jsdom）：高级搜索弹窗（复用 dsh-client-ui-primitives 基元，缺原语自绘 overlay）——描述输入（空/空白时提交禁用）、可选开始/结束日期、关闭按钮与 Esc、关闭重开状态重置、提交后 1s 轮询进度并展示阶段文案（收集会话/预筛候选/agent 分析中）、结果列表（标题/工作区/时间/理由/置信度）、degraded 标注（「LLM 分析不可用，已按机械匹配排序」）、空态文案、候选点击回调
- [x] 4.3 `src/client/jump.ts` + `tests/jump.test.ts`：会话跳转——优先 design.md 回填的服务缝，无缝时侧栏列表项 UI click 兜底；跨工作区会话直接生效；跳转前后关闭弹窗；测试以 stub 缝注入覆盖服务缝优先、兜底 click、跨工作区参数传递、关闭弹窗分支
- [x] 4.4 `src/client/index.ts`：client 半装配——按钮点击开弹窗、提交经 fetch 调 POST jobs、轮询 GET、重复提交取消旧任务（DELETE+新建）、候选点击调 jump、卸载清理对称

## 5. 构建、文档与收尾

- [x] 5.1 全量 `vitest run` 通过且 `tsdown` 构建成功产出 lib/host.js 与 lib/client.js（在插件目录内 `pnpm install` + `pnpm test` + `pnpm build`，零测试跳过零构建告警阻断）
- [x] 5.2 `README.zh.md` 完整成文：机制（注入缝/HTTP API/分析管线/降级矩阵）、配置表（enabled/maxCandidates/topN/llmTimeoutMs）、安装人工步骤（目录进 profile pnpm workspace + `/root/.dsh/profiles/web/cordis.patch.yml` insert 登记 + 重启 profile——明确标注为人工步骤）、回滚（insert 移除）、已知限制（锚点签名记录：侦察得到的精确 DOM 形态，供官方升级后修缝）
- [x] 5.3 确认 `spec/changes/add-session-advanced-search/design.md` 的 D5 与 Open Questions 节已回填 1.1 侦察结论（精确锚点签名、跳转缝键名或兜底路径、LLM 服务键），与实现代码一致

## 验证修复（原地打回第 1 轮）

### 上轮实现结论（自动携带，来自上一轮 implementer 收工结论）

验证修复（原地打回第 1 轮）完成：复核 verification-report 失败场景确认唯一真实产品 Bug BUG-01——src/host/routes.ts prefix 座位以 JOBS_PATH 加尾斜杠注册，违反 dsh-host-webserver match() 规则 pathname===prefix 或 startsWith(prefix 加斜杠)（exact 命中优先、最长前缀胜出；已读实机 /usr/lib/node_modules/@deepseek-ai/dsh 下 dsh-host-webserver/lib/index.js 实源坐实），深层路径 GET/DELETE jobs/:id 永落网关 404；场景断言与契约一致，零场景文件缺陷。产品修复：prefix 座位 path 去尾斜杠（与 exact 座位同 path 不冲突，exact 优先分发）并钉契约注释；tests/routes.test.ts 分发桩由宽松 startsWith 改为忠实镜像 match() 语义（该宽松桩正是 BUG-01 漏网缺口），新增「prefix 座位无尾斜杠」与「深层路径 404 出自 handler 而非分发兜底」两回归用例；tests/host.test.ts 三处座位键同步修正。重跑验证：tsc --noEmit 零错误、vitest 119/119 零跳过全绿（10 文件，较上轮 +2 回归用例）、tsdown 构建三产物成功且产物内 prefix 座位 path 核验无尾斜杠（真机实例加载形态）；live 场景链由框架验证链重跑，run 内未重复执行全量回归（add-impl-selfcheck-model-probe 3.1 默认）

- [x] 先复核失败有效性：逐条核对 `spec/changes/add-session-advanced-search/verification-report.md` 中失败场景的期望断言（状态字面量/选择器/前置数据）与产品实际行为是否相符——断言与产品不符属场景缺陷，修场景文件；确属产品行为不符才修产品代码（复核完成：degraded-fallback 断言与 spec 一致、属真实产品缺陷——safeSeam 属性访问探测被 cordis get 陷阱拦截恒 undefined（已读实机 cordis 4.1.0 与官方 dsh-schedule 消费姿势坐实）；6 个 blocked-env web 场景系依赖传播按跨轮裁决原样写回；sas-web-entry-injection 场景缺陷已由 judge r9 原地修复，零新增场景缺陷）
- [x] 按复核结论修复：场景缺陷改场景文件，真实产品 Bug 改产品代码（产品修复：safeSeam 改走 ctx.get 免 inject 读取（缺失 undefined 不抛，官方消费姿势），契约钉入 JSDoc 与 dsh-runtime.d.ts；tests/host.test.ts 桩忠实镜像 get 陷阱 + BUG-01 回归用例，commit f57e523）
- [x] 修复后重跑验证确认通过（tsc --noEmit 零错误、vitest 120/120 零跳过全绿、tsdown 三产物构建成功且产物内 ctx.get(key) 在场/属性访问形态绝迹/cordis 保持 external、安装版 4.0.5 运行时探针确认 ctx.get 混入在场且缺失返回 undefined；live 场景链由框架验证链重跑）
