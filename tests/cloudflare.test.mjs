import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';

const password = 'test-password-only-123456789';
async function harness(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'free-booking-'));
  const config = { name: 'booking-test', modules: true, scriptPath: '.worker-build/index.js',
    compatibilityDate: '2026-09-13', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { BOOKING_ROOM: { className: 'BookingRoom', useSQLite: true } },
    bindings: { ADMIN_PASSWORD: password, ...options.bindings },
    ...options.runtime };
  const runtimeOptions = () => ({ ...convertV4MiniflareOptions(config), resourcePersistencePath: directory });
  let mf = new Miniflare(runtimeOptions());
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await mf.dispatchFetch('https://booking.test' + path, { method,
      headers: { Origin: 'https://booking.test', 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  const login = async () => {
    const r = await request('/api/admin/login', 'POST', { password: config.bindings.ADMIN_PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.match(r.headers.get('set-cookie'), /Secure/);
    return { Cookie: r.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': r.data.csrf };
  };
  const reserve = (start, suffix = 'one') => request('/api/bookings', 'POST', { start, name: 'Test Client', email: `${suffix}@example.com`, topic: 'Private discussion' });
  return { request, login, reserve, fetch: (...args) => mf.dispatchFetch(...args),
    async restart(bindings = {}) { await mf.dispose(); Object.assign(config.bindings, bindings); mf = new Miniflare(runtimeOptions()); } };
}

test('free backend reserves once, protects notes, persists bookings and rotates credentials', async t => {
  const h = await harness(t);
  const { data } = await h.request('/api/slots');
  assert.equal(data.duration, 30); assert.ok(data.slots.length);
  const results = await Promise.all([h.reserve(data.slots[0]), h.reserve(data.slots[0], 'two')]);
  assert.deepEqual(results.map(x => x.status).sort(), [201,409]);
  const token = results.find(x => x.status === 201).data.token;
  assert.equal((await h.request('/api/admin/bookings')).status, 401);
  assert.equal((await h.request('/api/admin/export')).status, 401);
  const auth = await h.login();
  let row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  const patch = { version: row.version, privateNote: 'OWNER-ONLY-SECRET', status: 'accepted', zoomUrl: 'https://zoom.us/j/123456789' };
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, { Cookie: auth.Cookie })).status, 403);
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, { ...auth, Origin: 'https://evil.test' })).status, 403);
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, auth)).status, 200);
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, auth)).status, 409);
  const status = (await h.request('/api/status', 'POST', { token })).data;
  assert.equal(status.status, 'accepted'); assert.equal(status.zoomUrl, patch.zoomUrl);
  for (const secret of ['OWNER-ONLY-SECRET', 'example.com', 'Test Client', 'Private discussion']) assert.ok(!JSON.stringify(status).includes(secret));
  assert.ok(!(await h.request('/api/slots')).data.slots.includes(row.start));
  await h.restart();
  row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  assert.equal(row.privateNote, patch.privateNote);
  const backup = (await h.request('/api/admin/export', 'GET', undefined, auth)).data;
  assert.equal(backup.bookings[0].private_note, patch.privateNote);
  assert.ok(!JSON.stringify(backup).includes(password));
  await h.restart({ ADMIN_PASSWORD: 'a-new-unique-password-for-tests-123' });
  assert.equal((await h.request('/api/admin/bookings', 'GET', undefined, auth)).status, 401);
  const fresh = await h.login();
  assert.equal((await h.request('/api/admin/logout', 'POST', {}, fresh)).status, 200);
  assert.equal((await h.request('/api/admin/bookings', 'GET', undefined, fresh)).status, 401);
});

test('free backend blocks overlapping durations and detects stale availability edits', async t => {
  const h = await harness(t), auth = await h.login();
  const settings = (await h.request('/api/admin/settings', 'GET', undefined, auth)).data;
  const changed = { ...settings, times: ['09:00','09:30','10:00'], duration: 60 };
  assert.equal((await h.request('/api/admin/settings', 'PUT', changed, auth)).status, 200);
  assert.equal((await h.request('/api/admin/settings', 'PUT', settings, auth)).status, 409);
  const slots = (await h.request('/api/slots')).data.slots;
  assert.equal((await h.reserve(slots[0])).status, 201);
  assert.equal((await h.reserve(new Date(Date.parse(slots[0]) + 1800000).toISOString(), 'two')).status, 409);
  const row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, status: 'declined' }, auth)).status, 200);
  assert.equal((await h.reserve(slots[0], 'replacement')).status, 201);
});

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket message timed out')), 4000);
    socket.addEventListener('message', event => { clearTimeout(timeout); resolve(event.data); }, { once: true });
  });
}
test('free WebSockets send immediate changes, keep notes private and require admin login', async t => {
  const h = await harness(t), auth = await h.login();
  const upgrade = { Upgrade: 'websocket', Origin: 'https://booking.test' };
  assert.equal((await h.fetch('https://booking.test/api/admin/events', { headers: upgrade })).status, 401);
  assert.equal((await h.fetch('https://booking.test/api/events', { headers: { ...upgrade, Origin: 'https://evil.test' } })).status, 403);
  const publicResponse = await h.fetch('https://booking.test/api/events', { headers: upgrade });
  const adminResponse = await h.fetch('https://booking.test/api/admin/events', { headers: { ...upgrade, Cookie: auth.Cookie } });
  assert.equal(publicResponse.status, 101); assert.equal(adminResponse.status, 101);
  const publicSocket = publicResponse.webSocket, adminSocket = adminResponse.webSocket;
  t.after(() => { publicSocket.close(); adminSocket.close(); });
  let p = nextMessage(publicSocket), a = nextMessage(adminSocket);
  publicSocket.accept(); adminSocket.accept();
  assert.deepEqual(JSON.parse(await p), { type: 'ready' });
  assert.deepEqual(JSON.parse(await a), { type: 'ready' });
  p = nextMessage(publicSocket); publicSocket.send('ping'); assert.equal(await p, 'pong');
  const slot = (await h.request('/api/slots')).data.slots[0];
  p = nextMessage(publicSocket); a = nextMessage(adminSocket);
  await h.reserve(slot);
  assert.deepEqual(JSON.parse(await p), { type: 'change' });
  assert.deepEqual(JSON.parse(await a), { type: 'change' });
  const publicMessages = []; publicSocket.addEventListener('message', e => publicMessages.push(e.data));
  const row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  a = nextMessage(adminSocket);
  await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, privateNote: 'Never public' }, auth);
  assert.deepEqual(JSON.parse(await a), { type: 'change' });
  assert.deepEqual(publicMessages, []);
});

test('free login throttling persists after a runtime restart', async t => {
  const h = await harness(t);
  for (let i = 0; i < 10; i++) assert.equal((await h.request('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
  await h.restart();
  assert.equal((await h.request('/api/admin/login', 'POST', { password })).status, 429);
});

test('free deployment refuses bookings until a strong runtime secret is supplied', async t => {
  const h = await harness(t, { bindings: { ADMIN_PASSWORD: '' } });
  assert.equal((await h.request('/api/slots')).status, 503);
  assert.equal((await h.request('/api/bookings', 'POST', {})).status, 503);
  assert.equal((await h.request('/healthz')).status, 503);
});

test('free backend creates one Zoom meeting and holds concurrent admin edits', async t => {
  let calls = 0, release, started;
  const began = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const h = await harness(t, { bindings: { ZOOM_ACCOUNT_ID: 'fake-account', ZOOM_CLIENT_ID: 'fake-client', ZOOM_CLIENT_SECRET: 'fake-secret', ZOOM_HOST_USER_ID: 'fake-host' }, runtime: {
    outboundService: async request => {
      if (new URL(request.url).pathname === '/oauth/token') return new MFResponse(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }));
      assert.equal(request.url, 'https://api.zoom.us/v2/users/fake-host/meetings');
      calls++; started(); await wait;
      return new MFResponse(JSON.stringify({ id: '123', join_url: 'https://zoom.us/j/123', start_url: 'https://host-only.example' }));
    },
  } });
  const auth = await h.login();
  await h.reserve((await h.request('/api/slots')).data.slots[0]);
  const row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  const accepted = h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, status: 'accepted' }, auth);
  try {
    await Promise.race([began, accepted.then(value => { throw new Error(JSON.stringify(value)); })]);
    assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version + 1, status: 'declined' }, auth)).status, 409);
  } finally { release(); }
  const result = await accepted;
  assert.equal(result.status, 200); assert.equal(calls, 1);
  assert.equal(result.data.booking.zoomUrl, 'https://zoom.us/j/123');
  assert.ok(!JSON.stringify(result.data).includes('host-only'));
});
