import { DurableObject } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { openDatabase, readSettings, activeReservations, adminBooking } from './database.mjs';
import { generateSlots, validateSchedule } from '../server/schedule.mjs';
import { validZoomURL } from '../server/security.mjs';
import { zoomClient, ZoomError } from '../server/zoom.mjs';
import { hash, randomToken, verifyPassword, cookieToken, sessionCookie, rateLimit } from './security.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
};
const send = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
function textField(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
async function jsonBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Use application/json.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Invalid request.');
  const chunks = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 16384) { await reader.cancel(); fail(413, 'Request is too large.'); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, 'Invalid request.'); }
}

export class BookingRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.db = openDatabase(ctx.storage);
    this.processing = new Set();
    this.password = env.ADMIN_PASSWORD || '';
    this.configured = this.password.length >= 20 && this.password.length <= 256;
    this.credentialHash = hash(this.password);
    this.zoomEnabled = ['ZOOM_ACCOUNT_ID','ZOOM_CLIENT_ID','ZOOM_CLIENT_SECRET','ZOOM_HOST_USER_ID'].every(key => !!env[key]);
    this.createMeeting = zoomClient({ accountId: env.ZOOM_ACCOUNT_ID, clientId: env.ZOOM_CLIENT_ID,
      clientSecret: env.ZOOM_CLIENT_SECRET, hostUserId: env.ZOOM_HOST_USER_ID });
    // Automatic ping responses keep connections alive without preventing hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  session(request, requireCsrf = false) {
    const token = cookieToken(request);
    const value = token && this.db.prepare('SELECT csrf,expires_at FROM sessions WHERE token_hash=? AND expires_at>? AND credential_hash=?')
      .get(hash(token), Date.now(), this.credentialHash);
    if (!value) fail(401, 'Sign in to access your dashboard.');
    if (requireCsrf && request.headers.get('x-csrf-token') !== value.csrf) fail(403, 'Your session changed. Reload the page and try again.');
    return value;
  }

  notify(publicChange = false) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const identity = socket.deserializeAttachment();
        if (identity?.admin && (identity.expiresAt <= Date.now() || identity.credentialHash !== this.credentialHash ||
          !this.db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(identity.sessionHash))) {
          socket.close(1008, 'Session expired'); continue;
        }
        if (publicChange || identity?.admin) socket.send(JSON.stringify({ type: 'change' }));
      } catch { try { socket.close(1011, 'Reconnect'); } catch { /* already closed */ } }
    }
  }

  async fetch(request) {
    try {
      const url = new URL(request.url), path = url.pathname.replace(/\/$/, '') || '/', method = request.method;
      const db = this.db;
      const secure = url.protocol === 'https:';
      const origin = this.env.PUBLIC_ORIGIN || url.origin;
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && request.headers.get('origin') !== origin) fail(403, 'Request origin is not allowed.');
      // Cloudflare supplies this header; only its digest is persisted in rate limits.
      const ip = hash(request.headers.get('cf-connecting-ip') || 'local');
      if (path === '/api/live' && method === 'GET') return send(200, { transport: 'websocket' });
      if (path === '/healthz' && method === 'GET') return send(this.configured ? 200 : 503, { ok: this.configured });
      if (!this.configured) fail(503, 'The host is completing setup. Please try again later.');

      if (path === '/api/slots' && method === 'GET') {
        const settings = readSettings(db);
        return send(200, { hostName: settings.hostName, timeZone: settings.timeZone,
          duration: settings.duration, slots: generateSlots(settings, activeReservations(db)) });
      }
      if (path === '/api/bookings' && method === 'POST') {
        if (!rateLimit(db, `booking:${ip}`, 20, 3600000)) fail(429, 'Too many booking requests. Please try again later.');
        const data = await jsonBody(request);
        if (data.website) fail(400, 'Could not submit the request.');
        const name = textField(data.name, 'Name', 2, 100), email = textField(data.email, 'Email', 3, 254).toLowerCase();
        const topic = textField(data.topic, 'Discussion topic', 1, 1000);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
        const token = randomToken(), id = randomUUID(), now = new Date().toISOString();
        // A synchronous storage transaction serializes availability checks and insertion.
        db.transaction(() => {
          const settings = readSettings(db);
          if (!generateSlots(settings, activeReservations(db)).includes(data.start)) fail(409, 'That time is no longer available. Please choose another slot.');
          const count = db.prepare("SELECT count(*) AS n FROM bookings WHERE email=? AND start>? AND status!='declined'").get(email, now).n;
          if (count >= 3) fail(429, 'You already have three active requests. Please contact the host before requesting another.');
          db.prepare('INSERT INTO bookings (id,token_hash,start,duration,name,email,topic,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(id, hash(token), data.start, settings.duration, name, email, topic, now, now);
        });
        this.notify(true);
        return send(201, { token, status: 'pending' });
      }
      if (path === '/api/status' && method === 'POST') {
        if (!rateLimit(db, `status:${ip}`, 300, 60000)) fail(429, 'Please wait a moment before refreshing.');
        const { token } = await jsonBody(request);
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, 'Booking not found. Check your confirmation link.');
        const row = db.prepare('SELECT start,duration,status,zoom_url FROM bookings WHERE token_hash=?').get(hash(token));
        if (!row) fail(404, 'Booking not found. Check your confirmation link.');
        return send(200, { start: row.start, duration: row.duration, status: row.status === 'confirming' ? 'pending' : row.status,
          zoomUrl: row.status === 'accepted' ? row.zoom_url : '', hostName: readSettings(db).hostName });
      }
      if (path === '/api/admin/login' && method === 'POST') {
        db.prepare('DELETE FROM rate_limits WHERE until_ms<=?').run(Date.now());
        if (!rateLimit(db, `login:${ip}`, 10, 900000) || !rateLimit(db, 'login:global', 100, 900000)) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
        const { password } = await jsonBody(request);
        if (!verifyPassword(password, this.password)) fail(401, 'The password is incorrect.');
        const token = randomToken(), csrf = randomToken();
        db.prepare('DELETE FROM sessions WHERE expires_at<=? OR credential_hash!=?').run(Date.now(), this.credentialHash);
        db.prepare('INSERT INTO sessions (token_hash,csrf,expires_at,credential_hash) VALUES (?,?,?,?)')
          .run(hash(token), csrf, Date.now() + 43200000, this.credentialHash);
        return send(200, { csrf, zoomEnabled: this.zoomEnabled }, { 'Set-Cookie': sessionCookie(token, secure) });
      }
      let identity;
      if (path.startsWith('/api/admin/')) {
        identity = this.session(request, !['GET', 'HEAD'].includes(method));
        if (path === '/api/admin/session' && method === 'GET') return send(200, { csrf: identity.csrf, zoomEnabled: this.zoomEnabled });
        if (path === '/api/admin/logout' && method === 'POST') {
          const tokenHash = hash(cookieToken(request));
          db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
          for (const socket of this.ctx.getWebSockets()) if (socket.deserializeAttachment()?.sessionHash === tokenHash) socket.close(1008, 'Signed out');
          return send(200, { ok: true }, { 'Set-Cookie': sessionCookie('', secure, 0) });
        }
        if (path === '/api/admin/bookings' && method === 'GET') return send(200, { bookings: db.prepare('SELECT * FROM bookings ORDER BY start DESC LIMIT 500').all().map(adminBooking) });
        if (path === '/api/admin/settings' && method === 'GET') return send(200, readSettings(db));
        if (path === '/api/admin/settings' && method === 'PUT') {
          const data = await jsonBody(request); let settings;
          try { settings = validateSchedule(data); } catch (error) { fail(400, error.message); }
          const result = db.prepare('UPDATE settings SET value=?,version=version+1 WHERE id=1 AND version=?').run(JSON.stringify(settings), Number(data.version) || 0);
          if (!result.changes) fail(409, 'Availability was updated elsewhere. Reload it before saving.');
          this.notify(true); return send(200, readSettings(db));
        }
        if (path === '/api/admin/export' && method === 'GET') {
          // Full private export. Tokens remain hashed; sessions and passwords are excluded.
          return send(200, { format: 'agrim-booking-export-v1', exportedAt: new Date().toISOString(),
            settings: readSettings(db), bookings: db.prepare('SELECT * FROM bookings ORDER BY start').all() },
          { 'Content-Disposition': 'attachment; filename="agrim.booking-backup.json"' });
        }
        const match = path.match(/^\/api\/admin\/bookings\/([a-zA-Z0-9-]+)$/);
        if (match && method === 'PATCH') {
          const data = await jsonBody(request);
          if (this.processing.has(match[1])) fail(409, 'Zoom confirmation is already in progress. Please wait.');
          const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(match[1]);
          if (!row) fail(404, 'Booking not found.');
          if (data.version !== row.version) fail(409, 'This meeting was updated elsewhere. Reload bookings before saving. Your typed notes have been kept.');
          const privateNote = data.privateNote === undefined ? row.private_note : textField(data.privateNote, 'Private notes', 0, 10000);
          const zoomUrl = data.zoomUrl === undefined ? row.zoom_url : textField(data.zoomUrl, 'Zoom link', 0, 1000);
          if (!validZoomURL(zoomUrl)) fail(400, 'Enter an HTTPS Zoom participant join link such as https://zoom.us/j/123456789.');
          const status = data.status || row.status;
          if (!['pending', 'accepted', 'declined', 'confirming'].includes(status)) fail(400, 'Invalid booking status.');
          if (status === 'pending' && row.status !== 'pending' || status === 'confirming' && row.status !== 'confirming' || row.status === 'declined' && status !== 'declined') fail(409, 'A closed booking cannot be reopened. Ask the client to request a new time.');
          if (status === 'accepted' && Date.parse(row.start) <= Date.now() && row.status !== 'accepted') fail(409, 'This meeting time has passed. Ask the client to book a new time.');
          if (data.status === 'accepted' && row.status !== 'accepted' && !zoomUrl && this.zoomEnabled) {
            if (row.status === 'confirming' || row.zoom_state === 'check_required') fail(409, 'Check your Zoom account for the meeting and paste its join link before accepting.');
            db.prepare("UPDATE bookings SET status='confirming',zoom_state='creating',private_note=?,version=version+1,updated_at=? WHERE id=? AND version=?")
              .run(privateNote, new Date().toISOString(), row.id, row.version);
            this.notify(); this.processing.add(row.id);
            try {
              const meeting = await this.createMeeting(row);
              db.prepare("UPDATE bookings SET status='accepted',zoom_state='created',zoom_url=?,zoom_meeting_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='confirming'")
                .run(meeting.url, meeting.id, new Date().toISOString(), row.id, row.version + 1);
            } catch (error) {
              const uncertain = error instanceof ZoomError ? error.uncertain : true;
              db.prepare("UPDATE bookings SET status='pending',zoom_state=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='confirming'")
                .run(uncertain ? 'check_required' : 'failed', new Date().toISOString(), row.id, row.version + 1);
              this.notify(); fail(502, error instanceof ZoomError ? error.message : 'Zoom could not be confirmed. Check Zoom before retrying.');
            } finally { this.processing.delete(row.id); }
          } else {
            if (row.status === 'confirming' && status !== 'declined' && !zoomUrl) fail(409, 'Zoom creation is in progress. Check Zoom and add its join link if the process was interrupted.');
            const result = db.prepare('UPDATE bookings SET status=?,private_note=?,zoom_url=?,version=version+1,updated_at=? WHERE id=? AND version=?')
              .run(status, privateNote, zoomUrl, new Date().toISOString(), row.id, row.version);
            if (!result.changes) fail(409, 'This meeting was updated elsewhere. Reload bookings before saving.');
          }
          this.notify(status !== row.status || zoomUrl !== row.zoom_url);
          return send(200, { booking: adminBooking(db.prepare('SELECT * FROM bookings WHERE id=?').get(row.id)) });
        }
      }
      if (method === 'GET' && (path === '/api/events' || path === '/api/admin/events')) {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') fail(426, 'WebSocket upgrade required.');
        if (request.headers.get('origin') !== origin) fail(403, 'Request origin is not allowed.');
        if (this.ctx.getWebSockets().length >= 300) fail(503, 'Live updates are busy. Pages will refresh periodically.');
        const pair = new WebSocketPair(), [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ admin: !!identity, sessionHash: identity ? hash(cookieToken(request)) : '',
          expiresAt: identity?.expires_at || 0, credentialHash: identity ? this.credentialHash : '' });
        server.send(JSON.stringify({ type: 'ready' }));
        return new Response(null, { status: 101, webSocket: client });
      }
      fail(404, 'Page or endpoint not found.');
    } catch (error) {
      if (!error.status) console.error('Booking request failed:', error.name);
      return send(error.status || 500, { error: error.status ? error.message : 'The server could not complete the request. Please try again.' });
    }
  }

  webSocketMessage(socket) { socket.close(1008, 'This connection only receives updates.'); }
  webSocketClose(socket, code, reason) { socket.close(code === 1006 ? 1000 : code, reason); }
  webSocketError(socket) { socket.close(1011, 'Reconnect'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
      // Keep this name stable: changing it creates a different booking database.
      return env.BOOKING_ROOM.get(env.BOOKING_ROOM.idFromName('primary-calendar-v1')).fetch(request);
    }
    if (url.pathname === '/booking') {
      url.pathname = '/'; return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
