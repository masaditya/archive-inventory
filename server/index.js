const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL = 1000 * 60 * 60 * 8; // 8 jam

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// ---- Auth sederhana berbasis cookie token (in-memory, cukup untuk LAN kecil) ----
const sessions = new Map(); // token -> { user, expires }

function newToken(username) {
  const token = require('crypto').randomBytes(32).toString('hex');
  sessions.set(token, { user: username, expires: Date.now() + SESSION_TTL });
  return token;
}

function requireAdmin(req, res, next) {
  const token = req.cookies.session;
  const sess = token && sessions.get(token);
  if (!sess || sess.expires < Date.now()) {
    if (sess) sessions.delete(token);
    return res.status(401).json({ error: 'Belum login sebagai admin' });
  }
  req.user = sess.user;
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  res.cookie('session', newToken(user.username), { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) sessions.delete(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = req.cookies.session;
  const sess = token && sessions.get(token);
  if (sess && sess.expires >= Date.now()) return res.json({ admin: true, username: sess.user });
  res.json({ admin: false });
});

// ---- Items ----
app.get('/api/items', (req, res) => {
  const items = db.prepare('SELECT barcode, nama, stok FROM items ORDER BY nama').all();
  res.json(items);
});

app.post('/api/items', requireAdmin, (req, res) => {
  const { barcode, nama, stok } = req.body || {};
  if (!barcode || !nama) return res.status(400).json({ error: 'Barcode dan nama wajib diisi' });
  const stokInt = parseInt(stok, 10);
  if (!Number.isInteger(stokInt) || stokInt < 1) return res.status(400).json({ error: 'Stok awal minimal 1' });

  const existing = db.prepare('SELECT * FROM items WHERE barcode = ?').get(barcode);
  if (existing) {
    db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now','localtime') WHERE barcode = ?").run(stokInt, barcode);
    const updated = db.prepare('SELECT * FROM items WHERE barcode = ?').get(barcode);
    db.prepare('INSERT INTO transaksi (item_id, tipe, jumlah, sisa_stok) VALUES (?, ?, ?, ?)')
      .run(updated.id, 'IN', stokInt, updated.stok);
    return res.json({ ok: true, item: updated, added: true });
  }
  const info = db.prepare('INSERT INTO items (barcode, nama, stok) VALUES (?, ?, ?)').run(barcode, nama, stokInt);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO transaksi (item_id, tipe, jumlah, sisa_stok) VALUES (?, ?, ?, ?)')
    .run(item.id, 'IN', stokInt, item.stok);
  res.json({ ok: true, item, added: false });
});

app.put('/api/items/:barcode', requireAdmin, (req, res) => {
  const { nama, stok } = req.body || {};
  const stokInt = parseInt(stok, 10);
  if (!nama || !Number.isInteger(stokInt) || stokInt < 0) {
    return res.status(400).json({ error: 'Nama wajib diisi dan stok minimal 0' });
  }
  const info = db.prepare('UPDATE items SET nama = ?, stok = ?, updated_at = datetime(\'now\',\'localtime\') WHERE barcode = ?')
    .run(nama, stokInt, req.params.barcode);
  if (info.changes === 0) return res.status(404).json({ error: 'Barang tidak ditemukan' });
  res.json({ ok: true, item: db.prepare('SELECT * FROM items WHERE barcode = ?').get(req.params.barcode) });
});

// ---- Scan barang keluar (tanpa login, sesuai kebutuhan) ----
app.post('/api/scan-out', (req, res) => {
  const { barcode, jumlah, pengambil } = req.body || {};
  const qty = parseInt(jumlah, 10);
  if (!barcode || !pengambil || !String(pengambil).trim()) {
    return res.status(400).json({ error: 'Barcode dan nama pengambil wajib diisi' });
  }
  if (!Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: 'Jumlah tidak valid' });
  }

  const result = db.transaction(() => {
    const item = db.prepare('SELECT * FROM items WHERE barcode = ?').get(barcode);
    if (!item) return { status: 404, error: 'Barcode tidak terdaftar' };
    if (item.stok < 1) return { status: 400, error: `Stok ${item.nama} sudah habis` };
    if (qty > item.stok) return { status: 400, error: `Jumlah melebihi stok (sisa ${item.stok})` };

    db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now','localtime') WHERE id = ?").run(qty, item.id);
    const sisa = item.stok - qty;
    db.prepare('INSERT INTO transaksi (item_id, tipe, jumlah, sisa_stok, pengambil) VALUES (?, ?, ?, ?, ?)')
      .run(item.id, 'OUT', qty, sisa, String(pengambil).trim());
    return { ok: true, nama: item.nama, jumlah: qty, sisa_stok: sisa };
  })();

  if (result.error) return res.status(result.status).json(result);
  res.json(result);
});

// ---- Riwayat transaksi ----
app.get('/api/transactions', requireAdmin, (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT t.id, t.tipe, t.jumlah, t.sisa_stok, t.pengambil, t.created_at,
                    i.barcode, i.nama
             FROM transaksi t JOIN items i ON i.id = t.item_id`;
  const params = [];
  if (from && to) {
    sql += ' WHERE date(t.created_at) BETWEEN date(?) AND date(?)';
    params.push(from, to);
  }
  sql += ' ORDER BY t.created_at DESC, t.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

app.delete('/api/transactions', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM transaksi WHERE tipe = ?').run('OUT');
  res.json({ ok: true, deleted: info.changes });
});

// ---- Export laporan ----
function buildCsv(rows) {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = ['Tanggal;Waktu;Tipe;Pengambil;Barcode;Jenis / Nama Barang;Jumlah;Sisa Stok Saat Itu'];
  for (const r of rows) {
    const [date, time = ''] = r.created_at.split(' ');
    lines.push([date, time, r.tipe === 'OUT' ? 'Keluar' : 'Masuk', r.pengambil || '-', r.barcode, r.nama, r.jumlah, r.sisa_stok].map(esc).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n'); // BOM agar Excel membaca UTF-8
}

app.get('/api/export/csv', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT t.created_at, t.tipe, t.jumlah, t.sisa_stok, t.pengambil, i.barcode, i.nama
                           FROM transaksi t JOIN items i ON i.id = t.item_id
                           ORDER BY t.created_at ASC, t.id ASC`).all();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Laporan_Inventory_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(buildCsv(rows));
});

app.get('/api/export/xlsx', requireAdmin, (req, res) => {
  // Export via SpreadsheetML 2003 (Excel-compatible XML, tanpa dependency tambahan)
  const rows = db.prepare(`SELECT t.created_at, t.tipe, t.jumlah, t.sisa_stok, t.pengambil, i.barcode, i.nama
                           FROM transaksi t JOIN items i ON i.id = t.item_id
                           ORDER BY t.created_at ASC, t.id ASC`).all();
  const cell = v => `<Cell><Data ss:Type="String">${String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Data></Cell>`;
  let xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Riwayat">
  <Table>
   <Row>${['Tanggal', 'Waktu', 'Tipe', 'Pengambil', 'Barcode', 'Jenis / Nama Barang', 'Jumlah', 'Sisa Stok'].map(cell).join('')}</Row>`;
  for (const r of rows) {
    const [date, time = ''] = r.created_at.split(' ');
    xml += `\n   <Row>${[date, time, r.tipe === 'OUT' ? 'Keluar' : 'Masuk', r.pengambil || '-', r.barcode, r.nama, r.jumlah, r.sisa_stok].map(cell).join('')}</Row>`;
  }
  xml += `\n  </Table>\n </Worksheet>\n</Workbook>`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="Laporan_Inventory_${new Date().toISOString().slice(0, 10)}.xls"`);
  res.send(xml);
});

// ---- Print sheet barcode ----
app.get('/api/print-barcode', requireAdmin, (req, res) => {
  // ?barcodes=code1,code2 (kosong = semua)
  let items;
  const raw = req.query.barcodes;
  if (raw) {
    const codes = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    if (!codes.length) return res.status(400).json({ error: 'Barcode kosong' });
    const stmt = db.prepare('SELECT barcode, nama FROM items WHERE barcode = ?');
    items = [...new Set(codes)].map(c => stmt.get(c)).filter(Boolean);
  } else {
    items = db.prepare('SELECT barcode, nama FROM items ORDER BY nama').all();
  }
  res.json(items);
});

app.listen(PORT, () => {
  console.log(`[SERVER] Aplikasi inventory berjalan di http://localhost:${PORT}`);
});
