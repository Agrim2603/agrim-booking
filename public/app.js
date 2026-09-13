import { $, api, element, timeLabel, fullTime, liveUpdates } from './shared.js';
let slots = [], selected = '', page = 0, busy = false, refreshing = false;
let duration = 60;
let zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';
let bookingToken = location.pathname === '/booking' ? location.hash.slice(1) : '';
const zoneOptions = [...new Set([zone, 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Pacific/Auckland', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'])];
for (const value of zoneOptions) { const option = element('option', '', value.replaceAll('_', ' ')); option.value = value; $('#timezone').append(option); }
$('#timezone').value = zone;
$('#year').textContent = new Date().getFullYear();

function groups() {
  const groups = new Map();
  for (const start of slots) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start));
    if (!groups.has(key)) groups.set(key, { start, slots: [] });
    groups.get(key).slots.push(start);
  }
  return [...groups.values()];
}
function render() {
  const days = groups();
  page = Math.min(page, Math.max(0, Math.ceil(days.length / 5) - 1));
  const visible = days.slice(page * 5, page * 5 + 5);
  $('#prev-dates').disabled = page === 0;
  $('#next-dates').disabled = (page + 1) * 5 >= days.length;
  const shortDate = start => new Intl.DateTimeFormat('en-AU', { timeZone: zone, day: 'numeric', month: 'short' }).format(new Date(start));
  $('#date-range').textContent = visible.length ? `${shortDate(visible[0].start)} – ${shortDate(visible.at(-1).start)}` : 'Upcoming availability';
  const grid = $('#day-grid');
  const previousFocus = document.activeElement?.dataset?.start;
  grid.replaceChildren(); grid.hidden = !visible.length;
  $('#availability-message').hidden = visible.length > 0;
  if (!visible.length) $('#availability-message').textContent = 'There are no available times right now. Please check back soon.';
  for (const day of visible) {
    const col = element('div', 'day-col');
    const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'short' }).format(new Date(day.start));
    col.append(element('div', 'day-label', weekday), element('div', 'day-date', shortDate(day.start)));
    const list = element('div', 'slot-list');
    for (const start of day.slots) {
      const button = element('button', `slot${selected === start ? ' selected' : ''}`, timeLabel(start, zone));
      button.dataset.start = start; button.setAttribute('aria-pressed', String(selected === start));
      button.setAttribute('aria-label', fullTime(start, zone));
      button.addEventListener('click', () => { selected = start; render(); }); list.append(button);
    }
    col.append(list); grid.append(col);
  }
  if (previousFocus) [...grid.querySelectorAll('button')].find(x => x.dataset.start === previousFocus)?.focus({ preventScroll: true });
  $('#selection-label').textContent = selected ? fullTime(selected, zone) : 'Choose a time above to continue';
  $('#continue').disabled = !selected;
}
async function refreshAvailability() {
  if (refreshing) return; refreshing = true;
  try {
    const data = await api('/api/slots');
    document.querySelectorAll('[data-host]').forEach(node => { node.textContent = data.hostName; });
    document.title = `Book a consultation | ${data.hostName}`;
    slots = data.slots; duration = data.duration;
    $('#duration-label').textContent = `${duration} minutes`;
    if (selected && !slots.includes(selected)) {
      selected = '';
      if ($('#booking-dialog').open && !busy) { $('#form-error').textContent = 'This time was just taken. Close this form and choose another slot.'; $('#submit-booking').disabled = true; }
    }
    render();
  } catch (error) {
    $('#availability-message').textContent = `${error.message} Refresh the page to retry.`;
    $('#availability-message').hidden = false;
  } finally { refreshing = false; }
}

async function refreshStatus() {
  if (!bookingToken) { $('#status-title').textContent = 'Confirmation link needed.'; $('#status-error').textContent = 'Open the full private link you received after submitting your booking, or return to availability.'; return; }
  try {
    const data = await api('/api/status', { method: 'POST', body: JSON.stringify({ token: bookingToken }) });
    $('#status-title').textContent = { pending: 'Request received.', accepted: 'You’re booked in.', declined: 'This booking was declined.' }[data.status];
    $('#status-description').textContent = { pending: 'Your time is held while the host reviews your request. This page updates when a decision is made.', accepted: data.zoomUrl ? 'Your consultation is confirmed. Use the link below when it’s time to meet.' : 'Your consultation is confirmed. Your Zoom link will appear here when the host adds it.', declined: 'This time has been released. You can return to availability and request another appointment.' }[data.status];
    $('#status-time').textContent = `${fullTime(data.start, zone)} · ${data.duration} minutes`;
    $('#zoom-join').hidden = !data.zoomUrl;
    if (data.zoomUrl) $('#zoom-join').href = data.zoomUrl;
    $('#status-error').textContent = '';
  } catch (error) { $('#status-error').textContent = error.message; }
}
function showConfirmation() {
  $('#booking-layout').hidden = true; $('#confirmation').hidden = false;
  void refreshStatus();
}
$('#prev-dates').addEventListener('click', () => { page--; render(); });
$('#next-dates').addEventListener('click', () => { page++; render(); });
$('#timezone').addEventListener('change', event => { zone = event.target.value; page = 0; render(); });
$('#continue').addEventListener('click', () => {
  if (!selected) return;
  $('#form-error').textContent = ''; $('#submit-booking').disabled = false;
  $('#dialog-time').textContent = `${fullTime(selected, zone)} · ${duration} minutes`;
  $('#booking-dialog').showModal();
});
$('#close-dialog').addEventListener('click', () => { if (!busy) $('#booking-dialog').close(); });
$('#booking-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('#booking-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !selected) return;
  busy = true; $('#submit-booking').disabled = true; $('#submit-booking').textContent = 'Sending request…';
  const data = Object.fromEntries(new FormData(event.target)); data.start = selected;
  try {
    const result = await api('/api/bookings', { method: 'POST', body: JSON.stringify(data) });
    bookingToken = result.token; history.pushState(null, '', `/booking#${bookingToken}`);
    $('#booking-dialog').close(); showConfirmation();
  } catch (error) { $('#form-error').textContent = error.message; if (error.status === 409) { selected = ''; void refreshAvailability(); } }
  finally { busy = false; $('#submit-booking').disabled = !selected; $('#submit-booking').textContent = 'Send booking request →'; }
});
$('#copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('#copy-link').textContent = 'Link copied'; }
  catch { $('#status-hint').textContent = 'Copy the full address from your browser’s address bar to save this private link.'; }
});
window.addEventListener('popstate', () => location.reload());
if (location.pathname === '/booking') showConfirmation(); else void refreshAvailability();
liveUpdates('/api/events', () => bookingToken ? refreshStatus() : refreshAvailability());
