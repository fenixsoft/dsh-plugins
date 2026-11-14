/**
 * fenix-dsh-auth — Host 半单测（node:test，零外部依赖）。
 *
 * 覆盖 SPEC 测试面：scrypt 哈希/校验（正确与错误）、失败限流（5 次/60s 触发、
 * 锁定与窗口过期）、登录页 HTML（不含 token/密码/哈希、`<script>` 转义、
 * 错误码白名单、无 animation/transition）、登录/凭据请求体解析（超长拒绝、
 * Content-Type 白名单）、Origin/Host 同源判定（同源/跨源/缺失 Origin）。
 *
 * 运行：`node --test /root/dsh-plugins/fenix-dsh-auth/tests/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
	hashPassword,
	verifyPassword,
	createRateLimiter,
	rateLimitHit,
	renderLoginPage,
	renderUntrustedHostPage,
	probeUntrusted,
	readTrustedHosts,
	escapeHtml,
	normalizeLoginError,
	parseLoginBody,
	parseCredentialBody,
	validateCredentialInput,
	isSameOrigin,
	readRequestBody,
	CREDENTIAL_KEY,
} from '../index.js'

/* ── scrypt 哈希与校验 ── */

test('hashPassword produces scrypt record with declared params', async () => {
	const record = await hashPassword('correct horse battery staple')
	assert.equal(record.N, 131072)
	assert.equal(record.r, 8)
	assert.equal(record.p, 1)
	assert.equal(record.keylen, 64)
	// 16 字节随机盐 → 32 hex 字符；64 字节哈希 → 128 hex 字符
	assert.equal(Buffer.from(record.salt, 'hex').length, 16)
	assert.equal(Buffer.from(record.hash, 'hex').length, record.keylen)
	// 两次派生盐不同（随机）
	const other = await hashPassword('correct horse battery staple')
	assert.notEqual(other.salt, record.salt)
	assert.notEqual(other.hash, record.hash)
})

test('verifyPassword accepts the right password and rejects the wrong one', async () => {
	const record = await hashPassword('hunter2hunter2')
	assert.equal(await verifyPassword('hunter2hunter2', record), true)
	assert.equal(await verifyPassword('hunter2hunter3', record), false)
	assert.equal(await verifyPassword('', record), false)
	// 形态不完整的 payload 一律 false（不抛异常）
	assert.equal(await verifyPassword('x', {}), false)
	assert.equal(await verifyPassword('x', null), false)
	assert.equal(await verifyPassword('x', { salt: 'zz', hash: '00' }), false)
})

/* ── 失败限流 ── */

test('rate limiter locks after 5 failures inside the 60s window', () => {
	const limiter = createRateLimiter()
	const now = 1_000_000
	for (let i = 0; i < 4; i += 1) limiter.fail('10.0.0.1', now)
	assert.equal(limiter.isLocked('10.0.0.1', now), false, '4 fails must not lock')
	limiter.fail('10.0.0.1', now + 1_000)
	assert.equal(limiter.isLocked('10.0.0.1', now + 1_000), true, '5th fail locks')
	assert.equal(rateLimitHit(limiter, '10.0.0.1', now + 2_000), true, 'locked even with correct password')
	// 其他来源不受影响
	assert.equal(limiter.isLocked('10.0.0.2', now + 1_000), false)
})

test('rate limiter unlocks after the lock window and recounts after the failure window', () => {
	const limiter = createRateLimiter()
	const now = 2_000_000
	for (let i = 0; i < 5; i += 1) limiter.fail('10.0.0.3', now)
	assert.equal(limiter.isLocked('10.0.0.3', now + 59_000), true)
	assert.equal(limiter.isLocked('10.0.0.3', now + 61_000), false, 'lock expires after 60s')
	// 锁过期但失败窗口也在 60s 后过期 → 重新计数：再 4 次不锁，第 5 次锁
	for (let i = 0; i < 4; i += 1) limiter.fail('10.0.0.3', now + 62_000)
	assert.equal(limiter.isLocked('10.0.0.3', now + 62_000), false)
	limiter.fail('10.0.0.3', now + 62_000)
	assert.equal(limiter.isLocked('10.0.0.3', now + 62_000), true)
})

test('rate limiter resets on success and prunes expired entries', () => {
	const limiter = createRateLimiter()
	const now = 3_000_000
	limiter.fail('10.0.0.4', now)
	limiter.reset('10.0.0.4')
	for (let i = 0; i < 5; i += 1) limiter.fail('10.0.0.4', now + 1)
	assert.equal(limiter.isLocked('10.0.0.4', now + 1), true, 'fresh window after reset still locks at 5')
	// 清理：窗口+锁均过期后，条目被顺带清理（内部 Map 体积回零）
	assert.equal(limiter.isLocked('10.0.0.4', now + 121_000), false)
	limiter.pruneProbe = undefined // 无此 API 仅为占位，防误用断言
})

/* ── 登录页 HTML ── */

test('login page never contains token, passwords, hashes, animations or transitions', () => {
	for (const code of ['', 'invalid', 'locked', 'unconfigured']) {
		const html = renderLoginPage(code)
		assert.ok(html.includes('<form'), 'contains the login form')
		assert.ok(!/animation|transition/i.test(html), `code=${code} must be static`)
		// 不含 launchToken 的「值」形态（query 挂载 / 32+ 连续 base64url 字面量）；
		// 指引性文案提及「token URL」一词不受限（中文提示不含长 ASCII 串）
		assert.ok(!/token=/i.test(html), `code=${code} must not carry a token value`)
		assert.ok(!/[A-Za-z0-9_-]{32,}/.test(html.replace(/<!doctype html>/, '')), `code=${code} must not carry a token-like literal`)
		assert.ok(!html.includes('dsh web authentication required'), 'must not leak the native 401 text')
		// referrer policy 禁用 no-referrer：该政策会把本页 form POST 的 Origin
		// 头置为 null（opaque origin），触发服务端跨源 403 自伤（实测踩坑）
		assert.ok(!html.includes('no-referrer'), 'must not set referrer no-referrer (breaks form POST Origin)')
		// 无任何凭据形态（hex 哈希/盐）
		assert.ok(!/[0-9a-f]{64}/.test(html), 'no hash-like hex literals')
	}
})

test('login page escapes reflected values and whitelists error codes', () => {
	assert.ok(renderLoginPage('invalid').includes('用户名或密码错误'))
	assert.ok(renderLoginPage('locked').includes('60 秒'))
	assert.ok(renderLoginPage('unconfigured').includes('未配置账号密码'))
	// 白名单外错误码折为无提示（不反射任何原值）
	const reflected = renderLoginPage('<script>alert(1)</script>')
	assert.ok(!reflected.includes('<script>'), 'unknown error code must not be reflected')
	assert.ok(escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;')
	assert.equal(normalizeLoginError('"><img src=x>'), '')
})

/* ── 请求体解析（含超长拒绝） ── */

function fakeRequest(body, { delayMs = 0 } = {}) {
	const req = new EventEmitter()
	req.socket = { remoteAddress: '127.0.0.1' }
	req.destroyed = false
	req.destroy = () => {
		req.destroyed = true
	}
	process.nextTick(() => {
		if (delayMs > 0) {
			const chunk = Buffer.from(body)
			req.emit('data', chunk.slice(0, Math.ceil(chunk.length / 2)))
			setTimeout(() => {
				if (req.destroyed) return
				req.emit('data', chunk.slice(Math.ceil(chunk.length / 2)))
				req.emit('end')
			}, delayMs)
			return
		}
		if (req.destroyed) return
		if (body.length > 0) req.emit('data', Buffer.from(body))
		req.emit('end')
	})
	return req
}

test('readRequestBody rejects oversized bodies (8KB cap)', async () => {
	const maxBytes = 8 * 1024
	const oversized = 'a'.repeat(maxBytes + 1)
	const req = fakeRequest(oversized)
	await assert.rejects(
		readRequestBody(req, maxBytes),
		(error) => error.code === 'FENIX_BODY_TOO_LARGE',
	)
	// 超限拒绝 MUST NOT 销毁底层 socket（destroy 先于响应会令 SPEC 要求的
	// 400 body-too-large 无法送达，客户端只见断连空回复）
	assert.equal(req.destroyed, false)
	// 恰好不超限的 body 正常读取
	const ok = await readRequestBody(fakeRequest('username=u&password=p'), maxBytes)
	assert.equal(ok, 'username=u&password=p')
})

test('readRequestBody rejects bodies that cross the cap mid-stream', async () => {
	const maxBytes = 1024
	const half = 'a'.repeat(maxBytes / 2)
	const req = fakeRequest(half + half + half, { delayMs: 5 })
	await assert.rejects(readRequestBody(req, maxBytes), (error) => error.code === 'FENIX_BODY_TOO_LARGE')
	assert.equal(req.destroyed, false)
})

test('parseLoginBody accepts urlencoded and JSON only', () => {
	assert.deepEqual(
		parseLoginBody('username=user%40x&password=p%26w', 'application/x-www-form-urlencoded; charset=utf-8'),
		{ username: 'user@x', password: 'p&w' },
	)
	assert.deepEqual(parseLoginBody(JSON.stringify({ username: 'u', password: 'p' }), 'application/json'), { username: 'u', password: 'p' })
	assert.equal(parseLoginBody('username=u&password=p', 'text/plain'), null)
	assert.equal(parseLoginBody('not json', 'application/json'), null)
	assert.equal(parseLoginBody('', 'application/json'), null)
	assert.equal(parseLoginBody('username=u', 'application/x-www-form-urlencoded'), null, 'missing password')
})

test('parseCredentialBody accepts JSON with confirm and urlencoded fallback', () => {
	assert.deepEqual(
		parseCredentialBody(JSON.stringify({ username: 'u', password: 'p'.repeat(8), confirm: 'p'.repeat(8) }), 'application/json'),
		{ username: 'u', password: 'p'.repeat(8), confirm: 'p'.repeat(8) },
	)
	assert.deepEqual(
		parseCredentialBody('username=u&password=p12345678', 'application/x-www-form-urlencoded'),
		{ username: 'u', password: 'p12345678', confirm: undefined },
	)
	assert.equal(parseCredentialBody('x', 'text/plain'), null)
})

test('validateCredentialInput enforces username 1-64, password >=8, confirm match', () => {
	assert.equal(validateCredentialInput({ username: 'user', password: 'p'.repeat(8), confirm: 'p'.repeat(8) }), '')
	assert.equal(validateCredentialInput({ username: 'user', password: 'p'.repeat(8) }), '', 'confirm optional')
	assert.equal(validateCredentialInput({ username: '', password: 'p'.repeat(8) }), 'invalid-username')
	assert.equal(validateCredentialInput({ username: 'u'.repeat(65), password: 'p'.repeat(8) }), 'invalid-username')
	assert.equal(validateCredentialInput({ username: 'user', password: 'p'.repeat(7) }), 'password-too-short')
	assert.equal(validateCredentialInput({ username: 'user', password: 'p'.repeat(8), confirm: 'q'.repeat(8) }), 'confirm-mismatch')
})

/* ── 同源判定 ── */

test('isSameOrigin accepts same-origin and missing Origin, rejects cross-origin', () => {
	// 同源（端口显隐等价 + 默认端口归一化）
	assert.equal(isSameOrigin('http://dsh.example:3080', 'dsh.example:3080', 'http:'), true)
	assert.equal(isSameOrigin('https://dsh.example', 'dsh.example', 'https:'), true, 'https default port 443')
	assert.equal(isSameOrigin('https://dsh.example:443', 'dsh.example', 'https:'), true, 'explicit 443 == omitted')
	assert.equal(isSameOrigin('http://dsh.example:80', 'dsh.example', 'http:'), true, 'explicit 80 == omitted')
	assert.equal(isSameOrigin('http://192.168.1.5:3080', '192.168.1.5:3080', 'http:'), true)
	// Origin 缺失按同源（非浏览器客户端，仍受限流）
	assert.equal(isSameOrigin(undefined, 'dsh.example:3080', 'http:'), true)
	assert.equal(isSameOrigin(null, 'dsh.example:3080', 'http:'), true)
	assert.equal(isSameOrigin('', 'dsh.example:3080', 'http:'), true)
	// 跨源：主机不同、端口不同、协议不同、Origin: null
	assert.equal(isSameOrigin('http://evil.example:3080', 'dsh.example:3080', 'http:'), false)
	assert.equal(isSameOrigin('http://dsh.example:1234', 'dsh.example:3080', 'http:'), false)
	assert.equal(isSameOrigin('https://dsh.example:3080', 'dsh.example:3080', 'http:'), false)
	assert.equal(isSameOrigin('null', 'dsh.example:3080', 'http:'), false)
	assert.equal(isSameOrigin('not a url', 'dsh.example:3080', 'http:'), false)
	// IPv6 Host 头（带方括号）
	assert.equal(isSameOrigin('http://[::1]:3080', '[::1]:3080', 'http:'), true)
	assert.equal(isSameOrigin('http://[::2]:3080', '[::1]:3080', 'http:'), false)
})

/* ── 凭据 key ── */

test('credential key keeps the <owner>/<id> dsh form', () => {
	assert.equal(CREDENTIAL_KEY, 'fenix-dsh-auth/login')
})

/* ── 不受信任地址（用户报障 m00694 修复面） ── */

test('untrusted is a whitelisted login error and renders its banner', () => {
	assert.equal(normalizeLoginError('untrusted'), 'untrusted')
	const html = renderLoginPage('untrusted')
	assert.ok(html.includes('信任主机'), 'banner text present')
	assert.ok(!/animation|transition/i.test(html), 'static rendering kept')
	// 白名单外仍折为无提示
	assert.equal(normalizeLoginError('javascript:alert(1)'), '')
})

test('renderUntrustedHostPage explains and escapes, leaking no secrets', () => {
	const html = renderUntrustedHostPage({ host: 'icyfenix.cn:3080', trustedHosts: ['home.icyfenix.cn:3080', '112.74.85.74:3080'] })
	assert.ok(html.includes('<code>icyfenix.cn:3080</code>'), 'current host shown')
	assert.ok(html.includes('home.icyfenix.cn:3080'), 'trusted list item 1')
	assert.ok(html.includes('112.74.85.74:3080'), 'trusted list item 2')
	assert.ok(html.includes('--trusted-host'), 'remediation hint')
	assert.ok(!html.includes('token='), 'no launch token')
	assert.ok(!html.includes('dsh-auth-'), 'no cookie name')
	assert.ok(!/animation|transition/i.test(html), 'static rendering kept')
})

test('renderUntrustedHostPage degrades gracefully without host or list', () => {
	const html = renderUntrustedHostPage({})
	assert.ok(html.includes('当前地址'), 'generic host wording')
	assert.ok(!html.includes('<ul>'), 'no empty list block')
})

test('probeUntrusted uses private isTrusted and never throws', () => {
	assert.equal(probeUntrusted({ isTrusted: () => true }, { host: 'a:1' }), false)
	assert.equal(probeUntrusted({ isTrusted: () => false }, { host: 'a:1' }), true)
	assert.equal(probeUntrusted({ isTrusted: () => { throw new Error('boom') } }, {}), undefined)
	assert.equal(probeUntrusted({}, {}), undefined)
	assert.equal(probeUntrusted(undefined, {}), undefined)
})

test('readTrustedHosts accepts only array form', () => {
	assert.deepEqual(readTrustedHosts({ trustedHosts: ['a:1', 'b:2'] }), ['a:1', 'b:2'])
	assert.equal(readTrustedHosts({ trustedHosts: 'a:1' }), undefined)
	assert.equal(readTrustedHosts({}), undefined)
	assert.equal(readTrustedHosts(undefined), undefined)
})
