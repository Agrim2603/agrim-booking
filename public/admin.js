import { $, api, element, fullTime, liveUpdates } from './shared.js';
let csrf = '', settings = null, bookings = [], stopLive = null, loading = false;
const cards = new Map(), saving = new Set();
let pendingDecline = null;
const request = (path, method, data) => api(path, { method, headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(data) });

function showError(message) { $('#dashboard-error').hidden = !message; $('#dashboard-error').textContent = message; }
function signedOut() {
  csrf = ''; stopLive?.(); stopLive = null; $('#workspace').hidden = true; $('#login-panel').hidden = false;
  $('#bookings-list').replaceChildren(); cards.clear(); bookings = [];
  if ($('#settings-dialog').open) $('#settings-dialog').close();
  if ($('#decline-dialog').open) $('#decline-dialog').close();
}
async function signedIn(identity) {
  csrf = identity.csrf; $('#login-panel').hidden = true; $('#workspace').hidden = false;
  $('#zoom-status').textContent = identity.zoomEnabled ? 'Zoom is connected. Accepting a request creates its meeting link if one has not been added.' : 'Add a Zoom join link to each accepted booking. It appears on the client’s private confirmation page. Automatic email delivery is not connected.';
  settings = await api('/api/admin/settings');
  await refresh(); stopLive?.(); stopLive = liveUpdates('/api/admin/events', refresh);
}
async function refresh() {
  if (loading) return; loading = true;
  try { const data = await api('/api/admin/bookings'); bookings = data.bookings; render(); }
  catch (error) { if (error.status === 401) signedOut(); else showError(error.message); }
  finally { loading = false; }
}
function button(text, className, action) {
  const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function makeCard(row) {
  const article = element('article', 'booking-row');
  const info = element('div', 'booking-info');
  const heading = element('div', 'booking-card-heading');
  const name = element('h2'), status = element('span', 'status'); heading.append(name, status);
  const time = element('p', 'meeting-time'), email = element('a'), topic = element('p', 'meeting-topic');
  info.append(heading, time, email, topic);
  const form = element('div', 'booking-actions');
  const noteLabel = element('label', 'field-label', 'Private meeting notes');
  const note = element('textarea'); note.id = `note-${row.id}`; note.maxLength = 10000; note.placeholder = 'Only you can view these notes'; noteLabel.htmlFor = note.id;
  const urlLabel = element('label', 'field-label', 'Zoom meeting link');
  const url = element('input'); url.id = `url-${row.id}`; url.type = 'url'; url.maxLength = 1000; url.placeholder = 'https://zoom.us/j/…'; urlLabel.htmlFor = url.id;
  const hint = element('p', 'hint'), result = element('p', 'card-feedback'); result.setAttribute('role', 'status');
  const actions = element('div', 'action-line');
  const card = { article, name, status, time, email, topic, note, url, hint, result, actions, row, dirty: false, baseVersion: row.version };
  note.addEventListener('input', () => { card.dirty = true; result.textContent = 'Unsaved changes'; });
  url.addEventListener('input', () => { card.dirty = true; result.textContent = 'Unsaved changes'; });
  const save = button('Save details', 'secondary-btn small-btn', () => saveCard(card));
  const accept = button('Accept booking', 'primary-btn small-btn', () => saveCard(card, 'accepted'));
  const decline = button('Decline', 'text-button', () => { pendingDecline = card; $('#decline-dialog').showModal(); });
  const discard = button('Reload details', 'text-button', () => { card.dirty = false; updateCard(card, card.row); result.textContent = 'Latest saved details loaded.'; });
  const emailDetails = element('a', 'text-link', 'Email meeting details');
  Object.assign(card, { save, accept, decline, discard, emailDetails });
  actions.append(save, accept, decline, discard, emailDetails);
  form.append(noteLabel, note, urlLabel, url, hint, actions, result); article.append(info, form);
  return card;
}
function updateCard(card, row) {
  card.row = row;
  card.name.textContent = row.name;
  card.status.className = `status ${row.status}`;
  card.status.textContent = row.status === 'confirming' ? 'Preparing Zoom' : row.status;
  card.time.textContent = `${fullTime(row.start, settings.timeZone)} · ${row.duration} minutes`;
  card.email.textContent = row.email; card.email.href = `mailto:${encodeURIComponent(row.email)}`;
  card.topic.textContent = row.topic;
  if (!card.dirty) { card.note.value = row.privateNote; card.url.value = row.zoomUrl; card.baseVersion = row.version; }
  else if (card.baseVersion !== row.version) card.result.textContent = 'This booking changed elsewhere. Copy your draft, then reload details before saving.';
  card.hint.textContent = row.zoomState === 'check_required' || row.status === 'confirming' ? 'Check Zoom for a created meeting. If creation was interrupted, paste its join link and accept the booking.' : 'Clients can see the Zoom link after acceptance. Your notes stay private.';
  card.accept.hidden = !['pending', 'confirming'].includes(row.status);
  card.decline.hidden = row.status === 'declined';
  card.decline.textContent = row.status === 'accepted' ? 'Cancel booking' : 'Decline';
  card.emailDetails.hidden = row.status !== 'accepted';
  card.emailDetails.href = `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent('Your consultation is confirmed')}&body=${encodeURIComponent(`Hi ${row.name},\n\nYour consultation is confirmed for ${fullTime(row.start, settings.timeZone)}.\nDuration: ${row.duration} minutes.\n${row.zoomUrl ? `\nJoin on Zoom: ${row.zoomUrl}\n` : '\nThe Zoom meeting link will follow.\n'}\nRegards,\n${settings.hostName}`)}`;
  for (const control of [card.save, card.accept, card.decline, card.discard, card.note, card.url]) control.disabled = saving.has(row.id);
}
function render() {
  const filter = $('#booking-filter').value;
  const visible = bookings.filter(row => filter === 'all' || filter === 'active' && row.status !== 'declined' && Date.parse(row.start) + row.duration * 60000 > Date.now() || filter === 'pending' && ['pending', 'confirming'].includes(row.status) || row.status === filter);
  visible.sort((a, b) => a.start.localeCompare(b.start));
  const list = $('#bookings-list');
  const ids = new Set(visible.map(row => row.id));
  for (const [id, card] of cards) if (!ids.has(id)) card.article.remove();
  list.querySelector('.dash-empty')?.remove();
  if (!visible.length) list.append(element('p', 'dash-empty', filter === 'active' ? 'No active requests yet. Share your booking page to start receiving consultations.' : 'There are no bookings in this view.'));
  visible.forEach((row, index) => {
    let card = cards.get(row.id);
    if (!card) { card = makeCard(row); cards.set(row.id, card); }
    if (!saving.has(row.id)) updateCard(card, row);
    if (list.children[index] !== card.article) list.insertBefore(card.article, list.children[index] || null);
  });
}
async function saveCard(card, status) {
  const id = card.row.id; if (saving.has(id)) return;
  saving.add(id); updateCard(card, card.row); card.result.textContent = status === 'accepted' ? 'Confirming booking…' : 'Saving…'; showError('');
  try {
    const data = await request(`/api/admin/bookings/${id}`, 'PATCH', { version: card.baseVersion, privateNote: card.note.value, zoomUrl: card.url.value.trim(), ...(status ? { status } : {}) });
    card.dirty = false; card.row = data.booking;
    bookings = bookings.map(row => row.id === id ? data.booking : row);
    card.result.textContent = 'Saved.';
  } catch (error) {
    if (error.status === 401) signedOut(); else card.result.textContent = error.message;
  } finally { saving.delete(id); updateCard(card, card.row); await refresh(); }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-submit').disabled = true; $('#login-error').textContent = '';
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: new FormData(event.target).get('password') }) });
    event.target.reset(); await signedIn(data);
  } catch (error) { $('#login-error').textContent = error.message; }
  finally { $('#login-submit').disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await request('/api/admin/logout', 'POST', {}); signedOut(); } catch (error) { showError(error.message); } });
$('#booking-filter').addEventListener('change', render);
$('#decline-cancel').addEventListener('click', () => $('#decline-dialog').close());
$('#decline-confirm').addEventListener('click', () => { $('#decline-dialog').close(); if (pendingDecline) void saveCard(pendingDecline, 'declined'); pendingDecline = null; });
$('#open-settings').addEventListener('click', async () => {
  try {
    settings = await api('/api/admin/settings'); const form = $('#settings-form');
    for (const key of ['hostName', 'timeZone', 'duration', 'leadHours', 'horizonDays']) form.elements[key].value = settings[key];
    form.elements.times.value = settings.times.join(', '); form.elements.excludedDates.value = settings.excludedDates.join(', ');
    form.querySelectorAll('[name=weekday]').forEach(input => { input.checked = settings.weekdays.includes(Number(input.value)); });
    $('#settings-error').textContent = ''; $('#settings-dialog').showModal();
  } catch (error) { showError(error.message); }
});
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#save-settings').disabled = true;
  const data = Object.fromEntries(new FormData(event.target));
  data.weekdays = [...event.target.querySelectorAll('[name=weekday]:checked')].map(node => Number(node.value)); delete data.weekday;
  for (const key of ['times', 'excludedDates']) data[key] = data[key].split(/[\s,]+/).filter(Boolean);
  for (const key of ['duration', 'leadHours', 'horizonDays']) data[key] = Number(data[key]);
  data.version = settings.version;
  try { settings = await request('/api/admin/settings', 'PUT', data); $('#settings-dialog').close(); render(); }
  catch (error) { $('#settings-error').textContent = error.message; }
  finally { $('#save-settings').disabled = false; }
});
try { const data = await api('/api/admin/session'); await signedIn(data); }
catch (error) { if (error.status !== 401) $('#login-error').textContent = error.message; }
