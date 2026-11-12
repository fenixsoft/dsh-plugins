/**
 * dsh client UI 原语构建期类型缝（build-time type seam）。
 *
 * @deepseek-ai/dsh-client-ui-primitives 未以匹配版本发布到 npm（同
 * dsh-runtime.d.ts 缘由），此处按 0.2.2-rc.1 发行包 lib 的 props 面钉死最小
 * 被消费契约（dashboard-bridge 先例同款：Tooltip 与官方原生工作区 rowActions
 * 逐键同形）。独立全局声明文件（无 import/export 顶层）保证环境模块声明
 * 生效——模块形态 d.ts 内的带 import declare module 块会被当作模块增强，
 * 对未安装包不生效。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType, ReactNode } from 'react'

  /** Tooltip 原语（悬浮提示）。 */
  export interface TooltipProps {
    /** 悬浮提示文案（原样使用，不做词典查找）。 */
    readonly label: ReactNode
    /** 弹出方位/对齐。 */
    readonly side?: 'top' | 'bottom' | 'left' | 'right'
    readonly align?: 'start' | 'center' | 'end'
    /** 悬浮延时（毫秒）。 */
    readonly delayMs?: number
    readonly children?: ReactNode
  }
  export const Tooltip: ComponentType<TooltipProps>
}
