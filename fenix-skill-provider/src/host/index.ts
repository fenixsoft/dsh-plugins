/**
 * fenix-skill-provider Host 半（占位入口，后续任务装配 provider 与 watch）。
 *
 * 插件形态：默认导出 cordis 插件类（对齐 fenix-dsh-dashboard-bridge / cc-import
 * 先例），loader 条目按包名装载，config 键 `sourceDir` / `pattern` 可省略。
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** 本插件注册为 cordis 服务的名字（诊断/日志定位用）。 */
export const SERVICE_NAME = 'fenix-skill-provider'

/** Host 插件占位：装载即挂起，后续任务（4.1）在此注册 skill provider。 */
export default class FenixSkillProvider extends Service {
  constructor(ctx: Context) {
    super(ctx, SERVICE_NAME)
  }
}
