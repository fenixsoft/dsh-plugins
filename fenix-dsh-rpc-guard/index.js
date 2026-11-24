/**
 * fenix-dsh-rpc-guard — Host 半（最小占位）。
 *
 * 本插件只在浏览器端生效（client.js 给 window.fetch 加 RPC 超时/重试护栏），
 * 不注册任何宿主扩展点、不触碰 ctx。dsh 的宿主装载器要求入口模块导出
 * apply(ctx)（形态对齐 fenix-dsh-auth/index.js:531），故提供此最小实现。
 */

export function apply(ctx) {
	// client-only 插件：宿主半无操作。ctx 不持有任何资源，无需 dispose。
	return function dispose() {
		return true
	}
}

export default apply
