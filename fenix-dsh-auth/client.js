/**
 * fenix-dsh-auth — Client 半（零构建，形态对齐 fenix-dsh-brand-fenix /
 * fenix-dsh-chat-polish）。
 *
 * 在官方设置弹窗（ui-settings-general 的 settings.section 槽，dsh 0.2.2-rc.1
 * 契约）注册「登录」分区：用户名/密码/确认密码输入、「保存」与「移除账号
 * 密码」操作、当前配置状态行。凭据读写走宿主半端点
 * `GET/POST/DELETE /auth/credentials`（JSON），未认证 401 / 校验失败 400 /
 * 跨源 403 均有对应提示。
 *
 * 槽契约（发行包核实）：
 *   - settings.section：list 槽；注册项 `{id, order, label, locale}`，组件
 *     收 renderSlot 传入的 `{close}` 与运行时 props；nav 行按 order 升序。
 *     order 动态探测官方注册尾（account=-10 / general=0 / models=10 /
 *     plugins=15）取 max+1，枚举不可用时回退 15（官方已知尾值）→ 16。
 *   - settings.section.icon：list + inline 槽；组件收 `{size, active}`；
 *     未注册时官方 fallback navIcon 未知 id 无专属图标，故注册同款官方
 *     账户图标（primitives IconUserOutlineMedium，account 分区在用）。
 *
 * 视觉约束（design D5）：复用 @deepseek-ai/dsh-client-ui-primitives 基元
 * （Button）与宿主主题变量（--dsw-alias-label-* / --dsw-alias-border-l2 /
 * --dsw-specific-input-major 等，fenix-dsh-chat-polish 先例验证过的别名）；
 * 无 animation/transition；不注入全局 <style>、不覆盖其它分区（全部内联
 * style，作用域限于本分区元素）。
 *
 * 降级：宿主半契约失配时 /auth/credentials 不可达，分区操作得到网络错误
 * 提示，不影响官方设置弹窗其余分区。
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-auth',
		factory(require) {
			var react = require('react')
			var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
			var Button = primitives.Button
			var AccountIcon = primitives.IconUserOutlineMedium
			var createElement = react.createElement
			var useEffect = react.useEffect
			var useState = react.useState

			/* 官方注册尾兜底值（0.2.2-rc.1 实测：plugins=15；动态探测失败时本
			 * 分区落在 official 尾部 +1，不与官方分区争序）。 */
			var FALLBACK_MAX_ORDER = 15

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
				maxWidth: 320,
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

			/** 读取凭据状态；非 2xx 返回 null（由调用方按错误提示）。 */
			function fetchCredentials() {
				return fetch('/auth/credentials', { method: 'GET' }).then(function (response) {
					if (!response.ok) return { response: response, data: null }
					return response.json().then(function (data) {
						return { response: response, data: data }
					})
				})
			}

			/** 「登录」分区组件（settings.section 槽）。 */
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

				/* 挂载回填：GET {configured, username}；401 = 未登录（dsh 会话过期）。 */
				useEffect(function () {
					var cancelled = false
					fetchCredentials().then(function (result) {
						if (cancelled) return
						if (result.data !== null) {
							setStatus(result.data)
							if (result.data.configured) setUsername(String(result.data.username ?? ''))
							setLoading('ready')
						} else if (result.response.status === 401) {
							setMessage({ kind: 'error', text: '请先登录后再配置账号密码' })
							setLoading('ready')
						} else {
							setMessage({ kind: 'error', text: '读取登录凭据失败（HTTP ' + result.response.status + '）' })
							setLoading('ready')
						}
					}).catch(function () {
						if (cancelled) return
						setMessage({ kind: 'error', text: '登录插件服务不可达（宿主半可能已降级）' })
						setLoading('ready')
					})
					return function () {
						cancelled = true
					}
				}, [])

				function onSave() {
					if (busy) return
					if (username.length < 1 || username.length > 64) {
						setMessage({ kind: 'error', text: '用户名需要 1-64 个字符' })
						return
					}
					if (password.length < 8) {
						setMessage({ kind: 'error', text: '密码至少 8 个字符' })
						return
					}
					if (confirm !== password) {
						setMessage({ kind: 'error', text: '两次输入的密码不一致' })
						return
					}
					setBusy(true)
					setMessage(null)
					fetch('/auth/credentials', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ username: username, password: password, confirm: confirm }),
					}).then(function (response) {
						if (response.ok) {
							setStatus({ configured: true, username: username })
							setPassword('')
							setConfirm('')
							setMessage({ kind: 'ok', text: '已保存账号密码' })
						} else if (response.status === 401) {
							setMessage({ kind: 'error', text: '请先登录后再配置账号密码' })
						} else if (response.status === 400) {
							response.json().then(function (data) {
								var texts = {
									'invalid-username': '用户名需要 1-64 个字符',
									'password-too-short': '密码至少 8 个字符',
									'confirm-mismatch': '两次输入的密码不一致',
									'body-too-large': '请求体过大',
									'unsupported-body': '请求格式不受支持',
								}
								setMessage({ kind: 'error', text: texts[data && data.error] || '校验失败（' + (data && data.error) + '）' })
							}).catch(function () {
								setMessage({ kind: 'error', text: '校验失败（HTTP 400）' })
							})
						} else if (response.status === 403) {
							setMessage({ kind: 'error', text: '跨源请求被拒绝' })
						} else {
							setMessage({ kind: 'error', text: '保存失败（HTTP ' + response.status + '）' })
						}
					}).catch(function () {
						setMessage({ kind: 'error', text: '保存失败：服务不可达' })
					}).finally(function () {
						setBusy(false)
					})
				}

				function onRemove() {
					if (busy) return
					if (!window.confirm('确定移除账号密码？移除后 dsh web 将回退为仅 token 登录。')) return
					setBusy(true)
					setMessage(null)
					fetch('/auth/credentials', { method: 'DELETE' }).then(function (response) {
						if (response.ok) {
							setStatus({ configured: false, username: null })
							setPassword('')
							setConfirm('')
							setMessage({ kind: 'ok', text: '已移除账号密码，回退为仅 token 登录' })
						} else if (response.status === 401) {
							setMessage({ kind: 'error', text: '请先登录后再操作' })
						} else {
							setMessage({ kind: 'error', text: '移除失败（HTTP ' + response.status + '）' })
						}
					}).catch(function () {
						setMessage({ kind: 'error', text: '移除失败：服务不可达' })
					}).finally(function () {
						setBusy(false)
					})
				}

				var statusText = loading === 'loading'
					? '读取中…'
					: status === null
						? '状态未知'
						: status.configured
							? '已配置账号密码：' + String(status.username ?? '')
							: '未配置账号密码（仅 token 登录）'

				return createElement('div', { style: { maxWidth: 480, paddingBottom: 16 } },
					createElement('h3', { style: { margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: COLOR_LABEL } }, '账号密码登录'),
					createElement('p', { style: { margin: rowStyle.margin, fontSize: 13, color: COLOR_LABEL_SECONDARY } }, statusText),
					createElement('label', { style: labelStyle }, '用户名'),
					createElement('input', {
						style: inputStyle,
						value: username,
						autoComplete: 'username',
						onChange: function (event) { setUsername(event.target.value) },
					}),
					createElement('label', { style: labelStyle }, '密码（至少 8 个字符）'),
					createElement('input', {
						style: inputStyle,
						type: 'password',
						value: password,
						autoComplete: 'new-password',
						onChange: function (event) { setPassword(event.target.value) },
					}),
					createElement('label', { style: labelStyle }, '确认密码'),
					createElement('input', {
						style: inputStyle,
						type: 'password',
						value: confirm,
						autoComplete: 'new-password',
						onChange: function (event) { setConfirm(event.target.value) },
					}),
					createElement('div', { style: { display: 'flex', gap: 8, marginTop: 16 } },
						createElement(Button, { variant: 'outline', disabled: busy, onClick: onSave }, '保存'),
						createElement(Button, { variant: 'ghost', disabled: busy, onClick: onRemove }, '移除账号密码'),
					),
					message !== null ? createElement('p', { style: messageStyle(message.kind === 'ok' ? COLOR_OK : COLOR_DANGER), role: 'alert' }, message.text) : null,
				)
			}

			/** 分区图标（settings.section.icon 槽，收 {size, active}）。 */
			function AuthIcon(props) {
				return createElement(AccountIcon, { size: (props && props.size) || 16 })
			}

			return {
				/* 浏览器侧 cordis 同样要求服务依赖声明（brand-fenix 先例）：
				 * 未声明 inject 时 ctx.slots 属性访问 throw，模块 boot 即 failed。 */
				inject: ['slots'],
				apply(ctx) {
					/* 注册回调由宿主框架在渲染时声明（brand-fenix 先例：模块装载器
					 * 保证插件晚于 inject 宿主到达），此刻官方分区已注册，可探测
					 * 排序尾；枚举失败回退 FALLBACK_MAX_ORDER。逐槽 try/catch 降级，
					 * 单槽失配不影响另一槽与官方分区。 */
					var failures = []
					var stage = function (name, err) {
						console.warn('[fenix-dsh-auth] slot injection "' + name + '" rejected: ' + (err && err.stack ? err.stack : String(err)))
						failures.push(name)
					}
					try {
						ctx.slots.inject('settings.section', function () {
							var maxOrder = FALLBACK_MAX_ORDER
							try {
								var entries = ctx.slots.entries('settings.section')
								for (var i = 0; i < entries.length; i += 1) {
									var order = entries[i] && entries[i].options && entries[i].options.order
									if (typeof order === 'number' && order > maxOrder) maxOrder = order
								}
							} catch {}
							return ctx.slots.register({
								name: 'settings.section',
								id: 'fenix-auth',
								order: maxOrder + 1,
								label: function () {
									return '登录'
								},
							}, AuthSection)
						})
					} catch (err) {
						stage('settings.section', err)
					}
					try {
						ctx.slots.inject('settings.section.icon', function () {
							return ctx.slots.register({
								name: 'settings.section.icon',
								id: 'fenix-auth',
							}, AuthIcon)
						})
					} catch (err) {
						stage('settings.section.icon', err)
					}
					return function dispose() {
						return failures.length === 0
					}
				},
			}
		},
	})
})()
