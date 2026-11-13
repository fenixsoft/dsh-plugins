# Spec Delta: dsh-web-ops-alert-badge（dsh web 左侧栏运维条目待裁决告警计数徽标）

## ADDED Requirements

### Requirement: 待裁决计数口径与数据源
桥插件 client 半 SHALL 以 `GET <prefix>api/alerts`（经 host 半既有同源反代，fenixd dashboard 既有端点，零新增端点）为唯一数据源；徽标计数 SHALL 等于响应 `alerts[]` 中 `Array.isArray(choices) && choices.length > 0` 的条目数——该口径 MUST 与 fenixd 仓 `spec/changes/consolidate-alerts-to-ops-page/` 运维徽标能力逐字一致（未处理且裁决 choices 非空；知情类/已处理/superseded 不计）；SHALL NOT 使用 `total_unhandled`（含知情类，口径虚高）。响应 `alerts` 字段缺失或非数组时 SHALL 按计数 0 处理，MUST NOT 抛出未处理异常。

#### Scenario: 口径过滤与 dashboard 徽标同数
- **WHEN** `GET <prefix>api/alerts` 返回 `total_unhandled=14` 且 `alerts[]` 14 条中仅 1 条 `choices` 非空
- **THEN** 徽标显示 `1`，与 fenix dashboard 独立页侧栏运维徽标同数

#### Scenario: 响应形状漂移按零处理
- **WHEN** 接口返回缺少 `alerts` 字段或其值非数组
- **THEN** 计数按 0 处理（徽标不渲染），页面不崩、无未处理异常

### Requirement: 徽标渲染与零值隐匿
计数 > 0 时，「运维」条目（`fenix-activities`）图标 SHALL 在右上角叠加红底白字数字角标；计数 > 99 SHALL 显示 `99+`；计数为 0 或尚无任何成功拉取时 SHALL NOT 渲染任何角标元素（零告警隐匿，与 fenixd dashboard 徽标 `count=0` 隐匿行为一致）。除叠加角标外，运维条目的图标形态、label、点击行为（打开 `#/activities` 面板）MUST 保持不变。

#### Scenario: 有数渲染
- **WHEN** 计数为 `3`
- **THEN** 运维条目图标右上角呈现红底白字角标「3」，条目其余观感与点击行为不变

#### Scenario: 零值隐匿
- **WHEN** 计数为 `0`（或响应 `alerts[]` 全部 `choices` 为空）
- **THEN** 图标上不渲染任何角标元素，条目观感与本 SPEC 之前一致

#### Scenario: 超百截断
- **WHEN** 计数为 `127`
- **THEN** 角标显示 `99+`

### Requirement: 轮询节奏与失败降级
计数同步 SHALL 以 60s 周期 + window focus 重拉（与既有项目同步 `startProjectSync` 同节奏）；单次拉取 SHALL 带 10s 超时（同 `fetchProjectRowsWithTimeout` 口径，超时 abort）；拉取失败或超时 SHALL 保留最后已知计数值继续显示，MUST NOT 归零、伪造或闪烁；插件卸载/停止函数 SHALL 收口全部计时器、focus 监听与 slot 注册。计数时效承诺为分钟级（非实时），与 dashboard 内嵌页的实时通道不构成一致性契约。

#### Scenario: 周期与焦点刷新
- **WHEN** 用户停驻 dsh web 60s，或切回 dsh web 窗口（window focus）
- **THEN** 触发一次计数重拉，徽标随最新口径更新

#### Scenario: 失败保留最后已知值
- **WHEN** 某次拉取超时或返回非 2xx，且此前最后一次成功计数为 `1`
- **THEN** 徽标继续显示 `1`，不归零不闪烁；下一次周期拉取成功后更新

#### Scenario: 卸载收口
- **WHEN** 插件卸载（停止函数被调用）
- **THEN** 计数轮询计时器与 focus 监听全部移除、条目注册注销，无残留计时器

### Requirement: 防裁剪形态约束
徽标 MUST NOT 被宿主侧栏条目容器的 `overflow: hidden` 裁剪成残弧（2026-11-13 fenixd 仓 dashboard 侧栏同型缺陷教训：绝对定位角标悬出文本盒必被祖先裁剪，DOM 在场≠像素可读）。徽标形态 SHALL 优先将计数直接绘制于图标 svg 内部落位（天然落在图标盒内）；若采用 svg 外 DOM 定位方案，MUST 附几何断言测试证明角标矩形完整落在侧栏条目可视区内且不被任何祖先 `overflow` 裁剪。

#### Scenario: 几何完整可见
- **WHEN** dsh web 左侧栏以默认宽态渲染运维条目徽标
- **THEN** 角标（含数字）矩形完整落于图标可视区，几何自检不被祖先 overflow 裁剪（断言通过），无残弧形态

### Requirement: 形状漂移自守降级
宿主 slots 服务缺席、形状漂移（dsh 升级改名）或注册抛错时，徽标能力 SHALL 整体降级：注册 no-op 或保持官方/既有排位，MUST NOT 产生未处理异常、MUST NOT 使既有固定条目、项目分区、右缘页签等桥能力失效（与桥「形状漂移降级不崩」纪律一致）；降级事件 SHALL console.warn 落日志。

#### Scenario: 服务缺席降级
- **WHEN** dsh 升级后 `sidebar.panellist` 插槽注册面形状漂移
- **THEN** 徽标不出现，运维条目维持既有图标与行为，console.warn 落一条降级日志，页面无未处理异常
