/**
 * cc-switch.db 测试 fixture：在临时目录用 node:sqlite 生成含指定行的 fixture
 * 数据库（不提交任何二进制 db）。行集合覆盖 claude/codex/gemini 混合形态、
 * 缺字段行与 `[1M]` 模型行。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** 一行 fixture provider。settingsConfig 允许传对象（自动 JSON 序列化）、原始
 * 字符串（构造坏 JSON）或 null（缺 settings_config）。 */
export interface FixtureRow {
  readonly appType: 'claude' | 'codex' | 'gemini'
  readonly name: string
  readonly settingsConfig: object | string | null
  readonly sortIndex?: number
}

/** 建 providers 表（列集对齐真实 cc-switch.db 的关键列）。 */
function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT,
      website_url TEXT,
      category TEXT,
      created_at TEXT,
      sort_index INTEGER
    )
  `)
}

/** 在临时目录生成 fixture db，返回其路径。 */
export function createFixtureDb(rows: readonly FixtureRow[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-import-fixture-'))
  const dbPath = join(dir, 'cc-switch.db')
  const db = new DatabaseSync(dbPath)
  try {
    createSchema(db)
    const insert = db.prepare(
      'INSERT INTO providers (id, app_type, name, settings_config, created_at, sort_index) VALUES (?, ?, ?, ?, ?, ?)',
    )
    rows.forEach((row, index) => {
      const serialized =
        row.settingsConfig === null || typeof row.settingsConfig === 'string'
          ? (row.settingsConfig as string | null)
          : JSON.stringify(row.settingsConfig)
      insert.run(`fixture-${index}`, row.appType, row.name, serialized, '2026-01-01T00:00:00Z', row.sortIndex ?? index)
    })
  } finally {
    db.close()
  }
  return dbPath
}

/** 删除 fixture db（或其临时目录）及其所在目录；对文件与目录都安全。所在目录
 * 仅限本夹具自建的 `cc-import-*` 临时目录——调用方把临时目录本身传进来时
 * （host-scan 的 afterAll），其父目录是共享 tmpdir，无条件递归清除会清空 /tmp
 * 全体并在并发写入下抛 ENOTEMPTY（回归 parse_error 的根因）。 */
export function removeFixtureDb(dbPath: string): void {
  rmSync(dbPath, { force: true, recursive: true })
  const dir = dbPath.slice(0, dbPath.lastIndexOf('/'))
  if (dir.length > 0 && basename(dir).startsWith('cc-import-')) rmSync(dir, { force: true, recursive: true })
}

/** 一个完整可导入的 claude env 块（[1M] 模型走 DEFAULT_OPUS 回退键）。 */
export function claudeEnv(overrides: Record<string, string> = {}): object {
  return {
    env: {
      ANTHROPIC_AUTH_TOKEN: 'sk-fixture-token',
      ANTHROPIC_BASE_URL: 'https://fixture.example/anthropic',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3-flash[1M]',
      ...overrides,
    },
  }
}

/** withFixtureDb：建库 → 执行 → 清理。 */
export async function withFixtureDb<T>(
  rows: readonly FixtureRow[],
  run: (dbPath: string) => Promise<T> | T,
): Promise<T> {
  const dbPath = createFixtureDb(rows)
  try {
    return await run(dbPath)
  } finally {
    removeFixtureDb(dbPath)
  }
}
