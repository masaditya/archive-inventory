const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'inventory.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE NOT NULL,
    nama TEXT NOT NULL,
    stok INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS transaksi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id),
    tipe TEXT NOT NULL CHECK (tipe IN ('IN', 'OUT')),
    jumlah INTEGER NOT NULL,
    sisa_stok INTEGER NOT NULL,
    pengambil TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_transaksi_created ON transaksi(created_at);
  CREATE INDEX IF NOT EXISTS idx_transaksi_item ON transaksi(item_id);
`);

// ---- Migrasi: dijalankan otomatis sekali per nama migrasi ----
const appliedMigrations = new Set(
  db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name)
);

const migrations = [
  {
    name: '001-reset-admin-password',
    run(db) {
      // Reset password admin ke 'biasane' tanpa menyentuh data barang/riwayat
      const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
      if (!admin) {
        db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
          .run('admin', bcrypt.hashSync('biasane', 10));
      } else if (!bcrypt.compareSync('biasane', admin.password_hash)) {
        db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
          .run(bcrypt.hashSync('biasane', 10), 'admin');
      }
    },
  },
];

const insertMigration = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
for (const m of migrations) {
  if (appliedMigrations.has(m.name)) continue;
  db.transaction(() => {
    m.run(db);
    insertMigration.run(m.name);
  })();
  console.log(`[DB] Migrasi dijalankan: ${m.name}`);
}

module.exports = db;
