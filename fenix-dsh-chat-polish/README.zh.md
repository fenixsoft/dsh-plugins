# fenix-dsh-chat-polish

dsh web 对话区打磨插件（纯 client 半，零构建，先例 `dsh-plugin-loopback-trust`）。

## 功能

1. **对话列左右留白固定 24px**
   - 官方布局把消息列锁在 `--dsh-chat-content-width`（最大 920px）居中，宽屏两侧留白巨大；
   - 覆盖后：消息列与输入卡对齐铺满，两侧各留 24px；
   - 列宽拖拽把手隐藏（固定留白后无拖拽空间，且防止拖拽写入 localStorage 宽度偏好）；
   - 「回到底部」浮钮同步对齐；
   - **嵌入形态豁免**：fenixd dashboard 嵌入（root 带 `.embeddedBody`）不受影响。

2. **滚动条对齐 dashboard 观感**（0.2.0-rc.2 的 dsh 自绘滚动条太淡太细且无箭头）
   - dsh 滚动条全走 body 级变量（`--dsh-scrollbar-thumb/width`），`html body` 抬特异性覆盖；
   - 亮色 thumb `#a0a0a0`（hover `#8c8c8c`）/轨道 `#f1f1f1`，暗色按 dsh 自身的
     `body[data-ds-dark-theme]` 模式翻转（thumb `#969696`/轨道 `#202124`）；
   - 宽度 5px → 10px（`--dsh-scrollbar-width` 同时驱动 composer overlay 的滚动条
     让位偏移，随变量自适应）；
   - 补出四向箭头按钮：定义 `::-webkit-scrollbar` 系列后 UA 不再自动绘制 button，
     需显式给出 `::-webkit-scrollbar-button` 规则（SVG 三角箭头 data URI），否则
     箭头消失。

3. **输入框 80% 宽度居中**：`.card` 设 `width:80%`（InputBar 根节点本身
   `align-items:center` 自动居中），提示条与队列坞卡同步 80% 同轴。

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

5. **hero 工作区行左右缘对齐输入卡**（2026-11-10）
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

## 版本钉扎与升级

留白覆盖使用 dsh 0.2.0-rc.2 构建产物的 CSS-modules 哈希类（取自安装包
`lib/client.js` 内的类映射）：

| 前缀 | 来源包 | 用到的类 |
| --- | --- | --- |
| `EvIC1a` | `dsh-client-ui-chat` (ChatView) | `scroll` `column` `toBottomSlot` |
| `uV2eYG` | `dsh-client-ui-conversation` (InputBar) | `root` `card` `notice` |
| `_7yHdaG` | `dsh-client-ui-conversation` (QueueDock) | `dock` |
| `wSkVaW` | `dsh-client-ui-conversation` (ConversationRoot) | `composerHero` `embeddedBody` `widthHandle` |

dsh 升级后哈希变化 → 覆盖静默失效（回官方布局，不会坏页面）。届时从新版本安装包
`lib/client.js` 的 `ChatView_module_css_default` / `QueueDock_module_css_default` /
`ConversationRoot_module_css_default` 类映射重新提取前缀即可；用户消息 Markdown
渲染不依赖哈希类，升级不受影响。

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
# - .EvIC1a_scroll computed padding-left == 24px
# - 输入卡宽度 == 消息列宽度
# - [data-chat-user-markdown] 节点内含 _markdown_* 类（MarkdownText 已挂载）
```
