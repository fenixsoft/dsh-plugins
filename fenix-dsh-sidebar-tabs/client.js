/**
 * fenix-dsh-sidebar-tabs — Client 半（零构建，形态对齐 fenix-dsh-settings-dock）。
 *
 * 在 dsh web 侧栏顶部（品牌区与「新会话」按钮之后、全局导航之前）注入
 * 「功能 / 工作区」双 tab 分段控件，把两类异质内容分区直达（dsh 0.2.2-rc.1
 * 安装版 bundle 实证，升级失配时零注入退出回官方形态）：
 *
 * 官方侧栏 DOM（SidebarRoot，dsh-client-ui-sidebar 0.2.2-rc.1 实证结构）：
 *   div.<hash>_root                       ← 侧栏根（!wide 窄轨时附加 <hash>_collapsed）
 *     div.<hash>_logoRow                  ← 品牌区
 *     div.<hash>_controls                 ← 新会话按钮容器（HeaderLeadingControls）
 *     nav.<hash>_panelList                ← 全局导航容器（aria-label=panels.label，8 官方入口）
 *     div.<hash>_regionArea               ← Workspaces 区容器（renderSlot("sidebar.workspaces")
 *                                           挂载壳：搜索框/高级搜索入口/View options/树）
 *     div.<hash>_footArea                 ← 底部（footerActions + Account/设置区）
 *
 * 行为（对齐 SPEC specs/sidebar-tabs）：
 *   - 切换 = 容器 display 级可见性切换，MUST NOT reparent（官方 React 管理子树，
 *     搬移与 reconciliation 冲突）；两容器保持各自独立滚动位置与官方更新能力；
 *   - 选择记忆：localStorage 键 fenix-dsh-sidebar-tabs.tab（'func'|'workspace'），
 *     缺失/非法值缺省 'workspace'；写入失败（存储禁用）不抛错、退化为会话内记忆；
 *   - 收起窄轨（root 带 collapsed 类）：tab 栏 display:none 不渲染、两容器恢复
 *     官方现状可见性；展开后恢复记忆 tab；
 *   - 常显：新会话按钮（controls）与 Account/footArea 均不在 display 切换目标内，
 *     两 tab 态天然常显、行为不变；
 *   - 自愈：MutationObserver（结构子树 + root class）监听官方重渲染/收起切换，
 *     重贴 display 状态与 tab 栏在位（对齐 fenix-dsh-session-advanced-search
 *     持续维护模式；失配后恢复命中则自动重注入）；
 *   - 失配零副作用：任一必需锚点未命中 → 不注入 tab 栏、不注入 style、不动任何
 *     官方元素、warn 一次（含失配锚点名，限流防热循环刷日志）、零异常。
 *
 * 主题：颜色全部引用官方 token —— 轨道/活动块/文字/指示条随暗（body[data-ds-dark-theme]）
 * 浅主题自适应（原型 specs/add-sidebar-tabs-plugin/prototype 仅视觉参照）：
 *   轨道 浅 bluish-150 / 暗 bluish-850；活动块 --dsw-specific-sidebar-nav-item-active
 *   （浅 bluish-100 / 暗 bluish-750，官方导航项活动态同源）；文字 --dsw-alias-label-*；
 *   指示条 浅 deepseek-500 / 暗 deepseek-400。
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-sidebar-tabs',
		factory() {
			var PLUGIN_ID = 'fenix-dsh-sidebar-tabs'
			var CSS_MARKER = 'fenix-dsh-sidebar-tabs/tabs.css'
			var STORAGE_KEY = 'fenix-dsh-sidebar-tabs.tab'
			var TAB_FUNC = 'func'
			var TAB_WORKSPACE = 'workspace'

			/* —— 锚点签名（安装版 dsh 0.2.2-rc.1 bundle 实证；CSS-modules 键名子串匹配，
			 *    哈希前缀免疫。官方升级失配时第一修缝点，重钉指引见 README「签名字证」。） —— */
			var SEL = {
				/* 侧栏列：dsh-client-ui-layout 布局列（settings-dock 同锚，展开/窄轨通用） */
				col: '[class*="sidebarCol"]',
				/* 全局导航容器：SidebarRoot 直下唯一 <nav>（panels.label） */
				nav: 'nav[class*="panelList"]',
				/* Workspaces 区容器：sidebar.workspaces 槽位挂载壳 */
				workspaces: '[class*="regionArea"]',
			}

			var TABS_CSS = [
				/* 分段控件轨道：原型分段控件（深色轨道 + 活动态圆角块 + 底部品牌色指示条），
				 * 高 30px tab、栏含 3px 内边距、左右 12px 边距；token 随官方暗/浅主题自适应 */
				'.fdx-sbt-bar { --fdx-sbt-track: var(--dsw-static-neutral-bluish-150); --fdx-sbt-accent: var(--dsw-static-deepseek-500); margin: 0 12px 8px; flex: none; background: var(--fdx-sbt-track); border-radius: 8px; padding: 3px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }',
				'body[data-ds-dark-theme] .fdx-sbt-bar { --fdx-sbt-track: var(--dsw-static-neutral-bluish-850); --fdx-sbt-accent: var(--dsw-static-deepseek-400); }',
				/* 收起窄轨：tab 栏不渲染（窄轨内容与官方现状一致） */
				'.fdx-sbt-bar[data-rail="true"] { display: none; }',
				'.fdx-sbt-tab { all: unset; box-sizing: border-box; position: relative; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer; }',
				'.fdx-sbt-tab:hover { color: var(--dsw-alias-label-primary); }',
				'.fdx-sbt-tab:focus-visible { outline: 2px solid var(--dsw-static-deepseek-400); outline-offset: -2px; }',
				'.fdx-sbt-tab[aria-selected="true"] { background: var(--dsw-specific-sidebar-nav-item-active); color: var(--dsw-alias-label-primary); }',
				'.fdx-sbt-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 22%; right: 22%; bottom: 0; height: 2px; border-radius: 2px; background: var(--fdx-sbt-accent); }',
				'.fdx-sbt-tab svg { flex: none; opacity: .85; }',
			].join('\n')

			/* 原型几何内联 SVG（16 viewBox 细线，与官方图标笔画一致） */
			var ICON_FUNC =
				'<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/></svg>'
			var ICON_WORKSPACE =
				'<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 2h5.5A1.5 1.5 0 0 1 14.5 6.5v5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7Z"/></svg>'

			/* —— 选择记忆（localStorage 缺失/非法值缺省工作区；读写失败降级会话内记忆） —— */
			function readStoredTab() {
				try {
					var v = window.localStorage.getItem(STORAGE_KEY)
					return v === TAB_FUNC || v === TAB_WORKSPACE ? v : TAB_WORKSPACE
				} catch (e) {
					return TAB_WORKSPACE
				}
			}

			function persistTab(value) {
				try {
					window.localStorage.setItem(STORAGE_KEY, value)
				} catch (e) {
					/* 存储被禁用等持久化失败 MUST NOT 抛错：state 变量自身即会话内记忆 */
				}
			}

			/* 窄轨检测：SidebarRoot 上 !wide 时附加的 <hash>_collapsed 类（键名子串匹配） */
			function isRail(root) {
				var classes = root.classList
				for (var i = 0; i < classes.length; i++) {
					if (classes[i].indexOf('collapsed') !== -1) return true
				}
				return false
			}

			return {
				apply() {
					var disposed = false
					/* 会话内 tab 状态（storage 只是它的持久化镜像） */
					var state = readStoredTab()
					var styleTag = null
					var tabbar = null
					var tabButtons = {}
					var watchedRoot = null
					var warnedMissing = false
					var scheduled = false

					function setDisplay(el, visible) {
						if (visible) {
							if (el.style.display) el.style.removeProperty('display')
						} else {
							el.style.setProperty('display', 'none')
						}
					}

					/* 按 D5 失配语义回退：移除 tab 栏、清掉全部本插件对官方元素的可见性改写 */
					function teardownDom() {
						if (tabbar && tabbar.parentNode) tabbar.remove()
						var col = document.querySelector(SEL.col)
						if (col) {
							var nav = col.querySelector(SEL.nav)
							var ws = col.querySelector(SEL.workspaces)
							if (nav) nav.style.removeProperty('display')
							if (ws) ws.style.removeProperty('display')
						}
					}

					function firstMissingAnchor() {
						var col = document.querySelector(SEL.col)
						if (!col) return 'sidebarCol(' + SEL.col + ')'
						if (!col.querySelector(SEL.nav)) return 'panelList(' + SEL.nav + ')'
						if (!col.querySelector(SEL.workspaces)) return 'regionArea(' + SEL.workspaces + ')'
						var nav = col.querySelector(SEL.nav)
						var ws = col.querySelector(SEL.workspaces)
						if (!nav.parentElement || !nav.parentElement.contains(ws)) return 'sidebarRoot(nav.parentElement)'
						return null
					}

					function ensureStyle() {
						if (styleTag) return
						styleTag = document.createElement('style')
						styleTag.dataset.plugin = PLUGIN_ID
						styleTag.dataset.pluginCss = CSS_MARKER
						styleTag.textContent = TABS_CSS
						document.head.appendChild(styleTag)
					}

					function makeTab(value, label, iconSvg) {
						var b = document.createElement('button')
						b.type = 'button'
						b.className = 'fdx-sbt-tab'
						b.dataset.tab = value
						b.setAttribute('role', 'tab')
						b.setAttribute('aria-selected', state === value ? 'true' : 'false')
						var icon = document.createElement('span')
						icon.innerHTML = iconSvg
						var text = document.createElement('span')
						text.textContent = label
						b.appendChild(icon.firstChild)
						b.appendChild(text)
						b.addEventListener('click', function () {
							select(value)
						})
						tabButtons[value] = b
						return b
					}

					function buildTabbar() {
						var bar = document.createElement('div')
						bar.className = 'fdx-sbt-bar'
						bar.dataset.plugin = PLUGIN_ID
						bar.setAttribute('role', 'tablist')
						bar.setAttribute('aria-label', '侧栏分区')
						tabButtons = {}
						bar.appendChild(makeTab(TAB_FUNC, '功能', ICON_FUNC))
						bar.appendChild(makeTab(TAB_WORKSPACE, '工作区', ICON_WORKSPACE))
						return bar
					}

					function select(value) {
						state = value
						persistTab(value)
						scheduleEnsure()
					}

					function syncState(anchors) {
						var rail = isRail(anchors.root)
						if (tabbar) {
							tabbar.dataset.rail = rail ? 'true' : 'false'
							/* tab 活动态与当前 state 对齐（select 与自愈重贴共用此路径） */
							for (var v in tabButtons) {
								var selected = state === v ? 'true' : 'false'
								if (tabButtons[v].getAttribute('aria-selected') !== selected) {
									tabButtons[v].setAttribute('aria-selected', selected)
								}
							}
						}
						if (rail) {
							/* 窄轨：两容器恢复官方现状可见性（tab 切换语义只在展开形态生效） */
							setDisplay(anchors.nav, true)
							setDisplay(anchors.workspaces, true)
						} else {
							setDisplay(anchors.nav, state === TAB_FUNC)
							setDisplay(anchors.workspaces, state === TAB_WORKSPACE)
						}
					}

					function watchRoot(root) {
						if (watchedRoot === root) return
						if (rootObserver) rootObserver.disconnect()
						rootObserver = new MutationObserver(scheduleEnsure)
						rootObserver.observe(root, { attributes: true, attributeFilter: ['class'] })
						watchedRoot = root
					}

					function placeTabbar(anchors) {
						if (!tabbar) tabbar = buildTabbar()
						if (tabbar.parentElement !== anchors.nav.parentElement || tabbar.nextSibling !== anchors.nav) {
							anchors.nav.parentElement.insertBefore(tabbar, anchors.nav)
						}
					}

					function ensure() {
						if (disposed) return
						var missing = firstMissingAnchor()
						if (missing) {
							/* 失配：零注入/零残留 + warn 一次（含失配锚点名；命中恢复时复位限流） */
							teardownDom()
							if (!warnedMissing) {
								warnedMissing = true
								console.warn(
									'fenix-dsh-sidebar-tabs: 侧栏锚点失配（' +
										missing +
										' 未命中），放弃注入 tab 控件，侧栏保持官方原生形态；官方 UI 升级后请按 README「签名字证与重钉指引」修缝',
								)
							}
							return
						}
						warnedMissing = false
						var col = document.querySelector(SEL.col)
						var nav = col.querySelector(SEL.nav)
						var anchors = { col: col, nav: nav, root: nav.parentElement, workspaces: col.querySelector(SEL.workspaces) }
						watchRoot(anchors.root)
						ensureStyle()
						placeTabbar(anchors)
						syncState(anchors)
					}

					/* 官方重渲染（会话增删/布局切换/收起展开）后自愈：结构类变更走
					 * documentElement 子树观察，root class 翻转（collapsed/quietBars）走
					 * root 属性观察；一次 mutation burst 去抖为一次 ensure。 */
					var treeObserver = new MutationObserver(scheduleEnsure)
					var rootObserver = null
					treeObserver.observe(document.documentElement, { childList: true, subtree: true })

					function scheduleEnsure() {
						if (scheduled || disposed) return
						scheduled = true
						queueMicrotask(function () {
							scheduled = false
							ensure()
						})
					}

					ensure()

					return function dispose() {
						disposed = true
						treeObserver.disconnect()
						if (rootObserver) rootObserver.disconnect()
						teardownDom()
						if (styleTag && styleTag.parentNode) styleTag.remove()
						styleTag = null
						tabbar = null
						watchedRoot = null
					}
				},
			}
		},
	})
})()
