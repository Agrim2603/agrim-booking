import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');

export async function passwordVerifier(password) {
  const salt = randomBytes(32);
  const digest = await scrypt(password, salt, 64);
  return async candidate => {
    if (typeof candidate !== 'string' || candidate.length > 256) return false;
    const supplied = await scrypt(candidate, salt, 64);
    return timingSafeEqual(digest, supplied);
  };
}

export function cookieToken(req) {
  const cookie = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('booking_admin='));
  const value = cookie?.slice('booking_admin='.length) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}

export function sessionCookie(token, secure, maxAge = 43200) {
  return `booking_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function rateLimiter() {
  const entries = new Map();
  return (key, max, windowMs) => {
    const now = Date.now();
    if (entries.size > 10000) for (const [k, value] of entries) if (value.until < now) entries.delete(k);
    let entry = entries.get(key);
    if (!entry || entry.until <= now) {
      if (entries.size > 10000 && !entry) return false;
      entry = { count: 0, until: now + windowMs };
      entries.set(key, entry);
    }
    return ++entry.count <= max;
  };
}

export function validZoomURL(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us')) && /^\/j\/\d+/.test(url.pathname);
  } catch { return false; }
}
