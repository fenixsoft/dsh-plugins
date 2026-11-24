# 对话区打磨功能开关
<!-- knowledge: capability=chat-polish-feature-toggles rev=1
     sources=spec/changes/add-chat-polish-settings-toggles -->

插件 fenix-dsh-chat-polish 在 dsh web 官方设置页注册「对话区打磨」分区，6 个打磨功能各带独立开关：默认全开即插件完整形态，关闭任一项即时回退官方原生形态；开关状态 localStorage 自持，嵌入形态豁免不受开关影响。

## 规则

### 设置分区注册

- 分区经官方 keyed 插槽 `settings.section`（label「对话区打磨」）与 `settings.section.icon`（对话气泡类图标，收 `{size, active}`）注册；分区 `id` 固定 `fenix-chat-polish`，order 用 `ctx.slots.entries('settings.section')` 尾随探测（既有分区最大 order + 1），探测失败回退先例同款兜底常量。
- 注册逐段 try/catch：`settings.section` 槽契约漂移致失配时仅 `console.warn` + 分区菜单缺席，6 个功能的本体行为不受影响、不出现页面报错；开关持久化键独立于分区 UI 存在，菜单缺席时此前关闭的功能保持关闭。
- 分区面板渲染 6 个功能行（功能名 + 一句话说明 + 开关控件，控件复用宿主基线包 `Switch`）；分区只提供开关与说明，不含任何依赖宿主写入面的表单。

### 六功能独立开关

6 个 featureId 固定，互不影响：

| featureId | 功能 | 关闭 = 回退官方原生形态 |
| --- | --- | --- |
| `whitespace` | 对话列留白 24px（含列宽把手隐藏、回到底部浮钮对齐、hero 空会话栈铺满同一 24px 基线） | 官方居中布局（920px 上限）、列宽把手可见 |
| `scrollbar` | 滚动条样式 | dsh 自绘滚动条 |
| `composer-width` | 输入框 80% 宽度居中（提示条/队列坞同轴） | 官方宽度轴 |
| `markdown` | 用户消息 Markdown 渲染（标题/列表/代码高亮） | 官方等效纯文本投影（气泡结构/附件/图片卡不变） |
| `hero-row` | hero 工作区行对齐输入卡 | hero 行官方边距 |
| `history-nav` | 输入框 ↑/↓ 历史导航召回 | ↑/↓ 官方多行光标移动，编辑/发送/IME 不受影响 |

任一开关切换即时生效（无需刷新页面）；关闭 = 该功能回退官方原生形态，开启 = 恢复插件形态；6 个全部关闭 = 对话区官方原生形态，无插件残留样式与行为。所有功能缺省即开启，默认组合下行为即插件完整打磨形态。

### 开关状态持久化与降级

- 持久化于 localStorage 单键 `fenix-chat-polish.toggles`，值 JSON 对象 `{featureId: bool}`，**只记录非默认（关闭）项**——缺省即开启，向前加功能免迁移；持久化值跨页面刷新与浏览器重启保持。
- 读取容错：JSON 解析失败 / 值非对象 / 未知 featureId → 忽略损坏部分按开启处理，页面正常加载。
- localStorage 不可用（隐私模式/配额满）→ 开关降级为仅当前会话内生效，控制台仅留一次降级告警，不抛未处理异常；刷新后回默认全开。

### 即时生效机制

- 模块级单例 toggle store（get/set/subscribe）是全部条件化的唯一读源；React 侧经 `useSyncExternalStore` 订阅（宿主 React 无该 API 时降级 useState+useEffect 订阅，保证已挂载组件随开关即时重渲）。
- 样式侧：插件样式分块按 featureId 命名映射（`history-nav` 无 CSS）；开关切换在 store.set 内**同步**重算开启块拼接串写入原单 style 标签 `textContent`（先改样式后通知订阅方），样式即时性不依赖 React 重渲；同一功能的多条规则同进同出，无半开状态；标签的 `data-plugin-css` 约定与 dispose 语义保持不变。
- 插槽侧：`user`/`steering` 的 `priority: -10` 遮蔽注册**保持常驻**，不做运行时注销/重注册；`MarkdownUserView` 组件内部按 store 分流——`markdown` 关 → 官方等效纯文本投影分支，开 → Markdown 渲染。
- 监听侧：`HistoryController` 与 document 捕获阶段 keydown/input 监听保持挂载；`history-nav` 关 → 事件处理器入口直接放行（不接管、不 preventDefault），控制器不挂会话副作用。

### 嵌入形态豁免

- fenixd dashboard 嵌入形态（root 带 `.embeddedBody`）恒豁免：任意开关组合（含全开）下插件不注入任何样式与行为改动，对话区保持官方自身宽度轴。豁免由各 CSS 规则内的 `body:not(:has(...embeddedBody...))` 前缀承载，开关机制不引入新的豁免逻辑。

## 代码锚点

- 主实现：`fenix-dsh-chat-polish/client.js`（CSS 分块映射表、toggle store、`settings.section`/`settings.section.icon` 注册、插槽与监听器条件化、设置分区 UI）。
- 插件形态：`fenix-dsh-chat-polish/package.json`（版本 0.3.0）、`fenix-dsh-chat-polish/cordis.patch.yml`（insert 注册）、`fenix-dsh-chat-polish/index.js`（Host 半空 `apply()`）。
- 功能开关文档：`fenix-dsh-chat-polish/README.zh.md`（六功能开关表、持久化与降级口径）。
- 守卫测试：`fenix-dsh-chat-polish/tests/client.test.mjs`（含 v0.2.2 基线 CSS 对照 `tests/v0.2.2-baseline.css`）。
- 真机验收证据：`.fenix/verify-evidence/add-chat-polish-settings-toggles/`（分区可见/即时切换/持久化/全关回退/插槽失配/嵌入豁免等场景快照）。

## 溯源

- 2026-11-24 add-chat-polish-settings-toggles（spec/changes/add-chat-polish-settings-toggles/）— 新建本页：设置分区注册与插槽失配降级、六功能独立开关清单与官方回退形态、localStorage 单键持久化与损坏/不可用降级、即时生效机制（store 同步重建 CSS + 插槽常驻内部分流）、嵌入形态恒豁免。
