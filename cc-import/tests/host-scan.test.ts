/**
 * host-scan 测试：覆盖 spec「Host 扫描候选」的四个 Scenario——只返回 claude
 * 形态行、候选字段完整且无 token 明文、不完整候选标跳过、db 异常结构化报错。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { scanCcSwitch } from '../src/host/scan.js'
import { claudeEnv, createFixtureDb, removeFixtureDb, withFixtureDb } from './cc-switch-fixture.js'

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs.splice(0)) removeFixtureDb(dir)
})

function tempPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-import-scan-'))
  tempDirs.push(dir)
  return join(dir, name)
}

describe('Scenario: 只返回 claude 形态行', () => {
  it('codex / gemini 行不出现，候选仅来自 claude 行', () => {
    return withFixtureDb([
      { appType: 'claude', name: 'bigmodel.cn', settingsConfig: claudeEnv() },
      { appType: 'codex', name: 'codex-entry', settingsConfig: { env: { OPENAI_API_KEY: 'sk-x' } } },
      { appType: 'claude', name: 'aliyun', settingsConfig: claudeEnv() },
      { appType: 'gemini', name: 'gemini-entry', settingsConfig: { env: { GEMINI_API_KEY: 'g-x' } } },
    ], (dbPath) => {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates.map((candidate) => candidate.name)).toEqual(['bigmodel.cn', 'aliyun'])
    })
  })
})

describe('Scenario: 候选字段完整', () => {
  it('含 name/baseURL/model/hasToken: true，且响应不含 token 明文', () => {
    const token = 'sk-secret-token-value'
    return withFixtureDb([
      { appType: 'claude', name: 'opengo', settingsConfig: claudeEnv({ ANTHROPIC_MODEL: 'deepseek-v4-pro', ANTHROPIC_AUTH_TOKEN: token }) },
    ], (dbPath) => {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates).toEqual([
        {
          name: 'opengo',
          baseURL: 'https://fixture.example/anthropic',
          model: 'deepseek-v4-pro',
          hasToken: true,
          importable: true,
        },
      ])
      const raw = JSON.stringify(result)
      expect(raw).not.toContain(token)
      expect(raw).not.toContain('sk-secret')
    })
  })

  it('ANTHROPIC_MODEL 缺失时回退 ANTHROPIC_DEFAULT_OPUS_MODEL（可为 [1M] 别名，保持原值）', () => {
    return withFixtureDb([
      { appType: 'claude', name: 'bigmodel.cn', settingsConfig: claudeEnv() },
    ], (dbPath) => {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates[0]?.model).toBe('glm-5.3-flash[1M]')
      expect(result.candidates[0]?.importable).toBe(true)
    })
  })
})

describe('Scenario: 不完整候选标跳过', () => {
  it('缺 ANTHROPIC_BASE_URL 标 missing_base_url', () => {
    return withFixtureDb([
      { appType: 'claude', name: 'no-base', settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-x' } } },
    ], (dbPath) => {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates[0]).toMatchObject({ importable: false, skipReason: 'missing_base_url', hasToken: true })
    })
  })

  it('缺 ANTHROPIC_AUTH_TOKEN 标 missing_token（OAuth 型）', () => {
    return withFixtureDb([
      { appType: 'claude', name: 'Claude Official', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } } },
    ], (dbPath) => {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates[0]).toMatchObject({ importable: false, skipReason: 'missing_token', hasToken: false })
    })
  })

  it('两个模型键均空标 missing_model', () => {
    return withFixtureDb([
      { appType: 'claude', name: 'no-model', settingsConfig: claudeEnv({ ANTHROPIC_DEFAULT_OPUS_MODEL: '' }) },
    ], (dbPath) => {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates[0]).toMatchObject({ importable: false, skipReason: 'missing_model', model: null })
    })
  })
})

describe('Scenario: 单行损坏降级为 skippedRows', () => {
  it('settings_config 坏 JSON 行跳过并记 bad_settings_config，其余候选照常产出（不抛未捕获异常）', () => {
    const dbPath = createFixtureDb([
      { appType: 'claude', name: 'broken', settingsConfig: '{not json' },
      { appType: 'claude', name: 'healthy', settingsConfig: claudeEnv() },
    ])
    try {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates.map((candidate) => candidate.name)).toEqual(['healthy'])
      expect(result.skippedRows).toEqual([
        { name: 'broken', code: 'bad_settings_config', message: expect.stringContaining('broken') },
      ])
    } finally {
      removeFixtureDb(dbPath)
    }
  })

  it('缺 name 行跳过并记独立错误码 bad_provider_row，不再复用 bad_settings_config', () => {
    const dbPath = createFixtureDb([
      { appType: 'claude', name: '', settingsConfig: claudeEnv() },
    ])
    try {
      const result = scanCcSwitch(dbPath)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.candidates).toEqual([])
      expect(result.skippedRows).toEqual([
        { name: null, code: 'bad_provider_row', message: expect.any(String) },
      ])
    } finally {
      removeFixtureDb(dbPath)
    }
  })
})

describe('Scenario: db 异常结构化报错', () => {
  it('db 不存在 → db_missing', () => {
    const result = scanCcSwitch(tempPath('absent.db'))
    expect(result).toMatchObject({ ok: false, code: 'db_missing' })
    expect(typeof (result as { message?: string }).message).toBe('string')
  })

  it('非 SQLite 文件 → db_unreadable', () => {
    const path = tempPath('garbage.db')
    writeFileSync(path, 'this is not a sqlite database at all')
    const result = scanCcSwitch(path)
    expect(result).toMatchObject({ ok: false, code: 'db_unreadable' })
  })

  it('providers 表缺失 → db_schema', () => {
    const path = tempPath('empty.db')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE other (id TEXT)')
    db.close()
    const result = scanCcSwitch(path)
    expect(result).toMatchObject({ ok: false, code: 'db_schema' })
  })
})
