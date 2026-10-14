/**
 * Client 半：iframe 面板与侧栏图标组件（design D3/D4）。
 *
 * - `DashboardPanel`：主面板内嵌 iframe——src 经 buildPanelSrc 拼装（hash 深链
 *   直达），铺满面板、无边框，并按 layout 契约预留顶部 clearance
 *   （`--dsh-frame-leading-clearance`，macOS 窗口控件带占位，缺省 0）；
 * - `fixedIconComponent`：5 个固定条目的线性图标组件（svg stroke 线性风格），
 *   props 对齐 ui-sidebar 的 SidebarPanelIconOwnerProps（size/active）；
 * - `projectBadgeComponent`：项目条目的首字母圆形徽标组件（底色由项目名哈希
 *   稳定生成，同色系区分）。
 *
 * 组件均为无 hook 的纯函数组件（服务端/测试环境可直接求值元素树）。
 */
import type { ReactElement } from 'react'

/** ui-sidebar 传给图标组件的 owner props（SidebarPanelIconOwnerProps 子集）。 */
export interface PanelIconProps {
  /** 请求的正方形边长（px；宽列 16 / 收起轨 18）。 */
  readonly size?: number
  /** 本面板是否处于选中态。 */
  readonly active?: boolean
}

/** 5 个固定条目 id（与深链一一对应，见 client/index.ts FIXED_ENTRIES）。 */
export type FixedEntryId =
  | 'fenix-overview'
  | 'fenix-projects'
  | 'fenix-settings'
  | 'fenix-activities'
  | 'fenix-help'

/** 线性图标 path 数据（24×24 viewBox，stroke 线性风格）。 */
const FIXED_GLYPHS: Record<FixedEntryId, readonly string[]> = {
  'fenix-overview': ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  'fenix-projects': [
    'M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  'fenix-settings': [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M12 2v3',
    'M12 19v3',
    'M2 12h3',
    'M19 12h3',
    'M4.9 4.9l2.1 2.1',
    'M17 17l2.1 2.1',
    'M19.1 4.9L17 7',
    'M7 17l-2.1 2.1',
  ],
  'fenix-activities': ['M3 12h4l2-7 4 14 2-7h6'],
  'fenix-help': [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4',
    'M12 17.5h.01',
  ],
}

/** 固定条目线性图标组件工厂（每个条目 id 一枚）。 */
export function fixedIconComponent(id: FixedEntryId): (props: PanelIconProps) => ReactElement {
  const glyph = FIXED_GLYPHS[id]
  return function FixedIcon({ size = 18 }: PanelIconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {glyph.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    )
  }
}

/** 项目名 → 稳定色相（简单多项式哈希，跨会话一致）。 */
function nameHue(name: string): number {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360
  }
  return hash
}

/** 项目条目首字母圆形徽标组件工厂（label=项目名，图标=首字母徽标）。 */
export function projectBadgeComponent(name: string): (props: PanelIconProps) => ReactElement {
  const letter = (Array.from(name.trim())[0] ?? '?').toUpperCase()
  const hue = nameHue(name)
  return function ProjectBadge({ size = 18 }: PanelIconProps) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `hsl(${hue} 42% 46%)`,
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.max(9, Math.round(size * 0.52)),
          fontWeight: 600,
          lineHeight: 1,
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {letter}
      </span>
    )
  }
}

/** iframe 面板组件：src 由调用方经 buildPanelSrc 拼装后传入。 */
export function DashboardPanel({ src }: { readonly src: string }): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        // layout 契约：主面板内容触顶时按窗口控件带让位（缺省 0）。
        paddingTop: 'var(--dsh-frame-leading-clearance, 0px)',
      }}
    >
      <iframe
        src={src}
        title="Fenix Dashboard"
        style={{
          width: '100%',
          height: '100%',
          flex: 1,
          minHeight: 0,
          border: 'none',
          display: 'block',
          backgroundColor: '#fff',
        }}
      />
    </div>
  )
}
