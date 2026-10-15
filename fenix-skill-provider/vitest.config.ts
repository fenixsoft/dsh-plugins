import { defineConfig } from 'vitest/config'

// dsh 运行时包桩解耦（对齐 fenix-dsh-dashboard-bridge 先例的意图）：
// @deepseek-ai/cordis 的宿主内匹配版本不保证可从 npm 解析出与 dsh 0.2.0-rc.2
// 内置一致的形态；host/index.ts 对它是构建期类型缝 + 运行时 external。这里用
// vite 内联插件把该说明符解析到最小桩模块（只含被测代码用到的 Service 基类形），
// 不引入任何额外桩文件。@deepseek-ai/dsh-skill 已随 0.2.0-rc.2 发布到 npm，
// 作为 devDependency 参与真实解析，不打桩。
const stubDshRuntime = {
  name: 'stub-dsh-runtime',
  // pre：抢在 vite-node 对 node_modules 依赖的外部化解析之前接管说明符
  //（pnpm auto-install-peers 会把 peer 依赖落进 node_modules，须先拦截）。
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id === '@deepseek-ai/cordis') return '\0stub-dsh-cordis'
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
  },
})
