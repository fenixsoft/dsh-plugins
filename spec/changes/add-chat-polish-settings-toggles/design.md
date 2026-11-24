# Design: add-chat-polish-settings-toggles

## Context

`fenix-dsh-chat-polish/client.js`（零构建单文件，IIFE + `window.__ModuleLoader__.load`）当前把全部功能实现为无条件生效：一个 `<style>` 标签注入 `POLISH_CSS + VIEW_CSS` 全量样式；经 keyed 插槽以 `priority: -10` 遮蔽官方 `user`/`steering` 渲染（`MarkdownUserView`）；`conversation.input.overlay` 注册 headless `HistoryController` 并挂 document 捕获阶段 keydown/input 单例监听。

官方设置页存在 keyed 插槽扩展点：`settings.section`（`{name, id, order, label}` + 分区组件）与 `settings.section.icon`（`{name, id}` + 图标组件收 `{size, active}`），仓内先例 `fenix-dsh-auth/client.js:328-355` 已真机验证（含 `ctx.slots.entries('settings.section')` 尾随探测 order 的写法）。

本仓无 `DESIGN.md` 设计宪法；视觉与交互约束以官方设置页既有分区形态 + `fenix-dsh-auth` 先例为锚。知识域 `plugin-rollout`（`spec/knowledge/domains/plugin-rollout/dsh-plugin-rollout.md`）给出真机验证纪律：隔离 profile（临时 `DSH_HOME` + 独立端口 + insert 注册 + 复刻 live 关键面）、playwright-cli 条件轮询断言、临时状态清理；live 重启是人工步骤不进任务。

## Goals / Non-Goals

**Goals**
- 6 个功能在官方设置页分区菜单内独立开关，默认全开（= v0.2.2 行为）。
- 切换即时生效，无需刷新；关闭 = 回退官方原生形态。
- localStorage 持久化 + 损坏/不可用降级。
- 嵌入形态（`.embeddedBody`）豁免不受开关影响。
- dsh 升级失配时降级面最小化（菜单缺席 ≠ 功能崩坏）。

**Non-Goals**
- 不做插件级启用/停用（那是 loader/cordis 层的事，官方「内置插件」分区已有）。
- 不做分组开关、快捷键、导入导出配置等扩展管理面。
- 不改动其他插件、宿主包、loader 注册清单。
- 不为开关状态引入宿主 settings 写入面（坚持纯 client、localStorage 自持，与插件零构建纯浏览器侧形态一致）。

## Decisions

### D1 开关数据模型：localStorage 单键 JSON + 内存 pub/sub store

- 键名 `fenix-chat-polish.toggles`，值 `{"<featureId>": bool, ...}`，**只记录非默认（关闭）项**——缺省即开启，向前加功能免迁移。
- featureId 固定 6 个：`whitespace`（留白 24px 含把手隐藏/回到底部对齐/hero 栈铺满基线）、`scrollbar`（滚动条样式）、`composer-width`（输入框 80%）、`markdown`（用户消息 Markdown）、`hero-row`（hero 工作区行对齐）、`history-nav`（↑/↓ 历史导航）。
- 读取容错：JSON.parse 失败 / 值非对象 / 未知 featureId → 忽略该项按开启；写失败（隐私模式/配额）→ 仅内存生效 + `console.warn` 一次降级告警，不抛未处理异常。
- 模块级单例 store（get/set/subscribe），React 侧经 `useSyncExternalStore` 订阅；CSS 重建与渲染器/监听器条件化全部只读这一个 store。
- 备选弃用：每功能一个 style 标签 + `disabled` 属性切换（改动面更大，与「单样式标签自持生命周期」现状偏离）；document.cookie / 宿主 settings（依赖宿主写路径，非 loopback 访问不可用——知识域 plugin-rollout 明示 settings 写入面在非 loopback 下整体不可用）。

### D2 CSS 条件化：单标签内容按开启集合重建

- 把 `POLISH_CSS` 数组按上述 featureId 拆为按功能命名的分块映射表；`VIEW_CSS`（Markdown 气泡视觉）归属 `markdown` 块。
- 分块映射原则（按 README 功能归属，实现时以视觉归属为准）：
  - `whitespace`：ChatView `_scroll`/`_column` 侧距与上限解除、`_toBottomSlot` 对齐、InputBar `_root` 24px 侧距、`[data-width-handle]` 隐藏、hero 空会话栈铺满（与留白同一 24px 基线）；
  - `composer-width`：`_card`/`_notice`/`_dock` 三条 80% 规则；
  - `hero-row`：`_heroWorkspaceRow` 对称 margin 一条规则；
  - `scrollbar`：`html body` 滚动条变量 + `::-webkit-scrollbar` 系列（含四向箭头 data URI）全部；
  - `markdown`：`VIEW_CSS` 全部；
  - `history-nav`：无 CSS。
- 开关切换时重算「开启块拼接串」写入原 style 标签 `textContent`（保持标签与其 `data-plugin-css` 约定不变，dispose 语义不变）。同一功能的多条规则同进同出，不产生半开状态。
- 嵌入豁免前缀（`body:not(:has(...embeddedBody...))`）原样保留在各规则内，不因开关引入新前缀逻辑。

### D3 插槽功能条件化：注册保持静态，组件内部按 store 分流

- `user`/`steering` 的 `priority: -10` 遮蔽注册**保持常驻**（不动态注销/重注册——inject 回调生命周期由宿主管理，运行时重注册语义未验证，风险高）。`MarkdownUserView` 内部读 store：`markdown` 关闭 → 走官方等效纯文本投影分支（同一气泡结构、`text` 纯文本、附件/图片卡不变，仅不挂 `MarkdownText` 与复制按钮）；开启 → 现行 Markdown 渲染。已知取舍：关闭态是「官方等效近似」而非官方组件本体（遮蔽注册在，官方 `UserMessageNodeView` 不可达）；纯文本分支视觉与官方投影一致，可接受。
- `HistoryController` 与 document 捕获监听**保持挂载**，事件处理器入口读 store：`history-nav` 关闭 → keydown/input 处理器直接放行（不接管、不 preventDefault），控制器不挂会话副作用。关闭态开销为两次布尔读，可忽略。
- 备选弃用：动态 `slots.unregister`/重注册（宿主契约未验证，且 abdicate 兜底语义会混淆失败与主动关闭）。

### D4 设置分区 UI：对齐 fenix-dsh-auth 先例

- `settings.section`：`id: 'fenix-chat-polish'`，order 用 `ctx.slots.entries('settings.section')` 尾随探测（失败回退先例同款 `FALLBACK_MAX_ORDER`）；label「对话区打磨」。分区组件渲染 6 个功能行（功能名 + 一句话说明 + 开关控件）；控件优先复用宿主基线包现成开关组件（与官方分区观感一致），不可得则原生 `checkbox`/自绘 toggle 对齐官方视觉变量（颜色/圆角取官方 CSS 变量或先例 `fenix-dsh-auth` 的内联样式口径）。
- `settings.section.icon`：注入一个对话气泡类图标（与既有分区图标尺寸口径一致，收 `{size, active}`）。
- 分区仅提供开关与说明，不放任何需要宿主写入面的表单。

### D5 升级韧性与降级面

- 分区注册、order 探测逐段 try/catch（先例口径），失配仅 `console.warn` + 菜单缺席；功能本体（样式/插槽/监听）不依赖分区存在。
- 开关 store 独立于分区 UI：菜单缺席时持久化键仍生效（此前关闭的功能保持关闭），与「损坏回退」场景一致。

## Risks / Trade-offs

- [settings.section 契约漂移致菜单缺席] → 逐槽 try/catch 降级 + Scenario「插槽失配降级」真机验证；先例 `fenix-dsh-auth` 同槽已真机验证，风险低。
- [关闭 markdown 后与官方渲染的细微视觉差异] → 纯文本分支按官方投影同构实现（气泡/附件同源），SPEC Scenario 只约束「官方等效纯文本投影形态」，验收以气泡结构而非像素比对。
- [开关切换与 React 渲染时序（useSyncExternalStore 通知晚一帧）] → CSS 重建在 store.set 内同步执行（先改样式后通知），样式即时性不依赖 React 重渲。
- [localStorage 在同步存储读上抛异常] → store 初始化整体 try/catch，读失败按全开，与「存储不可用降级」场景一致。
- [fast-track 单 Agent 回归深度] → tasks 验证段按 SPEC 全部 Scenario 逐条列清单，要求隔离 profile 真机走查并留证。

## Migration Plan

- 纯插件内演进：实现分支合入主树后，按 `README.zh.md` 安装节的既有 live 刷新人工步骤重启 dsh web 即生效（无数据迁移、无新注册）；回滚 = 回退插件目录至上一版本重启。
- live 重启与真机复验是文档化人工步骤，不进 tasks（知识域 plugin-rollout 纪律）。

## Open Questions

（无——功能清单、开关粒度、持久化口径、默认值均已经用户 2026-11-24 确认；执行模式 fast-track、立即调度。）
