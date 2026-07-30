'use strict';
/* Menonaktifkan dua pemeriksaan hash karakter di parseRawCharacter
 * (code_library.swf).
 *
 * LATAR BELAKANG
 * Selain extra_data_hash, DataParser.parseRawCharacter memverifikasi dua
 * hash lagi terhadap rekaman karakter:
 *
 *   getHash(rangkaian_field) != raw.character_hash
 *       -> Out.error("Character Data Error"); onError(); return null
 *
 *   raw.character_pre_hash != getHash(rangkaian_lain)
 *       -> Out.error("Character Data Error 2"); onError(); return null
 *
 * Keduanya anti-tamper: rangkaian yang di-hash menggabungkan puluhan
 * field dengan urutan persis, yang tidak praktis direproduksi. Kalau
 * gagal, parseRawCharacter mengembalikan null, lalu setMainChar(null)
 * membuat seluruh alur setelahnya runtuh.
 *
 * Di server pribadi offline pemeriksaan ini tidak melindungi apa pun.
 *
 * PATCH
 * Jalur gagal masing-masing (setelah instruksi ifeq) diganti nop:
 *   Out.error(...) | onError() | pushnull | returnvalue
 * Instruksi ifeq dibiarkan utuh sehingga kedalaman stack tetap
 * konsisten di kedua cabang dan verifier AVM2 menerimanya.
 *
 * Ukuran file tidak berubah.
 *
 * Pakai: node patch-char-hash.js "C:\...\library\code_library.swf"
 */

const fs = require('fs');
const zlib = require('zlib');

// masing-masing: [prefix yang dipertahankan, jalur gagal yang di-nop]
const PATCHES = [
  {
    nama: 'character_hash',
    // getscopeobject 1 | getslot 61 | getproperty character_hash | ifeq +23
    prefix: '65016c3d669a3c13170000',
    gagal:  '60d707d02cc2484fca1e0260d80766d81e4fb13a002048',
  },
  {
    nama: 'character_pre_hash',
    prefix: '65016c3d669b3c60d80766d81e65016c3c46af3a0113170000',
    gagal:  '60d707d02cc4484fca1e0260d80766d81e4fb13a002048',
  },
];

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Pakai: node patch-char-hash.js <path ke code_library.swf>');
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

  const backup = file + '.bak3';
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw);

  let n = 0;
  for (const p of PATCHES) {
    const pre  = Buffer.from(p.prefix, 'hex');
    const bad  = Buffer.from(p.gagal, 'hex');
    const nops = Buffer.alloc(bad.length, 0x02);
    const target = Buffer.concat([pre, bad]);

    const at = body.indexOf(target);
    if (at === -1) {
      if (body.indexOf(Buffer.concat([pre, nops])) !== -1) {
        console.log('  ' + p.nama + ': sudah dipatch');
      } else {
        console.log('  ' + p.nama + ': POLA TIDAK DITEMUKAN');
      }
      continue;
    }
    nops.copy(body, at + pre.length);
    console.log('  ' + p.nama + ': dipatch di posisi ' + (at + pre.length) +
                ' (' + bad.length + ' byte -> nop)');
    n++;
  }

  if (!n) { console.log('Tidak ada perubahan.'); return; }

  const out = sig === 'CWS'
    ? Buffer.concat([Buffer.from('CWS'), Buffer.from([version]), u32(uncLen),
                     zlib.deflateSync(body, { level: 9 })])
    : Buffer.concat([Buffer.from('FWS'), Buffer.from([version]), u32(uncLen), body]);

  fs.writeFileSync(file, out);
  console.log('Selesai. Cadangan: ' + backup);
}

main();
