import { defineConfig } from 'tsdown'

// dsh 插件三入口（对齐 fenix-dsh-dashboard-bridge / fenix-dsh-session-grouper 先例）：
// - Host 装配与 loader 入口 `src/host/index.ts` → `lib/index.js`：ESM（dsh 宿主
//   为 ESM；package.json main/exports `.` 指向它）。@deepseek-ai/cordis 保持
//   external 随宿主解析；其余 host 模块（jobs/collector/analyzer/routes/shared）
//   一并打包。
// - `src/host/host.ts` → `lib/host.js`：薄 re-export（tasks 5.1 产出面；
//   clean:false 防止清掉先构建的 index.js）。
// - Client 半 `src/client/index.ts` → `lib/client.js`：dsh client-modules 的懒加载
//   CJS 工厂形态——`window.__ModuleLoader__.load({ id, factory })`，factory(require)
//   内完整求值模块体并返回 module.exports（形态对齐发行包 client.js）。react 与
//   dsh client 模块表内的包全部走模块表 require，不打包。
const hostBase = () => ({
  outDir: 'lib',
  format: 'esm' as const,
  platform: 'node' as const,
  target: 'node24',
  external: ['@deepseek-ai/cordis'],
  // dsh loader 按 package.json main/exports 解析 lib/*.js；锁死 .js 后缀。
  outExtensions: () => ({ js: '.js' }),
  dts: false,
})

const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  { ...hostBase(), entry: { index: 'src/host/index.ts' }, clean: true },
  { ...hostBase(), entry: { host: 'src/host/host.ts' }, clean: false },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: clientExternals,
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    clean: false,
    banner: [
      'window.__ModuleLoader__.load({',
      '\tid: "fenix-dsh-session-advanced-search",',
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
    ].join('\n'),
    footer: ['\t\treturn module.exports;', '\t}', '});'].join('\n'),
  },
])
