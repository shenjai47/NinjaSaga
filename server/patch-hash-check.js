'use strict';
/* Menonaktifkan pemeriksaan extra_data_hash di code_library.swf
 *
 * Di DataParser.parseCharacterData (offset 5891 dalam bytecode method):
 *
 *   getHash(slot21) == result.extra_data_hash ?  lanjut  :  onError(); return false
 *
 * Pemeriksaan ini anti-tamper bawaan game. Di server pribadi offline ia
 * tidak ada gunanya, dan menghalangi karena kita tidak bisa mereproduksi
 * string input-nya persis.
 *
 * Patch: 12 byte jalur gagal (onError + pushfalse + returnvalue) diganti
 * nop. Instruksi ifeq dibiarkan utuh, sehingga kedalaman stack tetap
 * konsisten di kedua cabang dan verifier AVM2 tidak menolak.
 *
 * Ukuran file tidak berubah.
 *
 * Pakai:  node patch-hash-check.js "C:\ninjasaga\web\cdn\swf\latest\swf\library\code_library.swf"
 */

const fs = require('fs');
const zlib = require('zlib');

// getscopeobject 1 | getslot 21 | callproperty getHash 1 | getscopeobject 1 |
// getslot 32 | getproperty extra_data_hash | ifeq +12
const PREFIX = Buffer.from('65016c1546af3a0165016c2066b03a130c0000', 'hex');

// getlex Central | getproperty main | callpropvoid onError 0 | pushfalse | returnvalue
const FAIL = Buffer.from('60d80766d81e4fb13a002748', 'hex');

const NOPS = Buffer.alloc(FAIL.length, 0x02);   // 0x02 = nop

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Pakai: node patch-hash-check.js <path ke code_library.swf>');
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

  const target = Buffer.concat([PREFIX, FAIL]);
  const at = body.indexOf(target);

  if (at === -1) {
    if (body.indexOf(Buffer.concat([PREFIX, NOPS])) !== -1) {
      console.log('File ini SUDAH dipatch. Tidak ada yang diubah.');
      return;
    }
    console.error('Pola tidak ditemukan. Pastikan ini code_library.swf yang benar.');
    process.exit(1);
  }

  if (body.indexOf(target, at + 1) !== -1) {
    console.error('Pola ditemukan lebih dari sekali — dibatalkan demi keamanan.');
    process.exit(1);
  }

  // cadangkan dulu
  const backup = file + '.bak';
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, raw);
    console.log('Cadangan dibuat: ' + backup);
  }

  NOPS.copy(body, at + PREFIX.length);

  const out = sig === 'CWS'
    ? Buffer.concat([Buffer.from('CWS'), Buffer.from([version]),
                     u32(uncLen), zlib.deflateSync(body, { level: 9 })])
    : Buffer.concat([Buffer.from('FWS'), Buffer.from([version]),
                     u32(uncLen), body]);

  fs.writeFileSync(file, out);
  console.log('Selesai. Pemeriksaan extra_data_hash dinonaktifkan.');
  console.log('  posisi patch : ' + (at + PREFIX.length));
  console.log('  ukuran file  : ' + raw.length + ' -> ' + out.length + ' byte');
}

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

main();
