/**
 * fenix-dsh-chat-polish — Client 半（零构建，形态对齐 dsh-plugin-loopback-trust）。
 *
 * 做两件事（dsh 0.2.0-rc.2 实测约束，升级失配时各覆盖自动失效回官方布局）：
 *
 * 1. 对话列左右留白固定 24px。
 *    官方布局把消息列锁在 --dsh-chat-content-width（clamp(680, 64%, 920)）居中，
 *    .scroll 侧距再叠加 composer-side-clearance + 16px，宽屏两侧留白巨大。本插件
 *    用 ui-chat/ui-conversation 构建产物的哈希类（版本钉扎，取自安装包 client.js
 *    内的 CSS-modules 类映射）定向覆盖：
 *      - ChatView .scroll 侧距 32px → 24px；.column 解除 max-width 居中上限；
 *      - InputBar .root 侧距 16px → 24px、.card/.notice 解除 952px 上限（卡片
 *        宽度与消息列对齐到同一 24px 基线；hero 空会话栈铺满同一基线）；
 *      - QueueDock .dock 与输入卡同宽；
 *      - ConversationRoot 的列宽拖拽把手隐藏（固定留白后无拖拽空间，且防止
 *        拖拽把 px 偏好写进 localStorage 覆盖本方案）；
 *      - 「回到底部」浮钮右距对齐 24px。
 *    嵌入形态（fenixd dashboard embed，root 带 .embeddedBody）整体豁免，维持官方
 *    自身的宽度轴。选择器全部带 body:not(:has(...)) 前缀抬高特异性，不依赖注入
 *    顺序压过宿主样式。
 *
 * 2. 用户消息按 Markdown 渲染。
 *    官方 Chat 只给 assistant 走 MarkdownText，用户气泡走 projectUserText 纯文本
 *    投影。官方 keyed 插槽 conversation.chat.node 的遮蔽规则（ui-slots register
 *    契约）：同 key 不同 priority 的条目共存，cell 内最低优先级者渲染，默认 0，
 *    同优先级才报占用错误——本插件以 priority -10 注册 user/steering 两键的自定义
 *    渲染器遮蔽官方 UserMessageNodeView；组件崩溃经宿主 abdicate 机制自动退位回
 *    官方渲染器。Markdown 渲染复用基线模块表里的 @deepseek-ai/dsh-client-ui-primitives
 *    MarkdownText（GFM+TeX+代码高亮，丢弃 raw HTML，与宿主 assistant 同源），气泡
 *    视觉按官方 MessageItem.module.css 同值复刻，附件（图片/文件卡）行为一致。
 *    提交回声与 pending steering 气泡仍由官方渲染（transient 节点，落定后即换本
 *    渲染器）。
 *
 * 3. 输入框历史消息导航（↑ 召回上一条 / ↓ 切回，0.2.2-rc.1）。
 *    在 conversation.input.overlay（list，session 作用域）注册一个 headless
 *    控制器组件：session 条目自动收到 inputActions（SessionInputShell.actions，
 *    setDraft(text) 官方写草稿通道）、useInput（shell.state 快照）、useChat
 *    （CHAT bundle 提供的会话快照 {order,nodes}）与 sessionId。控制器挂
 *    document 捕获阶段 keydown/input 监听：
 *      - 非浏览态：仅当光标已在首行（DOM Range 几何对比）按 ↑ 才进入浏览态，
 *        多行文本的行间 ↑ 导航不受影响；
 *      - 浏览态内 ↑/↓ 独占（preventDefault+stopPropagation，先于 Lexical）；
 *        ↑=更旧、↓=更新，↓ 越过最新一条→恢复进浏览态前缓存的草稿并退出；
 *      - Escape 恢复草稿退出；浏览态中任何编辑/发送清空（composer input 事件）
 *        静默退出，不留幽灵状态；
 *      - 历史源 = useChat 快照 order→nodes 过滤 kind user/steering 按 data.seq
 *        排序，取 content 中 type:'text' 块拼接（与官方投影一致），相邻重复折叠；
 *      - 切走时未发送草稿缓存于控制器实例内存（session 作用域，随插槽卸载释放，
 *        多 composer 并存互不串扰），↓ 越过最新即切回；
 *        跨会话/刷新的草稿持久化由宿主 SessionInputShell 自身的 persistDraft
 *        机制负责，本层不重复。
 *    宿主崩溃路径：组件异常由 SlotErrorBoundary/abdicate 兜底，事件监听在
 *    dispose 移除。
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-chat-polish',
		factory(require) {
			var react = require('react')
			var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
			/* 基线导出同口径守卫：宿主升级致 primitives 导出漂移（改名/移除）时降级为
			 * 安全替身，不让 fileExtension() 等渲染期 TypeError 击穿整个遮蔽渲染器
			 * （与 renderMessageImages、useInput/useChat、附件 name/bytes 的显式守卫
			 * 同口径）。组件导出除函数外还有 memo/forwardRef 等带 $$typeof 标记的
			 * React 元素类型，一并认可 */
			function componentExport(value, fallback) {
				if (typeof value === 'function') return value
				if (value && typeof value.$$typeof === 'symbol') return value
				return fallback
			}
			var MarkdownText = componentExport(primitives.MarkdownText, function (props) {
				return react.createElement('span', null, typeof props.text === 'string' ? props.text : '')
			})
			var FileTypeIcon = componentExport(primitives.FileTypeIcon, function () { return null })
			/* 辅助函数漂移时降级为空扩展名/空尺寸文案（fileMeta filter(Boolean) 自然收敛） */
			var fileExtension = typeof primitives.fileExtension === 'function' ? primitives.fileExtension : function () { return '' }
			var fileSizeText = typeof primitives.fileSizeText === 'function' ? primitives.fileSizeText : function () { return '' }

			/* ── 样式 ─────────────────────────────────────────────────────────── */

			var POLISH_CSS = [
				/* 对话列留白固定 24px。选择器用 CSS-modules 语义后缀 [class$="_suffix"]
				 * （类名=构建哈希前缀+语义后缀，后缀跨版本稳定）+ 结构锚点
				 * （[data-conversation-scroll] / :has(textarea)），dsh 升级不再静默失效。
				 * 全宽变量挂 [class$="_column"]（唯一后缀），用户气泡经 _userStack 钉扎豁免。
				 * 注意：后缀匹配隐含「该类是 class 属性最后一个 token」——带变体修饰类的
				 * 元素（如 hero 根 "…_root …_hero"）会失配；此类元素一律用 [class*= 匹配
				 * 主体类 + :has() 收窄（0.2.2 修复，见下方 InputBar 段注释） */
				/* ChatView .scroll 侧距（clearance+16=32px）→ 24px */
				'body:not(:has([class$="_embeddedBody"])) [data-conversation-scroll] [class$="_scroll"]{padding-left:24px;padding-right:24px}',
				/* ChatView .column 解除 --dsh-chat-content-width 居中上限 */
				'body:not(:has([class$="_embeddedBody"])) [data-conversation-scroll] [class$="_column"]{max-width:none;--dsh-chat-content-width:calc(100cqw - 48px)}',
				/* 全宽变量随列下发（列=唯一后缀锚点）：md-table 对称出血公式、
				 * toBottomSlot 等消费方继承全宽值；不补的话 lead 按 748px 默认求值，
				 * margin-left:calc(-1*lead) 反转为正边距右推表格包装器 → 消息溢出链
				 * （overflow-x:visible 一路到列根）→ 对话框横向滚动条（2026-11-07
				 * 活站实证：wrapper 左缘 +130px、右缘 1070>940）。cqw 在消费元素处
				 * 解析，减 48px 侧距恰为实际列宽，随窗口宽度自适应 */
				/* 用户气泡宽度公式钉回官方 fallback（userStack 消费 var(…,748px)）——列宽变量全宽化后不得波及气泡 */
				'[data-conversation-scroll] [class$="_userStack"]{--dsh-chat-content-width:748px}',
				/* wide 表 margin 右推夹紧：上行走变量同步后 lead 仍会余出 24px 正
				 * margin（spare=(100cqw-内容宽)/2 的右出血项），把包装器相对正文
				 * 右移 24px——公式退化路径，非设计意图。min(0px,…) 只夹右推、保留
				 * 向左负 margin（真正出血场景）。双类抬特异性压过核心同选择器规则 */
				'[class$="_body"] .md-table-wide.md-table-wide{margin-left:min(0px, calc(-1 * var(--dsh-table-lead)))}',
				/* InputBar .root 侧距 16→24（bottom 4px 保持官方值）。
				 * 0.2.2: [class$= 换 [class*=——hero 变体根 class 属性是
				 * "uV2eYG_root uV2eYG_hero"（变体修饰类在后），不以 _root 结尾，
				 * 后缀匹配在新建会话页全体失配 → 卡片回落官方 952px 与行错位
				 * （2026-11-17 用户报障）。contains 匹配对 token 顺序免疫；
				 * 误伤由 :has(textarea)/:has(editable) 收窄兜底（全文档实测仅
				 * 命中 wSkVaW_root 与 uV2eYG_root[_hero] 两元素，弹层根不含编辑器） */
				'body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has(textarea),body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has([contenteditable="true"]){padding-left:24px;padding-right:24px}',
				/* 输入卡 80% 宽度居中（根节点 align-items:center 自动居中），提示条/队列坞卡同轴 */
				'body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has(textarea)>[class$="_card"],body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has([contenteditable="true"])>[class$="_card"]{width:80%;max-width:none}',
				'body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has(textarea) [class$="_notice"],body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has([contenteditable="true"]) [class$="_notice"]{width:80%;max-width:none}',
				'body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has(textarea) [class$="_dock"],body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has([contenteditable="true"]) [class$="_dock"]{width:80%}',
				/* hero（空会话）栈铺满，卡片经上方 24px 侧距落到同一基线。
				 * width:auto 是 fit-content——hero 栈缩成标题行自然宽（~368px）
				 * 「中间一小块」（2026-11-05 用户实证）；width:100% 才是铺满，
				 * 内层输入卡 80% 与会话中态同轴 */
				'body:not(:has([class$="_embeddedBody"])) [class$="_composerHero"]{width:100%}',
				/* hero 工作区/模式行与输入卡两缘对齐（2026-11-05 左缘对齐；2026-11-10
				 * 右缘对齐：git 分支/worktree 复选经 .wSkVaW_heroOptions margin-left:auto
				 * 贴行右缘，行右缘=卡片右缘后该控件组落到对话框右上角，与左上的工作区/
				 * 模式下拉成对称布局）。行原生贴 hero 左右缘（padding 0 16 0 20），铺满
				 * 后与 80% 居中的卡片脱轴——用卡片同款公式取对称 margin：卡片列 = root
				 * 24px 侧距内 80% 居中，行左/右缘 = 24 + (100%-48)*0.1（改卡片侧距/
				 * 宽度百分比须同步本式） */
				'body:not(:has([class$="_embeddedBody"])) [class$="_heroWorkspaceRow"]{margin-left:calc(24px + (100% - 48px)*0.1);margin-right:calc(24px + (100% - 48px)*0.1);padding:0}',
				/* 固定留白后无拖拽空间：隐藏列宽把手（防拖拽写入 localStorage 宽度偏好） */
				'body:not(:has([class$="_embeddedBody"])) [data-width-handle][data-width-handle]{display:none}',
				/* 「回到底部」浮钮右距对齐 24px */
				'body:not(:has([class$="_embeddedBody"])) [data-conversation-scroll] [class$="_toBottomSlot"]{padding-right:24px}',
				/* 滚动条对齐 dashboard（浏览器默认观感；宽度收至 10px、thumb 加深至
				 * #a0a0a0，并补出 dsh 未定义的上下/左右箭头按钮——定义了 ::-webkit-scrollbar
				 * 系列后按钮不再由 UA 自动出现，需显式绘制。暗色按 dsh 自身的
				 * body[data-ds-dark-theme] 模式翻转；html body/html * 前缀抬特异性） */
				'html body{--dsh-scrollbar-width:10px;--dsh-scrollbar-thumb:#a0a0a0;--dsh-scrollbar-thumb-hover:#8c8c8c}',
				'html ::-webkit-scrollbar-track{background:#f1f1f1}',
				'html ::-webkit-scrollbar-button{width:10px;height:11px;background-color:#f1f1f1;background-repeat:no-repeat;background-position:center}',
				"html ::-webkit-scrollbar-button:vertical:decrement{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 5 4 0 8 5Z' fill='%23757575'/%3E%3C/svg%3E\")}",
				"html ::-webkit-scrollbar-button:vertical:increment{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0 4 5 8 0Z' fill='%23757575'/%3E%3C/svg%3E\")}",
				"html ::-webkit-scrollbar-button:horizontal:decrement{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='5' height='8'%3E%3Cpath d='M5 0 0 4 5 8Z' fill='%23757575'/%3E%3C/svg%3E\")}",
				"html ::-webkit-scrollbar-button:horizontal:increment{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='5' height='8'%3E%3Cpath d='M0 0 5 4 0 8Z' fill='%23757575'/%3E%3C/svg%3E\")}",
				'html body[data-ds-dark-theme]{--dsh-scrollbar-thumb:#969696;--dsh-scrollbar-thumb-hover:#a6a6a6}',
				'html body[data-ds-dark-theme] ::-webkit-scrollbar-track{background:#202124}',
				'html body[data-ds-dark-theme] ::-webkit-scrollbar-button{background-color:#202124}',
				"html body[data-ds-dark-theme] ::-webkit-scrollbar-button:vertical:decrement{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 5 4 0 8 5Z' fill='%23a8a8a8'/%3E%3C/svg%3E\")}",
				"html body[data-ds-dark-theme] ::-webkit-scrollbar-button:vertical:increment{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0 4 5 8 0Z' fill='%23a8a8a8'/%3E%3C/svg%3E\")}",
			].join('\n')

			/* 用户消息视图：按官方 MessageItem.module.css 同值复刻气泡与附件视觉 */
			var VIEW_CSS = [
				'.fdxchat-userRow{display:flex;flex-direction:column;align-items:flex-end;gap:6px}',
				'.fdxchat-userStack{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:85%}',
				'.fdxchat-bubble{max-width:100%;background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);padding:10px 16px;font-size:var(--dsh-content-font-size, 14px);line-height:calc(22px + var(--dsh-content-font-delta, 0px));color:var(--dsw-alias-label-primary);word-break:break-word}',
				/* MarkdownText 自带排版；在气泡内放开块级宽度，避免 shrink-to-fit 抖动 */
				'.fdxchat-bubble .fdxchat-markdown{min-width:0}',
				'.fdxchat-attachmentRow{display:flex;flex-wrap:wrap;justify-content:flex-end;max-width:100%;gap:8px}',
				'.fdxchat-fileCard{display:inline-flex;flex:0 0 240px;align-items:center;gap:10px;width:240px;min-height:64px;padding:8px 12px;border:0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major, transparent);box-sizing:border-box}',
				'.fdxchat-fileIcon{flex:none;width:28px;height:28px}',
				'.fdxchat-fileContent{display:flex;flex:1;flex-direction:column;min-width:0}',
				'.fdxchat-fileName{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}',
				'.fdxchat-fileMeta{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45));font-size:12px;line-height:15px}',
				'.fdxchat-referenceSummary{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary, 13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary, 0px))}',
				'.fdxchat-extra{margin:0;max-width:100%;overflow:auto;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
				'.fdxchat-copy{align-self:flex-end;padding:2px 10px;border:none;border-radius:100px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer;visibility:hidden}',
				'.fdxchat-userRow:hover .fdxchat-copy,.fdxchat-copy:focus-visible,.fdxchat-copy.is-copied{visibility:visible}',
				'.fdxchat-copy:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			].join('\n')

			/* ── MarkdownText 标签（模块级稳定身份；组件表按 identity 记忆化）── */
			var LABELS = {
				code: {
					copyLabel: '复制',
					copiedLabel: '已复制',
					toolbarLabels: { codeLabel: '代码', wrapLabel: '自动换行', unwrapLabel: '不换行' },
				},
				footnotes: '脚注',
			}

			/* ── content 块拆分（镜像官方 MessageItem.contentParts）── */
			function contentParts(content) {
				var texts = []
				var attachments = []
				var rest = []
				if (Array.isArray(content)) {
					for (var i = 0; i < content.length; i++) {
						var block = content[i] || {}
						if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
						else if (block.type === 'image' && block.attachment && typeof block.attachment === 'object') attachments.push({ type: 'image', image: { attachment: block.attachment } })
						else if (block.type === 'file' && block.attachment && typeof block.attachment === 'object') attachments.push({ type: 'file', file: block.attachment })
						else rest.push(block)
					}
				}
				return { text: texts.join(''), attachments: attachments, rest: rest }
			}

			function safeJson(block) {
				try {
					var s = JSON.stringify(block)
					return s.length > 2000 ? s.slice(0, 2000) + '…' : s
				} catch (err) {
					return String(block)
				}
			}

			function copyText(text, done) {
				var fallback = function () {
					try {
						var box = document.createElement('textarea')
						box.value = text
						box.style.position = 'fixed'
						box.style.opacity = '0'
						document.body.appendChild(box)
						box.select()
						var copied = document.execCommand('copy')
						document.body.removeChild(box)
						done(copied === true)
					} catch (err) {
						done(false)
					}
				}
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text).then(function () { done(true) }, fallback)
				} else {
					fallback()
				}
			}

			/* ── 复制按钮（补回官方 MessageIconActions 在被遮蔽气泡下的复制面）── */
			var CopyButton = function (props) {
				var state = react.useState(false)
				var copied = state[0]
				var setCopied = state[1]
				var timer = react.useRef(null)
				react.useEffect(function () {
					return function () {
						if (timer.current !== null) window.clearTimeout(timer.current)
					}
				}, [])
				var onClick = function () {
					copyText(props.text, function (ok) {
						if (ok !== true) return /* 复制失败不误报「已复制」 */
						setCopied(true)
						if (timer.current !== null) window.clearTimeout(timer.current)
						timer.current = window.setTimeout(function () { setCopied(false) }, 1500)
					})
				}
				return react.createElement(
					'button',
					{
						type: 'button',
						className: 'fdxchat-copy' + (copied ? ' is-copied' : ''),
						onClick: onClick,
					},
					copied ? '已复制' : '复制',
				)
			}

			/* ── 用户消息 Markdown 渲染器（遮蔽官方 UserMessageNodeView）── */
			var MarkdownUserView = react.memo(function MarkdownUserView(props) {
				var node = props.node
				var data = (node && node.data) || {}
				var parts = contentParts(data.content)
				var showBubble = parts.text !== '' || parts.rest.length > 0
				var compactImages = parts.attachments.length > 1
				/* 形态守卫：referenceLabels 漂移出非数组真值（字符串/对象）时降级为空数组，
				 * 防止下方 join('、') 抛 TypeError 击穿整个遮蔽渲染器（宿主 abdicate 整体
				 * 退位回官方纯文本），与附件 name/bytes、useInput/useChat 的显式守卫同口径 */
				var referenceLabels = Array.isArray(data.referenceLabels) ? data.referenceLabels : []

				var children = []
				if (parts.attachments.length > 0) {
					children.push(
						react.createElement(
							'div',
							{ className: 'fdxchat-attachmentRow', key: 'attachments', 'data-message-attachments': '' },
							parts.attachments.map(function (attachment, index) {
								if (attachment.type === 'image') {
									/* 宿主注入面缺失时降级跳过图片渲染，与 useInput/useChat 同口径守卫 */
									if (typeof props.renderMessageImages !== 'function') return null
									return react.createElement(react.Fragment, { key: 'image:' + index },
										props.renderMessageImages({ images: [attachment.image], align: 'end', compact: compactImages }))
								}
								var file = attachment.file || {}
								/* 形状守卫：name/bytes 字段漂移时降级占位渲染，不让单条畸形附件在渲染期
								 * 抛 TypeError 击穿整个遮蔽渲染器（宿主 abdicate 整体退位回官方纯文本），
								 * 与 useInput/useChat、chat 快照、renderMessageImages 的显式守卫同口径 */
								var fileName = typeof file.name === 'string' ? file.name : '未命名文件'
								var fileMeta = [
									fileExtension(fileName).toUpperCase().slice(0, 8),
									typeof file.bytes === 'number' ? fileSizeText(file.bytes) : '',
								].filter(Boolean).join(' ')
								return react.createElement(
									'span',
									{ key: 'file:' + index, className: 'fdxchat-fileCard', title: fileName },
									react.createElement(FileTypeIcon, { path: fileName, className: 'fdxchat-fileIcon' }),
									react.createElement(
										'span',
										{ className: 'fdxchat-fileContent' },
										react.createElement('span', { className: 'fdxchat-fileName' }, fileName),
										react.createElement('span', { className: 'fdxchat-fileMeta' }, fileMeta),
									),
								)
							}),
						),
					)
				}
				if (showBubble) {
					children.push(
						react.createElement(
							'div',
							{ className: 'fdxchat-bubble', key: 'bubble' },
							react.createElement('div', { className: 'fdxchat-markdown' },
								react.createElement(MarkdownText, { text: parts.text, labels: LABELS })),
						),
					)
				}
				for (var r = 0; r < parts.rest.length; r++) {
					children.push(react.createElement('pre', { className: 'fdxchat-extra', key: 'rest:' + r }, safeJson(parts.rest[r])))
				}
				if (referenceLabels.length > 0) {
					children.push(react.createElement('div', { className: 'fdxchat-referenceSummary', key: 'references' }, referenceLabels.join('、')))
				}
				/* 纯附件/无文本消息不追加复制按钮：避免悬停可点复制空串并误报「已复制」 */
				if (parts.text !== '') {
					children.push(react.createElement(CopyButton, { text: parts.text, key: 'copy' }))
				}

				return react.createElement(
					'div',
					{ className: 'fdxchat-userRow', 'data-chat-user-markdown': '' },
					react.createElement('div', { className: 'fdxchat-userStack' }, children),
				)
			})

			/* ═══ 输入框历史消息导航（feature 3）══════════════════════════════════ */

		/* 当前挂载的控制器引用：全局捕获监听的路由目标（控制器挂载时登记）；
		 * 浏览态光标与缓存草稿等会话状态收在各控制器实例 ref 内，不在此共享。
		 * owner 是单指针，多 composer 短暂并存（会话切换过渡期双挂载）时后挂载者
		 * 覆盖先挂载者，按键路由以 owner.anchorRef 锚元素与事件目标 editorEl 的
		 * 共同 InputBar 根（[class*="_root"]，与 POLISH_CSS 输入卡锚点同源）判定
		 * 归属，不匹配不接管——历史文本不会写进别的 composer 草稿 */
		var historyState = { owner: null }
		/* 浏览态光标（每控制器一份，随 session 作用域插槽自然隔离，多 composer 并存
		 * 不串扰）：pos = 从最新一条往回的步数（1=最新）；savedDraft = 进浏览态前的草稿 */
		function freshNav() {
			return { browsing: false, pos: 0, savedDraft: null }
		}
		/* setDraft 触发 composer input 事件时抑制“编辑即退出”判定 */
		var applying = false
		/* applying 闸门按双 rAF 复位，只是“setDraft 回声必在两帧内到达”的时序近似；
		 * 掉帧/并发调度下回声可能晚于窗口到达，被 onHistoryInput 误判为用户编辑而
		 * 静默退出并清空 savedDraft（真实数据丢失）。另记最近一次召回目标文本作
		 * 确定性判据：input 事件时编辑器文本仍与召回目标一致 → 视为 setDraft 回声
		 * 忽略，不依赖帧调度时序 */
		var lastRecall = { text: null }

		/* 回声比对：剥掉尾部换行（Lexical 对末段落补合成换行）后全文比对 */
		function recallEcho(editorEl, text) {
			if (typeof text !== 'string') return false
			var live = ''
			try { live = editorEl.innerText || '' } catch (err) { return false }
			var strip = function (s) { return typeof s === 'string' ? s.replace(/\n+$/, '') : '' }
			return strip(live) === strip(text)
		}

		/* chat 快照 → 按时间升序的已发送文本数组（user/steering，相邻重复折叠） */
		function extractUserTexts(chat) {
			var items = []
			if (!chat || !chat.order || !chat.nodes || typeof chat.nodes.get !== 'function') return []
			for (var i = 0; i < chat.order.length; i++) {
				var node
				try { node = chat.nodes.get(chat.order[i]) } catch (err) { node = null }
				if (!node) continue
				var kind = node.kind
				if (kind !== 'user' && kind !== 'steering') continue
				var data = node.data || {}
				var text = textOfContent(data.content)
				if (text === '') continue
				/* data.seq 为权威时序；缺 seq 的节点按 order 次序垫底 */
				items.push({
					seq: typeof data.seq === 'number' ? data.seq : 1e9 + i,
					text: text,
				})
			}
			items.sort(function (a, b) { return a.seq - b.seq })
			var out = []
			for (var j = 0; j < items.length; j++) {
				if (out.length > 0 && out[out.length - 1] === items[j].text) continue
				out.push(items[j].text)
			}
			return out
		}

		function textOfContent(content) {
			if (!Array.isArray(content)) return ''
			var texts = []
			for (var i = 0; i < content.length; i++) {
				var block = content[i] || {}
				if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
			}
			return texts.join('')
		}

		/* ── 光标行几何（DOM Range，不碰 Lexical 内部）── */

		/* 折叠选区的可视行 top；边界无字形矩形时按前字符/容器矩形近似 */
		function caretRectTop(range) {
			var rects = range.getClientRects()
			if (rects.length > 0) return rects[0].top
			var node = range.startContainer
			var offset = range.startOffset
			try {
				if (node.nodeType === 3 && offset > 0) {
					var probe = document.createRange()
					probe.setStart(node, offset - 1)
					probe.setEnd(node, offset)
					var rs = probe.getClientRects()
					if (rs.length > 0) return rs[rs.length - 1].top
				}
				if (node.nodeType === 1) {
					var probe2 = document.createRange()
					probe2.selectNodeContents(node)
					var rc = probe2.getClientRects()
					if (rc.length > 0) return range.startOffset === 0 ? rc[0].top : rc[rc.length - 1].top
					var box = node.getBoundingClientRect()
					if (box && (box.height > 0 || box.width > 0)) return box.top
				}
			} catch (err) { /* fallthrough */ }
			return null
		}

		/* 编辑器全部内容的首行 top（过滤零尺寸矩形） */
		function firstContentTop(editorEl) {
			try {
				var range = document.createRange()
				range.selectNodeContents(editorEl)
				var rects = range.getClientRects()
				for (var i = 0; i < rects.length; i++) {
					if (rects[i].height > 0 || rects[i].width > 0) return rects[i].top
				}
			} catch (err) { /* fallthrough */ }
			return null
		}

		function atFirstLine(editorEl) {
			var sel = window.getSelection()
			if (!sel || sel.rangeCount === 0) return true
			var range = sel.getRangeAt(0)
			if (!range.collapsed) return false
			var caretTop = caretRectTop(range)
			if (caretTop === null) return true
			var contentTop = firstContentTop(editorEl)
			if (contentTop === null) return true
			return Math.abs(caretTop - contentTop) < 8
		}

		/* 召回后的光标落位：↑ 置首（保证连按 ↑ 连续导航），↓/恢复置末 */
		function placeCaretAtEdge(editorEl, atStart) {
			try {
				editorEl.focus()
				var sel = window.getSelection()
				if (!sel) return
				var range = document.createRange()
				range.selectNodeContents(editorEl)
				range.collapse(atStart === true)
				sel.removeAllRanges()
				sel.addRange(range)
			} catch (err) { /* 光标落位失败不影响文本 */ }
		}

		function applyRecall(owner, editorEl, text, dir) {
			applying = true
			lastRecall.text = typeof text === 'string' ? text : null
			try {
				var actions = owner.actionsRef.current
				if (actions && typeof actions.setDraft === 'function') actions.setDraft(text)
			} finally {
				window.requestAnimationFrame(function () {
					window.requestAnimationFrame(function () {
						placeCaretAtEdge(editorEl, dir === 'up')
						applying = false
					})
				})
			}
		}

		function exitBrowsing(nav, keepSaved) {
			nav.browsing = false
			nav.pos = 0
			if (keepSaved !== true) nav.savedDraft = null
		}

		/* 按键归属校验：事件目标编辑器须与 owner 锚元素共处同一 InputBar 根
		 * （[class*="_root"]）。锚不可用（未挂载/已断开/根找不到）时按不归属处理——
		 * 宁可放行默认行为，也不把历史导航套到别的控制器上 */
		function ownedEditor(editorEl, owner) {
			var anchorRef = owner.anchorRef
			var anchorEl = anchorRef && anchorRef.current
			if (!anchorEl || !anchorEl.isConnected) return false
			var ownerRoot = anchorEl.closest('[class*="_root"]')
			if (!ownerRoot) return false
			return ownerRoot === editorEl.closest('[class*="_root"]')
		}

		/* document 捕获阶段 keydown：先于 Lexical 命令处理 */
		function onHistoryKeydown(e) {
			var nav = null
			try {
				if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Escape') return
				if (e.isComposing || e.keyCode === 229) return
				var target = e.target
				if (!(target instanceof Element)) return
				var editorEl = target.closest('[data-composer-input]')
				if (!editorEl || editorEl.dataset.phase !== 'plain') return
				var owner = historyState.owner
				if (!owner) return
				if (!ownedEditor(editorEl, owner)) return /* 事件目标不是 owner 的编辑器：放行 */
				nav = owner.nav

				if (e.key === 'Escape') {
					if (!nav.browsing) return
					var restore = nav.savedDraft
					exitBrowsing(nav)
					applyRecall(owner, editorEl, restore || '', 'down')
					e.preventDefault()
					e.stopPropagation()
					return
				}

				var actions = owner.actionsRef.current
				if (!actions || typeof actions.setDraft !== 'function') return
				var hist = extractUserTexts(owner.chatRef.current)

				if (!nav.browsing) {
					if (e.key !== 'ArrowUp') return /* 草稿态 ↓ 是原生光标移动 */
					if (!atFirstLine(editorEl)) return /* 多行：行间导航，不接管 */
					if (hist.length === 0) return
					var live = owner.draftRef.current
					nav.savedDraft = typeof live === 'string' ? live : (editorEl.innerText || '')
					nav.browsing = true
					nav.pos = 1
					applyRecall(owner, editorEl, hist[hist.length - 1], 'up')
					e.preventDefault()
					e.stopPropagation()
					return
				}

				/* 浏览态：↑/↓ 独占 */
				if (e.key === 'ArrowUp') {
					if (nav.pos >= hist.length) { e.preventDefault(); e.stopPropagation(); return } /* 已最旧 */
					nav.pos += 1
					applyRecall(owner, editorEl, hist[hist.length - nav.pos], 'up')
				} else {
					if (nav.pos <= 1) {
						/* 越过最新 → 恢复草稿并退出浏览态 */
						var draft = nav.savedDraft
						exitBrowsing(nav)
						applyRecall(owner, editorEl, draft || '', 'down')
					} else {
						nav.pos -= 1
						/* 列表可能在浏览期间缩短（会话快照更新），夹回上界防负索引 */
						if (nav.pos > hist.length) nav.pos = hist.length
						var item = hist[hist.length - nav.pos]
						applyRecall(owner, editorEl, typeof item === 'string' ? item : '', 'down')
					}
				}
				e.preventDefault()
				e.stopPropagation()
			} catch (err) {
				if (nav) exitBrowsing(nav)
			}
		}

		/* composer 编辑（键入/粘贴/发送清空）→ 静默退出浏览态；setDraft 自身触发的
		 * input 用 applying 闸门豁免，晚于窗口到达的回声再以「文本仍等于召回目标」
		 * 确定性判据兜底豁免 */
		function onHistoryInput(e) {
			try {
				if (applying) return
				var target = e.target
				if (!(target instanceof Element)) return
				var editorEl = target.closest('[data-composer-input]')
				if (!editorEl) return
				var owner = historyState.owner
				if (!owner || !owner.nav.browsing) return
				if (lastRecall.text !== null && recallEcho(editorEl, lastRecall.text)) return
				exitBrowsing(owner.nav)
			} catch (err) { /* never */ }
		}

		/* 历史导航控制器：session 作用域插槽自动注入 inputActions/useInput/useChat；
		 * 另渲染一个 display:none 锚元素（纯 headless 拿不到任何宿主 DOM，无从做
		 * 按键事件的实例归属判定），锚不生成盒子、不占布局与 flex gap，仅供
		 * ownedEditor 做共同根比对 */
		var HistoryController = function HistoryController(props) {
			var input = typeof props.useInput === 'function' ? props.useInput(function (s) { return s }) : null
			var chat = typeof props.useChat === 'function' ? props.useChat(function (s) { return s }) : null

			var anchorRef = react.useRef(null)
			var refs = react.useRef(null)
			if (refs.current === null) {
				refs.current = {
					actionsRef: { current: null },
					chatRef: { current: null },
					draftRef: { current: '' },
					nav: freshNav(),
					anchorRef: anchorRef,
				}
			}
			refs.current.actionsRef.current = props.inputActions || null
			refs.current.chatRef.current = chat
			refs.current.draftRef.current = input && typeof input.draft === 'string' ? input.draft : ''

			react.useEffect(function () {
				var api = refs.current
				historyState.owner = api
				return function () {
					/* 浏览态已随实例隔离：无论是否仍是 owner 都退出本人浏览态；
					 * owner 指针仅在仍是本人时清空，避免误清新挂载的控制器 */
					exitBrowsing(api.nav)
					if (historyState.owner === api) historyState.owner = null
				}
			}, [])
			return react.createElement('span', {
				ref: anchorRef,
				'data-fdxchat-history-anchor': '',
				style: { display: 'none' },
			})
		}

		/* ── 插件体：样式注入 + keyed 插槽遮蔽注册 ── */
			return {
				inject: ['slots'],
				apply(ctx) {
					var failures = []
					var stage = function (name, err) {
						var detail = err && err.stack ? err.stack : String(err)
						console.warn('[fenix-dsh-chat-polish] activation stage "' + name + '" rejected: ' + detail)
						failures.push(name)
					}

					/* 样式：插件自持生命周期（官方 client bundle 同款 data-plugin-css 约定） */
					var styleTag = document.createElement('style')
					styleTag.dataset.plugin = 'fenix-dsh-chat-polish'
					styleTag.dataset.pluginCss = 'fenix-dsh-chat-polish/polish.css'
					styleTag.textContent = POLISH_CSS + '\n' + VIEW_CSS
					document.head.appendChild(styleTag)

					/* keyed 遮蔽：priority -10 < 官方 0，cell 内最低优先级者渲染；
					 * inject 对未声明 slot 不生效不崩（官方 ui-renderer 契约），崩溃时
					 * 宿主 abdicate 机制自动退位回官方渲染器。 */
					try {
						ctx.slots.inject('conversation.chat.node', function () {
							return ctx.slots.register(
								{ name: 'conversation.chat.node', key: 'user', priority: -10 },
								MarkdownUserView,
							)
						})
					} catch (err) {
						stage('slots.inject user', err)
					}
					try {
						ctx.slots.inject('conversation.chat.node', function () {
							return ctx.slots.register(
								{ name: 'conversation.chat.node', key: 'steering', priority: -10 },
								MarkdownUserView,
							)
						})
					} catch (err) {
						stage('slots.inject steering', err)
					}

					/* feature 3：输入框历史导航。headless 控制器挂 conversation.input.overlay
					 * （list，session 作用域——InputBar 卡片内 div[data-composer-overlay]，仅
					 * sessionId 存在时渲染），session 条目自动收 inputActions/useInput/useChat
					 * 标准注入面；全局捕获监听只挂一份。 */
					try {
						ctx.slots.inject('conversation.input.overlay', function () {
							return ctx.slots.register(
								{ name: 'conversation.input.overlay', id: 'fenix-history-nav', order: -100 },
								HistoryController,
							)
						})
					} catch (err) {
						stage('slots.inject history', err)
					}
					document.addEventListener('keydown', onHistoryKeydown, true)
					document.addEventListener('input', onHistoryInput, true)

					return function dispose() {
						document.removeEventListener('keydown', onHistoryKeydown, true)
						document.removeEventListener('input', onHistoryInput, true)
						var removed = styleTag.parentNode !== null
						if (removed) styleTag.remove()
						/* 返回值口径对齐兄弟插件 fenix-dsh-brand-fenix（其 dispose 注释明示语义
						 * 为「清理是否实际执行」，failures 仅为激活期状态）：本插件只以本地资源
						 * 清理是否实际执行（style 标签摘除；监听器按同参 removeEventListener 恒
						 * 成功）为返回值，激活期 failures 不参与判定 */
						return removed
					}
				},
			}
		},
	})
})()
