## Deliverables

```yaml
- path: fenix-dsh-dashboard-bridge/src/client/panels.tsx
  kind: modify
- path: fenix-dsh-dashboard-bridge/src/client/index.ts
  kind: modify
- path: fenix-dsh-dashboard-bridge/tests/srcContract.test.ts
  kind: modify
- path: fenix-dsh-session-grouper/package.json
  kind: new
- path: fenix-dsh-session-grouper/pnpm-workspace.yaml
  kind: new
- path: fenix-dsh-session-grouper/pnpm-lock.yaml
  kind: new
- path: fenix-dsh-session-grouper/tsconfig.json
  kind: new
- path: fenix-dsh-session-grouper/tsdown.config.ts
  kind: new
- path: fenix-dsh-session-grouper/vitest.config.ts
  kind: new
- path: fenix-dsh-session-grouper/README.zh.md
  kind: new
- path: fenix-dsh-session-grouper/src/types/dsh-runtime.d.ts
  kind: new
- path: fenix-dsh-session-grouper/src/shared/rules.ts
  kind: new
- path: fenix-dsh-session-grouper/src/host/index.ts
  kind: new
- path: fenix-dsh-session-grouper/src/host/settings.ts
  kind: new
- path: fenix-dsh-session-grouper/src/host/sessionScan.ts
  kind: new
- path: fenix-dsh-session-grouper/src/host/migrator.ts
  kind: new
- path: fenix-dsh-session-grouper/src/host/rollback.ts
  kind: new
- path: fenix-dsh-session-grouper/tests/rules.test.ts
  kind: new
- path: fenix-dsh-session-grouper/tests/settings.test.ts
  kind: new
- path: fenix-dsh-session-grouper/tests/migrator.test.ts
  kind: new
- path: fenix-dsh-session-grouper/tests/hostContract.test.ts
  kind: new
- path: docs/help/dsh-session-grouper-install.md
  kind: new
- path: fenix-dsh-session-grouper/lib/host.js
  kind: reference
```

## 1. 安装包契约探针与工程骨架

- [ ] 1.1 以安装包 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下 `dsh-session-persistence-jsonl`、`dsh-session`、`dsh-workspace` 的 `lib/` 与 `.d.ts` 为唯一真相源，确认四件事：会话 header 的读写句柄（native session handles，含 `.jsonl.zstd` 形态）、产物目录命名（mangled cwd）与归位语义、写安全/修订校验可用面、`ctx.workspaceRegistry` 的 `create`/`attachSession` 服务签名；结论以注释形式落位 `src/types/dsh-runtime.d.ts`（类型缝注释），不确定点（如 `sessionPersistence.list()` 实例缓存语义）记录到 `docs/help/dsh-session-grouper-install.md` 的「实现笔记」段
- [ ] 1.2 搭建 `fenix-dsh-session-grouper` 工程骨架：镜像 `fenix-dsh-dashboard-bridge` 的 pnpm 工作区形态（package.json 的 peerDependencies 精确钉 `0.2.0-rc.2`、tsconfig.json、tsdown.config.ts、vitest.config.ts、pnpm-workspace.yaml），`pnpm install` 通过、空插件可被 tsdown 构建出 `lib/host.js`

## 2. 纯规则层

- [ ] 2.1 `src/shared/rules.ts` 纯函数：路径包含归属判定（`cwd === 项目根` 或 `cwd` 以 `<项目根>/` 开头；命中多个项目根取最长前缀）、mangled 会话目录名推导、迁移计划构造（输入会话快照 + 配置 → 逐会话的备份/重写/归位/attach 计划项；作用域外 / 静默期不足 / 已归组 / 目标产物冲突 → skip 项带机器可读 reason）+ `tests/rules.test.ts` 全分支覆盖（对应 spec 六个迁移 Scenario 的纯函数分支）

## 3. 配置与插件装载

- [ ] 3.1 `src/host/settings.ts`：loader config 解析归一（`projects` 缺省 `['/root/fenixd','/root/dsh-plugins']`、`quietMinutes` 缺省 30、`intervalMinutes` 缺省 10、`enabled` 缺省 true；非法输入装载期显式抛错，不静默取缺省）+ `tests/settings.test.ts`
- [ ] 3.2 `src/host/index.ts` 插件体：启动期服务缝存在性校验（`ctx.workspaceRegistry` / `ctx.sessionPersistence` 缺失或运行时版本与 peer 钉版不符 → 显式错误停用扫描，日志说明）；`enabled=false` 零动作零注册；周期扫描循环（`intervalMinutes`，返回可停止函数）；单会话失败不中断整轮（错误隔离）；+ `tests/hostContract.test.ts`（以形状桩覆盖装载/停用/服务缝漂移三分支）

## 4. 扫描与迁移

- [ ] 4.1 `src/host/sessionScan.ts`：项目工作区幂等注册（经 `workspaceRegistry.create`，单根失败告警跳过不中断）、未归组会话集合扫描（经 `ctx.sessionPersistence`）、mtime 静默期过滤（`quietMinutes`）
- [ ] 4.2 `src/host/migrator.ts`：按计划执行——备份全量产物到 `<DSH_HOME>/session-grouper-backups/<sessionId>/` → 经持久化句柄重写 header cwd → 产物归位到目标 mangled 目录（目标冲突跳过告警不覆盖）→ 注册表实例状态校正（`headers`/`sessionPaths` 映射表按新 header 更新，字段缺失/形态不符显式失败转兜底台账）→ 官方 `attachSession` 归组 → `<DSH_HOME>/session-grouper/migrations.jsonl` 追加台账（sessionId/原 cwd/目标 cwd/时间戳）；写前修订校验失败拒绝本轮；任一步失败回滚到原状态并告警，不留半迁移状态
- [ ] 4.3 `tests/migrator.test.ts`：以临时 DSH_HOME（隔离目录）优先用真实持久化包装配（不可装配处以形状替身补充并在用例注明），覆盖 spec `session-grouper` 全部 Scenario：worktree 会话归入工程、根直属会话归入、原目录已删除的陈旧会话、静默期内在飞跳过、目标产物冲突跳过、作用域外会话不动、备份与台账落位、写竞争中止；MUST NOT 对真实 `~/.dsh/sessions` 读写

## 5. 回滚

- [ ] 5.1 `src/host/rollback.ts`：按台账回滚单个/全部（恢复备份产物 + 还原 header cwd + 归位目录清理 + 台账标记回滚），提供可在宿主直接 `node` 执行的 CLI 入口；`tests/migrator.test.ts` 补回滚 Scenario（回滚后归属状态复现）

## 6. bridge client 两项

- [ ] 6.1 `fenix-dsh-dashboard-bridge/src/client/panels.tsx`：`sectionStyle` 去除 `border`（背景与圆角保留；降级浮层分组列表 `groupListStyle` 的边框保留不动），宽/窄态空态壳同步无边框
- [ ] 6.2 `fenix-dsh-dashboard-bridge/src/client/index.ts`：`FIXED_ENTRIES` 增 `{id:'fenix-command-center', label:'指挥中心', route:'#/command-center', order:11}`，其余条目 order 顺延为 12–15；`FIXED_GLYPHS` 增同风格线性图标（24×24 viewBox stroke，指挥屏意象），`FixedEntryId` 类型同步扩展
- [ ] 6.3 `fenix-dsh-dashboard-bridge/tests/srcContract.test.ts`：更新为 6 条目契约（id/label/order/深链一一对应、指挥中心位于概览与项目之间、分区容器无边框断言）；bridge `tsdown` 构建通过（`lib/client.js` 更新）

## 7. 文档与收尾

- [ ] 7.1 `fenix-dsh-session-grouper/README.zh.md`（机制/配置/回滚/版本钉扎/已知限制）+ `docs/help/dsh-session-grouper-install.md`（人工安装步骤：主树 `pnpm install` + 两插件构建、web profile 增 `link:` 依赖、`systemctl restart dsh-web`、真机验收清单：存量会话归入两工程分组且「未分组」仅剩作用域外会话、在飞 run 会话静默期不迁移、配置 `enabled=false` 零动作、回滚演练一例；标注 bridge 两项合并后浏览器强刷即生效、无需重启）
- [ ] 7.2 收尾验证：`pnpm -r test` 全绿、两插件各自 `tsdown` 构建成功、`fenix-dsh-session-grouper` 在临时 DSH_HOME 冒烟一轮（注册工作区 + 迁移夹具会话 + 台账落位）
