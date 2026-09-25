'use strict';
/* Pemeriksa koneksi Ninja Saga lokal.
 *
 * Menguji jalur dari peramban ke server lapis demi lapis, lalu menyebut
 * lapis PERTAMA yang gagal:
 *
 *   1. berkas hosts        ninjasaga.cc / cdn / amf  -> 127.0.0.1
 *   2. resolusi nama       apa yang benar-benar dipakai Windows
 *   3. server Node         http://127.0.0.1:8080
 *   4. Caddy               port 443 di 127.0.0.1
 *   5. sertifikat HTTPS    masih berlaku atau sudah kedaluwarsa
 *   6. berkas lewat HTTPS  https://cdn.ninjasaga.cc/ninja_saga.swf
 *   7. AMF lewat HTTPS     https://amf.ninjasaga.cc/  (login uji)
 *
 * Cara pakai (di folder server, SAAT server sedang jalan di jendela lain):
 *     node cek-koneksi.js
 *
 * Hasilnya juga disimpan ke cek-koneksi-hasil.txt.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const dns = require('dns');
const http = require('http');
const https = require('https');
const path = require('path');

const DOMAIN = ['ninjasaga.cc', 'cdn.ninjasaga.cc', 'amf.ninjasaga.cc'];
const PORT_NODE = 8080;
const TUNGGU = 5000;

const baris = [];
function tulis(s = '') { console.log(s); baris.push(s); }
function ok(s)   { tulis('   [OK]    ' + s); }
function gagal(s){ tulis('   [GAGAL] ' + s); }
function info(s) { tulis('           ' + s); }

const hasil = {};   // nama lapis -> true/false

// ------------------------------------------------------------ utilitas
function ukuran(n) { return Number(n).toLocaleString('id-ID') + ' byte'; }

function httpGet(mod, opsi) {
  return new Promise(selesai => {
    const r = mod.request(Object.assign({ method: 'GET', timeout: TUNGGU, agent: false }, opsi), res => {
      // Sertifikat HARUS dibaca sekarang: setelah 'end' soket bisa sudah
      // dilepas dan getPeerCertificate() mengembalikan objek kosong.
      const sertNow = res.socket && res.socket.getPeerCertificate ? res.socket.getPeerCertificate(true) : null;
      const potong = [];
      res.on('data', c => potong.push(c));
      res.on('end', () => selesai({
        status: res.statusCode,
        body: Buffer.concat(potong),
        sert: sertNow,
      }));
    });
    r.on('timeout', () => { r.destroy(new Error('tidak ada jawaban dalam ' + TUNGGU / 1000 + ' detik')); });
    r.on('error', e => selesai({ error: e }));
    if (opsi.body) r.write(opsi.body);
    r.end();
  });
}

function portTerbuka(host, port) {
  return new Promise(selesai => {
    const s = net.connect({ host, port, timeout: TUNGGU });
    s.on('connect', () => { s.destroy(); selesai(true); });
    s.on('timeout', () => { s.destroy(); selesai(false); });
    s.on('error', () => selesai(false));
  });
}

// Paket AMF0 SystemService.snsLogin minimal, tanpa bergantung pada amf.js.
function paketLogin() {
  const bag = [];
  const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16BE(v); bag.push(b); };
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32BE(v); bag.push(b); };
  const utf = s => { const b = Buffer.from(s, 'utf8'); u16(b.length); bag.push(b); };
  const str0 = s => { bag.push(Buffer.from([0x02])); utf(s); };

  u16(0); u16(0); u16(1);                 // versi, 0 header, 1 body
  utf('SystemService.snsLogin');
  utf('/1');
  const awal = bag.length;
  bag.push(Buffer.from([0x0A])); u32(3);  // strict array, 3 elemen
  str0('67158&fb_name=cek&time=0');
  str0('facebook');
  str0('latest');
  // panjang body tidak wajib diisi benar; Zend AMF memakai 0xFFFFFFFF
  bag.splice(awal, 0, Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]));
  return Buffer.concat(bag);
}

// ------------------------------------------------------------ lapis 1
function cekHosts() {
  tulis('1) Berkas hosts');
  const lokasi = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  let isi;
  try { isi = fs.readFileSync(lokasi, 'utf8'); }
  catch (e) { gagal('tidak bisa membaca ' + lokasi + ': ' + e.message); hasil.hosts = false; return; }

  const peta = {};
  for (const l of isi.split(/\r?\n/)) {
    const t = l.replace(/#.*/, '').trim();
    if (!t) continue;
    const [ip, ...nama] = t.split(/\s+/);
    for (const n of nama) peta[n.toLowerCase()] = ip;
  }
  let semua = true;
  for (const d of DOMAIN) {
    const ip = peta[d];
    if (ip === '127.0.0.1' || ip === '::1') ok(d + ' -> ' + ip);
    else { gagal(d + (ip ? ' -> ' + ip + ' (harus 127.0.0.1)' : ' TIDAK ADA di hosts')); semua = false; }
  }
  if (!semua) {
    info('Perbaikan: buka Notepad sebagai Administrator, buka');
    info('    ' + lokasi);
    info('lalu tambahkan baris ini di paling bawah, simpan:');
    info('    127.0.0.1 ninjasaga.cc cdn.ninjasaga.cc amf.ninjasaga.cc');
    info('(Pembaruan Windows atau antivirus kadang mengembalikan berkas ini.)');
  }
  hasil.hosts = semua;
}

// ------------------------------------------------------------ lapis 2
async function cekDns() {
  tulis('');
  tulis('2) Nama domain yang dipakai Windows');
  let semua = true;
  for (const d of DOMAIN) {
    const alamat = await new Promise(s => dns.lookup(d, { all: true }, (e, a) => s(e ? null : a)));
    if (!alamat) { gagal(d + ' tidak bisa diterjemahkan'); semua = false; continue; }
    const ip = alamat.map(a => a.address);
    if (ip.every(x => x === '127.0.0.1' || x === '::1')) ok(d + ' -> ' + ip.join(', '));
    else { gagal(d + ' -> ' + ip.join(', ') + '  (bukan komputer ini!)'); semua = false; }
  }
  if (!semua && hasil.hosts) {
    info('hosts sudah benar tapi Windows belum memakainya. Jalankan di');
    info('Command Prompt (Administrator):  ipconfig /flushdns');
    info('Kalau memakai VPN / "Secure DNS" di peramban, matikan dulu.');
  }
  hasil.dns = semua;
}

// ------------------------------------------------------------ lapis 3
async function cekNode() {
  tulis('');
  tulis('3) Server Node (node index.js) di port ' + PORT_NODE);
  const r = await httpGet(http, { host: '127.0.0.1', port: PORT_NODE, path: '/ninja_saga.swf' });
  if (r.error) {
    gagal('tidak menjawab: ' + (r.error.code || r.error.message));
    info('Server belum jalan (atau sudah mati). Jalankan di folder server:');
    info('    node index.js');
    info('lalu biarkan jendelanya terbuka dan jalankan pemeriksa ini lagi.');
    hasil.node = false; return;
  }
  if (r.status === 200) {
    ok('ninja_saga.swf dikirim: ' + ukuran(r.body.length));
    if (r.body.length === 2872142) info('(ini versi hasil patch -- benar)');
    else if (r.body.length === 2873701) info('(ini versi ASLI tanpa patch senjutsu)');
    hasil.node = true;
  } else {
    gagal('menjawab http ' + r.status + ' untuk /ninja_saga.swf');
    info('Periksa berkas C:\\NinjaSaga\\web\\ninja_saga.swf');
    hasil.node = false;
  }
}

// ------------------------------------------------------------ lapis 4
async function cekCaddy() {
  tulis('');
  tulis('4) Caddy (HTTPS) di port 443');
  const buka = await portTerbuka('127.0.0.1', 443);
  if (buka) ok('port 443 terbuka');
  else {
    gagal('port 443 tertutup -- Caddy TIDAK jalan');
    info('Caddy tidak ikut menyala sendiri setelah komputer dinyalakan ulang.');
    info('Jalankan lagi dari folder tempat Caddyfile-mu berada:');
    info('    caddy run');
    info('(atau "caddy start" supaya jalan di latar belakang)');
  }
  hasil.caddy = buka;
}

// ------------------------------------------------------------ lapis 5-6
async function cekHttps() {
  tulis('');
  tulis('5) Sertifikat HTTPS dan berkas lewat https://cdn.ninjasaga.cc');
  const r = await httpGet(https, {
    host: 'cdn.ninjasaga.cc', path: '/ninja_saga.swf',
    servername: 'cdn.ninjasaga.cc', rejectUnauthorized: false,
  });
  if (r.error) {
    gagal('tidak tersambung: ' + (r.error.code || r.error.message));
    hasil.sert = false; hasil.cdn = false; return;
  }

  // sertifikat
  const s = r.sert;
  if (s && s.valid_to) {
    const akhir = new Date(s.valid_to), awal = new Date(s.valid_from), kini = new Date();
    const penerbit = (s.issuer && (s.issuer.CN || s.issuer.O)) || '?';
    if (kini < awal) { gagal('sertifikat belum berlaku (mulai ' + awal.toLocaleString('id-ID') + ') -- jam komputer salah?'); hasil.sert = false; }
    else if (kini > akhir) { gagal('sertifikat KEDALUWARSA sejak ' + akhir.toLocaleString('id-ID')); hasil.sert = false;
      info('Tutup Caddy lalu jalankan lagi -- Caddy memperbarui sertifikatnya saat menyala.'); }
    else { ok('sertifikat berlaku sampai ' + akhir.toLocaleString('id-ID') + '  (penerbit: ' + penerbit + ')'); hasil.sert = true; }
  } else { info('sertifikat tidak terbaca (dilewati)'); hasil.sert = true; }

  tulis('');
  tulis('6) Berkas game lewat HTTPS');
  if (r.status === 200) { ok('https://cdn.ninjasaga.cc/ninja_saga.swf -> ' + ukuran(r.body.length)); hasil.cdn = true; }
  else if (r.status === 502 || r.status === 503 || r.status === 504) {
    gagal('Caddy menjawab http ' + r.status + ' -- Caddy jalan, tapi tidak bisa menghubungi server Node');
    info('Nyalakan server dulu (node index.js), baru buka game.');
    hasil.cdn = false;
  } else { gagal('http ' + r.status); hasil.cdn = false; }
}

// ------------------------------------------------------------ lapis 7
async function cekAmf() {
  tulis('');
  tulis('7) Login uji lewat https://amf.ninjasaga.cc/');
  const body = paketLogin();
  const r = await httpGet(https, {
    host: 'amf.ninjasaga.cc', path: '/', method: 'POST', body,
    servername: 'amf.ninjasaga.cc', rejectUnauthorized: false,
    headers: { 'Content-Type': 'application/x-amf', 'Content-Length': body.length },
  });
  if (r.error) { gagal('tidak tersambung: ' + (r.error.code || r.error.message)); hasil.amf = false; return; }
  if (r.status !== 200) { gagal('http ' + r.status); hasil.amf = false; return; }
  const teks = r.body.toString('latin1');
  if (teks.includes('/1/onResult') && teks.includes('status')) { ok('server menjawab login (' + ukuran(r.body.length) + ')'); hasil.amf = true; }
  else { gagal('jawaban bukan AMF (' + ukuran(r.body.length) + ')'); hasil.amf = false; }
}

// ------------------------------------------------------------ utama
(async () => {
  tulis('Pemeriksa koneksi Ninja Saga -- ' + new Date().toLocaleString('id-ID'));
  tulis('Node ' + process.version + ' di ' + os.platform() + ' ' + os.release());
  tulis('');

  cekHosts();
  await cekDns();
  await cekNode();
  await cekCaddy();
  if (hasil.caddy) { await cekHttps(); await cekAmf(); }

  tulis('');
  tulis('==================================================================');
  const urutan = [
    ['hosts', 'Berkas hosts'], ['dns', 'Nama domain'], ['node', 'Server Node'],
    ['caddy', 'Caddy'], ['sert', 'Sertifikat HTTPS'], ['cdn', 'Berkas lewat HTTPS'],
    ['amf', 'Login lewat HTTPS'],
  ];
  const pertama = urutan.find(([k]) => hasil[k] === false);
  if (!pertama) {
    tulis('KESIMPULAN: semua lapis server SEHAT.');
    tulis('Masalahnya ada di peramban / Flash Player-nya sendiri.');
    tulis('Kirim flashlog.txt dari percobaan membuka game barusan.');
  } else {
    tulis('KESIMPULAN: yang pertama gagal adalah -> ' + pertama[1].toUpperCase());
    tulis('Perbaiki yang itu dulu (petunjuknya ada di atas), lalu jalankan');
    tulis('pemeriksa ini sekali lagi.');
  }
  tulis('==================================================================');

  try {
    fs.writeFileSync(path.join(__dirname, 'cek-koneksi-hasil.txt'), baris.join('\r\n') + '\r\n');
    console.log('\n(hasil ini juga disimpan di cek-koneksi-hasil.txt)');
  } catch { /* abaikan */ }
})();
