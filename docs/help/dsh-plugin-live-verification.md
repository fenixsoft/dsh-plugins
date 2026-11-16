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

## playwright-cli 断言口径

清单核对与自动化断言（`playwright-cli` 的 eval/console/requests 快照）均以**真实运行时实测值**为准，不锚定规格字面量。2026-10-14 全量验收 30 场景中 11 个 warning 全部源于断言校准而非产品缺陷，口径如下：

- **locale**：UI 文案以运行时实际 locale 为准（本机为 English locale），按钮/条目断言用 "Import from Claude Code" 之类实际文案，不要精确匹配中文字面量（「从 Claude Code 导入」）。
- **bundle URL 形态**：dsh 组合模块 URL 形如 `plugins/??cc-import/client.js&rev=<hash>`，断言不要 grep 字面 `plugins/cc-import/client.js`；以 HTTP 200 + 响应体特征（ModuleLoader 工厂、按钮文案）为准。
- **定位器**：优先 role/可访问名定位；`textContent` 匹配注意前缀噪声——如项目条目实际文本为 `"Ffenix-server"`（头像字母前缀），`^\s*fenix-server\s*$` 之类锚定正则会落空，用包含式匹配或 role+name。
- **数值断言用有界口径**：如上游连接数断言「多轮切换后 `ss -tan | grep 8787` 的 ESTAB ≤ 基线」，不做精确等值。
- **时序断言一律条件轮询**（条件满足连续 N 次才放行，禁固定 sleep）；首跑引导弹窗（Preview Notice / Add an API key）与验证流存在时序竞争，以「连续 2 次无弹窗」为放行口径。
- **断言失败先复核归属**：断言与运行时实际行为不符属场景缺陷（修场景），确属产品行为不符才修产品代码（对照 verification-report 的复核口径）。

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

1. 杀隔离实例（`ss -tlnp | grep 3444` 找 pid，`kill <pid>`。**不要用 `pkill -f dsh`**——自匹配陷阱：命令行含 `dsh` 的当前脚本/终端会把自己一并杀掉，还会误伤同机其他 dsh 实例；停上游同理，先 `ss` 取 pid 再 `kill`）；
2. 移除临时 hosts 条目（如有）并确认解析还原；
3. 上游 registry diff 确认无残留（如做过夹具/停机操作）；
4. `$DRILL_HOME` 目录按需保留或删除（含导入的凭据，不留明文导出）。
