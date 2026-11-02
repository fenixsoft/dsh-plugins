/**
 * 回滚 CLI 入口（构建产物 lib/host.js；宿主直接 node 执行，不经 dsh loader）。
 *
 * 需要先装配真实持久化缝：经 dsh 安装包 JSONL 后端 + 临时 cordis Context
 * 组装（与 dsh-web 进程内的同一后端类），DSH_HOME 由环境变量或 --dsh-home
 * 指定（后端 root 亦从 DSH_HOME 推导，见 --root）。
 *
 * 用法：node lib/host.js --session <sessionId> | --all
 *                --root <sessionsRoot> [--dsh-home <dir>]
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { runRollbackCli, CLI_USAGE } from './rollback.js'

/** 经宿主 require 链定位安装包（插件以 link: 形态并入 profile 时可解析）。 */
function resolveInstalled(pkg: string): string {
  const require = createRequire(import.meta.url)
  return require.resolve(pkg)
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--root')
  const sessionsRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined
  if (sessionsRoot === undefined || sessionsRoot.length === 0) {
    console.error(`缺少 --root <sessionsRoot>（JSONL 持久化 root，通常为 <DSH_HOME>/sessions）\n${CLI_USAGE}`)
    return 2
  }
  if (!existsSync(sessionsRoot)) {
    console.error(`--root 指向的目录不存在：${sessionsRoot}`)
    return 2
  }
  // 安装包解析失败即显式失败（版本缝漂移纪律：不静默降级）。
  resolveInstalled('@deepseek-ai/dsh-session-persistence-jsonl')
  const ctx = new Context()
  const persistence = new JsonlSessionPersistence(ctx, {
    root: sessionsRoot,
    compression: 'zstd',
  })
  return runRollbackCli(persistence, undefined, argv)
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`fenix-dsh-session-grouper 回滚 CLI 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
