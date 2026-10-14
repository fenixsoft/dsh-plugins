/**
 * fenix-dsh-dashboard-bridge Host 半：向 dsh web 进程内注册 `/fenix-dashboard/`
 * prefix 路由，把前缀内请求剥离前缀后流式反代到本机 Fenix Dashboard。
 *
 * - 插件形态：默认导出 cordis 插件类（对齐 cc-import / dsh-host-webserver 的
 *   `WebServer as default` 先例），loader 条目按包名装载，config 键
 *   `upstream` / `prefix` 可省略（有代码默认值，见 shared/config.ts）。
 * - 路由注册：`static inject = ['webServer']` 声明对 `@deepseek-ai/dsh-host-webserver`
 *   WebServer 服务的依赖，构造（插件 apply）时经 `register({ kind: 'prefix', ... })`
 *   注册；插件卸载时经 register 返回的 disposer 注销（经 ctx.effect 挂接）。
 * - 无鉴权（用户定调 2026-10-14）：不校验 dsh 浏览器会话 cookie，dashboard 数据
 *   可达性完全等于 dsh web 网络可达性（design D2）。
 * - 上游不可达时由 proxy 层降级 502 提示页，不影响 dsh web 其余路由。
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { resolveBridgeConfig } from '../shared/config.js'
import type { BridgeConfigInput } from '../shared/config.js'
import { createDashboardProxy } from './proxy.js'

/** 本插件注册为 cordis 服务的名字（诊断/日志定位用）。 */
export const SERVICE_NAME = 'fenix-dashboard-bridge'

/**
 * Host 插件：装载即注册 prefix 反代路由；loader 行 config 覆盖 upstream/prefix，
 * 缺省用 `http://127.0.0.1:8787` + `/fenix-dashboard/`。
 */
export default class FenixDashboardBridge extends Service {
  /** 依赖 WebServer 服务就绪后再装载。 */
  static readonly inject = ['webServer']

  constructor(ctx: Context, config?: BridgeConfigInput | null) {
    super(ctx, SERVICE_NAME)
    const resolved = resolveBridgeConfig(config)
    const log = (message: string): void => {
      // 错误日志是远程侧只见 502 页时定位 upstream 未启动/配置错误的唯一抓手。
      try {
        this.ctx.logger.error('%s', message)
      } catch {
        console.error(message)
      }
    }
    const unregister = this.ctx.webServer.register({
      kind: 'prefix',
      path: resolved.routePath,
      handler: createDashboardProxy({
        upstream: resolved.upstream,
        prefix: resolved.prefix,
        logger: log,
      }),
    })
    // 插件卸载（loader 条目移除 / fiber 卸载）时经 disposer 注销路由。
    this.ctx.effect(() => unregister, 'fenix-dashboard-bridge: prefix route')
  }
}
