/**
 * 共享错误文案工具：把未知 throw 值归一为可读字符串（Error 取 message，其余
 * `String()` 化）。host 装配与 scanner 的容错 warn 共用，避免同一实现两处
 * 各自定义造成漂移。
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    // 无原型对象等奇异 throw 值无法 ToPrimitive，String() 会自身抛 TypeError；
    // 本函数服务于 catch/warn 容错路径，任何输入下都不允许再向外抛。
    return '[unstringifiable thrown value]'
  }
}
