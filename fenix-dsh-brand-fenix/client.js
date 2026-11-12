/**
 * fenix-dsh-brand-fenix — dsh web 品牌替换（Fenix Harness）。
 *
 * 以 priority -10 遮蔽三处官方品牌槽位（dsh 0.2.0-rc.2 ui-slots 契约：single 槽
 * cell 内最低优先级者渲染，默认 0；组件崩溃经宿主 abdicate 机制自动退位回官方
 * 渲染器，升级失配时整体回落官方品牌）：
 *
 *   1. sidebar.brand.mark（size 24）——左上角图标：官方鲸鱼剪影 → Fenix 环结
 *      （取自 dashboard 顶栏 logo-64.png，data URI 内联，明暗主题同素材）。
 *   2. sidebar.brand.name（24px 高容器）——官方矢量 wordmark「deepseek harness」
 *      → 自绘 SVG lockup（2026-11-07 用户从 4 概念稿中选定 A·House Caps 紧凑版
 *      并指定文案 WEB DASHBOARD；2026-11-10 用户指令副标改文 THE AI-NATIVE
 *      SDLC）：主行「FENIX HARNESS」Montserrat 600/12.5px/
 *      字距 1px 大写（对齐 dsh 官方 boot 屏 wordmark 语言），HARNESS 用 500 权重
 *      灰字弱化；副标行「THE AI-NATIVE SDLC」Montserrat 500/9px/字距 2.2px，基线
 *      y=30.5（与主行视觉空隙 ≈7.2px，用户校准值）。实测主行宽 117.3px、副标
 *      115.5px，SVG 定宽 124px + overflow visible。颜色全部走 dsh 别名
 *      --dsw-alias-label-primary/secondary/tertiary（暗色自动翻转），字体为
 *      dsh-web-frontend 全局 @font-face Montserrat（300/400/500，600 为合成，
 *      与官方 boot 屏同做法）。
 *   3. conversation.hero.brand.mark（size 34）——新建会话界面的空会话品牌标：
 *      官方动画鱼 fallback → 同款 Fenix 环结。不透传宿主 className（fish 类在
 *      hover 时对 mark 施加游动动画，不适用位图）。
 *
 * 宿主注入面：@deepseek-ai/dsh-client-ui-sidebar（sidebar 两槽）+
 * @deepseek-ai/dsh-client-ui-conversation（hero 槽）；模块装载器保证插件晚于
 * inject 宿主到达，ctx.slots.inject 的注册回调由宿主框架管理声明时序。
 */
(function () {
	'use strict'

	window.__ModuleLoader__.load({
		id: 'fenix-dsh-brand-fenix',
		factory(require) {
			var react = require('react')

			/* dashboard 顶栏同款 Fenix 环结（logo-64.png 内联，64×64 RGBA） */
			var FENIX_LOGO_URI = 'data:image/png;base64,' +
				'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJp' +
			'VFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlk' +
			'Ij8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2' +
			'LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9y' +
			'Zy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRw' +
			'Oi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1s' +
			'bnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0i' +
			'QWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6Q0JBM0M0QzFBNkFFMTFGMTgz' +
			'QUY4QTY4RUZFMDVCQUIiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6Q0JBM0M0QzJBNkFFMTFGMTgzQUY4QTY4RUZFMDVCQUIi' +
			'PiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDpDQkEzQzRCRkE2QUUxMUYxODNBRjhBNjhFRkUw' +
			'NUJBQiIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDpDQkEzQzRDMEE2QUUxMUYxODNBRjhBNjhFRkUwNUJBQiIvPiA8L3JkZjpE' +
			'ZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PrVGrRkAABvYSURBVHja7HsJkF3l' +
			'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' +
			'4qn5kWXBHaJP4uLUkPoyEn0Vs/22mtQclkL9o4YV34e6pjTzMmZP2nhuzwzCkoaB0Qxzm8xgSW31iCDsNea7qHSC/EIRDVkKnX1P' +
			'HMexQyeQyiZI6GL26CCxRvuGbSuBsvVfNh6+DECTZaKh+geoJBuuya5NDC3CBmRGQ+34ReQfOYzmuVlApEQs/FJJZEs6fYkALPC9' +
			'xWIidWjmhLxcv8lLhVhRXyynr2G4OD3iM2wlqJXM/fJi8ivVvISlCR9TR5s4/Pgs8hNFDA6nEOmk2mMVcZ3WZodQkGIcqVCUCcHD' +
			'Jgm9vcL4k9i35wgymQSEoqhTfWaG1Eeya41xi6VeYgkVx6tOhd2wsmLJ/gGlbO3y6D1RCFyGvUokzWIVeYZV9Hweme0jkLtZhyq1' +
			'YBS1tFzC5NIcqvMLiITDes+phX1nkqEvNkLS70Q6wsxN7WXebzVVRlQJRGVpxtmyNG88bCvG2oLWCPb/xY7O8kIJp09cRE8yiq7h' +
			'OJRYW4w5rR0kSfNb3MQ/IUZZdzfw5GM/xu5/eQbdJHDRJYqS2qQkTw1kvq6ICZRtrcrAl6QwPauwnjvz1hPmpcVdPslE3EsgSpJH' +
			'8SLT64qtokipW50tIHfDRsTeMkiNSlKuNnEeK/jevmPYtnkd+rIp9F4ofOJswfxIvifxycHb3a91DiexOGfArJMT2CVemiyPzJ+3' +
			'/9qcNd4XM8oErhlslPr0sM1efmmB0rlhYXjbEKKs5WqIqem21KikeMFUymc6iP2Fni4JT+3+Mf75e09S63fA0PVg8lSv2KxGmEgO' +
			'aN8psk8Joue1NkaUFHU6e3h3ML27eWLxz5WGG3g/IHxPCtjZJ/R6OgkxUZn+0Y+RuVRC1wdvYa6HWJl0PHbqHMbZ/W3oZf1PJaCW' +
			'1eT40eWvXniu+NlLt29+dG1fvLwl15HUDOXGlOxf1234sNbqqJkKLNOhOLJhNxwUKXFLiyVsWd+PvvUZRNKMFhKoGKzKwaheahOf' +
			'j/7+MJ5+/BS++9Bj6MjReMpe26LSpNNKNHr0LfEvKwz52rL5qvz7UjdYKkGqsqU0cJCd4LheMEetqLjxQA56oUCU+WIDlAsQOzAU' +
			'JMWzc+h8+HnkjBCSyKHkNfHM0jmcWCogHo4jEo2x709gZqI5/OWTs3dvYCu2dWMnNm3OYmRjB67fkGDXrSK/oiG/zOgqctELTdZ8' +
			'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' +
			'AAAASUVORK5CYII='

			/* 环结图标：方形位图，随宿主槽位给定的边长。sidebar.brand.mark 与
			 * conversation.hero.brand.mark 两槽位共用本组件（实现完全一致，仅槽位
			 * 语义不同：sidebar 顶栏图标 24px；hero 空会话品牌标 34px，不透传宿主
			 * className——官方 fish 类挂 hover 游动动画，不适用位图） */
			var FenixMark = function (props) {
				return react.createElement('img', {
					src: FENIX_LOGO_URI,
					width: props.size,
					height: props.size,
					alt: '',
					style: { display: 'block' },
					draggable: false,
				})
			}

			/* 名称：自绘 SVG lockup（概念稿 A·House Caps 紧凑版，2026-11-07 用户选定）。
			 * 主行 FENIX HARNESS：12.5px/600/字距 1px 大写，HARNESS 500 灰；
			 * 副标 THE AI-NATIVE SDLC（2026-11-10 改文）：9px/500/字距 2.2px，基线 y=30.5（视觉空隙 ≈7.2px，
			 * 用户校准值）。两行 textLength 锁同宽 117.3px（lengthAdjust=spacing 均
			 * 分字间空隙，2026-11-07 用户要求副标与主行等宽；主行实测自然宽即
			 * 117.3px，锁定后字体回退时两行仍等宽）。颜色走 dsh 别名变量明暗自适应；
			 * Montserrat 为页面全局 @font-face；SVG 定宽 124px + overflow visible
			 * 兜字体回退时的轻微超宽。 */
			var FenixName = function () {
				return react.createElement(
					'span',
					{
						className: 'fdxbrand-name',
						style: { display: 'inline-flex', alignItems: 'center' },
					},
					react.createElement(
						'svg',
						{
							width: 124,
							height: 38,
							viewBox: '0 0 124 38',
							role: 'img',
							'aria-label': 'Fenix Harness — The AI-Native SDLC',
							style: { display: 'block', overflow: 'visible' },
						},
						react.createElement(
							'text',
							{
								x: 0,
								y: 17,
								textLength: 117.3,
								lengthAdjust: 'spacing',
								fontFamily: 'Montserrat, var(--dsw-font-family, sans-serif)',
								fontSize: '12.5px',
								fontWeight: 600,
								letterSpacing: '1px',
								fill: 'var(--dsw-alias-label-primary, #0f1115)',
							},
							'FENIX ',
							react.createElement(
								'tspan',
								{
									fontWeight: 500,
									fill: 'var(--dsw-alias-label-secondary, #61666b)',
								},
								'HARNESS',
							),
						),
						react.createElement(
							'text',
							{
								x: 0,
								y: 30.5,
								textLength: 117.3,
								lengthAdjust: 'spacing',
								fontFamily: 'Montserrat, var(--dsw-font-family, sans-serif)',
								fontSize: '9px',
								fontWeight: 500,
								letterSpacing: '2.2px',
								fill: 'var(--dsw-alias-label-tertiary, #81858c)',
							},
							'THE AI-NATIVE SDLC',
						),
					),
				)
			}

			return {
				inject: ['slots'],
				apply(ctx) {
					var failures = []
					var stage = function (name, err) {
						var detail = err && err.stack ? err.stack : String(err)
						console.warn('[fenix-dsh-brand-fenix] activation stage "' + name + '" rejected: ' + detail)
						failures.push(name)
					}
					var occupy = function (slot, component) {
						return function () {
							return ctx.slots.register({ name: slot, priority: -10 }, component)
						}
					}
					var attempts = [
						['sidebar.brand.mark', occupy('sidebar.brand.mark', FenixMark)],
						['sidebar.brand.name', occupy('sidebar.brand.name', FenixName)],
						['conversation.hero.brand.mark', occupy('conversation.hero.brand.mark', FenixMark)],
					]
					for (var i = 0; i < attempts.length; i++) {
						try {
							ctx.slots.inject(attempts[i][0], attempts[i][1])
						} catch (err) {
							stage(attempts[i][0], err)
						}
					}

					return function dispose() {
						return failures.length === 0
					}
				},
			}
		},
	})
})()
