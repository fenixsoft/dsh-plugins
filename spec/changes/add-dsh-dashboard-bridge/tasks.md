## Deliverables

<!-- 声明口径：包骨架标准文件族（package.json / tsconfig.json / tsdown.config.ts /
     vitest.config.ts / pnpm-workspace.yaml / pnpm-lock.yaml / README.zh.md）与
     cc-import 同名 basename 在主树唯一命中，晋升 lint 规则 4（疑似笔误）确定性
     拒绝且无 kind 可满足（new 撞名 / reference·modify 主树不存在即拒），故不入
     声明段——其落地由任务 1.1 / 6.1 / 6.2 与真机验收清单把守，其余源码/测试/
     文档交付物全部显式声明受守卫对账。 -->

```yaml
- path: fenix-dsh-dashboard-bridge/src/shared/config.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/src/host/index.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/src/host/proxy.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/src/client/index.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/src/client/panels.tsx
  kind: new
- path: fenix-dsh-dashboard-bridge/src/client/projectSync.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/tests/proxy.test.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/tests/projectSync.test.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/tests/srcContract.test.ts
  kind: new
- path: docs/help/fenix-dashboard-bridge-install.md
  kind: new
```

## 1. 包骨架与构建链

- [ ] 1.1 创建 `fenix-dsh-dashboard-bridge/` 包骨架：`package.json`（name `fenix-dsh-dashboard-bridge`，`dsh.client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'] }`，exports `.`/`./client`/`./package.json`，peerDependencies 对齐 cc-import 形态）+ `tsconfig.json` + `tsdown.config.ts`（双入口 `src/host/index.ts`→`lib/index.js`、`src/client/index.ts`→`lib/client.js`）+ `vitest.config.ts`（dsh 包以 alias 桩解耦，先例 cc-import）+ `pnpm-workspace.yaml`，`pnpm install` 产出 `pnpm-lock.yaml`
- [ ] 1.2 建立 `src/shared/config.ts`：`upstream`（默认 `http://127.0.0.1:8787`）与 `prefix`（默认 `/fenix-dashboard/`）常量与类型、loader 行 config 覆盖入口、`buildPanelSrc(prefix, hashRoute)` 拼装函数（产出 `<prefix>/?embed=1&apiBase=<prefix>#<route>`；前缀斜杠归一方向钉死：URL 路径前缀保留尾斜杠、`apiBase` 取去尾斜杠形态，与 specs 契约 Scenario 示例一致，上游直拼 `apiBase + '/api/...'` 不产生双斜杠）

## 2. Host 半反代路由

- [ ] 2.1 `src/host/index.ts`：默认导出 cordis 插件类（对齐 cc-import 先例），apply 时解析配置并向 WebServer 服务注册 prefix 路由（`@deepseek-ai/dsh-host-webserver` 契约），插件卸载时经 register 返回的 disposer 注销
- [ ] 2.2 `src/host/proxy.ts`：前缀剥离转发 handler——方法/查询串/请求体透传、请求头白名单拷贝（`host` 改写为上游 authority，追加 `x-forwarded-proto/path`）、响应状态/头原样回写（剥离 `content-length`/`transfer-encoding`）、上游数据流逐块 pipe 不聚合、无请求超时；客户端断开（响应流关闭）时终止对应上游请求——面板重挂反复开关 SSE，MUST NOT 在上游侧累积泄漏连接（上游有常驻连接数上限）
- [ ] 2.3 上游连接失败（ECONNREFUSED/超时/DNS）返回 502 与可读 HTML 提示页（含「Fenix Dashboard 未启动」字样与启动指引），异常不外溢、不影响前缀外路由，并输出含 upstream 地址与错误原因的错误日志（远程侧只见 502 页，本机日志是定位 upstream 未启动/配置错误的唯一抓手）

## 3. Host 半单测（vitest + node:http mock 上游，tests/proxy.test.ts）

- [ ] 3.1 透传断言（tests/proxy.test.ts）：GET API 请求（状态码/Content-Type/响应体一致）、hashed 静态资源 200、POST 方法与查询串透传、前缀剥离正确性
- [ ] 3.2 SSE 流式断言（tests/proxy.test.ts）：mock 上游按 2s 间隔产出 `text/event-stream` 事件块，客户端侧逐块即时到达（时间差断言，禁聚合缓冲），连接长开不超时
- [ ] 3.3 降级断言（tests/proxy.test.ts）：上游停机时 502 + 提示页文本；dsh 侧桩（路由注册/注销）行为正确、disposer 幂等

## 4. Client 半（侧栏条目 + 主面板）

- [ ] 4.1 `src/client/index.ts`：对照 `dsh-client-ui-plugin-manager` 注册形态——`sidebar.panellist` 注册 5 固定条目（id/label/order 10–14）与每项目动态条目（id `fenix-project-<name>`、label 项目名、order 100 起名称序），`main` keyed 插槽以相同 id 注册 iframe 面板组件
- [ ] 4.2 `src/client/panels.tsx`：iframe 面板组件（src 经 `buildPanelSrc`，铺满面板、无边框、按 layout 契约预留顶部 clearance）；固定项线性图标组件与项目首字母圆形徽标组件
- [ ] 4.3 `src/client/projectSync.ts`：启动拉取 `<prefix>/api/projects` 生成项目条目；60s 周期 + window focus 重拉；以 name 有序数组为指纹做幂等 reconcile——新增注册、消失 dispose、无变化零操作；拉取失败/空列表仅保留固定条目且无未处理异常

## 5. Client 半单测（dsh 桩）

- [ ] 5.1 src 契约断言（tests/srcContract.test.ts）：各条目深链 → iframe src 形态逐字符断言（默认前缀与非默认前缀各一组）
- [ ] 5.2 reconcile 断言（tests/projectSync.test.ts）：新增/移除/无变化三态的注册与 dispose 调用序列、幂等（连续同列表零重注册）、失败兜底（fetch reject / 空数组）
- [ ] 5.3 条目注册断言（tests/projectSync.test.ts + tests/srcContract.test.ts）：桩 slots 上 5 固定条目 id/label/order 与项目条目排序正确、`main` keyed 注册 id 一一对应

## 6. 构建、文档与真机验收清单

- [ ] 6.1 `pnpm build` 产出 `lib/index.js` 与 `lib/client.js`，`tsc --noEmit` 与 `vitest run` 全绿
- [ ] 6.2 `README.zh.md`：组件说明、配置键（upstream/prefix）、iframe src 契约、dsh 版本兼容表（唯一钉 0.2.0-rc.2，升级须同步重测）
- [ ] 6.3 `docs/help/fenix-dashboard-bridge-install.md`：人工安装步骤（workspace 注册 + loader 行示例 + `pnpm install` + 重启 dsh web）与真机验收清单——侧栏 5 固定条目可见、项目条目与 `/fenix-dashboard/api/projects` 一致、点击切换主面板且深链正确、SSE 自动刷新在面板内工作（数字滚动无需手动刷新）、连续切换面板多轮后 SSE 自动刷新仍正常（上游连接无泄漏退化）、上游停机 502 提示页、移除项目后条目 ≤60s 消失；标注前置依赖：fenixd 仓库 `add-dashboard-embed-mode` 已合并（embed/apiBase 两参数生效）时面板内容完整可用，未合并时面板可打开但 API 断（属预期）
