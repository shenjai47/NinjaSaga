'use strict';
/* Melewati Main.updateMapSideBtn() di code_library.swf
 *
 * MASALAH
 * Fungsi ini mengakses mainMc["leftIconUp"], mainMc["leftIconDown"], dst.
 * mainMc adalah root ninja_saga.swf. Tapi di build Anda, objek-objek itu
 * berada DI DALAM sebuah DefineSprite, bukan di timeline root — jadi
 * mainMc.leftIconUp bernilai undefined dan melempar #1010.
 *
 * Ini ketidakcocokan versi antara code_library.swf dan ninja_saga.swf,
 * bukan data server yang salah.
 *
 * PATCH
 * Fungsi ini panjangnya 9780 byte dan berakhir di pc 9779 (returnvoid).
 * Sudah ada percabangan di pc 21 yang melompat ke sana:
 *     if (Mission.curMissionID != null) -> 9779
 *
 * Di pc 10 ada percabangan tak berguna:
 *     pushstring ""        (pc 8)
 *     ifne 0               (pc 10)   <- lompat 0, jadi tidak berefek
 *
 * Kita ubah jadi:
 *     ifeq 9765            -> target 14 + 9765 = 9779
 *
 * Artinya: kalau Battle.bossId == "" (kondisi normal di peta), fungsi
 * langsung selesai. Tombol samping peta tidak disiapkan, tapi peta
 * tetap termuat dan sisa frame22 berjalan.
 *
 * ifeq memakan 2 nilai dari stack persis seperti ifne, dan targetnya
 * instruksi yang sudah ada — jadi kedalaman stack tetap konsisten dan
 * verifier AVM2 menerimanya.
 *
 * Ukuran file tidak berubah.
 *
 * Pakai:  node patch-map-buttons.js "C:\ninjasaga\web\cdn\swf\latest\swf\library\code_library.swf"
 */

const fs = require('fs');
const zlib = require('zlib');

// getlocal_0 | pushscope | getlex Battle | getproperty bossId | pushstring "" | ifne 0
const BEFORE = Buffer.from('d03060fe0766c5222c0314000000', 'hex');
// ...ifeq 9765  (9765 = 0x2625 -> little endian 25 26 00)
const AFTER  = Buffer.from('d03060fe0766c5222c0313252600', 'hex');

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Pakai: node patch-map-buttons.js <path ke code_library.swf>');
    process.exit(1);
  }

  const raw = fs.readFileSync(file);
  const sig = raw.slice(0, 3).toString();
  const version = raw[3];
  const uncLen = raw.readUInt32LE(4);

  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = raw.slice(8);
  else { console.error('Bukan SWF yang dikenal:', sig); process.exit(1); }

  const at = body.indexOf(BEFORE);
  if (at === -1) {
    if (body.indexOf(AFTER) !== -1) {
      console.log('File ini SUDAH dipatch. Tidak ada yang diubah.');
      return;
    }
    console.error('Pola tidak ditemukan. Pastikan ini code_library.swf yang benar.');
    process.exit(1);
  }
  if (body.indexOf(BEFORE, at + 1) !== -1) {
    console.error('Pola ditemukan lebih dari sekali — dibatalkan demi keamanan.');
    process.exit(1);
  }

  const backup = file + '.bak2';
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, raw);
    console.log('Cadangan dibuat: ' + backup);
  }

  AFTER.copy(body, at);

  const out = sig === 'CWS'
    ? Buffer.concat([Buffer.from('CWS'), Buffer.from([version]), u32(uncLen),
                     zlib.deflateSync(body, { level: 9 })])
    : Buffer.concat([Buffer.from('FWS'), Buffer.from([version]), u32(uncLen), body]);

  fs.writeFileSync(file, out);
  console.log('Selesai. updateMapSideBtn() sekarang dilewati.');
  console.log('  posisi patch : ' + at);
}

main();
