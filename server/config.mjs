import { resolve } from 'node:path';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  const password = env.ADMIN_PASSWORD || '';
  if (password.length < 16 || password.length > 256 || password.startsWith('REPLACE_')) {
    throw new Error('Set a unique ADMIN_PASSWORD (16–256 characters). For local setup, run npm run setup.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  const rawOrigin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || (!production ? `http://localhost:${port}` : '');
  if (!rawOrigin) throw new Error('Set PUBLIC_ORIGIN to the HTTPS address of your deployed website.');
  const url = new URL(rawOrigin);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('PUBLIC_ORIGIN must be an origin only, without a path or credentials.');
  if (production && url.protocol !== 'https:') throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid PUBLIC_ORIGIN protocol.');
  const zoom = {
    accountId: env.ZOOM_ACCOUNT_ID || '', clientId: env.ZOOM_CLIENT_ID || '',
    clientSecret: env.ZOOM_CLIENT_SECRET || '', hostUserId: env.ZOOM_HOST_USER_ID || '',
  };
  const fields = Object.values(zoom).filter(Boolean).length;
  if (fields && fields !== 4) throw new Error('Set all four ZOOM_* variables, or leave them all empty.');
  return {
    port, password, production, origin: url.origin,
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    dataDir: resolve(env.DATA_DIR || 'data'), trustProxy: env.TRUST_PROXY === 'true',
    zoom, zoomEnabled: fields === 4,
  };
}
