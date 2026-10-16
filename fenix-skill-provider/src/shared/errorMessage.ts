/**
 * 共享错误文案工具：把未知 throw 值归一为可读字符串（Error 取 message，其余
 * `String()` 化）。host 装配与 scanner 的容错 warn 共用，避免同一实现两处
 * 各自定义造成漂移。
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
