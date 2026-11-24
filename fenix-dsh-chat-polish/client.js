/**
 * fenix-dsh-chat-polish — Client 半（零构建，形态对齐 dsh-plugin-loopback-trust）。
 *
 * Fenix 插件打磨功能（dsh 0.2.0-rc.2 实测约束，升级失配时各覆盖自动失效回官方布局），
 * 0.3.0 起每项功能在官方设置页「Fenix 插件设置」分区内带独立开关（默认全开 = 与
 * 0.2.2 无开关形态一致；关闭 = 该功能即时回退官方原生形态，无需刷新页面）：
 *
 * 1. 对话列左右留白固定 24px（开关 whitespace）。
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
 *      - 0.3.x 宽度锚定修复：官方在 agent 运行期把输入面 contenteditable 置
 *        false（machineBusy → editable=false，DOM 结构不换树），0.3.0 的
 *        :has([contenteditable="true"]) 匹配在发送后失配 → 卡片从 80% 骤缩回
 *        官方 712px。改锚官方稳定结构属性 data-composer-input / data-composer-card
 *        （值恒定，全安装包唯一），发送中/hero inert 态均恒匹配。
 *    嵌入形态（fenixd dashboard embed，root 带 .embeddedBody）整体豁免，维持官方
 *    自身的宽度轴。选择器全部带 body:not(:has(...)) 前缀抬高特异性，不依赖注入
 *    顺序压过宿主样式。
 *
 * 2. 用户消息按 Markdown 渲染（开关 markdown）。
 *    官方 Chat 只给 assistant 走 MarkdownText，用户气泡走 projectUserText 纯文本
 *    投影。官方 keyed 插槽 conversation.chat.node 的遮蔽规则（ui-slots register
 *    契约）：同 key 不同 priority 的条目共存，cell 内最低优先级者渲染，默认 0，
 *    同优先级才报占用错误——本插件以 priority -10 注册 user/steering 两键的自定义
 *    渲染器遮蔽官方 UserMessageNodeView；组件崩溃经宿主 abdicate 机制自动退位回
 *    官方渲染器。Markdown 渲染复用基线模块表里的 @deepseek-ai/dsh-client-ui-primitives
 *    MarkdownText（GFM+TeX+代码高亮，丢弃 raw HTML，与宿主 assistant 同源），气泡
 *    视觉按官方 MessageItem.module.css 同值复刻，附件（图片/文件卡）行为一致。
 *    提交回声与 pending steering 气泡仍由官方渲染（transient 节点，落定后即换本
 *    渲染器）。开关关闭时遮蔽渲染器保留（插槽注册常驻，见 D3），内部改走官方
 *    等效纯文本投影分支：同一气泡结构、text 纯文本、附件/图片卡行为不变，仅
 *    不挂 MarkdownText 与复制按钮。
 *
 * 3. 输入框历史消息导航（↑ 召回上一条 / ↓ 切回，0.2.2-rc.1；开关 history-nav）。
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
 *    dispose 移除。开关关闭时控制器与 document 捕获监听保持挂载（插槽注册
 *    常驻），事件处理器入口读开关状态直接放行（不接管、不 preventDefault）。
 *
 * 4. 设置分区开关（0.3.0）。
 *    经官方 keyed 插槽 settings.section / settings.section.icon 注册「Fenix 插件设置」
 *    分区（先例 fenix-dsh-auth「登录」分区的同构写法：order 经 ctx.slots.entries
 *    尾随探测、失败回退 FALLBACK_MAX_ORDER、逐槽 try/catch 失配仅 console.warn
 *    菜单缺席）。分区面板渲染各功能行（功能名 + 一句话说明 + 开关控件，控件
 *    复用基线包 primitives Switch），点击开关写模块级开关 store 即时生效。
 *    开关状态持久化于 localStorage 键 fenix-chat-polish.toggles（JSON
 *    {功能ID: bool}，只记录关闭项，缺省即开启）；读取容错（损坏/未知键忽略按
 *    开启）、写入失败（隐私模式/配额）降级为会话内生效 + console.warn 一次。
 *    开关 store 独立于分区 UI：菜单缺席（宿主升级失配）时持久化键仍生效。
 *    样式注入为单标签按「开启集合」重建：开关切换在 store.set 内同步重写样式
 *    标签 textContent（先改样式后通知订阅者），样式即时性不依赖 React 重渲。
 *
 * 5. 嵌入设置页面（0.3.x，开关 settings-embed，默认开启）。
 *    官方设置面板经 createPortal 挂 document.body 弹出为居中模态（overlay fixed
 *    inset:0 + 遮罩 + 800×800 圆角阴影面板）。开启后由 MutationObserver 捕获面板
 *    挂载，纯内联样式把 overlay 几何改写为内容区（dsh-client-ui-layout AppFrame
 *    centerCol，锚 [data-conversation-content] 向上 closest [class$="_centerCol"]）
 *    矩形：panel 铺满、去圆角/阴影，mask 隐藏——观感为嵌入内容区的页面而非弹窗。
 *    不 reparent、不碰 React 树；ResizeObserver 跟随内容区尺寸（侧栏折叠/窗口
 *    缩放）重算；关闭面板/关开关/dispose 清内联恢复官方模态。锚点缺席（会话区
 *    未挂载、dashboard embed 无 frame）时安全降级，本次保持官方模态。
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
			/* 设置分区控件：优先复用宿主基线包现成 Switch（role="switch" + aria-checked，
			 * 与官方分区观感一致）；漂移缺失时降级为自绘 toggle（D4，对齐官方视觉变量）。
			 * 图标同理漂移降级为 null（菜单条目无图标但不缺席） */
			var HostSwitch = componentExport(primitives.Switch, null)
			var SectionIconGlyph = componentExport(primitives.IconNewChatOutlineMedium, null)

			/* ── 样式（0.3.0 起按功能分块，注入串 = 开启块拼接） ──────────────── */

			/* 分块映射（design D2，按视觉归属）：同一功能的多条规则同进同出，
			 * 不产生半开状态。块内顺序保持 0.2.2 数组原相对顺序；块间拼接顺序
			 * 为 whitespace → composer-width → hero-row → scrollbar → markdown，
			 * 与 0.2.2 的原始数组顺序不同，但全部规则为原文逐字搬运、集合相同，
			 * 且各规则选择器互不重叠、无同特异性 cascade 竞争，注入串等效。
			 * history-nav 无 CSS（纯行为功能） */

			/* 对话列留白固定 24px。选择器用 CSS-modules 语义后缀 [class$="_suffix"]
			 * （类名=构建哈希前缀+语义后缀，后缀跨版本稳定）+ 结构锚点
			 * （[data-conversation-scroll] / :has(textarea)），dsh 升级不再静默失效。
			 * 全宽变量挂 [class$="_column"]（唯一后缀），用户气泡经 _userStack 钉扎豁免。
			 * 注意：后缀匹配隐含「该类是 class 属性最后一个 token」——带变体修饰类的
			 * 元素（如 hero 根 "…_root …_hero"）会失配；此类元素一律用 [class*= 匹配
			 * 主体类 + :has() 收窄（0.2.2 修复，见下方 InputBar 段注释） */
			var CSS_BLOCKS = {
				whitespace: [
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
					 * 向左负 margin（真正出血场景）。双类抬特异性压过核心同选择器规则。
					 * 嵌入形态不豁免（有意）：官方 lead 正常（负出血）时 min(0px,…) 恒
					 * 等不生效，仅退化回退时把横向溢出挡在 embed 容器外，与「维持官方
					 * 自身宽度轴」的豁免目标不冲突 */
					'[class$="_body"] .md-table-wide.md-table-wide{margin-left:min(0px, calc(-1 * var(--dsh-table-lead)))}',
					/* InputBar .root 侧距 16→24（bottom 4px 保持官方值）。
					 * 0.2.2: [class$= 换 [class*=——hero 变体根 class 属性是
					 * "uV2eYG_root uV2eYG_hero"（变体修饰类在后），不以 _root 结尾，
					 * 后缀匹配在新建会话页全体失配 → 卡片回落官方 952px 与行错位
					 * （2026-11-17 用户报障）。contains 匹配对 token 顺序免疫；
					 * 误伤由 :has() 收窄兜底（全文档实测仅命中 wSkVaW_root 与
					 * uV2eYG_root[_hero] 两元素，弹层根不含编辑器）。
					 * 0.3.x: 收窄锚改 [data-composer-input]（官方稳定结构属性）——
					 * agent 运行期官方把 contenteditable 置 false（DOM 不换树），
					 * 旧 :has([contenteditable="true"]) 在发送后失配 → 侧距回落
					 * 16px。textarea 分支保留作老版本兜底 */
					'body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has(textarea),body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has([data-composer-input]){padding-left:24px;padding-right:24px}',
					/* hero（空会话）栈铺满，卡片经上方 24px 侧距落到同一基线。
					 * width:auto 是 fit-content——hero 栈缩成标题行自然宽（~368px）
					 * 「中间一小块」（2026-11-05 用户实证）；width:100% 才是铺满，
					 * 内层输入卡 80% 与会话中态同轴 */
					'body:not(:has([class$="_embeddedBody"])) [class$="_composerHero"]{width:100%}',
					/* 固定留白后无拖拽空间：隐藏列宽把手（防拖拽写入 localStorage 宽度偏好） */
					'body:not(:has([class$="_embeddedBody"])) [data-width-handle][data-width-handle]{display:none}',
					/* 「回到底部」浮钮右距对齐 24px */
					'body:not(:has([class$="_embeddedBody"])) [data-conversation-scroll] [class$="_toBottomSlot"]{padding-right:24px}',
				].join('\n'),
				/* 输入卡/提示条/队列坞 80% 宽度居中（根节点 align-items:center 自动居中），
				 * 与消息列同轴。依赖 whitespace 的 24px 侧距基线但样式自持。
				 * 0.3.x 锚定修复：卡片直接锚官方稳定结构属性 [data-composer-card]
				 * （InputBar 卡片专有，值恒定不随 agent 运行态变化），彻底摆脱
				 * :has([contenteditable="true"]) 的运行态失配——发送后 editable=false
				 * 时旧选择器失配，卡片从 80% 骤缩回官方 712px、回合结束又弹宽。
				 * notice/dock 无专属属性，经 [data-composer-input]（contenteditable
				 * 输入面恒带）收窄，同理全态恒匹配 */
				'composer-width': [
					'body:not(:has([class$="_embeddedBody"])) [data-composer-card]{width:80%;max-width:none}',
					'body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has([data-composer-input]) [class$="_notice"]{width:80%;max-width:none}',
					'body:not(:has([class$="_embeddedBody"])) [class*="_root"]:has([data-composer-input]) [class$="_dock"]{width:80%}',
				].join('\n'),
				/* hero 工作区/模式行与输入卡两缘对齐（2026-11-05 左缘对齐；2026-11-10
				 * 右缘对齐：git 分支/worktree 复选经 .wSkVaW_heroOptions margin-left:auto
				 * 贴行右缘，行右缘=卡片右缘后该控件组落到对话框右上角，与左上的工作区/
				 * 模式下拉成对称布局）。行原生贴 hero 左右缘（padding 0 16 0 20），铺满
				 * 后与 80% 居中的卡片脱轴——用卡片同款公式取对称 margin：卡片列 = root
				 * 24px 侧距内 80% 居中，行左/右缘 = 24 + (100%-48)*0.1（改卡片侧距/
				 * 宽度百分比须同步本式） */
				'hero-row': [
					'body:not(:has([class$="_embeddedBody"])) [class$="_heroWorkspaceRow"]{margin-left:calc(24px + (100% - 48px)*0.1);margin-right:calc(24px + (100% - 48px)*0.1);padding:0}',
				].join('\n'),
				/* 滚动条对齐 dashboard（浏览器默认观感；宽度收至 10px、thumb 加深至
				 * #a0a0a0，并补出 dsh 未定义的上下/左右箭头按钮——定义了 ::-webkit-scrollbar
				 * 系列后按钮不再由 UA 自动出现，需显式绘制。暗色按 dsh 自身的
				 * body[data-ds-dark-theme] 模式翻转；html body/html * 前缀抬特异性） */
				scrollbar: [
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
				].join('\n'),
			}

			/* 用户消息气泡视觉单源表（0.3.0）：className 与内联 style 同值同源——
			 * markdown 开启时视觉由样式表类承载（规则文本由本表生成）；关闭态样式表
			 * 随 markdown 块整体移除，气泡/附件改用内联 style 复刻同一份值（design
			 * D3「官方等效纯文本投影分支：同一气泡结构」，单源保证两态视觉永不漂移）。
			 * 值一律字符串（数字无单位歧义交给显式文本），属性序 = 0.2.2 原文序 */
			var BUBBLE_VISUALS = {
				userRow: { cls: 'fdxchat-userRow', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' } },
				userStack: { cls: 'fdxchat-userStack', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', minWidth: '0', maxWidth: '85%' } },
				bubble: { cls: 'fdxchat-bubble', style: { maxWidth: '100%', background: 'var(--dsw-specific-bubble)', borderRadius: 'var(--dsw-radius-xl)', padding: '10px 16px', fontSize: 'var(--dsh-content-font-size, 14px)', lineHeight: 'calc(22px + var(--dsh-content-font-delta, 0px))', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word' } },
				attachmentRow: { cls: 'fdxchat-attachmentRow', style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%', gap: '8px' } },
				fileCard: { cls: 'fdxchat-fileCard', style: { display: 'inline-flex', flex: '0 0 240px', alignItems: 'center', gap: '10px', width: '240px', minHeight: '64px', padding: '8px 12px', border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))', borderRadius: 'var(--dsw-radius-xl)', background: 'var(--dsw-specific-input-major, transparent)', boxSizing: 'border-box' } },
				fileIcon: { cls: 'fdxchat-fileIcon', style: { flex: 'none', width: '28px', height: '28px' } },
				fileContent: { cls: 'fdxchat-fileContent', style: { display: 'flex', flex: '1', flexDirection: 'column', minWidth: '0' } },
				fileName: { cls: 'fdxchat-fileName', style: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'var(--dsw-alias-label-primary)', fontSize: '14px', fontWeight: '500', lineHeight: '22px' } },
				fileMeta: { cls: 'fdxchat-fileMeta', style: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45))', fontSize: '12px', lineHeight: '15px' } },
				referenceSummary: { cls: 'fdxchat-referenceSummary', style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', lineHeight: 'calc(18px + var(--dsh-content-font-delta-secondary, 0px))' } },
				extra: { cls: 'fdxchat-extra', style: { margin: '0', maxWidth: '100%', overflow: 'auto', padding: '8px 10px', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '18px' } },
			}
			function camelToKebab(name) {
				return name.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase() })
			}
			function cssDeclarations(style) {
				var names = Object.keys(style)
				var parts = []
				for (var i = 0; i < names.length; i++) parts.push(camelToKebab(names[i]) + ':' + style[names[i]])
				return parts.join(';')
			}
			/* 基础视觉规则生成（输出与 0.2.2 的 VIEW_CSS 基础段逐字一致） */
			function bubbleCss() {
				var keys = Object.keys(BUBBLE_VISUALS)
				var rules = []
				for (var i = 0; i < keys.length; i++) {
					var v = BUBBLE_VISUALS[keys[i]]
					rules.push('.' + v.cls + '{' + cssDeclarations(v.style) + '}')
				}
				return rules.join('\n')
			}
			/* Markdown 排版与复制按钮专属（关闭态不挂对应元素，规则随块移除） */
			var MARKDOWN_TAIL_CSS = [
				/* MarkdownText 自带排版；在气泡内放开块级宽度，避免 shrink-to-fit 抖动 */
				'.fdxchat-bubble .fdxchat-markdown{min-width:0}',
				'.fdxchat-copy{align-self:flex-end;padding:2px 10px;border:none;border-radius:100px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer;visibility:hidden}',
				'.fdxchat-userRow:hover .fdxchat-copy,.fdxchat-copy:focus-visible,.fdxchat-copy.is-copied{visibility:visible}',
				'.fdxchat-copy:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			].join('\n')
			/* markdown 块 = 气泡/附件基础视觉（单源生成）+ Markdown/复制按钮专属 */
			var MARKDOWN_CSS = bubbleCss() + '\n' + MARKDOWN_TAIL_CSS

			/* ── 开关 store（模块级单例，design D1）────────────────────────── */

			var STORAGE_KEY = 'fenix-chat-polish.toggles'
			var FEATURE_IDS = ['whitespace', 'scrollbar', 'composer-width', 'markdown', 'hero-row', 'history-nav', 'settings-embed']
			/* 有 CSS 分块的功能 id（cssText 拼接顺序） */
			var CSS_BLOCK_IDS = ['whitespace', 'composer-width', 'hero-row', 'scrollbar', 'markdown']

			var toggleStore = (function () {
				/* 只记录非默认（关闭）项：缺省即开启，向前加功能免迁移。
				 * 未知 featureId / true 值 / 损坏 JSON / 存储不可用 → 忽略按开启 */
				var overrides = readOverrides()
				var listeners = []
				var styleTag = null
				var storageWarned = false

				function readOverrides() {
					try {
						var raw = window.localStorage.getItem(STORAGE_KEY)
						if (typeof raw !== 'string' || raw === '') return {}
						var parsed = JSON.parse(raw)
						if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
						var result = {}
						for (var i = 0; i < FEATURE_IDS.length; i++) {
							if (parsed[FEATURE_IDS[i]] === false) result[FEATURE_IDS[i]] = false
						}
						return result
					} catch (err) {
						/* JSON.parse 失败 / localStorage 访问抛异常（隐私模式）→ 全开 */
						return {}
					}
				}

				function isEnabled(id) {
					return overrides[id] !== false
				}

				/* 快照缓存：useSyncExternalStore 要求 getSnapshot 在状态未变时返回
				 * 稳定引用（每次返回新对象会被 React 判为状态变化 → 无限重渲 →
				 * Maximum update depth exceeded，真机实证 React error #185）。
				 * overrides 变化（set）时置空缓存，下次 snapshot 重建 */
				var cachedSnapshot = null
				function snapshot() {
					if (!cachedSnapshot) {
						var state = {}
						for (var i = 0; i < FEATURE_IDS.length; i++) state[FEATURE_IDS[i]] = isEnabled(FEATURE_IDS[i])
						cachedSnapshot = state
					}
					return cachedSnapshot
				}

				/* 按开启集合重建注入串（D2：单标签内容重建，标签与 data-plugin-css
				 * 约定不变，dispose 语义不变） */
				function cssText(enabled) {
					var state = enabled || snapshot()
					var chunks = []
					for (var i = 0; i < CSS_BLOCK_IDS.length; i++) {
						var id = CSS_BLOCK_IDS[i]
						if (state[id] !== false) chunks.push(id === 'markdown' ? MARKDOWN_CSS : CSS_BLOCKS[id])
					}
					return chunks.join('\n')
				}

				/* set 内同步重写样式标签（先改样式后通知，样式即时性不依赖 React 重渲） */
				function syncStyle() {
					if (styleTag) styleTag.textContent = cssText()
				}

				function persist() {
					try {
						var ids = Object.keys(overrides)
						if (ids.length === 0) {
							window.localStorage.removeItem(STORAGE_KEY)
						} else {
							var payload = {}
							for (var i = 0; i < ids.length; i++) payload[ids[i]] = false
							window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
						}
					} catch (err) {
						/* 写失败（隐私模式/配额）→ 仅内存生效，console.warn 一次降级告警，
						 * 不抛未处理异常 */
						if (!storageWarned) {
							storageWarned = true
							console.warn('[fenix-dsh-chat-polish] toggle persistence unavailable, keeping in-session only: ' + (err && err.message ? err.message : err))
						}
					}
				}

				function set(id, value) {
					if (FEATURE_IDS.indexOf(id) === -1) return
					var next = value !== false
					if (isEnabled(id) === next) return
					if (next) delete overrides[id]
					else overrides[id] = false
					cachedSnapshot = null
					syncStyle()
					persist()
					for (var i = 0; i < listeners.length; i++) {
						try { listeners[i]() } catch (err) { /* 订阅者异常不阻断其余通知 */ }
					}
				}

				function subscribe(fn) {
					if (typeof fn !== 'function') return function () {}
					listeners.push(fn)
					return function () {
						var idx = listeners.indexOf(fn)
						if (idx >= 0) listeners.splice(idx, 1)
					}
				}

				return {
					get: isEnabled,
					snapshot: snapshot,
					set: set,
					subscribe: subscribe,
					cssText: cssText,
					/* apply 时绑定样式标签并按当前状态重写一次（幂等）；dispose 摘除
					 * 标签后 detach，防悬空引用 */
					attachStyleTag: function (tag) { styleTag = tag; syncStyle() },
					detachStyleTag: function () { styleTag = null },
				}
			})()

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
				var mounted = react.useRef(true)
				react.useEffect(function () {
					return function () {
						mounted.current = false
						if (timer.current !== null) window.clearTimeout(timer.current)
					}
				}, [])
				var onClick = function () {
					copyText(props.text, function (ok) {
						/* 复制失败不误报「已复制」；卸载后在途回调（clipboard promise
						 * resolve）不再 setState */
						if (ok !== true || mounted.current !== true) return
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

			/* markdown 开关订阅（真机实证修复）：本组件是 memo 组件、props（node）
			 * 在既有消息上不变——仅「渲染期读一次 store」时，开关切换后既有消息节点
			 * 不重渲，气泡停留在 className 形态而样式表规则已被移除（裸奔）。订阅
			 * store 让已挂载实例随开关即时切换投影形态（「既有与后续消息即时回退」
			 * 的 SPEC 语义）。布尔原始值作 getSnapshot 天然引用稳定 */
			var useMarkdownEnabled = typeof react.useSyncExternalStore === 'function'
				? function () {
					return react.useSyncExternalStore(toggleStore.subscribe, function () {
						return toggleStore.get('markdown') !== false
					})
				}
				: function () {
					var state = react.useState(toggleStore.get('markdown') !== false)
					var setState = state[1]
					react.useEffect(function () {
						return toggleStore.subscribe(function () { setState(toggleStore.get('markdown') !== false) })
					}, [])
					return state[0]
				}

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
				/* 开关分流（design D3）：markdown 关闭 → 官方等效纯文本投影分支（同一
				 * 气泡结构、text 纯文本、附件/图片卡行为不变，仅不挂 MarkdownText 与
				 * 复制按钮）；开启 → 现行 Markdown 渲染。经 useMarkdownEnabled 订阅，
				 * 既有与后续消息节点随开关即时切换（不依赖 props 变化） */
				var markdownOn = useMarkdownEnabled()
				/* 视觉承载：开启态走样式表类（MARKDOWN_CSS 规则），关闭态样式表随块
				 * 移除、改内联 style 复刻同一份值（BUBBLE_VISUALS 单源，两态不漂移） */
				function visProps(key, extra) {
					var v = BUBBLE_VISUALS[key]
					var base = markdownOn ? { className: v.cls } : { style: v.style }
					if (extra) {
						var names = Object.keys(extra)
						for (var i = 0; i < names.length; i++) base[names[i]] = extra[names[i]]
					}
					return base
				}

				var children = []
				if (parts.attachments.length > 0) {
					children.push(
						react.createElement(
							'div',
							visProps('attachmentRow', { key: 'attachments', 'data-message-attachments': '' }),
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
									visProps('fileCard', { key: 'file:' + index, title: fileName }),
									react.createElement(FileTypeIcon, markdownOn
										? { path: fileName, className: 'fdxchat-fileIcon' }
										: { path: fileName, style: BUBBLE_VISUALS.fileIcon.style }),
									react.createElement(
										'span',
										visProps('fileContent'),
										react.createElement('span', visProps('fileName'), fileName),
										react.createElement('span', visProps('fileMeta'), fileMeta),
									),
								)
							}),
						),
					)
				}
				if (showBubble) {
					/* 气泡内层：开启态挂 MarkdownText（.fdxchat-markdown 排版包装）；
					 * 关闭态官方等效纯文本投影——text 直接作为气泡 children（React
					 * 安全转义），不挂 MarkdownText */
					var bubbleInner = markdownOn
						? react.createElement('div', { className: 'fdxchat-markdown' },
							react.createElement(MarkdownText, { text: parts.text, labels: LABELS }))
						: parts.text
					children.push(
						react.createElement(
							'div',
							visProps('bubble', { key: 'bubble' }),
							bubbleInner,
						),
					)
				}
				for (var r = 0; r < parts.rest.length; r++) {
					children.push(react.createElement('pre', visProps('extra', { key: 'rest:' + r }), safeJson(parts.rest[r])))
				}
				if (referenceLabels.length > 0) {
					children.push(react.createElement('div', visProps('referenceSummary', { key: 'references' }), referenceLabels.join('、')))
				}
				/* 纯附件/无文本消息不追加复制按钮：避免悬停可点复制空串并误报「已复制」；
				 * 关闭态纯文本投影亦不挂复制按钮（design D3） */
				if (markdownOn && parts.text !== '') {
					children.push(react.createElement(CopyButton, { text: parts.text, key: 'copy' }))
				}

				return react.createElement(
					'div',
					visProps('userRow', markdownOn
						? { 'data-chat-user-markdown': '' }
						: { 'data-chat-user-plain': '' }),
					react.createElement('div', visProps('userStack'), children),
				)
			})

			/* ═══ 输入框历史消息导航（feature 3）══════════════════════════════════ */

			/* 当前挂载的控制器引用：全局捕获监听的路由目标（控制器挂载时登记）；
			 * 浏览态光标与缓存草稿等会话状态收在各控制器实例 ref 内，不在此共享。
			 * owner 是单指针，多 composer 短暂并存（会话切换过渡期双挂载）时后挂载者
			 * 覆盖先挂载者，按键路由以 owner.anchorRef 锚元素与事件目标 editorEl 的
			 * 共同 InputBar 根（[class*="_root"]，与 CSS_BLOCKS 输入卡锚点同源）判定
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
				/* 测量失败不再一律按「首行」放行召回：仅空草稿放行（空编辑器召回
				 * 依赖此口），其余失败路径（无选区/光标矩形取不到/首行锚点取不到）
				 * 一律不接管——多行草稿在异常渲染态按 ↑ 宁可走官方行间导航，也不
				 * 误入历史浏览态 */
				var empty = (editorEl.textContent || '').length === 0
				var contentTop = firstContentTop(editorEl)
				if (contentTop === null) return empty
				var sel = window.getSelection()
				if (!sel || sel.rangeCount === 0) return empty
				var range = sel.getRangeAt(0)
				if (!range.collapsed) return false
				var caretTop = caretRectTop(range)
				if (caretTop === null) return false
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

			/* document 捕获阶段 keydown：先于 Lexical 命令处理。
			 * history-nav 关闭 → 处理器入口直接放行（不接管、不 preventDefault），
			 * 控制器与监听保持挂载（design D3，关闭态开销为一次布尔读） */
			function onHistoryKeydown(e) {
				var nav = null
				try {
					if (toggleStore.get('history-nav') !== true) return
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
			 * 确定性判据兜底豁免。history-nav 关闭 → 入口直接放行 */
			function onHistoryInput(e) {
				try {
					if (toggleStore.get('history-nav') !== true) return
					if (applying) return
					var target = e.target
					if (!(target instanceof Element)) return
					var editorEl = target.closest('[data-composer-input]')
					if (!editorEl) return
					var owner = historyState.owner
					if (!owner || !owner.nav.browsing) return
					if (!ownedEditor(editorEl, owner)) return /* 事件目标不是 owner 的编辑器：放行 */
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

			/* ═══ 嵌入设置页面（0.3.x，开关 settings-embed）══════════════════════ */

			/* 官方设置面板经 createPortal 挂 document.body：overlay（fixed inset:0
			 * z-index:1000 flex 居中）> [_mask（点击关闭）+ _panel（稳定属性
			 * data-shortcut-modal="settings"，全安装包唯一）。本功能把 overlay 几何
			 * 内联改写为内容区矩形——不 reparent、不碰 React 树，纯内联样式覆盖官方
			 * 类样式：overlay: position:fixed + top/left/width/height=rect（right/bottom
			 * 置 auto 抵消官方 inset:0 的过约束）；panel: 100%×100%、去圆角/阴影，
			 * 且 position 置 static 内联认领——内联是唯一稳压样式表的层叠来源，
			 * 不认领 position 时任何针对面板的样式表 fixed 定位（实证：共存插件
			 * fenix-dsh-settings-dock 的 `position:fixed; left:侧栏宽`，2026-11-24
			 * 真机返工：面板 left=280px + 内联 width:100%vw 过约束 → 右缘出屏
			 * 280px）都会把面板拽出 overlay 文档流，嵌入几何整体失效；static 下面板
			 * 回归 overlay 常规流内子元素，left/top/right/bottom 对 static 不生效，
			 * 无需逐项抵消；mask: display:none（点击遮罩关闭退场；关闭走面板右上角
			 * 关闭钮与 Esc）。ResizeObserver 跟随内容区尺寸（侧栏折叠/窗口缩放）
			 * 重算矩形；面板卸载/开关关闭/dispose 清内联恢复官方模态。 */
			var embedState = { overlay: null, panel: null, mask: null, anchor: null, ro: null, roAnchor: null }
			var EMBED_OVERLAY_PROPS = ['position', 'top', 'left', 'right', 'bottom', 'width', 'height']
			var EMBED_PANEL_PROPS = ['position', 'width', 'height', 'maxWidth', 'borderRadius', 'boxShadow']

			function clearInline(el, props) {
				for (var i = 0; i < props.length; i++) el.style.removeProperty(camelToKebab(props[i]))
			}
			function restoreEmbed() {
				if (embedState.ro) {
					embedState.ro.disconnect()
					embedState.ro = null
				}
				embedState.roAnchor = null
				if (!embedState.overlay) return
				clearInline(embedState.overlay, EMBED_OVERLAY_PROPS)
				if (embedState.panel) clearInline(embedState.panel, EMBED_PANEL_PROPS)
				if (embedState.mask) embedState.mask.style.removeProperty('display')
				embedState.overlay = null
				embedState.panel = null
				embedState.mask = null
				embedState.anchor = null
			}

			/* 内容区锚解析：会话根 [data-conversation-content] 向上 closest
			 * [class$="_centerCol"]（dsh-client-ui-layout AppFrame 主内容列，grid-area
			 * 1/2）。无 frame（dashboard embed 无 shell frame）退回会话根本身；均缺席
			 * （会话区未挂载）返回 null → 本次保持官方模态。选择器漂移经 closest 失配
			 * 自然降级，不抛错 */
			function contentAnchor() {
				var content = document.querySelector('[data-conversation-content]')
				if (!content) return null
				var col = content.closest ? content.closest('[class$="_centerCol"]') : null
				return col || content
			}

			function applyEmbedGeometry(overlay, panel, mask, anchor) {
				var rect = anchor.getBoundingClientRect()
				var os = overlay.style
				os.position = 'fixed'
				os.top = rect.top + 'px'
				os.left = rect.left + 'px'
				os.right = 'auto'
				os.bottom = 'auto'
				os.width = rect.width + 'px'
				os.height = rect.height + 'px'
				var ps = panel.style
				ps.position = 'static'
				ps.width = '100%'
				ps.height = '100%'
				ps.maxWidth = 'none'
				ps.borderRadius = '0'
				ps.boxShadow = 'none'
				if (mask && mask !== panel) mask.style.display = 'none'
			}

			function syncEmbedGeometry() {
				if (!embedState.overlay || !embedState.anchor || !toggleStore.get('settings-embed')) return
				if (!embedState.overlay.isConnected) {
					restoreEmbed()
					return
				}
				applyEmbedGeometry(embedState.overlay, embedState.panel, embedState.mask, embedState.anchor)
			}

			function observeEmbedAnchor(anchor) {
				if (embedState.ro && embedState.roAnchor === anchor) return
				if (embedState.ro) {
					embedState.ro.disconnect()
					embedState.ro = null
				}
				embedState.roAnchor = null
				/* ResizeObserver 缺失降级：仅挂载时定位一次，后续尺寸变化不跟随 */
				if (typeof ResizeObserver !== 'function') return
				var ro = new ResizeObserver(syncEmbedGeometry)
				ro.observe(anchor)
				embedState.ro = ro
				embedState.roAnchor = anchor
			}

			/* 全量同步：面板挂载/卸载（MO 回调）与开关切换（store 订阅）共用入口。
			 * 无面板或开关关闭 → restore；面板在 → 解析锚点并应用/跟随几何 */
			function syncEmbed() {
				if (!toggleStore.get('settings-embed')) {
					restoreEmbed()
					return
				}
				var panel = document.querySelector('[data-shortcut-modal="settings"]')
				if (!panel) {
					restoreEmbed()
					return
				}
				var overlay = panel.parentElement
				if (!overlay) return
				var anchor = contentAnchor()
				if (!anchor) {
					restoreEmbed()
					return
				}
				if (embedState.overlay !== overlay) {
					/* 新面板（重开设置是全新 overlay 元素）：清旧跟踪后重新认领 */
					restoreEmbed()
					embedState.overlay = overlay
					embedState.panel = panel
					embedState.mask = overlay.firstElementChild === panel ? null : overlay.firstElementChild
				}
				embedState.anchor = anchor
				applyEmbedGeometry(overlay, panel, embedState.mask, anchor)
				observeEmbedAnchor(anchor)
			}

			/* 面板挂载/卸载均为 body 直接子节点增删（React portal 对 body 的
			 * appendChild/removeChild），MO 只对 target===body 的记录触发全量同步，
			 * 面板内部高频渲染不进入 querySelector；MO 回调在微任务checkpoint执行、
			 * 先于绘制，嵌入改写无可见闪帧 */
			function onBodyMutation(records) {
				for (var i = 0; i < records.length; i++) {
					if (records[i].target === document.body) {
						syncEmbed()
						return
					}
				}
			}

			/* ═══ 设置分区 UI（0.3.0，design D4）═════════════════════════════════ */

			/* 功能清单（行序 = 分区面板渲染序）：id 与 toggleStore/FEATURE_IDS 逐字对应。
			 * 0.3.x 起滚动条样式（scrollbar）与 hero 工作区行对齐（hero-row）两行
			 * 从面板移除——CSS 功能与 store 机制保留（默认仍开启，历史 override 仍
			 * 生效），仅不再暴露独立开关 */
			var FEATURES = [
				{ id: 'whitespace', label: '对话列留白 24px', description: '消息列与输入卡两侧留白固定 24px，解除官方 920px 居中上限，隐藏列宽拖拽把手' },
				{ id: 'composer-width', label: '输入框 80% 宽度居中', description: '输入卡、提示条与队列坞按 80% 宽度居中，与消息列同轴' },
				{ id: 'markdown', label: '用户消息 Markdown 渲染', description: '用户消息气泡按 Markdown 渲染（标题/列表/代码高亮），关闭后回退官方纯文本投影' },
				{ id: 'history-nav', label: '输入框 ↑/↓ 历史导航', description: '输入框首行按 ↑ 召回上一条已发送消息，↓ 切回，Esc 恢复草稿' },
				{ id: 'settings-embed', label: '嵌入设置页面', description: '设置页嵌入内容区以页面形式展示，关闭后回退官方弹出模态对话框' },
			]

			/* React 侧订阅（design D1）：React 18 useSyncExternalStore 直连 store；
			 * 未来宿主 React 降级漂移时退回 useState+useEffect 订阅（两个实现内部
			 * hook 调用序列各自稳定，模块加载期一次性选定） */
			var useToggles = typeof react.useSyncExternalStore === 'function'
				? function () {
					return react.useSyncExternalStore(toggleStore.subscribe, toggleStore.snapshot)
				}
				: function () {
					var state = react.useState(toggleStore.snapshot)
					var snapshot = state[0]
					var setSnapshot = state[1]
					react.useEffect(function () {
						return toggleStore.subscribe(function () { setSnapshot(toggleStore.snapshot()) })
					}, [])
					return snapshot
				}

			/* 主题变量快捷引用（对齐 fenix-dsh-auth 先例的内联样式口径，缺省值兜底
			 * 浅色形态，暗色由宿主变量接管） */
			var COLOR_LABEL = 'var(--dsw-alias-label-primary, #1a1a1a)'
			var COLOR_LABEL_SECONDARY = 'var(--dsw-alias-label-secondary, #555)'
			var COLOR_BORDER = 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))'

			var sectionRowStyle = {
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: '16px',
				padding: '12px 0',
				borderBottom: '1px solid ' + COLOR_BORDER,
			}
			var sectionRowTextStyle = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }
			var sectionRowTitleStyle = { fontSize: '14px', fontWeight: '500', color: COLOR_LABEL, lineHeight: '22px' }
			var sectionRowDescStyle = { fontSize: '12px', color: COLOR_LABEL_SECONDARY, lineHeight: '18px' }
			var sectionRootStyle = { display: 'flex', flexDirection: 'column' }
			var sectionIntroStyle = {
				margin: '0 0 4px',
				fontSize: '12px',
				color: COLOR_LABEL_SECONDARY,
				lineHeight: '18px',
			}

			/* 自绘 toggle 降级替身（宿主 Switch 漂移缺失时）：role/aria-checked 同构，
			 * 视觉对齐官方分区（胶囊轨道 + 圆点，主题变量着色） */
			var FallbackSwitch = function FallbackSwitch(props) {
				var checked = props.checked === true
				return react.createElement('span', {
					role: 'switch',
					'aria-checked': checked ? 'true' : 'false',
					title: props.title,
					onClick: function () { if (typeof props.onChange === 'function') props.onChange(!checked) },
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						width: '36px',
						height: '20px',
						padding: '2px',
						borderRadius: '100px',
						boxSizing: 'border-box',
						cursor: 'pointer',
						background: checked ? 'var(--dsw-alias-brand-major, #4d6bfe)' : 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.08))',
						justifyContent: checked ? 'flex-end' : 'flex-start',
						transition: 'none',
					},
				},
				react.createElement('span', {
					style: {
						display: 'inline-block',
						width: '14px',
						height: '14px',
						borderRadius: '50%',
						background: '#fff',
					},
				}))
			}
			var ToggleControl = HostSwitch || FallbackSwitch

			/* 「Fenix 插件设置」分区组件（settings.section 槽）：渲染 5 个功能行（功能名 +
			 * 一句话说明 + 开关控件）。点击开关写 store 即时生效（store.set 内先重建
			 * 样式后通知，本组件经订阅重渲同步行内开关态——行内开关态与实际生效状态
			 * 单一数据源一致）；data-fdx-polish-feature/-switch 属性供真机验证定位 */
			var PolishSection = function PolishSection() {
				var toggles = useToggles()
				var rows = FEATURES.map(function (feature) {
					var on = toggles[feature.id] !== false
					return react.createElement(
						'div',
						{ key: feature.id, style: sectionRowStyle, 'data-fdx-polish-feature': feature.id },
						react.createElement(
							'div',
							{ style: sectionRowTextStyle },
							react.createElement('div', { style: sectionRowTitleStyle }, feature.label),
							react.createElement('div', { style: sectionRowDescStyle }, feature.description),
						),
						react.createElement(
							'span',
							{ 'data-fdx-polish-switch': feature.id, style: { flex: 'none', display: 'inline-flex' } },
							react.createElement(ToggleControl, {
								checked: on,
								onChange: function (next) { toggleStore.set(feature.id, next) },
								label: feature.label,
								title: feature.label,
							}),
						),
					)
				})
				return react.createElement(
					'div',
					{ style: sectionRootStyle, 'data-fdx-polish-section': '' },
					react.createElement('p', { style: sectionIntroStyle }, '各打磨功能可独立开关；默认全部开启（与安装即用形态一致），关闭某项即时回退官方原生形态。开关仅对当前浏览器生效。'),
					rows,
				)
			}

			/* 分区图标（settings.section.icon 槽，收 {size, active}）；字形漂移降级
			 * 为空节点（菜单条目仍在、无专属图标） */
			var PolishIcon = function PolishIcon(props) {
				if (!SectionIconGlyph) return null
				return react.createElement(SectionIconGlyph, { size: (props && props.size) || 16 })
			}

			/* settings.section 注册尾兜底值（fenix-dsh-auth 先例同款：0.2.2-rc.1 实测
			 * 官方 plugins=15；动态探测失败时本分区落在官方尾部 +1，不与官方分区争序） */
			var FALLBACK_MAX_ORDER = 15

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

					/* 样式：插件自持生命周期（官方 client bundle 同款 data-plugin-css 约定）。
					 * 注入串 = 开启集合拼接（store 初始态经 localStorage 读取），后续开关
					 * 切换由 store.set 同步重建 textContent */
					var styleTag = document.createElement('style')
					styleTag.dataset.plugin = 'fenix-dsh-chat-polish'
					styleTag.dataset.pluginCss = 'fenix-dsh-chat-polish/polish.css'
					styleTag.textContent = toggleStore.cssText()
					document.head.appendChild(styleTag)
					toggleStore.attachStyleTag(styleTag)

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

					/* feature 5：嵌入设置页面。MO 常驻监 body 直挂增删（面板挂载/卸载），
					 * store 订阅负责开关切换时即时应用/还原；二者共用 syncEmbed 入口，
					 * syncEmbed 自身按开关状态与面板存在性幂等收敛 */
					var embedMO = null
					try {
						embedMO = new MutationObserver(onBodyMutation)
						embedMO.observe(document.body, { childList: true, subtree: true })
					} catch (err) {
						stage('settings-embed observer', err)
					}
					var unembedSub = toggleStore.subscribe(function () { syncEmbed() })

					/* 设置分区注册（fenix-dsh-auth 先例同构写法）：注册回调由宿主在渲染时
					 * 声明，此刻官方分区已注册可探测排序尾；枚举失败回退 FALLBACK_MAX_ORDER。
					 * 逐槽 try/catch 降级——宿主升级致槽契约漂移时仅菜单缺席（console.warn），
					 * 功能本体（样式/插槽/监听）不依赖分区存在，不出现页面报错 */
					try {
						ctx.slots.inject('settings.section', function () {
							var maxOrder = FALLBACK_MAX_ORDER
							try {
								var entries = ctx.slots.entries('settings.section')
								for (var i = 0; i < entries.length; i += 1) {
									var order = entries[i] && entries[i].options && entries[i].options.order
									if (typeof order === 'number' && order > maxOrder) maxOrder = order
								}
							} catch (err) { /* 探测失败用兜底尾值 */ }
							return ctx.slots.register({
								name: 'settings.section',
								id: 'fenix-chat-polish',
								order: maxOrder + 1,
								label: function () {
									return 'Fenix 插件设置'
								},
							}, PolishSection)
						})
					} catch (err) {
						stage('settings.section', err)
					}
					try {
						ctx.slots.inject('settings.section.icon', function () {
							return ctx.slots.register({
								name: 'settings.section.icon',
								id: 'fenix-chat-polish',
							}, PolishIcon)
						})
					} catch (err) {
						stage('settings.section.icon', err)
					}

					return function dispose() {
						document.removeEventListener('keydown', onHistoryKeydown, true)
						document.removeEventListener('input', onHistoryInput, true)
						if (embedMO) {
							embedMO.disconnect()
							embedMO = null
						}
						if (unembedSub) unembedSub()
						restoreEmbed()
						toggleStore.detachStyleTag()
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
