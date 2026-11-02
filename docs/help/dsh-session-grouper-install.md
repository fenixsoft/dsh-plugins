# dsh-session-grouper 安装与验收

`fenix-dsh-session-grouper` 的人工安装步骤、真机验收清单与实现笔记。

## 安装（人工步骤）

1. **主树依赖安装**（两插件各自独立 pnpm 工作区）：

   ```bash
   cd /root/dsh-plugins/fenix-dsh-session-grouper && pnpm install && pnpm build && pnpm test
   cd /root/dsh-plugins/fenix-dsh-dashboard-bridge && pnpm install && pnpm build && pnpm test
   ```

   构建产物：`fenix-dsh-session-grouper/lib/{index.js,host.js}`、`fenix-dsh-dashboard-bridge/lib/{index.js,client.js}`（`lib/` 为 gitignored 构建产物）。

2. **web profile 增依赖**（dsh web 以 `link:` 形态装载两个本地插件）：

   ```bash
   # 在 dsh web 的 profile 配置（package.json dependencies）追加：
   #   "fenix-dsh-session-grouper": "link:/root/dsh-plugins/fenix-dsh-session-grouper"
   #   "fenix-dsh-dashboard-bridge": "link:/root/dsh-plugins/fenix-dsh-dashboard-bridge"
   ```

3. **重启宿主**：

   ```bash
   systemctl restart dsh-web
   ```

4. **验收清单**（真机）：
   - [ ] 侧栏「项目」分组下，两工程（`/root/fenixd`、`/root/dsh-plugins`）的历史存量会话被归入对应分组；
   - [ ] 「未分组」仅剩作用域外会话（cwd 不在两项目根树内）；
   - [ ] 在飞 run 的会话（产物 mtime 距今 < 30 分钟）不被迁移（静默期保护）；
   - [ ] 配置 `enabled=false` 后重启：零注册零迁移（info 级停用日志可查）；
   - [ ] 回滚演练一例：`node lib/host.js --session <已迁移会话id>` → 会话回到原 cwd 分组形态、台账出现 `rolled-back` 行、目标 mangled 目录清理；
   - [ ] dashboard bridge 两项（分区去边框、指挥中心菜单条目）合并后**浏览器强刷即生效，无需重启**（client 静态产物随页面加载）。

## 回滚 CLI

```bash
node /root/dsh-plugins/fenix-dsh-session-grouper/lib/host.js --session <sessionId> [--dsh-home <dir>]
node /root/dsh-plugins/fenix-dsh-session-grouper/lib/host.js --all [--dsh-home <dir>]
```

CLI 以独立 node 进程运行：peer 包（cordis / JSONL 后端）经宿主 dsh 全局安装布局自定位（缺省 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules`，`DSH_PKG_ROOT` 环境变量可覆盖安装根）；持久化 root 缺省 `<DSH_HOME>/sessions`（`--dsh-home` → `DSH_HOME` → `~/.dsh`），显式 `--root` 覆盖。台账位置：`~/.dsh/session-grouper/migrations.jsonl`；备份位置：`~/.dsh/session-grouper-backups/<sessionId>/`。

## 实现笔记

- **`sessionPersistence.list()` 的实例缓存语义**：`JsonlSessionPersistence.list()` 在实例生命周期内有快照缓存——同一实例在缓存有效期内重复 `list()` 可能不反映外部进程的产物落位变化。本插件每轮扫描都经该缝取快照，跨轮一致性由产物 mtime 静默期 + 写前 revision 复核兜底；回滚（独立进程）后，宿主内插件实例的缓存可能滞后一轮，属可接受的最终一致窗口。
- **迁移顺序纪律**：写句柄 → 读事件 → revision 复核 → 备份 → 物化新产物 → 校验新产物 → 关写锁 → 删旧目录（顺序不可颠倒：同 id 双目录共存会被持久化层 duplicate 守卫拒绝）→ 注册表实例索引校正 → 官方 `attachSession` → 台账追加。任一步失败即回滚（备份还原 + 目标清理），不留半迁移状态。
- **产物目录命名复刻**：目标 mangled 目录名由纯规则层（`src/shared/rules.ts`）从项目根推导，与持久化后端 `generationLogPath` 的推导逐字对齐；测试含漂移守卫（rules 推导键 === 真实后端实际落位路径）。
- **peer 钉版**：`0.2.0-rc.2` 精确匹配；运行时版本不符显式拒绝装载（缝漂移纪律）。
- **回滚 CLI 的 peer 包自定位**：`lib/host.js` 独立于 dsh 进程运行，不依赖 ESM parent-walk 命中宿主依赖树——按候选根（`DSH_PKG_ROOT` → 缺省全局安装布局）显式探测 `<root>/<pkg>/lib/index.js` 后动态 import；全部失守再退标准解析（插件目录恰在宿主 node_modules 树内的安装形态）。
- **scope 纪律**：插件只经官方服务缝（`ctx.workspaceRegistry` / `ctx.sessionPersistence`）与文件系统 stat/备份消费，不手写会话产物内容解析。
