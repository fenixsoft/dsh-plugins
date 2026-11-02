/**
 * 回滚 CLI 入口（构建产物 lib/host.js；宿主直接 node 执行，不经 dsh loader）。
 *
 * CLI 以独立 node 进程运行：peer 包（cordis / JSONL 后端）不在插件自身依赖树
 * 内，而在宿主 dsh 全局安装布局——经 loadPeerModule 显式定位（DSH_PKG_ROOT
 * 覆盖 → 缺省全局布局 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules`
 * → 兜底标准 ESM 解析：插件目录恰位于宿主 node_modules 树内时 parent-walk
 * 命中）。实锾示证（真机 0.2.0-rc.2）：静态 `import '@deepseek-ai/cordis'`
 * 依赖 ESM parent-walk，插件目录不在宿主 node_modules 树内时即
 * ERR_MODULE_NOT_FOUND，文档化的「宿主直接 node 执行」不成立。
 *
 * 持久化 root 缺省从 DSH_HOME 推导（`<DSH_HOME>/sessions`，DSH_HOME 序：
 * --dsh-home → 环境变量 → `~/.dsh`，与 runRollbackCli 同序）；显式 --root 覆盖。
 *
 * 用法：node lib/host.js --session <sessionId> | --all [--dsh-home <dir>]
 *                [--root <sessionsRoot>]
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runRollbackCli, CLI_USAGE } from './rollback.js'

/** 显式 any（宿主安装包模块无类型缝；形状由运行时契约守卫）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PeerModule = any

/**
 * 定位宿主 dsh 安装内的 peer 包模块入口：候选根 `<root>/<pkg>/lib/index.js`
 * 逐一探测（在场即装载）；全部失守退标准 ESM parent-walk（抛错即显式失败，
 * 不静默降级）。
 */
async function loadPeerModule(pkg: string): Promise<PeerModule> {
  const roots = [process.env.DSH_PKG_ROOT, '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules']
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
  for (const root of roots) {
    const entry = join(root, pkg, 'lib/index.js')
    if (existsSync(entry)) return await import(pathToFileURL(entry).href)
  }
  return await import(pkg)
}

/** `<DSH_HOME>` 解析（与 runRollbackCli 同序：--dsh-home → DSH_HOME → ~/.dsh）。 */
function resolveDshHomeArg(argv: readonly string[]): string {
  const homeIndex = argv.indexOf('--dsh-home')
  if (homeIndex >= 0 && argv[homeIndex + 1] !== undefined) return argv[homeIndex + 1] as string
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--root')
  const sessionsRoot = rootIndex >= 0 ? argv[rootIndex + 1] : join(resolveDshHomeArg(argv), 'sessions')
  if (sessionsRoot === undefined || sessionsRoot.length === 0) {
    console.error(`缺少持久化 root（--root <sessionsRoot>，或 --dsh-home/DSH_HOME 可推导）\n${CLI_USAGE}`)
    return 2
  }
  if (!existsSync(sessionsRoot)) {
    console.error(`持久化 root 目录不存在：${sessionsRoot}（--root 显式指定，或核对 --dsh-home/DSH_HOME）`)
    return 2
  }
  const cordis = await loadPeerModule('@deepseek-ai/cordis')
  const jsonl = await loadPeerModule('@deepseek-ai/dsh-session-persistence-jsonl')
  const Context = cordis.Context as new () => unknown
  const JsonlSessionPersistence = jsonl.default as new (ctx: unknown, opts: { root: string; compression: string }) => unknown
  const ctx = new Context()
  const persistence = new JsonlSessionPersistence(ctx, {
    root: sessionsRoot,
    compression: 'zstd',
  })
  return runRollbackCli(persistence as Parameters<typeof runRollbackCli>[0], undefined, argv)
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`fenix-dsh-session-grouper 回滚 CLI 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
