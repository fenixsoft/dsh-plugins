# fenix-dsh-dashboard-bridge 插件安装与真机验收

`fenix-dsh-dashboard-bridge` 把 Fenix Dashboard（`127.0.0.1:8787`）集成进 dsh web：侧栏菜单 + 主面板 iframe + 同源反代（SSE 透传）。本文记录**人工安装步骤**与**真机验收清单**；这些动作发生在本仓库之外的运行环境（`/root/.dsh/profiles/web/`），不由实现 Agent 执行。

## 前置条件

- dsh 0.2.0-rc.2（唯一钉版；升级须按 README 兼容表同步重测）。
- 上游 Fenix Dashboard v3 可启动：fenixd 仓库 `python3 bin/fenix_dashboard.py --serve`（默认 `127.0.0.1:8787`）。
- `fenix-dsh-dashboard-bridge/` 已构建：`cd fenix-dsh-dashboard-bridge && pnpm install && pnpm build`，产出 `lib/index.js` 与 `lib/client.js`。
- **非 loopback 主机名访问时**：加 `dsh-plugin-loopback-trust`（安装命令、bundles 注册、engines 匹配与明文 HTTP 安全注记见 `docs/help/cc-import-install.md` 的「dsh-plugin-loopback-trust 前置」小节；live 实例完整重启与 token 获取步骤亦在同文件「live 实例刷新人工步骤」）。仅 `127.0.0.1` 访问可跳过。
- **前置依赖（面板内容完整性）**：fenixd 仓库 SPEC `add-dashboard-embed-mode`（dashboard 侧消费 `embed=1` / `apiBase=` 两参数）：
  - **已合并**：面板内页面完整可用（数据 API 走 `apiBase` 前缀，SSE 自动刷新正常）；
  - **未合并**：面板可打开、静态壳可加载，但页内 API 请求落在根路径与 dsh web 自身 `/api` 撞车而断（**属预期**，非本插件缺陷）；本插件其余验收项（侧栏条目、反代、502 降级）不受影响。

## 人工步骤（不由实现 Agent 执行）

1. **注册进 web profile 的 pnpm workspace**：在该 profile 目录下把本仓库的 `fenix-dsh-dashboard-bridge/` 链接为依赖（真机验证过的方式）：

   ```sh
   cd /root/.dsh/profiles/web/
   pnpm add link:<本仓库绝对路径>/fenix-dsh-dashboard-bridge
   ```

   （等效做法：把 `fenix-dsh-dashboard-bridge/` 目录复制/软链进 profile 的 pnpm workspace globs 覆盖的层级后 `pnpm install`。）
2. **加 loader 条目**：编辑该 profile 的 `cordis.patch.yml`。注意 dsh 的 patch 语义要求**容器键**：裸写 `- id:/name:` 列表项会被当作未知 target **静默跳过**（不报错、插件不装载）。必须写成 `- insert:` 列表（config 可整体省略，两键均有代码默认值）：

   ```yaml
   - insert:
       - id: fenix-dsh-dashboard-bridge
         name: fenix-dsh-dashboard-bridge
         # 可选覆盖：
         # config:
         #   upstream: http://127.0.0.1:8787
         #   prefix: /fenix-dashboard/
   ```

3. **重启**：`dsh web` 重启后打开 Web 界面（Host 半随主进程装载并注册 `/fenix-dashboard/` prefix 路由，Client 半 `lib/client.js` 由前端 ModuleLoader 注入）。

## 真机验收清单

前置：上游 dashboard 已启动（`curl -s http://127.0.0.1:8787/api/projects` 返回 JSON）。按顺序逐项确认（标注〔2026-10-14 实测〕的条目已在本机自动化验收通过；其余为人工口径）：

1. **侧栏 5 固定条目可见**：侧栏出现 概览/项目/设置/运维/帮助 5 个条目（线性图标 + 中文名），顺序位于 dsh web 既有条目之后。
2. **项目条目与上游一致**：侧栏项目条目（首字母徽标 + 项目名）与 `curl -s http://127.0.0.1:8787/api/projects | jq '.projects[].name'` 一致，且按名称排序。
3. **点击切换主面板且深链正确**：点击「项目」条目，主面板切换为 iframe，请求 src 为 `/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects`；点各固定条目 hash 分别为 `#/overview` / `#/projects` / `#/settings` / `#/activities` / `#/help`；点项目条目深链为 `#/projects/<name>`。
4. **会话面板可回**：点击 dsh web 侧栏会话条目，可回到对话面板（conversation 保留键不受影响）。
5. **SSE 自动刷新在面板内工作**：概览/项目页数字在后台数据变化后自动滚动更新，无需手动刷新浏览器页面（embed/apiBase 已生效的前提下）。
6. **连续切换无退化**：在多个面板间连续来回切换 ≥10 轮后，SSE 自动刷新仍正常（面板重挂语义 + 客户端断开终止上游请求，上游连接数不随切换次数累积；可用 `ss -tan | grep 8787` 观察上游连接数回落）。
7. **静态资源经前缀可达**：面板能加载 `GET /fenix-dashboard/umi.<hash>.js` 等 hashed 静态资源（200，内容与直连上游一致）。
8. **POST 触发经反代一致**：面板内触发类操作（如回归/审查触发）经 `/fenix-dashboard/api/...` POST 与直连上游行为一致。
9. **上游停机 502 提示页**：停掉 dashboard 进程后刷新面板，浏览器收到 502 与含「Fenix Dashboard 未启动」字样的提示页；dsh web 其余功能（会话、设置）不受影响；dsh 日志出现含 upstream 地址与错误原因的错误日志。〔2026-10-14 实测：502 提示页与 dsh 其余功能不受影响已自动化验证（`/fenix-dashboard/api/*` 与 iframe 文档均 502，设置页 11 行 provider 照常渲染）；dsh 以 stdout 极简输出运行时未捕获到额外错误行，日志断言以实际部署的日志配置为准〕
10. **移除项目条目 ≤60s 消失**：从 dashboard 移除一个项目后，不操作页面的情况下 ≤60s（或窗口重新聚焦时）该条目与其主面板消失，侧栏无闪烁、控制台无未处理异常。
11. **无会话 cookie 可访问（无鉴权口径）**：未持有 dsh 会话 cookie 的客户端（能网络到达 dsh web）请求 `/fenix-dashboard/api/projects` 返回上游数据（不返回 401；用户定调 2026-10-14，信任边界 = frp 暴露面）。
12. **前缀外不接手**：dsh web 自身路径（`/api`、`/`、`/plugins/...`）行为与未安装本插件时一致。

## 卸载

1. 从 `cordis.patch.yml` 移除 loader 条目；
2. （可选）从 profile workspace 移除包目录并重跑 `pnpm install`；
3. 重启 dsh web——prefix 路由随插件卸载经 disposer 注销，侧栏条目与面板消失，dsh web 其余功能不受影响。
