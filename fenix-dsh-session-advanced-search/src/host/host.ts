/**
 * lib/host.js 独立产物入口（tasks 5.1 构建产出面：lib/host.js 与
 * lib/client.js）。装配本体在 src/host/index.ts（loader 经 package.json
 * main = lib/index.js 装载）；本文件仅 re-export 同一插件类——tsdown 双入口
 * 各自独立构建（共享代码各自内联、不出 chunk，session-grouper 先例）。
 */
export { default, SERVICE_NAME } from './index.js'
