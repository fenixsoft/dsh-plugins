// Log all WebSocket mux frames into window.__wsFrames for later inspection.
// Known deviations from the native constructor (debug probe only):
// - Derived classes (class X extends WebSocket) get an OrigWS instance back
//   from super(), so `instanceof X` checks fail; new.target is only used to
//   reject non-new calls, not forwarded to a subclass construct.
(() => {
  // Ring-buffer cap: keep only the most recent MAX_FRAMES entries in
  // window.__wsFrames so long-lived debug pages don't grow without bound.
  const MAX_FRAMES = 500;
  window.__wsFrames = [];
  const pushFrame = (frame) => {
    window.__wsFrames.push(frame);
    if (window.__wsFrames.length > MAX_FRAMES) window.__wsFrames.shift();
  };
  const OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    if (!new.target) throw new TypeError("Constructor WebSocket requires 'new'");
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    window.__wsURL = url;
    const origSend = ws.send.bind(ws);
    ws.send = (data) => {
      try { pushFrame({ dir: 'out', t: Date.now(), data: typeof data === 'string' ? data.slice(0, 2000) : '<binary>' }); } catch {}
      return origSend(data);
    };
    ws.addEventListener('message', (ev) => {
      try { pushFrame({ dir: 'in', t: Date.now(), data: typeof ev.data === 'string' ? ev.data.slice(0, 2000) : '<binary>' }); } catch {}
    });
    return ws;
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  Object.defineProperty(window.WebSocket, 'prototype', { value: OrigWS.prototype });
})();
