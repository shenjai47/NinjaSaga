'use strict';
/* Kloning aset SWF: menyalin SWF donor dan mengganti nama kelasnya.
 *
 * Dipakai server untuk menambal aset yang hilang. SWF stub kosong tidak
 * bisa dipakai karena klien memanggil applicationDomain.getDefinition(nama),
 * yang mensyaratkan kelasnya benar-benar ada di bytecode ABC. Donor asli
 * punya ABC lengkap, jadi cukup diganti namanya.
 */

const zlib = require('zlib');

// ---------- util SWF ----------
function rectBytes(b) {
  const nbits = b[0] >> 3;
  return Math.ceil((5 + nbits * 4) / 8);
}

function readTags(body) {
  let off = rectBytes(body) + 4;          // rect + framerate + framecount
  const out = [];
  while (off < body.length - 1) {
    const th = body.readUInt16LE(off); off += 2;
    const code = th >> 6;
    let len = th & 0x3F;
    let longForm = false;
    if (len === 0x3F) { len = body.readUInt32LE(off); off += 4; longForm = true; }
    out.push({ code, longForm, data: body.slice(off, off + len) });
    off += len;
    if (code === 0) break;
  }
  return { head: body.slice(0, rectBytes(body) + 4), tags: out };
}

function writeTags(head, tags) {
  const parts = [head];
  for (const t of tags) {
    if (t.data.length < 0x3F && !t.longForm) {
      const h = Buffer.alloc(2);
      h.writeUInt16LE((t.code << 6) | t.data.length);
      parts.push(h, t.data);
    } else {
      const h = Buffer.alloc(6);
      h.writeUInt16LE((t.code << 6) | 0x3F);
      h.writeUInt32LE(t.data.length, 2);
      parts.push(h, t.data);
    }
  }
  return Buffer.concat(parts);
}

function u30(n) {
  const out = [];
  do { let b = n & 0x7F; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}

// ---------- baca nama kelas dari SymbolClass ----------
function symbolNames(d) {
  const cnt = d.readUInt16LE(0);
  let i = 2; const out = [];
  for (let k = 0; k < cnt; k++) {
    const id = d.readUInt16LE(i); i += 2;
    const e = d.indexOf(0, i);
    out.push({ id, name: d.slice(i, e).toString('utf8'), at: i });
    i = e + 1;
  }
  return out;
}

// ---------- ganti nama di tag SymbolClass ----------
function renameSymbol(d, oldName, newName) {
  const cnt = d.readUInt16LE(0);
  let i = 2;
  const parts = [d.slice(0, 2)];
  let changed = 0;
  for (let k = 0; k < cnt; k++) {
    const idBuf = d.slice(i, i + 2); i += 2;
    const e = d.indexOf(0, i);
    let nm = d.slice(i, e).toString('utf8');
    i = e + 1;
    if (nm === oldName) { nm = newName; changed++; }
    parts.push(idBuf, Buffer.from(nm, 'utf8'), Buffer.from([0]));
  }
  return { data: Buffer.concat(parts), changed };
}

// ---------- ganti nama di string pool ABC ----------
function renameInAbc(d, oldName, newName) {
  const ob = Buffer.from(oldName, 'utf8');
  const nb = Buffer.from(newName, 'utf8');
  const pat = Buffer.concat([u30(ob.length), ob]);
  const rep = Buffer.concat([u30(nb.length), nb]);

  let changed = 0;
  let out = d;
  for (;;) {
    const at = out.indexOf(pat);
    if (at === -1) break;
    out = Buffer.concat([out.slice(0, at), rep, out.slice(at + pat.length)]);
    changed++;
    if (changed > 50) break;   // pengaman
  }
  return { data: out, changed };
}


function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

/* Menghasilkan Buffer SWF baru dari donor, dengan kelas bernama newName.
 * Melempar Error kalau donor tidak cocok.
 */
function cloneFrom(raw, newName, donorBase) {
  const sig = raw.slice(0, 3).toString();
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = raw.slice(8);
  else throw new Error('bukan SWF: ' + sig);

  const { head, tags } = readTags(body);
  const sc = tags.find(t => t.code === 76);
  if (!sc) throw new Error('donor tanpa SymbolClass');

  const all = symbolNames(sc.data);
  if (!all.length) throw new Error('donor tanpa simbol');

  // Memilih simbol mana yang diganti namanya.
  //
  // SymbolClass sebuah aset skill berisi DUA simbol, dan urutannya menjebak:
  //     id=109  icon          <- sprite ikon, kebetulan yang PERTAMA
  //     id=100  Skill_3110    <- kelas utama, ini yang dicari getAsset()
  //
  // Versi lama jatuh ke kandidat[0] kalau pencocokan nama berkas meleset,
  // sehingga yang diganti nama malah `icon`. Lebih buruk lagi: karena `icon`
  // diawali huruf kecil, penyeragaman huruf besar tidak pernah jalan, jadi
  // hasilnya kelas bernama `skill_3109` sementara klien meminta `Skill_3109`
  // -> "#1065: Variable Skill_3109 is not defined", sedangkan kelas asli
  // (Skill_3110) tetap utuh dengan nama lamanya.
  //
  // Kegagalan itu diam-diam: berkasnya tetap tertulis dan tercatat sebagai
  // klon berhasil, lalu ikut terpilih jadi donor untuk klon berikutnya --
  // kerusakannya menular. Karena itu sekarang lebih baik MELEMPAR error
  // daripada menghasilkan berkas salah nama; findDonor akan mencoba donor lain.
  const GENERIK = new Set(['icon', 'holder', 'model', 'loader', 'main', 'ninjasaga']);
  const bukanFla = all.filter(s => !s.name.includes('_fla.'));
  const layak = bukanFla.filter(s => !GENERIK.has(s.name.toLowerCase()));
  const kandidat = layak.length ? layak : bukanFla;

  // Kelas utama sebuah aset SELALU diawali huruf besar (Skill_3110, Npc_2),
  // jadi pencarian dibatasi ke sana lebih dulu -- bukan sekadar mencocokkan
  // nama berkas. Ini penting: sebuah berkas rusak hasil klon lama bisa punya
  // simbol `skill_1004` (huruf kecil, bekas `icon` yang salah diganti nama)
  // DI SAMPING kelas asli `Skill_3110`. Mencocokkan nama berkas saja akan
  // memilih yang huruf kecil itu dan menularkan kerusakannya ke klon baru.
  const utama = kandidat.filter(x => /^[A-Z]/.test(x.name));
  if (!utama.length) {
    throw new Error('donor tanpa kelas utama berhuruf besar (simbol: ' +
                    all.map(x => x.name).join(', ') + ')');
  }

  let pilih = null;
  if (donorBase) {
    const base = String(donorBase).toLowerCase();
    pilih = utama.find(x => x.name.toLowerCase() === base) ||
            utama.find(x => x.name.toLowerCase().endsWith(base));
  }
  if (!pilih) pilih = utama.find(x => x.id === 0);
  if (!pilih) pilih = utama[0];

  const oldName = pilih.name;

  // Samakan pola huruf besar/kecil dengan kelas utama donor: donor memakai
  // "Skill_3110" sedangkan nama yang diminta datang dari nama berkas
  // ("skill_3109"), padahal getAsset() mencari "Skill_3109".
  let namaBaru = newName;
  if (/^[A-Z]/.test(oldName) && !/^[A-Z]/.test(namaBaru)) {
    namaBaru = namaBaru.charAt(0).toUpperCase() + namaBaru.slice(1);
  }

  const abcOld = oldName.split('.').pop();
  const abcNew = namaBaru.split('.').pop();

  let sc1 = 0, abc1 = 0;
  for (const t of tags) {
    if (t.code === 76) { const r = renameSymbol(t.data, oldName, namaBaru); t.data = r.data; sc1 += r.changed; }
    else if (t.code === 82) { const r = renameInAbc(t.data, abcOld, abcNew); t.data = r.data; abc1 += r.changed; }
  }
  if (!sc1 || !abc1) throw new Error('gagal mengganti nama ' + oldName + ' -> ' + namaBaru +
                                     ' (SymbolClass ' + sc1 + 'x, ABC ' + abc1 + 'x)');

  const nb = writeTags(head, tags);
  return sig === 'CWS'
    ? Buffer.concat([Buffer.from('CWS'), Buffer.from([version]), u32(8 + nb.length), zlib.deflateSync(nb, { level: 9 })])
    : Buffer.concat([Buffer.from('FWS'), Buffer.from([version]), u32(8 + nb.length), nb]);
}

module.exports = { cloneFrom };
