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
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-chat-polish',
		factory(require) {
			var react = require('react')
			var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
			var MarkdownText = primitives.MarkdownText
			var FileTypeIcon = primitives.FileTypeIcon
			var fileExtension = primitives.fileExtension
			var fileSizeText = primitives.fileSizeText

			/* ── 样式 ─────────────────────────────────────────────────────────── */

			var POLISH_CSS = [
				/* 对话列留白固定 24px（哈希类按 0.2.0-rc.2；升级失配自动失效回官方布局） */
				/* ChatView .scroll 侧距（clearance+16=32px）→ 24px */
				'body:not(:has(.wSkVaW_embeddedBody)) [data-conversation-scroll] .EvIC1a_scroll{padding-left:24px;padding-right:24px}',
				/* ChatView .column 解除 --dsh-chat-content-width 居中上限 */
				'body:not(:has(.wSkVaW_embeddedBody)) [data-conversation-scroll] .EvIC1a_column{max-width:none}',
				/* InputBar .root 侧距 16→24（bottom 4px 保持官方值） */
				'body:not(:has(.wSkVaW_embeddedBody)) .uV2eYG_root{padding-left:24px;padding-right:24px}',
				/* 输入卡 80% 宽度居中（根节点 align-items:center 自动居中），提示条/队列坞卡同轴 */
				'body:not(:has(.wSkVaW_embeddedBody)) .uV2eYG_card{width:80%;max-width:none}',
				'body:not(:has(.wSkVaW_embeddedBody)) .uV2eYG_notice{width:80%;max-width:none}',
				'body:not(:has(.wSkVaW_embeddedBody)) ._7yHdaG_dock{width:80%}',
				/* hero（空会话）栈铺满，卡片经上方 24px 侧距落到同一基线。
				 * width:auto 是 fit-content——hero 栈缩成标题行自然宽（~368px）
				 * 「中间一小块」（2026-11-05 用户实证）；width:100% 才是铺满，
				 * 内层输入卡 80% 与会话中态同轴 */
				'body:not(:has(.wSkVaW_embeddedBody)) .wSkVaW_composerHero{width:100%}',
				/* 固定留白后无拖拽空间：隐藏列宽把手（防拖拽写入 localStorage 宽度偏好） */
				'body:not(:has(.wSkVaW_embeddedBody)) [data-width-handle][data-width-handle]{display:none}',
				/* 「回到底部」浮钮右距对齐 24px */
				'[data-conversation-scroll] .EvIC1a_toBottomSlot{padding-right:24px}',
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
						else if (block.type === 'image' && block.attachment !== undefined) attachments.push({ type: 'image', image: { attachment: block.attachment } })
						else if (block.type === 'file' && block.attachment !== undefined) attachments.push({ type: 'file', file: block.attachment })
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
						document.execCommand('copy')
						document.body.removeChild(box)
						done(true)
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
					copyText(props.text, function () {
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
				var referenceLabels = data.referenceLabels || []

				var children = []
				if (parts.attachments.length > 0) {
					children.push(
						react.createElement(
							'div',
							{ className: 'fdxchat-attachmentRow', key: 'attachments', 'data-message-attachments': '' },
							parts.attachments.map(function (attachment, index) {
								if (attachment.type === 'image') {
									return react.createElement(react.Fragment, { key: 'image:' + index },
										props.renderMessageImages({ images: [attachment.image], align: 'end', compact: compactImages }))
								}
								return react.createElement(
									'span',
									{ key: 'file:' + index, className: 'fdxchat-fileCard', title: attachment.file.name },
									react.createElement(FileTypeIcon, { path: attachment.file.name, className: 'fdxchat-fileIcon' }),
									react.createElement(
										'span',
										{ className: 'fdxchat-fileContent' },
										react.createElement('span', { className: 'fdxchat-fileName' }, attachment.file.name),
										react.createElement(
											'span',
											{ className: 'fdxchat-fileMeta' },
											[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
												.filter(Boolean).join(' '),
										),
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
				children.push(react.createElement(CopyButton, { text: parts.text, key: 'copy' }))

				return react.createElement(
					'div',
					{ className: 'fdxchat-userRow', 'data-chat-user-markdown': '' },
					react.createElement('div', { className: 'fdxchat-userStack' }, children),
				)
			})

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
						ctx.slots.inject('conversation.chat.node', function () {
							return ctx.slots.register(
								{ name: 'conversation.chat.node', key: 'steering', priority: -10 },
								MarkdownUserView,
							)
						})
					} catch (err) {
						stage('slots.inject', err)
					}

					return function dispose() {
						var removed = styleTag.parentNode !== null
						if (removed) styleTag.remove()
						return removed && failures.length === 0
					}
				},
			}
		},
	})
})()
