# fenix-dsh-session-grouper

dsh web 宿主侧会话归组插件：把散落在 worktree / 子目录里的存量 dsh 会话归组到所属工程项目工作区，让侧栏「项目」分组聚齐历史会话。

## 机制

插件装载后按 `intervalMinutes` 周期执行单轮扫描：

1. **注册**：逐项目根经 `workspaceRegistry.create(root, basename(root))` 幂等注册项目工作区（官方语义：同 canonical 路径复用既有记录，不改 title；单根失败告警跳过不中断其余根）。
2. **扫描**：经 `sessionPersistence.list()` 取全量会话快照 × 工作区账目（`sessionIds` 投影）求差，得到「未归组」会话集合；产物 mtime 经 `resolveCurrentLog` 定位后由文件系统 stat 提供。
3. **计划**：逐会话判定——
   - `cwd` 在任一项目根树内（含 `cwd === 项目根`）→ 迁移项；
   - 作用域外 / 已归组 / 已迁移（台账幂等去重）/ 无产物 / mtime 静默期不足（`quietMinutes`，在飞会话）/ 目标产物冲突 → skip 项带机器可读 reason。
4. **迁移**（备份先行，任一步失败回滚到原状态，不留半迁移）：
   - 备份全量产物到 `<DSH_HOME>/session-grouper-backups/<sessionId>/`；
   - 写句柄打开（进程内单写者 + 跨进程 flock）→ 读全量事件 → 写前修订校验（revision 变化即拒绝本轮，产物保持原状）；
   - 经持久化缝重写通道（`persistBatch` / `persistHeader`）以新 header（`cwd` = 项目根）物化到目标 mangled 目录（目标已有 generation 即拒绝，不覆盖）；
   - 校验目标产物（identity 校验含新 `header.cwd` 与路径一致性）→ 释放写锁 → 删除旧产物目录（顺序不可颠倒：同 id 双目录共存会被持久化层 duplicate 守卫拒绝）；
   - 注册表实例状态校正（`headers` / `sessionPaths` 映射表按新 header 更新）→ 官方 `workspace.attachSession(id)` 归组；
   - 追加台账 `<DSH_HOME>/session-grouper/migrations.jsonl`（sessionId / 原 cwd / 目标 cwd / 时间戳 / status）。

`enabled=false` 或 `projects=[]` 为合法零动作停用（info 级日志，零注册零迁移）；服务缝漂移（`workspaceRegistry` / `sessionPersistence` 缺失、后端非 JSONL 形态、peer 钉版不符）为 error 级显式停用（不启动扫描循环）。

## 配置（loader config）

| 键 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `projects` | `string[]` | `['/root/fenixd', '/root/dsh-plugins']` | 项目根绝对路径列表；`[]` 合法（零迁移零注册）；非法输入（非数组 / 非绝对路径等）装载期显式抛错 |
| `quietMinutes` | `number` | `30` | 静默期（分钟）：产物 mtime 距今不足该时长的视为在飞，本轮跳过 |
| `intervalMinutes` | `number` | `10` | 扫描周期（分钟） |
| `enabled` | `boolean` | `true` | 总开关（false 即零动作停用） |

## 回滚

台账驱动的幂等回滚，可在宿主直接执行（`lib/host.js` 为独立 CLI 产物）：

```bash
# 回滚单个会话
node /path/to/fenix-dsh-session-grouper/lib/host.js --session <sessionId>

# 回滚全部已迁移会话
node /path/to/fenix-dsh-session-grouper/lib/host.js --all

# 指定 DSH_HOME（缺省 ~/.dsh）
node /path/to/fenix-dsh-session-grouper/lib/host.js --all --dsh-home /root/.dsh
```

回滚动作：清理目标 mangled 目录（含空目录）→ 恢复备份产物到原目录（header cwd 随备份复现）→ 撤销注册表实例索引 → 台账追加 `rolled-back` 行。重复执行按台账最新状态幂等跳过。

## 版本钉扎

`peerDependencies` 精确钉 `0.2.0-rc.2`（`@deepseek-ai/cordis` / `dsh-session` / `dsh-session-persistence-jsonl` / `dsh-workspace`）。装载期经 `createRequire` 比对安装包运行时版本，不符即显式拒绝装载（无法解析安装布局时告警放行、以结构校验兜底）。持久化产物格式演进（`SESSION_FORMAT_VERSION`）由后端自身守卫，本插件不解析产物内容。

## 已知限制

- 仅支持 JSONL 持久化后端（`name === 'session-persistence-jsonl'`）；SQLite 形态显式失败停用。
- 会话 id 全局唯一约束由持久化层守卫：同 id 双目录会在任何 `stat` / `list` 上抛 duplicate，故目标冲突的主要防线在计划层（目标键被占且非自身现位 → skip）；执行层兜底为「物化拒绝 → 备份回滚」。
- `sessionPersistence.list()` 的实例缓存语义：单轮扫描内一致；跨轮以产物 mtime/revision 复核兜底（详见 `docs/help/dsh-session-grouper-install.md` 实现笔记）。
- 迁移只改持久化 header 的 `cwd` 与产物落位，不改会话内容；宿主对迁移中会话的写操作由 flock + revision 校验挡住（写竞争中止本轮，产物原状）。
