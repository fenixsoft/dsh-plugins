import { defineConfig } from 'tsdown'

// 单入口 host 半插件（纯 host，无 client UI）：
// - lib/index.js：loader 按包名装载的 cordis 插件（package.json main）。
// - lib/host.js：回滚 CLI（宿主直接 `node lib/host.js ...` 执行，不经 loader）。
// 两入口各自独立单入口构建（共享代码各自内联，不出 chunk——交付面收敛为
// 上述两文件；第二段 clean:false 防止互相清产物）。
// @deepseek-ai/* 全部 external（随宿主解析）；对 dsh 服务缝零静态导入，
// 唯一例外是 CLI 的 JSONL 后端装配（运行时由宿主 node_modules 解析）。
const base = () => ({
  outDir: 'lib',
  format: 'esm' as const,
  platform: 'node' as const,
  target: 'node24',
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session-persistence-jsonl'],
  // dsh loader 按 package.json main/exports 解析 lib/*.js；锁死 .js 后缀。
  outExtensions: () => ({ js: '.js' }),
  dts: false,
})

export default defineConfig([{ ...base(), entry: ['src/host/index.ts'], clean: true }, { ...base(), entry: { host: 'src/host/cli.ts' }, clean: false }])
