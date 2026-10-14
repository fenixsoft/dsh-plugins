import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // scan.ts 依赖 node:sqlite（Node 24 内置）；测试仅跑在本机 Node 上。
    environment: 'node',
  },
})
