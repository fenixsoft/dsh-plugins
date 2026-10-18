/**
 * SKILL.md frontmatter 受限解析（design D4）。
 *
 * 复用判定：`@deepseek-ai/dsh-skill-filesystem` 0.2.0-rc.2 仅导出
 * `Config / FileSystemSkillProvider / apply / inject / name`（实测其 lib/index.js
 * 导出表），未导出 frontmatter 解析器——按 design D4 走受限键值自解析。
 *
 * 覆盖 fenix 系 skill（frontmatter 仅 name/description 两键平直 YAML，已核实）
 * 及可预见的扩展键：name/description/whenToUse（字符串）、user-invocable /
 * disable-model-invocation（布尔）、metadata（扁平键值）。不支持完整 YAML
 * （多行折叠、引号转义、列表、深嵌套）；围栏缺失或结构不可解析时返回 null，
 * 调用方（scanner）按非法条目跳过并 warn。
 */

/** 解析成功的受限 frontmatter 视图。 */
export interface ParsedFrontmatter {
  /** skill 名（kebab-case 校验由调用方按 dsh-skill isSkillName 语法执行）。 */
  readonly name?: string
  /** 短描述。 */
  readonly description?: string
  /** 可选的额外路由指引。 */
  readonly whenToUse?: string
  /** `user-invocable` 解析值（缺省 undefined → 调用方取 true）。 */
  readonly userInvocable?: boolean
  /** `disable-model-invocation` 解析值（缺省 undefined → 调用方取 true）。 */
  readonly modelInvocable?: boolean
  /** `metadata:` 扁平键值（出现该键但无有效子键时为空对象）。 */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** 围栏之后的 Markdown 正文（剥除 frontmatter，含收尾围栏后的换行归一）。 */
  readonly body: string
}

/**
 * 解析 SKILL.md 顶部 `---` 围栏 frontmatter。
 * - 首行必须为 `---`（容忍 `\r`），且存在收尾 `---` 行，否则返回 null；
 * - 逐行 `key: value`，value 去首尾空白与成对引号；布尔键取
 *   true/false（大小写不敏感）与 1/0，其余值形态视为解析失败返回 null；
 * - `metadata:` 之后比首键更深缩进的 `key: value` 行归入 metadata 扁平键值；
 * - 出现无法理解的行（无冒号的非空行）整体视为解析失败返回 null。
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter | null {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return null
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return null

  const closing = findClosingFence(raw, firstLineEnd + 1)
  if (closing === undefined) return null

  const data = parseKeyValueBlock(raw.slice(firstLineEnd + 1, closing.start))
  if (data === null) return null

  const parsed: {
    name?: string
    description?: string
    whenToUse?: string
    userInvocable?: boolean
    modelInvocable?: boolean
    metadata?: Record<string, unknown>
  } = {}

  const name = data.get('name')
  if (name !== undefined) {
    if (typeof name !== 'string') return null
    parsed.name = name
  }
  const description = data.get('description')
  if (description !== undefined) {
    if (typeof description !== 'string') return null
    parsed.description = description
  }
  const whenToUse = data.get('whenToUse')
  if (whenToUse !== undefined) {
    if (typeof whenToUse !== 'string') return null
    parsed.whenToUse = whenToUse
  }
  const userInvocable = data.get('user-invocable')
  if (userInvocable !== undefined) {
    if (typeof userInvocable !== 'boolean') return null
    parsed.userInvocable = userInvocable
  }
  const disableModel = data.get('disable-model-invocation')
  if (disableModel !== undefined) {
    if (typeof disableModel !== 'boolean') return null
    parsed.modelInvocable = !disableModel
  }
  const metadata = data.get('metadata')
  if (metadata !== undefined) {
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null
    parsed.metadata = metadata as Record<string, unknown>
  }

  return { ...parsed, body: raw.slice(closing.bodyStart) }
}

/** 收尾围栏位置：`start` 为围栏行起点，`bodyStart` 为正文起点。 */
interface ClosingFence {
  readonly start: number
  readonly bodyStart: number
}

function findClosingFence(raw: string, start: number): ClosingFence | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/**
 * 受限键值块解析：返回「顶层键 → 值」的有序映射；metadata 键的值为其子键值
 * 对象。无法理解的行返回 null（调用方按非法条目跳过）。
 */
function parseKeyValueBlock(block: string): Map<string, string | boolean | Record<string, unknown> | null> | null {
  const data = new Map<string, string | boolean | Record<string, unknown> | null>()
  let baseIndent: number | undefined
  let metadataIndent: number | undefined
  const metadata: Record<string, unknown> = {}

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.trim().length === 0) continue
    const indent = line.length - line.trimStart().length
    const colon = line.indexOf(':')
    if (colon < 0) return null // 无冒号的结构行：受限解析不理解，整体失败
    const key = line.slice(0, colon).trim()
    if (key.length === 0) return null
    const valueText = line.slice(colon + 1).trim()

    if (baseIndent === undefined) baseIndent = indent
    const isNested = indent > (baseIndent ?? 0)

    if (isNested && metadataIndent !== undefined) {
      if (indent <= metadataIndent) return null // 嵌套块已结束却仍有深缩进行
      if (key in metadata) return null
      const value = parseScalar(valueText)
      if (value === null) return null
      metadata[key] = value
      continue
    }
    if (isNested) return null // 首个嵌套行不属于任何已知容器键
    // 回到顶层键即视为 metadata 块结束：其后的深缩进行不再归属 metadata，走整体失败路径
    metadataIndent = undefined

    if (key === 'metadata' && valueText.length === 0) {
      if (data.has('metadata')) return null // 重复 metadata: 声明与其他顶层键同口径：整体失败
      metadataIndent = indent
      data.set('metadata', metadata)
      continue
    }
    if (data.has(key)) return null // 重复键：受限解析不理解，整体失败
    const value = parseScalar(valueText)
    if (value === null) return null
    data.set(key, value)
  }
  return data
}

/** 标量解析：去成对引号的字符串；true/false（大小写不敏感）与 1/0 布尔；空值与形态不明返回 null。 */
function parseScalar(text: string): string | boolean | null {
  if (text.length === 0) return null
  const lowered = text.toLowerCase()
  if (lowered === 'true') return true
  if (lowered === 'false') return false
  if (text === '1') return true
  if (text === '0') return false
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0] as string
    // 以引号起始但不成对（如 `"abc`）：受限解析不理解，整体失败，避免引号残留在值中
    if (text.length < 2 || !text.endsWith(quote)) return null
    const inner = text.slice(1, -1)
    return inner.includes(quote) ? null : inner
  }
  // 多行 / 流集合（[ {）起始形态不支持，整体拒绝；# 的拒绝收窄为「注释起始」：
  // 仅值首（YAML `key: # …` 取到的是注释而非值）或空白后的 # 拒绝；
  // 值中部的 # / [ / { 是合法字面量（如「支持 C# 项目」「支持 [实验] 标签」），放行。
  // [fenix-ignore:5ae61ac429c4] 成对引号值已在上方引号分支提前返回，引号内 # 不经过本检查，所述「引号值含空格+# 被拒」不成立
  if (/(?:^|\s)#|^[{[]/.test(text)) return null
  return text
}
