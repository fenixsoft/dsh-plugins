## Context

dsh web（@deepseek-ai/dsh 0.2.0-rc.2，systemd 服务 `dsh-web.service`，profile `web`，端口 3080）的 workspace 归属模型：会话只有「canonical cwd **严格等于** workspace 注册路径」才计入工作区（`dsh-workspace/lib/types/entity.js` attach 门 + `sessionIds` getter 过滤）；经 cwd 创建的会话（fenixd headless run、worktree 内 run）从不自动 attach。当前 `~/.dsh/storages/workspace.json` 仅注册了 1 个工作区（/root/activation-showcase），`~/.dsh/sessions/` 下 265 个会话目录中约 235 个为 fenixd run（cwd 全在 `/root/fenixd/.claude/worktrees/...` 及项目根）、22 个在 dsh-plugins 一侧，全部堆积「未分组」。

用户定调：**外挂式**，不动 dsh 本体安装文件、不影响升级。生态调研（2026-11-02）证实社区先例：`dsh-tool-github` 经 `ctx.workspaceRegistry.create` 注册工作区；`dsh-session-workspace` / `dsh-session-move` 以「重写会话持久化 header cwd + 产物归位 + 官方 attach」做跨工作区迁移（带备份/写租约），零本体改动。本机会话存储为 per-session JSONL 目录后端（`~/.dsh/sessions/<mangled-cwd>/<session-uuid>/`），符合迁移类插件前置。社区插件版本钉在 0.1.x，不能直接安装，机制自研复刻。

本 change 同时包含两处 bridge client 半小改：「项目」分区容器去边框（对齐官方工作区区域无边框视觉）、固定菜单条目 5→6（补指挥中心 `#/command-center`）。

## Goals

- 三项交付：分区去边框、指挥中心入菜单、未分组会话按工程自动归组（含存量 265 会话回填与未来新 run 会话的稳态归组）。
- 归组全链路零 dsh 本体文件改动：只用官方服务缝（`ctx.workspaceRegistry` / `ctx.sessionPersistence`）+ 会话数据重写 + 官方 `attachSession`。
- 迁移可回滚：备份先行、台账幂等、写竞争拒绝、失败不留半迁移状态。
- dsh 升级时最坏行为 = 插件显式报错停用（数据无损），不存在静默失效。

## Non-goals

- 不改 dsh 本体的 cwd 相等语义（不做通用 containment 补丁）——归组靠「把数据改成相等」而非「把规则改成包含」。
- 不改 fenixd 派发侧（headless run 的 worktree cwd 契约、守卫、AGENTS.md 路径假设全部不动）。
- 不做 client UI（grouper 为纯 host 半插件）；不做 dsh web 侧栏接管/虚拟分组树（`sidebar.workspaces` 为官方独占 single 槽，不可入）。
- 不迁移作用域外会话（不在项目根树内的，如 `/tmp/*`、`/root/dsh-e2e-proj`，保持未分组）。
- 不处理 SQLite 持久化后端（本机为 JSONL；SQLite 形态直接显式失败停用）。

## Decisions

1. **归组机制 = cwd 重写 + 官方 attach**（而非宿主补丁/虚拟分组 UI）。三方案对比：宿主补丁改 3 处编译产物（升级即失效需重放）；虚拟分组 UI 不动数据但不清理官方「未分组」桶（官方独占槽不可替换）；cwd 重写沿用社区验证过的机制——把 worktree 会话的 header cwd 改写为项目根后，cwd 严格相等门自然通过，attach 合法。副作用正合需求：历史 run 会话 resume 目录变为项目根（worktree 已被清理，原目录本就 resume 不回）。
2. **归属判定 = 路径包含**：`cwd === 项目根 || cwd.startsWith(项目根 + '/')`。项目根列表可配置（缺省 fenixd + dsh-plugins），恰好覆盖 235+22 个会话；`/tmp/*`、`/root/dsh-e2e-proj` 等天然排除。一个 cwd 命中多个项目根时取**最长前缀**归属（防御嵌套配置）。
3. **在飞保护 = mtime 静默期 + 写前校验**：产物 mtime 距今 < quietMinutes（缺省 30）的会话本轮跳过；写前对来源产物做修订/mtime 校验，准备期间被改即拒绝本轮。不追求完美的在飞探测——静默期足以覆盖 fenixd run 的写入窗。
4. **产物读写 MUST 经 dsh 持久化包既有句柄**（native session handles），MUST NOT 手写原始文件解析（`.jsonl.zstd` 压缩帧结构由包内代码处理）。实现期以安装包 `lib/types/*.d.ts` + `lib/*.js` 为唯一真相源（与 fenix-dsh-bundle 探针纪律同），参考实现形态见社区插件 dsh-session-workspace（GitHub Unintendedz/dsh-session-workspace，钉 0.1.5，仅参考机制不直接复用代码）。
5. **迁移后索引刷新**：workspace 注册表在 init 时全量索引过 header（`headers` / `sessionPaths` 两张实例内映射表），数据重写后缓存陈旧会使官方 attach 以旧 cwd 校验而失败。两级策略：(a) 主路径——插件对**实例状态**做运行时校正（按新 header 更新两张映射表后 attach 即时生效；字段缺失/形态不符 → 显式失败，属运行时状态修正而非文件补丁）；(b) 兜底——attach 失败的会话记入台账 pending-attach，下次插件启动（缓存已新鲜）重试 attach；人工重启 dsh-web 后 init 全量重扫天然收敛。`sessionPersistence.list()` 若有实例级缓存，同款处理（实现期真机探针确认缓存语义）。
6. **产物归位语义**：header cwd 重写后，会话产物目录从 `<mangled-旧cwd>/<uuid>` 迁至 `<mangled-新cwd>/<uuid>`（目标 = 项目根对应的会话目录，可能已存在）；目标冲突（同 uuid 产物已在）跳过告警不覆盖；原产物在备份目录保留全量副本。
7. **配置经 loader config**（cordis.patch.yml config 段，与 bridge 的 `BridgeConfigInput` 同构）：`projects` / `quietMinutes`(30) / `intervalMinutes`(10) / `enabled`(true)；缺省即生效（本机两项目根是真实需求，非保守占位）。
8. **bridge 两项为纯 client 半改动**：`sectionStyle` 去 `border`（背景与圆角保留；降级浮层列表边框保留）；`FIXED_ENTRIES` 增 `{id:'fenix-command-center', label:'指挥中心', route:'#/command-center', order:11}`，其余 order 顺延为 12–15，`FIXED_GLYPHS` 增同风格线性图标（24×24 stroke，形态实现者定，建议显示器+折线的指挥屏意象）；main keyed 面板由既有循环自动注册。合并后浏览器强刷即生效，无需重启 dsh-web。
9. **交付形态**：`lib/` 为 gitignored 构建产物——实现者在 worktree 构建自验，合并后主树 rebuild 属人工安装步骤；安装（profile `link:` 依赖 + `systemctl restart dsh-web`）写 `docs/help/dsh-session-grouper-install.md`（参照 `fenix-dashboard-bridge-install.md` 惯例），不在 tasks.md 写成 Agent 任务（§3.2.1 五类不可达任务纪律）。
10. **版本钉扎**：peerDependencies 精确钉 `@deepseek-ai/dsh-workspace`、`@deepseek-ai/dsh-session-persistence` 等被消费包为 0.2.0-rc.2（与 fenix-dsh-bundle 同纪律）；插件启动时校验运行时版本，不符即显式拒绝装载。

## Risks

- **dsh 服务缝/产物格式漂移**（升级破坏插件）：缓解 = 版本钉扎 + 启动期缝存在性校验 + 显式失败停用；重启兜底路径（init 全量重扫）天然存在，已迁移数据落盘不受影响。
- **实例私有映射表形态漂移**（Decision 5 主路径失效）：缓解 = 字段存在性校验，缺失即走兜底路径（台账 pending-attach + 下次启动重试），功能退化为「重启后才归组」而非错误归组。
- **并发写竞争**（迁移期间 fenixd 又起 run 写同一会话）：静默期 + 写前校验双重防护；残余风险窗口（恰在静默期满瞬间复活写入）由修订校验拒绝，无数据损坏面。
- **mangled 目录归位与持久化实现细节未知**（zstd 帧、generation 语义）：实现期以安装包代码为真相源真机探针确认；测试以临时 DSH_HOME 隔离 profile 覆盖（参照 dsh-session-workspace 的测试策略），MUST NOT 对真实 `~/.dsh/sessions` 直写测试。
- **误迁移**（配置了过宽的项目根如 `/root`）：缺省配置收敛 + 文档警示；回滚台账兜底。
