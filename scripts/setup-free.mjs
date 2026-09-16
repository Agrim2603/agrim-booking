import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
try {
  writeFileSync('.dev.vars', `ADMIN_PASSWORD="${randomBytes(24).toString('base64url')}"\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created .dev.vars. Open it locally to copy your admin password. Do not commit this file.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Your existing .dev.vars was preserved.');
}
console.log('Run npm run dev, then open http://localhost:8787/dashboard.');
