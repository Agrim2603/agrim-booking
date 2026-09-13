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
  const source = new EventSource(path);
  const label = $('#sync-label');
  const update = () => { if (!document.hidden) void refresh(); };
  source.addEventListener('ready', () => { if (label) label.textContent = 'Live updates on'; update(); });
  source.addEventListener('change', update);
  source.onerror = () => { if (label) label.textContent = 'Reconnecting…'; };
  // A fallback handles proxies that buffer event streams and reconnect gaps.
  const timer = setInterval(update, 15000);
  const focus = () => update();
  document.addEventListener('visibilitychange', focus);
  window.addEventListener('focus', focus);
  return () => { source.close(); clearInterval(timer); document.removeEventListener('visibilitychange', focus); window.removeEventListener('focus', focus); };
}
