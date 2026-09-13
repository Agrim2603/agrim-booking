import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
for (const directory of ['server', 'scripts', 'public', 'tests']) {
  for (const filename of readdirSync(directory)) {
    if (!/\.(mjs|js)$/.test(filename)) continue;
    const file = join(directory, filename);
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
for (const file of ['public/index.html','public/dashboard.html']) {
  const html = readFileSync(file, 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\son\w+=/i.test(html)) throw new Error(`Inline script violates the CSP in ${file}`);
}
console.log('JavaScript syntax and HTML policy checks passed.');
