/**
 * 来源目录扫描（spec「来源目录扫描与 skill 注册」Requirement 的实现单源）。
 *
 * `scanSkillDir` 每次调用都动态扫描来源目录（design D2：provider 侧不缓存），
 * 取「目录及指向目录的 symlink」且名字匹配 pattern 的条目，读 `<dir>/SKILL.md`
 * 并经受限 frontmatter 解析产出 SkillCandidate。任何单条目异常（缺 SKILL.md、
 * frontmatter 解析失败、缺 name/description、名字非 kebab-case、I/O 错误）都
 * contained：跳过该条目并留一条含目录名与原因的 warn，绝不让整体 reject。
 */
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import type { SkillCandidate, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { parseFrontmatter } from './frontmatter.js'

/** 本插件在 dsh skill 注册表中的 provider 名。 */
export const PROVIDER_NAME = 'fenix-skill-provider'

/**
 * candidate rank：用户级档（与 dsh-skill-filesystem 的 agentsHome/skills=500
 * 同量级），保证项目级 skill（rank 100/200）同名单时胜出（design D5）。
 */
export const USER_LEVEL_RANK = 500

/** dsh-skill `isSkillName` 的命名语法（kebab-case，逐字对齐其 SKILL_NAME 正则）。 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 扫描告警出口：host 装配时接 `ctx.logger.warn`，测试接收集器。 */
export type ScanLog = (message: string) => void

function warn(log: ScanLog, dirName: string, reason: string): void {
  log(`fenix-skill-provider: 跳过来源条目 ${dirName}: ${reason}`)
}

/**
 * 扫描来源目录并产出 skill candidates。
 *
 * @returns 正常完成时返回完整 candidate 数组（registry 的 complete 简写形）；
 *   `signal` 中途 abort 时尽早 settle，返回
 *   `{ candidates: 已收集部分, complete: false }`（registry 不缓存该观察）。
 *   来源目录不存在/不可读时返回空数组并留一条 warn。
 */
export async function scanSkillDir(
  sourceDir: string,
  patternRe: RegExp,
  log: ScanLog,
  signal?: AbortSignal | undefined,
): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true })
  } catch (error) {
    log(
      `fenix-skill-provider: 来源目录 ${sourceDir} 不存在或不可读，本 provider 返回空集（自动同步依赖的 watch 亦无法覆盖该目录）: ${errorMessage(error)}`,
    )
    return []
  }

  // readdir 的条目顺序平台/文件系统相关（ext4 哈希序、apfs 目录序各不相同），
  // 先按目录名字典序排序，让「重名保留首个」有稳定可解释的语义：字典序最小
  // 者胜出，与遍历时的平台顺序无关。
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const candidates: SkillCandidate[] = []
  // skill name → 获胜条目的 SKILL.md 路径（重名 warn 中指认保留方用）
  const seenNames = new Map<string, string>()
  for (const entry of entries) {
    if (signal?.aborted) return { candidates, complete: false }
    if (!patternRe.test(entry.name)) continue
    const dirName = entry.name
    const dirPath = join(sourceDir, dirName)

    let isDir = entry.isDirectory()
    if (!isDir && entry.isSymbolicLink()) {
      // symlink 需解引用判断是否指向目录；断链/指向非目录均不是合法条目。
      try {
        isDir = (await fs.stat(dirPath)).isDirectory()
      } catch (error) {
        warn(log, dirName, `符号链接不可解引用（断链或目标不可达）: ${errorMessage(error)}`)
        continue
      }
    }
    if (!isDir) continue // 平文件（含顶层 .md）不是本 provider 的条目形态

    const skillMdPath = join(dirPath, 'SKILL.md')
    let raw: string
    try {
      raw = await fs.readFile(skillMdPath, 'utf8')
    } catch (error) {
      const reason =
        (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
          ? '缺 SKILL.md'
          : `SKILL.md 不可读: ${errorMessage(error)}`
      warn(log, dirName, reason)
      continue
    }

    const parsed = parseFrontmatter(raw)
    if (parsed === null) {
      warn(log, dirName, 'frontmatter 围栏缺失或结构不可解析（受限解析仅支持平直键值）')
      continue
    }
    if (parsed.name === undefined || parsed.name.length === 0) {
      warn(log, dirName, 'frontmatter 缺 name')
      continue
    }
    if (parsed.description === undefined || parsed.description.length === 0) {
      warn(log, dirName, 'frontmatter 缺 description')
      continue
    }
    if (!SKILL_NAME_RE.test(parsed.name)) {
      warn(log, dirName, `name "${parsed.name}" 不符 skill 命名语法（须为 kebab-case，对齐 dsh-skill isSkillName）`)
      continue
    }
    const winnerPath = seenNames.get(parsed.name)
    if (winnerPath !== undefined) {
      warn(log, dirName, `skill name "${parsed.name}" 与先前条目 ${winnerPath} 重名，保留先前条目、跳过本条目`)
      continue
    }
    seenNames.set(parsed.name, skillMdPath)

    candidates.push({
      path: skillMdPath,
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
      invocation: {
        modelInvocable: parsed.modelInvocable !== false,
        userInvocable: parsed.userInvocable !== false,
      },
      source: 'custom',
      provider: PROVIDER_NAME,
      rank: USER_LEVEL_RANK,
      locator: skillMdPath,
      resourceBase: { kind: 'directory', path: dirPath },
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
    })
  }
  return candidates
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
