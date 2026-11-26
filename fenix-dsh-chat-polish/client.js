/**
 * fenix-dsh-chat-polish — Client 半（零构建，形态对齐 dsh-plugin-loopback-trust）。
 *
 * Fenix 插件打磨功能（dsh 0.2.0-rc.2 实测约束，升级失配时各覆盖自动失效回官方布局），
 * 0.3.0 起每项功能在官方设置页「Fenix 插件」分区内带独立开关（默认全开 = 与
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
 *    经官方 keyed 插槽 settings.section / settings.section.icon 注册「Fenix 插件」
 *    分区（先例 fenix-dsh-auth「登录」分区的同构写法：order 经 ctx.slots.entries
 *    尾随探测、失败回退 FALLBACK_MAX_ORDER、逐槽 try/catch 失配仅 console.warn
 *    菜单缺席）。分区面板按 DSH 语境分组渲染：组「Deepseek Harness UI调整」=
 *    本插件各功能行（功能名 + 一句话说明 + 开关控件，控件复用基线包 primitives
 *    Switch）；组「Deepseek Harness 快捷登录」= 探测到 fenix-dsh-auth 的分区注册
 *    时，经 ui-slots entries 记录的 component 字段把其分区组件嵌入本面板渲染
 *    （close 透传官方关闭回调；auth 未安装或槽契约漂移时该组整体不出现）。
 *    点击开关写模块级开关 store 即时生效。
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
 *    2026-11-25 反制修复：兄弟插件 fenix-dsh-settings-dock 的样式表会无条件把
 *    面板停靠铺满内容区（含遮罩隐藏与关闭钮隐藏），开关关闭后仅清内联样式时
 *    视觉上仍是「嵌入」——本插件改为在关闭态追加注入 EMBED_OFF_CSS 反制样式表
 *    （特异性逐条压过 dock），逐属性还原官方 .VOzbGW_{overlay,mask,panel,_close}
 *    声明值，兑现「关闭 = 回退官方弹出模态」；dock 未装机时反制值 = 官方值，
 *    注入无副作用。
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
					/* ChatView .scroll 侧距（clearance+16=32px）→ 24px；2026-11-25 按
					 * 用户要求左边距再收窄至 14px（右侧保持 24px，滚动条贴边不变；
					 * 列为填充布局，右缘不受影响） */
					'body:not(:has([class$="_embeddedBody"])) [data-conversation-scroll] [class$="_scroll"]{padding-left:14px;padding-right:24px}',
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
				 * #a0a0a0。2026-11-25 按用户要求调整两处：
				 * ① 箭头按钮只保留在会话滚动容器（[data-conversation-scroll]）上，
				 *   上下各一枚（:vertical:decrement/increment SVG 三角），其余滚动条
				 *   （侧栏等）不再绘制——0.2.x 的 html 通配箭头曾让页内多条滚动条各带
				 *   一套箭头，观感为「上下两个箭头」；
				 * ② 会话滚动条钉住页面最右缘：官方 .wSkVaW_root 右 padding 24px +
				 *   scrollBody 自身 margin-right 2px，滚动条距页缘 26px——负外边距
				 *   -24px 让 scrollBody 右缘贴住视口（root/body overflow 均可见，
				 *   centerCol 右缘=视口右缘，无裁切）。暗色按 dsh 自身的
				 *   body[data-ds-dark-theme] 模式翻转；html 前缀抬特异性） */
				scrollbar: [
					'html body{--dsh-scrollbar-width:10px;--dsh-scrollbar-thumb:#a0a0a0;--dsh-scrollbar-thumb-hover:#8c8c8c}',
					'html ::-webkit-scrollbar-track{background:#f1f1f1}',
					'html [data-conversation-scroll]{margin-right:-24px}',
					'html [data-conversation-scroll]::-webkit-scrollbar-button{width:10px;height:11px;background-color:#f1f1f1;background-repeat:no-repeat;background-position:center}',
					"html [data-conversation-scroll]::-webkit-scrollbar-button:vertical:decrement{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 5 4 0 8 5Z' fill='%23757575'/%3E%3C/svg%3E\")}",
					"html [data-conversation-scroll]::-webkit-scrollbar-button:vertical:increment{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0 4 5 8 0Z' fill='%23757575'/%3E%3C/svg%3E\")}",
					"html [data-conversation-scroll]::-webkit-scrollbar-button:horizontal:decrement{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='5' height='8'%3E%3Cpath d='M5 0 0 4 5 8Z' fill='%23757575'/%3E%3C/svg%3E\")}",
					"html [data-conversation-scroll]::-webkit-scrollbar-button:horizontal:increment{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='5' height='8'%3E%3Cpath d='M0 0 5 4 0 8Z' fill='%23757575'/%3E%3C/svg%3E\")}",
					/* 底部 ▼ 按钮加高（11→16px）且三角上移（center 3px）：箭头下方多
					 * 留白、不贴页面底缘（顶部 ▲ 不动） */
					'html [data-conversation-scroll]::-webkit-scrollbar-button:vertical:increment{height:16px;background-position:center 3px}',
					/* Chromium 自定义按钮布局是老 Mac 双按钮风格：decrement 在顶、底两
					 * 端各渲染一份（底部出现 ▲▼ 叠排），increment 同理。用 :start/:end
					 * 隐藏错位副本，只留 顶部▲ + 底部▼ 各一枚（WebKit 经典解法） */
					'html [data-conversation-scroll]::-webkit-scrollbar-button:vertical:end:decrement{display:none}',
					'html [data-conversation-scroll]::-webkit-scrollbar-button:vertical:start:increment{display:none}',
					'html [data-conversation-scroll]::-webkit-scrollbar-button:horizontal:end:decrement{display:none}',
					'html [data-conversation-scroll]::-webkit-scrollbar-button:horizontal:start:increment{display:none}',
					'html body[data-ds-dark-theme]{--dsh-scrollbar-thumb:#969696;--dsh-scrollbar-thumb-hover:#a6a6a6}',
					'html body[data-ds-dark-theme] ::-webkit-scrollbar-track{background:#202124}',
					'html body[data-ds-dark-theme] [data-conversation-scroll]::-webkit-scrollbar-button{background-color:#202124}',
					"html body[data-ds-dark-theme] [data-conversation-scroll]::-webkit-scrollbar-button:vertical:decrement{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 5 4 0 8 5Z' fill='%23a8a8a8'/%3E%3C/svg%3E\")}",
					"html body[data-ds-dark-theme] [data-conversation-scroll]::-webkit-scrollbar-button:vertical:increment{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0 4 5 8 0Z' fill='%23a8a8a8'/%3E%3C/svg%3E\")}",
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
			/* 0.3.x 起从面板移除独立开关的已下线功能 id：CSS 功能与 store 机制保留、
			 * 默认仍开启，但面板已无开关可把历史 override 改回——残留 override 视同
			 * 未知键忽略按开启处理（readOverrides 内提示一次） */
			var RETIRED_FEATURE_IDS = ['scrollbar', 'hero-row']
			/* 有 CSS 分块的功能 id（cssText 拼接顺序） */
			var CSS_BLOCK_IDS = ['whitespace', 'composer-width', 'hero-row', 'scrollbar', 'markdown']

			/* settings-embed 关闭态反制样式（feature 5 倒挂 CSS，无独立 CSS 块 id）：
			 * 兄弟插件 fenix-dsh-settings-dock 的样式表无条件把设置面板停靠铺满内容区
			 * （html body [data-shortcut-modal="settings"] = (0,1,3) 四向定形 + 遮罩
			 * display:none + 头部关闭钮 display:none），仅清内联样式时视觉上仍是嵌入
			 * （2026-11-25 真机实证，即「开关无效」投诉根因）。关闭态注入本表逐条压过：
			 * html body > div 前缀抬 b/c 位，遮罩/overlay 以同元素属性双写加位；数值
			 * 全部取官方 .VOzbGW_{overlay,mask,panel,_close} 声明值（0.2.2-rc.1 bundle
			 * 实测），dock 未装机时 = 官方值原样重现，注入无副作用。dock 的停靠规则
			 * 在 @media(min-width:768px) 内、窄屏官方本就是全屏变体，media 守卫保持
			 * 一致不越界。 */
			var EMBED_OFF_CSS = [
				'@media (min-width: 768px) {',
				/* overlay 反制 dock 的 pointer-events:none（(0,3,3) 压 (0,2,3)），恢复
				 * 官方整层模态拦截（侧栏/右栏在模态打开期不可点） */
				'html body > div[role="presentation"][role="presentation"]:has(> [data-shortcut-modal="settings"]) { pointer-events: auto; }',
				/* 遮罩重显：dock 以 (0,3,4) 隐藏；双写 [aria-hidden] 提到 (0,4,4)。
				 * 官方遮罩无 display 声明（div 默认块级），还原为 block */
				'html body > div[role="presentation"]:has(> [data-shortcut-modal="settings"]) > [aria-hidden="true"][aria-hidden="true"] { display: block; }',
				/* 面板几何还原官方居中卡片（(0,2,3) 压 dock (0,1,3)）：官方
				 * .VOzbGW_panel = position:relative + 800px 宽 + 高度/圆角/投影主题
				 * 变量；inset 四向 auto 抵消 dock 的 left/top/right/bottom 定值 */
				'html body > div[role="presentation"] [data-shortcut-modal="settings"] { position: relative; left: auto; top: auto; right: auto; bottom: auto; width: 800px; height: min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)))); max-width: calc(100vw - 48px); border-radius: var(--dsw-radius-panel); box-shadow: var(--dsw-elevation-prominent); pointer-events: auto; }',
				/* 头部关闭按钮重显：dock 以 (0,3,3) display:none 退役；此处 (0,4,4)
				 * 还原官方 _close 的 display:inline-flex */
				'html body > div[role="presentation"] [data-shortcut-modal="settings"] [class*="_header"]:not([class*="_section"] *) > button { display: inline-flex; }',
				'}',
			].join('\n')

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
							if (parsed[FEATURE_IDS[i]] !== false) continue
							/* 已下线功能的 override 面板不可再改回：忽略按开启处理并提示一次，
							 * 残留键在下次开关写入 persist 时自然清除 */
							if (RETIRED_FEATURE_IDS.indexOf(FEATURE_IDS[i]) !== -1) {
								console.info('[fenix-dsh-chat-polish] retired toggle "' + FEATURE_IDS[i] + '" override ignored (removed from panel in 0.3.x); stale key clears on next toggle write')
								continue
							}
							result[FEATURE_IDS[i]] = false
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
					/* feature 5 倒挂：嵌入关闭时注入官方模态反制样式（抵消 settings-dock
					 * 的无条件停靠）；开启时嵌入几何走内联样式（inline 天然压过样式表），
					 * 本表随之撤除 */
					if (state['settings-embed'] === false) chunks.push(EMBED_OFF_CSS)
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

			/* ── UI 文案词典与宿主语言档（i18n 宿主语言跟随轮：fenix 系插件注入 dsh web
			 *    的自绘控件跟随 DSH 语言设置。zh 列 = 历史钉串逐字基线（tests/README 钉此
			 *    形态），en 列自拟；宿主语言不可得回退 zh = 既有现状。渲染期求值边界：
			 *    已挂载的宿主 cell / 设置面板不因语言切换即时重渲，下一次渲染取新档，
			 *    与 fenix-dsh-auth 头部登记同款）── */
			var UI_DICT = {
				'section.label': ['Fenix 插件', 'Fenix Plugins'],
				'section.intro': ['各打磨功能可独立开关；默认全部开启（与安装即用形态一致），关闭某项即时回退官方原生形态。开关仅对当前浏览器生效。', 'Each polish feature can be toggled independently; all are on by default (identical to the installed form). Turning one off instantly falls back to the official native form. Toggles only affect this browser.'],
				'section.group.ui': ['Deepseek Harness UI调整', 'Deepseek Harness UI Tweaks'],
				'section.group.auth': ['Deepseek Harness 快捷登录', 'Deepseek Harness Quick Login'],
				'features.whitespace.label': ['对话列留白 24px', 'Conversation column 24px gutter'],
				'features.whitespace.desc': ['消息列与输入卡两侧留白固定 24px，解除官方 920px 居中上限，隐藏列宽拖拽把手', 'Fix a 24px gutter on both sides of the message column and composer, lift the official 920px centered cap, and hide the column-width drag handle'],
				'features.composer-width.label': ['输入框 80% 宽度居中', 'Composer centered at 80% width'],
				'features.composer-width.desc': ['输入卡、提示条与队列坞按 80% 宽度居中，与消息列同轴', 'Composer, hints bar and queue dock are centered at 80% width, aligned with the message column'],
				'features.markdown.label': ['用户消息 Markdown 渲染', 'Markdown rendering for user messages'],
				'features.markdown.desc': ['用户消息气泡按 Markdown 渲染（标题/列表/代码高亮），关闭后回退官方纯文本投影', 'Render user message bubbles as Markdown (headings/lists/code highlight); off falls back to the official plain-text projection'],
				'features.history-nav.label': ['输入框 ↑/↓ 历史导航', 'Composer ↑/↓ history navigation'],
				'features.history-nav.desc': ['输入框首行按 ↑ 召回上一条已发送消息，↓ 切回，Esc 恢复草稿', 'Press ↑ on the composer first line to recall the last sent message, ↓ to return, Esc to restore the draft'],
				'features.settings-embed.label': ['嵌入设置页面', 'Embedded settings page'],
				'features.settings-embed.desc': ['设置页嵌入内容区以页面形式展示，关闭后回退官方弹出模态对话框', 'Show the settings page embedded in the content area; off falls back to the official modal dialog'],
				'labels.untitledFile': ['未命名文件', 'Untitled file'],
				'labels.code.copy': ['复制', 'Copy'],
				'labels.code.copied': ['已复制', 'Copied'],
				'labels.code.code': ['代码', 'Code'],
				'labels.code.wrap': ['自动换行', 'Wrap'],
				'labels.code.unwrap': ['不换行', 'No wrap'],
				'labels.footnotes': ['脚注', 'Footnotes'],
			}

			/* 宿主语言档（null = 未取得 → zh 档直出现状；口径移植 fenix-dsh-dashboard-bridge
			 * localeFollow，快照原值 'zh'|'en' 白名单归一，宽面防御收容 -CN/-US 变体） */
			var hostLocale = null

			/* 宿主语言快照原值 → 'zh'|'en'；白名单外 undefined（坏值宁缺毋错）。 */
			function normalizeHostLocale(value) {
				if (value === 'zh' || value === 'zh-CN') return 'zh'
				if (value === 'en' || value === 'en-US') return 'en'
				return undefined
			}

			/* 当前档词典取值（渲染期调用；未取得宿主语言 = zh 直出现状）。 */
			function uiText(key) {
				return UI_DICT[key][hostLocale === 'en' ? 1 : 0]
			}

			/* 宿主语言跟随装配（localeFollow 极简镜像，与 fenix-dsh-sidebar-tabs/
			 * fenix-dsh-auth 同口径）：locale 服务 late provide（同步读必空）→ 1s 轮询
			 * 直至就绪；空快照继续等；非空非白名单 = 坏值「宁缺毋错」终局降级不订阅；
			 * 订阅 locale/change 实时换档。返回停止函数（停轮询 + 退订）随 dispose 清理。
			 * 全读在 try/catch：cordis proxy 对缺失服务属性访问会抛错。 */
			function installLocaleFollow(ctx) {
				var timer = null
				var unsub = null
				var stopped = false
				function adopt(raw) {
					var loc = normalizeHostLocale(raw)
					if (loc === undefined || loc === hostLocale) return
					hostLocale = loc
				}
				/* 单轮接入：undefined = 未就绪继续等；true = 已取得；false = 坏值终局降级 */
				function attempt() {
					var service
					try {
						service = ctx.locale
					} catch (e) {
						return undefined /* 服务未注入（cordis proxy 抛错）：等下一轮 */
					}
					if (service === null || service === undefined || typeof service.getSnapshot !== 'function') return undefined
					var raw
					try {
						var snap = service.getSnapshot()
						raw = snap === null || snap === undefined ? undefined : snap.active
					} catch (e) {
						return undefined /* 快照读取抛错（形状漂移/未就绪）：继续等 */
					}
					if (raw === undefined || raw === null || raw === '') return undefined /* 早期空快照：等 settings 回同步 */
					if (normalizeHostLocale(raw) === undefined) return false /* 非空且非白名单：坏值，宁缺毋错 */
					adopt(raw)
					return true
				}
				function subscribe() {
					if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return /* 订阅面缺席：不跟随实时切换（初始档已生效） */
					try {
						var off = ctx.on('locale/change', function (snapshot) {
							adopt(snapshot === null || snapshot === undefined ? undefined : snapshot.active)
						})
						if (typeof off === 'function') unsub = off
					} catch (e) {
						/* 订阅不可用：降级（初始档已取，缺实时刷新），无报错 */
					}
				}
				function poll() {
					if (stopped) return
					var state
					try {
						state = attempt()
					} catch (e) {
						state = undefined
					}
					if (state === true) {
						subscribe()
						return
					}
					if (state === false) return /* 坏值终局降级：不订阅不重试 */
					timer = setTimeout(poll, 1000)
					/* 测试/非浏览器宿主：轮询计时器不持有事件循环（浏览器 setTimeout
					 * 返回 number 无 unref，守卫跳过；dispose 仍 clearTimeout 收口） */
					if (timer !== null && typeof timer.unref === 'function') timer.unref()
				}
				poll()
				return function stop() {
					stopped = true
					if (timer !== null) {
						clearTimeout(timer)
						timer = null
					}
					if (unsub !== null) {
						try {
							unsub()
						} catch (e) {
							/* 退订失败不阻断 dispose 其余回收 */
						}
						unsub = null
					}
				}
			}

			/* ── MarkdownText 标签（模块级稳定身份；组件表按 identity 记忆化——
			 * LABELS 对象身份恒定，属性经 getter 渲染期按当前语言档求值）── */
			var LABELS = {
				get code() {
					return {
						copyLabel: uiText('labels.code.copy'),
						copiedLabel: uiText('labels.code.copied'),
						toolbarLabels: { codeLabel: uiText('labels.code.code'), wrapLabel: uiText('labels.code.wrap'), unwrapLabel: uiText('labels.code.unwrap') },
					}
				},
				get footnotes() {
					return uiText('labels.footnotes')
				},
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
					/* 重置放 effect 本体：StrictMode 双挂载等 effect 卸载重挂场景下，
					 * 同一实例经 cleanup 置 false 后恢复 true——仅靠 useRef(true) 初值
					 * 会让重挂后的复制成功回调被 mounted 守卫永久丢弃 */
					mounted.current = true
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
								var fileName = typeof file.name === 'string' ? file.name : uiText('labels.untitledFile')
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
			 * 从面板移除——CSS 功能与 store 机制保留（默认仍开启），仅不再暴露独立
			 * 开关；二者历史 override 经 readOverrides 忽略按开启处理（无恢复死角） */
			var FEATURES = [
				{ id: 'whitespace', labelKey: 'features.whitespace.label', descKey: 'features.whitespace.desc' },
				{ id: 'composer-width', labelKey: 'features.composer-width.label', descKey: 'features.composer-width.desc' },
				{ id: 'markdown', labelKey: 'features.markdown.label', descKey: 'features.markdown.desc' },
				{ id: 'history-nav', labelKey: 'features.history-nav.label', descKey: 'features.history-nav.desc' },
				{ id: 'settings-embed', labelKey: 'features.settings-embed.label', descKey: 'features.settings-embed.desc' },
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
			/* 卡内末行：去掉分隔线（与卡片底边粘连观感） */
			var sectionRowStyleLast = Object.assign({}, sectionRowStyle, { borderBottom: 'none' })
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
			/* 分组卡片（2026-11-25 用户反馈「分组看着不明显，各分组要装在卡片里」）：
			 * 每个分组（标题 + 内容）整体包进一张卡片，主题变量着色、暗色由宿主接管；
			 * data-fdx-polish-group 落在卡片容器上（测试与样式锚点）。 */
			var sectionCardStyle = {
				margin: '12px 0 0',
				padding: '0 16px',
				background: 'var(--dsw-specific-input-major, rgba(127,127,127,0.08))',
				border: '1px solid ' + COLOR_BORDER,
				borderRadius: 'var(--dsw-radius-md, 8px)',
				display: 'flex',
				flexDirection: 'column',
			}
			/* 分组标题（卡片内首行，「Deepseek Harness UI调整/快捷登录」两处复用，
			 * 必须保持同一样式对象——2026-11-25 用户反馈两卡标题观感不一致）。
			 * 14px/600：与行标题同字号但更重，明确卡头层级（旧 12px 比行还小）；
			 * paddingBottom 0，标题→内容间距由内容首元素统一给 12px（行 paddingTop /
			 * auth pane marginTop），两卡严格一致 */
			var sectionGroupStyle = {
				padding: '12px 0 0',
				fontSize: '14px',
				fontWeight: '600',
				color: COLOR_LABEL_SECONDARY,
				lineHeight: '20px',
				letterSpacing: '0.3px',
			}
			var sectionAuthPaneStyle = { marginTop: '12px' }

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

			/* 「Fenix 插件」分区组件（settings.section 槽）：功能行按 DSH 语境分组——
			 * 「Deepseek Harness UI调整」= 本插件功能行（功能名 + 一句话说明 + 开关
			 * 控件）；探测到 fenix-dsh-auth 的分区注册时再渲染「Deepseek Harness 快捷
			 * 登录」组，组内用 entries 记录的 component 字段直接复用其分区组件（close
			 * 透传官方关闭回调；auth 未安装/槽契约漂移时该组整体不出现）。点击开关写
			 * store 即时生效（store.set 内先重建样式后通知，本组件经订阅重渲同步行内
			 * 开关态——行内开关态与实际生效状态单一数据源一致）；data-fdx-polish-
			 * feature/-switch/-group 属性供真机验证定位 */
			var sectionSlotsRef = null

			/* 探测 fenix-dsh-auth 的 settings.section 注册。entries 返回原始注册记录数组
			 * （含被遮蔽项；auth 单条注册不受影响），命中 options.id==='fenix-auth' 且
			 * component 为函数才认定可用；槽 API 漂移 → null 分组缺席，不抛渲染错 */
			var resolveAuthSectionEntry = function resolveAuthSectionEntry() {
				var slots = sectionSlotsRef
				if (!slots || typeof slots.entries !== 'function') return null
				try {
					var entries = slots.entries('settings.section')
					for (var i = 0; i < entries.length; i += 1) {
						var entry = entries[i]
						if (entry && entry.options && entry.options.id === 'fenix-auth' && typeof entry.component === 'function') return entry
					}
				} catch (err) { /* 槽契约漂移：仅分组缺席 */ }
				return null
			}

			var PolishSection = function PolishSection(props) {
				var toggles = useToggles()
				var rows = FEATURES.map(function (feature, index) {
					var on = toggles[feature.id] !== false
					return react.createElement(
						'div',
						{
							key: feature.id,
							style: index === FEATURES.length - 1 ? sectionRowStyleLast : sectionRowStyle,
							'data-fdx-polish-feature': feature.id,
						},
						react.createElement(
							'div',
							{ style: sectionRowTextStyle },
							react.createElement('div', { style: sectionRowTitleStyle }, uiText(feature.labelKey)),
							react.createElement('div', { style: sectionRowDescStyle }, uiText(feature.descKey)),
						),
						react.createElement(
							'span',
							{ 'data-fdx-polish-switch': feature.id, style: { flex: 'none', display: 'inline-flex' } },
							react.createElement(ToggleControl, {
								checked: on,
								onChange: function (next) { toggleStore.set(feature.id, next) },
								label: uiText(feature.labelKey),
								title: uiText(feature.labelKey),
							}),
						),
					)
				})
				var uiCardChildren = [
					react.createElement('div', { style: sectionGroupStyle }, uiText('section.group.ui')),
				]
				for (var i = 0; i < rows.length; i++) uiCardChildren.push(rows[i])
				var children = [
					react.createElement('p', { key: 'intro', style: sectionIntroStyle }, uiText('section.intro')),
					react.createElement(
						'div',
						{ key: 'group-ui', style: sectionCardStyle, 'data-fdx-polish-group': 'dsh-ui' },
						uiCardChildren,
					),
				]
				var authEntry = resolveAuthSectionEntry()
				if (authEntry) {
					children.push(
						react.createElement(
							'div',
							{ key: 'group-auth', style: sectionCardStyle, 'data-fdx-polish-group': 'dsh-auth' },
							react.createElement('div', { style: sectionGroupStyle }, uiText('section.group.auth')),
							react.createElement(
								'div',
								{ style: sectionAuthPaneStyle, 'data-fdx-polish-auth-pane': '' },
								react.createElement(authEntry.component, { close: props && props.close }),
							),
						),
					)
				}
				return react.createElement(
					'div',
					{ style: sectionRootStyle, 'data-fdx-polish-section': '' },
					children,
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
					/* PolishSection 组内嵌入 auth 分区组件用（渲染期读取，dispose 置空） */
					sectionSlotsRef = ctx.slots
					var stage = function (name, err) {
						var detail = err && err.stack ? err.stack : String(err)
						console.warn('[fenix-dsh-chat-polish] activation stage "' + name + '" rejected: ' + detail)
						failures.push(name)
					}

					/* 样式：插件自持生命周期（官方 client bundle 同款 data-plugin-css 约定）。
					 * 注入串 = 开启集合拼接（store 初始态经 localStorage 读取），后续开关
					 * 切换由 store.set 同步重建 textContent */
					var styleTag = null
					try {
						styleTag = document.createElement('style')
						styleTag.dataset.plugin = 'fenix-dsh-chat-polish'
						styleTag.dataset.pluginCss = 'fenix-dsh-chat-polish/polish.css'
						styleTag.textContent = toggleStore.cssText()
						document.head.appendChild(styleTag)
						toggleStore.attachStyleTag(styleTag)
					} catch (err) {
						/* head 缺失等极端时序：仅跳过样式注入（stage 降级留痕），不阻断
						 * 后续激活步——与其余激活步逐段降级纪律同口径 */
						styleTag = null
						stage('style inject', err)
					}

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
						/* body 直挂 portal（面板挂载/卸载均为 body 直接子节点增删），无需
						 * subtree——深层高频渲染不进回调，与 fenix-dsh-settings-dock 同参 */
						embedMO.observe(document.body, { childList: true })
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
									return uiText('section.label')
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

					/* UI 文案宿主语言跟随装配（失败仅 stage 降级留痕、回退 zh 直出现状，
					 * 不阻断激活；词典与装配器见 UI_DICT / installLocaleFollow） */
					/* 服务闸（2026-11-26 真机实证）：ctx.locale 只对「inject 声明过
					 * locale 的 fiber」放行（未声明属性访问恒抛 cannot get property
					 * "locale" without inject），本插件 apply ctx 不声明 locale（fence
					 * 约束：静态声明宿主缺服务 = 激活永远 pending）→ 装配经运行时
					 * inject 子上下文（cc-import lib/client.js:5017 同款形态）：子
					 * fiber 持 ['locale'] 声明，服务就绪后回调触发，属性访问过闸；
					 * 原轮询路径保留作无害兜底。 */
					var localeFollowDisposed = false
					var stopLocaleFollow = null
					try {
						ctx.inject(['locale'], function (localeCtx) {
							if (localeFollowDisposed) return
							stopLocaleFollow = installLocaleFollow(localeCtx)
							return stopLocaleFollow
						})
					} catch (err) {
						stage('locale follow', err)
					}

					/* [fenix-ignore:878d9dc84ebc] 槽位回收由宿主框架接管：五处 ctx.slots.inject 工厂
					 * 均 return ctx.slots.register(...)，返回 disposer 由框架在插件卸载时收集执行
					 * （dsh-runtime.d.ts 契约「工厂返回值（disposer）由框架在插件卸载时收集执行」；
					 * fenix-dsh-auth 同款条目、同款核实口径），dispose 无需逐槽保存 disposer。 */
					return function dispose() {
						localeFollowDisposed = true
						sectionSlotsRef = null
						document.removeEventListener('keydown', onHistoryKeydown, true)
						document.removeEventListener('input', onHistoryInput, true)
						if (embedMO) {
							embedMO.disconnect()
							embedMO = null
						}
						if (unembedSub) unembedSub()
						if (stopLocaleFollow) stopLocaleFollow()
						restoreEmbed()
						toggleStore.detachStyleTag()
						var removed = styleTag !== null && styleTag.parentNode !== null
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
