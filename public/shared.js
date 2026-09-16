export const $ = selector => document.querySelector(selector);
export function element(tag, className = '', text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
export async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error('The server is unavailable. Please try again.'); }
  if (!response.ok) { const error = new Error(data.error || 'Could not complete the request.'); error.status = response.status; throw error; }
  return data;
}
export function timeLabel(start, timeZone, options = {}) {
  return new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit', ...options }).format(new Date(start));
}
export function fullTime(start, timeZone) {
  return timeLabel(start, timeZone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZoneName: 'short' });
}
export function liveUpdates(path, refresh) {
  const label = $('#sync-label');
  let source, socket, reconnect, heartbeat, stopped = false, connected = false, running = false, pending = false;
  let lastPong = 0, lastRefresh = 0, mode = 'websocket', backoff = 1000;
  const update = async () => {
    if (stopped || document.hidden) return;
    if (running) { pending = true; return; }
    running = true; lastRefresh = Date.now();
    try { await refresh(); } finally {
      running = false;
      if (pending) { pending = false; void update(); }
    }
  };
  function ready() {
    connected = true; backoff = 1000;
    if (label) label.textContent = 'Live updates on';
    void update();
  }
  function connect() {
    if (stopped) return;
    if (mode === 'sse') {
      source = new EventSource(path);
      source.addEventListener('ready', ready);
      source.addEventListener('change', () => void update());
      source.onerror = () => { connected = false; if (label) label.textContent = 'Reconnecting…'; };
      return;
    }
    const url = new URL(path, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url); lastPong = Date.now();
    socket.onmessage = event => {
      if (event.data === 'pong') { lastPong = Date.now(); return; }
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') ready();
        if (message.type === 'change') void update();
      } catch { /* Ignore malformed notifications. Data is fetched from the API. */ }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      connected = false; clearInterval(heartbeat);
      if (stopped) return;
      if (label) label.textContent = 'Reconnecting…';
      reconnect = setTimeout(connect, backoff + Math.random() * 500);
      backoff = Math.min(backoff * 2, 30000);
    };
    heartbeat = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPong > 65000) { socket.close(); return; }
      socket.send('ping');
    }, 25000);
  }
  // Detect the optional local Node/SSE server; Cloudflare uses hibernating WebSockets.
  const detect = () => api('/api/live').then(data => { mode = data.transport; connect(); }).catch(() => {
    if (!stopped) reconnect = setTimeout(detect, 3000);
  });
  void detect();
  // Refresh every 30 seconds only while disconnected, plus a five-minute reconciliation.
  const timer = setInterval(() => { if (!connected || Date.now() - lastRefresh > 300000) void update(); }, 30000);
  const focus = () => { if (!document.hidden) void update(); };
  document.addEventListener('visibilitychange', focus);
  window.addEventListener('focus', focus);
  return () => {
    stopped = true; source?.close(); socket?.close();
    clearTimeout(reconnect); clearInterval(heartbeat); clearInterval(timer);
    document.removeEventListener('visibilitychange', focus); window.removeEventListener('focus', focus);
  };
}
