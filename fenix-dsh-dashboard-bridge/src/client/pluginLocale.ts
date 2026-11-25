/**
 * 插件端 UI 文案语言模块（i18n 宿主跟随轮）：fenix 系插件注入 dsh web 的
 * 自绘控件（工作区行 tooltip / 文件右键菜单等，纯 DOM 非组件）跟随 DSH 语言
 * 设置。宿主档经 installLocaleFollow 装配链喂入（初始快照 + locale/change
 * 事件实时刷新），无宿主语言服务（旧版 dsh web）时降级 zh——与既有中文
 * 文案现状逐字节一致，行为零回归。
 *
 * 词典形态：本插件 client 可见文案量小（~30 条），不引运行时 i18n 框架，
 * 键值双列就近内嵌；键名 <文件>.<语义>（与 fenixd 目录域约定同构）。宿主
 * 档值域 'zh'|'en'（dsh-client-locale 快照原值），映射/白名单收在
 * normalizeLocaleScheme（'zh'→'zh-CN'、'en'→'en-US'，宽面防御）。
 */
import { normalizeLocaleScheme } from '../shared/config.js'
import type { LocaleScheme } from '../shared/config.js'

/* ==================== 宿主档缓存（installLocaleFollow 喂入） ==================== */

let cachedLocale: LocaleScheme | undefined = undefined

/** localeFollow 装配链调用：初始快照与 locale/change 事件各喂一次。白名单
 * 外值忽略（缓存 last-known-good；undefined=未喂入，t() 降级 zh）。 */
export function setPluginLocale(locale: unknown): void {
  const loc = normalizeLocaleScheme(locale)
  if (loc !== undefined) cachedLocale = loc
}

/** 当前文案档（undefined = 宿主语言能力缺席，降级 zh）。测试注入用。 */
export function pluginLocale(): LocaleScheme | undefined {
  return cachedLocale
}

/** 测试/重装复位。 */
export function resetPluginLocale(): void {
  cachedLocale = undefined
}

/** 文案档归一：undefined → zh（降级=现状）。 */
function dictLocale(): LocaleScheme {
  return cachedLocale ?? 'zh-CN'
}

/* ==================== 词典（键：<文件>.<语义>，zh/en 双列） ==================== */

/** 文案键值对（zh 为原文逐字，en 对应译）。 */
type Entry = readonly [zh: string, en: string]

/** wsTooltip（工作区行悬停 tooltip）。 */
const WS_TOOLTIP: Record<string, Entry> = {
  // SPEC 状态标签（zh 与 fenixd STATUS_META 显示名逐键一致）
  'wsTooltip.status.drafted': ['草稿', 'Drafted'],
  'wsTooltip.status.ready': ['就绪', 'Ready'],
  'wsTooltip.status.reviewing': ['评审中', 'Reviewing'],
  'wsTooltip.status.implementing': ['实现中', 'Implementing'],
  'wsTooltip.status.implemented': ['已实现', 'Implemented'],
  'wsTooltip.status.testing': ['验证中', 'Testing'],
  'wsTooltip.status.verified': ['已验证', 'Verified'],
  'wsTooltip.status.bugFound': ['有Bug', 'Bug found'],
  'wsTooltip.status.blocked': ['阻塞', 'Blocked'],
  'wsTooltip.status.done': ['完成', 'Done'],
  'wsTooltip.status.pushed': ['已推送', 'Pushed'],
  'wsTooltip.status.repairing': ['修复中', 'Repairing'],
  'wsTooltip.status.queued': ['排队中', 'Queued'],
  // 运行状态（daemon 生命周期徽标）
  'wsTooltip.running.unmanaged': ['运行中·未托管', 'Running · unmanaged'],
  'wsTooltip.running': ['运行中', 'Running'],
  'wsTooltip.notRunning': ['未运行', 'Not running'],
  'wsTooltip.autoDiscover': ['自动发现', 'Auto-discovered'],
  'wsTooltip.noDesc': ['暂无简介', 'No description'],
  // 统计行三段拼接（DOM 分段 append：数字段 tabular-nums 加粗）：
  // zh `任务 ${n} 个 · 活跃 Agent ${m} 个` / en `Tasks ${n} · active agents ${m}`
  'wsTooltip.stats.head': ['任务 ', 'Tasks '],
  'wsTooltip.stats.mid': [' 个 · 活跃 Agent ', ' · active agents '],
  'wsTooltip.stats.tail': [' 个', ''],
}

/** locate（文件右键「定位」菜单项）。 */
const LOCATE: Record<string, Entry> = {
  // 2026-11-11 用户需求原文形态：`在 <项目名> 项目定位`（en 侧经 template 组装）
  'locate.label.prefix': ['在 ', 'Locate in '],
  'locate.label.suffix': [' 项目定位', ' project'],
  'locate.failureLabel': ['定位失败，请重试', 'Locate failed, please retry'],
}

const DICTS: Array<Record<string, Entry>> = [WS_TOOLTIP, LOCATE]

/**
 * 取文案（渲染/求值期调用，返回当前档串）。键不存在回退 zh 列（防键位
 * 拼写漂移静默空串），仍不存在返回键名本身（开发期可见）。
 */
export function pluginT(key: string): string {
  const loc = dictLocale()
  const index = loc === 'en-US' ? 1 : 0
  for (const dict of DICTS) {
    const entry = dict[key]
    if (entry !== undefined) return entry[index] ?? entry[0]!
  }
  return key
}

/**
 * 定位菜单项 label（`在 <项目名> 项目定位` / `Locate in <name> project`）：
 * 项目名插值的复合串单独出口（projectT 语义，键名收敛防散拼）。
 */
export function locateMenuLabel(projectName: string): string {
  if (dictLocale() === 'en-US') return `Locate in ${projectName} project`
  return `在 ${projectName} 项目定位`
}

