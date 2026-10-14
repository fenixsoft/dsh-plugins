# fenix-dsh-dashboard-bridge

把 Fenix Dashboard（`127.0.0.1:8787`）集成进 dsh web：侧栏出现 dashboard 菜单（5 个固定条目 + 每项目动态条目），点击在主面板内嵌显示对应页面；内容经 dsh web 同源反代，公网远程（frp + trusted-host 暴露面）可用，dashboard 的 SSE 自动刷新特性原样保留。

## 插件形态

dsh 0.2.0-rc.2 双面插件（对齐 `cc-import` 先例）：

- **Host 半**（`src/host/`，`lib/index.js`，Node ESM）：cordis 插件类，向
  `@deepseek-ai/dsh-host-webserver` 的 WebServer 服务注册一条 `prefix` 路由
  （默认 `/fenix-dashboard/`），把前缀内请求剥离前缀后转发到上游 dashboard
  （默认 `http://127.0.0.1:8787`）：
  - 方法 / 查询串 / 请求体透传；请求头白名单拷贝（`host` 改写为上游 authority，
    追加 `x-forwarded-proto/path`）；
  - 响应状态 / 头原样回写（剥离 `content-length` / `transfer-encoding` 交由
    node 重算），响应体逐块 pipe 不聚合——SSE 事件块产出即达，无攒批延迟；
  - 不设请求超时（SSE 长连接）；客户端断开（响应流关闭）即终止对应上游请求
    （上游 dashboard 有常驻 SSE 连接数上限，防面板反复切换累积泄漏连接）；
  - 上游连接失败（拒绝/超时/DNS）返回 502 与可读 HTML 提示页（含「Fenix
    Dashboard 未启动」与启动指引），异常不外溢；错误日志（含 upstream 地址与
    原因）是远程侧定位问题的唯一抓手；
  - **无鉴权**（用户定调 2026-10-14）：不校验 dsh 浏览器会话 cookie，dashboard
    数据可达性完全等于 dsh web 网络可达性（信任边界 = frp 暴露面）。
- **Client 半**（`src/client/`，`lib/client.js`，浏览器 CJS）：
  - `sidebar.panellist` 列表插槽注册 5 个固定条目（线性图标 + 中文名）：
    `fenix-overview→#/overview`（概览）、`fenix-projects→#/projects`（项目）、
    `fenix-settings→#/settings`（设置）、`fenix-activities→#/activities`（运维）、
    `fenix-help→#/help`（帮助），order 10–14，位于 dsh web 既有条目之后；
  - layout `main` keyed 插槽以相同 id 注册 iframe 面板（铺满、无边框、按 layout
    契约预留顶部 clearance）；面板切换即卸载/重挂（无 keep-alive，深链页面身份保留）；
  - 启动拉取 `<prefix>/api/projects` 生成每项目动态条目（id `fenix-project-<name>`、
    label 项目名、首字母圆形徽标、order 100 起名称序、深链 `#/projects/<name>`）；
    60s 周期 + window focus 重拉，以 name 有序集合为指纹幂等 reconcile（新增注册、
    消失 dispose、无变化零操作）；拉取失败/空列表仅保留固定条目，无未处理异常。

## 配置键（loader 行 config，可省略）

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `upstream` | `http://127.0.0.1:8787` | 上游 dashboard Origin（http/https；尾斜杠自动去除） |
| `prefix` | `/fenix-dashboard/` | dsh web 侧 URL 路径前缀（自动归一为尾斜杠形态） |

loader 行示例：

```yaml
- id: fenix-dsh-dashboard-bridge
  name: fenix-dsh-dashboard-bridge
  # config 可整体省略（取上方默认值）；覆盖示例：
  # config:
  #   upstream: http://127.0.0.1:8787
  #   prefix: /fenix-dashboard/
```

## iframe src 契约

所有面板的 iframe src 恒为：

```
<prefix>/?embed=1&apiBase=<prefix>#<hash-route>
```

- `embed=1` 与 `apiBase=<prefix>` 两参数位于 hash 之前（`location.search` 可读），
  深链在 hash 内不受影响；
- URL 路径前缀保留尾斜杠（`<prefix>/?...`），`apiBase` 取同一 prefix **去尾斜杠**
  形态（默认前缀下为 `/fenix-dashboard`），上游以 `apiBase + '/api/...'` 直拼
  不产生双斜杠；
- 默认前缀下「项目」条目的 src 为
  `/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects`。

两参数的消费方在 fenixd 仓库（SPEC `add-dashboard-embed-mode`）；bridge 侧只负责
拼装，参数缺省时 dashboard 行为与现状一致。

## dsh 版本兼容表

| dsh 版本 | 兼容性 | 说明 |
| --- | --- | --- |
| 0.2.0-rc.2 | ✅ 唯一钉版 | 开发与验收基线（webserver 命名路由、client-modules 装载、`sidebar.panellist` 列表插槽、layout `main` keyed 插槽、`ctx.layout.selectPanel`） |
| 其它/升级 | ⚠️ 须同步重测 | 插槽契约可能漂移；升级流程与 `dsh-bundle` 同规约：重装 peer（`@deepseek-ai/cordis ~4.0.4`）+ 全量冒烟（README 安装文档的真机验收清单） |

## 构建与测试

```bash
cd fenix-dsh-dashboard-bridge
pnpm install        # 生成 pnpm-lock.yaml
pnpm build          # tsdown 双入口 → lib/index.js + lib/client.js
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest（36 用例：透传 / SSE 时间差 / 降级 / reconcile / src 契约）
```

环境要求：Node ≥ 24、pnpm ≥ 10。

测试不依赖真实 dsh 与真实 dashboard：`@deepseek-ai/cordis` 经 vitest 内联桩解耦
（构建期类型缝见 `src/types/dsh-runtime.d.ts`），mock 上游用 `node:http` 真实起服；
SSE 流式断言为真实计时器时间差断言（2s 间隔事件块，产出即达，禁聚合缓冲）。

## 安装

见 [docs/help/fenix-dashboard-bridge-install.md](../docs/help/fenix-dashboard-bridge-install.md)。
