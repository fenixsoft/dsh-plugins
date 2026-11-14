/**
 * fenix-dsh-clipboard-fallback — dsh web 非安全上下文剪贴板写降级。
 *
 * 问题:经纯 HTTP(如 frp 隧道 home.icyfenix.cn:3080)访问 dsh web 时,浏览器
 * 判定非 secure context(window.isSecureContext === false),navigator.clipboard
 * 整体为 undefined(Web API 标准行为)。dsh 多个 client 插件
 * (dsh-client-ui-open-in-app 的右键「复制链接地址」、dsh-client-ui-settings-account
 * 的复制登录链接、dsh-experimental-client-ui-forge、dsh-experimental-client-ui-stats、
 * dsh-session-log-export 的降级分支、primitives.writeClipboard 的首选路径)
 * 裸调 navigator.clipboard.writeText,在公网 HTTP 场景全部抛
 * TypeError → 菜单/toast 显示「无法复制」。
 *
 * 修法:本插件在页面装载早期 polyfill navigator.clipboard.writeText——
 * 仅当原生 API 缺失(非 secure context)时,以隐藏 textarea +
 * document.execCommand("copy") 实现,Promise 语义与原生一致(成功 resolve、
 * 失败 reject,调用方现有的失败提示分支保持有效)。对所有裸调用方透明,
 * dsh 升级后无论官方是否改用 primitives.writeClipboard 均正确:
 *   - 官方未修:裸调命中本 polyfill,照常工作;
 *   - 官方已修:primitives.writeClipboard 首选 navigator.clipboard?.writeText,
 *     命中本 polyfill,同样工作。
 *
 * 边界(有意为之):
 *   - 不提供 readText:非安全上下文无法降级读剪贴板(execCommand("paste") 被
 *     浏览器禁止),保持原生缺失语义,不假装可用。
 *   - 不提供 write/ClipboardItem:图片位图写入无法经 execCommand 降级;
 *     dsh-client-ui-file-actions 的复制图片在公网 HTTP 下维持原生失败行为,
 *     dsh-session-log-export 的 supportsDeferredWrite 会因 write 缺失转走
 *     writeText 降级,正好命中本 polyfill。
 *   - configurable: true,宿主或未来标准行为可覆盖。
 *
 * 手势约束:execCommand("copy") 要求 transient activation(用户手势窗口)。
 * 所有调用方均在菜单项/按钮点击的同步回调链内 await writeText,activation
 * 有效;经 playwright 在 http://home.icyfenix.cn:3080 端到端验证。
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-clipboard-fallback',
		factory(require) {
			/* loader 契约：factory 必须返回含 apply 的插件对象（ cordis Proxy.plugin
			   对 undefined 直接抛 invalid plugin，炸整页 boot）。以下早退分支只是
			   「不安装 polyfill」，插件本体仍须返回 —— 127.0.0.1 虽走 HTTP 但属
			   potentially-trustworthy origin（isSecureContext=true，原生 clipboard
			   在位），正是早退分支被命中的场景。 */
			const noop = { apply() {} }
			if (typeof navigator === 'undefined') return noop
			/* 原生已在(secure context 或宿主已提供)——不覆盖，但插件本体照常返回 */
			if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') return noop

			function writeText(text) {
				return new Promise(function (resolve, reject) {
					if (typeof text !== 'string') text = String(text == null ? '' : text)
					var textarea = document.createElement('textarea')
					textarea.value = text
					textarea.setAttribute('readonly', '')
					textarea.style.position = 'fixed'
					textarea.style.left = '-9999px'
					document.body.appendChild(textarea)
					textarea.select()
					var copied = false
					try {
						/* bind(document):部分引擎要求 execCommand 以 document 为接收者 */
						var exec = typeof document.execCommand === 'function' ? document.execCommand.bind(document) : null
						if (exec) copied = exec('copy')
					} catch (error) {
						copied = false
					} finally {
						textarea.remove()
					}
					if (copied) resolve(undefined)
					else reject(new Error('fenix-dsh-clipboard-fallback: clipboard write unavailable (insecure context, execCommand denied)'))
				})
			}

			try {
				Object.defineProperty(navigator, 'clipboard', {
					value: { writeText: writeText },
					configurable: true,
					enumerable: true,
					writable: false
				})
			} catch (error) {
				/* 极端宿主锁死 navigator——退化为不安装,保持原生行为 */
			}
			/* client 模块本身也是 cordis 插件:loader 要求 factory 返回含 apply 的
			   对象;polyfill 已在 factory 执行时生效,apply 保持空操作。 */
			return {
				apply() {}
			}
		}
	})
})()
