/**
 * fenix-dsh-rpc-guard — Client 半（零构建，形态对齐 fenix-dsh-auth / brand-fenix）。
 *
 * 问题（2026-11-24 现场排查，dsh 0.2.2-rc.1）：
 *   官方浏览器端 RPC 通道 `createWebConnectionRpc`（@deepseek-ai/dsh-client-connection
 *   lib/client.browser.js:1209-1232）对响应 **没有任何超时保护**：`await send(...)`
 *   无 signal、无 timeout。onboarding「保存并继续」→ `credentials/set` 的响应若在
 *   链路上丢失（frp 公网隧道断流、代理轮换、半开连接），该 await 永不 settle，
 *   ProviderEditor.apply() 的 finally 永不执行 → busy 永久 true，「保存并继续」与
 *   「稍后配置」双双 disabled（EditorFooter `disabled: props.busy`）→ 界面冻死，
 *   只能等浏览器层最终报错（可达数百秒）后手动「稍后配置」逃生；而服务端写入其实
 *   早已成功（凭据文件有值）。同机制影响所有无 signal 的 /api POST RPC。
 *
 * 方案：在 window.fetch 最外层包一层护栏（RPC 发起方与页面其余 fetch 均无感知）：
 *   1. 仅接管同源 `/api/*` 的 POST（官方 RPC 全是 POST + JSON 字符串体）。
 *      注意：实测（2026-11-24 fetch 日志）上层 gateway invoke 层对**每个 RPC**
 *      都注入一个生命周期 AbortSignal（挂起中断用，从不因超时 abort）——
 *      所以不能按「有没有 signal」决定放行；改为「已 aborted 的 signal 放行
 *      （调用方已取消），未 abort 的 signal 合并进护栏超时（应用取消语义
 *      仍即时传播）」；
 *   2. 响应头超时（默认 20s，可经 localStorage.fenixRpcGuardTimeoutMs 调整）：
 *      超时即 abort 本次尝试。计时器在响应头到达时清除，不干涉后续 body 流，
 *      流式端点（openStream 载体等）不受影响；
 *   3. 超时/网络断连（TypeError: Failed to fetch）时，对 **幂等端点** 自动重试
 *      （credentials/set|unset 是单 ref 整值覆写，天然幂等；list/describe/
 *      catalog 类是只读）。body 非 string/URLSearchParams（不可回放的流）不重试；
 *   4. 重试耗尽后抛出带明确文案的 Error——应用自身的 finally 释放 busy，按钮
 *      恢复可点、key 保留在输入框，用户可手动重试。**从「永久冻死」变为
 *      「有界失败 + 自动恢复」**。
 *
 * 契约面（零依赖）：
 *   - 仅依赖标准 Web API（fetch/AbortController/localStorage），不 require
 *     任何官方模块；`dsh.client.inject` 锚点仅为让 dsh 加载本 bundle。
 *   - 幂等白名单（pathname 精确匹配 + 末段 camelCase 词根全词匹配，POST-only）：
 *       /api/credentials/set | /api/credentials/unset
 *       /api/<channel>/list… | describe… | catalog… | get… | query…
 *     其余 /api POST（如 session/create 有副作用）只做超时、不自动重试，
 *     避免副作用重复。
 *   - 装载幂等：window.__fenixRpcGuardInstalled 防重入；先于本插件安装的
 *     fetch 包装自然链接（本包装保存的是安装时刻的 fetch 引用）。
 *
 * 已知边界：
 *   - 响应头已到达、body 中途断流：不在本护栏职责内（罕见，且应用层大多
 *     对 body 解析失败有兜底）。
 *   - 若第三方脚本（代理注入页、劫持扩展）在更早层吞掉响应且连接保持半开，
 *     行为等同服务挂起，护栏同样生效。
 */

(function () {
	'use strict'

	/** 安装 fetch 护栏（幂等：__fenixRpcGuardInstalled 防重入）。 */
	function installGuard() {
	/* 防重入（多锚点/重复装载时只装第一份） */
	if (window.__fenixRpcGuardInstalled) return
	window.__fenixRpcGuardInstalled = true

	var originalFetch = window.fetch && window.fetch.bind(window)
	if (typeof originalFetch !== 'function') return /* 极旧环境，放弃不碍事 */

	/* 响应头超时（毫秒）。每次调用即时读取 localStorage：测试与排障可在不改
	 * 代码的情况下调整（如设 3000 快速验证），非法值回落默认。 */
	var DEFAULT_TIMEOUT_MS = 20000
	var TIMEOUT_FLOOR_MS = 1000
	var TIMEOUT_CEILING_MS = 120000

	function timeoutMs() {
		var raw = null
		try {
			raw = window.localStorage.getItem('fenixRpcGuardTimeoutMs')
		} catch {}
		var n = raw === null ? NaN : Number(raw)
		if (!(n >= TIMEOUT_FLOOR_MS) || n > TIMEOUT_CEILING_MS) return DEFAULT_TIMEOUT_MS
		return n
	}

	/* 重试预算（仅幂等端点）：首次 + 至多 2 次重试；退避 500ms / 1500ms */
	var MAX_RETRIES = 2
	var RETRY_BACKOFF_MS = [500, 1500]

	/** 幂等端点（超时/断连后允许自动重试）。官方 RPC 全部形如
	 * `/api/<channel>/<endpoint>`，endpoint 为 camelCase（describe、list、
	 * query…）。credentials/set|unset 是单 ref 整值覆写天然幂等（精确名单，
	 * 优先级最高：在册者无条件幂等）；list/describe/catalog/get/query 词根类
	 * 为只读。
	 * 判定：末段按 camelCase 词边界切分为词元（lowercase 归一，切词规则不变），
	 * **全部词元均为只读词根或纯连接词（and/or）才判幂等**：
	 *   - 单词元端点（list/get/query/describe/catalog 整词）行为不变；
	 *   - 复合词只要含任一非只读词元即不幂等——「首词元是只读词根、整词却
	 *     有副作用」的端点（getOrCreate、queryAndUpdate、listAndPrune 类）
	 *     超时可能意味着服务端已执行，自动重试会造成副作用重复，故不再重试；
	 *   - 子串偶然命中排除依旧成立（forget 含 get、resetConfiguration 含 set：
	 *     切词后各词元均不在词根集，reset/forget 类仍不会误判）；
	 *   - 旧「任一词元命中词根即幂等」口径已收紧：带非词根名词词元的多词元
	 *     端点（如 listProviders）不再凭首词元获得自动重试——确认整体只读的
	 *     应显式加入 IDEMPOTENT_EXACT，而不是放宽此处的词元判定。 */
	var IDEMPOTENT_EXACT = { '/api/credentials/set': true, '/api/credentials/unset': true }
	var IDEMPOTENT_ROOTS = { list: true, describe: true, catalog: true, get: true, query: true }
	/* 纯连接词：不表达动作，复合词中出现不破坏只读判定（and/or 本身无害，
	 * 整词是否幂等由其余词元决定，如 listAndPrune 的 prune 仍使其不幂等） */
	var IDEMPOTENT_CONNECTIVES = { and: true, or: true }

	function isIdempotent(pathname) {
		if (IDEMPOTENT_EXACT[pathname] === true) return true
		var last = pathname.slice(pathname.lastIndexOf('/') + 1)
		var tokens = last
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.toLowerCase()
			.split(/[^a-z0-9]+/)
		/* 全词元判定：任一词元既非只读词根也非纯连接词 → 不幂等（旧口径
		 * 「任一词元命中词根即幂等」会把 getOrCreate/queryAndUpdate 类
		 * 复合词端点误判为可重试）。 */
		for (var i = 0; i < tokens.length; i++) {
			if (IDEMPOTENT_ROOTS[tokens[i]] !== true && IDEMPOTENT_CONNECTIVES[tokens[i]] !== true) return false
		}
		return true
	}

	function delay(ms) {
		return new Promise(function (resolve) {
			setTimeout(resolve, ms)
		})
	}

	/** 解析 fetch 入参：返回 {url, method, pathname, sameOriginApi}。解析失败
	 * 一律按不接管处理（原样透传），保证任何形态的调用都不被护栏改变语义。 */
	function describeCall(input, init) {
		try {
			var rawUrl = typeof input === 'string' ? input : input && input.url
			if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null
			var parsed = new URL(rawUrl, window.location.href)
			if (parsed.origin !== window.location.origin) return null
			if (parsed.pathname.indexOf('/api/') !== 0) return null
			var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
			return { url: parsed.href, pathname: parsed.pathname, method: method }
		} catch {
			return null
		}
	}

	/** body 可安全重放：string / URLSearchParams（官方 RPC 为 JSON 字符串）。
	 * ReadableStream / FormData / Blob 等不可假定可回放，一律不重试。
	 * input 为 Request 对象时改读 request.body：非 null 的 body 流在首次
	 * fetch 后即 consumed，重放必以 body already used 的 TypeError 失败，
	 * 故仅 body 为 null 的 Request 可重试（无 body 请求重放无风险）。 */
	function replayableBody(input, init) {
		if (typeof Request === 'function' && input instanceof Request) {
			return input.body === null || input.body === undefined
		}
		if (!init) return true /* 无 body：POST /api 罕见，但重放无风险 */
		var body = init.body
		return body === null || body === undefined || typeof body === 'string' || body instanceof URLSearchParams
	}

	window.fetch = function (input, init) {
		var call = describeCall(input, init)
		if (call === null) return originalFetch(input, init)
		if (call.method !== 'POST') return originalFetch(input, init)
		/* 已 aborted 的应用 signal：调用方已取消，放行（错误原样抛回）。
		 * 未 abort 的 signal 不放行——实测 gateway invoke 层给每个 RPC 都注入
		 * 生命周期 signal（stall 时永不 abort），若放行护栏对全部 RPC 失效；
		 * 改为在 runAttempt 内把应用 signal 与护栏超时 signal 合并。 */
		if (init && init.signal && init.signal.aborted) return originalFetch(input, init)
		if (init && init.keepalive) return originalFetch(input, init)
		if (!replayableBody(input, init)) return originalFetch(input, init)

		var limit = timeoutMs()
		var canRetry = isIdempotent(call.pathname)
		var attempt = 0
		/* 应用生命周期 signal（实测每个 RPC 都带）：stall 时它从不 abort，
		 * 因此护栏超时是唯一兜底；应用主动 abort 时必须原样传播其取消。 */
		var appSignal = (init && init.signal) || null

		var runAttempt = function () {
			if (appSignal && appSignal.aborted) {
				throw appSignal.reason || new DOMException('Aborted', 'AbortError')
			}
			/* 每次尝试独立 AbortController；clone 不动调用方 init（复用安全） */
			var controller = new AbortController()
			var timedOut = false
			var merged = Object.assign({}, init || {}, { signal: controller.signal })
			if (appSignal) {
				/* 合并：应用 cancel 即刻传导到本次尝试（手动监听，兼容无
				 * AbortSignal.any 的环境）；护栏超时/应用取消二者先到先生效 */
				if (appSignal.aborted) controller.abort(appSignal.reason)
				else appSignal.addEventListener('abort', function () {
					controller.abort(appSignal.reason)
				}, { once: true })
			}
			var timer = setTimeout(function () {
				timedOut = true
				controller.abort()
			}, limit)

			return originalFetch(input, merged).then(
				function (response) {
					clearTimeout(timer) /* 响应头已到：不再计时，body 流不干涉 */
					return response
				},
				function (error) {
					clearTimeout(timer)
					/* 应用主动取消：原样上抛（含其 reason），绝不重试 */
					if (appSignal && appSignal.aborted) throw error
					var isTimeout = timedOut
					var isNetworkBreak = error instanceof TypeError /* Failed to fetch：连接断 */
					if (!isTimeout && !isNetworkBreak) throw error /* 应用自己的错，原样上抛 */
					if (!canRetry) {
						throw new Error(
							'[fenix-rpc-guard] POST ' + call.pathname +
							' ' + (isTimeout ? '超过 ' + limit + 'ms 无响应' : '连接中断') +
							'（该端点有副作用，未自动重试）——网络/代理恢复后请重试'
						)
					}
					if (attempt >= MAX_RETRIES) {
						throw new Error(
							'[fenix-rpc-guard] POST ' + call.pathname +
							' ' + (isTimeout ? '超过 ' + limit + 'ms 无响应' : '连接中断') +
							'，已重试 ' + MAX_RETRIES + ' 次仍失败——请检查网络/代理后重试'
						)
					}
					attempt += 1
					var wait = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]
					console.warn(
						'[fenix-rpc-guard] POST ' + call.pathname +
						' ' + (isTimeout ? '超时(' + limit + 'ms)' : '断连') +
						'，' + wait + 'ms 后第 ' + attempt + ' 次重试'
					)
					return delay(wait).then(runAttempt)
				},
			)
		}

		try {
			return runAttempt()
		} catch (syncError) {
			/* runAttempt 同步抛（应用 signal 已 aborted）需转成 rejected promise */
			return Promise.reject(syncError)
		}
	}

	console.info('[fenix-rpc-guard] 已接管同源 /api POST：响应头超时 ' + DEFAULT_TIMEOUT_MS + 'ms' +
		'，幂等端点自动重试（localStorage.fenixRpcGuardTimeoutMs 可调）')
}

/* dsh 插件装载入口（形态对齐 fenix-dsh-auth/client.js）：bundle 由
 * package.json 的 dsh.client.inject 锚点触发加载，顶层调用
 * window.__ModuleLoader__.load；护栏本体在 factory 内安装（装载器保证
 * __ModuleLoader__ 先于插件 bundle 就绪）。本插件不注册宿主扩展点，
 * inject: [] 且不触 ctx.slots；apply 返回最小 dispose 闭包。 */
function install() {
	if (typeof window === 'undefined' || !window.__ModuleLoader__ || typeof window.__ModuleLoader__.load !== 'function') {
		/* 装载器缺失（如被直接 <script> 引入调试）：退化为立即安装护栏 */
		installGuard()
		return
	}
	window.__ModuleLoader__.load({
		id: 'fenix-dsh-rpc-guard',
		factory: function () {
			installGuard()
			return {
				inject: [],
				apply: function () {
					return function () {
						return true
					}
				},
			}
		},
	})
}

install()
})()
