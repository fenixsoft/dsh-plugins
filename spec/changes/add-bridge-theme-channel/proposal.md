## Why

fenix dashboard 侧已立项深色主题能力（fenixd 仓 `add-dashboard-dark-theme`），嵌入态跟随宿主经「URL 初始注入 + postMessage 实时广播」实现，iframe 侧契约已在该 SPEC 钉死。本仓 `fenix-dsh-dashboard-bridge` 插件是 iframe 的宿主侧：当前既不注入初始主题、也无 host→iframe 通道（`buildPanelSrc` 只拼 `embed=1&apiBase`，跨帧通信仅 iframe→host 方向），不补桥接侧则嵌入跟随永远不生效。

## What Changes

- `buildPanelSrc`（`src/shared/config.ts`）扩展可选初始主题参数：从宿主主题快照取 `colorScheme` 拼入 `&theme=dark|light`（位于 hash 之前）；三个挂载点全部覆盖——固定条目面板（`src/client/index.ts` 深链五条目）、项目 main 面板（`projectEntrySink`）、右缘页签（`src/client/rightTab.tsx`）。
- 新增 host→iframe 主题广播通道：订阅宿主 `ctx.on("theme/change")` 事件，向全部已挂载 iframe `contentWindow` postMessage `{kind:'fenix-theme', theme:'dark'|'light'}`（消息形状与 fenixd 侧契约一致）。
- `DashboardPanel`（`src/client/panels.tsx`）挂载时把 iframe `contentWindow` 登记进主题广播注册表、卸载时注销（防泄漏、防发往已销毁窗口）。
- 宿主主题 API 不可用（旧版 dsh web 无 `ctx.theme`）时降级：不注入参数、不订阅事件，行为与现状逐字节一致。

## Capabilities

### New Capabilities

- `bridge-theme-channel`: 桥接插件宿主侧主题跟随——初始 `theme` 参数注入契约、theme/change 订阅与 postMessage 广播形状、iframe 注册表生命周期、宿主 API 缺席降级。

### Modified Capabilities

（无——`fenix-dash-bridge` 既有行为不变：`buildPanelSrc` 无 theme 产出与现状逐字符一致，新增为附加可选参数，非既有 requirement 行为变更。）

## Impact

- `fenix-dsh-dashboard-bridge/src/shared/config.ts`：`buildPanelSrc` 扩展（附加可选参数，缺省输出逐字符不变）。
- `fenix-dsh-dashboard-bridge/src/client/panels.tsx`：`DashboardPanel` iframe ref 登记注册表。
- 新增 `fenix-dsh-dashboard-bridge/src/client/themeFollow.ts`（订阅 + 广播 + 注册表）。
- `fenix-dsh-dashboard-bridge/src/client/index.ts` / `rightTab.tsx`：三挂载点注入初始参数。
- tests/：`buildPanelSrc` 合同测试扩展 + 新增 themeFollow 单测。
- 运行侧：插件随既有 merge-back/部署链路在真实 dsh web 生效（非本 SPEC 任务）；fenixd 侧 SPEC 为消费方，其嵌入跟随 Scenario 以本契约为准。
