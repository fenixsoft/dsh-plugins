## Deliverables

```yaml
- path: fenix-dsh-dashboard-bridge/src/shared/config.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/themeFollow.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/src/client/panels.tsx
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/index.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/rightTab.tsx
  kind: modify
- path: fenix-dsh-dashboard-bridge/tests/themeFollow.test.ts
  kind: new
- path: fenix-dsh-dashboard-bridge/tests/srcContract.test.ts
  kind: modify
```

## 1. 契约与广播模块

- [ ] 1.1 shared/config.ts buildPanelSrc 扩展第三可选参数 theme（白名单 dark|light，拼 &theme=<档> 于 apiBase 后 hash 前；缺省/非法输出与现状逐字符一致），既有合同测试零改动通过
- [ ] 1.2 新增 src/client/themeFollow.ts：主题快照模块级缓存（供挂载点同步取初始档）、registerPanelWindow/unregisterPanelWindow 注册表、broadcastTheme（{kind:'fenix-theme', theme} 白名单映射，仅发在册窗口，postMessage try/catch 兜底）、installThemeFollow(ctx)（getTheme 缺席降级 + ctx.on("theme/change") 订阅返回 disposer）
- [ ] 1.3 新增 tests/themeFollow.test.ts：注册表挂载注销对称、广播形状与白名单、非法 colorScheme 不发、单窗口销毁不中断、ctx.theme 缺席降级零注入

## 2. 挂载点接线

- [ ] 2.1 DashboardPanel（panels.tsx）iframe ref 挂载 effect 登记 contentWindow、卸载注销，接 themeFollow 注册表
- [ ] 2.2 三挂载点注入初始档：client/index.ts 固定条目（深链五条目）与 projectEntrySink 项目面板、rightTab.tsx 右缘页签，从 themeFollow 快照取 colorScheme 传 buildPanelSrc 第三参；installThemeFollow(ctx) 接入插件启动与清理链路
- [ ] 2.3 tests/srcContract.test.ts 扩展：固定条目深链产出含 &theme= 段断言（快照深/浅/缺席三档），buildPanelSrc 新契约覆盖

## 3. 构建验证

- [ ] 3.1 桥接插件测试套件全量通过（含既有 rightTab/hostSession/proxy 回归）与插件构建成功
