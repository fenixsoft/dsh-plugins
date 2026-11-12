import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// 双通道解析（对齐 fenix-dsh-session-grouper 先例）：
// 1) @deepseek-ai/cordis → 最小桩：host/client 代码对它是构建期类型缝 + 运行时
//    external；插件体测试用假 ctx 鸭子类型驱动，不依赖真实 cordis 生命周期。
// 2) client 半测试（searchButton/dialog/jump）跑 jsdom 环境（environmentMatchGlobs
//    按文件映射）；host 侧测试保持 node 环境。
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
    // primitives 桩同理（弹窗关闭按钮 Tooltip 基元）：jsdom 测试无 dsh client
    // 模块表，直通 children 保持元素树可断言（dashboard-bridge 先例形态）。
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return '\0stub-dsh-primitives'
    if (id === '@deepseek-ai/dsh-session-persistence') return installedLib('dsh-session-persistence')
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
    if (id === '\0stub-dsh-primitives') {
      return [
        '// 最小 primitives 桩：Tooltip 直通 children（弹窗测试断言元素树结构）。',
        'export function Tooltip(props) {',
        '\treturn props?.children ?? null',
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
    environmentMatchGlobs: [
      // client 半 DOM 行为测试（注入/弹窗/跳转兜底）需要 jsdom。
      ['tests/searchButton.test.ts', 'jsdom'],
      ['tests/dialog.test.ts', 'jsdom'],
      ['tests/jump.test.ts', 'jsdom'],
    ],
    testTimeout: 30_000,
  },
})
