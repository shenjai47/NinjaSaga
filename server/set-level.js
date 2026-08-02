'use strict';
/* Alat bantu: atur level karakter secara aman.
 *
 * Level TIDAK diedit langsung -- server selalu menghitungnya ulang dari
 * xp lewat normalizeLevel(), supaya tidak pernah menyimpang dari nilai
 * yang dihitung klien sendiri (Formula.getLvByXp). Menaruh angka level
 * yang tidak cocok dengan xp pernah menyebabkan layar "Play" macet.
 *
 * Skrip ini:
 *   1. Menghitung xp minimal untuk level target (xpForLevel, sama
 *      persis dengan rumus di chardata.js / klien).
 *   2. Menyamakan hp, cp, agi dengan rumus addProgress() supaya
 *      statistik tidak tertinggal di belakang level.
 *
 * PENTING: matikan Node dulu sebelum menjalankan ini, lalu restart
 * sesudahnya -- supaya tidak ada dua proses menulis characters.json
 * bersamaan.
 *
 * Pemakaian (dari folder server, sejajar dengan characters.json):
 *   node set-level.js 20
 */

const fs = require('fs');
const path = require('path');

const target = parseInt(process.argv[2], 10);
if (!target || target < 1) {
  console.log('Pemakaian: node set-level.js <level target, mis. 20>');
  process.exit(1);
}

const DB = path.join(__dirname, 'characters.json');
if (!fs.existsSync(DB)) {
  console.log('characters.json tidak ditemukan di: ' + DB);
  console.log('Jalankan skrip ini dari folder server yang sama dengan index.js.');
  process.exit(1);
}

function xpForLevel(lv) {
  let total = 0;
  for (let i = 1; i < lv; i++) total += Math.round(i * 130 * Math.pow(50, i / 50));
  return total;
}

const all = JSON.parse(fs.readFileSync(DB, 'utf8'));
const key = Object.keys(all)[0];
if (!key) {
  console.log('Tidak ada karakter di characters.json.');
  process.exit(1);
}

const c = all[key];
const lamaLevel = c.level;
const lamaXp = c.xp;

c.xp    = xpForLevel(target);
c.level = target;                     // konsisten dengan xp di atas
c.hp    = 100 + (target - 1) * 40;
c.cp    = 100 + (target - 1) * 40;
c.agi   = 1   + (target - 1);

// cadangan sebelum menulis, seperti yang dilakukan chardata.js sendiri
fs.copyFileSync(DB, DB + '.bak');
fs.writeFileSync(DB, JSON.stringify(all, null, 2));

console.log('Karakter "' + (c.name || key) + '" diubah:');
console.log('  level  : ' + lamaLevel + '  ->  ' + c.level);
console.log('  xp     : ' + lamaXp    + '  ->  ' + c.xp);
console.log('  hp/cp  : ' + c.hp + ' / ' + c.cp);
console.log('  agi    : ' + c.agi);
console.log('');
console.log('Cadangan lama disimpan di characters.json.bak');
console.log('Sekarang jalankan Node seperti biasa.');
