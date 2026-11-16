# ADR-006：插件真机验证走隔离 profile，live 实例只读人工刷新

date: 2026-11-16
status: accepted

## Context

dsh 插件（cc-import、fenix-dsh-dashboard-bridge）的真机安装验证需要一个可反复重启、可承受导入写入的 dsh web 环境；而 live 实例（127.0.0.1:3080，`/root/.dsh/profiles/web/`）由人工维护、与用户日常使用共享，且实现分支的修复在 merge-back 前不在主树，live profile 的 symlink 指向主树。直接在 live 实例上验证会污染人工维护状态、与使用期冲突，导入写入还可能写坏 live 的 settings/credentials。把 live profile 改指 worktree 的备选被否：同样污染人工维护的 live 状态。

## Decision

插件真机验证一律使用隔离验证 profile：临时 `DSH_HOME` + 独立端口启动 `dsh web`，以 `pnpm add link:` 直链待验构建产物，`cordis.patch.yml` 以 `- insert:` 注册，并复刻 live 的关键面（同插件集合含 dsh-plugin-loopback-trust、`--trusted-host` 参数）。live 实例保持只读：验证不触碰其数据与进程；实现 Agent 不操作主树与 live 进程，live 刷新（重启 dsh web 加载 merge-back 后的新构建，token 从启动日志获取）是文档化的人工步骤，不进入实现任务门禁。

## Consequences

验证写入全部落在临时 `DSH_HOME`、整体可弃，live 零污染；「实现→真机验证」在同一分支闭环，不依赖 merge-back 时序。代价：隔离 profile 必须主动复刻 live 关键面，否则出现「隔离过、live 不过」的环境漂移；每轮验证需手动装配 profile 并清理临时状态（`/etc/hosts` 测试条目、浏览器会话）；live 生效晚一个 merge-back + 人工重启的节拍。
