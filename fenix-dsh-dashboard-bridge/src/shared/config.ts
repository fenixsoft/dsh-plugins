/**
 * 桥接件共享配置：upstream / prefix 默认值、loader 行 config 覆盖入口、
 * iframe src 契约拼装（spec「iframe src 契约」Requirement 的实现单源）。
 *
 * 斜杠归一方向钉死（与 specs 契约 Scenario 示例一致）：
 * - URL 路径前缀（prefix）：保留尾斜杠形态（`/fenix-dashboard/`），iframe src
 *   以 `<prefix>?embed=1&...` 直拼出 `<prefix>/?embed=1&...`；
 * - `apiBase` / webserver 注册路径（routePath）：取同一 prefix 去尾斜杠形态
 *   （`/fenix-dashboard`），使上游以 `apiBase + '/api/...'` 直拼不产生双斜杠，
 *   且满足 WebServer「prefix 路由 path 无尾斜杠」的注册契约。
 */

/** 默认上游 dashboard 服务地址（fenixd 仓库 `bin/fenix_dashboard.py --serve`）。 */
export const DEFAULT_UPSTREAM = 'http://127.0.0.1:8787'

/** 默认 URL 路径前缀（尾斜杠形态）。 */
export const DEFAULT_PREFIX = '/fenix-dashboard/'

/** loader 行 config 覆盖入口的原始输入形状（两键均可省略，取代码默认值）。 */
export interface BridgeConfigInput {
  /** 上游 dashboard 服务 Origin（可含基路径）；默认 `http://127.0.0.1:8787`。 */
  readonly upstream?: string
  /** URL 路径前缀；默认 `/fenix-dashboard/`。 */
  readonly prefix?: string
}

/** 解析后的生效配置（各字段形态已归一，直接供 host/client 使用）。 */
export interface ResolvedBridgeConfig {
  /** 上游地址：无尾斜杠（直拼 `upstream + path` 不产生双斜杠）。 */
  readonly upstream: string
  /** URL 路径前缀：保留尾斜杠（`<prefix>?embed=1&...` 直拼出 `<prefix>/?...`）。 */
  readonly prefix: string
  /** WebServer prefix 路由注册路径：无尾斜杠（注册契约要求）。 */
  readonly routePath: string
  /** apiBase：同一 prefix 去尾斜杠（上游以 `apiBase + '/api/...'` 直拼）。 */
  readonly apiBase: string
}

/**
 * 归一 URL 路径前缀到尾斜杠形态：`fenix-dashboard` / `/fenix-dashboard` /
 * `/fenix-dashboard/`（含多重尾斜杠 `/fenix-dashboard//`）→ `/fenix-dashboard/`。
 * 空串抛错；缺前导斜杠自动补全、多余尾斜杠折叠为单个（与 normalizeUpstream
 * 口径一致），不抛错（loader 配置错误应在装载期显式失败，而非静默挂错路径）。
 */
export function normalizePrefix(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new Error('fenix-dsh-dashboard-bridge: prefix 不能为空')
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  // 先折叠全部尾斜杠再补单个：畸形 `/fenix-dashboard//` 归一后 routePath/apiBase
  // （下游 slice 去尾斜杠）仍无尾斜杠。仅斜杠输入（`///`）折叠为空后补单个
  // 尾斜杠得 `/`——prefix 契约钉死尾斜杠形态，下游 routePath 顺势为空串，
  // 仍满足「无尾斜杠」注册契约。
  const withoutTrailing = withLeading.replace(/\/+$/, '')
  return `${withoutTrailing}/`
}

/** 归一上游地址：校验为 http(s) URL 并去除尾斜杠。 */
export function normalizeUpstream(input: string): string {
  const trimmed = input.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`fenix-dsh-dashboard-bridge: upstream 不是合法 URL: ${input}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`fenix-dsh-dashboard-bridge: upstream 仅支持 http/https: ${input}`)
  }
  return trimmed.replace(/\/+$/, '')
}

/**
 * loader 行 config 覆盖入口：合并代码默认值并归一。
 * 两键均可省略（loader 行可不带 config）；非法输入（空 prefix / 非 http(s)
 * upstream）抛错，让装载期日志直接暴露配置错误。
 */
export function resolveBridgeConfig(input?: BridgeConfigInput | null): ResolvedBridgeConfig {
  const upstream = normalizeUpstream(input?.upstream?.trim() ? input.upstream : DEFAULT_UPSTREAM)
  const prefix = normalizePrefix(input?.prefix?.trim() ? input.prefix : DEFAULT_PREFIX)
  const routePath = prefix.slice(0, -1)
  return { upstream, prefix, routePath, apiBase: routePath }
}

/** 主题档白名单值域（buildPanelSrc 第三参与主题广播 theme 值共用；spec
 * bridge-theme-channel「初始主题参数注入」契约）。 */
export type ThemeScheme = 'dark' | 'light'

/**
 * 主题档白名单运行时映射：`'dark'`/`'light'` 原样返回，其余值（含
 * undefined/null/形状漂移值）返回 undefined（调用方按「无主题档」处理）。
 * dsh-client-ui-theme 类型声明本就收窄 `'light'|'dark'`，白名单作运行时
 * 漂移防御（design D3）；buildPanelSrc 与 themeFollow 广播共用单源。
 */
export function normalizeThemeScheme(value: unknown): ThemeScheme | undefined {
  return value === 'dark' || value === 'light' ? value : undefined
}

/** 语言档白名单值域（buildPanelSrc 第四参与语言广播 locale 值共用；i18n
 * 宿主跟随轮）。宿主 dsh-client-locale LocaleRuntime 快照 active 是 'zh'|'en'
 * （两键词典值域），本仓契约统一映射为 fenix 档 'zh-CN'|'en-US' 后广播/注入
 * ——fenixd 侧白名单与本地偏好档同值域，零映射负担。 */
export type LocaleScheme = 'zh-CN' | 'en-US'

/** 宿主语言快照值 → fenix 档：'zh'→'zh-CN'、'en'→'en-US'；'zh-CN'|'en-US'
 * 已是 fenix 档值原样通过（防御性宽面）；其余值（含 undefined/null/形状漂移
 * 值）返回 undefined（调用方按「无语言档」处理）。buildPanelSrc 与
 * localeFollow 广播共用单源。 */
export function normalizeLocaleScheme(value: unknown): LocaleScheme | undefined {
  if (value === 'zh') return 'zh-CN'
  if (value === 'en') return 'en-US'
  return value === 'zh-CN' || value === 'en-US' ? value : undefined
}

/**
 * iframe src 契约拼装：`<prefix>/?embed=1&apiBase=<apiBase>[&theme=<档>]#<hash-route>`。
 * - 参数位于 hash 之前，`location.search` 可读；深链在 hash 内不受影响；
 * - hashRoute 接受 `#/overview` / `/overview` 两种写法，统一归一为 `#/...`；
 * - theme 为附加可选参数（spec add-bridge-theme-channel）：白名单 `dark|light`
 *   命中时在 apiBase 之后、hash 之前拼 `&theme=<档>`；未提供/undefined/白名单
 *   外值一律不产生 theme 段——输出与既有契约逐字符一致（缺省路径零变化）；
 * - locale 为附加可选参数（i18n 宿主跟随轮）：normalizeLocaleScheme 命中
 *   时在 theme 段之后、hash 之前拼 `&locale=<档>`；未提供/白名单外不产生
 *   locale 段（同缺省路径零变化纪律）；
 * - prefix 为原始 URL 路径语法（需 path-safe），原样拼入不转义，
 *   默认前缀下产出与 specs Scenario 逐字符一致的
 *   `/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/projects`。
 */
export function buildPanelSrc(prefix: string, hashRoute: string, theme?: unknown, locale?: unknown): string {
  const base = normalizePrefix(prefix)
  const route = hashRoute.startsWith('#') ? hashRoute.slice(1) : hashRoute
  const hash = `#${route.startsWith('/') ? route : `/${route}`}`
  const scheme = normalizeThemeScheme(theme)
  const themeSegment = scheme === undefined ? '' : `&theme=${scheme}`
  const localeSegment = (() => {
    const loc = normalizeLocaleScheme(locale)
    return loc === undefined ? '' : `&locale=${loc}`
  })()
  return `${base}?embed=1&apiBase=${base.slice(0, -1)}${themeSegment}${localeSegment}${hash}`
}
