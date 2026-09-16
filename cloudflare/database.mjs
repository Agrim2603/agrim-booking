import { defaults } from '../server/schedule.mjs';

export function openDatabase(storage) {
  const sql = storage.sql;
  // Adapt Cloudflare's durable SQLite cursor to the shared query interface.
  const db = {
    prepare(query) {
      return {
        get: (...args) => sql.exec(query, ...args).toArray()[0],
        all: (...args) => sql.exec(query, ...args).toArray(),
        run: (...args) => { sql.exec(query, ...args).toArray(); return sql.exec('SELECT changes() AS changes').one(); },
      };
    },
    transaction: callback => storage.transactionSync(callback),
  };
  storage.transactionSync(() => {
    sql.exec('CREATE TABLE IF NOT EXISTS app_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
    const version = db.prepare('SELECT version FROM app_version WHERE id=1').get()?.version || 0;
    if (version > 1) throw new Error('Database belongs to a newer application version.');
    if (!version) {
      sql.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
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
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, credential_hash TEXT NOT NULL);
        CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
        CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_ms INTEGER NOT NULL);
        CREATE INDEX idx_limits_expiry ON rate_limits(until_ms);
        INSERT INTO app_version (id,version) VALUES (1,1);`);
      // Thirty minutes fits a free Zoom Basic consultation.
      db.prepare('INSERT INTO settings (id,value) VALUES (1,?)').run(JSON.stringify({ ...defaults, duration: 30 }));
    }
  });
  return db;
}

export function readSettings(db) {
  const row = db.prepare('SELECT value,version FROM settings WHERE id=1').get();
  return { ...JSON.parse(row.value), version: row.version };
}
export function activeReservations(db) {
  return db.prepare("SELECT start,duration FROM bookings WHERE status != 'declined' AND start>?").all(new Date(Date.now() - 86400000).toISOString());
}
export function adminBooking(row) {
  return { id: row.id, start: row.start, duration: row.duration, name: row.name, email: row.email,
    topic: row.topic, status: row.status, privateNote: row.private_note, zoomUrl: row.zoom_url,
    zoomState: row.zoom_state, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
