/**
 * fenix-dsh-clipboard-fallback — Host 半。
 *
 * 本插件全部逻辑位于 client.js(浏览器侧 navigator.clipboard.writeText 降级)。
 * Host 半保持空 apply:loader 条目按包名装载时需要一个可加载的 cordis 插件,
 * 先例 fenix-dsh-brand-fenix/index.js、dsh-plugin-loopback-trust/index.js。
 */
export function apply() {}
