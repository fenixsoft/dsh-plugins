## Deliverables

```yaml
- path: fenix-dsh-dashboard-bridge/src/client/panels.tsx
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/index.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/projectSync.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/types/dsh-runtime.d.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/tests/projectSync.test.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/lib/client.js
  kind: reference
```

## 1. Portal 内嵌「项目」分区

- [ ] 1.1 实现语义锚点探测与宿主管理：从「项目」条目组件 `closest('nav')` 取条目列表元素，`insertAdjacentElement('afterend')` 创建宿主 div，React Portal 渲染分区；锚点不可达/宿主被移除时按 MutationObserver + 轮询兜底重试，连续不可达置 `degraded` 回落浮层分组（现实现保留为降级路径）；禁止依赖 CSS module 哈希类名
- [ ] 1.2 分区组件：标题行（项目 + 计数，点击仅折叠/展开）+ 首字母徽标项目行（点击经 `layout.selectPanel` 切主面板、行高亮）+ `max-height: min(7 行, 46vh)` 内部滚动 + `ResizeObserver` 宽窄态适配（窄态徽标栈/计数）；样式沿用 `--dsw-*` alias；数据源复用 `projectGroupStore`（轮询同步/幂等/移除清理语义不变）
- [ ] 1.3 `tests/projectSync.test.ts` 与新增纯渲染/锚点判定单测随改写，`pnpm test` / `pnpm typecheck` 全绿

## 2. 隔离 profile 真机验收

- [ ] 2.1 常驻分区呈现在条目列表与工作区之间（非下拉浮层），项目行不出现在「帮助」之后；点击项目行主面板切至该项目 iframe 且行高亮；分区限高滚动生效、侧栏高度不被撑破
- [ ] 2.2 窄态折叠适配（徽标栈/计数，无横向溢出）；空列表/上游停机呈空态且无控制台未处理异常
- [ ] 2.3 锚点漂移演练：运行期删除宿主 DOM → 自动降级浮层分组、无未处理异常；恢复锚点/重挂宿主 → 分区重现；插件卸载清理宿主与 portal 无残留
