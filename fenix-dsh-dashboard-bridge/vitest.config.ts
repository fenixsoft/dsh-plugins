import { defineConfig } from 'vitest/config'

// dsh 运行时包桩解耦（对齐 cc-import 先例的意图）：
// @deepseek-ai/cordis 未随匹配版本发布到 npm，无法作为 devDependency 安装参与
// vitest 解析；host/index.ts 对它是构建期类型缝 + 运行时 external。这里用
// vite 内联插件把该说明符解析到最小桩模块（只含测试用到的 Service 基类形），
// 不引入任何额外桩文件。
const stubDshRuntime = {
  name: 'stub-dsh-runtime',
  // pre：抢在 vite-node 对 node_modules 依赖的外部化解析之前接管说明符
  //（pnpm auto-install-peers 会把 peer 依赖落进 node_modules，须先拦截）。
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id === '@deepseek-ai/cordis') return '\0stub-dsh-cordis'
    // primitives 桩同理（项目行「新建会话」action 消费 Tooltip/图标基元）：
    // node 测试环境无 dsh client 模块表，最小函数桩保持元素树可求值。
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return '\0stub-dsh-primitives'
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
        '// 最小 primitives 桩：Tooltip 直通 children，图标返回 null——',
        '// 项目行元素树测试只断言结构（props/testid），不实际渲染。',
        'export function Tooltip(props) {',
        '\treturn props?.children ?? null',
        '}',
        'export function IconNewChatOutlineRegular() {',
        '\treturn null',
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
    // proxy.test.ts 用 node:http 起真实 mock 上游/代理服务；SSE 时间差断言
    // 依赖真实计时器，测试仅跑在本机 Node 上。
    environment: 'node',
  },
})
