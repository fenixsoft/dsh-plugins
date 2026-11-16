/**
 * fenix-dsh-auth — Host 半（零构建 JS，dsh 0.2.2-rc.1 实测契约面）。
 *
 * dsh web 账号密码登录：接管首页 `/` 路由，未认证时呈现登录页（替代原生
 * 纯文本 401「dsh web authentication required; reopen the URL printed by
 * dsh web.」），账号密码校验通过经 dsh 原生 token 通道铸会话 cookie；token
 * 登录通道完整保留。设置分区（client.js）经 `/auth/credentials` 配置凭据。
 *
 * 接缝与契约（0.2.2-rc.1 发行包核实）：
 *   - `ctx.connection.authorizeIndex(req, res): boolean`（dsh-client-connection
 *     BrowserAuth）：req 取 `{headers, method?, url?}`，res 为
 *     `{writeHead(status, headers), end(body?)}` sink。有效 `?token=` → 写出
 *     303 + `set-cookie`（铸会话）+ `location: ./` 并返回 false；cookie 有效 →
 *     返回 true（调用方可 serve index）；其余 → 写出纯文本 401 并返回 false。
 *     本插件传 sink 对象捕获其输出，从不让它触碰真实 res——303 原样回放、
 *     401 换登录页，签名逻辑零复制（design D3）。
 *   - `ctx.connection.admit({headers})`：`{peer}` 或 `{rejection: 401|403}`；
 *     浏览器 cookie 认证通向共享 owner Peer（design 内「owner Peer」语义）。
 *   - `ctx.webServer.register({kind:'exact', path, handler})`：exact 座位无
 *     冲突（官方 frontend-static 只占 fallback 座位）；匹配序 exact → 最长
 *     prefix → fallback，且 handler 路由无 fall-through。
 *   - `ctx.webServer.readResource(request, peer): Promise<Response>`：按同一
 *     匹配表选 responder——`/` 请求会命中本插件刚注册的 handler（无
 *     fall-through 返回 404），故认证分支固定读 `/index.html`（design D2）。
 *   - `ctx.credentials.modifyRecord(key, mutate)`：唯一写路径，mutate 返回
 *     记录；`deleteRecord(key)` 删除（absent 时 no-op）。key 为
 *     `<owner>/<id>` 字符串（dsh-credentials 的 credentialKey brand 在运行时
 *     是恒等——brandString 原样返回，故本插件本地拼串、不 import 该包）。
 *
 * 客户端半（client.js）注入 `@deepseek-ai/dsh-client-ui-settings-general` 的
 * `settings.section` 槽（官方排序尾），经 `/auth/credentials` 配置/移除凭据。
 *
 * 零 import 约束：插件落在 /root/dsh-plugins/<name>/，无自身 node_modules，
 * bare import '@deepseek-ai/*' 无法从插件文件位置解析（session-grouper 先例
 * 是 pnpm install 过的构建型包，不可套用）——宿主服务一律经 ctx 访问，短窗
 * 轮询兜底服务晚就绪；凭据 key 本地拼串（段格式按 dsh-credentials 的
 * KEY_SEGMENT_PATTERN 语义校验）。
 *
 * 降级契约（design「上游契约失配降级」）：apply 探测六项依赖（connection.
 * authorizeIndex/authenticatedUrl/admit、webServer.register/readResource、
 * credentials.modifyRecord），任一缺失或类型不符 → warn 一次、不注册任何
 * 路由，保持 dsh 原生 token-only 行为；运行期异常捕获降级（401 文本或 500
 * JSON），不产生未处理异常。
 */
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

/* scrypt 参数（design D6 原为 N=16384；OWASP 现行建议交互式登录 ≥ N=2^17，
 * 新写入用 131072——记录泄露后的离线爆破成本提约一个量级。N=2^17/r=8 派生
 * 需 128MiB，超 Node scrypt 默认 maxmem 32MiB，故显式放宽 maxmem，否则新旧
 * 记录的派生一律抛错。校验按记录内落盘参数执行，旧记录（N=16384）向后兼容。 */
const SCRYPT_PARAMS = Object.freeze({ N: 131072, r: 8, p: 1, keylen: 64, maxmem: 268_435_456 })

/* 未认证登录派生的在飞上限：单次派生（N=2^17/r=8）约需 128MiB，而失败限流只按
 * 次数计数、不约束并发——同源并发提交会全部先过 isLocked 再并行派生（线程池
 * 默认 4 并发 → 峰值约 512MiB，排队请求持续累积），小内存部署可被打至 OOM/登录
 * 不可用。超限直接按锁定响应，并发派生内存峰值有界。 */
const MAX_CONCURRENT_LOGIN_DERIVATIONS = 2

/** 凭据记录 key（`<owner>/<id>`；owner=插件注册名）。 */
const CREDENTIAL_SCOPE = 'fenix-dsh-auth'
const CREDENTIAL_ID = 'login'
export const CREDENTIAL_KEY = `${CREDENTIAL_SCOPE}/${CREDENTIAL_ID}`

/** 登录 POST 请求体上限（design：8KB）。 */
const MAX_LOGIN_BODY_BYTES = 8 * 1024

/** 请求体读取超时兜底（慢速客户端不发完 body 也不该令调用方 await 永久悬挂）。 */
const BODY_READ_TIMEOUT_MS = 30_000

/** 失败限流参数（design D8：60s 窗口 5 次失败锁 60s）。 */
const RATE_WINDOW_MS = 60_000
const RATE_MAX_FAILS = 5
const RATE_LOCK_MS = 60_000
/** 限流哨兵键：取不到远端地址的连接（unix socket/部分代理形态）共享同一计数桶，保持 fail-closed。 */
const RATE_LIMIT_UNKNOWN_ADDRESS = '(unknown)'

/** 登录页错误码白名单（服务端只渲染白名单文案，其余反射值一律忽略）。 */
const LOGIN_ERROR_MESSAGES = Object.freeze({
	invalid: '用户名或密码错误',
	locked: '失败次数过多，请 60 秒后重试',
	unconfigured: '未配置账号密码：请先用 token URL 登录，然后在设置弹窗的「登录」分区配置账号密码',
	untrusted: '当前访问地址不在 dsh web 信任主机列表中：即使账号密码正确，登录后也无法进入应用。请改用受信任地址访问，或由管理员将该地址加入 --trusted-host 后重启 dsh web',
})

/** 凭据 key 段校验（等价 dsh-credentials KEY_SEGMENT_PATTERN 的保守子集）。 */
const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

/* ────────────────────────── 纯函数（测试面） ────────────────────────── */

/**
 * scrypt 派生密码哈希。
 * @param password - 明文密码（不落盘，仅参与派生）。
 * @param saltHex - 可选盐（hex 字符串）；缺省生成 16 字节随机盐。
 * @returns `{salt, hash, N, r, p, keylen}`，salt/hash 均为 hex 字符串。
 */
export async function hashPassword(password, saltHex) {
	if (typeof password !== 'string' || password.length === 0) throw new TypeError('password must be a non-empty string')
	let salt
	if (saltHex === undefined) {
		salt = randomBytes(16)
	} else {
		/* 整串校验后再解码：Buffer.from(x, 'hex') 在首个非法字符处静默截断
		 * （'abzz' 只留 'ab'、奇数长度丢尾字节），短盐派生结果与传入值不一致
		 * 且重派生时难排查，故非法/空串一律显式报错。 */
		const hex = String(saltHex)
		if (!/^([0-9A-Fa-f]{2})+$/.test(hex)) throw new TypeError('salt must be a non-empty hex string')
		salt = Buffer.from(hex, 'hex')
	}
	const hash = await scrypt(password, salt, SCRYPT_PARAMS.keylen, {
		N: SCRYPT_PARAMS.N,
		r: SCRYPT_PARAMS.r,
		p: SCRYPT_PARAMS.p,
		maxmem: SCRYPT_PARAMS.maxmem,
	})
	return {
		salt: salt.toString('hex'),
		hash: hash.toString('hex'),
		N: SCRYPT_PARAMS.N,
		r: SCRYPT_PARAMS.r,
		p: SCRYPT_PARAMS.p,
		keylen: SCRYPT_PARAMS.keylen,
	}
}

/**
 * 校验密码与凭据记录（常量时间比较）。
 * @param password - 待校验明文。
 * @param payload - hashPassword 的产物（或凭据记录 payload）。
 * @returns 密码匹配时 true。
 */
export async function verifyPassword(password, payload) {
	if (typeof password !== 'string' || payload === null || typeof payload !== 'object') return false
	const salt = typeof payload.salt === 'string' ? Buffer.from(payload.salt, 'hex') : undefined
	const expected = typeof payload.hash === 'string' ? Buffer.from(payload.hash, 'hex') : undefined
	if (salt === undefined || expected === undefined || salt.length === 0 || expected.length === 0) return false
	const { N = SCRYPT_PARAMS.N, r = SCRYPT_PARAMS.r, p = SCRYPT_PARAMS.p, keylen = SCRYPT_PARAMS.keylen } = payload
	try {
		/* maxmem 显式放宽（N=2^17 档需 128MiB > Node 默认 32MiB）；对旧记录的
		 * 低档参数同样成立——maxmem 只是上界，不影响低档派生。 */
		const candidate = await scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT_PARAMS.maxmem })
		return candidate.length === expected.length && timingSafeEqual(candidate, expected)
	} catch {
		return false
	}
}

/**
 * 校验登录用户名与凭据记录（常量时间比较）：登录语义包含账号名，密码正确但
 * 用户名不匹配同样判失败（handleLogin 同路分流 error=invalid，与密码错误共用
 * 限流计数）。记录未含 username（形态异常）一律判不匹配——正常写入路径恒保存
 * username。
 * @param username - 待校验用户名。
 * @param payload - 凭据记录 payload。
 * @returns 用户名匹配时 true。
 */
export function verifyUsername(username, payload) {
	if (typeof username !== 'string' || payload === null || typeof payload !== 'object') return false
	const expected = typeof payload.username === 'string' ? Buffer.from(payload.username, 'utf8') : undefined
	if (expected === undefined) return false
	const candidate = Buffer.from(username, 'utf8')
	return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/**
 * 远端地址归一到限流桶键：取不到地址的连接（unix socket/部分代理形态）统一
 * 归入哨兵桶，登录计数与凭据移除清理共用同一键（否则 reset('') 是空操作，
 * 该来源在哨兵桶里的失败锁定清不掉）。
 * @param remoteAddress - req.socket?.remoteAddress（可空串）。
 */
function normalizeRateLimitAddress(remoteAddress) {
	return typeof remoteAddress === 'string' && remoteAddress !== '' ? remoteAddress : RATE_LIMIT_UNKNOWN_ADDRESS
}

/**
 * 创建进程内失败限流器（design D8：Map<remoteAddress, entry>；每次尝试
 * 顺带清理过期条目防泄漏；重启即清零）。
 */
export function createRateLimiter({ windowMs = RATE_WINDOW_MS, maxFails = RATE_MAX_FAILS, lockMs = RATE_LOCK_MS } = {}) {
	/** @type {Map<string, {fails: number, windowStart: number, lockedUntil?: number}>} */
	const entries = new Map()

	function prune(now) {
		for (const [address, entry] of entries) {
			if (now - entry.windowStart >= windowMs && (entry.lockedUntil ?? 0) <= now) entries.delete(address)
		}
	}

	return {
		/** 该来源当前是否处于锁定窗口（锁定期内即使密码正确也拒绝）。 */
		isLocked(address, now = Date.now()) {
			if (typeof address !== 'string' || address === '') return false
			prune(now)
			const entry = entries.get(address)
			return entry !== undefined && (entry.lockedUntil ?? 0) > now
		},
		/** 记一次失败；跨窗重置计数，达到上限进入锁定。返回是否触发锁定。 */
		fail(address, now = Date.now()) {
			if (typeof address !== 'string' || address === '') return false
			prune(now)
			let entry = entries.get(address)
			if (entry === undefined || now - entry.windowStart >= windowMs) {
				entry = { fails: 0, windowStart: now }
				entries.set(address, entry)
			}
			entry.fails += 1
			if (entry.fails >= maxFails) entry.lockedUntil = now + lockMs
			return (entry.lockedUntil ?? 0) > now
		},
		/** 登录成功清零该来源计数。 */
		reset(address) {
			entries.delete(address)
		},
		/** 清空全部来源（凭据移除等回退场景）。 */
		clear() {
			entries.clear()
		},
	}
}

/** 限流命中判定（绑定导出名；limiter 见 createRateLimiter）。 */
export function rateLimitHit(limiter, address, now = Date.now()) {
	return limiter.isLocked(address, now)
}

/** HTML 反射值转义。 */
export function escapeHtml(text) {
	return String(text).replace(/[&<>"']/g, (char) => (
		char === '&' ? '&amp;'
			: char === '<' ? '&lt;'
				: char === '>' ? '&gt;'
					: char === '"' ? '&quot;'
						: '&#39;'
	))
}

/** 归一化登录页错误码：白名单外的值（含 null）一律折为无提示。 */
export function normalizeLoginError(rawError) {
	if (typeof rawError === 'string' && Object.hasOwn(LOGIN_ERROR_MESSAGES, rawError)) return rawError
	return ''
}

/**
 * 渲染登录页（design D7：单文件 HTML，无外部资源、无模板引擎；静态渲染，
 * 禁 CSS animation/transition；页面不含 token/凭据/哈希，错误文案仅来自
 * 白名单并经 escapeHtml）。
 * @param errorCode - '' | 'invalid' | 'locked' | 'unconfigured' | 'untrusted'。
 */
export function renderLoginPage(errorCode = '') {
	const code = normalizeLoginError(errorCode)
	const errorHtml = code === ''
		? ''
		: `<p class="error" role="alert">${escapeHtml(LOGIN_ERROR_MESSAGES[code])}</p>`
	return [
		'<!doctype html>',
		'<html lang="zh-CN">',
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		/* referrer policy 用 same-origin：no-referrer 会让浏览器把本页 form
		 * POST 的 Origin 头置为 null（opaque origin），触发服务端跨源 403。 */
		'<meta name="referrer" content="same-origin">',
		'<title>dsh web 登录</title>',
		'<style>',
		':root { color-scheme: light dark; }',
		'* { box-sizing: border-box; }',
		'body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;',
		'  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;',
		'  background: var(--dsw-specific-canvas, #ffffff); color: var(--dsw-alias-label-primary, #1a1a1a); }',
		'.card { width: 100%; max-width: 360px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));',
		'  border-radius: var(--dsw-radius-lg, 12px); padding: 32px 28px; background: var(--dsw-specific-canvas, #ffffff); }',
		'h1 { margin: 0 0 20px; font-size: 18px; font-weight: 600; text-align: center; }',
		'label { display: block; margin: 12px 0 4px; font-size: 13px; color: var(--dsw-alias-label-secondary, #555); }',
		'input { width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.2));',
		'  border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-specific-input-major, transparent); color: inherit; }',
		'button[type="submit"] { margin-top: 20px; width: 100%; padding: 9px 0; font-size: 14px; cursor: pointer; border: none;',
		'  border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-specific-button-major, #2563eb); color: #ffffff; }',
		'.error { margin: 16px 0 0; padding: 8px 10px; font-size: 13px; border-radius: var(--dsw-radius-md, 8px);',
		'  background: var(--dsw-specific-danger-minor, rgba(220,38,38,0.08)); color: var(--dsw-specific-danger-major, #dc2626); }',
		'.hint { margin: 20px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #888); }',
		'</style>',
		'</head>',
		'<body>',
		'<main class="card">',
		'<h1>dsh web 登录</h1>',
		'<form method="POST" action="/auth/login">',
		'<label for="username">用户名</label>',
		'<input id="username" name="username" type="text" autocomplete="username" autofocus required>',
		'<label for="password">密码</label>',
		'<input id="password" name="password" type="password" autocomplete="current-password" required>',
		'<button type="submit">登录</button>',
		'</form>',
		errorHtml,
		'<p class="hint">也可以使用 dsh 启动时打印的 token URL 登录。</p>',
		'</main>',
		'</body>',
		'</html>',
	].join('\n')
}

/**
 * 渲染「不受信任地址」页。背景：dsh 原生 authorizeIndex 按 cookie 放行、
 * admit 按 trustedHosts 拒绝——已登录但 Host 不受信任的浏览器此前只会看到
 * 原生 401 文案（用户 m00694 报障的根因）。本页解释原因、列出受信任地址与
 * 处理方法；静态渲染，禁 animation/transition；页面不含 token/凭据/哈希，
 * host 与列表均经 escapeHtml。
 * @param options.host - 请求 Host 头（可空）。
 * @param options.trustedHosts - 受信任主机列表（不可用时省略区块）。
 */
export function renderUntrustedHostPage({ host, trustedHosts } = {}) {
	const hostHtml = typeof host === 'string' && host !== '' ? `<code>${escapeHtml(host)}</code>` : '当前地址'
	const listHtml = Array.isArray(trustedHosts) && trustedHosts.length > 0
		? ['<p class="hint"><strong>受信任地址：</strong></p><ul>',
			...trustedHosts.map((item) => `<li><code>${escapeHtml(String(item))}</code></li>`),
			'</ul>']
		: []
	return [
		'<!doctype html>',
		'<html lang="zh-CN">',
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<meta name="referrer" content="same-origin">',
		'<title>无法进入 dsh web</title>',
		'<style>',
		':root { color-scheme: light dark; }',
		'* { box-sizing: border-box; }',
		'body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;',
		'  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;',
		'  background: var(--dsw-specific-canvas, #ffffff); color: var(--dsw-alias-label-primary, #1a1a1a); }',
		'.card { width: 100%; max-width: 460px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));',
		'  border-radius: var(--dsw-radius-lg, 12px); padding: 32px 28px; background: var(--dsw-specific-canvas, #ffffff); }',
		'h1 { margin: 0 0 20px; font-size: 18px; font-weight: 600; text-align: center; }',
		'p { margin: 12px 0; font-size: 13px; line-height: 1.7; }',
		'code { font-size: 12px; padding: 1px 5px; border-radius: 4px; background: var(--dsw-specific-input-minor, rgba(0,0,0,0.06)); }',
		'ol { margin: 12px 0; padding-left: 22px; font-size: 13px; line-height: 1.9; }',
		'ul { margin: 6px 0; padding-left: 22px; font-size: 12px; line-height: 1.8; }',
		'.error { margin: 16px 0; padding: 8px 10px; font-size: 13px; border-radius: var(--dsw-radius-md, 8px);',
		'  background: var(--dsw-specific-danger-minor, rgba(220,38,38,0.08)); color: var(--dsw-specific-danger-major, #dc2626); }',
		'.hint { margin: 16px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #888); }',
		'</style>',
		'</head>',
		'<body>',
		'<main class="card">',
		'<h1>无法进入 dsh web</h1>',
		'<p class="error" role="alert">登录凭据已验证，但该地址不在信任主机列表中，应用与接口会拒绝来自此地址的访问。</p>',
		`<p>当前访问地址 ${hostHtml} 未列入 dsh web 的信任主机列表（<code>--trusted-host</code>），因此登录后无法进入应用。</p>`,
		...listHtml,
		'<p><strong>处理方法（二选一）：</strong></p>',
		'<ol>',
		'<li>改用受信任地址访问本服务，然后重新登录；</li>',
		'<li>或由管理员将当前地址加入 dsh web 启动参数 <code>--trusted-host</code>（systemd 单元 ExecStart）并重启 dsh web，然后重新登录。</li>',
		'</ol>',
		'<p class="hint">也可以使用 dsh 启动时打印的 token URL 登录（同样需要从受信任地址打开）。</p>',
		'</main>',
		'</body>',
		'</html>',
	].join('\n')
}

/**
 * 解析登录 POST 请求体（design：urlencoded / JSON 白名单）。
 * @param body - 已解码 UTF-8 请求体文本。
 * @param contentType - 请求的 Content-Type 头（可带参数）。
 * @returns `{username, password}`；形态不符或类型不在白名单时 null。
 */
export function parseLoginBody(body, contentType) {
	if (typeof body !== 'string' || body.length === 0) return null
	const type = String(contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
	if (type === 'application/x-www-form-urlencoded') {
		const params = new URLSearchParams(body)
		const username = params.get('username')
		const password = params.get('password')
		return username !== null && password !== null ? { username, password } : null
	}
	if (type === 'application/json') {
		let data
		try {
			data = JSON.parse(body)
		} catch {
			return null
		}
		if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
		const { username, password } = data
		return typeof username === 'string' && typeof password === 'string' ? { username, password } : null
	}
	return null
}

/**
 * 解析凭据设置 POST 请求体（client 半固定走 JSON `{username, password,
 * confirm}`；urlencoded 表单同样接受，便于人工 curl 排障）。
 * @returns `{username, password, confirm}`（confirm 可为 undefined）；不符为 null。
 */
export function parseCredentialBody(body, contentType) {
	const type = String(contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
	if (type === 'application/json') {
		let data
		try {
			data = JSON.parse(body)
		} catch {
			return null
		}
		if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
		const { username, password, confirm } = data
		if (typeof username !== 'string' || typeof password !== 'string') return null
		return { username, password, confirm: typeof confirm === 'string' ? confirm : undefined }
	}
	if (type === 'application/x-www-form-urlencoded') {
		const params = new URLSearchParams(body)
		const username = params.get('username')
		const password = params.get('password')
		const confirm = params.get('confirm')
		if (username === null || password === null) return null
		return { username, password, confirm: confirm ?? undefined }
	}
	return null
}

/** 凭据 key 段校验（对应 dsh-credentials credentialKey 的段格式约束）。 */
export function isCredentialKeySegment(segment) {
	return typeof segment === 'string' && KEY_SEGMENT_PATTERN.test(segment)
}

function defaultPort(scheme) {
	return scheme === 'https:' ? '443' : '80'
}

/**
 * Origin/Host 同源判定（design：端口按协议默认值归一化——https 443 / http 80
 * 与省略端口等价；Origin 头缺失按同源放行（仍受限流）；解析失败（含
 * Origin: null 跨源形态）判不同源）。
 * 已知边界：缺失放行依赖「浏览器跨源 POST 必带 Origin」，剥离 Origin 的反向
 * 代理或非浏览器发送方可绕过本判定——带 cookie 认证的 credentials 写路径
 * （POST/DELETE）因此改用 isSameOriginStrict，login 保留宽松判定（另有失败
 * 限流兜底）。
 * @param origin - 请求 Origin 头（可 undefined）。
 * @param host - 请求 Host 头（`hostname[:port]`，IPv6 带方括号）。
 * @param protocol - 监听协议（'http:' | 'https:'）。
 */
export function isSameOrigin(origin, host, protocol = 'http:') {
	const scheme = protocol === 'https:' ? 'https:' : 'http:'
	if (origin === undefined || origin === null || String(origin).trim() === '') return true
	let originUrl
	try {
		originUrl = new URL(String(origin))
	} catch {
		return false
	}
	if (originUrl.protocol !== scheme) return false
	let hostUrl
	try {
		hostUrl = new URL(`${scheme}//${String(host)}`)
	} catch {
		return false
	}
	const originPort = originUrl.port === '' ? defaultPort(originUrl.protocol) : originUrl.port
	const hostPort = hostUrl.port === '' ? defaultPort(scheme) : hostUrl.port
	return originUrl.hostname.toLowerCase() === hostUrl.hostname.toLowerCase() && originPort === hostPort
}

/**
 * 写请求严格同源判定（isSameOrigin 的收紧态）：Origin 头缺失/为空一律判不同
 * 源。带 cookie 认证的 credentials 写路径在同源判定之外仅剩 admit 一层防线，
 * 不容「缺失 = 同源」放行；浏览器对同源 POST/DELETE 必带 Origin，正常客户端
 * 不受影响（剥离 Origin 的代理会收到 403 cross-origin，可据此定位）。
 * @param origin - 请求 Origin 头（可 undefined）。
 * @param host - 请求 Host 头（`hostname[:port]`，IPv6 带方括号）。
 * @param protocol - 监听协议（'http:' | 'https:'）。
 */
export function isSameOriginStrict(origin, host, protocol = 'http:') {
	if (origin === undefined || origin === null || String(origin).trim() === '') return false
	return isSameOrigin(origin, host, protocol)
}

/** 凭据设置参数校验（SPEC：username 1-64、password ≥8 且与 confirm 一致）。 */
export function validateCredentialInput({ username, password, confirm }) {
	if (typeof username !== 'string' || username.length < 1 || username.length > 64) return 'invalid-username'
	if (typeof password !== 'string' || password.length < 8) return 'password-too-short'
	if (confirm !== undefined && confirm !== password) return 'confirm-mismatch'
	return ''
}

/* ────────────────────────── 宿主半装配 ────────────────────────── */

/** apply 阶段探测的六项上游契约（design「上游契约失配降级」探测清单）。 */
const REQUIRED_CONTRACTS = [
	['connection', 'authorizeIndex'],
	['connection', 'authenticatedUrl'],
	['connection', 'admit'],
	['webServer', 'register'],
	['webServer', 'readResource'],
	['credentials', 'modifyRecord'],
]

/** 服务就绪兜底轮询：间隔与总窗（dsh 插件装载早于服务激活时的保险）。 */
const SERVICE_WAIT_INTERVAL_MS = 200
const SERVICE_WAIT_MAX_ATTEMPTS = 50

/**
 * 插件入口：契约探测 → 注册 exact `/`、`/auth/login`、`/auth/credentials`。
 * 任一契约缺失 → warn 一次、不注册任何路由（原生 token-only）；服务整体未
 * 就绪时短窗轮询兜底，超窗仍缺按契约失配降级。
 * @returns 卸载 disposer（注销路由 + 清限流态）。
 */
export function apply(ctx) {
	/* 日志出口：cordis logger 通道在 dsh 宿主不落 stdout（fenix-skill-provider
	 * src/host/index.ts:76 实测先例）——此前 warn 全部不可见（dsh-web.log 零
	 * 痕迹，用户报障排查受阻）。统一走 console.*：主进程 stderr/stdout →
	 * systemd StandardOutput append → /var/log/dsh-web.log。 */
	const log = (level, message) => {
		const line = `[fenix-dsh-auth] ${message}`
		if (level === 'error') console.error(line)
		else if (level === 'info' || level === 'debug') console.log(line)
		else console.warn(line)
	}

	let services = probeServices(ctx)
	let disposer
	let timer

	if (services !== undefined) {
		disposer = activate(ctx, services, log)
		return () => {
			disposer?.()
			if (timer !== undefined) clearInterval(timer)
		}
	}

	/* 服务晚就绪兜底：dsh bundle 层先装载，insert 条目通常在其后；轮询仅为
	 * 未命中的时序保险，超窗按契约失配降级（warn 一次，不再注册）。 */
	let attempts = 0
	timer = setInterval(() => {
		attempts += 1
		services = probeServices(ctx)
		if (services !== undefined) {
			clearInterval(timer)
			timer = undefined
			disposer = activate(ctx, services, log)
			return
		}
		if (attempts >= SERVICE_WAIT_MAX_ATTEMPTS) {
			clearInterval(timer)
			timer = undefined
			log('warn', `upstream contract unavailable after ${attempts} probes (${describeMissing(ctx)}); keeping native token-only behavior`)
		}
	}, SERVICE_WAIT_INTERVAL_MS)

	return () => {
		disposer?.()
		if (timer !== undefined) clearInterval(timer)
	}
}

/** 探测六项契约；全数满足返回服务引用，否则 undefined。
 *
 * 服务读取一律走 `ctx.get(name)`（dsh-client-connection 内部同款防 throw
 * 读法）：cordis 对未声明 inject 的属性访问（`ctx.connection`）会直接抛
 * `cannot get property ... without inject`，导致插件激活失败——0.2.2-rc.1
 * 首次部署实测。未激活时 get 返回 undefined，由 apply 的短窗轮询兜底。 */
function probeServices(ctx) {
	const read = (serviceName) => {
		try {
			return typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
		} catch {
			return undefined
		}
	}
	for (const [serviceName, method] of REQUIRED_CONTRACTS) {
		if (typeof read(serviceName)?.[method] !== 'function') return undefined
	}
	return { connection: read('connection'), webServer: read('webServer'), credentials: read('credentials') }
}

/** 生成降级 warn 的缺失清单文案。 */
function describeMissing(ctx) {
	return REQUIRED_CONTRACTS
		.filter(([serviceName, method]) => {
			try {
				return typeof ctx.get?.(serviceName)?.[method] !== 'function'
			} catch {
				return true
			}
		})
		.map(([serviceName, method]) => `${serviceName}.${method}`)
		.join(', ')
}

/** 注册三路由并返回 disposer（探测通过后才调用）。 */
function activate(ctx, services, log) {
	const { connection, webServer, credentials } = services
	const limiter = createRateLimiter()
	const disposeRoute = (registerResult, path) => {
		if (typeof registerResult === 'function') return registerResult
		log('warn', `register(${path}) returned no disposer; route persists until reload`)
		return () => {}
	}

	const disposers = []
	try {
		/* 逐个注册、成功一项立即收编 disposer：数组字面量串行求值时后续注册
		 * 抛错会让已注册路由的 disposer 随局部变量一起丢失，停用时无法注销。 */
		for (const [path, handler] of [
			['/', createIndexHandler({ connection, webServer, credentials, limiter, log })],
			['/auth/login', createLoginHandler({ connection, credentials, limiter, webServer, log })],
			['/auth/credentials', createCredentialsHandler({ connection, credentials, limiter, webServer, log })],
		]) {
			disposers.push(disposeRoute(webServer.register({ kind: 'exact', path, handler }), path))
		}
	} catch (error) {
		/* 回滚已注册项（登录页接管不残留到宿主 reload），再降级返回空 disposer。 */
		for (const dispose of disposers.splice(0)) {
			try {
				dispose()
			} catch {}
		}
		log('warn', `route registration failed (${error?.message ?? error}); keeping native token-only behavior`)
		return () => {}
	}
	return () => {
		for (const dispose of disposers) {
			try {
				dispose()
			} catch {}
		}
		limiter.clear()
	}
}

/** 监听协议（cookie Secure 判定与同源 scheme 归一共用）。 */
function listenerProtocol(webServer) {
	return webServer?.protocol === 'https:' ? 'https:' : 'http:'
}

/** 原生降级 401（与 dsh-client-connection writeUnauthorized 同文案同形态）。 */
function writeNativeUnauthorized(req, res) {
	if (res.headersSent) return
	res.writeHead(401, {
		'cache-control': 'no-store',
		'content-type': 'text/plain; charset=utf-8',
	})
	res.end(req.method === 'HEAD' ? undefined : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
}

/** 写登录页（HEAD 只写头；no-store + referrer same-origin + frame-ancestors 防嵌套）。 */
function writeLoginPage(req, res, errorCode) {
	const html = renderLoginPage(errorCode)
	res.writeHead(200, {
		'cache-control': 'no-store',
		'content-type': 'text/html; charset=utf-8',
		'referrer-policy': 'same-origin',
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
		'content-length': Buffer.byteLength(html),
	})
	res.end(req.method === 'HEAD' ? undefined : html)
}

/** 写「不受信任地址」页（403 + HTML：浏览器正常渲染，脚本类调用方仍可见失败语义）。 */
function writeUntrustedHostPage(req, res, details) {
	const html = renderUntrustedHostPage(details)
	res.writeHead(403, {
		'cache-control': 'no-store',
		'content-type': 'text/html; charset=utf-8',
		'referrer-policy': 'same-origin',
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
		'content-length': Buffer.byteLength(html),
	})
	res.end(req.method === 'HEAD' ? undefined : html)
}

/** 读取受信任主机列表（connection 实例字段，公开 d.ts 未声明；仅接受数组形态）。 */
export function readTrustedHosts(connection) {
	try {
		return Array.isArray(connection?.trustedHosts) ? connection.trustedHosts.map(String) : undefined
	} catch {
		return undefined
	}
}

/**
 * 信任探测：connection.isTrusted 在公开 d.ts 为 private（rpc-host.d.ts），
 * 运行时存在才使用；缺失/抛错一律返回 undefined（无法判定），调用方保持
 * 原行为不升级。返回 true 表示当前请求 Host 不受信任。
 */
export function probeUntrusted(connection, headers) {
	try {
		if (typeof connection?.isTrusted !== 'function') return undefined
		return connection.isTrusted({ headers }) !== true
	} catch {
		return undefined
	}
}

/** 写 JSON 响应。 */
function writeJson(res, status, data, headOnly = false) {
	const body = JSON.stringify(data)
	res.writeHead(status, {
		'cache-control': 'no-store',
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
	})
	res.end(headOnly ? undefined : body)
}

/** 303 重定向（no-store + referrer same-origin；HEAD 无 body）。 */
function writeRedirect(req, res, location) {
	res.writeHead(303, {
		'cache-control': 'no-store',
		'referrer-policy': 'same-origin',
		location,
	})
	res.end()
}

/** 读请求体（字节上限 + 读取超时；超限/流错误/读取超时抛错由调用方 400——
 * 超限拒绝 MUST NOT 销毁 socket，否则 400 写在已断连的 socket 上、客户端
 * 只见空回复）。导出供测试。 */
export function readRequestBody(req, maxBytes) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let total = 0
		let settled = false
		// 超时兜底：慢速/半开连接不发完 body 时 promise 也能 settle，由调用方 400。
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			reject(new Error(`request body read timed out after ${BODY_READ_TIMEOUT_MS}ms`))
		}, BODY_READ_TIMEOUT_MS)
		const onData = (chunk) => {
			if (settled) return
			total += chunk.length
			if (total > maxBytes) {
				settled = true
				clearTimeout(timer)
				// 摘除 data 监听丢弃余量；保留 socket 让上层 handler 把
				// 400 送达客户端，响应完成后由 Node 关闭未读完的连接。
				req.removeListener('data', onData)
				reject(Object.assign(new Error(`request body exceeds ${maxBytes} bytes`), { code: 'FENIX_BODY_TOO_LARGE' }))
				return
			}
			chunks.push(chunk)
		}
		req.on('data', onData)
		req.on('end', () => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			resolve(Buffer.concat(chunks).toString('utf8'))
		})
		req.on('error', (error) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			reject(error)
		})
	})
}

/** 请求头取值（node:http 单值头可能为 string | string[]）。 */
function headerValue(headers, name) {
	const value = headers?.[name]
	return Array.isArray(value) ? value[0] : value
}

/**
 * 首页 `/` 接管（design D2/D3）：
 *   authorizeIndex → true（cookie 有效）：admit 取 owner peer，readResource
 *   固定读 `/index.html`（`/` 会命中本插件 handler，无 fall-through），回写
 *   官方 index（含索引注入与 base href 语义）；
 *   → false 且 sink 401：改写登录页（凭据未配置时带 unconfigured 提示）；
 *   → false 且其余（原生 303 铸 cookie）：原样回放 status/headers/body。
 * 全程 try/catch 降级原生 401 文本，不外溢异常。
 */
function createIndexHandler({ connection, webServer, credentials, limiter, log }) {
	return async function handleIndex(req, res) {
		/** ConnectionIndexResponse sink：捕获 authorizeIndex 的写出，真实 res 不被触碰。 */
		const sinkStatus = { code: 0, headers: undefined, body: undefined }
		const sink = {
			writeHead(status, headers) {
				sinkStatus.code = status
				sinkStatus.headers = headers !== undefined ? { ...headers } : {}
				return res
			},
			end(body) {
				sinkStatus.body = body
				return res
			},
		}
		try {
			let authorized
			try {
				authorized = connection.authorizeIndex({ headers: req.headers, method: req.method, url: req.url }, sink) === true
			} catch (error) {
				log('warn', `authorizeIndex failed (${error?.message ?? error}); falling back to native 401`)
				return writeNativeUnauthorized(req, res)
			}

			if (authorized) {
				let admission
				try {
					admission = connection.admit({ headers: req.headers })
				} catch (error) {
					log('warn', `admit failed (${error?.message ?? error}); falling back to native 401`)
					return writeNativeUnauthorized(req, res)
				}
				const rejection = admission !== undefined && admission !== null && 'rejection' in admission ? admission.rejection : undefined
				if (rejection === 403) {
					/* cookie 有效但 Host 不受信任（authorizeIndex 与 admit 的信任
					 * 判定不对称）：出解释页替代原生 401 文案（用户报障根因）。 */
					const host = headerValue(req.headers, 'host')
					log('warn', `admit refused an authenticated index request (403, host=${host ?? '?'}); serving untrusted-host page`)
					return writeUntrustedHostPage(req, res, { host, trustedHosts: readTrustedHosts(connection) })
				}
				if (admission !== undefined && admission !== null && !('rejection' in admission) && admission.peer !== undefined) {
					/* 固定读 /index.html：readResource 按同一匹配表选 responder，
					 * `/` 自身会命中本插件 handler 返回 404（design D2 关键坑）。 */
					const response = await webServer.readResource(new Request('http://dsh.invalid/index.html'), admission.peer)
					const headers = {}
					response.headers?.forEach?.((value, name) => {
						headers[name] = value
					})
					const headOnly = req.method === 'HEAD'
					if (headOnly) {
						res.writeHead(response.status, headers)
						res.end()
						return
					}
					const body = response.body === null || response.body === undefined ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
					headers['content-length'] = String(body.length)
					res.writeHead(response.status, headers)
					res.end(body)
					return
				}
				log('warn', `admit refused an authenticated index request (${admission?.rejection ?? 'no admission'}); falling back to native 401`)
				return writeNativeUnauthorized(req, res)
			}

			if (sinkStatus.code === 401) {
				const record = await readLoginRecord(credentials, log)
				const payload = record?.payload
				const configured = payload !== undefined && payload !== null && typeof payload === 'object' && typeof payload.hash === 'string'
				/* 未认证且 Host 不受信任：登录页直接挂横幅预告（登录成功也进不去）。 */
				if (probeUntrusted(connection, req.headers) === true) {
					return writeLoginPage(req, res, 'untrusted')
				}
				return writeLoginPage(req, res, configured ? '' : 'unconfigured')
			}

			/* 原生输出（有效 token 的 303 + set-cookie 等）原样回放，不复制签名语义。 */
			res.writeHead(sinkStatus.code, sinkStatus.headers ?? {})
			res.end(req.method === 'HEAD' ? undefined : sinkStatus.body)
		} catch (error) {
			log('warn', `index handler degraded (${error?.message ?? error})`)
			try {
				writeNativeUnauthorized(req, res)
			} catch {}
		}
	}
}

/**
 * 登录端点 `/auth/login`（design D4/D8）：GET（含 ?error= 白名单）直出登录
 * 页；POST 同源校验 → 8KB 限读 + Content-Type 白名单解析 → 限流判定 → 并发
 * 闸门（在飞派生上限，超限按锁定响应）→ scrypt + 用户名校验；成功 303
 * `authenticatedUrl(origin + '/')`（原生 authorizeIndex 随即
 * 铸 cookie 并 303 回 `./`，地址栏不残留 token）；失败 303 error=invalid；
 * 未配置 303 error=unconfigured；锁定 303 error=locked；超长/类型不符 400。
 */
function createLoginHandler({ connection, credentials, limiter, webServer, log }) {
	/** 未认证登录派生的在飞计数（见 MAX_CONCURRENT_LOGIN_DERIVATIONS）。 */
	let inFlightDerivations = 0
	return async function handleLogin(req, res) {
		try {
			if (req.method === 'GET' || req.method === 'HEAD') {
				let rawError = ''
				try {
					rawError = new URL(req.url ?? '/', 'http://dsh.invalid').searchParams.get('error') ?? ''
				} catch {}
				return writeLoginPage(req, res, normalizeLoginError(rawError))
			}
			if (req.method !== 'POST') {
				res.writeHead(405, { allow: 'GET, HEAD, POST' })
				res.end()
				return
			}

			const protocol = listenerProtocol(webServer)
			if (!isSameOrigin(headerValue(req.headers, 'origin'), headerValue(req.headers, 'host'), protocol)) {
				log('warn', 'login rejected: cross-origin request')
				writeJson(res, 403, { error: 'cross-origin' })
				return
			}

			/* 信任预检（fail-fast）：不受信任 Host 上凭据验证必然白费——登录后
			 * admit 仍会 403。先回登录页挂 untrusted 横幅，点击即得明确反馈。 */
			if (probeUntrusted(connection, req.headers) === true) {
				const host = headerValue(req.headers, 'host')
				log('warn', `login rejected: untrusted host (${host ?? '?'})`)
				return writeRedirect(req, res, '/auth/login?error=untrusted')
			}

			let body
			try {
				body = await readRequestBody(req, MAX_LOGIN_BODY_BYTES)
			} catch (error) {
				writeJson(res, 400, { error: error?.code === 'FENIX_BODY_TOO_LARGE' ? 'body-too-large' : 'body-read-failed' })
				return
			}
			const parsed = parseLoginBody(body, headerValue(req.headers, 'content-type'))
			if (parsed === null) {
				writeJson(res, 400, { error: 'unsupported-body' })
				return
			}

			const remoteAddress = req.socket?.remoteAddress ?? ''
			/* 空地址归一到哨兵键：limiter 对空串直接放行，会让取不到远端地址的
			 * 连接整体绕过失败锁定（无限次尝试口令）。 */
			const rateLimitAddress = normalizeRateLimitAddress(remoteAddress)
			if (limiter.isLocked(rateLimitAddress)) {
				return writeRedirect(req, res, '/auth/login?error=locked')
			}

			const record = await readLoginRecord(credentials, log)
			const payload = record?.payload
			if (payload === undefined || payload === null || typeof payload !== 'object' || typeof payload.hash !== 'string') {
				return writeRedirect(req, res, '/auth/login?error=unconfigured')
			}

			/* 并发闸门：检查与递增之间不 await，保证在飞派生数不超过上限；超限
			 * 请求按锁定处理（计入限流失败数会让廉价请求反过来锁死该来源）。 */
			if (inFlightDerivations >= MAX_CONCURRENT_LOGIN_DERIVATIONS) {
				log('warn', `login derivation concurrency cap (${MAX_CONCURRENT_LOGIN_DERIVATIONS}) hit; rejecting attempt from ${remoteAddress || '?'}`)
				return writeRedirect(req, res, '/auth/login?error=locked')
			}
			let passwordOk
			inFlightDerivations += 1
			try {
				passwordOk = await verifyPassword(parsed.password, payload)
			} catch (error) {
				log('warn', `password verification failed unexpectedly (${error?.message ?? error})`)
				passwordOk = false
			} finally {
				inFlightDerivations -= 1
			}
			/* username 一并校验（凭据记录保存的账号名参与判定，不再只是展示）。
			 * scrypt 无条件先跑：用户名错与密码错同路分流（同一 error=invalid +
			 * 限流计数），不靠响应时序区分哪个字段错。 */
			const usernameOk = verifyUsername(parsed.username, payload)
			if (!passwordOk || !usernameOk) {
				const locked = limiter.fail(rateLimitAddress)
				if (locked) {
					/* 锁定留痕：限流按 remoteAddress 分桶，反代/本机聚合部署下任一
					 * 来源可把共享地址锁死——先从日志可见（局限说明见 README
					 * 「安全边界」）。 */
					log('warn', `login rate limit locked source ${remoteAddress || '?'} for ${RATE_LOCK_MS}ms after ${RATE_MAX_FAILS} failures`)
				}
				return writeRedirect(req, res, '/auth/login?error=invalid')
			}

			limiter.reset(rateLimitAddress)
			/* Host 为请求方可控头，铸 token 的重定向 base 直接取自它。上方信任
			 * 预检只拦「确定不受信」（probeUntrusted === true），isTrusted 缺失或
			 * 抛错时返回 undefined 即放行——DNS rebinding / 改写 Host 的反向代理
			 * 可借此把会话 token 重定向到非受信域外泄。此处复核：未能确证受信
			 * （!== false，含 readTrustedHosts/isTrusted 不可用）一律回退既有
			 * error=untrusted 重定向，不签发带 token 的跳转。 */
			if (probeUntrusted(connection, req.headers) !== false) {
				log('warn', 'login success redirect withheld: host trust not confirmable; falling back to error=untrusted')
				return writeRedirect(req, res, '/auth/login?error=untrusted')
			}
			const base = `${protocol}//${headerValue(req.headers, 'host') ?? 'localhost'}/`
			let target
			try {
				target = connection.authenticatedUrl(base)
			} catch (error) {
				log('warn', `authenticatedUrl failed (${error?.message ?? error}); redirecting without token`)
				target = base
			}
			writeRedirect(req, res, target)
		} catch (error) {
			log('warn', `login handler degraded (${error?.message ?? error})`)
			try {
				writeJson(res, 500, { error: 'internal' })
			} catch {}
		}
	}
}

/**
 * 凭据端点 `/auth/credentials`（design D6/D9）：三方法均要求 admit 通过
 * （未认证 401）；GET/HEAD `{configured, username}`（HEAD 只写头，不回显密码/哈希/盐）；POST/
 * DELETE 严格同源（isSameOriginStrict：Origin 缺失判 403）；POST 参数校验
 * （username 1-64、password ≥8、confirm 一致）+ key 段校验 → scrypt 派生 →
 * modifyRecord 写入；DELETE → deleteRecord + 清该来源限流（回退 token-only）；
 * 参数非法 400 JSON。
 */
function createCredentialsHandler({ connection, credentials, limiter, webServer, log }) {
	return async function handleCredentials(req, res) {
		/* HEAD 在各错误分支同样只写头（与 GET/HEAD 成功分支、writeNativeUnauthorized
		 * / writeLoginPage 的 HEAD 处理一致）。 */
		const headOnly = req.method === 'HEAD'
		try {
			let admission
			try {
				admission = connection.admit({ headers: req.headers })
			} catch (error) {
				log('warn', `credentials admit failed (${error?.message ?? error})`)
				admission = { rejection: 401 }
			}
			if (admission === undefined || admission === null || 'rejection' in admission || admission.peer === undefined) {
				writeJson(res, 401, { error: 'unauthenticated' }, headOnly)
				return
			}

			if (req.method === 'GET' || req.method === 'HEAD') {
				const record = await readLoginRecord(credentials, log)
				const payload = record?.payload
				const configured = payload !== undefined && payload !== null && typeof payload === 'object' && typeof payload.hash === 'string'
				writeJson(res, 200, { configured, username: configured ? String(payload.username ?? '') : null }, headOnly)
				return
			}

			if (req.method === 'POST') {
				const protocol = listenerProtocol(webServer)
				/* 写路径用严格同源（review a9fb0cff763d）：Origin 缺失判 403，
				 * cookie 认证的写请求在同源判定之外仅剩 admit 一层防线。 */
				if (!isSameOriginStrict(headerValue(req.headers, 'origin'), headerValue(req.headers, 'host'), protocol)) {
					log('warn', 'credential write rejected: cross-origin request')
					writeJson(res, 403, { error: 'cross-origin' }, headOnly)
					return
				}
				let body
				try {
					body = await readRequestBody(req, MAX_LOGIN_BODY_BYTES)
				} catch (error) {
					writeJson(res, 400, { error: error?.code === 'FENIX_BODY_TOO_LARGE' ? 'body-too-large' : 'body-read-failed' }, headOnly)
					return
				}
				const parsed = parseCredentialBody(body, headerValue(req.headers, 'content-type'))
				if (parsed === null) {
					writeJson(res, 400, { error: 'unsupported-body' }, headOnly)
					return
				}
				const invalid = validateCredentialInput(parsed)
				if (invalid !== '') {
					writeJson(res, 400, { error: invalid }, headOnly)
					return
				}
				/* 凭据 key 段写入前实际校验（review b85f804d0d02）：兑现头注释
				 * 「KEY_SEGMENT_PATTERN 语义校验」的运行路径承诺；当前常量为静态
				 * 合法值，此处是 key 动态化前的哨兵。 */
				if (!isCredentialKeySegment(CREDENTIAL_SCOPE) || !isCredentialKeySegment(CREDENTIAL_ID)) {
					log('warn', `credential key segment invalid (${CREDENTIAL_KEY}); refusing to write record`)
					writeJson(res, 500, { error: 'internal' }, headOnly)
					return
				}
				const { salt, hash } = await hashPassword(parsed.password)
				await credentials.modifyRecord(CREDENTIAL_KEY, async () => ({
					kind: 'grant',
					payload: { version: 1, username: parsed.username, salt, hash, N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, keylen: SCRYPT_PARAMS.keylen },
				}))
				writeJson(res, 200, { configured: true, username: parsed.username })
				return
			}

			if (req.method === 'DELETE') {
				const protocol = listenerProtocol(webServer)
				if (!isSameOriginStrict(headerValue(req.headers, 'origin'), headerValue(req.headers, 'host'), protocol)) {
					log('warn', 'credential delete rejected: cross-origin request')
					writeJson(res, 403, { error: 'cross-origin' }, headOnly)
					return
				}
				if (typeof credentials.deleteRecord !== 'function') {
					log('warn', 'credentials.deleteRecord unavailable; cannot remove credential record')
					writeJson(res, 501, { error: 'delete-unsupported' }, headOnly)
					return
				}
				await credentials.deleteRecord(CREDENTIAL_KEY)
				/* 与登录计数同一归一化：取不到远端地址时清哨兵桶，否则 reset('')
				 * 空操作、该来源的失败锁定残留。 */
				limiter.reset(normalizeRateLimitAddress(req.socket?.remoteAddress ?? ''))
				writeJson(res, 200, { configured: false })
				return
			}

			res.writeHead(405, { allow: 'GET, HEAD, POST, DELETE' })
			res.end()
		} catch (error) {
			log('warn', `credentials handler degraded (${error?.message ?? error})`)
			try {
				writeJson(res, 500, { error: 'internal' }, headOnly)
			} catch {}
		}
	}
}

/**
 * 读凭据记录（readRecord 不在 apply 探测清单内，运行期防御缺失/异常）。
 * 读故障（存储/权限等）warn 留痕后与「从未配置」同形返回 undefined——对外
 * 契约不变（登录页 unconfigured 提示 / 凭据 GET configured:false），但日志
 * 可区分排查，不再静默吞错。
 */
async function readLoginRecord(credentials, log) {
	if (typeof credentials?.readRecord !== 'function') return undefined
	try {
		return await credentials.readRecord(CREDENTIAL_KEY)
	} catch (error) {
		log?.('warn', `credential record read failed (${error?.message ?? error}); treating as unconfigured`)
		return undefined
	}
}
