/**
 * fenix-dsh-settings-dock — Client 半（零构建，形态对齐 fenix-dsh-chat-polish）。
 *
 * 把官方设置弹窗页面化停靠到侧栏右侧内容区（dsh 0.2.0-rc.2 实测约束，升级失配
 * 时样式自动失效回官方弹窗）：
 *
 * 官方形态：ui-settings-general 的 SettingsPanel 经 body 直挂 portal 渲染
 * 全屏 overlay（div[role=presentation]，flex 居中、z=1000）> 遮罩层（模糊 +
 * 点击关闭）+ 面板（固定 800×800，max-width 100vw-48px）；打开状态与十个官方
 * 设置 section 壳全在官方包内，本插件不重实现，只做几何重排：
 *
 *   - 面板固定停靠：left=侧栏列宽、right=右栏宽度、top=框架 chrome 下缘
 *     （--dsh-frame-chrome-top，web 恒 0）、bottom=0，铺满内容区、去卡片感
 *     （圆角/阴影归零）；
 *   - 遮罩 display:none + overlay 整层 pointer-events:none → 页面化语义；
 *     面板显式 pointer-events:auto 取回事件（pointer-events 继承性，2026-11-07
 *     真机返工点）；
 *   - 侧栏导航自动收设置：停靠页盖住内容区，侧栏点击（面板/会话/收缩等）若
 *     不关设置，目标面板在后台切换被盖住（观感「点了没反应」）。capture 阶段
 *     监听侧栏区（x < dock 左缘）点击合成 Esc 即刻收设置；设置触发按钮（官方
 *     open() 幂等开、开态可达后无 toggle 语义）拦截官方 handler 代管为开关切换；
 *     头部关闭按钮按用户定调隐藏（2026-11-07），退出 = Esc / 侧栏导航 / 触发按钮；
 *   - aria-modal 与官方快捷指令系统（closeTopModal 按 modalSelector 找面板）
 *     不做任何改动，停靠态设置关闭指令照常工作；代价是设置打开期间侧栏内
 *     输入框键盘输入会被官方 isBehindModal 判定让位（小众边缘，README 登记）。
 *
 * 独立页铺满（rc.5 回归修复，2026-11-25）：rc.5 起「插件」「自动化任务」
 * 从设置弹窗分区改为独立页（PluginManagerPage / TaskManagerPage，section 壳
 * 类 <hash>_page），官方列宽锁 960px 居中——历史「填满」随入口搬家失效
 * （settings-dock 的 _section 放开不再覆盖到它们）。同缝补两条结构放开：
 * 插件页按 _pageBody/_pageBar/_pageHead 片段、自动化页按 _pageContent 片段
 * （四片段全 client-ui 族 CSS modules 唯一，grep 核实；_pageHead 含
 * _pageHeading 前缀碰撞由 _pageBar 父锚排除——schedule 无 _pageBar）。
 *
 * 钩子（0.2.0-rc.2 构建产物，升级失配自动回官方布局）：
 *   - 面板稳定属性 [data-shortcut-modal="settings"]（官方非哈希调试锚点）；
 *   - 侧栏宽度无 CSS 变量（JS 驱动可拖拽），测量主锚 = 侧栏列元素
 *     `[class*="sidebarCol"]`（rect.right，展开/56px 收缩窄轨全形态通用），
 *     拖拽把手 [data-side="sidebar"] 为兜底锚（收缩态不渲染，2026-11-07
 *     真机返工点：误把缺席当列宽 0 会盖住窄轨）；右栏锚 = [data-rightbar-col]；
 *   - 打开期间 rAF 逐帧重测（读侧操作无写回，成本两次 getBoundingClientRect；
 *     自愈：侧栏收起/展开、拖拽、右栏开关、窗口缩放均被下一帧纠正）。
 *
 * 视口护栏：仅 ≥768px 生效（CSS media），窄屏维持官方弹窗形态（窄屏侧栏本为
 * overlay 式，停靠无意义）。
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-settings-dock',
		factory() {
			/* html body 前缀抬特异性压过官方单类选择器（官方类名 VOzbGW_* 为构建
			 * 哈希，不做版本钉扎引用，全部经结构/稳定属性选择器定位）。 */
			var DOCK_CSS = [
				'@media (min-width: 768px) {',
				/* overlay 整层放行点击：设置打开期间侧栏/右栏保持可交互。
				 * pointer-events 是继承属性，none 会淹没面板——面板必须显式
				 * auto 取回事件（2026-11-07 真机返工点） */
				'html body > div[role="presentation"]:has(> [data-shortcut-modal="settings"]) { pointer-events: none; }',
				/* 遮罩退役（overlay 仅两个子节点：aria-hidden 遮罩 + 设置面板） */
				'html body > div[role="presentation"]:has(> [data-shortcut-modal="settings"]) > [aria-hidden="true"] { display: none; }',
				/* 面板停靠铺满内容区：去居中卡片形态（官方 .panel 类单类选择器，
				 * (0,1,1) 特异性必胜） */
				'html body [data-shortcut-modal="settings"] { position: fixed; pointer-events: auto; left: var(--fdx-dock-left, 0px); top: var(--dsh-frame-chrome-top, 0px); right: var(--fdx-dock-right, 0px); bottom: 0; width: auto; height: auto; max-width: none; border-radius: 0; box-shadow: none; }',
				/* 头部关闭按钮退役（用户定调 2026-11-07）：停靠后退出走 Esc。
				 * 关闭按钮 = header 行唯一直接 button 子元素（壳 chrome，aria 名
				 * 来自 settings.close 槽位的 sr-only 文案，aria-label 属性为空，
				 * 故按结构定位，不依赖哈希类与 locale 文案）。header 行并非面板
				 * 直属子节点（rc.2 实测 面板 > content > header），`>` 直子收紧
				 * 不可用；改用 :not 排除 section 根内同片段元素——各设置页自身
				 * 已有 _header 片段类（rc.2 实测 plugins-inventory 的 *_headerEnd，
				 * Menu 锚按钮只隔一层包装即成直接 button 子元素），不排除会被
				 * 连带隐藏（升级复核点：宿主若在壳 header 行内 settings.action
				 * 槽位外新加直接 button 子元素、或 section 根类漂移出 *_section
				 * 片段，此条失配/误伤，升级时优先复核） */
				'html body [data-shortcut-modal="settings"] [class*="_header"]:not([class*="_section"] *) > button { display: none; }',
				/* section 根容器自适应停靠宽度（用户定调 2026-11-07）：各设置页
				 * 根容器按 800px 弹窗设计写死 max-width（models/agent-preset 720px、
				 * plugins/plugin-inventory 760px），铺满后右侧大片空白。各包 section
				 * 根统一为唯一 `<hash>_section` 类（全 settings 族核实，无其它
				 * _section* 变体），按类片段放开；行内控件自身的窄 max-width
				 * （标签/控件宽度语义）不动 */
				'html body [data-shortcut-modal="settings"] [class*="_section"] { max-width: none; }',
				/* 独立插件页铺满（rc.5 回归修复，2026-11-25）：官方 PluginManagerPage
				 * 列宽三条上限 .page > * / .pageBar > .pageHead / .pageBody > *
				 * 均 960px 居中（page 容器 align-items:center）。_pageBody 片段全
				 * client-ui 族唯一 → :has 直子限定只命中插件页根；pageBar 直子
				 * pageHead 同锚（:has 外置免重复长链）。特异性 html body +
				 * 三重类锚必胜官方单类/双类选择器。行内控件自身窄 max-width
				 * （开关/胶囊等）不在直子链上，不受影响。 */
				'html body section[class*="_page"]:has(> [class*="_pageBody"]) > * { max-width: none; }',
				'html body section[class*="_page"] [class*="_pageBody"] > * { max-width: none; }',
				'html body section[class*="_page"] [class*="_pageBar"] > [class*="_pageHead"] { max-width: none; }',
				/* 独立自动化任务页铺满（rc.5 同款回归）：TaskManagerPage 列宽
				 * .pageContent { max-width:960px; margin:0 auto }。_pageContent
				 * 片段全族唯一（schedule 包）；放开后列宽 = 滚动视口全宽，自身
				 * clamp(24px,4vw,48px) 内边距保留（与插件页 inset 同语言，贴边
				 * 不顶格）。 */
				'html body section[class*="_page"] [class*="_pageContent"] { max-width: none; }',
				'}',
			].join('\n')

			function measure() {
				var docEl = document.documentElement
				var viewportWidth = docEl.clientWidth
				var left = 0
				var right = 0
				/* 侧栏左缘：主锚 = 侧栏列元素（展开 ~276px / 收缩残留 56px 窄轨，
				 * rect.right 即列右缘，全形态通用）。2026-11-07 真机返工：拖拽把手
				 * [data-side="sidebar"] 在收缩态不渲染，此前误把缺席当列宽 0，
				 * 面板盖住窄轨；把手降级为兜底锚。 */
				var col = document.querySelector('[class*="sidebarCol"]')
				if (col) {
					var colRect = col.getBoundingClientRect()
					if (colRect.width > 0) left = Math.max(0, Math.round(colRect.right))
				} else {
					var handle = document.querySelector('[data-side="sidebar"]')
					if (handle) left = Math.max(0, Math.round(handle.getBoundingClientRect().left))
				}
				var rightbar = document.querySelector('[data-rightbar-col]')
				if (rightbar) {
					var rect = rightbar.getBoundingClientRect()
					if (rect.width > 0) right = Math.max(0, Math.round(viewportWidth - rect.right))
				}
				docEl.style.setProperty('--fdx-dock-left', left + 'px')
				docEl.style.setProperty('--fdx-dock-right', right + 'px')
			}

			var rafId = 0
			function startMeasureLoop() {
				if (rafId) return
				var tick = function () {
					measure()
					rafId = requestAnimationFrame(tick)
				}
				rafId = requestAnimationFrame(tick)
			}
			function stopMeasureLoop() {
				if (rafId) {
					cancelAnimationFrame(rafId)
					rafId = 0
				}
			}

			function isSettingsOpen() {
				return !!document.querySelector('[data-shortcut-modal="settings"]')
			}

			/* 页面化语义收尾（2026-11-07 真机返工）：设置打开期间点击侧栏区
			 * （x < dock 左缘）= 导航意图，若不关设置，目标面板会在后台切换、
			 * 被停靠页盖住（观感「点了没反应」）。capture 阶段合成 Esc——
			 * useModalLayer 的文档级 keydown 即刻关设置；点击继续传播完成
			 * 侧栏自身的动作（面板切换/会话切换/收缩等）。设置触发按钮同口径：
			 * 合成 Esc 先关，官方 toggle 后开，行为等价「点开」。 */
			function onDocumentClick(event) {
				if (!isSettingsOpen()) return
				if (event.button !== 0) return
				var left = parseInt(document.documentElement.style.getPropertyValue('--fdx-dock-left'), 10) || 0
				if (left <= 0 || event.clientX >= left) return
				var target = event.target
				if (!(target && target.closest)) return
				if (target.closest('[data-shortcut-modal="settings"]')) return
				/* 设置触发按钮特判：官方语义是 openSettings()（幂等开；官方模态下
				 * 开态根本点不到它，故无 toggle 行为可依赖）。停靠态它首次可达，
				 * 开着点它 = 想关：capture 拦截官方 handler（stopPropagation，
				 * bridge 拦截层先例）+ 合成 Esc 代管为开关切换。识别 = 侧栏区内
				 * 的 `_trigger` 类 BUTTON（`_trigger` 类多包共有，x < dockLeft
				 * 条件下唯命中侧栏底部设置触发）。 */
				var trigger = target.closest('[class*="_trigger"]')
				if (trigger && trigger.tagName === 'BUTTON') {
					event.stopPropagation()
					document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
					return
				}
				document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			}

			return {
				apply() {
					var styleTag = document.createElement('style')
					styleTag.dataset.plugin = 'fenix-dsh-settings-dock'
					styleTag.dataset.pluginCss = 'fenix-dsh-settings-dock/dock.css'
					styleTag.textContent = DOCK_CSS
					document.head.appendChild(styleTag)

					/* 面板挂载检测：官方 SettingsPanel 是 body 直挂 portal，body 顶层
					 * childList 观察即可覆盖挂载/卸载，无需 subtree。 */
					var observer = new MutationObserver(function () {
						if (isSettingsOpen()) {
							measure()
							startMeasureLoop()
						} else {
							stopMeasureLoop()
						}
					})
					observer.observe(document.body, { childList: true })

					/* 侧栏导航自动收设置（capture 常驻监听，开态才动作） */
					document.addEventListener('click', onDocumentClick, true)

					/* 装载时可能已处于打开态（热重载/插件晚于面板挂载） */
					if (isSettingsOpen()) {
						measure()
						startMeasureLoop()
					}

					return function dispose() {
						stopMeasureLoop()
						observer.disconnect()
						document.removeEventListener('click', onDocumentClick, true)
						var removed = styleTag.parentNode !== null
						if (removed) styleTag.remove()
						document.documentElement.style.removeProperty('--fdx-dock-left')
						document.documentElement.style.removeProperty('--fdx-dock-right')
						return removed
					}
				},
			}
		},
	})
})()
