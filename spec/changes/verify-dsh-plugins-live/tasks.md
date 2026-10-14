## Deliverables

```yaml
- path: cc-import/src/client/index.ts
  kind: modify
- path: cc-import/src/client/importer.ts
  kind: modify
- path: cc-import/tests/importer.test.ts
  kind: modify
- path: docs/help/cc-import-install.md
  kind: modify
- path: docs/help/fenix-dashboard-bridge-install.md
  kind: modify
- path: docs/help/dsh-plugin-live-verification.md
  kind: new
- path: cc-import/lib/index.js
  kind: reference
- path: cc-import/lib/client.js
  kind: reference
```

## 1. cc-import 激活缺陷定位与修复

- [ ] 1.1 搭建隔离验证 profile（临时 `DSH_HOME` + 独立端口）：`pnpm add link:` 链接本分支 `cc-import/` 与 `fenix-dsh-dashboard-bridge/` 构建产物、`cordis.patch.yml` 以 `- insert:` 注册、复刻 live 关键面（含 `dsh-plugin-loopback-trust` 与 `--trusted-host` 参数），启动 `dsh web` 并以 playwright-cli 复现 cc-import client 激活失败，留存浏览器 console 报错证据
- [ ] 1.2 在 `cc-import/src/client/index.ts` 的 `apply` 链路（`remote.$mount(TYPERT_REMOTE)` → `locale.register` → `slots.inject`）逐段插桩定位具体 reject 点，收敛根因到文件+行级（若 bootloader 吞错，以插件侧插桩补可观测性）
- [ ] 1.3 修复根因（如坐实为 `TYPERT_REMOTE` 描述符在真机 typert-protocol 上的兼容问题，参照 `fenix-dsh-dashboard-bridge/src/client/index.ts` 已验证可激活的描述符写法对齐最小描述符面）；重建 `lib/` 后在隔离 profile 重启验证：boot 零激活错误、`/plugins/` bundle 清单含 `cc-import/client.js`、Models 页按钮渲染
- [ ] 1.4 补可在 node 侧运行的防回归断言（覆盖暴露本次缺陷的契约面，如描述符形态/入口导出形状），`pnpm test` 与 `pnpm typecheck` 全绿

## 2. cc-import 真机验收清单（隔离 profile）

- [ ] 2.1 按钮可见：Models 设置页 footer 渲染「从 Claude Code 导入」；对话框候选与 `sqlite3 ~/.cc-switch/cc-switch.db` 一致（10 可导入 + 1 缺 `ANTHROPIC_AUTH_TOKEN` 跳过行），行状态标与勾选默认值符合 spec
- [ ] 2.2 全选导入：结果反馈成功 10 失败 0；Models 页出现 10 个新 provider 行且密钥状态为已配置；该隔离 profile 的 settings 中 provider 值不含 token 明文（`apiKeyEnv` 指向凭据引用）
- [ ] 2.3 重复导入：再次打开对话框 10 行标「已存在」默认不勾选；显式勾选 1 行「将更新」导入后同 route 被覆盖、无 `-2` 后缀副本、其余 9 行不变
- [ ] 2.4 非 loopback 路径：临时 hosts 条目（`127.0.0.1 home.icyfenix.cn`）+ 对应 `--trusted-host` 下验证 Models 页无 memory 横幅、导入入口可用；验收后清理临时 hosts 条目与浏览器会话

## 3. bridge 真机验收清单（隔离 profile）

- [ ] 3.1 侧栏：概览/项目/设置/运维/帮助 5 固定条目可见且位于既有条目之后；项目条目与 `GET /fenix-dashboard/api/projects` 一致且按名排序；点击各条目主面板切换 iframe 且 src 为 `/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/<view>`；点击会话条目可回对话面板
- [ ] 3.2 反代一致性：`GET /fenix-dashboard/umi.<hash>.js` 类静态资源 200 且内容与直连上游一致；面板内 POST 经 `/fenix-dashboard/api/...` 与直连行为一致；`/api`、`/`、`/plugins/...` 等 dsh 自身路径行为与未装插件时一致
- [ ] 3.3 502 降级：停上游后面板收到 502 与「Fenix Dashboard 未启动」提示页、dsh 会话与设置不受影响；随后按原命令恢复上游并探活 `GET /api/projects` 200
- [ ] 3.4 上述项发现缺陷则修复并回归（修改面预计在 `fenix-dsh-dashboard-bridge/src/host/proxy.ts`、`src/client/panels.tsx` 等）；若确认无可自动化受阻项，在收工结果中记录取舍口径

## 4. 安装文档修正与方法论文档

- [ ] 4.1 修正 `docs/help/cc-import-install.md` 与 `docs/help/fenix-dashboard-bridge-install.md`：workspace 注册改为实测的 `pnpm add link:` 写法、loader 条目改为 `- insert:` 形式（注明裸 id 形式会被静默跳过的原因）、新增 `dsh-plugin-loopback-trust` 前置小节（安装命令、engines 匹配、明文 HTTP 安全注记）、live 实例刷新人工步骤（完整重启命令 + token 从启动日志获取 + pkill 自匹配陷阱警示）
- [ ] 4.2 新增 `docs/help/dsh-plugin-live-verification.md`：隔离 profile 验证方法论（临时 `DSH_HOME`、独立端口、`pnpm add link:`、insert 注册、playwright-cli 断言口径、临时状态清理清单），内容与任务 1.1/2.x/3.x 实测过程一致
- [ ] 4.3 按修正后文档在全新临时 profile 从零重装走查一遍（「按文档从零重装可复现」），不一致处回改文档后重验
