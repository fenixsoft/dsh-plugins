## ADDED Requirements

### Requirement: 同源反代路由
插件 Host 半 SHALL 在 dsh web 进程内经 `@deepseek-ai/dsh-host-webserver` 的 WebServer 服务注册一条 `prefix` 路由（默认前缀 `/fenix-dashboard/`，可配置），把前缀内的请求剥离前缀后转发到上游 dashboard 服务（默认 `http://127.0.0.1:8787`），并把上游的状态码、响应头与响应体原样返回给浏览器。前缀外的请求 MUST NOT 被本路由接手（dsh web 既有路由与 SPA fallback 行为不变）。

#### Scenario: API 请求透传
- **WHEN** 浏览器请求 `GET /fenix-dashboard/api/projects`
- **THEN** 上游收到 `GET /api/projects`，浏览器收到与直连上游一致的状态码、`Content-Type` 与响应体

#### Scenario: 静态资源前缀剥离
- **WHEN** 浏览器请求 `GET /fenix-dashboard/umi.<hash>.js`
- **THEN** 上游收到 `GET /umi.<hash>.js` 并返回 200 与 JS 资源内容

#### Scenario: 前缀外不接手
- **WHEN** 浏览器请求 dsh web 自身路径（如 `/api`、`/`、`/plugins/...`）
- **THEN** 该请求由 dsh web 既有路由处理，与未安装本插件时行为一致

### Requirement: SSE 流式透传不缓冲
反代 SHALL 对 `Content-Type: text/event-stream` 的上游响应逐块透传：上游每产出一个事件块，浏览器端 MUST 能在该块产出后即时读到，MUST NOT 缓冲到连接结束才发送；连接保持打开直到任一端断开。反代 MUST NOT 对 SSE 响应施加压缩或内容改写。

#### Scenario: SSE 事件实时到达
- **WHEN** 上游 `/api/stream` 在 2s 间隔下持续产出事件，浏览器经 `EventSource('/fenix-dashboard/api/stream')` 订阅
- **THEN** 每个事件在其产出后即刻到达浏览器端（无攒批延迟），事件文本与上游一致

#### Scenario: 长连接不超时
- **WHEN** 一条 SSE 连接保持打开超过 5 分钟且持续有事件
- **THEN** 反代不主动断开、不重置该连接

### Requirement: HTTP 方法与请求体透传
反代 SHALL 透传 GET/POST/PUT/DELETE/HEAD 方法及请求体、查询串；POST 触发类端点（审查/修复/回归触发）经反代调用时 MUST 与直连上游行为一致。

#### Scenario: POST 触发透传
- **WHEN** 浏览器向 `/fenix-dashboard/api/code-review/run` 发起 POST（带查询串）
- **THEN** 上游收到同方法、同查询串的请求并正常受理，浏览器收到上游原始响应

### Requirement: 上游不可达降级
上游连接失败（拒绝/超时/DNS 失败）时，反代 SHALL 返回 502 与可读 HTML 提示页（说明 dashboard 未启动、给出启动指引），MUST NOT 使 dsh web 进程崩溃或令该前缀外路由受影响。

#### Scenario: 上游停机返回 502
- **WHEN** 上游 8787 端口无进程监听，浏览器请求 `GET /fenix-dashboard/`
- **THEN** 浏览器收到 502 与含「Fenix Dashboard 未启动」字样的提示页，dsh web 其余功能正常

### Requirement: 无鉴权跟随网络可达性
反代路由 SHALL NOT 实施任何应用层鉴权（不校验 dsh 浏览器会话 cookie）：dashboard 数据的可达性完全等于 dsh web 的网络可达性（用户定调 2026-10-14）。

#### Scenario: 无会话 cookie 可访问
- **WHEN** 一个未持有 dsh 会话 cookie 的客户端（能网络到达 dsh web）请求 `/fenix-dashboard/api/projects`
- **THEN** 请求被正常转发并返回上游数据（不返回 401）

### Requirement: 侧栏固定菜单条目
Client 半 SHALL 向 `sidebar.panellist` 列表插槽注册 5 个固定条目，id 与深链一一对应：`fenix-overview→#/overview`、`fenix-projects→#/projects`、`fenix-settings→#/settings`、`fenix-activities→#/activities`、`fenix-help→#/help`；label 为对应中文名（概览/项目/设置/运维/帮助），order 取 10–14；每个条目 SHALL 在 layout `main` keyed 插槽以相同 id 注册 iframe 面板。

#### Scenario: 固定条目可见
- **WHEN** 插件 client 半装载完成
- **THEN** dsh web 侧栏出现 5 个条目，图标 + 中文名，顺序位于 dsh web 既有条目之后

#### Scenario: 点击切换主面板
- **WHEN** 用户点击「概览」条目
- **THEN** 主面板切换为该条目对应的 iframe（src 契约见下），dsh web 会话面板经 conversation 保留键仍可回到对话

### Requirement: 每项目动态条目
Client 半 SHALL 启动时经 `<prefix>/api/projects` 拉取项目列表，为每个项目注册一条动态侧栏条目（id 形如 `fenix-project-<name>`，label 为项目名，图标为项目名首字母徽标组件）与对应 `main` 面板，深链 `#/projects/<name>`；动态条目 order 从 100 起按项目名称排序。

#### Scenario: 项目条目生成
- **WHEN** 上游项目列表含 fenixd、dsh-plugins 两个项目
- **THEN** 侧栏出现两条项目条目，label 为项目名，点击后主面板直达该项目详情深链

#### Scenario: 空列表不出错
- **WHEN** 上游返回空项目列表或拉取失败
- **THEN** 仅固定 5 条目存在，侧栏与控制台无未处理异常

### Requirement: 项目列表轮询同步
Client 半 SHALL 以 60s 周期与 window focus 两个时机重拉项目列表，并把差异同步到插槽：新增项目注册条目与面板，消失项目 dispose 其条目与面板；同步 MUST 幂等（列表无变化时不产生重复注册或抖动）。

#### Scenario: 新增项目出现
- **WHEN** 上游新增项目 X，下一轮拉取（≤60s 后或窗口聚焦触发）发现差异
- **THEN** 侧栏出现 X 的条目，点击可用

#### Scenario: 移除项目清理
- **WHEN** 项目 Y 从上游列表消失，下一轮拉取发现差异
- **THEN** Y 的条目与 `main` 面板注册被 dispose；若主面板当前停留在 Y 的面板上，界面不崩溃（可停留在空白/由用户点选其它条目）

#### Scenario: 幂等无抖动
- **WHEN** 相邻两次拉取结果一致
- **THEN** 不发生条目重注册（侧栏无闪烁），插槽内无重复 id

### Requirement: iframe src 契约
所有面板的 iframe src SHALL 恒为 `<prefix>/?embed=1&apiBase=<prefix>#<hash-route>` 形态：`embed=1` 与 `apiBase=<prefix>` 两个查询参数位于 hash 之前，hash 路由段与条目深链一致。prefix 取宿主半生效的 prefix 配置。

#### Scenario: src 形态
- **WHEN** 用户点击「项目」条目（默认前缀下）
- **THEN** 主面板 iframe src 为 `/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects`

### Requirement: 面板切换重挂语义
主面板 keyed 插槽切换时被切离的 iframe SHALL 随插槽卸载、切回时重挂（dsh keyed 插槽语义）；重挂后 iframe 重新加载深链指向的页面。本插件 SHALL NOT 实现 keep-alive。

#### Scenario: 切回重载
- **WHEN** 用户从「概览」切到「设置」再切回「概览」
- **THEN** 概览 iframe 重新加载 `#/overview` 深链并恢复 SSE 自动刷新，无需手动刷新浏览器页面
