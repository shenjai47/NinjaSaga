'use strict';
/* Pembuat SWF pengganti (stub) untuk aset yang hilang.
 *
 * Menghasilkan SWF AS3 minimal yang sah, berisi satu sprite kosong
 * yang diekspor dengan nama kelas sesuai nama file. Flash Player akan
 * membuat kelasnya otomatis (turunan MovieClip), sehingga klien bisa
 * memuatnya tanpa error meski gambarnya kosong.
 */

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

function tag(code, body) {
  if (body.length < 0x3F) {
    return Buffer.concat([u16((code << 6) | body.length), body]);
  }
  return Buffer.concat([u16((code << 6) | 0x3F), u32(body.length), body]);
}

// RECT 0 0 0 0 dengan nbits=1  ->  satu byte 0x08 lalu padding
const RECT = Buffer.from([0x08, 0x00]);

/* SWF kosong yang sah, TANPA tag SymbolClass.
 *
 * Kenapa tanpa SymbolClass: Flash menautkan nama SymbolClass ke kelas
 * ABC pada saat memuat. Stub tidak punya ABC, jadi setiap nama yang
 * dicantumkan langsung memicu "ReferenceError #1065: Variable X is not
 * defined" — padahal aset itu mungkin cuma hiasan.
 *
 * Tanpa SymbolClass, file dimuat diam-diam. Klien memanggil
 * getAsset(...) yang gagal menemukan kelas, tapi getAsset sudah
 * membungkusnya dengan try/catch dan mengembalikan null. Tidak ada
 * exception yang mengganggu alur.
 *
 * Stub hanya jaring pengaman terakhir. Untuk aset yang benar-benar
 * dibutuhkan, pakai kloning (assetclone.js / make-asset.js).
 */
function buildStub() {
  const body = Buffer.concat([
    RECT,
    u16(24 << 8),                            // framerate 24 (8.8 fixed)
    u16(1),                                  // jumlah frame
    tag(69, Buffer.from([0x08, 0, 0, 0])),   // FileAttributes: ActionScript3
    tag(9, Buffer.from([0xFF, 0xFF, 0xFF])), // warna latar
    tag(1, Buffer.alloc(0)),                 // ShowFrame
    tag(0, Buffer.alloc(0)),                 // End
  ]);

  return Buffer.concat([
    Buffer.from('FWS'),
    Buffer.from([10]),
    u32(8 + body.length),
    body,
  ]);
}

module.exports = { buildStub };
