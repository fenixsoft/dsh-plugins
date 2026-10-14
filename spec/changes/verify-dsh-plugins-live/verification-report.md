# verification-report.md — verify-dsh-plugins-live（断点续跑轮）

- 验证者：Fenix Verifier Agent（独立验证）
- 时间：2026-10-15T01:40Z 前后（本轮为断点续跑：上轮 30 场景已执行完毕 done=30，本轮对 16 个非通过场景逐个以真实运行时复执行并补齐凭证）
- 被测对象：cc-import 与 fenix-dsh-dashboard-bridge 两个 dsh 插件（SPEC：`spec/changes/verify-dsh-plugins-live/`）
- 被测运行时：真实 dsh web 实例 `http://127.0.0.1:50297`（隔离 `DSH_HOME=/root/.fenix-verify/dsh-web-home`，profile 装配 cc-import + fenix-dsh-dashboard-bridge + dsh-plugin-loopback-trust，`--trusted-host home.icyfenix.cn:50297`），上游 Fenix Dashboard `127.0.0.1:8787`（在服）；被测 serve 源为主树 `/root/dsh-plugins`（profile workspace `link:` 直链其构建产物，与验证契约 BASE_URL 铁律一致）
- 结论：**bug-found（1 个 minor 文档缺口）**——`{total:30, passed:18, warnings:11, failed:1, errors:0}`

## 终局判定汇总

| 状态 | 数量 | 说明 |
|---|---|---|
| pass | 18 | 断言与步骤全过 |
| warning | 11 | 产品语义全过，差异均为场景断言字面/locale/校准问题（见下） |
| fail | 1 | 交付物内容缺口（文档面，minor） |
| error | 0 | — |

## 上轮 5 个 fail 判定的复核结论（重要更正）

1. `bridge-unit-tests-green`：**fail → pass**。本轮于被测 serve 源（main tree）实跑 `pnpm run test` → `Test Files 3 passed (3), Tests 36 passed (36)`（exit 0）。上轮 fail 系在无 node_modules/lib 的 verify worktree 中执行的环境误判。
2. `ccimport-boot-zero-activation-errors`：**fail → warning**。boot 名册 `__DSH_BOOT__.entries` 68 项含 cc-import 与 bridge、控制台 0 激活错误；cc-import client bundle 实测经 dsh 0.2.0-rc.2 组合模块 URL `plugins/??cc-import/client.js&rev=945d8516a4ae` 返回 **200 / 160211 bytes**（含 ModuleLoader 工厂与导入按钮文案）。场景 grep 字面 `plugins/cc-import/client.js` 与该运行时 URL 形态不匹配 = test-defect，非产品缺陷。
3. `bridge-install-doc-corrected`：**fail → warning**。9 项内容断言 7 项过；`pkill`/`启动日志` 两字面实际落在 `docs/help/cc-import-install.md`「live 实例刷新人工步骤」小节（bridge 文档第 10 行显式交叉引用），任务 4.1 覆盖两文档整体——内容在场、位置断言差异。
4. `dsh-plugin-live-verification-doc-contract`：**fail（维持，minor）**。`docs/help/dsh-plugin-live-verification.md` 全文无 `playwright-cli`（任务 4.2/proposal 明列该方法论文档须含「playwright-cli 断言口径」），亦无「pkill 自匹配」警示字样（仅以 ss+kill 替代做法规避）。= SPEC 交付物内容缺口。**唯一成立的产品侧缺陷。**
5. `bridge-sidebar-entries-and-deeplinks`：**fail → warning**。5 固定深链逐字符 ✓、侧栏构成与排序 ✓；项目条目以 role 定位器实测点击 → iframe src `#/projects/fenix-server` ✓。场景锚定正则 `^\s*fenix-server\s*$` 命中 0 的根因：按钮内含头像字母前缀（textContent 实测 `"Ffenix-server"`）= locator test-defect。

## 上轮 11 个 blocked-env 场景的补齐执行（全部真实运行时）

| 场景 | 终局 | 关键实测 |
|---|---|---|
| ccimport-import-entry-visible-models-page | warning | Models 页导入按钮 visible/enabled/hit 全 true（文案 "Import from Claude Code"，UI 为 English locale，场景中文精确匹配系 locale 脆弱断言） |
| ccimport-dialog-candidates-match-ccswitch | warning | 对话框 11 行/10 勾选/1 跳过（Claude Official·缺 ANTHROPIC_BASE_URL）/按钮 "Import selected (10)" 可用/alert=null；names_match=true（截图 s3） |
| ccimport-import-all-success | warning | 真实导入：outcome "Imported 10"、failures=[]、Models 页 bigmodel.cn/bytedance-volces 在列全绿（11 行含 fresh profile 默认 DeepSeek 行——impl 证据 t43 同现，场景期望值未计入）（截图 s4） |
| ccimport-reimport-update-overwrite-no-dup | warning | 10 行 "Already exists" 默认不勾（按钮 disabled）；勾 1 行 → "Will update" → "Imported 1"；patch 10 route、0 个 `-2` 副本、10 个 apiKeyEnv 引用、无明文 token（截图 s5） |
| ccimport-settings-credentials-no-token | warning | patch/settings 面 0 明文、10 route 全在、凭据 refs 10、base 无缺失；`leaked_in_creds=10` 系凭据库存值的声明设计（"keys live only in the credential store"），场景断言与库用途相悖 = 过度断言 |
| ccimport-live-profile-unpolluted | **pass** | live `.credentials.yaml` 0 引用泄漏、live patch 无导入载荷——写入全程封闭在隔离 DSH_HOME |
| ccimport-nonloopback-trusted-host-models | warning | home.icyfenix.cn:50297 下 Models 页+导入入口可用、无 memory 横幅；alert_count=1 为瞬态工作区初始化提示（快照时刻已消失），非 memory 横幅；hosts 条目已清理（remaining=0） |
| bridge-panel-switch-10-rounds-connections-bounded | **pass** | 10 轮切换、末轮 5 面板深链全 ok、数据仍在、上游 ESTAB=4 有界、控制台 0 未处理异常 |
| bridge-project-sync-lifecycle-fixture | warning | 夹具项目 Registry 注册后侧栏 ~70s 内自动出现（SSE）、移除后自动消失、sync_requests=8、0 异常；iframe 文本断言对上游 `#/projects` 路由形态校准失当（非夹具项目名同样不在正文），非 bridge 缺陷 |
| bridge-upstream-502-degradation-and-recovery | warning | 停上游后直连 000/代理 502；面板 502 提示页完整（含 ECONNREFUSED 与恢复指引）、dsh 设置不受影响；按原命令恢复 → 上游 200、代理恢复 200。dsh 日志行断言为已归档的环境日志口径（安装文档验收第 9 项实测标注） |
| install-doc-fresh-profile-reinstall-walkthrough | **pass** | 全新 profile（port 41567）严格按文档从零：pnpm add link: + github loopback-trust + `- insert:` 装配 → 双插件名册在场、bundle 双 200、导入入口+侧栏一次点亮 → 拆除干净（after_code=000）（截图 s13） |

## 缺陷清单（bugs）

1. **[minor] dsh-plugin-live-verification-doc-contract**：方法论文档缺「playwright-cli 断言口径」与「pkill 自匹配陷阱」内容（任务 4.2/proposal 明列要素）。运行时行为面 0 缺陷；文档补两小节即可关闭。

## 测试边界情况（步骤 5）

- 首跑引导弹窗（Preview Notice / Add an API key）与验证流的时序竞争：以「连续 2 次无弹窗才放行」的轮询处置后全流程稳定复现。
- 上游停机（502 场景）与恢复：恢复探活 200，无残留。
- 非 loopback 主机名 + hosts 临时条目：验收后即时删除（remaining=0）。
- 上游 registry 夹具污染：fixture=True 注册/移除自愈，夹具目录已删。
- 全新 profile 从零重装（walkthrough）：文档口径可复现。

## 证据落位

- 结构化结果：`.fenix/verify-progress/verify-dsh-plugins-live/report.json`（30 场景全量、kind 透传、含凭证 message）
- 截图与命令输出：`.fenix/verify-evidence/verify-dsh-plugins-live/reexec/`（11 张截图 + 单测输出/文档断言/patch 快照/502 响应体/boot 控制台等）
- 上轮既有证据（impl 轮）：`.fenix/verify-evidence/verify-dsh-plugins-live/`（t21–t43 系列）

## 环境处置记录

- 验证中按场景前置契约将隔离 profile 升级为 cc-import + bridge + loopback-trust 三插件并重启 50297 实例（原框架实例已停）；收工清理见 `.fenix-run-result.json`。
- 8787 上游 dashboard 为 tmux 常驻共享服务，502 场景后已按原命令恢复在服（pid 4098328）。

## 本轮场景集变更

当前稳定场景集共 30 个（第 1 轮）。

- 首轮写入 30 个场景

