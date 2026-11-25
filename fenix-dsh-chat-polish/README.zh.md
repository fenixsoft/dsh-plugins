# fenix-dsh-chat-polish

dsh web 对话区打磨插件（纯 client 半，零构建，先例 `dsh-plugin-loopback-trust`）。

**0.3.0 起**核心功能在官方设置页「Fenix 插件」分区内带独立开关，默认全开
（等于安装即用形态），关闭某项即时回退官方原生形态，无需刷新页面——见下文
[设置页独立开关](#设置页独立开关0310-起)。0.3.x 起设置页可经「嵌入设置页面」
开关由弹出模态改为嵌入内容区的整页形态。

## 功能

1. **对话列左右留白固定（2026-11-25：左 14px / 右 24px）**
   - 官方布局把消息列锁在 `--dsh-chat-content-width`（最大 920px）居中，宽屏两侧留白巨大；
   - 覆盖后：消息列与输入卡对齐铺满；原先两侧各留 24px，2026-11-25 按用户要求
     滚动容器左内边距收窄至 14px（消息更贴近左侧栏；右侧保持 24px，贴边滚动条
     不受影响；列为填充布局，右缘不变）；
   - 列宽拖拽把手隐藏（固定留白后无拖拽空间，且防止拖拽写入 localStorage 宽度偏好）；
   - 「回到底部」浮钮同步对齐；
   - **嵌入形态豁免**：fenixd dashboard 嵌入（root 带 `.embeddedBody`）不受影响。

2. **滚动条对齐 dashboard 观感**（0.2.0-rc.2 的 dsh 自绘滚动条太淡太细且无箭头；
   0.3.x 起不再在设置面板暴露开关，功能默认保持开启）
   - dsh 滚动条全走 body 级变量（`--dsh-scrollbar-thumb/width`），`html body` 抬特异性覆盖；
   - 亮色 thumb `#a0a0a0`（hover `#8c8c8c`）/轨道 `#f1f1f1`，暗色按 dsh 自身的
     `body[data-ds-dark-theme]` 模式翻转（thumb `#969696`/轨道 `#202124`）；
   - 宽度 5px → 10px（`--dsh-scrollbar-width` 同时驱动 composer overlay 的滚动条
     让位偏移，随变量自适应）；
   - 2026-11-25 按用户要求收敛箭头按钮：四向 SVG 箭头只保留在会话滚动容器
     （`[data-conversation-scroll]` 作用域）上，其余滚动条（侧栏等）不再绘制；
   - 同日修复「底部 ▲▼ 两枚箭头叠排」：Chromium 对自定义滚动条按钮按老 Mac
     双按钮风格布局——decrement/increment 在顶、底两端各渲染一份。用
     `:start`/`:end` 隐藏错位副本（vertical end:decrement / start:increment、
     horizontal 同构），只留顶部 ▲ + 底部 ▼ 各一枚；底部 ▼ 按钮加高
     （11→16px）且三角上移（`background-position:center 3px`），箭头下方多留
     白、不贴页面底缘；
   - 同日把会话滚动条钉住页面最右缘：官方 ChatView root 右 padding 24px +
     scrollBody 自身 margin-right 2px，滚动条距页缘 26px，加
     `margin-right:-24px` 让滚动条贴住视口右缘（root/body overflow 可见、
     centerCol 右缘即视口右缘，无裁切）。

3. **输入框 80% 宽度居中**：`.card` 设 `width:80%`（InputBar 根节点本身
   `align-items:center` 自动居中），提示条与队列坞卡同步 80% 同轴。2026-11-24
   修复发送态宽度骤缩：按回车发送后 `machineBusy` 使输入面变
   `contenteditable="false"`，原 `:has([contenteditable="true"])` 锚失配 →
   输入卡回落官方 712px 上限、回合结束又弹回。现全部改锚官方恒定的稳定结构
   属性（输入卡 `[data-composer-card]`、输入面 `[data-composer-input]`，
   textarea 分支保留兜底），浏览/编辑/发送/hero 各态恒匹配。

4. **用户消息按 Markdown 渲染**
   - 官方只给 assistant 走 MarkdownText，用户气泡是纯文本投影；
   - 本插件经 keyed 插槽 `conversation.chat.node` 的 **priority 遮蔽**（ui-slots 契约：
     同 key 不同 priority 共存、最低优先级渲染）以 `priority: -10` 注册自定义渲染器，
     遮蔽官方 `UserMessageNodeView`（`user` 与 `steering` 两键）；
   - Markdown 渲染复用基线包 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`
     （GFM + TeX + 代码高亮，丢弃 raw HTML，与 assistant 同源安全模型）；
   - 气泡宽度占对话列 85%（官方原值 `min(content-width×0.702, 82%)` 太窄，此值有意
     偏离官方），附件视觉按官方 `MessageItem.module.css` 同值复刻，图片/文件卡行为一致；
   - 气泡悬停出现「复制」按钮（官方 MessageIconActions 无法跨 bundle 复用，此处补齐
     复制面；时间戳图标未保留）；
   - 渲染器崩溃经宿主 abdicate 机制自动退位回官方渲染器，不会白屏；
   - 提交回声与 pending steering 气泡仍由官方渲染（transient 节点，消息落定后即换
     本渲染器）。

5. **hero 工作区行左右缘对齐输入卡**（2026-11-10；0.3.x 起不再在设置面板暴露
   开关，功能默认保持开启）
   - `.wSkVaW_heroWorkspaceRow` 补与左缘同式的 `margin-right`，行右缘=输入卡右缘；
   - git 分支 / New worktree 复选（`.wSkVaW_heroOptions` 原生 `margin-left:auto`）
     随之落到对话框右上角，与左上的工作区/模式切换成对称布局。

6. **输入框历史消息导航**（2026-11-10，↑/↓ 召回已发送消息）
   - 在 `conversation.input.overlay`（list，session 作用域）注册 headless 控制器，
     session 条目自动收 `inputActions`（官方 `setDraft` 写草稿通道）、`useInput`、
     `useChat` 标准注入面，无任何私有 API；
   - 非浏览态仅当光标已在**首行**（DOM Range 几何对比）按 ↑ 才召回上一条已发送
     消息，多行文本的行间 ↑ 导航不受影响；
   - 浏览态内 ↑=更旧、↓=更新，↓ 越过最新一条 → 恢复进浏览态前缓存的未发送草稿
     并退出；Escape 同效；
   - 浏览态中任何编辑/发送（composer input 事件）静默退出，不留幽灵状态；
   - 历史源 = `useChat` 快照 `order → nodes` 过滤 `kind: user/steering` 按
     `data.seq` 排序，取 `type:'text'` 块拼接，相邻重复折叠；
   - 召回后光标置首（连按 ↑ 连续导航），↓/恢复后置末；IME 组合期（keyCode 229）
     与非 plain 相位不接管；
   - 监听为 document 捕获阶段单例，先于 Lexical 命令处理；组件异常由宿主
     SlotErrorBoundary/abdicate 兜底。

7. **嵌入设置页面**（0.3.x 新增，**默认开启**）
   - 官方设置页是 `createPortal` 到 body 的弹出模态对话框（overlay + 遮罩 +
     800px 居中面板）；开启后改为**嵌入内容区**的整页形态；
   - 实现为 JS 内联几何接管（不 reparent、不碰 React 内部）：面板挂载时把
     overlay 定位到内容区（`[data-conversation-content]` 所在
     `[class$="_centerCol"]` 主内容列）矩形上、面板铺满 100%、圆角/投影/遮罩
     清除；内容区尺寸变化经 `ResizeObserver` 跟随重算；
   - fenixd dashboard embed 等无外壳 frame 的形态自动回退锚定对话根节点本身；
   - 关闭开关 / 面板卸载 / 内容区缺席（安全降级）时清除全部内联样式，即时
     恢复官方模态；Escape 与 header 关闭钮恢复可用；
   - **与 fenix-dsh-settings-dock 的共存反制**（2026-11-25）：settings-dock 的
     样式表会无条件把面板停靠铺满内容区（含遮罩隐藏、关闭钮隐藏），使「关闭
     = 回退官方模态」形同虚设。本插件在关闭态注入 EMBED_OFF 反制样式表（特异
     性逐条压过 dock），按官方 `VOzbGW_*` 声明值还原弹出模态；dock 未装机时
     反制值 = 官方值，无副作用。dock 的停靠职责已被本开关完全覆盖，可卸载。

## 设置页独立开关（0.3.0 起）

### 设置页入口

打开 dsh web **设置页**，左侧分区导航在既有分区（账户/通用/模型/内置插件/登录）
之后出现**「Fenix 插件」**条目（带对话气泡图标），点击进入分区面板。面板按
DSH 语境**分组渲染，每个分组整体装在一张圆角卡片里**（主题变量着色，暗色由
宿主接管）：

- **Deepseek Harness UI调整** —— 本插件的 5 个功能行，每行含功能名、一句话说明
  与独立开关控件（复用宿主基线包 `Switch`，宿主升级致导出漂移时降级为同构
  自绘 toggle）；
- **Deepseek Harness 快捷登录** —— 检测到 `fenix-dsh-auth` 插件在装时，把其
  「登录」分区组件嵌入本面板渲染（组内直接可用，无需切分区；用户名/密码输入框
  横向 100% 宽度，与 fenix 配置页输入框一致——2026-11-25 起由 auth 插件自身
  去除 320px 限宽实现）；**auth 未安装时该分组整体不出现**。

### 功能行开关（0.3.x：5 行）

0.3.x 起面板不再暴露「滚动条样式」（`scrollbar`）与「hero 工作区行对齐」
（`hero-row`）两行——两项功能**默认保持开启**，且不再读取历史残留的关闭
override（视同开启，console 提示一次，残留键在下次开关写入时自然清除）；如需
恢复官方形态可手工写 localStorage 键（见持久化小节）。

| 功能行 | 开关 id | 关闭后的官方回退形态 |
| --- | --- | --- |
| 对话列留白 左14/右24 | `whitespace` | 官方 920px 居中布局恢复、列宽把手重新可见 |
| 输入框 80% 宽度居中 | `composer-width` | 官方宽度轴（952px 上限） |
| 用户消息 Markdown 渲染 | `markdown` | 官方等效纯文本投影气泡（附件/图片卡不变） |
| 输入框 ↑/↓ 历史导航 | `history-nav` | ↑/↓ 光标原生行为 |
| 嵌入设置页面 | `settings-embed` | 官方弹出模态对话框 |

任一开关切换**即时生效**（无需刷新页面）：关闭 = 该功能即时回退官方原生形态，
开启 = 恢复插件形态；其余功能互不影响。全部开关关闭 = 对话区呈现官方原生形态
（嵌入形态豁免除外）。

### 持久化与降级口径

- 开关状态持久化于 **localStorage** 键 `fenix-chat-polish.toggles`（JSON
  `{功能ID: false}`，**只记录关闭项**，缺省即开启，向前加功能免迁移）；
- 刷新页面 / 重开浏览器后状态保持（按浏览器持久化，不跨浏览器、不进宿主 settings）；
- 存储值**损坏**（非 JSON / 未知功能键 / true 值）→ 忽略损坏部分按全开处理，
  页面正常加载、无未处理异常；
- localStorage **不可用**（隐私模式 / 配额满）→ 开关降级为会话内生效，控制台仅留
  一条降级告警，刷新后回默认全开，无未处理异常。

### 插槽失配降级行为

设置分区经官方 keyed 插槽 `settings.section` / `settings.section.icon` 注册。
dsh 升级致槽契约漂移时：**仅设置分区菜单缺席**（console 留一条降级告警），各
功能的默认行为不受影响、不出现页面报错；此前经 localStorage 关闭的功能保持关闭
（开关 store 独立于分区 UI）。**嵌入形态**（fenixd dashboard embed，root 带
`.embeddedBody`）整体验免不受任何开关影响。

## 版本韧性（0.2.1 起）

留白覆盖选择器**不再钉扎构建哈希**。CSS-modules 类名 = 构建哈希前缀 + 语义后缀，
后缀（`_scroll`/`_column`/`_card`…）源自组件源码类名、跨版本稳定，因此 0.2.1 起
一律用**语义后缀匹配** `[class$="_suffix"]` + 结构锚点（`[data-conversation-scroll]`、
`:has(textarea)`）书写，dsh 升级不再静默失效：

| 语义后缀 | 来源组件（rc.1 实证） | 锚点保障 |
| --- | --- | --- |
| `_scroll` `_column` `_toBottomSlot` | ChatView | `[data-conversation-scroll]` 后代限定 |
| `_root` `_card` `_notice` `_dock` | InputBar/QueueDock | `:has(textarea)` 限定（构建内 composer 是唯一 textarea），card 限直接子级 |
| `_userStack` | MessageItem | 后缀全构建唯一；宽度变量钉回官方 fallback 748px，气泡不受全宽化影响 |
| `_composerHero` `_heroWorkspaceRow` `_embeddedBody` | ConversationRoot | 后缀全构建唯一 |

0.2.0 及之前按 rc.2 构建哈希钉扎（`EvIC1a`/`uV2eYG`/`_7yHdaG`/`wSkVaW` 前缀），
dsh 升级后哈希漂移 → 覆盖静默失效回官方布局（部署实证 2026-11-17：新装机 dsh
非 rc.1/rc.2 时会话回到 920px 居中）。若未来某规则因上游改名失效，仅该条覆盖
降级，其余不受影响；届时按新版构建产物的类映射核对语义后缀是否变化。

## 安装（web profile）

1. `/root/.dsh/profiles/web/package.json` 增加依赖：
   `"fenix-dsh-chat-polish": "link:/root/dsh-plugins/fenix-dsh-chat-polish"`
2. `node_modules/fenix-dsh-chat-polish` 建到插件目录的 symlink（同仓内其他插件）；
3. `/root/.dsh/profiles/web/cordis.patch.yml` 的 `insert:` 清单加入
   `{id: fenix-dsh-chat-polish, name: fenix-dsh-chat-polish}`
   （教训：`dsh plugin add` 不自动插清单，缺失则 loader 不实例化）；
4. `systemctl restart dsh-web.service`。

## 验证配方

```bash
# 宿主侧：日志无 "entry did not activate" 新增
grep -i "did not activate" /var/log/dsh-web.log | tail -1
# 浏览器侧（playwright）：
# - [data-width-handle] computed display == none
# - .EvIC1a_scroll computed padding-left == 14px (left) / 24px (right)
# - 输入卡宽度 == 消息列宽度
# - [data-chat-user-markdown] 节点内含 _markdown_* 类（MarkdownText 已挂载）
# - 设置分区：nav 含「Fenix 插件」条目；面板含「Deepseek Harness UI调整」分组
#   五行（auth 在装时另有「Deepseek Harness 快捷登录」分组），行内
#   [role="switch"][aria-checked] 与实际生效状态一致
# - 嵌入设置页面开启：设置面板 overlay 覆盖内容区（panel 100%×100%、无圆角/
#   投影/遮罩），关闭开关即时回弹官方 800px 居中模态（含遮罩与关闭钮——
#   settings-dock 在装时由 EMBED_OFF 反制样式表还原）
# - 发送态宽度：按回车发送后（输入面 contenteditable="false"）输入卡仍保持
#   80% 宽度不骤缩
# - markdown 关闭态：[data-chat-user-plain] 节点为纯文本气泡（无 MarkdownText）
```
