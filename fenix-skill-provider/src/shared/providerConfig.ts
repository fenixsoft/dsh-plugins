/**
 * fenix-skill-provider 共享配置：`sourceDir` / `pattern` 默认值、loader 行
 * config 覆盖入口、pattern → 全串锚定正则编译（spec「config 可覆盖来源与模式」
 * Requirement 的实现单源，scanner 与 host 装配共用）。
 *
 * - `sourceDir`：默认 `~/.claude/skills`；接受绝对路径与 `~` 前缀路径，统一
 *   展开为绝对路径（`~` 以 `os.homedir()` 拼接）。
 * - `pattern`：默认 `fenix-*`；仅支持段内 `*` 通配（`*` → 不含 `/` 的任意序列，
 *   全串锚定）。含其它 glob 元字符（`?` `[` `]` `{` `}` `\`）或跨段 `/` 时抛
 *   含键名与非法原因的可读错误——loader 配置错误应在装载期显式失败（拒绝装载），
 *   而非静默按字面量处理。
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** 默认 skill 来源目录（Claude Code 用户级 skill 目录）。 */
export const DEFAULT_SOURCE_DIR = '~/.claude/skills'

/** 默认来源匹配模式（段内 `*` 通配）。 */
export const DEFAULT_PATTERN = 'fenix-*'

/** `fs.watch` 事件 → `control.invalidate()` 的去抖窗口（design D3）。 */
export const WATCH_DEBOUNCE_MS = 300

/** loader 行 config 覆盖入口的原始输入形状（两键均可省略，取代码默认值）。 */
export interface ProviderConfigInput {
  /** skill 来源目录；默认 `~/.claude/skills`，支持 `~` 前缀。 */
  readonly sourceDir?: string
  /** 目录名匹配模式；默认 `fenix-*`，仅支持段内 `*` 通配。 */
  readonly pattern?: string
}

/** 解析后的生效配置（形态已归一，直接供 host 装配与 scanner 使用）。 */
export interface ResolvedProviderConfig {
  /** 来源目录绝对路径（`~` 已展开）。 */
  readonly sourceDir: string
  /** 原始 pattern 字符串（日志/诊断用）。 */
  readonly pattern: string
  /** 编译后的全串锚定正则（`*` → `[^/]*`），对目录名做 `test` 匹配。 */
  readonly patternRe: RegExp
}

/** glob 元字符黑名单：`*` 以外的全部 glob 语法面（design D6 显式判非法）。 */
const ILLEGAL_GLOB_CHARS = new Set(['?', '[', ']', '{', '}', '\\'])

/**
 * 展开来源目录为绝对路径：`~` / `~xxx` 前缀按 `os.homedir()` 拼接；绝对路径
 * 原样归一；其余按相对路径对 `process.cwd()` 解析（loader 行工作目录语义）。
 */
export function expandSourceDir(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new Error('fenix-skill-provider: config sourceDir 不能为空字符串（省略该键即取默认 ~/.claude/skills）')
  }
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(1))
  }
  if (trimmed.startsWith('~')) {
    // `~user/...` 形态不支持（不引入 userdb 依赖），显式拒绝而非静默解析错目录。
    throw new Error(`fenix-skill-provider: config sourceDir 不支持 "~user" 形态（仅支持 "~" 与 "~/" 前缀）: ${input}`)
  }
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(process.cwd(), trimmed)
}

/**
 * 校验 pattern 并编译为全串锚定正则：仅允许字面量与段内 `*`（`*` → 不含 `/`
 * 的任意序列）。含 `?` `[` `]` `{` `}` `\` 等 glob 元字符或跨段 `/` 时抛含
 * 键名 `pattern` 与非法原因的可读错误；其余非 `*` 字符一律按字面量转义。
 */
export function compilePattern(pattern: string): RegExp {
  const trimmed = pattern.trim()
  if (trimmed.length === 0) {
    throw new Error('fenix-skill-provider: config pattern 不能为空字符串（省略该键即取默认 fenix-*）')
  }
  for (const ch of trimmed) {
    if (ch === '/') {
      throw new Error(
        `fenix-skill-provider: config pattern 含跨段分隔符 "/"，不合法: ${pattern}（本插件仅支持段内 * 通配，pattern 只匹配来源目录的单层条目名）`,
      )
    }
    if (ILLEGAL_GLOB_CHARS.has(ch)) {
      throw new Error(
        `fenix-skill-provider: config pattern 含不支持的 glob 元字符 "${ch}"，不合法: ${pattern}（本插件仅支持段内 * 通配，如 fenix-*；不支持 ?/[]/{}/\\ 等完整 glob 语法）`,
      )
    }
  }
  let source = ''
  for (const ch of trimmed) {
    if (ch === '*') {
      source += '[^/]*'
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/**
 * loader 行 config 覆盖入口：合并代码默认值并归一。两键均可省略（loader 行
 * 可不带 config）；`pattern` 非法时抛含键名的可读错误，插件以该错误拒绝装载。
 */
export function resolveProviderConfig(input?: ProviderConfigInput | null): ResolvedProviderConfig {
  const rawSource = input?.sourceDir?.trim() ? input.sourceDir : DEFAULT_SOURCE_DIR
  const rawPattern = input?.pattern?.trim() ? input.pattern : DEFAULT_PATTERN
  return {
    sourceDir: expandSourceDir(rawSource),
    pattern: rawPattern.trim(),
    patternRe: compilePattern(rawPattern),
  }
}
