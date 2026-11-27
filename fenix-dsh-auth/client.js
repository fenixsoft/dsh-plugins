/**
 * fenix-dsh-auth — Client 半（零构建，形态对齐 fenix-dsh-brand-fenix /
 * fenix-dsh-chat-polish）。
 *
 * 提供登录设置分区组件：用户名/密码/确认密码输入、「保存」与「移除账号
 * 密码」操作、当前配置状态行。凭据读写走宿主半端点
 * `GET/POST/DELETE /auth/credentials`（JSON），未认证 401 / 校验失败 400 /
 * 跨源 403 均有对应提示。
 *
 * 槽契约（0.2.0 起改私有嵌入槽，独立「登录」分区退役）：
 *   - 不再注册官方 settings.section / settings.section.icon —— DSH 设置
 *     导航不再出现独立登录分区（2026-11-26 用户指示：登录设置已合并进
 *     fenix-dsh-chat-polish 的「Fenix 插件」分区「快捷登录」卡片）。
 *   - 改注册私有子槽 `fenix.auth.embed`：该槽名由 fenix-dsh-chat-polish
 *     的 settings.section 注册项以 children 表声明（官方机制：声明随宿主
 *     分区条目存续；slot store 对未声明槽名的 register 恒 throw，故必须
 *     由宿主声明、本插件只注册）。本插件 `ctx.slots.inject('fenix.auth.embed',
 *     …)` 等声明就绪后注册 AuthSection（两插件加载顺序无关）；宿主分区
 *     条目卸载时 store releaseChildren 连带注销本注册项，无孤儿残留。
 *   - chat-polish 侧按 entries('fenix.auth.embed') 命中 id 'fenix-auth'
 *     嵌入组件（升级窗口期旧版 auth ≤0.1.x 仍自注册官方 settings.section，
 *     chat-polish 0.4.0 起对该槽保留兼容扫描，新旧并存时以私槽注册项为准）。
 *     私槽未声明（chat-polish 缺席/卸载）= AuthSection 不渲染，插件保持
 *     激活无副作用。
 *
 * 视觉约束（design D5）：复用 @deepseek-ai/dsh-client-ui-primitives 基元
 * （Button）与宿主主题变量（--dsw-alias-label-* / --dsw-alias-border-l2 /
 * --dsw-specific-input-major 等，fenix-dsh-chat-polish 先例验证过的别名）；
 * 无 animation/transition；不注入全局 <style>、不覆盖其它分区（全部内联
 * style，作用域限于本分区元素）。
 *
 * 降级：宿主半契约失配时 /auth/credentials 不可达，分区操作得到网络错误
 * 提示，不影响官方设置弹窗其余分区。
 *
 * i18n（宿主语言跟随轮）：全部分区 UI 文案（输入标签 / 状态行
 * / 错误与成功消息）走本文件内嵌小词典（bridge pluginLocale 小词典模式移植
 * ，键值双列，zh 列=历史硬编码串逐字），宿主档经 installLocaleFollow 读
 * `ctx.locale` 快照 + locale/change 事件跟随（bridge 轮询口径：late provide
 * 1s 重试）；宿主语言能力缺席时降级 zh 档 = 现状行为。边界：分区内部文案
 * 在组件渲染期求值，宿主切语言后弹窗已打开的分区要等下次渲染（重开弹窗/
 * 状态变更）才换档，不做 bridge 式遮蔽重注册触发。
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-auth',
		factory(require) {
			var react = require('react')
			var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
			var Button = primitives.Button
			var createElement = react.createElement
			var useEffect = react.useEffect
			var useState = react.useState
			var useRef = react.useRef

			/* 主题变量快捷引用（缺省值兜底浅色形态，暗色由宿主变量接管） */
			var COLOR_LABEL = 'var(--dsw-alias-label-primary, #1a1a1a)'
			var COLOR_LABEL_SECONDARY = 'var(--dsw-alias-label-secondary, #555)'
			var COLOR_BORDER = 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))'
			var COLOR_INPUT_BG = 'var(--dsw-specific-input-major, transparent)'
			var COLOR_DANGER = 'var(--dsw-specific-danger-major, #dc2626)'
			var COLOR_OK = 'var(--dsw-specific-success-major, #16a34a)'

			var rowStyle = { margin: '0 0 12px' }
			var labelStyle = { display: 'block', margin: '12px 0 4px', fontSize: 13, color: COLOR_LABEL_SECONDARY }
			var inputStyle = {
				width: '100%',
				padding: '6px 10px',
				fontSize: 14,
				border: '1px solid ' + COLOR_BORDER,
				borderRadius: 'var(--dsw-radius-md, 8px)',
				background: COLOR_INPUT_BG,
				color: COLOR_LABEL,
				boxSizing: 'border-box',
			}
			var messageStyle = function (color) {
				return { margin: '12px 0 0', fontSize: 13, color: color }
			}

			/* fetch 超时兜底（毫秒）：服务挂起（重启窗口、代理 hang、半开连接）
			 * 时请求可能长期不 settle，导致按钮永久 disabled / 状态行无限停留。 */
			var FETCH_TIMEOUT_MS = 10000

			/** 带超时的 fetch：AbortController + setTimeout，超时 abort（调用方
			 * catch 收到 AbortError，按「请求超时」提示并复位 busy/loading）。
			 * 计时器覆盖到 body 读取完成：fetch 在响应头到达即 settle，若此刻
			 * 就清 timer，response.json() 读 body 悬挂（半开代理、网关截断）
			 * 便无兜底，loading/busy 永不复位——故返回轻量响应壳（调用点仅
			 * 消费 ok/status/json），json() 读取收口或 fetch 失败才清 timer；
			 * 不读 body 的路径由 timer 到期 abort 自然收尾（对已 settle 的
			 * 请求是 no-op，无副作用）。 */
			function fetchWithTimeout(url, options, timeoutMs) {
				var controller = new AbortController()
				var timer = setTimeout(function () {
					controller.abort()
				}, timeoutMs === undefined ? FETCH_TIMEOUT_MS : timeoutMs)
				var init = options ? Object.assign({}, options) : {}
				init.signal = controller.signal
				return fetch(url, init).then(function (response) {
					return {
						ok: response.ok,
						status: response.status,
						json: function () {
							return response.json().finally(function () {
								clearTimeout(timer)
							})
						},
					}
				}, function (err) {
					clearTimeout(timer)
					throw err
				})
			}

			/** 识别超时 abort 抛出的 AbortError。 */
			function isAbortError(err) {
				return Boolean(err) && err.name === 'AbortError'
			}

			/* ==================== i18n 宿主语言跟随（bridge pluginLocale
			 * 小词典模式移植，零构建单文件形态） ==================== */

			/* 宿主档缓存（undefined = 语言能力缺席，降级 zh 档 = 现状行为）。
			 * installLocaleFollow 装入快照与 locale/change 事件各刷新一次。 */
			var cachedLocale

			/** 宿主档归一（bridge normalizeLocaleScheme 白名单口径逐字对齐）：
			 * 'zh'→'zh-CN'、'en'→'en-US'、fenix 档值原样通过，其余（含
			 * undefined/形状漂移值）返回 undefined。 */
			function normalizeLocale(value) {
				if (value === 'zh') return 'zh-CN'
				if (value === 'en') return 'en-US'
				return value === 'zh-CN' || value === 'en-US' ? value : undefined
			}

			/** 快照 → 白名单档（locale/change listener 的宽面入参在此收窄；
			 * 非对象快照/形状漂移一律 undefined）。 */
			function localeOf(snapshot) {
				if (!snapshot || typeof snapshot !== 'object') return undefined
				return normalizeLocale(snapshot.active)
			}

			/** 文案键值对（zh 为历史硬编码串逐字，en 对应译）。 */
			var AUTH_DICT = {
				/* 控件 */
				'auth.label.username': ['用户名', 'Username'],
				'auth.label.password': ['密码（至少 8 个字符）', 'Password (at least 8 characters)'],
				'auth.label.confirm': ['确认密码', 'Confirm password'],
				'auth.action.save': ['保存', 'Save'],
				'auth.action.remove': ['移除账号密码', 'Remove account password'],
				'auth.confirm.remove': ['确定移除账号密码？移除后 dsh web 将回退为仅 token 登录。', 'Remove the account password? dsh web will then fall back to token-only sign-in.'],
				/* 状态行 */
				'auth.status.loading': ['读取中…', 'Loading…'],
				'auth.status.unknown': ['状态未知', 'Status unknown'],
				'auth.status.configured': ['已配置账号密码：', 'Account password configured: '],
				'auth.status.notConfigured': ['未配置账号密码（仅 token 登录）', 'No account password configured (token-only sign-in)'],
				/* 成功消息 */
				'auth.msg.saved': ['已保存账号密码', 'Account password saved'],
				'auth.msg.removed': ['已移除账号密码，回退为仅 token 登录', 'Account password removed; token-only sign-in restored'],
				/* 错误消息（带插值的 HTTP/校验码串按 bridge stats 同款前后缀分段） */
				'auth.err.loginRequired': ['请先登录后再配置账号密码', 'Sign in before configuring the account password'],
				'auth.err.loginRequiredRemove': ['请先登录后再操作', 'Please sign in first'],
				'auth.err.invalidUsername': ['用户名需要 1-64 个字符', 'Username must be 1-64 characters'],
				'auth.err.passwordTooShort': ['密码至少 8 个字符', 'Password must be at least 8 characters'],
				'auth.err.confirmMismatch': ['两次输入的密码不一致', 'Passwords do not match'],
				'auth.err.bodyTooLarge': ['请求体过大', 'Request body too large'],
				'auth.err.unsupportedBody': ['请求格式不受支持', 'Unsupported request body format'],
				'auth.err.crossOrigin': ['跨源请求被拒绝', 'Cross-origin request rejected'],
				'auth.err.malformed': ['凭据状态响应格式异常（HTTP ', 'Malformed credential status response (HTTP '],
				'auth.err.readFailed': ['读取登录凭据失败（HTTP ', 'Failed to read credential status (HTTP '],
				'auth.err.readTimeout': ['读取登录凭据请求超时', 'Credential status request timed out'],
				'auth.err.unreachable': ['登录插件服务不可达（宿主半可能已降级）', 'Auth plugin service unreachable (the host half may be degraded)'],
				'auth.err.validation': ['校验失败（', 'Validation failed ('],
				'auth.err.validationHttp': ['校验失败（HTTP 400）', 'Validation failed (HTTP 400)'],
				'auth.err.saveFailed': ['保存失败（HTTP ', 'Save failed (HTTP '],
				'auth.err.saveTimeout': ['保存失败：请求超时', 'Save failed: request timed out'],
				'auth.err.saveUnreachable': ['保存失败：服务不可达', 'Save failed: service unreachable'],
				'auth.err.removeFailed': ['移除失败（HTTP ', 'Remove failed (HTTP '],
				'auth.err.removeTimeout': ['移除失败：请求超时', 'Remove failed: request timed out'],
				'auth.err.removeUnreachable': ['移除失败：服务不可达', 'Remove failed: service unreachable'],
				/* 拼接收尾括号（`（HTTP 404）` / `（<error>）` 尾段，zh/en 各自配对） */
				'auth.common.parenClose': ['）', ')'],
			}

			/** 取文案（渲染/求值期调用，返回当前档串）：en 档取 en 列，zh 档与
			 * 降级路径取 zh 列；键不存在回退键名本身（开发期可见）。 */
			function t(key) {
				var entry = AUTH_DICT[key]
				if (!entry) return key
				return cachedLocale === 'en-US' ? entry[1] : entry[0]
			}

			/** 宿主语言跟随装配（bridge installLocaleFollow 轮询口径移植）：
			 * locale 服务 late provide（async apply 晚于本插件同步 apply）→
			 * 未就绪 1s 重试直至终局；成功即订阅 locale/change 刷新缓存。降级
			 * （bridge 同款「宁缺毋错」）：ctx.locale 缺席/属性访问抛错（cordis
			 * proxy 对未 inject 服务）→ 继续等；订阅面缺席/快照非白名单坏值 →
			 * 终局降级（缓存恒 undefined，t() 走 zh 档 = 现状行为），零报错。
			 * 返回收口函数（停轮询 + 退订 + 清缓存）。 */
			function installLocaleFollow(ctx) {
				cachedLocale = undefined /* 装入即重置：降级路径缓存恒 undefined，重装不残留旧档 */
				var stopped = false
				var timer = 0
				var unsubscribe
				var subscribe = function () {
					try {
						var dispose = ctx.on('locale/change', function (snapshot) {
							var loc = localeOf(snapshot)
							if (loc === undefined) return /* 白名单外值：缓存保持 last-known-good */
							cachedLocale = loc
						})
						if (typeof dispose === 'function') unsubscribe = dispose
					} catch (err) {
						/* 订阅抛错：不订阅，只失实时跟随，快照档已落缓存 */
					}
				}
				/* 单轮接入尝试：true = 已终局（成功或降级），false = 未就绪需再等。 */
				var attempt = function () {
					try {
						var localeService = ctx ? ctx.locale : null
						if (!localeService || typeof localeService.getSnapshot !== 'function') return false
						if (typeof ctx.on !== 'function') return true /* 订阅面缺席：无法跟随，终局降级 */
						var initial
						try {
							var snap = localeService.getSnapshot()
							var raw = snap ? snap.active : undefined
							if (raw === undefined || raw === null || raw === '') return false /* 早期空快照：等 settings 回同步 */
							initial = normalizeLocale(raw)
						} catch (err) {
							return false /* getSnapshot 抛错（形状漂移/未就绪）：继续等 */
						}
						if (initial === undefined) return true /* 非空且非白名单：坏值，宁缺毋错 */
						cachedLocale = initial
						subscribe()
						return true
					} catch (err) {
						return false /* ctx.locale 属性访问抛错（cordis proxy）→ 继续等 */
					}
				}
				var poll = function () {
					if (stopped) return
					if (attempt()) return /* 终局（成功或降级），不再排程 */
					timer = setTimeout(poll, 1000) /* 未就绪：1s 后再试（locale 服务 late provide） */
				}
				poll()
				return function () {
					stopped = true
					if (timer) clearTimeout(timer)
					if (typeof unsubscribe === 'function') {
						try {
							unsubscribe()
						} catch (err) {
							/* 收口自守 */
						}
					}
					cachedLocale = undefined
				}
			}

			/** 读取凭据状态；非 2xx 返回 null（由调用方按错误提示）。2xx 响应体
			 * 非 JSON（网关错误页、半截响应等）时以 malformedBody 标记，与网络
			 * 不可达区分；abort 异常原样上抛（超时文案口径不变）。 */
			function fetchCredentials() {
				return fetchWithTimeout('/auth/credentials', { method: 'GET' }).then(function (response) {
					if (!response.ok) return { response: response, data: null }
					return response.json().then(function (data) {
						return { response: response, data: data }
					}).catch(function (err) {
						if (isAbortError(err)) throw err
						return { response: response, data: null, malformedBody: true }
					})
				})
			}

			/** 登录设置分区组件（私有嵌入槽 fenix.auth.embed；chat-polish 嵌入
			 * 时透传官方 close 回调，组件收 props 但不消费）。 */
			function AuthSection() {
				var state = useState('loading') /* loading | ready */
				var loading = state[0]
				var setLoading = state[1]
				var statusState = useState(null) /* {configured, username} */
				var status = statusState[0]
				var setStatus = statusState[1]
				var usernameState = useState('')
				var username = usernameState[0]
				var setUsername = usernameState[1]
				var passwordState = useState('')
				var password = passwordState[0]
				var setPassword = passwordState[1]
				var confirmState = useState('')
				var confirm = confirmState[0]
				var setConfirm = confirmState[1]
				var messageState = useState(null) /* {kind: 'ok'|'error', text} */
				var message = messageState[0]
				var setMessage = messageState[1]
				var busyState = useState(false)
				var busy = busyState[0]
				var setBusy = busyState[1]
				/* 卸载旗标（ref 版，跨渲染持久）：onSave/onRemove 的异步回调在弹窗
				 * 关闭（组件卸载）后跳过 setState，与 useEffect 的 cancelled 旗标
				 * 同口径。 */
				var unmountedRef = useRef(false)

				/* 挂载回填：GET {configured, username}；401 = 未登录（dsh 会话过期）。 */
				useEffect(function () {
					/* 复位卸载旗标：StrictMode 开发态 mount→cleanup→再 mount 会重跑
					 * 本 effect，不复位则二次挂载后异步响应回调被永久跳过。 */
					unmountedRef.current = false
					var cancelled = false
					fetchCredentials().then(function (result) {
						if (cancelled) return
						if (result.data !== null) {
							setStatus(result.data)
							if (result.data.configured) setUsername(String(result.data.username ?? ''))
							setLoading('ready')
						} else if (result.response.status === 401) {
							setMessage({ kind: 'error', text: t('auth.err.loginRequired') })
							setLoading('ready')
						} else if (result.malformedBody) {
							setMessage({ kind: 'error', text: t('auth.err.malformed') + result.response.status + t('auth.common.parenClose') })
							setLoading('ready')
						} else {
							setMessage({ kind: 'error', text: t('auth.err.readFailed') + result.response.status + t('auth.common.parenClose') })
							setLoading('ready')
						}
					}).catch(function (err) {
						if (cancelled) return
						setMessage({ kind: 'error', text: isAbortError(err) ? t('auth.err.readTimeout') : t('auth.err.unreachable') })
						setLoading('ready')
					})
					return function () {
						cancelled = true
						unmountedRef.current = true
					}
				}, [])

				function onSave() {
					if (busy) return
					if (username.length < 1 || username.length > 64) {
						setMessage({ kind: 'error', text: t('auth.err.invalidUsername') })
						return
					}
					if (password.length < 8) {
						setMessage({ kind: 'error', text: t('auth.err.passwordTooShort') })
						return
					}
					if (confirm !== password) {
						setMessage({ kind: 'error', text: t('auth.err.confirmMismatch') })
						return
					}
					setBusy(true)
					setMessage(null)
					fetchWithTimeout('/auth/credentials', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						/* confirm 仅用于客户端一致性校验，不随请求体发送（服务端该
						 * 字段可选，validateCredentialInput 缺省跳过一致性校验）。 */
						body: JSON.stringify({ username: username, password: password }),
					}).then(function (response) {
						if (unmountedRef.current) return
						if (response.ok) {
							setStatus({ configured: true, username: username })
							setPassword('')
							setConfirm('')
							setMessage({ kind: 'ok', text: t('auth.msg.saved') })
						} else if (response.status === 401) {
							setMessage({ kind: 'error', text: t('auth.err.loginRequired') })
						} else if (response.status === 400) {
							/* return 把 json 链纳入外层 promise 链：细分文案落定后才走到
							 * 链尾 finally 复位 busy（悬空时按钮先恢复可点、提示后到，
							 * 窗口内重复点击会二次 POST 并竞写消息；解析失败仍由下方
							 * .catch 收口成 validationHttp 文案，再走 finally）。 */
							return response.json().then(function (data) {
								if (unmountedRef.current) return
								var texts = {
									'invalid-username': t('auth.err.invalidUsername'),
									'password-too-short': t('auth.err.passwordTooShort'),
									'confirm-mismatch': t('auth.err.confirmMismatch'),
									'body-too-large': t('auth.err.bodyTooLarge'),
									'unsupported-body': t('auth.err.unsupportedBody'),
								}
								/* 白名单取值（对齐 host 半 normalizeLoginError 的
								 * Object.hasOwn 口径）：裸下标会命中 Object.prototype
								 * 键（如 'constructor'），取到函数等非字符串渲染。 */
								var rawError = data && data.error
								var text = typeof rawError === 'string' && Object.hasOwn(texts, rawError) ? texts[rawError] : t('auth.err.validation') + String(rawError) + t('auth.common.parenClose')
								setMessage({ kind: 'error', text: text })
							}).catch(function (err) {
								/* body 阶段超时 abort 原样上抛 → 外层 catch 走
								 * saveTimeout 文案（与 fetchCredentials 同口径）。 */
								if (isAbortError(err)) throw err
								if (unmountedRef.current) return
								setMessage({ kind: 'error', text: t('auth.err.validationHttp') })
							})
						} else if (response.status === 403) {
							setMessage({ kind: 'error', text: t('auth.err.crossOrigin') })
						} else {
							setMessage({ kind: 'error', text: t('auth.err.saveFailed') + response.status + t('auth.common.parenClose') })
						}
					}).catch(function (err) {
						if (unmountedRef.current) return
						setMessage({ kind: 'error', text: isAbortError(err) ? t('auth.err.saveTimeout') : t('auth.err.saveUnreachable') })
					}).finally(function () {
						if (unmountedRef.current) return
						setBusy(false)
					})
				}

				function onRemove() {
					if (busy) return
					if (!window.confirm(t('auth.confirm.remove'))) return
					setBusy(true)
					setMessage(null)
					fetchWithTimeout('/auth/credentials', { method: 'DELETE' }).then(function (response) {
						if (unmountedRef.current) return
						if (response.ok) {
							setStatus({ configured: false, username: null })
							setPassword('')
							setConfirm('')
							setMessage({ kind: 'ok', text: t('auth.msg.removed') })
						} else if (response.status === 401) {
							setMessage({ kind: 'error', text: t('auth.err.loginRequiredRemove') })
						} else {
							setMessage({ kind: 'error', text: t('auth.err.removeFailed') + response.status + t('auth.common.parenClose') })
						}
					}).catch(function (err) {
						if (unmountedRef.current) return
						setMessage({ kind: 'error', text: isAbortError(err) ? t('auth.err.removeTimeout') : t('auth.err.removeUnreachable') })
					}).finally(function () {
						if (unmountedRef.current) return
						setBusy(false)
					})
				}

				var statusText = loading === 'loading'
					? t('auth.status.loading')
					: status === null
						? t('auth.status.unknown')
						: status.configured
							? t('auth.status.configured') + String(status.username ?? '')
							: t('auth.status.notConfigured')

				return createElement('div', { style: { paddingBottom: 16 } },
					/* 「账号密码登录」标题已移除（2026-11-25 用户要求）：分区 nav
					 * 标签/chat-polish 快捷登录组名已表达语境，行内标题冗余 */
					createElement('p', { style: { margin: rowStyle.margin, fontSize: 13, color: COLOR_LABEL_SECONDARY } }, statusText),
					createElement('label', { style: labelStyle, htmlFor: 'fenix-auth-username' }, t('auth.label.username')),
					createElement('input', {
						id: 'fenix-auth-username',
						style: inputStyle,
						value: username,
						autoComplete: 'username',
						onChange: function (event) { setUsername(event.target.value) },
					}),
					createElement('label', { style: labelStyle, htmlFor: 'fenix-auth-password' }, t('auth.label.password')),
					createElement('input', {
						id: 'fenix-auth-password',
						style: inputStyle,
						type: 'password',
						value: password,
						autoComplete: 'new-password',
						onChange: function (event) { setPassword(event.target.value) },
					}),
					createElement('label', { style: labelStyle, htmlFor: 'fenix-auth-confirm' }, t('auth.label.confirm')),
					createElement('input', {
						id: 'fenix-auth-confirm',
						style: inputStyle,
						type: 'password',
						value: confirm,
						autoComplete: 'new-password',
						onChange: function (event) { setConfirm(event.target.value) },
					}),
					createElement('div', { style: { display: 'flex', gap: 8, marginTop: 16 } },
						createElement(Button, { variant: 'outline', disabled: busy, onClick: onSave }, t('auth.action.save')),
						createElement(Button, { variant: 'ghost', disabled: busy, onClick: onRemove }, t('auth.action.remove')),
					),
					message !== null ? createElement('p', { style: messageStyle(message.kind === 'ok' ? COLOR_OK : COLOR_DANGER), role: 'alert' }, message.text) : null,
				)
			}

			return {
				/* 浏览器侧 cordis 同样要求服务依赖声明（brand-fenix 先例）：
				 * 未声明 inject 时 ctx.slots 属性访问 throw，模块 boot 即 failed。 */
				inject: ['slots'],
				apply(ctx) {
					/* 宿主语言跟随装配（i18n 宿主跟随轮）：接入点 MUST 先于槽位
					 * 注册——嵌入组件内所有文案在渲染期实时求值，晚装入会让首轮
					 * 渲染取到未初始化缓存（bridge apply 同款纪律）。
					 * 内部自带降级与轮询，返回收口函数在 dispose 统一调用。 */
					/* 服务闸（2026-11-26 真机实证）：ctx.locale 只对「inject 声明过
					 * locale 的 fiber」放行（未声明属性访问恒抛 cannot get property
					 * "locale" without inject），本插件 apply ctx 只声明 slots（fence
					 * 约束：静态声明宿主缺服务 = 激活永远 pending）→ 装配经运行时
					 * inject 子上下文（cc-import lib/client.js:5017 同款形态）：子
					 * fiber 持 ['locale'] 声明，服务就绪后回调触发，属性访问过闸；
					 * 原轮询路径保留作无害兜底。 */
					var localeFollowDisposed = false
					var stopLocaleFollow = function () {}
					/* 运行时 inject 缝探测+包裹（对齐 session-advanced-search
					 * hostFollow 口径）：宿主形态漂移（ctx 无 inject 缝/缝抛错）时
					 * 仅语言跟随放弃（缓存恒 undefined，t() 走 zh 档 =
					 * installLocaleFollow 既有降级终局），不阻断下方槽位注册装配。 */
					var injectRuntime = null
					try {
						if (typeof ctx.inject === 'function') injectRuntime = ctx.inject.bind(ctx)
					} catch (err) {
						/* ctx.inject 属性访问抛错（cordis proxy 形态漂移）→ 视同缝缺席 */
					}
					if (injectRuntime !== null) {
						try {
							injectRuntime(['locale'], function (localeCtx) {
								if (localeFollowDisposed) return
								stopLocaleFollow = installLocaleFollow(localeCtx)
								return stopLocaleFollow
							})
						} catch (err) {
							/* inject 缝抛错（宿主形态漂移）：语言跟随放弃，零报错（宁缺毋错） */
						}
					}
					/* 注册私有嵌入槽 fenix.auth.embed（声明方 = fenix-dsh-chat-polish
					 * 的 settings.section 注册项 children 表，头注「槽契约」节）：
					 * inject 等声明就绪后触发（两插件加载顺序无关），工厂返回
					 * register 注销 disposer 由宿主框架在插件卸载时收集执行；宿主
					 * 分区条目卸载时 store releaseChildren 连带注销本注册项（无
					 * 孤儿）。注册项仅带 id（私槽不投影导航，无 order/label 语义；
					 * chat-polish 探测锚仍是 options.id==='fenix-auth'）。逐槽
					 * try/catch 降级：私槽注册失配仅登录卡片缺席（console.warn），
					 * 不影响宿主分区本体。 */
					var failures = []
					var stage = function (name, err) {
						console.warn('[fenix-dsh-auth] slot injection "' + name + '" rejected: ' + (err && err.stack ? err.stack : String(err)))
						failures.push(name)
					}
					try {
						ctx.slots.inject('fenix.auth.embed', function () {
							return ctx.slots.register({
								name: 'fenix.auth.embed',
								id: 'fenix-auth',
							}, AuthSection)
						})
					} catch (err) {
						stage('fenix.auth.embed', err)
					}
					return function dispose() {
						/* [fenix-ignore:44ca15f49734] 槽位回收已由宿主框架接管：inject 工厂返回 ctx.slots.register 的注销 disposer（dsh-runtime.d.ts 契约「工厂返回值由框架在插件卸载时收集执行」，chat-polish 同款形态、bridge apply 注释同口径），dispose 无需再保存 disposer；声明方卸载路径的连带注销由 store releaseChildren 负责。 */
						localeFollowDisposed = true
						stopLocaleFollow()
						return failures.length === 0
					}
				},
			}
		},
	})
})()
