import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { existsSync, chmodSync } from 'node:fs';
const target = process.argv[2];
if (!target) throw new Error('Usage: npm run backup -- /absolute/path/backup.sqlite');
const source = join(resolve(process.env.DATA_DIR || 'data'), 'bookings.sqlite');
if (!existsSync(source)) throw new Error('Database not found. Start the app first.');
if (existsSync(target)) throw new Error('Choose a new backup filename; existing files are never overwritten.');
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, resolve(target)); chmodSync(target, 0o600); console.log(`Backup saved to ${resolve(target)}`); }
finally { db.close(); }
