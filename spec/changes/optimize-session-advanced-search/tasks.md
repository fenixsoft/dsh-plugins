# Tasks: optimize-session-advanced-search

## Deliverables

```yaml
- path: fenix-dsh-session-advanced-search/src/shared/protocol.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/shared/config.schema.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/host/analyzer.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/host/jobs.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/host/host.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/host/routes.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/client/index.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/client/searchButton.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/src/client/searchDialog.tsx
  kind: delete
- path: fenix-dsh-session-advanced-search/src/client/searchView.tsx
  kind: new
- path: fenix-dsh-session-advanced-search/tests/analyzer.test.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/tests/jobs.test.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/tests/protocol.test.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/tests/clientApp.test.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/tests/searchButton.test.ts
  kind: modify
- path: fenix-dsh-session-advanced-search/tests/dialog.test.ts
  kind: delete
- path: fenix-dsh-session-advanced-search/tests/view.test.ts
  kind: new
- path: fenix-dsh-session-advanced-search/README.zh.md
  kind: modify
- path: specs/optimize-session-advanced-search/prototype/index.html
  kind: new
- path: specs/optimize-session-advanced-search/prototype/annotator.js
  kind: new
- path: specs/optimize-session-advanced-search/prototype/05-round2-initial.png
  kind: new
- path: specs/optimize-session-advanced-search/prototype/06-round2-analyzing.png
  kind: new
- path: specs/optimize-session-advanced-search/prototype/07-round2-results.png
  kind: new
- path: specs/optimize-session-advanced-search/prototype/08-round2-degraded.png
  kind: new
```

## 1. shared 契约与配置

- [ ] 1.1 `src/shared/protocol.ts`：`SearchJobStatus` 新增可选字段 `degradedReason?: 'llm-missing' | 'credential-missing' | 'timeout' | 'call-failed' | 'parse-failed'` 与 `progress?: readonly SearchProgressStep[]`（新类型 `{ step: string; detail?: string; at: number }`，host 侧写入时有界保留最近 50 条）；`parseJobStatus` 守卫放行并校验两字段形状（degradedReason 白名单枚举、progress 数组元素按形状校验）；`UI_TEXT` 新增降级原因→中文文案映射（credential-missing 文案含「前往模型设置配置凭证」「仅重试 AI 分析」动作文案）与 phaseText 新文案；同步 `tests/protocol.test.ts` 用例
- [ ] 1.2 `src/shared/config.schema.ts`：插件配置新增可选 `analyzeRoute: { provider: string; model: string }`（zod schema，非空串校验），同步配置默认值与注释（用途：把语义分析路由指到有凭证的 provider，优先级高于 profile 默认路由）

## 2. host 半：超时硬解耦、凭证预检、进度记录

- [ ] 2.1 `src/host/analyzer.ts`：`rankCandidates` 改为 `Promise.race` 硬解耦——流消费 promise（挂 `.catch` 吸收败者错误防 unhandled rejection）与超时 marker 竞速，deadline 到点立即 `mechanicalFallback('timeout')`，不依赖底层流闭合；外部取消（signal.aborted）优先于超时（不降级不产出）；finally 清理定时器与监听
- [ ] 2.2 `src/host/analyzer.ts`：`AnalyzerDeps` 新增可选缝 `credentialProbe?: (provider: string) => boolean` 与 `routeOverride?: { provider: string; model: string }`；`resolveRoute` 优先级 routeOverride > agentDefaultModel；发起调用前 credentialProbe 在位且返回 false → `mechanicalFallback('credential-missing')` 不发起调用；`AnalysisOutcome['degradedReason']` 扩充 `'credential-missing'`
- [ ] 2.3 `src/host/jobs.ts`：`SearchJob` 新增 `progress` 步骤记录（有界 50 条）与 `degradedReason` 字段；在 collecting 开始（detail=关键词）、filtering 完成（detail=候选 N→M）、analyzing 开始（detail=provider·model·候选数）、完成（detail=置信度摘要或降级原因）四个推进点追加；GET 载荷输出 `degradedReason` 与 `progress`（向后兼容可选字段）；`complete()` 签名接收 reason
- [ ] 2.4 `src/host/host.ts`：装配 `credentialProbe`——从 ctx.llm 侧 provider 配置读取路由 provider 的 credential-ref（apiKeyEnv）并校验 `process.env` 非空，读不到配置时返回 true 不误杀（形状漂移 warn 一次并跳过预检）；装配 `routeOverride`（透传插件配置 analyzeRoute）；同步 `src/host/routes.ts` 注释与守卫透传
- [ ] 2.5 host 测试：`tests/analyzer.test.ts` 新增超时硬上限用例（stub llm.stream 返回忽略 signal 永不 resolve 的流、timeoutMs 调小，断言按时返回且 degradedReason=timeout、无 unhandled rejection）、凭证缺失快速失败用例、路由覆盖用例；`tests/jobs.test.ts` 新增 progress 推进与 GET 载荷新字段用例

## 3. client 半：内容区视图、步骤流、官方图标

- [ ] 3.1 新建 `src/client/searchView.tsx`（替代 searchDialog.tsx 并删除之）：`SearchView` 组件 props 形状兼容 `{ open, onClose, onOpenSession, fetchImpl?, pollIntervalMs? }`；内容区挂载形态（非模态、无遮罩、侧栏可交互；锚点失配降级右侧抽屉 + warn 限流一次）；header（标题+官方 IconCloseOutline 几何 X）；底部 composer 输入卡（居中 max 952px、radius 28px、官方令牌优先、圆形发送按钮、可选日期范围）；结果卡片（标题/ws/时间/理由/置信度条：AI 蓝渐变、机械灰）；降级横幅按 degradedReason 映射文案与动作（credential-missing → 「前往模型设置配置凭证」「仅重试 AI 分析」）；Esc/X 关闭、关闭还原会话视图、状态重置与在途 DELETE 语义保留；界面以 `specs/optimize-session-advanced-search/prototype/` 为准
- [ ] 3.2 `searchView.tsx` 步骤流：按轮询载荷 `progress[]` 渲染 agent 对话风格步骤流（完成/进行中/等待三态），本地起表计逐秒刷新；在途时提供中断按钮（DELETE 在途任务、停止轮询、回初始态）；不伪造流式中间进度
- [ ] 3.3 `src/client/index.ts`：装配从 SearchDialog 换为 SearchView——点击入口在内容区打开视图（复用 React root；打开时不遮挡侧栏），关闭/jump 跳转后还原；`src/client/searchButton.ts`：`ICON_SVG` 替换为官方 `IconSearchOutlineMedium` 几何（viewBox 0 0 16 16、stroke currentColor 1.3、无星标），按钮座 28×28 color inherit 去降透明
- [ ] 3.4 client 测试：新建 `tests/view.test.ts`（替代 dialog.test.ts：打开为内容区视图无遮罩、空描述不可提交、关闭重开状态重置、步骤流渲染与本地计时、降级横幅按原因映射与动作按钮、中断回初始态、候选点击跳转并关闭）；更新 `tests/clientApp.test.ts`（装配换 SearchView）、`tests/searchButton.test.ts`（官方图标几何断言：16 viewBox、stroke 1.3、无星标路径、无 opacity 降透明）

## 4. 构建与文档收尾

- [ ] 4.1 `pnpm install && pnpm build && pnpm typecheck && pnpm test` 全绿（插件目录内；lib/ 为 gitignored 构建产物，不声明交付）；确认 client bundle 首行为 `window.__ModuleLoader__.load` 形态
- [ ] 4.2 `README.zh.md`：更新「安装（人工步骤）」补重启 dsh-web 说明、新增 `analyzeRoute` 配置说明（含降级横幅原因映射表）、已知限制更新（图标几何与内容区锚点缝）、界面原型引用 `specs/optimize-session-advanced-search/prototype/`
