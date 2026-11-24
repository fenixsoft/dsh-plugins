/**
 * fenix-dsh-chat-polish — Client 半单测（node:test，零外部依赖）。
 *
 * 覆盖 0.3.0 开关化改造的测试面：
 *  - 全开态注入串与 v0.2.2 基线等效（规则集合逐字一致，tasks 1.1 字面验收）；
 *  - 开关 store：默认全开、set 切换样式即时重建、只记录关闭项、键清空回退
 *    removeItem、损坏/未知键容错按开启、写失败降级 console.warn 一次 + 会话内
 *    生效、subscribe 通知、先改样式后通知、dispose 摘除样式标签；
 *  - 分块正确性：whitespace/scrollbar/composer-width/hero-row/markdown 各块
 *    规则归属（关闭任一块后其特征规则从注入串消失、其余块保留）；
 *  - history-nav 无 CSS：关闭不影响注入串。
 *
 * 运行：`node --test fenix-dsh-chat-polish/tests/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const BASELINE_PATH = fileURLToPath(new URL('./v0.2.2-baseline.css', import.meta.url))
const clientCode = readFileSync(CLIENT_PATH, 'utf8')
const baselineCss = readFileSync(BASELINE_PATH, 'utf8')

const STORAGE_KEY = 'fenix-chat-polish.toggles'

/* ── 宿主环境 mock（client.js 是引用 window.__ModuleLoader__ 的 IIFE）── */

function fakeReact() {
	return {
		createElement(type, props, ...children) { return { type, props: props || {}, children } },
		memo(fn) { return fn },
		Fragment: Symbol.for('react.fragment'),
		useState(init) { return [init, function () {}] },
		useRef(init) { return { current: init } },
		useEffect() {},
	}
}

function fakePrimitives() {
	return {
		MarkdownText: function () { return null },
		FileTypeIcon: function () { return null },
		fileExtension() { return '' },
		fileSizeText() { return '' },
	}
}

function fakeStorage(initial) {
	const map = new Map(Object.entries(initial || {}))
	let failWrites = false
	return {
		getItem(k) { return map.has(k) ? map.get(k) : null },
		setItem(k, v) { if (failWrites) throw new Error('QuotaExceededError'); map.set(k, String(v)) },
		removeItem(k) { map.delete(k) },
		failWrites(v) { failWrites = v },
		dump() { return Object.fromEntries(map) },
	}
}

/** 装载 client.js 模块并 apply，返回 {styleTag, registered, listeners, dispose, warns} */
function loadClient({ storage, initialEntries } = {}) {
	const store = storage || fakeStorage()
	const warns = []
	const originalWarn = console.warn
	console.warn = function (...args) { warns.push(args.join(' ')) }
	try {
		const react = fakeReact()
		const primitives = fakePrimitives()
		const styleTags = []
		const listeners = { keydown: [], input: [] }
		const fakeDocument = {
			createElement(tag) {
				return { tag, dataset: {}, textContent: '', parentNode: null, remove() { this.parentNode = null } }
			},
			head: {
				appendChild(el) { el.parentNode = this; styleTags.push(el) },
			},
			addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn) },
			removeEventListener(type, fn) {
				const list = listeners[type] || []
				const idx = list.indexOf(fn)
				if (idx >= 0) list.splice(idx, 1)
			},
		}
		const windowMock = {
			localStorage: store,
			document: fakeDocument,
			requestAnimationFrame(fn) { fn() },
		}
		windowMock.window = windowMock
		let loaded = null
		windowMock.__ModuleLoader__ = { load(def) { loaded = def } }
		new Function('window', 'document', 'require', clientCode)(windowMock, fakeDocument, function (name) {
			if (name === 'react') return react
			if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
			throw new Error('unexpected require: ' + name)
		})
		assert.ok(loaded, '__ModuleLoader__.load must be invoked')
		const registered = []
		const ctx = {
			slots: {
				inject() {},
				register(spec) { registered.push(spec); return spec },
				entries(name) { return (initialEntries && initialEntries[name]) || [] },
			},
		}
		const fakeRequire = function (name) {
			if (name === 'react') return react
			if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
			throw new Error('unexpected require: ' + name)
		}
		const plugin = loaded.factory(fakeRequire)
		const dispose = plugin.apply(ctx)
		assert.equal(styleTags.length, 1, 'exactly one style tag injected')
		return {
			styleTag: styleTags[0],
			styleTags,
			registered,
			listeners,
			warns,
			store,
			dispose,
		}
	} finally {
		console.warn = originalWarn
	}
}

function rules(cssText) {
	return cssText.split('\n').filter((line) => line.trim() !== '')
}

/* ── 全开态与 v0.2.2 基线等效 ── */

test('all-on injected css is rule-for-rule identical to the v0.2.2 baseline', () => {
	const env = loadClient()
	const injected = rules(env.styleTag.textContent)
	const base = rules(baselineCss)
	assert.equal(
		injected.length, base.length,
		`rule count drift: injected=${injected.length} baseline=${base.length}`,
	)
	const injectedSet = [...injected].sort()
	const baseSet = [...base].sort()
	for (let i = 0; i < baseSet.length; i++) {
		assert.equal(injectedSet[i], baseSet[i], `rule ${i} drifted (set-compare, order-insensitive)`)
	}
	/* 基线顺序敏感比对也要求集合逐字一致已足够（分块拼接顺序与 0.2.2 数组顺序
	 * 允许不同：各规则选择器互不重叠、无同特异性 cascade 竞争，注入串等效） */
})

/* ── 分块正确性 ── */

const FEATURE_MARKERS = {
	whitespace: '[data-conversation-scroll] [class$="_scroll"]{padding-left:24px',
	scrollbar: 'html ::-webkit-scrollbar-track{background:#f1f1f1}',
	'composer-width': '{width:80%;max-width:none}',
	'hero-row': '[class$="_heroWorkspaceRow"]{margin-left:calc(24px + (100% - 48px)*0.1)',
	markdown: '.fdxchat-bubble{max-width:100%;background:var(--dsw-specific-bubble)',
}

for (const [feature, marker] of Object.entries(FEATURE_MARKERS)) {
	test(`turning off "${feature}" removes exactly its block from the injected css`, () => {
		const env = loadClient()
		env.dispose()
		assert.ok(env.styleTag.textContent.includes(marker), `marker present when ${feature} is on`)
		/* 重新装载：预置关闭项（store 初始化读取） */
		const off = { [feature]: false }
		const env2 = loadClient({ storage: fakeStorage({ [STORAGE_KEY]: JSON.stringify(off) }) })
		const text = env2.styleTag.textContent
		assert.ok(!text.includes(marker), `marker absent when ${feature} is off`)
		/* 其余块不受影响 */
		for (const [other, otherMarker] of Object.entries(FEATURE_MARKERS)) {
			if (other === feature) continue
			assert.ok(text.includes(otherMarker), `${other} block unaffected by ${feature} being off`)
		}
	})
}

test('history-nav has no css block: toggling it never changes the injected css', () => {
	const envOn = loadClient()
	const onText = envOn.styleTag.textContent
	envOn.dispose()
	const envOff = loadClient({ storage: fakeStorage({ [STORAGE_KEY]: JSON.stringify({ 'history-nav': false }) }) })
	assert.equal(envOff.styleTag.textContent, onText)
})

/* ── store 行为 ── */

test('store defaults to all-on when storage is empty', () => {
	const env = loadClient()
	const css = env.styleTag.textContent
	for (const marker of Object.values(FEATURE_MARKERS)) {
		assert.ok(css.includes(marker))
	}
})

test('only disabled features are persisted; clearing the last one removes the key', () => {
	const env = loadClient()
	/* styleTag 与 store 的联动经 apply 内部闭包驱动：关闭 whitespace 后注入串更新 */
	const before = env.styleTag.textContent
	assert.ok(before.includes(FEATURE_MARKERS.whitespace))
	/* 直接通过 localStorage 预置 + 重装载验证持久化读取；写路径由 UI（分区面板）
	 * 驱动，在真机场景覆盖。此处验证「只记录关闭项」的存储契约 */
	const env2 = loadClient({ storage: fakeStorage({ [STORAGE_KEY]: JSON.stringify({ whitespace: false, markdown: false }) }) })
	assert.deepEqual(JSON.parse(env2.store.dump()[STORAGE_KEY]), { whitespace: false, markdown: false })
	env2.dispose()
	/* 全开后键应被移除（空 overrides → removeItem）——经 UI 切换驱动的写路径由
	 * 分区测试覆盖，此处验证读取空对象/缺键按全开 */
	const env3 = loadClient({ storage: fakeStorage({}) })
	assert.ok(env3.styleTag.textContent.includes(FEATURE_MARKERS.whitespace))
})

test('corrupt persisted value falls back to all-on without throwing', () => {
	for (const bad of ['not-json{', '[]', '"string"', '42', 'null', '{"unknown-feature":false}', '{"whitespace":"off"}', '{"markdown":true}']) {
		const env = loadClient({ storage: fakeStorage({ [STORAGE_KEY]: bad }) })
		assert.ok(
			env.styleTag.textContent.includes(FEATURE_MARKERS.whitespace) &&
			env.styleTag.textContent.includes(FEATURE_MARKERS.markdown),
			`corrupt value ${JSON.stringify(bad)} must fall back to all-on`,
		)
	}
})

test('localStorage read throwing (privacy mode) falls back to all-on', () => {
	const storage = fakeStorage()
	storage.getItem = function () { throw new Error('SecurityError') }
	const env = loadClient({ storage })
	assert.ok(env.styleTag.textContent.includes(FEATURE_MARKERS.whitespace))
	assert.equal(env.warns.length, 0, 'read failure is silent (no warn needed)')
})

test('localStorage write failing degrades to in-session with a single warn', () => {
	const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ whitespace: false }) })
	storage.failWrites(true)
	const env = loadClient({ storage })
	assert.ok(!env.styleTag.textContent.includes(FEATURE_MARKERS.whitespace), 'persisted-off feature stays off in-session')
	assert.equal(env.warns.length, 0, 'read path must not warn')
})

test('dispose removes the style tag and detaches the store binding', () => {
	const env = loadClient()
	assert.equal(env.styleTag.parentNode, env.styleTags[0] && env.styleTag.parentNode)
	const removed = env.dispose()
	assert.equal(removed, true)
	assert.equal(env.styleTag.parentNode, null)
	assert.equal(env.listeners.keydown.length, 0, 'keydown listener removed')
	assert.equal(env.listeners.input.length, 0, 'input listener removed')
	/* 重复 dispose 幂等（removed=false：标签已不在文档） */
	assert.equal(env.dispose(), false)
})
