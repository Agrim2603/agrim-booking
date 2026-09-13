import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDatabase, readSettings, activeReservations, adminBooking } from './database.mjs';
import { generateSlots, validateSchedule } from './schedule.mjs';
import { hash, randomToken, cookieToken, sessionCookie, passwordVerifier, rateLimiter, validZoomURL } from './security.mjs';
import { zoomClient, ZoomError } from './zoom.mjs';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

async function jsonBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Use application/json.');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) fail(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, 'Invalid request.'); }
}

function send(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function textField(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}

export async function createApp(config, dependencies = {}) {
  const db = openDatabase(config.dataDir);
  const verifyPassword = await passwordVerifier(config.password);
  const createMeeting = dependencies.createMeeting || zoomClient(config.zoom);
  const limited = rateLimiter();
  const streams = new Set();
  const processing = new Set();
  const assets = new Map();
  const files = {
    '/': ['index.html', 'text/html'], '/booking': ['index.html', 'text/html'],
    '/dashboard': ['dashboard.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
    '/admin.js': ['admin.js', 'text/javascript'], '/shared.js': ['shared.js', 'text/javascript'],
    '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  };
  for (const [path, [name, mime]] of Object.entries(files)) {
    assets.set(path, { mime, content: await readFile(fileURLToPath(new URL(`../public/${name}`, import.meta.url))) });
  }
  function notify(publicChange = false) {
    for (const stream of streams) {
      if ((publicChange || stream.admin) && !stream.res.destroyed) {
        if (!stream.res.write('event: change\ndata: {}\n\n')) stream.res.end();
      }
    }
  }
  function session(req, requireCsrf = false) {
    const token = cookieToken(req);
    const value = token && db.prepare('SELECT csrf,expires_at FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
    if (!value) fail(401, 'Sign in to access your dashboard.');
    if (requireCsrf && req.headers['x-csrf-token'] !== value.csrf) fail(403, 'Your session changed. Reload the page and try again.');
    return value;
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, config.origin);
      const path = url.pathname.replace(/\/$/, '') || '/';
      const method = req.method;
      const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim() : String(req.socket.remoteAddress);
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && req.headers.origin !== config.origin) fail(403, 'Request origin is not allowed.');

      if (path === '/healthz' && method === 'GET') {
        db.prepare('SELECT 1').get(); return send(res, 200, { ok: true });
      }
      if (path === '/api/slots' && method === 'GET') {
        const settings = readSettings(db);
        return send(res, 200, { hostName: settings.hostName, timeZone: settings.timeZone,
          duration: settings.duration, slots: generateSlots(settings, activeReservations(db)) });
      }
      if (path === '/api/bookings' && method === 'POST') {
        if (!limited(`booking:${ip}`, 20, 3600000)) fail(429, 'Too many booking requests. Please try again later.');
        const data = await jsonBody(req);
        if (data.website) fail(400, 'Could not submit the request.');
        const name = textField(data.name, 'Name', 2, 100);
        const email = textField(data.email, 'Email', 3, 254).toLowerCase();
        const topic = textField(data.topic, 'Discussion topic', 1, 1000);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
        const token = randomToken(), id = randomUUID(), now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          const settings = readSettings(db);
          if (!generateSlots(settings, activeReservations(db)).includes(data.start)) fail(409, 'That time is no longer available. Please choose another slot.');
          const count = db.prepare("SELECT count(*) AS n FROM bookings WHERE email=? AND start>? AND status!='declined'").get(email, now).n;
          if (count >= 3) fail(429, 'You already have three active requests. Please contact the host before requesting another.');
          db.prepare('INSERT INTO bookings (id,token_hash,start,duration,name,email,topic,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(id, hash(token), data.start, settings.duration, name, email, topic, now, now);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        notify(true);
        return send(res, 201, { token, status: 'pending' });
      }
      if (path === '/api/status' && method === 'POST') {
        if (!limited(`status:${ip}`, 1800, 60000)) fail(429, 'Please wait a moment before refreshing.');
        const { token } = await jsonBody(req);
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, 'Booking not found. Check your confirmation link.');
        const row = db.prepare('SELECT start,duration,status,zoom_url FROM bookings WHERE token_hash=?').get(hash(token));
        if (!row) fail(404, 'Booking not found. Check your confirmation link.');
        return send(res, 200, { start: row.start, duration: row.duration,
          status: row.status === 'confirming' ? 'pending' : row.status,
          zoomUrl: row.status === 'accepted' ? row.zoom_url : '', hostName: readSettings(db).hostName });
      }
      if (path === '/api/admin/login' && method === 'POST') {
        if (!limited(`login:${ip}`, 10, 900000) || !limited('login:global', 100, 900000)) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
        const { password } = await jsonBody(req);
        if (!await verifyPassword(password)) fail(401, 'The password is incorrect.');
        const token = randomToken(), csrf = randomToken();
        db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
        db.prepare('INSERT INTO sessions (token_hash,csrf,expires_at) VALUES (?,?,?)').run(hash(token), csrf, Date.now() + 43200000);
        return send(res, 200, { csrf, zoomEnabled: config.zoomEnabled }, { 'Set-Cookie': sessionCookie(token, config.production) });
      }
      if (path.startsWith('/api/admin/')) {
        const identity = session(req, !['GET', 'HEAD'].includes(method));
        if (path === '/api/admin/session' && method === 'GET') return send(res, 200, { csrf: identity.csrf, zoomEnabled: config.zoomEnabled });
        if (path === '/api/admin/logout' && method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(cookieToken(req)));
          for (const s of streams) if (s.sessionHash === hash(cookieToken(req))) s.res.end();
          return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', config.production, 0) });
        }
        if (path === '/api/admin/bookings' && method === 'GET') {
          const rows = db.prepare('SELECT * FROM bookings ORDER BY start DESC LIMIT 500').all();
          return send(res, 200, { bookings: rows.map(adminBooking) });
        }
        if (path === '/api/admin/settings' && method === 'GET') return send(res, 200, readSettings(db));
        if (path === '/api/admin/settings' && method === 'PUT') {
          const data = await jsonBody(req);
          let settings;
          try { settings = validateSchedule(data); } catch (error) { fail(400, error.message); }
          const result = db.prepare('UPDATE settings SET value=?,version=version+1 WHERE id=1 AND version=?').run(JSON.stringify(settings), Number(data.version) || 0);
          if (!result.changes) fail(409, 'Availability was updated elsewhere. Reload it before saving.');
          notify(true); return send(res, 200, readSettings(db));
        }
        const match = path.match(/^\/api\/admin\/bookings\/([a-zA-Z0-9-]+)$/);
        if (match && method === 'PATCH') {
          const data = await jsonBody(req);
          if (processing.has(match[1])) fail(409, 'Zoom confirmation is already in progress. Please wait.');
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
          if (data.status === 'accepted' && row.status !== 'accepted' && !zoomUrl && config.zoomEnabled) {
            if (row.status === 'confirming' || row.zoom_state === 'check_required') fail(409, 'Check your Zoom account for the meeting and paste its join link before accepting.');
            db.prepare("UPDATE bookings SET status='confirming',zoom_state='creating',private_note=?,version=version+1,updated_at=? WHERE id=? AND version=?")
              .run(privateNote, new Date().toISOString(), row.id, row.version);
            notify();
            processing.add(row.id);
            try {
              const meeting = await createMeeting(row);
              db.prepare("UPDATE bookings SET status='accepted',zoom_state='created',zoom_url=?,zoom_meeting_id=?,version=version+1,updated_at=? WHERE id=?")
                .run(meeting.url, meeting.id, new Date().toISOString(), row.id);
            } catch (error) {
              const uncertain = error instanceof ZoomError ? error.uncertain : true;
              db.prepare("UPDATE bookings SET status='pending',zoom_state=?,version=version+1,updated_at=? WHERE id=?")
                .run(uncertain ? 'check_required' : 'failed', new Date().toISOString(), row.id);
              notify();
              fail(502, error instanceof ZoomError ? error.message : 'Zoom could not be confirmed. Check Zoom before retrying.');
            } finally { processing.delete(row.id); }
          } else {
            if (row.status === 'confirming' && status !== 'declined' && !zoomUrl) fail(409, 'Zoom creation is in progress. Check Zoom and add its join link if the process was interrupted.');
            db.prepare('UPDATE bookings SET status=?,private_note=?,zoom_url=?,version=version+1,updated_at=? WHERE id=? AND version=?')
              .run(status, privateNote, zoomUrl, new Date().toISOString(), row.id, row.version);
          }
          notify(status !== row.status || zoomUrl !== row.zoom_url);
          return send(res, 200, { booking: adminBooking(db.prepare('SELECT * FROM bookings WHERE id=?').get(row.id)) });
        }
      }
      if (method === 'GET' && (path === '/api/events' || path === '/api/admin/events')) {
        if (streams.size >= 300) fail(503, 'Live updates are busy. Availability will refresh periodically.');
        const admin = path.includes('/admin/');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 3000\nevent: ready\ndata: {}\n\n');
        const stream = { res, admin, sessionHash: admin ? hash(cookieToken(req)) : null };
        streams.add(stream);
        const heartbeat = setInterval(() => {
          if (admin && !db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(stream.sessionHash, Date.now())) { res.end(); return; }
          if (!res.write(': heartbeat\n\n')) res.end();
        }, 20000);
        res.on('close', () => { clearInterval(heartbeat); streams.delete(stream); });
        return;
      }
      if ((method === 'GET' || method === 'HEAD') && assets.has(path)) {
        const { content, mime } = assets.get(path);
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-cache', 'Content-Length': content.length });
        return res.end(method === 'HEAD' ? undefined : content);
      }
      fail(404, 'Page or endpoint not found.');
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.code || error.name || 'Error');
      send(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request. Please try again.' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, db, async close() {
    for (const stream of streams) stream.res.end();
    await new Promise(resolve => server.close(resolve));
    db.close();
  } };
}
