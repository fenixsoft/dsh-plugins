# dsh 插件真机验收：隔离 profile 从零演练

本文是 cc-import 与 fenix-dsh-dashboard-bridge 两个 client 插件的**可重复真机验收流程**：在隔离 profile 中从零安装、启动、按两份安装文档的验收清单核对，再完全拆除。全程不触碰生产实例（`127.0.0.1:3080`）与其数据。2026-10-14 首次按本流程完成全量验收（见各验收清单中的实测标注）。

## 隔离原则

- **独立 `DSH_HOME`**：如 `/root/.fenix-verify/dsh-web-home-live-drill/`，端口用生产未占用的（本文以 3444 为例），与生产 3080 完全隔离。
- **独立凭据与存储**：导入/设置写入都落在该 profile 的 `DSH_HOME` 下（`storages/`、`.credentials.yaml`、`profiles/web/cordis.patch.yml`），不触碰 `~/.dsh`。
- **共享上游要记录还原点**：bridge 验收共享 Fenix Dashboard 上游（`127.0.0.1:8787`）。任何上游数据变更必须走「夹具项目」模式：先 `--list-projects` 存底，新增一次性 fixture 项目，验收后移除并 diff 确认还原（见下文「上游数据变更纪律」）。
- **临时系统级改动须登记并回滚**：如 `/etc/hosts` 测试条目，验收后立即删除并 `diff` 备份确认。

## 前置条件

- dsh ≥ 0.2.0-rc.2；Node ≥ 24。
- 两个插件已构建：`pnpm --dir cc-import build`、`pnpm --dir fenix-dsh-dashboard-bridge build`（产出各自 `lib/index.js` + `lib/client.js`）。
- `~/.cc-switch/cc-switch.db` 存在（cc-import 验收需要）；Fenix Dashboard 上游已启动（bridge 验收需要）。

## 从零安装（隔离 profile）

1. **建 profile**：

   ```sh
   export DRILL_HOME=/root/.fenix-verify/dsh-web-home-live-drill
   mkdir -p $DRILL_HOME/profiles/web
   ```

2. **初始化 profile 的 workspace 并链接插件**（`dsh --profile web` 首次启动会在 `DSH_HOME/profiles/web/` 生成骨架；也可从生产 profile 复制 `package.json` 骨架后改）。在 `$DRILL_HOME/profiles/web/` 下：

   ```sh
   pnpm add link:<本仓库绝对路径>/cc-import \
            link:<本仓库绝对路径>/fenix-dsh-dashboard-bridge \
            github:6mt/dsh-plugin-loopback-trust
   ```

   `dsh-plugin-loopback-trust` 用于非 loopback 主机名访问时放行设置写入面（真机口径见下文第 4 步）。

3. **加 loader 条目**：编辑 `$DRILL_HOME/profiles/web/cordis.patch.yml`。**必须用 `- insert:` 容器键**——裸 `- id:/name:` 列表项会被 dsh patch 语义当作未知 target 静默跳过：

   ```yaml
   - insert:
       - id: cc-import
         name: cc-import
       - id: fenix-dsh-dashboard-bridge
         name: fenix-dsh-dashboard-bridge
   ```

4. **启动**（隔离实例 + 非 loopback 信任口径一步到位）：

   ```sh
   setsid nohup env DSH_HOME=$DRILL_HOME \
     dsh --profile web --no-open --port 3444 \
     --trusted-host home.icyfenix.cn:3444 \
     >> /root/.fenix-verify/dsh-live-drill-web.log 2>&1 &
   ```

   启动日志会打印带 token 的访问地址：`dsh web: http://127.0.0.1:3444/?token=<TOKEN>`。非 loopback 口径验收时，临时加 `/etc/hosts` 条目 `127.0.0.1 home.icyfenix.cn` 用该主机名访问，验收后删除条目并确认解析回到真实公网地址。

5. **核对装载**：浏览器打开带 token 地址，控制台无 `failed to activate` / `did not activate` 条目；设置 → Models 页底部出现「从 Claude Code 导入」按钮；侧栏出现 概览/项目/设置/运维/帮助 5 个 bridge 条目。

## 按清单验收

- cc-import：按 `docs/help/cc-import-install.md` 的真机验收清单 1–6 逐项核对（导入写入只进 `$DRILL_HOME`，可用 `python3 -c "import yaml; ..."` 直接核对 `cordis.patch.yml` 里 provider 的 `apiKeyEnv` 引用与 `.credentials.yaml` 的 refs，**不要把凭据值打印到验收记录**）。
- bridge：按 `docs/help/fenix-dashboard-bridge-install.md` 的真机验收清单 1–12 逐项核对。其中 SSE 自动刷新与「移除项目 ≤60s 消失」需要上游数据变化驱动，见下节。

## 上游数据变更纪律（bridge SSE/移除验收）

共享上游不属于本 drill，所有变更必须自愈：

1. **存底**：`cd <fenixd 仓库> && python3 bin/fenix_dashboard.py --list-projects > /tmp/registry-before.txt`。
2. **夹具项目**：建一次性目录（含 `.fenix/STATE.md`），用 Registry 的 fixture 语义注册（不污染正式监控语义）：

   ```sh
   cd <fenixd 仓库> && python3 -c "
   import sys; sys.path.insert(0, '.')
   from core.dashboard.registry import Registry
   print(Registry().add_project('/tmp/path/to/drill-fixture', name='drill-fixture', fixture=True))
   "
   ```

3. **观察**：不做任何页面操作，条件轮询（每 7–10s）侧栏快照，夹具条目应在 ≤60s 内自动出现；随后 `Registry().remove_project(...)` 移除，条目同样 ≤60s 自动消失（实测 ~7s 出现 / ~21s 消失）。
4. **还原核对**：再次 `--list-projects` 与存底 diff 为空，删除夹具目录。

上游停机 502 验收同理：先记录 `ss -tlnp | grep 8787` 的 pid 与 `ps` 启动命令，停机→验 502 提示页与 dsh 其余功能→按原命令 `setsid nohup python3 bin/fenix_dashboard.py --serve ...` 拉起→`curl /api/projects` 探活 200→面板刷新恢复。

## 拆除

1. 杀隔离实例（`ss -tlnp | grep 3444` 找 pid，`kill`）；
2. 移除临时 hosts 条目（如有）并确认解析还原；
3. 上游 registry diff 确认无残留（如做过夹具/停机操作）；
4. `$DRILL_HOME` 目录按需保留或删除（含导入的凭据，不留明文导出）。
