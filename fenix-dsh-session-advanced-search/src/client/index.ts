/**
 * fenix-dsh-session-advanced-search client 半装配（独立页形态）。
 *
 * 用户指令（m00937）「转向独立定制的高级搜索页面，不要再会话界面上修改元素」
 * 后的最小形态：会话界面唯一触碰点 = 官方搜索框旁的「高级搜索」入口按钮
 * （DOM 缝注入，官方 IconSearchOutlineMedium 几何）；点击整页跳转独立高级
 * 搜索页 PAGE_PATH（host 半 exact 路由直出）。搜索 UI 全部在独立页——无
 * 覆盖层、无 React 挂载、无服务依赖、无 composer 触碰；独立页「返回会话」
 * 可回 '/'，浏览器后退同样返回。
 *
 * 模块体经 `window.__ModuleLoader__.load({ id, factory })` 注册（tsdown
 * banner/footer 包装），dsh plugin-manager 消费 `inject` 服务键 + `apply(ctx)`
 * 停止函数。`inject` 为空数组：本形态不需要任何 client 服务。
 * apply 在无 document 环境（异常宿主/node 直载）自守跳过不抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import { PAGE_PATH } from '../shared/protocol.js'
import { injectSearchButton } from './searchButton.js'
import type { SearchButtonHandle } from './searchButton.js'

/** 本插件消费的 client 服务键：独立页形态零依赖。 */
export const inject: readonly string[] = []

/** client 侧日志门面（消息自带插件前缀）。 */
const log = {
  warn: (message: string) => console.warn(message),
  debug: (message: string) => console.debug(message),
}

/** 装配选项（navigateTo 仅供测试注入导航探针；缺省整页跳转独立页）。 */
export interface ClientPluginOptions {
  /** 页面导航动作（测试桩；缺省 window.location.assign）。 */
  readonly navigateTo?: (path: string) => void
}

/**
 * client 插件装配体：注入入口按钮，点击跳转独立高级搜索页。
 * @returns 停止函数（按钮 observer 断开 + 按钮移除）。
 */
export function apply(ctx: Context, options?: ClientPluginOptions): () => void {
  void ctx
  if (typeof document === 'undefined') {
    log.warn('fenix-dsh-session-advanced-search: 无 document 环境，client 半装配跳过')
    return () => {}
  }
  const navigateTo = options?.navigateTo ?? ((path: string) => window.location.assign(path))

  const button: SearchButtonHandle = injectSearchButton({
    document: window.document,
    log,
    onClick: () => {
      log.debug(`fenix-dsh-session-advanced-search: 跳转独立高级搜索页 ${PAGE_PATH}`)
      navigateTo(PAGE_PATH)
    },
  })

  return () => {
    button.dispose()
  }
}
