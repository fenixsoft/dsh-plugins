import { defineConfig } from 'tsdown'

// dsh 插件双入口：
// - Host 半 `src/host/index.ts` → `lib/index.js`：ESM（dsh 宿主为 ESM；loader 以
//   包默认导出为 cordis 插件）。运行时依赖（@deepseek-ai/cordis、
//   @deepseek-ai/dsh-typert-protocol）保持 external，随宿主解析。
// - Client 半 `src/client/index.ts` → `lib/client.js`：dsh client-modules 的
//   懒加载 CJS 工厂形态——`window.__ModuleLoader__.load({ id, factory })`，
//   factory(require) 内完整求值模块体并返回 module.exports（形态对齐发行包
//   @deepseek-ai/dsh-client-ui-settings-general/lib/client.js）。
//   react 与 client 模块表内的 dsh 包全部走模块表 require，不打包。
const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    entry: ['src/host/index.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node24',
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-protocol'],
    // dsh loader 按 package.json main/exports 解析 lib/index.js；锁死 .js 后缀。
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    clean: true,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: clientExternals,
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    banner: [
      'window.__ModuleLoader__.load({',
      '\tid: "cc-import",',
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
    ].join('\n'),
    footer: ['\t\treturn module.exports;', '\t}', '});'].join('\n'),
  },
])
