'use strict';
/* Melewati blok expiry item di DataParser.parseRawCharacter
 * (code_library.swf).
 *
 * MASALAH
 * Saat memuat karakter yang sudah tersimpan (tombol Play), parseRawCharacter
 * gagal dengan TypeError #1009 tepat setelah "MARK L: post-bodyset".
 *
 * Dengan membaca tabel exception di bytecode, terlihat kegagalan itu ada di
 * kode yang TIDAK dibungkus try/catch — dan satu-satunya wilayah semacam itu
 * yang berjalan sebelum pemeriksaan hash adalah blok expiry item:
 *
 *   if (Boolean(Central.main.Features.FEATURE_EXPIRY_ITEM) && slot63) {
 *      ... 19 akses berantai ke raw.expiry_data ...
 *   }
 *
 * Fitur ini mengurus item berbatas waktu (item sewa/event) — tidak relevan
 * untuk server pribadi tanpa toko premium.
 *
 * PATCH
 * Kondisi pertama diganti `false`:
 *   pc 3573..3590 (18 byte)  ->  pushfalse + 17 nop
 *
 * Pola `&&` di AS3 berbentuk: <op1> ; dup ; iffalse skip ; pop ; <op2>
 * Dengan op1 = false, `dup` menyalin false, `iffalse` melompat ke
 * pemeriksaan akhir di pc 3602, yang lalu melompat ke pc 4121 —
 * melewati seluruh blok. Jumlah nilai di stack tetap sama seperti
 * kode asli (satu nilai), jadi verifier AVM2 menerimanya.
 *
 * Ukuran file tidak berubah.
 *
 * Pakai: node patch-expiry.js "C:\...\library\code_library.swf"
 */

const fs = require('fs');
const zlib = require('zlib');

// findpropstrict Boolean | getlex Central | getproperty main |
// getproperty Features | getproperty FEATURE_EXPIRY_ITEM |
// callproperty Boolean 1 | convert_b
const BEFORE = Buffer.from('5d0360d80766d81e66ee3b66ef3b46030176', 'hex');

// pushfalse, lalu nop sampai panjangnya sama
const AFTER = Buffer.concat([
  Buffer.from([0x27]),
  Buffer.alloc(BEFORE.length - 1, 0x02),
]);

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Pakai: node patch-expiry.js <path ke code_library.swf>');
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

  const backup = file + '.bak4';
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
  console.log('Selesai. Blok expiry item sekarang dilewati.');
  console.log('  posisi patch : ' + at);
}

main();
