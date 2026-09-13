import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { defaults, generateSlots, localToUTC } from '../server/schedule.mjs';
import { loadConfig } from '../server/config.mjs';
import { ZoomError, zoomClient } from '../server/zoom.mjs';

async function harness(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'booking-test-'));
  const config = { dataDir: directory, password: 'test-password-only-123456789', production: false,
    origin: 'http://127.0.0.1', trustProxy: false, zoom: {}, zoomEnabled: false, ...options.config };
  let app = await createApp(config, options.dependencies);
  async function listen() {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    config.origin = `http://127.0.0.1:${app.server.address().port}`;
  }
  await listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(config.origin + path, { method, headers: { Origin: config.origin, 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  const login = async () => {
    const response = await request('/api/admin/login', 'POST', { password: config.password });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    return { Cookie: cookie.split(';')[0], 'X-CSRF-Token': response.data.csrf };
  };
  const reserve = async (start, suffix = 'one') => request('/api/bookings', 'POST', { start, name: 'Test Client', email: `${suffix}@example.com`, topic: 'Consultation test' });
  return { config, request, login, reserve, async restart() { await app.close(); app = await createApp(config, options.dependencies); await listen(); } };
}

test('one concurrent booking wins; public data stays private; changes persist', async t => {
  const h = await harness(t);
  const { data } = await h.request('/api/slots');
  assert.ok(data.slots.length > 0);
  const attempts = await Promise.all([h.reserve(data.slots[0], 'one'), h.reserve(data.slots[0], 'two')]);
  assert.deepEqual(attempts.map(x => x.status).sort(), [201, 409]);
  const token = attempts.find(x => x.status === 201).data.token;
  assert.equal((await h.request('/api/admin/bookings')).status, 401);
  assert.equal((await h.request('/api/admin/bookings', 'GET', undefined, { 'oai-authenticated-user-id': 'owner' })).status, 401);
  const auth = await h.login();
  let row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  assert.equal(row.status, 'pending');
  const patch = { version: row.version, privateNote: 'OWNER-ONLY-SECRET', zoomUrl: 'https://zoom.us/j/123456789', status: 'accepted' };
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, { Cookie: auth.Cookie })).status, 403);
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, { ...auth, Origin: 'https://wrong.example' })).status, 403);
  const accepted = await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, auth);
  assert.equal(accepted.status, 200); row = accepted.data.booking;
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', patch, auth)).status, 409);
  const status = await h.request('/api/status', 'POST', { token });
  assert.equal(status.data.status, 'accepted'); assert.equal(status.data.zoomUrl, patch.zoomUrl);
  assert.ok(!JSON.stringify(status.data).includes('OWNER-ONLY-SECRET'));
  assert.ok(!Object.hasOwn(status.data, 'email')); assert.ok(!Object.hasOwn(row, 'token_hash'));
  const publicSlots = await h.request('/api/slots');
  assert.ok(!publicSlots.data.slots.includes(row.start));
  assert.ok(!JSON.stringify(publicSlots.data).includes('example.com'));
  assert.equal((await h.request('/api/status', 'POST', { token: 'wrong' })).status, 404);
  await h.restart();
  assert.equal((await h.request('/api/admin/bookings', 'GET', undefined, auth)).status, 401);
  const fresh = await h.login();
  const persisted = (await h.request('/api/admin/bookings', 'GET', undefined, fresh)).data.bookings[0];
  assert.equal(persisted.privateNote, 'OWNER-ONLY-SECRET');
  assert.equal((await h.request('/api/admin/logout', 'POST', {}, fresh)).status, 200);
  assert.equal((await h.request('/api/admin/bookings', 'GET', undefined, fresh)).status, 401);
});

test('declined slots reopen; schedule overlap and notice rules are enforced', async t => {
  const h = await harness(t); const auth = await h.login();
  const settings = (await h.request('/api/admin/settings', 'GET', undefined, auth)).data;
  settings.times = ['09:00', '09:30', '10:00']; settings.duration = 60;
  assert.equal((await h.request('/api/admin/settings', 'PUT', settings, auth)).status, 200);
  const slots = (await h.request('/api/slots')).data.slots;
  assert.equal((await h.reserve(slots[0])).status, 201);
  assert.equal((await h.reserve(new Date(Date.parse(slots[0]) + 30 * 60000).toISOString(), 'second')).status, 409);
  const row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, status: 'declined' }, auth)).status, 200);
  assert.equal((await h.reserve(slots[0], 'replacement')).status, 201);
  assert.equal((await h.reserve(new Date(0).toISOString(), 'past')).status, 409);
  assert.equal((await h.request('/api/admin/settings', 'PUT', settings, auth)).status, 409);
});

test('Sydney daylight saving and excluded days generate valid local slots', () => {
  assert.equal(localToUTC('2026-10-02', '09:00', 'Australia/Sydney'), '2026-10-01T23:00:00.000Z');
  assert.equal(localToUTC('2026-10-05', '09:00', 'Australia/Sydney'), '2026-10-04T22:00:00.000Z');
  assert.equal(localToUTC('2026-10-04', '02:30', 'Australia/Sydney'), null);
  const slots = generateSlots({ ...defaults, times: ['09:00'], horizonDays: 7, excludedDates: ['2026-10-05'] }, [], new Date('2026-10-01T00:00:00Z'));
  assert.ok(!slots.includes('2026-10-04T22:00:00.000Z'));
});

test('SSE publishes invalidation events without client or note contents', async t => {
  const h = await harness(t);
  const response = await fetch(h.config.origin + '/api/events');
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  try {
    const first = new TextDecoder().decode((await reader.read()).value); assert.match(first, /event: ready/);
    const slot = (await h.request('/api/slots')).data.slots[0];
    await h.reserve(slot);
    const update = new TextDecoder().decode((await reader.read()).value);
    assert.match(update, /event: change/); assert.ok(!update.includes('Test Client')); assert.ok(!update.includes('example.com'));
  } finally { await reader.cancel(); }
});

test('Zoom acceptance creates once and blocks overlapping admin actions', async t => {
  let calls = 0, release, started;
  const began = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const h = await harness(t, { config: { zoomEnabled: true }, dependencies: { createMeeting: async () => { calls++; started(); await wait; return { url: 'https://zoom.us/j/123456789', id: '123456789' }; } } });
  const auth = await h.login(); const slot = (await h.request('/api/slots')).data.slots[0]; await h.reserve(slot);
  const row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  const accepted = h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, status: 'accepted' }, auth);
  await began;
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version + 1, status: 'declined' }, auth)).status, 409);
  release(); assert.equal((await accepted).status, 200); assert.equal(calls, 1);
});

test('uncertain Zoom creation needs manual reconciliation before retrying', async t => {
  let calls = 0;
  const h = await harness(t, { config: { zoomEnabled: true }, dependencies: { createMeeting: async () => { calls++; throw new ZoomError('Check Zoom', true); } } });
  const auth = await h.login(); await h.reserve((await h.request('/api/slots')).data.slots[0]);
  let row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, status: 'accepted' }, auth)).status, 502);
  row = (await h.request('/api/admin/bookings', 'GET', undefined, auth)).data.bookings[0];
  assert.equal(row.zoomState, 'check_required');
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, status: 'accepted' }, auth)).status, 409);
  assert.equal(calls, 1);
  assert.equal((await h.request(`/api/admin/bookings/${row.id}`, 'PATCH', { version: row.version, status: 'accepted', zoomUrl: 'https://zoom.us/j/123456789' }, auth)).status, 200);
});

test('Zoom client sends the correct scheduled meeting and exposes only join URL', async () => {
  const calls = [];
  const http = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(calls.length === 1 ? { access_token: 'test-token', expires_in: 3600 } : { id: 12, join_url: 'https://zoom.us/j/12', start_url: 'https://private-host-link.example' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const create = zoomClient({ accountId: 'test-account', clientId: 'test-client', clientSecret: 'test-secret', hostUserId: 'host@example.com' }, http);
  const result = await create({ start: '2026-10-01T10:00:00.000Z', duration: 60 });
  assert.deepEqual(result, { url: 'https://zoom.us/j/12', id: '12' });
  assert.equal(calls[0].options.body.get('grant_type'), 'account_credentials');
  assert.equal(JSON.parse(calls[1].options.body).type, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token');
});

test('production refuses missing credentials and insecure origins', () => {
  assert.throws(() => loadConfig({}), /ADMIN_PASSWORD/);
  assert.throws(() => loadConfig({ ADMIN_PASSWORD: 'unique-password-long-enough', NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://example.com' }), /HTTPS/);
  const config = loadConfig({ ADMIN_PASSWORD: 'unique-password-long-enough', NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://booking.example.com' });
  assert.equal(config.origin, 'https://booking.example.com');
});

test('public pages and assets load; configuration and database paths are not served', async t => {
  const h = await harness(t);
  for (const path of ['/', '/dashboard', '/booking', '/app.js', '/admin.js', '/shared.js', '/styles.css', '/favicon.svg']) {
    const response = await fetch(h.config.origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok((await response.text()).length > 30);
  }
  for (const path of ['/.env', '/data/bookings.sqlite', '/server/app.mjs', '/package.json']) assert.equal((await h.request(path)).status, 404);
});
