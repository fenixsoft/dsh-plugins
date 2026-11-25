// Log all WebSocket mux frames into window.__wsFrames for later inspection.
(() => {
  window.__wsFrames = [];
  const OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    window.__wsURL = url;
    const origSend = ws.send.bind(ws);
    ws.send = (data) => {
      try { window.__wsFrames.push({ dir: 'out', t: Date.now(), data: typeof data === 'string' ? data.slice(0, 2000) : '<binary>' }); } catch {}
      return origSend(data);
    };
    ws.addEventListener('message', (ev) => {
      try { window.__wsFrames.push({ dir: 'in', t: Date.now(), data: typeof ev.data === 'string' ? ev.data.slice(0, 2000) : '<binary>' }); } catch {}
    });
    return ws;
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  Object.defineProperty(window.WebSocket, 'prototype', { value: OrigWS.prototype });
})();
