/**
 * client 半会话跳转（tasks 4.3，design D5）。
 *
 * - 优先缝：`ctx.uiWorkspace.openSession(target)`——「Select a Session and
 *   show its Conversation as one UI navigation action」（UiWorkspaceService，
 *   dsh-client-ui-workspace 注册；官方侧栏搜索结果打开会话同走此缝）。
 *   target 原样传 sessionId，跨工作区天然支持（服务内部处理工作区切换）。
 * - 兜底：uiWorkspace 缺失/形态不符时，侧栏列表项 UI click——按会话标题
 *   文本匹配可点击列表项（侧栏列表项 DOM 无 sessionId 属性可依，标题是
 *   唯一稳定匹配面；找不到即 warn + false，不抛错）。
 * - 「跳转前后关闭弹窗」：onClose 在跳转动作之前调用（先收弹窗再切会话，
 *   避免弹窗残留遮挡目标会话）。
 */
/** 跳转日志门面。 */
export interface JumpLog {
  warn(message: string): void
  debug(message: string): void
}

/** 跳转依赖缝（装配层从 client cordis ctx 解析后注入；测试桩注入）。 */
export interface JumpDeps {
  /** 优先缝：uiWorkspace 服务（缺失/形态不符走兜底）。 */
  readonly uiWorkspace?: { readonly openSession: (target: string) => void } | undefined
  /** 兜底缝：宿主 document（侧栏 DOM 查询；测试注入 jsdom 实例）。 */
  readonly document?: Document | undefined
  readonly log: JumpLog
}

/**
 * 发起会话跳转。
 * @param sessionId - 目标会话 id（服务缝原样透传）。
 * @param options.title - 兜底匹配用的会话标题（结果行 title）。
 * @param options.onClose - 跳转前回调（装配层关弹窗）。
 * @returns 是否成功发起跳转（服务缝=true；兜底命中=true；兜底未命中=false）。
 */
export function jumpToSession(deps: JumpDeps, sessionId: string, options?: { title?: string; onClose?: () => void }): boolean {
  // 先收弹窗（跳转前关闭，避免残留遮挡）。
  options?.onClose?.()

  // 1. 优先缝：uiWorkspace.openSession（跨工作区由服务内部处理）。
  const openSession = deps.uiWorkspace?.openSession
  if (typeof openSession === 'function') {
    openSession.call(deps.uiWorkspace, sessionId)
    deps.log.debug(`fenix-dsh-session-advanced-search: 经 uiWorkspace.openSession 打开会话 ${sessionId}`)
    return true
  }

  // 2. 兜底：侧栏列表项按标题文本匹配 + UI click。
  const doc = deps.document
  const title = options?.title?.trim() ?? ''
  if (doc === undefined || title.length === 0) {
    deps.log.warn(`fenix-dsh-session-advanced-search: uiWorkspace 缝缺失且侧栏兜底不可用（${doc === undefined ? '无 document' : '无标题可匹配'}），放弃跳转 ${sessionId}`)
    return false
  }
  const candidates = doc.querySelectorAll<HTMLElement>('li, [role="button"], button, a')
  for (const element of candidates) {
    if ((element.textContent ?? '').trim() !== title) continue
    element.click()
    deps.log.debug(`fenix-dsh-session-advanced-search: 侧栏列表项 click 兜底打开会话 ${sessionId}`)
    return true
  }
  deps.log.warn(`fenix-dsh-session-advanced-search: 侧栏未找到标题为「${title}」的会话列表项，放弃跳转 ${sessionId}`)
  return false
}
