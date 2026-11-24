# 面板桥主题通道（bridge-theme-channel）

## ADDED Requirements

### Requirement: 初始主题参数注入

`buildPanelSrc(prefix, hashRoute, theme?)` SHALL 支持第三可选参数：值域白名单 `dark|light`，提供时在 `apiBase` 之后、hash 之前拼 `&theme=<档>`；参数未提供或值非法时 SHALL 产出与现状逐字符一致的 URL。插件 SHALL 在三个挂载点（固定条目面板、项目 main 面板、右缘页签）以宿主主题快照 `active.colorScheme` 注入初始档；宿主主题 API 缺席时不注入。

#### Scenario: 深色宿主初始注入

- **WHEN** 宿主当前主题 `active.colorScheme` 为 `dark`，用户打开任一 dashboard 面板（含右缘页签与项目面板）
- **THEN** iframe src 形如 `<prefix>/?embed=1&apiBase=<prefix>&theme=dark#<route>`，dashboard 首帧即深色

#### Scenario: 缺省逐字符一致

- **WHEN** 宿主主题 API 缺席或调用方未提供第三参数
- **THEN** `buildPanelSrc` 产出与既有契约逐字符一致（`<prefix>/?embed=1&apiBase=<prefix>#<route>`），既有合同测试零改动通过

### Requirement: theme/change 实时广播

插件 SHALL 订阅宿主 `ctx.on("theme/change")` 事件，把 `snapshot.active.colorScheme` 经白名单映射后向全部已挂载 dashboard iframe 的 `contentWindow` 广播 postMessage，消息形状 `{kind:'fenix-theme', theme:'dark'|'light'}`（目标 origin 为 dashboard 同源前缀）。`colorScheme` 非白名单值时 SHALL NOT 发送。事件订阅 SHALL 随插件生命周期注销。

#### Scenario: 宿主切换实时跟随

- **WHEN** 用户在 dsh web 把 UI 从浅色切为深色（dashboard 面板已挂载）
- **THEN** 全部已挂载 dashboard iframe 各收到一条 `postMessage({kind:'fenix-theme', theme:'dark'}, …)`，页面即时切深色，无需刷新

#### Scenario: 非法 colorScheme 不广播

- **WHEN** 事件快照 `active.colorScheme` 为白名单外值
- **THEN** 不向任何 iframe 发送消息，已挂载面板主题保持不变

### Requirement: 面板窗口注册表

`DashboardPanel` SHALL 在挂载时把 iframe `contentWindow` 登记进主题广播注册表、卸载时注销；广播 SHALL 仅发给注册表在册窗口（postMessage 以 try/catch 兜底，不因个别窗口销毁中断其余广播）。

#### Scenario: 挂载注销对称

- **WHEN** 用户打开面板后关闭（组件卸载）
- **THEN** 该窗口已从注册表注销，后续主题广播不再发往该窗口；再次打开则重新登记

#### Scenario: 单窗口销毁不中断广播

- **WHEN** 注册表含两个在册窗口，其一已随卸载销毁
- **THEN** 广播跳过销毁窗口且不抛出未捕获异常，另一窗口正常收到消息

### Requirement: 宿主 API 缺席降级

`ctx.theme` 缺席、`getTheme` 不可调用或事件订阅不可用时，插件 SHALL 降级为现状行为：不注入初始参数、不订阅广播、无报错；除 themeFollow 单模块外其它模块 SHALL NOT 感知主题能力存在与否。

#### Scenario: 旧宿主零影响

- **WHEN** 插件运行在不提供 `ctx.theme` 的 dsh web 版本
- **THEN** 面板 src 与现状逐字符一致，主题切换无广播，控制台与功能无新增错误
