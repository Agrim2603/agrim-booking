import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log('.env already exists. Your configuration was left unchanged.');
} else {
  const password = randomBytes(24).toString('base64url');
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync('.env', example.replace('REPLACE_WITH_A_RANDOM_PASSWORD_AT_LEAST_16_CHARACTERS', password), { mode: 0o600, flag: 'wx' });
  console.log('Created .env. Your admin password is stored there. Open it locally and save the password in your password manager.\nStart the website with: npm start\nThen open http://localhost:3000');
}
