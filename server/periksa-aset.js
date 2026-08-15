'use strict';
/* Pemindai aset SWF yang rusak akibat versi lama assetclone.js.
 *
 * Gejala yang dicari: berkas yang TIDAK punya kelas utama senama dengan nama
 * berkasnya (mis. skill_3109.swf tanpa kelas Skill_3109). Berkas seperti ini
 * lolos sebagai "klon berhasil", tapi klien melempar
 *     ERROR :: getAsset :: Skill_3109 :: #1065: Variable Skill_3109 is not defined
 * dan -- karena findDonor memilih berkas terkecil -- berkas rusak itu gampang
 * terpilih jadi donor berikutnya sehingga kerusakannya menular.
 *
 * Pakai:
 *     node periksa-aset.js  C:\NinjaSaga\web\cdn\swf\latest\swf\skills
 *     node periksa-aset.js  <folder>  --hapus     (buang yang rusak)
 *
 * Tanpa --hapus, skrip hanya melaporkan; tidak ada berkas yang disentuh.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

function rectBytes(b) {
  const nbits = b[0] >> 3;
  return Math.ceil((5 + nbits * 4) / 8);
}

function bodyOf(raw) {
  const sig = raw.slice(0, 3).toString();
  if (sig === 'CWS') return zlib.inflateSync(raw.slice(8));
  if (sig === 'FWS') return raw.slice(8);
  throw new Error('bukan SWF (' + sig + ')');
}

/* Nama-nama simbol di tag SymbolClass (code 76). */
function symbolNames(raw) {
  const body = bodyOf(raw);
  let off = rectBytes(body) + 4;
  const names = [];
  while (off < body.length - 1) {
    const th = body.readUInt16LE(off); off += 2;
    const code = th >> 6;
    let len = th & 0x3F;
    if (len === 0x3F) { len = body.readUInt32LE(off); off += 4; }
    if (code === 76) {
      const d = body.slice(off, off + len);
      const cnt = d.readUInt16LE(0);
      let i = 2;
      for (let k = 0; k < cnt; k++) {
        i += 2;
        const e = d.indexOf(0, i);
        if (e === -1) break;
        names.push(d.slice(i, e).toString('utf8'));
        i = e + 1;
      }
    }
    off += len;
    if (code === 0) break;
  }
  return names;
}

const dir = process.argv[2];
const hapus = process.argv.includes('--hapus');

if (!dir) {
  console.log('pakai: node periksa-aset.js <folder> [--hapus]');
  process.exit(1);
}
if (!fs.existsSync(dir)) {
  console.log('folder tidak ada: ' + dir);
  process.exit(1);
}

const berkas = fs.readdirSync(dir).filter(x => x.toLowerCase().endsWith('.swf'));
let baik = 0;
let lewat = 0;
const rusak = [];

for (const f of berkas) {
  const p = path.join(dir, f);
  const base = path.basename(f, '.swf');
  const harusnya = base.charAt(0).toUpperCase() + base.slice(1);

  // Berkas pustaka (code_library, client_library, network_library, popup, en,
  // data_library_en, ninja_saga, facebook_connector) BUKAN aset klon: kelasnya
  // CamelCase tanpa garis bawah dan sering ber-namespace, mis.
  //     code_library.swf -> ninjasaga.linkage.CodeLibrary
  // Aturan "nama berkas + huruf besar di depan" hanya berlaku untuk aset
  // (skill_/npc_/back_/set_/item_/hair_/acsy_). Tanpa pengecualian ini
  // pemindai menandai pustaka sebagai rusak dan --hapus akan membuangnya.
  if (!/^(skill|npc|back|set|item|hair|acsy|wpn|pet|icon)_/i.test(base)) {
    lewat++;
    continue;
  }
  let names;
  try {
    names = symbolNames(fs.readFileSync(p));
  } catch (e) {
    rusak.push({ f, sebab: e.message, names: [] });
    continue;
  }
  if (!names.length) {
    rusak.push({ f, sebab: 'tanpa SymbolClass (stub kosong?)', names });
    continue;
  }
  if (names.some(n => n === harusnya)) { baik++; continue; }

  // salah huruf besar/kecil -> inilah bug versi lama
  const mirip = names.find(n => n.toLowerCase() === base.toLowerCase());
  rusak.push({
    f,
    sebab: mirip ? 'kelas bernama "' + mirip + '", seharusnya "' + harusnya + '"'
                 : 'tidak ada kelas "' + harusnya + '"',
    names,
  });
}

console.log('folder : ' + dir);
console.log('berkas : ' + berkas.length + '   baik: ' + baik +
            '   dilewati (bukan aset): ' + lewat +
            '   bermasalah: ' + rusak.length);
console.log('');

for (const r of rusak) {
  console.log('  ' + r.f);
  console.log('      ' + r.sebab);
  console.log('      simbol: ' + (r.names.join(', ') || '(kosong)'));
  if (hapus) {
    try { fs.unlinkSync(path.join(dir, r.f)); console.log('      -> DIHAPUS'); }
    catch (e) { console.log('      -> gagal hapus: ' + e.message); }
  }
}

if (rusak.length && !hapus) {
  console.log('');
  console.log('Jalankan ulang dengan --hapus untuk membuang berkas di atas.');
  console.log('Server akan mengklon ulang otomatis saat berkasnya diminta lagi.');
}
