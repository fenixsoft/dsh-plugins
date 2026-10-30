## Why

用户的日常 Web 入口是 dsh web（公网经 frp 可达），而 Fenix Dashboard（`127.0.0.1:8787`）是另一个独立标签页且仅本机可达——两套界面来回切换、远程看不到仪表盘。把 dashboard 的菜单集成进 dsh web 侧栏、内容嵌入 dsh web 主面板，统一入口并让公网远程可用；dashboard 的 SSE 自动刷新特性必须原样保留。

## What Changes

- 新增 dsh 插件包 `fenix-dsh-dashboard-bridge`（双半结构，对齐本仓库 `cc-import` 先例）：
  - **Host 半**：cordis 插件，启动时向 `@deepseek-ai/dsh-host-webserver` 的 WebServer 服务注册 `prefix` 路由 `/fenix-dashboard/`：剥离前缀转发到上游 dashboard（默认 `http://127.0.0.1:8787`），流式透传（含 SSE 事件流不缓冲）、HTTP 方法透传、响应头/状态码透传；上游不可达时返回 502 + 可读提示页（不崩 dsh web）。配置键 `upstream` / `prefix`（有代码默认值，可不配置）。**无鉴权**（用户定调 2026-10-14：跟随 dsh web 网络可达性，不强制 dsh 会话 cookie 校验）。
  - **Client 半**：`dsh.client`（platform web）浏览器插件——向 `sidebar.panellist` 注册 5 个固定菜单条目（概览/项目/设置/运维/帮助）并在 layout `main` keyed 插槽挂对应 iframe 面板（hash 深链直达）；启动时拉取 `<prefix>/api/projects` 生成每项目动态条目（label=项目名），点击直达 `#/projects/<name>`；60s 周期 + window focus 时重拉项目表，同步条目/面板的注册与 dispose。
  - **iframe src 契约**：`<prefix>/?embed=1&apiBase=<prefix>#<hash-route>`（`embed`/`apiBase` 两参数由 fenixd 仓库配套 SPEC 消费，见 Impact）。
- 排序：固定 5 项 `order` 10–14，项目条目 `order` 100 起按名称排序，全部位于 dsh web 既有条目之后。
- 非目标：dashboard 侧改动（另 SPEC，fenixd 仓库）；dashboard 自身鉴权；项目内 SPEC 级深链；iframe keep-alive（面板切换重挂、页面身份由深链保留）；dsh web 主题适配（iframe 内保持 dashboard 自身浅色主题）。

## Capabilities

### New Capabilities

- `fenix-dash-bridge`: dsh web 侧栏 Fenix Dashboard 菜单集成与同源反代——`/fenix-dashboard/` 前缀路由的流式反代契约（SSE 不缓冲、方法透传、上游故障 502）、侧栏固定/动态条目注册、主面板 iframe 深链、项目列表轮询同步

### Modified Capabilities

（无——本工程现有唯一能力 `cc-import` 不受影响。）

## Impact

- 本仓库新增 `fenix-dsh-dashboard-bridge/` 插件包源码与测试、`docs/help/fenix-dashboard-bridge-install.md` 安装与真机验收文档；不修改 dsh 本体、cc-import、fenixd 框架代码。
- 运行时依赖：dsh 0.2.0-rc.2 官方扩展面（webserver 命名路由、client-modules 插件装载、`sidebar.panellist` 列表插槽、layout `main` keyed 插槽、`ctx.layout.selectPanel`）；上游 dashboard 服务（fenixd 仓库）需配套支持 `embed=1` / `apiBase=` 两参数（fenixd SPEC `add-dashboard-embed-mode`）——真机端到端验收以其落地为前置；桥接件本身（反代 + 面板挂载）可独立开发与单测。
- 风界面：dsh web 侧栏新增一组菜单条目与主面板 iframe；dashboard 数据经 dsh web 暴露面无鉴权可达（用户已定调接受；frp 信任边界即暴露边界）。
- 部署：插件安装进 `/root/.dsh/profiles/web/`（人工步骤见 docs/help），dsh web 重启后生效。
