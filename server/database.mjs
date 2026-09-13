import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { defaults } from './schedule.mjs';

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'bookings.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('This database belongs to a newer app version. Do not downgrade.');
  if (version === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, start TEXT NOT NULL,
        duration INTEGER NOT NULL CHECK(duration>0), name TEXT NOT NULL, email TEXT NOT NULL, topic TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirming','accepted','declined')),
        private_note TEXT NOT NULL DEFAULT '', zoom_url TEXT NOT NULL DEFAULT '',
        zoom_state TEXT NOT NULL DEFAULT 'idle', zoom_meeting_id TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_bookings_active_start ON bookings(start) WHERE status != 'declined';
      CREATE INDEX idx_bookings_email ON bookings(email);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      PRAGMA user_version=1;
      COMMIT;`);
  }
  db.prepare('INSERT OR IGNORE INTO settings (id,value) VALUES (1,?)').run(JSON.stringify(defaults));
  // Sessions are intentionally invalidated at restart or credential rotation.
  db.prepare('DELETE FROM sessions').run();
  return db;
}

export function readSettings(db) {
  const row = db.prepare('SELECT value,version FROM settings WHERE id=1').get();
  return { ...JSON.parse(row.value), version: row.version };
}

export function activeReservations(db) {
  return db.prepare("SELECT start,duration FROM bookings WHERE status != 'declined'").all();
}

export function adminBooking(row) {
  return {
    id: row.id, start: row.start, duration: row.duration, name: row.name, email: row.email,
    topic: row.topic, status: row.status, privateNote: row.private_note, zoomUrl: row.zoom_url,
    zoomState: row.zoom_state, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
