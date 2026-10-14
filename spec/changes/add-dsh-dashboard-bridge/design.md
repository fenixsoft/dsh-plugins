# Design — add-dsh-dashboard-bridge

## Context

dsh web（`dsh --profile web`，:3080，公网经 frp + trusted-host 可达）是用户日常入口；Fenix Dashboard v3（fenixd 仓库 `bin/fenix_dashboard.py --serve`，:8787，仅绑 loopback、无鉴权）是跨项目仪表盘。两者是独立进程、独立端口、独立前端栈（dsh web 为 cordis 插件化 SPA；dashboard 为 Python HTTP 服务 + Ant Design Pro/umi hash 路由前端，自动刷新走 EventSource SSE 打自身源）。

探查确认的 dsh 官方扩展面（dsh 0.2.0-rc.2，均从安装包 README 与构建产物源码核实）：

- **侧栏条目**：`sidebar.panellist` 是 ui-sidebar 声明的 root 作用域 **list** 插槽，第三方注册 `{ name, id, order, label, locale }` + 图标组件；行外观由 shell 渲染（图标 + label，选中态经 `usePanelInfo`）；`sidebar.workspaces` 是 ui-workspace 独占的 **single** 插槽，第三方不可入——「工作区同款区域」不可达，本设计以 panellist 条目列呈现（已向用户披露并认可）。
- **主面板**：layout 的 `main` 是 root 作用域 **keyed** 插槽（`conversation` 为会话保留键），以相同 id 注册组件；`ctx.layout.selectPanel(id)` 切换；shipped 组合零全局面板，官方 `dsh-client-ui-plugin-manager` 是「侧栏条目 + 主面板页」的参考实现（注册形态已从其 `lib/client.js` 提取核实）。
- **浏览器半装载**：package.json 声明 `dsh.client`（`platform: 'web'` + `inject` 依赖包清单），导出 `./client` bundle，宿主经 `/plugins` 懒加载；React 在基线模块表内。
- **宿主命名路由**：`dsh-host-webserver` 的 WebServer 服务暴露 `register(route)`（exact/prefix 两表，exact 优先、prefix 最长匹配），`registerFallback` 座位已被 SPA dist 服务占用（不可碰）；SSE 类流式响应不在其压缩包装范围。

上游 dashboard 侧关键事实：v3 SPA 以相对路径引用构建产物（生产 `publicPath: './'`），服务端把根路径回退映射到 `dist/`——因此**前缀剥离式反代天然可挂载**（`/fenix-dashboard/umi.js` → `8787/umi.js` 命中同一回退逻辑）；唯一断点是运行时 API 路径为根相对（`/api/...`，与 dsh web 自身 `/api` bridge 撞车，不可在 dsh 侧接管），由 fenixd 配套 SPEC（`add-dashboard-embed-mode`）以 `apiBase` 查询参数解决。

## Goals / Non-Goals

- Goals：dsh web 侧栏出现 dashboard 菜单（5 固定 + 每项目动态），点击在主面板内嵌显示对应页面；公网远程可用；SSE 自动刷新原样保留。
- Non-Goals：dashboard 自身鉴权；SPEC 级深链；iframe keep-alive；主题适配；dashboard 侧改动（另一仓库 SPEC）。

## Decisions

### D1. 同源反代（而不是 iframe 直连 8787）
用户定调公网远程必须可用。iframe 指向 `127.0.0.1:8787` 时远程浏览器的 `127.0.0.1` 指向访问者自身设备，直接不可用。反代路由挂在 dsh web 同源下，随 dsh web 的暴露面（frp + trusted-host）一致可达，且不为 dashboard 单开 frp 映射。备选「dashboard 单独公网映射」被否（多开一个无鉴权公网端口，暴露面最大）。

### D2. 反代无鉴权（跟随网络可达性）
用户定调 2026-10-14：不校验 dsh 浏览器会话 cookie。后果（已知情接受）：任何能网络到达 dsh web 的客户端可无凭据读取 dashboard 全部数据与触发 POST 端点；信任边界 = frp 暴露面。实现上零鉴权代码，风险在此留痕。若未来要收紧，改法是 Host 半读 `ctx.credentials` 的 `client-connection/browser-session` grant 自行验签 cookie（与 dsh 同源同钥），本 SPEC 不做。

### D3. iframe 嵌入（而不是原生重写面板）
dashboard v3 是 Ant Design Pro 全栈前端 + SSE 自动刷新；iframe 内跑真实应用，自动刷新/交互/构建链零重写。原生重写等价把全套页面用 dsh primitives 再造一遍并双份维护，否决。

### D4. `sidebar.panellist` 条目列（而不是工作区插槽 patch）
官方第三方面唯一入口。条目 = shell 渲染行（我方提供图标组件：固定项用线性图标组件，项目项用首字母圆形徽标组件）。不 patch ui-sidebar/ui-workspace（版本升级极脆，否决）。

### D5. prefix 剥离转发 + 流式直通
Host 半路由 handler：`<prefix>/X` → `upstream/X`，透传方法/查询串/请求体/响应状态/响应头/响应体。实现要点：
- 用 `node:http` `request` 上游并把上游 res 的数据流 pipe 到 webserver 响应（逐块 write，不聚合 buffer），SSE 天然透传；
- 不设请求超时（SSE 长连接）；上游 `error`（ECONNREFUSED 等）→ 502 提示页；
- 请求头白名单透传（`content-type`、`accept`、`if-none-match` 等逐项拷贝；剥离 `host` 改写为上游 authority，追加 `x-forwarded-proto/path` 便于排查）；
- 响应头原样拷贝（含 `cache-control`/`etag`/`content-type`），剥离 `content-length` 与 `transfer-encoding` 交由 node 按实际流重算，避免流式改道后长度不符。

### D6. 项目列表同步 = 60s 轮询 + window focus
不订阅 dashboard SSE 拿项目表（避免常驻第二长连接 + 解析负担）；60s 窗口对「侧栏多/少一个项目行」的时效足够。幂等策略：以 `name` 有序数组为指纹，指纹不变 → 零操作。

### D7. iframe src 两参数承载嵌入契约
`<prefix>/?embed=1&apiBase=<prefix>#<route>`：参数在 hash 前，`location.search` 可读；深链在 hash 内不受影响。两参数的消费方在 fenixd 仓库（`add-dashboard-embed-mode`）；bridge 侧只负责拼装，参数缺省时 dashboard 行为与现状一致（该 SPEC 的回归项）。

### D8. 插件包形态与版本策略
对齐 cc-import 先例：tsdown 双入口（`lib/index.js` host / `lib/client.js` client），`dsh.client: { platform: 'web', inject: [...] }`；client 半 inject 清单按 plugin-manager 先例取 `@deepseek-ai/dsh-client-ui-layout` 与 `@deepseek-ai/dsh-client-ui-sidebar`（无 RPC 需求，不引 api-remotes）。dsh 运行时唯一钉 0.2.0-rc.2（与 `dsh-bundle` 版本兼容表同规约），升级 dsh 须同步重测。配置 `upstream`/`prefix` 有代码默认值，loader 行可不带 config。

## Risks / Trade-offs

- **[slots 契约漂移]** dsh 升级可能改 `sidebar.panellist`/`main` 注册形状 → 钉版 + 真机验收清单守门；升级流程与 `dsh-bundle` 相同（重装 peer + 全量冒烟）。
- **[SSE 经代理被缓冲]** node 层或 webserver 压缩层引入缓冲会退化自动刷新 → 场景「SSE 事件实时到达」以时间差断言钉死（事件产出后 N 秒内必须可见），实现期禁用任何聚合写。
- **[无鉴权暴露]** dashboard 数据与触发端点随 dsh web 暴露面公开（用户定调接受）；触发类端点被匿名调用的后果与直连 8787 一致（dashboard 本就无鉴权）。
- **[面板切换 iframe 重挂]** 页内滚动/展开态丢失（深链页面身份保留）；量级可接受，keep-alive 列为非目标。
- **[动态条目与 dsh 侧栏交互]** 大量项目会让侧栏过长/收起轨图标堆积；当前注册项目个位数，不设折叠（YAGNI）。

## Migration Plan

全新插件，无存量数据迁移。部署 = docs/help 人工步骤（workspace 注册 + loader 行 + `pnpm install` + 重启 dsh web），真机验收清单随文档交付。

## Open Questions

（无——访问场景、鉴权口径、菜单粒度均已由用户定调；展现形态约束已披露认可。）
