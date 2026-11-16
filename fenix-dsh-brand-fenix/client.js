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
 *      2026-11-16：桌面版宿主 24px 高 .brand 容器 overflow:hidden 裁掉 38px
 *      画布下缘（副标字形底部被切，用户截图报告）。画布收窄 38→24 贴合墨迹：
 *      基线 17/30.5 → 9.5/23.0（基线距 13.5 不变，视觉空隙仍 7.2px），字号/
 *      字距/textLength 全部不动，墨迹跨度 0.75..23.0，居中于 24px 裁剪窗内
 *      上下各留 ≈1px 余量，Web 与桌面一致完整显示。
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

			/* dashboard 顶栏同款 Fenix 环结（logo-64.png 内联，64×64 RGBA）。
			 * 2026-11-17 剥离 Photoshop 导出残留的 tEXt(Software)/iTXt(XML:com.adobe.xmp)
			 * 附属块，仅保留 IHDR/IDAT/IEND；IDAT 字节与像素扫描线逐字节不变。 */
			var FENIX_LOGO_URI = 'data:image/png;base64,' +
				'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'

			/* 环结图标：方形位图，随宿主槽位给定的边长。sidebar.brand.mark 与
			 * conversation.hero.brand.mark 两槽位共用本组件（实现完全一致，仅槽位
			 * 语义不同：sidebar 顶栏图标 24px；hero 空会话品牌标 34px，不透传宿主
			 * className——官方 fish 类挂 hover 游动动画，不适用位图） */
			var FenixMark = function (props) {
				/* 缺省回退 24px：对齐 sidebar.brand.mark 槽位契约尺寸（hero 槽位
				 * 34px 仍由宿主透传），防止宿主未传 size 时按 64px 位图自然尺寸渲染撑破槽位 */
				var size = props.size || 24
				return react.createElement('img', {
					src: FENIX_LOGO_URI,
					width: size,
					height: size,
					alt: '',
					style: { display: 'block' },
					draggable: false,
				})
			}

			/* 名称：自绘 SVG lockup（概念稿 A·House Caps 紧凑版，2026-11-07 用户选定）。
			 * 主行 FENIX HARNESS：12.5px/600/字距 1px 大写，HARNESS 500 灰；
			 * 副标 THE AI-NATIVE SDLC（2026-11-10 改文）：9px/500/字距 2.2px，基线 y=23（视觉空隙 ≈7.2px，
			 * 用户校准值；2026-11-16 画布 38→24 收窄，基线 17/30.5 → 9.5/23，见文件头）。两行 textLength 锁同宽 117.3px（lengthAdjust=spacing 均
			 * 分字间空隙，2026-11-07 用户要求副标与主行等宽；主行实测自然宽即
			 * 117.3px，锁定后字体回退时两行仍等宽）。颜色走 dsh 别名变量明暗自适应；
			 * Montserrat 为页面全局 @font-face；SVG 定宽 124px、定高 24px 贴合宿主
			 * 24px 品牌容器（overflow:hidden）+ overflow visible 兜字体回退时的轻微超宽。 */
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
							height: 24,
							viewBox: '0 0 124 24',
							role: 'img',
							'aria-label': 'Fenix Harness — The AI-Native SDLC',
							style: { display: 'block', overflow: 'visible' },
						},
						react.createElement(
							'text',
							{
								x: 0,
								y: 9.5,
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
								y: 23,
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
					var stage = function (name, err) {
						var detail = err && err.stack ? err.stack : String(err)
						console.warn('[fenix-dsh-brand-fenix] activation stage "' + name + '" rejected: ' + detail)
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
						/* 返回值语义对齐兄弟插件口径「清理是否实际执行」：本插件无 style 标签/监听器等本地资源需清理（槽位注册由宿主框架管理），恒返回 true */
						return true
					}
				},
			}
		},
	})
})()
