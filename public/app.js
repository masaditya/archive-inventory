/* ==================== AUTH ==================== */
let isAdmin = false;
let html5QrcodeScanner = null;
let dataGudang = [];

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}

async function checkAuthStatus() {
  try {
    const me = await api('/api/me');
    isAdmin = me.admin;
  } catch { isAdmin = false; }
  const authBtn = document.getElementById('authBtn');

  if (isAdmin) {
    authBtn.innerHTML = '<i class="fa-solid fa-unlock me-1"></i> Logout Admin';
    authBtn.classList.replace('btn-outline-light', 'btn-danger');
    document.body.classList.add('admin-mode');
  } else {
    authBtn.innerHTML = '<i class="fa-solid fa-lock me-1"></i> Login Admin';
    authBtn.classList.replace('btn-danger', 'btn-outline-light');
    document.body.classList.remove('admin-mode');
  }
}

function toggleAuth() {
  if (isAdmin) {
    api('/api/logout', { method: 'POST' }).then(() => {
      isAdmin = false;
      checkAuthStatus();
      new bootstrap.Tab(document.querySelector('#pills-scan-tab')).show();
    });
  } else {
    document.getElementById('loginPass').value = '';
    document.getElementById('loginError').classList.add('d-none');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show();
  }
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
    await checkAuthStatus();
    new bootstrap.Tab(document.querySelector('#pills-data-tab')).show();
    renderTabel();
  } catch (e) {
    document.getElementById('loginError').classList.remove('d-none');
  }
}

document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

/* ==================== DAFTAR BARANG ==================== */
async function loadItems() {
  dataGudang = await api('/api/items');
}

async function renderTabel() {
  await loadItems();
  const tbody = document.querySelector('#tabelBarang tbody');
  tbody.innerHTML = '';
  if (dataGudang.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted py-3">Belum ada data ATK & Perabot.</td></tr>';
    return;
  }
  dataGudang.forEach(item => {
    const tr = document.createElement('tr');
    const safeNama = item.nama.replace(/"/g, '&quot;');
    tr.innerHTML = `
      <td><input type="checkbox" class="check-item" value="${item.barcode}"></td>
      <td class="font-monospace">${item.barcode}</td>
      <td class="fw-bold">${safeNama}</td>
      <td><span class="badge bg-primary fs-6">${item.stok}</span></td>
      <td>
        <div class="d-flex gap-1 justify-content-center">
          <button class="btn btn-warning btn-sm" onclick="bukaModalEdit('${item.barcode}')" title="Edit">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
          <button class="btn btn-secondary btn-sm" onclick="showBarcode('${item.barcode}', '${safeNama}')" title="Barcode">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleCheckAll(el) {
  document.querySelectorAll('.check-item').forEach(cb => cb.checked = el.checked);
}

function getCheckedBarcodes() {
  return [...document.querySelectorAll('.check-item:checked')].map(cb => cb.value);
}

async function tambahBarang(e) {
  e.preventDefault();
  const barcode = document.getElementById('inputBarcode').value.trim();
  const nama = document.getElementById('inputNama').value.trim();
  const stok = parseInt(document.getElementById('inputStok').value);

  try {
    const result = await api('/api/items', { method: 'POST', body: JSON.stringify({ barcode, nama, stok }) });
    alert(result.added ? `Stok ${nama} berhasil ditambahkan (+${stok})!` : `Barang ${nama} berhasil disimpan!`);
    document.getElementById('formTambah').reset();
    new bootstrap.Tab(document.querySelector('#pills-data-tab')).show();
    renderTabel();
  } catch (err) {
    alert('Gagal: ' + err.message);
  }
}

async function bukaModalEdit(barcode) {
  const item = dataGudang.find(i => i.barcode === barcode);
  if (!item) return;
  document.getElementById('editBarcode').value = item.barcode;
  document.getElementById('editNama').value = item.nama;
  document.getElementById('editStok').value = item.stok;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('editModal')).show();
}

async function simpanEdit() {
  const barcode = document.getElementById('editBarcode').value;
  const namaBaru = document.getElementById('editNama').value.trim();
  const stokBaru = parseInt(document.getElementById('editStok').value);

  if (namaBaru === '' || isNaN(stokBaru)) {
    alert("Nama dan Stok tidak boleh kosong!");
    return;
  }
  try {
    await api(`/api/items/${encodeURIComponent(barcode)}`, {
      method: 'PUT',
      body: JSON.stringify({ nama: namaBaru, stok: stokBaru })
    });
    bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
    renderTabel();
  } catch (err) {
    alert('Gagal: ' + err.message);
  }
}

async function hapusBarangTerpilih() {
  // Hapus tidak ada di mockup/API — fitur opsional; implement via edit stok 0 tidak sama.
  // Untuk saat ini: tidak tersedia di server, tampilkan info.
  alert('Fitur hapus barang belum diaktifkan. Gunakan Edit untuk mengatur stok.');
}

function generateRandomBarcode() {
  const randomNum = Math.floor(100000000000 + Math.random() * 900000000000);
  document.getElementById('inputBarcode').value = randomNum;
}

function showBarcode(barcode, nama) {
  document.getElementById('modalTitle').innerText = nama;
  const canvas = document.getElementById('barcodeCanvas');

  JsBarcode(canvas, barcode, {
    format: "CODE128", width: 4, height: 120, displayValue: true,
    margin: 20, background: "#ffffff", lineColor: "#000000", fontSize: 24, fontOptions: "bold"
  });

  const jpegUrl = canvas.toDataURL("image/jpeg", 1.0);
  document.getElementById('barcodeImage').src = jpegUrl;

  const downloadBtn = document.getElementById('downloadBtn');
  downloadBtn.href = jpegUrl;
  const cleanName = nama.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  downloadBtn.download = `${cleanName}_${barcode}.jpg`;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('barcodeModal')).show();
}

/* ==================== CETAK BARCODE A4 ==================== */
function cetakBarcodeTerpilih() {
  const codes = getCheckedBarcodes();
  if (codes.length === 0) {
    alert('Pilih minimal satu barang di tabel untuk dicetak.');
    return;
  }
  window.open(`/print.html?barcodes=${encodeURIComponent(codes.join(','))}`, '_blank');
}

function cetakBarcodeSemua() {
  window.open('/print.html', '_blank');
}

/* ==================== LAPORAN ==================== */
async function renderRiwayat() {
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;
  const tbody = document.querySelector('#tabelRiwayat tbody');
  tbody.innerHTML = '';

  let riwayat;
  try {
    riwayat = await api(`/api/transactions?from=${from || ''}&to=${to || ''}`);
  } catch { return; }
  const outs = riwayat.filter(r => r.tipe === 'OUT');

  if (outs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted py-4">Belum ada riwayat pengambilan barang.</td></tr>';
    return;
  }

  outs.forEach(log => {
    const [tanggal, waktu] = (log.created_at || '').split(' ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="fw-bold text-dark">${formatTanggal(tanggal)}</div>
        <small class="text-muted">${(waktu || '').slice(0, 5)}</small>
      </td>
      <td class="fw-bold text-success">${log.pengambil || '-'}</td>
      <td class="fw-bold text-primary">${log.nama}</td>
      <td><span class="badge bg-danger fs-6">-${log.jumlah}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function formatTanggal(tgl) {
  if (!tgl) return '-';
  const d = new Date(tgl + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function hapusRiwayat() {
  if (confirm("Apakah Anda yakin ingin menghapus SEMUA riwayat pengeluaran barang? Data tidak bisa dikembalikan.")) {
    await api('/api/transactions', { method: 'DELETE' });
    renderRiwayat();
  }
}

function downloadLaporan(format) {
  window.open(`/api/export/${format}`, '_blank');
}

/* ==================== SCANNER ==================== */
function startScanner() {
  if (html5QrcodeScanner || !document.getElementById('reader')) return;

  html5QrcodeScanner = new Html5QrcodeScanner("reader", {
    fps: 10,
    qrbox: { width: 250, height: 100 },
    facingMode: "environment"
  }, false);
  html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

async function onScanSuccess(decodedText) {
  if (html5QrcodeScanner.getState() === 2) {
    html5QrcodeScanner.pause(true);
  }

  const resultDiv = document.getElementById('scanResult');
  resultDiv.className = 'alert mt-4 text-center shadow-sm';

  try {
    const item = dataGudang.find(i => i.barcode === decodedText) || await api('/api/items').then(items => items.find(i => i.barcode === decodedText));
    if (item && item.stok > 0) {
      document.getElementById('qtyItemName').innerText = item.nama;
      document.getElementById('qtyCurrentStock').innerText = item.stok;
      document.getElementById('qtyInput').value = 1;
      document.getElementById('qtyInput').max = item.stok;
      document.getElementById('qtyBarcode').value = item.barcode;
      document.getElementById('namaPengambil').value = '';
      bootstrap.Modal.getOrCreateInstance(document.getElementById('qtyModal')).show();
      return;
    } else if (item) {
      resultDiv.classList.add('alert-danger');
      resultDiv.innerHTML = `<i class="fa-solid fa-circle-xmark fs-4"></i><br><b>Gagal!</b><br>Stok <b>${item.nama}</b> sudah habis.`;
    } else {
      resultDiv.classList.add('alert-warning');
      resultDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation fs-4"></i><br><b>Tidak Ditemukan!</b><br>Barcode <span class="font-monospace fw-bold">${decodedText}</span> tidak terdaftar.`;
    }
  } catch (err) {
    resultDiv.classList.add('alert-danger');
    resultDiv.innerHTML = `<b>Error:</b> ${err.message}`;
  }

  resultDiv.style.display = 'block';
  setTimeout(() => {
    resultDiv.style.display = 'none';
    if (html5QrcodeScanner && html5QrcodeScanner.getState() === 3) html5QrcodeScanner.resume();
  }, 3000);
}

async function processScanOut() {
  const barcode = document.getElementById('qtyBarcode').value;
  const qtyToDeduct = parseInt(document.getElementById('qtyInput').value);
  const pengambil = document.getElementById('namaPengambil').value.trim();

  if (pengambil === "") {
    alert("Peringatan: Nama Pengambil WAJIB diisi sebelum melanjutkan!");
    document.getElementById('namaPengambil').focus();
    return;
  }

  const resultDiv = document.getElementById('scanResult');
  resultDiv.className = 'alert mt-4 text-center shadow-sm';

  try {
    const result = await api('/api/scan-out', {
      method: 'POST',
      body: JSON.stringify({ barcode, jumlah: qtyToDeduct, pengambil })
    });
    resultDiv.classList.add('alert-success');
    resultDiv.innerHTML = `<i class="fa-solid fa-circle-check fs-4"></i><br><b>Berhasil!</b><br>${result.jumlah} unit <b>${result.nama}</b> diambil oleh <b>${pengambil}</b>.<br>Sisa stok: <span class="badge bg-success">${result.sisa_stok}</span>`;
  } catch (err) {
    resultDiv.classList.add('alert-danger');
    resultDiv.innerHTML = `<i class="fa-solid fa-circle-xmark fs-4"></i><br><b>Gagal!</b><br>${err.message}`;
  }

  bootstrap.Modal.getOrCreateInstance(document.getElementById('qtyModal')).hide();
  resultDiv.style.display = 'block';
  setTimeout(() => {
    resultDiv.style.display = 'none';
    if (html5QrcodeScanner && html5QrcodeScanner.getState() === 3) html5QrcodeScanner.resume();
  }, 3000);
}

function cancelScan() {
  bootstrap.Modal.getOrCreateInstance(document.getElementById('qtyModal')).hide();
  if (html5QrcodeScanner && html5QrcodeScanner.getState() === 3) html5QrcodeScanner.resume();
}

function onScanFailure(error) {}

document.querySelectorAll('button[data-bs-toggle="pill"]').forEach(tab => {
  tab.addEventListener('hidden.bs.tab', event => {
    if (event.target.id === 'pills-scan-tab' && html5QrcodeScanner) {
      html5QrcodeScanner.clear();
      html5QrcodeScanner = null;
    }
  });
});

window.onload = async function () {
  await checkAuthStatus();
  startScanner();
};
