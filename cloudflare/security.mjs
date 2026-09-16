import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');

// The strong password is kept in Cloudflare's encrypted secret binding, never SQLite.
// Compare fixed-length digests to avoid timing differences; durable limits throttle guesses.
export function verifyPassword(candidate, secret) {
  if (typeof candidate !== 'string' || candidate.length > 256) return false;
  return timingSafeEqual(Buffer.from(hash(candidate), 'hex'), Buffer.from(hash(secret), 'hex'));
}
export function cookieToken(request) {
  const value = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('booking_admin='))?.slice(14) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
export function sessionCookie(token, secure, maxAge = 43200) {
  return `booking_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function rateLimit(db, key, max, windowMs) {
  const now = Date.now();
  return db.transaction(() => {
    const row = db.prepare('SELECT count,until_ms FROM rate_limits WHERE key=?').get(key);
    if (row && row.until_ms > now && row.count >= max) return false;
    db.prepare(`INSERT INTO rate_limits (key,count,until_ms) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until_ms<=? THEN 1 ELSE count+1 END,
      until_ms=CASE WHEN until_ms<=? THEN ? ELSE until_ms END`).run(key, now + windowMs, now, now, now + windowMs);
    return true;
  });
}
