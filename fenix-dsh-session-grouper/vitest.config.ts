import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// 双通道解析：
// 1) @deepseek-ai/cordis → 最小桩（对齐 fenix-dsh-dashboard-bridge 先例）：
//    host/index.ts 对它是构建期类型缝 + 运行时 external；插件体测试用假 ctx
//    鸭子类型驱动，不依赖真实 cordis 生命周期。
// 2) @deepseek-ai/dsh-session{,-persistence,-persistence-jsonl} → 本机 dsh
//    安装包真实 lib（migrator 测试以真实持久化后端装配为黄金路径；不可用时
//    用例内形状替身兜底并在用例注明）。安装包位于自包含 node_modules 树内，
//    其裸导入（@deepseek-ai/*、koffi）按相对解析自然命中，无需额外别名。
const dshInstallRoot =
  process.env.DSH_INSTALL_ROOT ??
  '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

function installedLib(pkg: string): string | undefined {
  const candidate = `${dshInstallRoot}/${pkg}/lib/index.js`
  return existsSync(candidate) ? candidate : undefined
}

const stubDshRuntime = {
  name: 'stub-dsh-runtime',
  // pre：抢在 vite-node 对 node_modules 依赖的外部化解析之前接管说明符。
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id === '@deepseek-ai/cordis') return '\0stub-dsh-cordis'
    if (id === '@deepseek-ai/dsh-session') return installedLib('dsh-session')
    if (id === '@deepseek-ai/dsh-session-persistence') return installedLib('dsh-session-persistence')
    if (id === '@deepseek-ai/dsh-session-persistence-jsonl') return installedLib('dsh-session-persistence-jsonl')
    return undefined
  },
  load(id: string) {
    if (id === '\0stub-dsh-cordis') {
      return [
        '// 最小 cordis Service 基类桩：仅覆盖被测代码用到的构造形态。',
        'export class Service {',
        '\tconstructor(ctx, name) {',
        '\t\tthis.ctx = ctx',
        '\t\tif (name !== undefined) this.name = name',
        '\t}',
        '}',
      ].join('\n')
    }
    return undefined
  },
}

export default defineConfig({
  plugins: [stubDshRuntime],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
})
