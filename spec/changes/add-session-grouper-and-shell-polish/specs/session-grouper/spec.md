## ADDED Requirements

### Requirement: 项目工作区幂等注册
Host 半 SHALL 在启动时及每轮扫描前，按配置的项目根列表经官方 `ctx.workspaceRegistry.create(path)` 幂等注册项目工作区（官方语义：同一路径重复 create 返回既有记录、不重复创建）；缺省项目根为 `/root/fenixd` 与 `/root/dsh-plugins`。单个项目根注册失败 SHALL 记录警告并跳过该项目根，MUST NOT 中断其余项目根的处理，MUST NOT 抢占或改写既有工作区的 title 与归属。

#### Scenario: 首次启动注册

- **WHEN** 插件以缺省配置启动，workspace 注册表中不存在 /root/fenixd 工作区
- **THEN** /root/fenixd 与 /root/dsh-plugins 两个工作区被注册（title 取路径末段）；随后插件重启，两工作区不重复创建（幂等复用）

#### Scenario: 目录不存在跳过

- **WHEN** 配置的某项目根路径在宿主机上不存在
- **THEN** 该项目根被跳过并记录警告，其余项目根正常注册，插件不崩溃

### Requirement: 未归组冷会话迁移归组
Host 半 SHALL 周期扫描会话持久化中的会话，凡**同时**满足下列条件的会话执行迁移归组：(a) 未归入任何工作区；(b) header cwd 位于某项目根目录树内（cwd == 项目根，或 cwd 以 `<项目根>/` 开头）；(c) 已静默满配置时长（缺省 30 分钟，以会话产物 mtime 判定）。迁移动作 = 将其持久化 header 的 cwd 重写为所属项目根 → 会话产物按持久化后端契约归位到目标 cwd 对应的会话目录（目标已有同 sessionId 产物时跳过并告警，MUST NOT 覆盖）→ 经官方 `attachSession` 归入项目工作区。同一会话 SHALL 恰好迁移一次（迁移台账幂等去重）；header cwd 不属于任何项目根树内的会话 MUST NOT 被迁移；已归入任意工作区的会话 MUST NOT 被重复迁移。

#### Scenario: worktree 会话归入工程

- **WHEN** 存在未归组会话，其 header cwd 为 `/root/fenixd/.claude/worktrees/impl-add-foo-123`，产物 mtime 距今 2 小时
- **THEN** 该会话 header cwd 被重写为 `/root/fenixd`，产物归位并经 attachSession 进入 /root/fenixd 工作区；dsh web 工作区浏览器中该会话出现在 fenixd 工作区分组下、不再出现在「未分组」

#### Scenario: 项目根直属会话归入工程

- **WHEN** 存在未归组会话，其 header cwd 恰为 `/root/dsh-plugins`
- **THEN** 该会话被归入 /root/dsh-plugins 工作区（cwd 重写为同值，产物归位幂等）

#### Scenario: 目录已删除的陈旧会话

- **WHEN** 存在未归组会话，其 header cwd 指向已删除的 worktree 目录（realpath 不解析）
- **THEN** 该会话仍按路径包含关系判定归属项目根并完成迁移归组，不因原目录不存在而跳过

#### Scenario: 静默期内在飞会话跳过

- **WHEN** 某 fenixd run 会话产物正在写入（mtime 距今 5 分钟，小于缺省静默期 30 分钟）
- **THEN** 该会话本轮跳过、保持未归组；run 结束且静默期满后的下一轮扫描再迁移

#### Scenario: 目标产物冲突跳过

- **WHEN** 迁移目标会话目录下已存在同 sessionId 的产物
- **THEN** 该会话本轮跳过并告警，双方产物保持原状，MUST NOT 覆盖

#### Scenario: 作用域外会话不动

- **WHEN** 存在 header cwd 为 `/tmp/dshacc-xyz` 的会话（不在任何项目根树内）与已归入既有工作区的 `/root/activation-showcase` 会话
- **THEN** 两者均不被迁移，扫描集仅含未归组且树内归属明确的会话

### Requirement: 迁移安全与回滚
每次迁移 SHALL 在写入前把原会话产物完整备份到 `<DSH_HOME>/session-grouper-backups/<sessionId>/`，并把迁移记录（sessionId、原 cwd、目标 cwd、时间戳）追加到 `<DSH_HOME>/session-grouper/migrations.jsonl`；插件 SHALL 提供按台账回滚的手段（恢复备份产物 + 还原 header cwd），回滚后原归属状态可复现。持久化写入 SHALL 尊重 dsh 既有写安全语义（写前校验来源修订，源在准备期间变化即拒绝本轮迁移）；迁移失败 SHALL 回滚到原状态并告警，MUST NOT 留下半迁移状态。

#### Scenario: 备份与台账

- **WHEN** 一个会话完成迁移
- **THEN** `<DSH_HOME>/session-grouper-backups/<sessionId>/` 下存在原产物副本，`migrations.jsonl` 追加一行含 sessionId / 原 cwd / 目标 cwd / 时间戳

#### Scenario: 回滚复现

- **WHEN** 按台账对某已迁移会话执行回滚
- **THEN** 该会话产物与 header cwd 恢复为迁移前状态，dsh web 中该会话回到「未分组」

#### Scenario: 写竞争中止

- **WHEN** 迁移准备期间该会话产物被其他写者修改（修订/mtime 变化）
- **THEN** 该会话本轮迁移被拒绝并告警，产物保持原状，下一轮重新评估

### Requirement: 配置项与显式失败
插件 SHALL 经 cordis.patch.yml loader config 支持配置：`projects`（项目根绝对路径数组，缺省 `['/root/fenixd','/root/dsh-plugins']`）、`quietMinutes`（缺省 30）、`intervalMinutes`（缺省 10）、`enabled`（缺省 true）。缺省配置 SHALL 安全可用；`enabled=false` 或 `projects=[]` 时零迁移、零注册。dsh 服务缝（`ctx.workspaceRegistry` / `ctx.sessionPersistence` / 持久化产物格式）不可用或形态不符时，插件 SHALL 显式记录错误并停用扫描循环，MUST NOT 静默降级、MUST NOT 写坏产物；既有已迁移数据不受影响，dsh web 其余功能不受影响。

#### Scenario: 开关关闭零动作

- **WHEN** 配置 `enabled: false`
- **THEN** 插件装载成功但不注册工作区、不迁移会话，日志记录停用态

#### Scenario: 服务缝漂移显式失败

- **WHEN** dsh 升级后 `ctx.workspaceRegistry` 服务缺失或持久化产物格式不被识别
- **THEN** 插件记录显式错误并停止扫描循环；已迁移会话数据完好，dsh web 其余功能不受影响
