import { defineConfig } from 'tsdown'

// 本插件仅 host 半（无 client 入口、无 dsh.client 清单键）：单入口 host ESM，
// dsh loader 按包 main/exports 解析 lib/index.js 并以默认导出为 cordis 插件。
// @deepseek-ai/cordis（运行时 Service 基类）保持 external 随宿主解析；
// @deepseek-ai/dsh-skill 仅供类型（import type 构建期擦除），一并声明 external。
export default defineConfig({
  entry: ['src/host/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-skill'],
  // dsh loader 按 package.json main/exports 解析 lib/index.js；锁死 .js 后缀。
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  clean: true,
})
