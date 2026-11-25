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
 *   - 切换 = display 级可见性切换，MUST NOT reparent（官方 React
 *     管理子树，搬移与 reconciliation 冲突）；两容器保持各自独立滚动位置与官方更新能力；
 *   - 两个「更多」职责区分（2026-11-25 用户修正，推翻 2026-11-24 首版钉底）：
 *     nav 末项「更多」（dsw-icon-apps-add-outline-regular）是普通导航项——功能 tab
 *     按官方顺序正常显示、工作区 tab 随 nav 整体隐藏，不做任何特殊处理；
 *     footArea 内 Account 菜单触发钮「更多」（dsw-icon-ellipsis-outline-medium）
 *     才是常驻列底项；
 *   - footArea 钉底常显：展开态给 footArea margin-top:auto——功能 tab 下 regionArea
 *     display:none 后列内无 flex:1 元素，不补位则 footArea 随流上浮；工作区 tab 下
 *     regionArea flex:1 1 0% 吸满自由空间，auto margin 恒 0，统一贴 auto 无害；
 *     窄轨/teardown 清除复原；
 *   - 选择记忆：localStorage 键 fenix-dsh-sidebar-tabs.tab（'func'|'workspace'），
 *     缺失/非法值缺省 'workspace'；写入失败（存储禁用）不抛错、退化为会话内记忆；
 *   - 收起窄轨（root 带 collapsed 类）：tab 栏 display:none 不渲染、两容器恢复
 *     官方现状可见性、钉底 inline 清除；展开后恢复记忆 tab；
 *   - 常显：新会话按钮（controls）与 Account/footArea 不在 display 切换目标内，
 *     两 tab 态天然常显、行为不变；footArea 仅作钉底参照软锚点（缺席只降级钉底，
 *     不触发失配回退）；
 *   - 自愈：MutationObserver（结构子树 + root class）监听官方重渲染/收起切换，
 *     重贴 display 状态与 tab 栏在位（对齐 fenix-dsh-session-advanced-search
 *     持续维护模式；失配后恢复命中则自动重注入）；
 *   - 失配零副作用：任一必需锚点未命中 → 不注入 tab 栏、不注入 style、不动任何
 *     官方元素、零异常；warn 含失配锚点名且按锚点名限流（同锚一次、命中恢复复位），
 *     侧栏列未挂载（启动中）走 15s 静默宽限期，健康路径启动零告警噪声。
 *
 * 主题：颜色全部引用官方 token —— 轨道/活动块/文字随暗（body[data-ds-dark-theme]）
 * 浅主题自适应（原型 specs/add-sidebar-tabs-plugin/prototype 仅视觉参照）：
 *   轨道 浅 bluish-150 / 暗 bluish-850；活动块背景 = 轨道上的增白区分块（2026-11-24
 *   用户反馈：去底部指示条、选中背景增白）——浅 bluish-00（白）/ 暗 bluish-700；
 *   文字 --dsw-alias-label-*。
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
				/* 底部区（footerActions + Account/⋯ More 菜单）：仅作钉底软锚点，
				 * 不入 firstMissingAnchor 硬校验——footArea 缺席只降级钉底，不放弃整个插件 */
				foot: '[class*="footArea"]',
			}

			var TABS_CSS = [
				/* 分段控件轨道：原型分段控件（深色轨道 + 增白活动块，无指示条——
				 * 2026-11-24 用户反馈调整），高 30px tab、栏含 3px 内边距、左右 12px 边距；
				 * token 随官方暗/浅主题自适应 */
				'.fdx-sbt-bar { --fdx-sbt-track: var(--dsw-static-neutral-bluish-150); --fdx-sbt-active-bg: var(--dsw-static-neutral-bluish-00); margin: 0 12px 8px; flex: none; background: var(--fdx-sbt-track); border-radius: 8px; padding: 3px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }',
				'body[data-ds-dark-theme] .fdx-sbt-bar { --fdx-sbt-track: var(--dsw-static-neutral-bluish-850); --fdx-sbt-active-bg: var(--dsw-static-neutral-bluish-700); }',
				/* 收起窄轨：tab 栏不渲染（窄轨内容与官方现状一致） */
				'.fdx-sbt-bar[data-rail="true"] { display: none; }',
				'.fdx-sbt-tab { all: unset; box-sizing: border-box; position: relative; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer; }',
				'.fdx-sbt-tab:hover { color: var(--dsw-alias-label-primary); }',
				'.fdx-sbt-tab:focus-visible { outline: 2px solid var(--dsw-static-deepseek-400); outline-offset: -2px; }',
				'.fdx-sbt-tab[aria-selected="true"] { background: var(--fdx-sbt-active-bg); color: var(--dsw-alias-label-primary); }',
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
					var warnedMissing = null
					var missingColSince = null
					var graceTimer = null
					var scheduled = false
					/* 侧栏列挂载宽限期：超过此时长仍未见列元素按失配告警（健康路径
					 * ~1s 挂载；隔离实例冷启动首访需在线装配组合 bundle，实测可到
					 * 10s+，15s 覆盖之） */
					var LOAD_GRACE_MS = 15000

					function setDisplay(el, visible) {
						if (visible) {
							if (el.style.display) el.style.removeProperty('display')
						} else {
							el.style.setProperty('display', 'none')
						}
					}

					/* footArea 钉底常显（2026-11-25 用户修正：侧栏底部常驻列底的是
					 * footArea 内 Account 菜单触发钮「更多」（ellipsis 图标）；nav 末项
					 * 「更多」（apps-add 图标）是普通导航项，随导航整体显隐，不特殊处理）。
					 * root 官方即 flex column、footArea 为末位 flex 0 0 auto：功能 tab 下
					 * regionArea display:none 使列内失去唯一 flex 1 1 0% 元素，footArea
					 * 会随流上浮——margin-top:auto 补位钉回列底；工作区 tab 下 regionArea
					 * 吸满自由空间，auto margin 恒 0，两 tab 统一贴 auto 无害。零 reparent、
					 * 零 order 重排（DOM 序 logo,controls,tab栏,nav,region,foot 在两 tab
					 * 下各自只剩一方可见，天然即正确视觉序）。
					 * inline style 变更是 attribute 变更，不触发 childList treeObserver，
					 * 无反馈环；syncState 每轮自愈重贴，幂等。 */
					function applyFootPin(root) {
						var foot = root ? root.querySelector(SEL.foot) : null
						if (foot) foot.style.setProperty('margin-top', 'auto')
					}

					/* 清除钉底 inline（窄轨复原官方原生形态；teardown 同源） */
					function clearPinning(root) {
						var foot = root ? root.querySelector(SEL.foot) : null
						if (foot) foot.style.removeProperty('margin-top')
					}

					/* 按 D5 失配语义回退：移除 tab 栏、清掉全部本插件对官方元素的可见性改写 */
					function teardownDom() {
						if (tabbar && tabbar.parentNode) tabbar.remove()
						var col = document.querySelector(SEL.col)
						if (col) {
							var nav = col.querySelector(SEL.nav)
							var ws = col.querySelector(SEL.workspaces)
							clearPinning(nav ? nav.parentElement : null)
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

					/* 失配告警（限流按失配锚点名：同锚只 warn 一次，命中恢复即复位；
					 * 不同锚各自报——启动瞬态不得吞掉真失配的锚点名，2026-11-24 真机
					 * 演练返工点：warn-once 全局限流曾把真失配告警吞掉）。 */
					function warnMissing(anchor) {
						teardownDom()
						if (warnedMissing !== anchor) {
							warnedMissing = anchor
							console.warn(
								'fenix-dsh-sidebar-tabs: 侧栏锚点失配（' +
									anchor +
									' 未命中），放弃注入 tab 控件，侧栏保持官方原生形态；官方 UI 升级后请按 README「签名字证与重钉指引」修缝',
							)
						}
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
							/* 窄轨：两容器恢复官方现状可见性、钉底 inline 全清
							 * （tab 切换与钉底语义只在展开形态生效） */
							setDisplay(anchors.nav, true)
							setDisplay(anchors.workspaces, true)
							clearPinning(anchors.root)
						} else {
							/* 分区互斥：功能 tab 显 nav（8 项按官方序，apps-add「更多」即
							 * 普通末项）、隐 regionArea；工作区 tab 整体隐藏 nav（含
							 * apps-add「更多」）、显 regionArea；footArea（⋯ More）两 tab
							 * 恒钉列底 */
							setDisplay(anchors.nav, state === TAB_FUNC)
							setDisplay(anchors.workspaces, state !== TAB_FUNC)
							applyFootPin(anchors.root)
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
						var col = document.querySelector(SEL.col)
						if (!col) {
							/* 侧栏列未挂载（应用启动中/无侧栏页面）：静默宽限等待挂载，
							 * 超时（LOAD_GRACE_MS）仍未出现按失配告警——启动瞬态 MUST
							 * NOT 消耗失配限流（真失配的锚点名必须能进日志）。 */
							if (missingColSince === null) {
								missingColSince = Date.now()
								graceTimer = setTimeout(scheduleEnsure, LOAD_GRACE_MS)
								/* 首见缺失：静默起表等待挂载（MUST NOT 落穿到告警——
								 * 落穿即「首次 miss 必告警」，宽限期形同虚设，
								 * 2026-11-24 真机演练返工点） */
								return
							}
							if (Date.now() - missingColSince < LOAD_GRACE_MS) {
								return
							}
							warnMissing('sidebarCol(' + SEL.col + ')')
							return
						}
						missingColSince = null
						if (graceTimer) {
							clearTimeout(graceTimer)
							graceTimer = null
						}
						var nav = col.querySelector(SEL.nav)
						if (!nav) {
							warnMissing('panelList(' + SEL.nav + ')')
							return
						}
						var ws = col.querySelector(SEL.workspaces)
						if (!ws) {
							warnMissing('regionArea(' + SEL.workspaces + ')')
							return
						}
						var root = nav.parentElement
						if (!root || !root.contains(ws)) {
							warnMissing('sidebarRoot(nav.parentElement)')
							return
						}
						/* 命中恢复：失配限流复位（失配→修复→再失配可再次告警） */
						warnedMissing = null
						var anchors = { col: col, nav: nav, root: root, workspaces: ws }
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
						if (graceTimer) {
							clearTimeout(graceTimer)
							graceTimer = null
						}
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
