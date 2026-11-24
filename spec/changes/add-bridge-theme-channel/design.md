## Context

`fenix-dsh-dashboard-bridge` 以 iframe 嵌入 fenix dashboard（同源前缀反代 + hash 深链）：`buildPanelSrc`（`src/shared/config.ts:86`）产出 `<prefix>/?embed=1&apiBase=<prefix>#<route>`，三挂载点消费——固定条目（`src/client/index.ts:780`）、项目 main 面板（`projectEntrySink`，`src/client/index.ts:522`）、右缘页签（`src/client/rightTab.tsx:129`）；`DashboardPanel`（`src/client/panels.tsx:233`）是薄 iframe 壳。既有跨帧通信仅 iframe→host 方向（`{kind, project, prompt?}` 新会话请求，`src/client/index.ts:443` 消费先例）。

宿主主题真相源：dsh web 主题插件（`@deepseek-ai/dsh-client-ui-theme@0.2.2-rc.1`）向 client 插件暴露 `ctx.theme.getTheme()` 快照（`active.colorScheme: 'light'|'dark'`，`system` 偏好已解析）与 `ctx.on("theme/change")` 事件；消费先例 `dsh-client-ui-sidebar-terminal/lib/client.js:652-653`。iframe 侧契约（初始 `theme=dark|light` 参数 + `{kind:'fenix-theme', theme:'dark'|'light'}` 消息）由 fenixd 仓 `add-dashboard-dark-theme` SPEC 钉死，本设计是其宿主侧对位实现。

## Goals / Non-Goals

**Goals:**

- 嵌入 iframe 初始主题与宿主当前档一致（首帧即对，无闪变）。
- 宿主切换主题时全部已挂载 dashboard iframe 实时跟随。
- 宿主主题 API 缺席时零影响降级（输出与现状逐字符一致）。

**Non-Goals:**

- 不实现 iframe→host 的主题回传或确认握手（单向广播即可，iframe 侧自行校验）。
- 不在宿主侧持久化任何主题状态（宿主主题由 dsh web 自己管理）。
- 不做真机安装/重启（插件随既有 merge-back 部署链路生效，非本仓任务）。
- 不改反代层（`src/host/proxy.ts`）与既有 iframe→host 消息通道。

## Decisions

### D1 契约形状单向对齐 fenixd SPEC

初始注入：`buildPanelSrc(prefix, hashRoute, theme?)` 第三可选参数，值域 `dark|light` 白名单，拼为 `&theme=<档>` 位于 apiBase 之后、hash 之前；参数缺省/非法/未提供时输出与现状逐字符一致（既有合同测试不变，新增覆盖）。实时通道：`{kind:'fenix-theme', theme:'dark'|'light'}`，与既有 iframe→host `{kind,...}` 风格对称。理由：双仓显式契约（用户已裁决），两侧 SPEC 互为镜像可测试；否决宿主 DOM 直读方案（iframe 侧已否决的对称备选）。

### D2 注册表生命周期挂 DashboardPanel

`themeFollow.ts` 导出 `registerPanelWindow(win)/unregisterPanelWindow(win)` 与 `broadcastTheme(theme)`；`DashboardPanel` 经 iframe `ref` 在挂载 effect 登记 `contentWindow`、卸载注销。理由：三挂载点共享同一面板组件，单点收口避免各挂载点自管；ref 随组件生命周期天然防泄漏、防发往已销毁窗口（postMessage 前仍以注册表成员资格为闸）。否决：广播时临时查询 DOM iframe 集合——脆、漏右缘页签挂载时机。

### D3 订阅点与快照时机

`installThemeFollow(ctx)` 在插件 client 启动时调用一次：先读 `ctx.theme.getTheme()` 供挂载点取初始档（经模块级缓存供 `buildPanelSrc` 调用方同步取值）；再 `ctx.on("theme/change", snapshot => { 缓存刷新为 snapshot.active.colorScheme；broadcastTheme(snapshot.active.colorScheme) })`，返回 disposer 随插件清理。**事件处理先刷新模块级缓存再广播**：右缘页签首次打开、项目面板新注册等「晚于宿主切换」的挂载从缓存取初始注入档，只广播不刷新缓存则这些面板首帧错档且无后续广播可补（评审 2026-11-24 补）。`installThemeFollow(ctx)` 接入点须先于项目同步注册——`projectEntrySink` 的 src 在 `registerProjectPanel` 时即拼串（非渲染惰性求值，`src/client/index.ts:522`）。`colorScheme` 经白名单映射（`dark|light`，其它值不发；theme 包类型声明本就收窄 `'light'|'dark'`，白名单作运行时漂移防御）。理由：事件快照即权威值，无需二次读取；模块级缓存让三挂载点零签名变更。

### D4 宿主 API 缺席降级

`ctx.theme` 不存在（旧版 dsh web）或 `getTheme` 不可调时：初始档缓存为 `undefined`（`buildPanelSrc` 第三参不传，输出与现状逐字符一致）、不订阅事件、广播空转。理由：插件须向后兼容宿主版本差异，降级面收敛在 themeFollow 单模块内。

## Risks / Trade-offs

- [宿主快照与 iframe 首帧竞态：参数注入后宿主立即切主题] → `theme/change` 事件紧随广播补齐，iframe 侧 postMessage 校验兜底，最终一致。
- [宿主切主题后新挂载面板读到安装时旧缓存] → 事件处理先刷新模块级缓存再广播，晚挂载初始注入即最新档（评审 2026-11-24 补）。
- [广播给已销毁 iframe 窗口抛错] → 注册表成员资格为唯一发送闸，注销先于销毁（组件卸载序）；try/catch 包裹 postMessage 兜底。
- [与既有 iframe→host 消息通道混淆] → 方向相反（host→iframe）、kind 独立命名空间（`fenix-theme`），互不干扰。
- [三挂载点漏改] → `buildPanelSrc` 调用点 grep 对账（三处全部注入），合同测试断言固定条目产出含 theme 段。

## Migration Plan

纯插件代码 + 测试；`pnpm build` 产物随既有插件装载链路生效。回滚=还原本 SPEC 文件（无配置迁移、无持久化状态）。宿主旧版本自动走 D4 降级路径，无前置条件。

## Open Questions

无。
