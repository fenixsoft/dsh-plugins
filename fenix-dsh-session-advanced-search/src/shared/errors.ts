/**
 * shared 错误摘要辅助（host 各管线 warn 日志与降级文案的单一来源）。
 *
 * 原先 analyzer.ts / collector.ts 各自重复实现同一函数，错误摘要格式调整
 * 需两处同步修改；收敛到此单处导出（shared 不反向依赖 host）。
 */

/** 错误摘要：Error 实例取 message，其余值 String() 兜底。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
