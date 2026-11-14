/**
 * 独立高级搜索页（转向轮：用户指令 m00937「转向自己定制的高级搜索页面，
 * 不要再会话界面上修改元素」）。
 *
 * 形态：host 半 exact 路由 `GET /session-advanced-search` 直出自包含 HTML
 * （无外部依赖、无构建步骤；fenix-dsh-auth `/` 页面同姿势）。页面 UI 与
 * 定稿原型 specs/optimize-session-advanced-search/prototype/index.html
 * （Round 2）同源：DSH light 令牌、底部 composer（952px/28px 圆角）、
 * AI 分析步骤流面板、琥珀降级横幅、置信度条结果卡。
 *
 * 与原型的差异（诚实化，不保留假控件）：
 *   - 无左侧栏/聊天视图（本页即搜索页，独立于会话界面）；
 *   - 无预览模式切换（AI/机械形态由后端 degraded 决定，非人工切换）；
 *   - 无 scope/filter 假 chips 与 ws:/since:/in: 语法提示（后端不解析前缀，
 *     原型中为装饰）。
 *
 * 真实数据面（与 shared/protocol.ts 契约对齐）：
 *   POST /api/session-advanced-search/jobs        {query} → {jobId}
 *   GET  /api/session-advanced-search/jobs/:id    轮询：phase/progress[]/
 *                                                 results/degraded/
 *                                                 degradedReason/message
 *   DELETE /api/session-advanced-search/jobs/:id  中断（幂等）
 *
 * 跳回会话（同源缝）：结果卡点击 → localStorage['dsh.sessions.current']
 * = {"sessionId":...} → location '/' → workspace restoreSelection 打开该
 * 会话（dsh-client-store attachPersistence 直读写 raw JSON，bundle 实证）。
 *
 * 实现约束：模板串内不得出现反引号与 ${（页面 JS 全部单引号+拼接），保证
 * TS 模板字面量零转义；所有插值经 esc() 出 HTML。
 */
import { PAGE_PATH } from '../shared/protocol.js'

/** 页面 exact 路由路径（常量收口在 shared/protocol，client 入口按钮同源引用）。 */
export const PAGE_ROUTE = PAGE_PATH

/** 页面路由依赖（log 门面；测试桩对账面）。 */
export interface PageRouteDeps {
  readonly log: { warn(message: string): void }
}

/** 注册结果（注册/卸载对称）。 */
export interface RegisteredPageRoute {
  readonly dispose: () => void
}

/** webServer.register 缝的最小被消费面（与 routes.ts 同形）。 */
export interface WebServerSeam {
  register(route: { kind: 'exact' | 'prefix' | 'fallback'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void
}

/** 注册独立页路由（exact 座位无冲突；GET 出页，其余 405）。 */
export function registerPageRoute(webServer: WebServerSeam, deps: PageRouteDeps): RegisteredPageRoute {
  const dispose = webServer.register({
    kind: 'exact',
    path: PAGE_ROUTE,
    handler: (req: unknown, res: unknown) => handlePageRequest(req, res),
  })
  if (typeof dispose !== 'function') {
    deps.log.warn(`session-advanced-search: register(${PAGE_ROUTE}) returned no disposer; route persists until reload`)
  }
  return {
    dispose: () => {
      if (typeof dispose === 'function') {
        try {
          dispose()
        } catch {
          // 注销异常尽力而为（与 routes.ts 同策略）。
        }
      }
    },
  }
}

function handlePageRequest(req: unknown, res: unknown): void {
  const r = req as { method?: string }
  const w = res as { writeHead(status: number, headers?: Record<string, string>): unknown; end(body?: string): unknown }
  if (r.method !== 'GET' && r.method !== 'HEAD') {
    const body = JSON.stringify({ error: 'method not allowed; use GET' })
    w.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) })
    w.end(body)
    return
  }
  const html = renderPageHtml()
  w.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(Buffer.byteLength(html)),
  })
  w.end(r.method === 'HEAD' ? undefined : html)
}

/** 渲染整页 HTML（自包含；与定稿原型 Round 2 同源样式）。 */
export function renderPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>高级搜索 · DeepSeek Harness</title>
<style>
/* ===== DSH 真实主题令牌（dsh-client-ui 0.2.2-rc.1 light）===== */
:root {
  --dsw-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --dsw-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --n-00: #ffffff; --n-50: #f9fafb; --n-60: #f5f6f7; --n-100: #ebeef2; --n-150: #e9ecf2;
  --n-300: #cfd3d6; --n-400: #adb2b8; --n-600: #81858c; --n-700: #61666b; --n-1000: #0f1115;
  --label-primary: var(--n-1000); --label-secondary: var(--n-700);
  --label-tertiary: var(--n-600); --label-caption: var(--n-400);
  --bg-base: var(--n-00); --bg-hover: var(--n-60);
  --divider: var(--n-100);
  --ds-500: #4176e6; --ds-400: #7aaaff; --ds-50: #edf3fe; --ds-100: #e4edfd; --ds-200: #d3e2ff;
  --amber-bg: #fff7e8; --amber-fg: #b45309; --amber-dot: #f59e0b;
  --red-fg: #b42318; --green-fg: #067647;
  --r-xs: 4px; --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body { font-family: var(--dsw-font-family); font-size: 13px; line-height: 20px; color: var(--label-primary); background: var(--bg-base); overflow: hidden; -webkit-font-smoothing: antialiased; }
button { font-family: inherit; border: none; background: none; cursor: pointer; color: inherit; }
svg { display: block; flex: none; }
.icon-btn { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-sm); color: var(--label-secondary); transition: background .12s ease, color .12s ease; }
.icon-btn:hover { background: var(--bg-hover); color: var(--label-primary); }
.icon-btn:focus-visible { outline: 2px solid var(--ds-500); outline-offset: 1px; }

/* ===== 页面骨架：全页搜索视图 ===== */
.page { height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: var(--n-50); }
.page-header { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 20px; background: var(--bg-base); border-bottom: 1px solid var(--divider); }
.page-header .ttl { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.page-header .ttl svg { color: var(--label-secondary); }
.scope-chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 999px; background: var(--n-100); color: var(--label-secondary); font-size: 12px; }
.page-header .spacer { flex: 1; }
.back-btn { height: 26px; padding: 0 10px; border-radius: var(--r-sm); font-size: 12px; color: var(--label-secondary); border: 1px solid var(--divider); background: var(--bg-base); display: inline-flex; align-items: center; gap: 5px; transition: all .12s ease; }
.back-btn:hover { border-color: var(--ds-200); color: var(--ds-500); }

.page-body { flex: 1; overflow-y: auto; padding: 14px 20px 24px; }

/* 底部输入区（对齐 DSH 会话 composer：max 952px / 28px / 底部渐变座）*/
.page-composer { flex: none; position: relative; background: linear-gradient(180deg, rgba(249,250,251,0) 0px, var(--n-50) 36px); padding: 10px 20px 14px; }
.composer-card { width: min(calc(100% - 16px), 952px); margin: 0 auto; background: var(--bg-base); border: 1px solid #00000029; border-radius: 28px; padding: 8px 10px 8px 16px; box-shadow: 0 1px 3px rgba(15,17,21,.05); transition: border-color .15s ease, box-shadow .15s ease; display: flex; flex-direction: column; gap: 6px; }
.composer-card:focus-within { border-color: var(--ds-400); box-shadow: 0 0 0 3px var(--ds-100); }
.composer-row { display: flex; align-items: center; gap: 8px; }
.composer-row .q-ic { color: var(--label-caption); }
.composer-row input { flex: 1; border: none; outline: none; font: inherit; font-size: 13px; color: var(--label-primary); background: none; }
.composer-row input::placeholder { color: var(--label-caption); }
.send-btn { width: 32px; height: 32px; flex: none; border-radius: 50%; background: var(--ds-500); color: #fff; display: inline-flex; align-items: center; justify-content: center; transition: background .12s ease, opacity .12s ease, transform .12s ease; }
.send-btn:hover { background: #3565cc; }
.send-btn:active { transform: scale(.96); }
.send-btn:disabled { opacity: .4; cursor: default; }
.composer-meta { display: flex; align-items: center; gap: 8px; }
.composer-meta .hint { margin-left: auto; font-size: 12px; color: var(--label-caption); }
.composer-meta .hint kbd { font-family: var(--dsw-font-mono); font-size: 11px; background: var(--n-100); border-radius: 4px; padding: 1px 5px; }

/* AI 分析面板（Agent 对话风格）*/
.ai-panel { background: var(--bg-base); border: 1px solid var(--divider); border-radius: var(--r-lg); margin-bottom: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,17,21,.04); animation: viewIn .2s ease; }
@keyframes viewIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.ai-panel-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--divider); background: linear-gradient(180deg, var(--ds-50), var(--bg-base)); }
.ai-panel-head .ai-ic { color: var(--ds-500); }
.ai-panel-head .ai-ttl { font-size: 13px; font-weight: 600; }
.status-pill { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 12px; }
.status-pill.run { background: var(--ds-50); color: var(--ds-500); }
.status-pill.done { background: #ecfdf3; color: var(--green-fg); }
.status-pill.fail { background: var(--amber-bg); color: var(--amber-fg); }
.status-pill .dot { width: 6px; height: 6px; border-radius: 50%; }
.status-pill.run .dot { background: var(--ds-500); animation: pulse 1.2s ease infinite; }
.status-pill.done .dot { background: var(--green-fg); }
.status-pill.fail .dot { background: var(--amber-dot); }
@keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.8); } }
.ai-panel-head .spacer { flex: 1; }
.btn-ghost { height: 24px; padding: 0 9px; border-radius: var(--r-xs); font-size: 12px; color: var(--label-secondary); display: inline-flex; align-items: center; gap: 5px; transition: all .12s ease; }
.btn-ghost:hover { background: var(--bg-hover); color: var(--label-primary); }
.btn-ghost.stop { color: var(--red-fg); }
.progress-track { height: 3px; background: var(--n-100); }
.progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, var(--ds-400), var(--ds-500)); border-radius: 0 3px 3px 0; transition: width .4s ease; }
.ai-steps { padding: 6px 0; }
.step { display: flex; gap: 10px; padding: 7px 14px; align-items: flex-start; animation: viewIn .25s ease; }
.step .st-ic { margin-top: 2px; color: var(--label-caption); }
.step.ok .st-ic { color: var(--green-fg); }
.step.run .st-ic { color: var(--ds-500); }
.step.fail .st-ic { color: var(--red-fg); }
.step .st-body { flex: 1; min-width: 0; }
.step .st-l1 { font-size: 13px; color: var(--label-primary); }
.step.run .st-l1 { color: var(--ds-500); }
.step.fail .st-l1 { color: var(--amber-fg); }
.step .st-l2 { font-size: 12px; line-height: 16px; color: var(--label-tertiary); margin-top: 1px; overflow-wrap: anywhere; }
.step .st-l2 .mono, .mono { font-family: var(--dsw-font-mono); font-size: 11.5px; }
.step .st-time { font-size: 11px; color: var(--label-caption); margin-top: 2px; font-family: var(--dsw-font-mono); }
.streaming-dots { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: 1px; }
.streaming-dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--ds-400); animation: pulse 1s ease infinite; }
.streaming-dots i:nth-child(2) { animation-delay: .15s; }
.streaming-dots i:nth-child(3) { animation-delay: .3s; }
.detail-toggle { padding: 4px 14px 10px; }
.detail-body { padding: 8px 14px 12px 38px; }
.log-line { font-family: var(--dsw-font-mono); font-size: 11px; line-height: 18px; color: var(--label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-line .ts { color: var(--label-caption); margin-right: 8px; }
.log-line.warn { color: var(--amber-fg); }

/* 降级横幅 */
.degrade-banner { display: flex; gap: 10px; align-items: flex-start; background: var(--amber-bg); border: 1px solid #fde3b7; border-radius: var(--r-md); padding: 10px 12px; margin-bottom: 14px; animation: viewIn .2s ease; }
.degrade-banner svg { color: var(--amber-dot); margin-top: 1px; }
.degrade-banner .db-body { flex: 1; }
.degrade-banner .db-t { font-size: 13px; font-weight: 600; color: var(--amber-fg); }
.degrade-banner .db-d { font-size: 12px; line-height: 17px; color: var(--amber-fg); opacity: .85; margin-top: 2px; }
.degrade-banner .db-d .mono { background: #ffffffb3; border-radius: 4px; padding: 0 4px; }
.degrade-banner .db-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn-amber { height: 26px; padding: 0 10px; border-radius: var(--r-sm); font-size: 12px; background: var(--bg-base); border: 1px solid #fde3b7; color: var(--amber-fg); display: inline-flex; align-items: center; gap: 5px; transition: all .12s ease; }
.btn-amber:hover { background: #fff; border-color: var(--amber-dot); }

/* 结果区 */
.results-head { display: flex; align-items: baseline; gap: 8px; padding: 2px 2px 10px; }
.results-head .r-ttl { font-size: 12px; font-weight: 600; color: var(--label-secondary); letter-spacing: .3px; }
.results-head .r-cnt { font-size: 12px; color: var(--label-caption); }
.results-head .sort-by { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--label-tertiary); }
.result-card { background: var(--bg-base); border: 1px solid var(--divider); border-radius: var(--r-md); padding: 12px 14px; margin-bottom: 8px; cursor: pointer; transition: border-color .12s ease, box-shadow .12s ease, transform .12s ease; animation: viewIn .25s ease backwards; }
.result-card:hover { border-color: var(--ds-200); box-shadow: 0 2px 8px rgba(15,17,21,.06); transform: translateY(-1px); }
.rc-top { display: flex; align-items: center; gap: 8px; }
.rc-title { font-size: 13px; font-weight: 600; color: var(--label-primary); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conf { display: inline-flex; align-items: center; gap: 6px; flex: none; }
.conf .c-track { width: 64px; height: 4px; border-radius: 2px; background: var(--n-100); overflow: hidden; }
.conf .c-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, var(--ds-400), var(--ds-500)); width: 0%; transition: width .6s ease; }
.conf .c-val { font-family: var(--dsw-font-mono); font-size: 11px; color: var(--ds-500); width: 30px; text-align: right; }
.conf.mech .c-fill { background: var(--n-300); }
.conf.mech .c-val { color: var(--label-tertiary); }
.rc-meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 12px; line-height: 16px; color: var(--label-caption); flex-wrap: wrap; }
.rc-meta .ws-chip { display: inline-flex; align-items: center; gap: 4px; font-family: var(--dsw-font-mono); font-size: 11px; color: var(--label-tertiary); background: var(--n-60); border-radius: 5px; padding: 1px 6px; }
.rc-meta .dot-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--n-300); }
.rc-reason { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; font-size: 12px; color: var(--label-secondary); }
.rc-reason svg { color: var(--label-caption); margin-top: 2px; }
.rc-empty { text-align: center; color: var(--label-tertiary); padding: 32px 0; }
.msg-banner { background: var(--bg-base); border: 1px solid var(--divider); border-radius: var(--r-md); padding: 12px 14px; margin-bottom: 14px; color: var(--label-secondary); font-size: 12px; }

/* 初始态 */
.initial-state { padding: 48px 0 0; text-align: center; color: var(--label-tertiary); animation: viewIn .2s ease; }
.initial-state .big-ic { margin: 0 auto 12px; width: 44px; height: 44px; border-radius: var(--r-md); background: var(--bg-base); border: 1px solid var(--divider); display: flex; align-items: center; justify-content: center; color: var(--label-caption); box-shadow: 0 1px 2px rgba(15,17,21,.04); }
.initial-state .h { font-size: 14px; font-weight: 600; color: var(--label-secondary); margin-bottom: 4px; }
.initial-state .d { font-size: 12px; color: var(--label-caption); }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--n-300); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-track { background: transparent; }
.spinner { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="page">
  <header class="page-header">
    <div class="ttl">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"/><path d="M10.2991 10.3933L14.7783 14.8725"/><path d="M8 4.2V7.8" stroke-width="1.1"/><path d="M6.2 6H9.8" stroke-width="1.1"/></svg>
      高级搜索
    </div>
    <span class="scope-chip">全部工作区</span>
    <span class="spacer"></span>
    <button class="back-btn" id="backBtn" title="返回会话界面">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M11.7256 2.77441C12.5538 2.77469 13.2256 3.44616 13.2256 4.27441V10.1416H12.2256V4.27441C12.2256 3.99844 12.0015 3.77469 11.7256 3.77441H5.7207V2.77441H11.7256Z"/><path d="M2.77441 13.2255L12.3756 3.62427"/></svg>
      返回会话
    </button>
  </header>

  <div class="page-body" id="pageBody">
    <div class="initial-state" id="initialState">
      <div class="big-ic">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"/><path d="M10.2991 10.3933L14.7783 14.8725"/><path d="M8 4.2V7.8" stroke-width="1.1"/><path d="M6.2 6H9.8" stroke-width="1.1"/></svg>
      </div>
      <div class="h">用自然语言搜索历史会话</div>
      <div class="d">先机械预筛，再由 AI 按语义相关性排序；分析过程实时可见，随时可中断</div>
    </div>
    <div id="dynamicArea"></div>
  </div>

  <footer class="page-composer">
    <div class="composer-card">
      <div class="composer-row">
        <span class="q-ic">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"/><path d="M10.2991 10.3933L14.7783 14.8725"/></svg>
        </span>
        <input id="queryInput" placeholder="描述你想找的会话内容，例如「上周调试登录超时的会话」" autocomplete="off">
        <button class="send-btn" id="runBtn" title="搜索（Enter）">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6.97211 1.94476C7.55785 1.35914 8.50767 1.35919 9.09343 1.94476L13.921 6.77228L13.2138 7.47939L8.38632 2.65187C8.19108 2.45682 7.87443 2.45677 7.67922 2.65187L2.74397 7.58711L2.03687 6.88L6.97211 1.94476Z"/><path d="M7.97571 14.5732L8.02421 2.34139"/></svg>
        </button>
      </div>
      <div class="composer-meta">
        <span class="hint"><kbd>Enter</kbd> 搜索 · 点击结果卡跳回对应会话</span>
      </div>
    </div>
  </footer>
</div>

<script>
"use strict";
/* ===== 官方图标（dsh-client-ui-primitives 0.2.2-rc.1 原样几何）===== */
var ICONS = {
  search: function (sw) { return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="' + sw + '" aria-hidden="true"><path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"/><path d="M10.2991 10.3933L14.7783 14.8725"/></svg>'; },
  check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M12.5303 6.53027L8.80273 10.2578C8.54967 10.5109 8.31796 10.7439 8.10645 10.9141C7.88375 11.0932 7.616 11.2602 7.27344 11.3145C7.09229 11.3431 6.90771 11.3431 6.72656 11.3145C6.384 11.2602 6.11625 11.0932 5.89355 10.9141C5.68204 10.7439 5.45033 10.5109 5.19727 10.2578L3.46973 8.53027L4.53027 7.46973L6.25781 9.19727C6.53457 9.47402 6.70036 9.63859 6.83398 9.74609C6.95637 9.84453 6.98241 9.83644 6.96094 9.83301C6.98679 9.83709 7.01321 9.83709 7.03906 9.83301C7.01759 9.83644 7.04363 9.84453 7.16602 9.74609C7.29964 9.63859 7.46543 9.47402 7.74219 9.19727L11.4697 5.46973L12.5303 6.53027Z"/><path d="M14.5996 8C14.5996 4.35492 11.6451 1.40039 8 1.40039C4.35492 1.40039 1.40039 4.35492 1.40039 8C1.40039 11.6451 4.35492 14.5996 8 14.5996C11.6451 14.5996 14.5996 11.6451 14.5996 8ZM15.9004 8C15.9004 12.363 12.363 15.9004 8 15.9004C3.63695 15.9004 0.0996094 12.363 0.0996094 8C0.0996094 3.63695 3.63695 0.0996094 8 0.0996094C12.363 0.0996094 15.9004 8 15.9004 8Z"/></svg>',
  warn: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M6.87 2.6a1.33 1.33 0 0 1 2.26 0l5.34 9.33A1.33 1.33 0 0 1 13.33 14H2.67a1.33 1.33 0 0 1-1.14-2.07Z"/><path d="M8 6v3m0 2.33h.01"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1"/><path d="M14.4999 1.5V5.1H10.8999"/></svg>',
  stop: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M12.5 2.5H3.5C2.94772 2.5 2.5 2.94772 2.5 3.5V12.5C2.5 13.0523 2.94772 13.5 3.5 13.5H12.5C13.0523 13.5 13.5 13.0523 13.5 12.5V3.5C13.5 2.94772 13.0523 2.5 12.5 2.5Z"/></svg>',
  sparkle: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z"/><path d="M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z"/><path d="M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z"/></svg>',
  archive: '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true"><path d="M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z"/><path d="M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5"/><path d="M6.5 9.5H9.5"/></svg>',
  clock: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M8.11646 4.78442V8.03442L10.6165 9.53442"/><path d="M8.11646 13.4094C11.154 13.4094 13.6165 10.947 13.6165 7.90942C13.6165 4.87186 11.154 2.40942 8.11646 2.40942C5.07889 2.40942 2.61646 4.87186 2.61646 7.90942C2.61646 10.947 5.07889 13.4094 8.11646 13.4094Z"/></svg>',
  rightUp: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M11.7256 2.77441C12.5538 2.77469 13.2256 3.44616 13.2256 4.27441V10.1416H12.2256V4.27441C12.2256 3.99844 12.0015 3.77469 11.7256 3.77441H5.7207V2.77441H11.7256Z"/><path d="M2.77441 13.2255L12.3756 3.62427"/></svg>',
  chevron: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4"/></svg>',
  spinner: '<svg class="spinner" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 1.5A6.5 6.5 0 1 1 1.5 8" stroke-linecap="round"/><circle cx="8" cy="8" r="6.5" stroke-opacity=".2"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M2.5 2.5L13.5 13.5"/><path d="M13.5 2.5L2.5 13.5"/></svg>'
};

/* ===== 端点与文案（与 shared/protocol.ts UI_TEXT 对齐）===== */
var API = '/api/session-advanced-search/jobs';
var STEP_TITLES = {
  collecting: '收集与解析会话内容',
  filtering: '机械预筛候选会话',
  analyzing: 'AI 语义分析',
  done: '整理搜索结果'
};
var DEGRADED_TEXT = {
  'llm-missing': 'LLM 分析服务不可用，已按机械匹配排序',
  'credential-missing': '分析模型路由缺少凭证，已按机械匹配排序',
  'timeout': '分析超时，守卫已中断等待，已按机械匹配排序',
  'call-failed': '模型调用失败，已按机械匹配排序',
  'parse-failed': '分析输出解析失败，已按机械匹配排序'
};
var DEGRADED_DETAIL = {
  'credential-missing': '请在 DSH「设置 → 模型」为分析模型路由的 provider 配置凭证（环境变量或凭据库）后重试。'
};

/* ===== 状态 ===== */
var runToken = 0;
var jobId = null;
var pollTimer = null;
var elapsedTimer = null;
var t0 = 0;
var lastQuery = '';
var logs = [];
var detailOpen = false;
var renderedSteps = 0;

function $(sel) { return document.querySelector(sel); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtTime(ms) {
  var d = new Date(ms);
  var now = new Date();
  var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm;
  var md = pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
  if (d.getFullYear() === now.getFullYear()) return md;
  return d.getFullYear() + '-' + md;
}

/* ===== API（同源 fetch；401 提示登录）===== */
async function api(method, path, body) {
  var res = await fetch(path, {
    method: method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    var err = new Error('未登录或会话已过期：请先打开 DSH 主界面登录后再使用本页');
    err.authRequired = true;
    throw err;
  }
  var data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    var msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

/* ===== 面板渲染 ===== */
function stopTimers() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function renderAiPanel() {
  return '<div class="ai-panel" id="aiPanel">'
    + '<div class="ai-panel-head">'
    + '<span class="ai-ic">' + ICONS.sparkle + '</span>'
    + '<span class="ai-ttl">AI 语义分析</span>'
    + '<span class="status-pill run" id="aiStatus"><span class="dot"></span><span id="aiStatusText">准备中 · 0.0s</span></span>'
    + '<span class="spacer"></span>'
    + '<button class="btn-ghost" id="detailToggle">详细信息 ' + ICONS.chevron + '</button>'
    + '<button class="btn-ghost stop" id="stopBtn">' + ICONS.stop + ' 中断</button>'
    + '</div>'
    + '<div class="progress-track"><div class="progress-bar" id="aiProgress"></div></div>'
    + '<div class="ai-steps" id="aiSteps"></div>'
    + '<div class="detail-body" id="detailBody" style="display:none"></div>'
    + '</div>';
}

function stepHTML(icon, l1, l2, cls, at) {
  var time = at ? '<span class="st-time">' + fmtTime(at) + '</span>' : '';
  return '<div class="step ' + (cls || '') + '">'
    + '<span class="st-ic">' + icon + '</span>'
    + '<span class="st-body"><span class="st-l1">' + l1 + '</span>'
    + (l2 ? '<span class="st-l2">' + l2 + '</span>' : '')
    + time + '</span></div>';
}

/* 按 host 推进点顺序重放 progress[]：已推进的 ok，最后一格 run（终态前）。 */
function renderProgress(progress, finished, failed) {
  var steps = $('#aiSteps');
  if (!steps) return;
  var html = '';
  for (var i = 0; i < progress.length; i++) {
    var p = progress[i];
    var title = STEP_TITLES[p.step] || p.step;
    var isLast = i === progress.length - 1;
    var cls = 'ok';
    var icon = ICONS.check;
    if (!finished && !failed && isLast) { cls = 'run'; icon = ICONS.spinner; }
    if (failed && isLast) { cls = 'fail'; icon = ICONS.x; }
    var detail = p.detail ? esc(p.detail) : '';
    if (p.step === 'analyzing' && !finished && !failed && isLast) {
      title = '调用 AI 语义分析<span class="streaming-dots"><i></i><i></i><i></i></span>';
    }
    html += stepHTML(icon, title, detail, cls, p.at);
  }
  steps.innerHTML = html;
  renderedSteps = progress.length;
  var pct = finished ? 100 : Math.min(12 + progress.length * 22, 90);
  var bar = $('#aiProgress');
  if (bar) bar.style.width = pct + '%';
}

function renderLogs() {
  var detail = $('#detailBody');
  if (!detail) return;
  var html = '';
  for (var i = 0; i < logs.length; i++) {
    html += '<div class="log-line ' + (logs[i].cls || '') + '"><span class="ts">T+' + (i * 0.5 + 0.3).toFixed(1) + 's</span>' + esc(logs[i].text) + '</div>';
  }
  detail.innerHTML = html;
}

/* ===== 结果渲染 ===== */
function resultCard(r, i) {
  var degraded = r.degraded === true;
  var pct = Math.round(Math.min(r.confidence, 1) * 100);
  var confCls = degraded ? 'conf mech' : 'conf';
  var confVal = degraded ? (Math.round(r.confidence * 10) / 10).toFixed(1) : pct + '%';
  var reason = degraded
    ? '<span class="rc-reason">' + ICONS.search(1) + '<span>机械匹配 · ' + esc(r.reason) + '</span></span>'
    : '<span class="rc-reason">' + ICONS.sparkle + '<span>' + esc(r.reason) + '</span></span>';
  var ws = r.workspacePath || '(未归组)';
  return '<div class="result-card" data-session="' + esc(r.sessionId) + '" style="animation-delay:' + (i * 60) + 'ms">'
    + '<div class="rc-top"><span class="rc-title">' + esc(r.title || '(无标题会话)') + '</span>'
    + '<span class="' + confCls + '"><span class="c-track"><span class="c-fill" data-pct="' + pct + '"></span></span><span class="c-val">' + confVal + '</span></span></div>'
    + '<div class="rc-meta"><span class="ws-chip">' + ICONS.archive + esc(ws) + '</span>'
    + '<span class="dot-sep"></span><span>' + ICONS.clock + '</span><span>' + fmtTime(r.activityTime) + '</span>'
    + '<span class="dot-sep"></span><span>' + (degraded ? '机械匹配排序' : 'AI 相关性排序') + '</span></div>'
    + reason + '</div>';
}

function resultsHTML(results, degraded) {
  var head = '<div class="results-head"><span class="r-ttl">搜索结果</span><span class="r-cnt">' + results.length + ' 个会话</span>'
    + '<span class="sort-by">' + (degraded ? ICONS.search(1) + '按机械匹配排序' : ICONS.sparkle + '按 AI 相关性排序') + '</span></div>';
  if (results.length === 0) {
    return head + '<div class="rc-empty">未找到匹配的会话</div>';
  }
  return head + results.map(resultCard).join('');
}

function degradeBannerHTML(reason) {
  var text = DEGRADED_TEXT[reason] || 'LLM 分析不可用，已按机械匹配排序';
  var detail = DEGRADED_DETAIL[reason] || '';
  var actions = '';
  if (reason === 'credential-missing') {
    actions = '<div class="db-actions">'
      + '<button class="btn-amber" id="goConfigBtn">' + ICONS.rightUp + ' 前往模型设置配置凭证</button>'
      + '<button class="btn-amber" id="retryAiBtn">' + ICONS.refresh + ' 仅重试 AI 分析</button>'
      + '</div>';
  } else {
    actions = '<div class="db-actions"><button class="btn-amber" id="retryAiBtn">' + ICONS.refresh + ' 重试 AI 分析</button></div>';
  }
  return '<div class="degrade-banner">' + ICONS.warn
    + '<div class="db-body"><div class="db-t">' + esc(text) + '</div>'
    + (detail ? '<div class="db-d">' + esc(detail) + '</div>' : '')
    + actions + '</div></div>';
}

/* ===== 跳回会话：localStorage dsh.sessions.current + '/'（restoreSelection 缝）===== */
/* 嵌入形态（iframe）：同源共享 localStorage；导航目标取父窗口——结果卡点击
   让父级应用整页恢复并打开目标会话。独立页形态 window.self===window.top，
   行为不变。 */
function parentWin() { return (window.self !== window.top) ? window.parent : window; }
function jumpToSession(sessionId) {
  try { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: sessionId })); } catch (e) { /* 存储不可用时仍跳首页 */ }
  parentWin().location.href = '/';
}

/* 嵌入形态关闭缝：父级 client 装配注册 window.__fenixSas.close（同源直调）；
   未注册（异常宿主）退化为父级回首页。独立页形态不变（整页回 '/'）。 */
function closeEmbedded() {
  var w = parentWin();
  var api = w && w.__fenixSas;
  if (api && typeof api.close === 'function') { api.close(); return; }
  w.location.href = '/';
}

/* ===== 主流程 ===== */
async function runSearch(query) {
  var token = ++runToken;
  lastQuery = query;
  stopTimers();
  logs = [];
  detailOpen = false;
  renderedSteps = 0;
  $('#initialState').style.display = 'none';
  $('#runBtn').disabled = true;
  var area = $('#dynamicArea');
  area.innerHTML = renderAiPanel();
  renderLogs();

  try {
    var created = await api('POST', API, { query: query });
    if (token !== runToken) return;
    jobId = created.jobId;
    t0 = performance.now();
    elapsedTimer = setInterval(function () {
      if (token !== runToken) { return; }
      var el = $('#aiStatusText');
      if (el) el.textContent = '分析中 · ' + ((performance.now() - t0) / 1000).toFixed(1) + 's';
    }, 100);
    $('#stopBtn').addEventListener('click', function () { interrupt(token); });
    $('#detailToggle').addEventListener('click', function () {
      detailOpen = !detailOpen;
      var d = $('#detailBody');
      if (d) d.style.display = detailOpen ? 'block' : 'none';
    });

    var pollFailCount = 0;
    var poll = async function () {
      if (token !== runToken) return;
      var status;
      try {
        status = await api('GET', API + '/' + encodeURIComponent(jobId));
        pollFailCount = 0;
      } catch (err) {
        if (token !== runToken) return;
        /* 轮询容错：连续 2 次失败才判失败（与 client 半同策略） */
        pollFailCount++;
        if (pollFailCount <= 2 && !(err && err.authRequired)) return;
        stopTimers();
        finishFail(err);
        return;
      }
      if (token !== runToken || !status) return;
      var progress = Array.isArray(status.progress) ? status.progress : [];
      if (progress.length !== renderedSteps) {
        var newSteps = progress.slice(renderedSteps);
        for (var i = 0; i < newSteps.length; i++) logs.push({ text: newSteps[i].step + (newSteps[i].detail ? ': ' + newSteps[i].detail : '') });
        if (detailOpen) renderLogs();
      }
      var phase = status.phase;
      if (phase === 'done') {
        stopTimers();
        finishDone(status, token);
      } else if (phase === 'error') {
        stopTimers();
        finishFail(new Error(status.message || '搜索失败'));
      } else if (phase === 'cancelled') {
        stopTimers();
        finishCancelled();
      } else {
        renderProgress(progress, false, false);
      }
    };
    pollTimer = setInterval(poll, 700);
    await poll();
  } catch (err) {
    if (token !== runToken) return;
    stopTimers();
    finishFail(err);
  }
}

function finishDone(status, token) {
  if (token !== runToken) return;
  var degraded = status.degraded === true;
  var pill = $('#aiStatus');
  if (pill) pill.className = 'status-pill ' + (degraded ? 'fail' : 'done');
  var pillText = $('#aiStatusText');
  if (pillText) pillText.textContent = degraded ? '机械搜索 · 已完成' : 'AI 分析完成 · ' + ((performance.now() - t0) / 1000).toFixed(1) + 's';
  renderProgress(Array.isArray(status.progress) ? status.progress : [], true, false);
  var stop = $('#stopBtn');
  if (stop) stop.style.display = 'none';
  var area = $('#dynamicArea');
  var progress = Array.isArray(status.progress) ? status.progress : [];
  var doneDetail = '';
  for (var i = progress.length - 1; i >= 0; i--) { if (progress[i].step === 'done') { doneDetail = progress[i].detail || ''; break; } }
  if (degraded) logs.push({ text: 'degraded: ' + (status.degradedReason || 'unknown') + (doneDetail ? ' · ' + doneDetail : ''), cls: 'warn' });
  if (detailOpen) renderLogs();
  area.insertAdjacentHTML('beforeend', (degraded ? degradeBannerHTML(status.degradedReason) : '') + '<div id="resultsWrap">' + resultsHTML(Array.isArray(status.results) ? status.results : [], degraded) + '</div>');
  animateBars();
  $('#runBtn').disabled = false;
  bindAreaActions();
}

function finishFail(err) {
  var pill = $('#aiStatus');
  if (pill) pill.className = 'status-pill fail';
  var pillText = $('#aiStatusText');
  if (pillText) pillText.textContent = err && err.authRequired ? '未登录' : '失败';
  markAllStepsFailed();
  var stop = $('#stopBtn');
  if (stop) stop.style.display = 'none';
  var area = $('#dynamicArea');
  var msg = err && err.message ? err.message : '搜索失败';
  var html = '<div class="msg-banner">' + esc('搜索失败') + '：' + esc(msg);
  if (err && err.authRequired) html += ' <button class="btn-amber" id="goLoginBtn" style="margin-left:8px">' + ICONS.rightUp + ' 打开 DSH 登录</button>';
  html += '</div>';
  area.insertAdjacentHTML('beforeend', html);
  var go = $('#goLoginBtn');
  if (go) go.addEventListener('click', function () { window.location.href = '/'; });
  $('#runBtn').disabled = false;
}

function finishCancelled() {
  var pill = $('#aiStatus');
  if (pill) pill.className = 'status-pill fail';
  var pillText = $('#aiStatusText');
  if (pillText) pillText.textContent = '已中断';
  markAllStepsFailed();
  var stop = $('#stopBtn');
  if (stop) stop.style.display = 'none';
  $('#runBtn').disabled = false;
}

/* 失败/中断收尾：把在途步骤（最后一格 run）置为 fail。 */
function markAllStepsFailed() {
  var runSteps = document.querySelectorAll('#aiSteps .step.run');
  for (var i = 0; i < runSteps.length; i++) {
    runSteps[i].className = 'step fail';
    var ic = runSteps[i].querySelector('.st-ic');
    if (ic) ic.innerHTML = ICONS.x;
    var l1 = runSteps[i].querySelector('.st-l1');
    if (l1 && l1.textContent.indexOf('调用 AI') === 0) l1.textContent = 'AI 分析已中断';
  }
}

function animateBars() {
  var fills = document.querySelectorAll('#dynamicArea .c-fill');
  for (var i = 0; i < fills.length; i++) {
    (function (el) {
      requestAnimationFrame(function () { el.style.width = el.getAttribute('data-pct') + '%'; });
    })(fills[i]);
  }
}

function bindAreaActions() {
  var retry = $('#retryAiBtn');
  if (retry) retry.addEventListener('click', function () { if (lastQuery) runSearch(lastQuery); });
  var goCfg = $('#goConfigBtn');
  if (goCfg) goCfg.addEventListener('click', function () { window.location.href = '/'; });
  var cards = document.querySelectorAll('#resultsWrap .result-card');
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      card.addEventListener('click', function () { jumpToSession(card.getAttribute('data-session')); });
    })(cards[i]);
  }
}

async function interrupt(token) {
  runToken++;
  stopTimers();
  var id = jobId;
  jobId = null;
  if (id) {
    try { await api('DELETE', API + '/' + encodeURIComponent(id)); } catch (e) { /* 中断尽力而为 */ }
  }
  finishCancelled();
}

/* ===== 装配 ===== */
function submit() {
  var q = $('#queryInput').value.trim();
  if (!q) { $('#queryInput').focus(); return; }
  runSearch(q);
}
$('#runBtn').addEventListener('click', submit);
$('#queryInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
$('#backBtn').addEventListener('click', function () { closeEmbedded(); });
/* 嵌入形态：iframe 内 Escape 关闭视图（父层 keydown 不跨 iframe 冒泡）。 */
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && window.self !== window.top) closeEmbedded(); });
$('#queryInput').focus();
</script>
</body>
</html>
`
}
