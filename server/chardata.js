'use strict';
/* Penyimpanan karakter + penyusun respons CharacterDAO.getExtraData
 *
 * Field di bawah ini diturunkan dari pembongkaran DataParser.parseCharacterData.
 * Yang diakses berantai (mis. file_1.length, training_skill.id) WAJIB berupa
 * objek/array — kalau null, klien melempar TypeError #1009.
 */

const fs = require('fs');
const path = require('path');

const DB  = path.join(__dirname, 'characters.json');
const TMP = DB + '.tmp';
const BAK = DB + '.bak';

/* ---------------------------------------------------------------
 * Penyimpanan
 *
 * Versi lama memakai pola baca-ubah-tulis dengan `catch { return {} }`.
 * Akibatnya SATU kali gagal baca (file dikunci Notepad, antivirus lewat,
 * tulis sebelumnya terpotong) membuat load() mengembalikan objek kosong,
 * dan save() berikutnya MENIMPA seluruh isi file tanpa sepatah pesan pun.
 * Di createCharacter efeknya paling telak, karena id dihitung dari
 * Object.keys(all).length + 1 -> karakter lama tertimpa oleh id "1" baru.
 *
 * Empat pengaman di bawah ini:
 *   1. Dibaca SEKALI saat startup, lalu dilayani dari memori.
 *   2. "File tidak ada" (instalasi baru, wajar) dibedakan dari
 *      "file tidak terbaca" (bahaya) -- yang kedua MEMATIKAN penyimpanan.
 *   3. Tulis atomik lewat .tmp + rename, dengan cadangan .bak, dan
 *      pemulihan otomatis dari .bak kalau JSON utamanya rusak.
 *   4. Penolakan menyimpan objek kosong kalau di memori masih ada karakter.
 * --------------------------------------------------------------- */

let cache = null;        // sumber kebenaran selama proses hidup
let bolehSimpan = false; // false = disk dibekukan demi keselamatan data

function pesan(baris) {
  for (const b of baris) console.log(b);
}

function bacaJson(file) {
  const teks = fs.readFileSync(file, 'utf8');
  if (!teks.trim()) throw new Error('file kosong');
  const obj = JSON.parse(teks);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('isi bukan objek');
  }
  return obj;
}

function bootLoad() {
  if (!fs.existsSync(DB)) {
    cache = {};
    bolehSimpan = true;
    console.log('### characters.json belum ada -- mulai dari kosong.');
    return;
  }

  // 1) coba file utama
  try {
    cache = bacaJson(DB);
    bolehSimpan = true;
    console.log('### characters.json dimuat: ' +
                Object.keys(cache).length + ' karakter.');
    return;
  } catch (e) {
    pesan([
      '',
      '!! characters.json TIDAK BISA DIBACA: ' + e.message,
    ]);
  }

  // 2) coba cadangan
  if (fs.existsSync(BAK)) {
    try {
      cache = bacaJson(BAK);
      bolehSimpan = true;
      pesan([
        '   Dipulihkan dari characters.json.bak: ' +
          Object.keys(cache).length + ' karakter.',
        '   File utama akan ditulis ulang pada perubahan berikutnya.',
        '',
      ]);
      return;
    } catch (e2) {
      pesan(['   Cadangan .bak juga tidak terbaca: ' + e2.message]);
    }
  }

  // 3) menyerah -- bekukan disk, jangan timpa apa pun
  cache = {};
  bolehSimpan = false;
  pesan([
    '   PENYIMPANAN DIMATIKAN untuk sesi ini.',
    '   Progres tidak akan tersimpan, tapi isi file lama TIDAK ditimpa.',
    '   Periksa/selamatkan file itu dulu, lalu jalankan ulang server.',
    '',
  ]);
}

function load() {
  if (cache === null) bootLoad();
  return cache;
}

function save(all) {
  // Pemanggil selalu mengoper hasil load() yang sudah diubah, jadi objek
  // ini otomatis menjadi kondisi terbaru di memori.
  if (all && typeof all === 'object') cache = all;

  if (!bolehSimpan) {
    console.log('   [simpan dilewati] disk dibekukan sejak startup.');
    return;
  }

  // Penjaga anti-kosong: tidak ada fitur hapus karakter di server ini,
  // jadi permintaan menulis {} saat sebelumnya ada isi pasti bug.
  if (Object.keys(cache).length === 0 && fs.existsSync(DB)) {
    try {
      if (Object.keys(bacaJson(DB)).length > 0) {
        console.log('   [simpan DITOLAK] mencoba menulis kosong padahal ' +
                    'file berisi karakter.');
        return;
      }
    } catch { /* file utama memang sudah tidak sehat, lanjut saja */ }
  }

  try {
    if (fs.existsSync(DB)) fs.copyFileSync(DB, BAK);
    fs.writeFileSync(TMP, JSON.stringify(cache, null, 2));
    fs.renameSync(TMP, DB);   // atomik: file utama tidak pernah setengah jadi
  } catch (e) {
    console.log('   !! gagal menyimpan characters.json: ' + e.message);
    console.log('      Data masih utuh di memori; perubahan berikutnya ' +
                'akan mencoba lagi.');
  }
}

// createCharacter(sessionKey, nama, gender, ?, warnaKulit, rambut, wajah)
function createCharacter(args) {
  const all = load();
  const id = String(Object.keys(all).length + 1);
  const c = {
    character_id: id,
    id,
    name: args[1] || 'Ninja',
    gender: Number(args[2]) || 0,
    element: Number(args[3]) || 0,
    skin_color: Number(args[4]) || 0,
    hair: String(args[5] || '01_0'),
    face: String(args[6] || '01_0'),

    level: 1,
    xp: 0,
    // RankData.GENIN = 1. Bangunan pet shop dan bloodline (talent) muncul
    // di peta hanya kalau level >= 20 ATAU rank >= GENIN — lihat komentar
    // panjang di dekat pemakaiannya di rawCharacter/databaseCharacter.
    // Genin sudah cukup untuk membuka keduanya sejak awal, tanpa menunggu
    // level 20.
    rank: 1,
    gold: 500,
    token: 0,
    crystal: 0,
    premium: 0,

    hp: 100, cp: 100,
    str: 1, agi: 1, sta: 1, chakra: 1, intel: 1,
    ap: 0,
    // Poin elemen [api, air, angin, tanah, petir]. Klien mengirim TOTAL
    // absolutnya lewat CharacterDAO.updateAP, bukan selisih.
    elements: [0, 0, 0, 0, 0],
    // Skill yang sudah dipelajari. Disimpan sebagai id numerik telanjang.
    // CharacterBase.getSkillListArr() memeriksa tiap entri:
    //     if (arr[i] == null)  -> daftar dianggap rusak
    //     if (arr[i] < 0 || arr[i] > 5)  -> jalur "skill talent"
    //     if (SKILL_DATA[arr[i]] == null) -> dianggap id skill, dipakai
    // Jadi angka > 5 yang ada di SKILL_DATA diperlakukan sebagai skill biasa.
    skills: [],
    // Perlengkapan terpasang. Diisi CharacterDAO.equipCharacter, dibaca ulang
    // saat login lewat character_weapon/character_equipped_weapon dst.
    // Bentuk args[2..6] belum sepenuhnya terverifikasi bytecode (lihat
    // komentar di handler index.js) -- disimpan apa adanya sebagai string.
    equip: { weapon: '', bodySet: '', backItem: '', accessory: '' },
    // Daftar id item numerik. parseRawCharacter memecah character_item dengan
    // "," lalu MENAMBAHKAN awalan "item" ke tiap potongan — jadi yang disimpan
    // angkanya saja ("1,2,3"), bukan "item1,item2,item3".
    items: [],

    created: Math.floor(Date.now() / 1000),
  };
  all[id] = c;
  save(all);
  return c;
}

/* Level HARUS selalu sama dengan hasil rumus dari xp.
 *
 * Character.verifyLevel() di klien berbunyi:
 *     var lv:int = Formula.getLvByXp(this.xp);
 *     if (lv != this.dbChar.character_level) {
 *         this.dbChar.character_level = lv;
 *         this.restoreOriginalStatus();      // <- jalur ini rusak
 *     }
 * dan restoreOriginalStatus() -> maxHP -> Formula.calcHP() -> getWeapon()
 * melempar #1009, sehingga setMainChar() mati dan layar Play membeku.
 *
 * Selama level yang kita kirim cocok dengan rumusnya, cabang itu tidak pernah
 * dimasuki. Rumus getLvByXp() di bawah sudah identik dengan milik klien
 * (Formula.getLvByXp), jadi cukup pastikan record-nya tidak melenceng.
 */
/* Pembersihan inventaris warisan.
 *
 * Versi addItem() yang lama memasukkan SEMUA pembelian ke `items`, dengan
 * awalannya masih menempel — jadi senjata tersimpan sebagai "wpn2" di dalam
 * daftar barang habis pakai, bukan sebagai "2" di dalam `weapons`.
 * Akibatnya character_weapon dikirim kosong dan inventaris senjata di klien
 * ikut kosong (log klien: "test charInvArr = ").
 *
 * Fungsi ini memindahkan entri semacam itu ke kantong yang benar, sekali
 * jalan saat karakter dimuat. Entri yang sudah berupa angka dibiarkan.
 */
/* Pengaman + diagnostik inventaris.
 *
 * Kategori perlengkapan (senjata, baju, back item, aksesori, rambut) tidak
 * pernah bertumpuk di Ninja Saga: satu id = satu keping. Kalau entri ganda
 * sempat masuk — dari pembelian yang terkirim dua kali, migrasi lama, atau
 * penyuntingan manual — jumlah di panel gear ikut tampil ganda, karena klien
 * menghitung kuantitas dari BANYAKNYA entri di dalam character_weapon dsb.
 *
 * Barang habis pakai (`items`) sengaja TIDAK di-dedupe: menumpuk memang wajar.
 *
 * Baris ringkasan di bawah dicetak tiap kali karakter dimuat, supaya kalau
 * angka di layar masih tidak cocok, log server langsung menunjukkan apakah
 * penyebabnya ada di sini atau di sisi klien.
 */
const KATEGORI_UNIK = ['weapons', 'bodysets', 'backitems', 'accessories', 'hairs'];

function rapikanInventaris(c) {
  if (!c) return c;
  let dibuang = 0;

  for (const nama of KATEGORI_UNIK) {
    if (!Array.isArray(c[nama])) continue;
    const unik = [];
    for (const e of c[nama]) {
      const v = String(e);
      if (unik.includes(v)) dibuang++;
      else unik.push(v);
    }
    c[nama] = unik;
  }

  if (dibuang) {
    console.log('### inventaris: ' + dibuang + ' entri ganda dibuang');
    const all = load();
    const key = Object.keys(all)[0];
    if (key) { all[key] = c; save(all); }
  }

  const ring = ['items', ...KATEGORI_UNIK]
    .map(n => n + '=' + (Array.isArray(c[n]) ? c[n].length : 0))
    .join('  ');
  console.log('### inventaris: ' + ring);
  return c;
}

function migrasiInventaris(c) {
  if (!c || !Array.isArray(c.items)) return c;

  const sisa = [];
  let pindah = 0;
  for (const e of c.items) {
    const k = kantongDari(String(e));
    if (k && k.bag !== 'items') {
      if (!Array.isArray(c[k.bag])) c[k.bag] = [];
      if (!c[k.bag].includes(k.num)) c[k.bag].push(k.num);
      pindah++;
    } else {
      sisa.push(String(e).replace(/^item/, ''));
    }
  }

  if (pindah) {
    c.items = sisa;
    console.log('### inventaris dibersihkan: ' + pindah +
                ' entri dipindah ke kantong yang benar');
    const all = load();
    const key = Object.keys(all)[0];
    if (key) { all[key] = c; save(all); }
  }
  return c;
}

function normalizeLevel(c) {
  if (!c) return c;
  let berubah = false;

  const benar = getLvByXp(Number(c.xp) || 0);
  if (Number(c.level) !== benar) {
    console.log('### level tidak konsisten: tersimpan ' + c.level +
                ', dari xp=' + (c.xp || 0) + ' seharusnya ' + benar +
                ' -> diperbaiki');
    c.level = benar;
    berubah = true;
  }

  // Susulkan rank untuk karakter yang sudah menuntaskan ujian SEBELUM
  // perhitungan rank ada, atau kalau datanya pernah tersimpan tanpa rank.
  const rankBenar = hitungRank(c);
  if (Number(c.rank != null ? c.rank : 1) !== rankBenar) {
    console.log('### rank disesuaikan dari riwayat ujian: ' +
                (c.rank != null ? c.rank : 1) + ' -> ' + rankBenar);
    c.rank = rankBenar;
    berubah = true;
  }

  if (berubah) {
    const all = load();
    // tulis ke karakter yang BENAR: cocokkan lewat character_id, bukan
    // asal karakter pertama (yang salah sasaran begitu ada karakter kedua)
    const key = Object.prototype.hasOwnProperty.call(all, String(c.character_id))
      ? String(c.character_id)
      : Object.keys(all)[0];
    if (key) {
      all[key].level = c.level;
      all[key].rank  = c.rank;
      save(all);
    }
  }
  return c;
}

/* ---- karakter aktif ----------------------------------------------------
 * Server ini semula selalu memakai karakter PERTAMA (Object.keys(all)[0])
 * untuk semua penyimpanan progres. Begitu ada karakter kedua, semua progres
 * (xp, gold, misi, statistik) tetap tertulis ke karakter pertama, sehingga
 * karakter yang sedang dimainkan seolah tidak pernah menyimpan apa pun.
 *
 * `activeId` diisi saat klien memanggil CharacterDAO.getCharacterById
 * (argumen ke-2 = id karakter yang dipilih di layar Select Character),
 * lalu dipakai semua fungsi penyimpanan di bawah.
 */
let activeId = null;

function setActiveCharacter(id) {
  const all = load();
  const key = String(id);
  if (Object.prototype.hasOwnProperty.call(all, key)) {
    activeId = key;
    return key;
  }
  return null;
}

function getActiveId() { return activeId; }

/* Kunci karakter yang harus ditulis: yang sedang aktif, atau karakter
 * pertama kalau klien belum sempat memilih (mis. tepat setelah createCharacter). */
function activeKey(all) {
  if (activeId != null && Object.prototype.hasOwnProperty.call(all, activeId)) return activeId;
  return Object.keys(all)[0];
}

function characterById(id) {
  const all = load();
  const c = all[String(id)];
  return c ? rapikanInventaris(migrasiInventaris(normalizeLevel(c))) : null;
}

function firstCharacter() {
  const all = load();
  const keys = Object.keys(all);
  return keys.length ? rapikanInventaris(migrasiInventaris(normalizeLevel(all[keys[0]]))) : null;
}

function listCharacters() {
  const all = load();
  return Object.keys(all).map(k => all[k]);
}

const DB_TYPES = {
  "account_id": "uint",
  "add_inv_arr": "Array",
  "bloodline": "Array",
  "character_armor": "uint",
  "character_bloodline": "String",
  "character_body_parts": "Object",
  "character_body_set": "String",
  "character_chakra": "uint",
  "character_control": "uint",
  "character_cp": "uint",
  "character_earth": "uint",
  "character_equipped_back_item": "String",
  "character_equipped_trade_back_item": "String",
  "character_equipped_trade_body_set": "String",
  "character_equipped_trade_weapon": "String",
  "character_equipped_weapon": "String",
  "character_eye_color": "Number",
  "character_face": "String",
  "character_fire": "uint",
  "character_gender": "uint",
  "character_genjutsu": "uint",
  "character_gold": "uint",
  "character_hair": "String",
  "character_hair_color": "Array",
  "character_hash": "*",
  "character_hp": "uint",
  "character_id": "*",
  "character_intelligence": "uint",
  "character_inventory": "Object",
  "character_level": "uint",
  "character_lightning": "uint",
  "character_max_cp": "uint",
  "character_max_hp": "uint",
  "character_max_sp": "uint",
  "character_name": "String",
  "character_pet_cp": "uint",
  "character_pet_ep": "uint",
  "character_pet_max_cp": "uint",
  "character_pet_max_ep": "uint",
  "character_rank": "uint",
  "character_senjutsu": "Array",
  "character_senjutsu_ss": "String",
  "character_skill_resistance": "Array",
  "character_skill_resistance_unallocated": "uint",
  "character_skill_talent": "Array",
  "character_skill_unallocated": "uint",
  "character_skills": "Array",
  "character_skin_color": "Number",
  "character_sp": "uint",
  "character_speed": "uint",
  "character_stamina": "uint",
  "character_strength": "uint",
  "character_summon": "uint",
  "character_taijutsu": "uint",
  "character_trade_item": "String",
  "character_water": "uint",
  "character_wind": "uint",
  "character_xp": "uint",
  "current_expiry_arr": "Array",
  "damage_cp": "int",
  "damage_hp": "int",
  "damage_sp": "int",
  "equip_arr": "Array",
  "expired_pet_arr": "Array",
  "inv_slots_obj": "Object",
  "remove_equip_arr": "Array",
  "remove_inv_arr": "Array",
  "restore_cp": "int",
  "restore_hp": "int",
  "restore_sp": "int",
  "senjutsu": "Array",
  "session_playtime": "int"
};

/* Memeriksa rekaman terhadap tipe deklarasi DBCharacter.
 * Mengembalikan daftar ketidakcocokan (kosong = semua benar).
 */
function validate(rec) {
  const bad = [];
  for (const k of Object.keys(DB_TYPES)) {
    const ty = DB_TYPES[k];
    const v = rec[k];
    let ok;
    if (ty === 'Array')       ok = Array.isArray(v);
    else if (ty === 'String') ok = typeof v === 'string';
    else if (ty === 'Object') ok = v !== null && typeof v === 'object';
    else if (ty === '*')      ok = true;
    else                      ok = typeof v === 'number';
    if (!ok) {
      const jenis = Array.isArray(v) ? 'Array' : (v === null ? 'null' : typeof v);
      bad.push(k + ': butuh ' + ty + ', dikirim ' + jenis + ' (' + JSON.stringify(v) + ')');
    }
  }
  // field yang dikirim tapi tidak dikenal DBCharacter
  for (const k of Object.keys(rec)) {
    if (!(k in DB_TYPES)) bad.push('field asing: ' + k);
  }
  return bad;
}

/* Rekaman karakter untuk klien.
 *
 * Nama DAN tipe field diambil langsung dari kelas ninjasaga.dbclass::DBCharacter
 * di code_library.swf. Tipe itu penting: klien melakukan `coerce Array` tanpa
 * pengaman pada beberapa field, jadi mengirim angka di tempat Array akan
 * memicu TypeError #1034.
 */
function emptyRecord() {
  return {
    account_id:                                0,  // uint
    add_inv_arr:                               [],  // Array
    bloodline:                                 [],  // Array
    character_armor:                           0,  // uint
    character_bloodline:                       '',  // String
    character_body_parts:                      {},  // Object
    character_body_set:                        '',  // String
    character_chakra:                          0,  // uint
    character_control:                         0,  // uint
    character_cp:                              0,  // uint
    character_earth:                           0,  // uint
    character_equipped_back_item:              '',  // String
    character_equipped_trade_back_item:        '',  // String
    character_equipped_trade_body_set:         '',  // String
    character_equipped_trade_weapon:           '',  // String
    character_equipped_weapon:                 '',  // String
    character_eye_color:                       0,  // Number
    character_face:                            '',  // String
    character_fire:                            0,  // uint
    character_gender:                          0,  // uint
    character_genjutsu:                        0,  // uint
    character_gold:                            0,  // uint
    character_hair:                            '',  // String
    character_hair_color:                      [],  // Array
    character_hash:                            null,  // *
    character_hp:                              0,  // uint
    character_id:                              null,  // *
    character_intelligence:                    0,  // uint
    character_inventory:                       {},  // Object
    character_level:                           0,  // uint
    character_lightning:                       0,  // uint
    character_max_cp:                          0,  // uint
    character_max_hp:                          0,  // uint
    character_max_sp:                          0,  // uint
    character_name:                            '',  // String
    character_pet_cp:                          0,  // uint
    character_pet_ep:                          0,  // uint
    character_pet_max_cp:                      0,  // uint
    character_pet_max_ep:                      0,  // uint
    character_rank:                            0,  // uint -- ditimpa dari c.rank di databaseCharacter()
    character_senjutsu:                        [],  // Array
    character_senjutsu_ss:                     '',  // String
    character_skill_resistance:                [],  // Array
    character_skill_resistance_unallocated:    0,  // uint
    character_skill_talent:                    [],  // Array
    character_skill_unallocated:               0,  // uint
    character_skills:                          [],  // Array
    character_skin_color:                      0,  // Number
    character_sp:                              0,  // uint
    character_speed:                           0,  // uint
    character_stamina:                         0,  // uint
    character_strength:                        0,  // uint
    character_summon:                          0,  // uint
    character_taijutsu:                        0,  // uint
    character_trade_item:                      '',  // String
    character_water:                           0,  // uint
    character_wind:                            0,  // uint
    character_xp:                              0,  // uint
    current_expiry_arr:                        [],  // Array
    damage_cp:                                 0,  // int
    damage_hp:                                 0,  // int
    damage_sp:                                 0,  // int
    equip_arr:                                 [],  // Array
    expired_pet_arr:                           [],  // Array
    inv_slots_obj:                             {},  // Object
    remove_equip_arr:                          [],  // Array
    remove_inv_arr:                            [],  // Array
    restore_cp:                                0,  // int
    restore_hp:                                0,  // int
    restore_sp:                                0,  // int
    senjutsu:                                  [],  // Array
    session_playtime:                          0,  // int
  };
}


/* CharacterDAO.updateAP -> [sessionKey, characterId, [api,air,angin,tanah,petir]]
 * Nilainya total absolut (Character.updateAP mengirim dbChar.character_* apa
 * adanya), jadi cukup ditimpa. */
function setElements(arr) {
  const all = load();
  const key = Object.keys(all)[0];
  if (!key) return null;
  const c = all[key];
  c.elements = [0, 1, 2, 3, 4].map(i => Number(arr && arr[i]) || 0);
  all[key] = c;
  save(all);
  return c;
}

/* CharacterDAO.trainSkill -> [sessionKey, skillId, sequence]
 * skillId datang sebagai "skill123" atau angka; disimpan sebagai angka. */
function addSkill(skillId) {
  const all = load();
  const key = Object.keys(all)[0];
  if (!key) return null;
  const c = all[key];
  if (!Array.isArray(c.skills)) c.skills = [];
  const id = String(skillId).replace(/^skill/, '');
  if (!c.skills.includes(id)) c.skills.push(id);
  all[key] = c;
  save(all);
  return c;
}

/* CharacterDAO.sellItem -> [sessionKey, characterId, "wpn2", jumlah]
 * Kebalikan addItem: buang dari kantong yang sesuai, tambahkan uangnya. */
function removeItem(itemId, jumlah, kembaliGold) {
  const all = load();
  const key = Object.keys(all)[0];
  if (!key) return null;
  const c = all[key];

  const k = kantongDari(String(itemId));
  const bag = k ? k.bag : 'items';
  const num = k ? k.num : String(itemId).replace(/^item/, '');
  const n = Math.max(1, Number(jumlah) || 1);

  if (Array.isArray(c[bag])) {
    for (let i = 0; i < n; i++) {
      const at = c[bag].indexOf(num);
      if (at === -1) break;
      c[bag].splice(at, 1);
    }
  }

  // Kalau yang dijual sedang dipakai, lepaskan — supaya tidak mengirim
  // perlengkapan terpasang yang sudah tidak dimiliki.
  const eq = c.equip || {};
  for (const slot of ['weapon', 'bodySet', 'backItem', 'accessory']) {
    if (eq[slot] && String(eq[slot]) === String(itemId)) eq[slot] = '';
  }
  c.equip = eq;

  if (kembaliGold) c.gold = (c.gold || 0) + kembaliGold;

  all[key] = c;
  save(all);
  return c;
}

/* CharacterDAO.equipCharacter ->
 * [sessionKey, characterId, tradingBodySet, tradingWeapon, ?, tradingBackItem, accessory]
 * Bentuk tiap nilai (string tunggal vs array) belum dipastikan dari bytecode;
 * disimpan sebagai String(...) apa adanya. */
function setEquip(weapon, bodySet, backItem, accessory, jutsu) {
  const all = load();
  const key = Object.keys(all)[0];
  if (!key) return null;
  const c = all[key];
  c.equip = {
    weapon:    weapon    != null ? String(weapon)    : '',
    bodySet:   bodySet   != null ? String(bodySet)   : '',
    backItem:  backItem  != null ? String(backItem)  : '',
    accessory: accessory != null ? String(accessory) : '',
    // Jutsu terpasang, disimpan sebagai id telanjang. Klien mengirim
    // ["skill13","skill16"] dan membacanya kembali lewat
    // character_equipped_skills yang di-split "," lalu di-int().
    jutsu: Array.isArray(jutsu)
      ? jutsu.map(x => String(x).replace(/^skill/, '')).filter(Boolean)
      : ((c.equip && c.equip.jutsu) || []),
  };
  all[key] = c;
  save(all);
  return c;
}

/* CharacterDAO.buyItem -> [sessionKey, "item1", jumlah] */
/* Awalan id -> kantong penyimpanan.
 *
 * parseRawCharacter memecah tiap field dengan "," lalu MENAMBAHKAN awalannya
 * sendiri. Dipetakan dari pasangan (field, prefix) di bytecode-nya:
 *
 *   character_item      + "item"    character_weapon    + "wpn"
 *   character_inv_hair  + "hair"    character_back_item + "back"
 *   character_accessory + "acsy"    character_body_set  + "set"
 *
 * Karena itu id harus dipisah per kantong: menaruh "wpn1" di character_item
 * menghasilkan "itemwpn1" di sisi klien — nama yang tidak ada.
 */
const KANTONG = {
  item: 'items', wpn: 'weapons', set: 'bodysets',
  hair: 'hairs', back: 'backitems', acsy: 'accessories',
};

function kantongDari(id) {
  const m = String(id).match(/^(item|wpn|set|hair|back|acsy)(\d+)$/);
  return m ? { bag: KANTONG[m[1]], num: m[2] } : null;
}

function addItem(itemId, jumlah, hargaGold, hargaToken) {
  const all = load();
  const key = Object.keys(all)[0];
  if (!key) return null;
  const c = all[key];
  const n = Math.max(1, Number(jumlah) || 1);

  const k = kantongDari(itemId);
  if (k) {
    if (!Array.isArray(c[k.bag])) c[k.bag] = [];
    if (k.bag === 'items') {
      // barang habis pakai: boleh menumpuk
      for (let i = 0; i < n; i++) c[k.bag].push(k.num);
    } else if (!c[k.bag].includes(k.num)) {
      // perlengkapan: cukup satu
      c[k.bag].push(k.num);
    }
  } else {
    if (!Array.isArray(c.items)) c.items = [];
    for (let i = 0; i < n; i++) c.items.push(String(itemId).replace(/^item/, ''));
  }

  // Potong biaya kalau harganya diketahui. Tidak pernah sampai minus:
  // klien sudah mencegah pembelian saat saldo kurang, jadi kalau di sini
  // negatif berarti ada yang tidak sinkron — lebih baik berhenti di 0
  // daripada menyimpan saldo minus.
  if (hargaGold)  c.gold  = Math.max(0, (c.gold  || 0) - hargaGold  * n);
  if (hargaToken) c.token = Math.max(0, (c.token || 0) - hargaToken * n);

  all[key] = c;
  save(all);
  return c;
}

/* ===================== PET ==========================================
 *
 * Klien membangun daftar pet dari field `player_pet` di respons
 * CharacterDAO.getExtraData. DataParser.parseCharacterData @2916:
 *
 *     arr = data.player_pet as Array;
 *     for (i...) {
 *       if (arr[i].equipped) {
 *         db = parsePetData(arr[i]);
 *         mainChar.initPet(db, arr[i].swfName, arr[i].clsName);   // pet AKTIF
 *       } else {
 *         db = parsePetData(arr[i]);
 *         mainChar.initStandbyPet(db, swfName, clsName);          // pet CADANGAN
 *       }
 *     }
 *
 * initPet mengisi Character._pet (satu-satunya pet yang ikut bertarung),
 * initStandbyPet mendorong ke Character._standbyPet (koleksi/library).
 * Karena _pet ditimpa, HANYA SATU entri yang boleh equipped:true.
 *
 * Field yang dibaca DataParser.parsePetData (method 512):
 *     id, name, level, xp, skills   -> DBCharacterData ID/NAME/LEVEL/XP/SKILLS
 *     swfName, clsName, hash        -> untuk memuat grafis + verifikasi
 *
 * hash = Main.getHash(id + "," + swfName + "," + clsName + "," + level + "," + xp)
 * Pada jalur getExtraData parsePetData dipanggil dengan SATU argumen, jadi
 * pemeriksaan hash dilewati. Tetap dikirim supaya jalur lain (addOpponent,
 * DisplayDataAddInventory) tidak menolak datanya.
 *
 * GRAFIS: Main.preloadData memuat "swf/pets/" + swfName + ".swf".
 * Dari amf-log, satu-satunya file pet yang benar-benar ADA di
 * C:\NinjaSaga\web adalah pet_184.swf -- nama lain (toad_1, snake_1, pig_1,
 * bird_1, cat_1, dog_1, bat_1, bunny_1, snake_2, pig_2) dilayani
 * assetclone.js sebagai kloningan dari pet_184.swf. Jadi pet akan MUNCUL,
 * tapi memakai grafis pet_184 sampai file aslinya kamu punya.
 */

/* Data pet: nama, swfName, clsName -- diekstrak dari data_library_en.swf
 * (SystemDataEN method 19, object literal PET, 170 entri) ke petdata.js.
 *
 * Klien memakai tabel yang sama, Item.getDisplayData @1462:
 *     Main.PET_DATA.find("pet" + id).swfName
 * lalu memuat "swf/pets/" + swfName + ".swf". Kalau server mengirim swfName
 * yang berbeda, grafisnya meleset -- karena itu nilainya diambil dari sumber
 * yang sama, bukan ditebak.
 *
 * clsName TIDAK bisa dihitung dari swfName: sebagian besar memang kapitalisasi
 * biasa (bird_1 -> Bird_1), tapi id 9 (bunny_easter_free -> BunnyEasterFree)
 * dan id 98 (fox_2 -> Fox_02) menyimpang. Selalu pakai tabel.
 */
const { PET_DATA, petById, biayaLatih } = require('./petdata');
const { BLOODLINE_SKILL } = require('./bloodlinedata');

// Satu-satunya berkas pet yang benar-benar ada di C:\NinjaSaga\web; nama lain
// dilayani assetclone.js sebagai kloningannya. Dipakai kalau id tak dikenal.
const PET_SWF_CADANGAN = 'pet_184';

/* {swfName, clsName, name} untuk sebuah id pet. */
function petAsset(id) {
  const d = petById(id);
  if (d) return { swfName: d.swfName, clsName: d.clsName, name: d.name };
  console.log('   !! pet id ' + id + ' tidak ada di PET_DATA -- memakai ' +
              PET_SWF_CADANGAN);
  return { swfName: PET_SWF_CADANGAN, clsName: PET_SWF_CADANGAN, name: 'Pet ' + id };
}

/* Bisakah pet ini bertarung?
 *
 * PetBase.setupAvailableSkills mengisi availableSkills dari skillData, yang
 * dibangun setPetAttributes dari PET_DATA.find("pet"+id).skill. 63 dari 170
 * pet (semua pet lama: id 1-20, 23, 33, 56, ...) TIDAK punya blok skill di
 * data_library, jadi availableSkills-nya selalu kosong.
 *
 * Saat gilirannya tiba, PetBase.getBattleAction tidak menemukan aksi apa pun
 * dan rantai characterTurn berhenti -- pertarungan macet di tengah misi.
 * Pet seperti itu boleh dimiliki, tapi tidak boleh dipasang aktif.
 */
function petBisaBertarung(id) {
  const d = petById(id);
  return !!(d && d.skillLevels && d.skillLevels.length);
}

/* Indeks skill yang sudah dilatih untuk sebuah pet.
 *
 * Skill indeks 0 (Basic attack) selalu terbuka gratis; sisanya harus dilatih
 * lewat CharacterDAO.trainPetSkill. Nilai disaring ke rentang yang benar-benar
 * ada di PET_DATA supaya setupAvailableSkills tidak menemui skillData[i] null
 * (yang memicu Out.error "... is null" dan menyisakan skill kosong).
 */
function skillPetTerlatih(p) {
  const d = petById(p && p.id);
  if (!d || !d.skillLevels.length) return [];
  const n = d.skillLevels.length;
  const set = new Set([0]);
  (Array.isArray(p.trained) ? p.trained : []).forEach(i => {
    const k = Number(i);
    if (Number.isInteger(k) && k >= 0 && k < n) set.add(k);
  });
  return [...set].sort((a, b) => a - b);
}

/* Latih satu skill pet. Mengembalikan array indeks terbaru -- inilah yang
 * WAJIB dikirim di response.result untuk CharacterDAO.trainPetSkill.
 *
 * MapMenu.trainPetSkillResult meneruskan hasilnya ke Pet.setupAvailableSkills,
 * yang memanggil actionBase.setupAvailableSkills(getData(SKILLS)). Kalau
 * result bukan Array, koersi `as Array` menghasilkan null, lalu
 * PetBase.setupAvailableSkills @99 membaca null.length -> #1009 dan panel
 * membeku. Balasan `result: 0` yang lama persis memicu itu.
 */
function latihSkillPet(petId, index, currency) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!Array.isArray(c.pets)) c.pets = [];

  const id = String(petId);
  const pet = c.pets.find(p => String(p.id) === id);
  const d = petById(id);
  if (!pet || !d) return null;

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= d.skillLevels.length) {
    return { skills: skillPetTerlatih(pet), ditolak: 'indeks ' + index + ' di luar rentang' };
  }

  const biaya = biayaLatih(id, i, currency);
  if (biaya.gold)  c.gold  = Math.max(0, (Number(c.gold)  || 0) - biaya.gold);
  if (biaya.token) c.token = Math.max(0, (Number(c.token) || 0) - biaya.token);

  if (!Array.isArray(pet.trained)) pet.trained = [];
  if (!pet.trained.includes(i)) pet.trained.push(i);

  all[key] = c;
  save(all);
  return {
    skills: skillPetTerlatih(pet),
    biaya,
    sisaGold: c.gold,
    sisaToken: c.token,
    levelMin: d.skillLevels[i],
  };
}

function petHash(p, sessionKey) {
  const crypto = require('crypto');
  const SALT = 'Vmn34aAciYK00Hen26nT01';
  const input = [p.id, p.swfName, p.clsName, p.level, p.xp].join(',');
  return crypto.createHash('sha1')
    .update(input + SALT + String(sessionKey == null ? '' : sessionKey), 'binary')
    .digest('hex');
}

/* Satu entri player_pet, lengkap dengan hash-nya. */
function petEntry(p, sessionKey) {
  const a = petAsset(p.id);
  const swfName = String(p.swfName || a.swfName);
  const e = {
    id:       String(p.id == null ? '0' : p.id),
    name:     String(p.name || a.name),
    level:    Number(p.level) || 1,

    // XP DISELARASKAN DENGAN LEVEL, bukan sekadar disalin.
    //
    // Klien mengabaikan field `level` yang kita kirim dan menghitung ulang
    // sendiri lewat Formula.getPetLvByXp(xp). Jadi pet dengan level 5 tapi
    // xp 0 akan tampil sebagai level 1 -- dan karena penyimpanan level hanya
    // terjadi saat pet NAIK level, pet yang sudah terlanjur tersimpan dengan
    // xp 0 tidak akan pernah membaik dengan sendirinya.
    //
    // Diselaraskan di sini, saat mengirim, supaya berlaku juga untuk data
    // lama. Kalau xp tersimpan sudah lebih besar (mis. hasil latihan), yang
    // besar itu yang dipakai supaya progres menuju level berikutnya tidak
    // ikut terhapus.
    xp:       Math.max(Number(p.xp) || 0,
                       xpPetUntukLevel(Number(p.level) || 1)),
    // parsePetData: `if (petObj.skills)` -> array kosong pun jatuh ke [0].
    // Indeks skill yang SUDAH DILATIH. setupAvailableSkills memakainya
    // sebagai indeks ke skillData -- angka berurut, bukan id skill.
    // Array kosong = pet tanpa aksi (lihat petBisaBertarung).
    skills:   skillPetTerlatih(p),
    swfName,
    // clsName = nama class di dalam swf. Untuk aset yang dikloning
    // assetclone.js, class-nya dinamai sama dengan nama file.
    clsName:  String(p.clsName || a.clsName),
    equipped: !!p.equipped,
  };
  e.hash = petHash(e, sessionKey);
  return e;
}

/* Daftar player_pet untuk buildExtraData.
 * Menjamin paling banyak SATU pet equipped -- kalau tersimpan lebih dari
 * satu (mis. hasil edit manual characters.json), yang pertama menang dan
 * sisanya diturunkan jadi cadangan, supaya _pet tidak saling menimpa. */
function daftarPet(c, sessionKey) {
  const raw = Array.isArray(c && c.pets) ? c.pets : [];
  let sudahAda = false;
  return raw.map(p => {
    const e = petEntry(p, sessionKey);
    if (e.equipped) {
      if (sudahAda) e.equipped = false;
      else sudahAda = true;
    }
    return e;
  });
}

/* XP minimum yang dibutuhkan sebuah pet untuk mencapai level tertentu.
 *
 * Salinan Formula.getPetXpByLv (code_library):
 *     total = 0
 *     for (i = 1; i < level; i++)
 *         total += round(i * 130 * pow(50, i / 50) * 0.2)
 *
 * PENTING: klien TIDAK memakai field `level` yang kita kirim untuk menentukan
 * level pet — ia menghitung ulang dari `xp` lewat Formula.getPetLvByXp. Jadi
 * menyimpan level saja tanpa xp membuat pet kembali ke level 1 setiap muat
 * ulang, walaupun characters.json sudah mencatat levelnya dengan benar.
 *
 *     level 2 -> 28      level 5 -> 330     level 10 -> 1948
 */
function xpPetUntukLevel(level) {
  const lv = Math.max(1, Number(level) || 1);
  let total = 0;
  for (let i = 1; i < lv; i++) {
    total += Math.round(i * 130 * Math.pow(50, i / 50) * 0.2);
  }
  return total;
}

/* Tambahkan pet ke koleksi karakter aktif.
 *   addPet({ id, name, level, xp, skills, swfName, clsName, equipped })
 * id yang sama tidak digandakan -- datanya diperbarui. */
function addPet(pet) {
  if (!pet || pet.id == null) return null;
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  if (!Array.isArray(c.pets)) c.pets = [];
  const id = String(pet.id);
  const a = petAsset(id);
  const swfName = String(pet.swfName || a.swfName);
  const baru = {
    id,
    trained:  Array.isArray(pet.trained) ? pet.trained.map(Number) : null,
    name:     String(pet.name || a.name),
    level:    Number(pet.level) || 1,
    xp:       Number(pet.xp)    || 0,
    skills:   Array.isArray(pet.skills) ? pet.skills.map(String) : null,
    swfName,
    clsName:  String(pet.clsName || a.clsName),
    equipped: !!pet.equipped,
  };

  // Field bernilai null berarti "tidak disebutkan" -- dibuang supaya nilai
  // lama tidak ikut terhapus. Tanpa ini, memanggil addPet({id, level}) saja
  // akan mengosongkan daftar skill pet yang sudah susah payah dilatih.
  for (const k of Object.keys(baru)) if (baru[k] === null) delete baru[k];

  const i = c.pets.findIndex(p => String(p.id) === id);
  if (i >= 0) {
    c.pets[i] = Object.assign({}, c.pets[i], baru);
  } else {
    // pet baru: isi nilai awal untuk field yang tadi dibuang
    if (!baru.trained) baru.trained = [0];
    if (!baru.skills)  baru.skills  = [];
    c.pets.push(baru);
  }

  if (baru.equipped && !petBisaBertarung(id)) {
    // Memasangnya aktif akan membekukan pertarungan pada giliran pet.
    console.log('   !! pet ' + id + ' (' + baru.name + ') tidak punya data skill ' +
                'di PET_DATA -- tidak dipasang aktif; pertarungan akan macet.');
    baru.equipped = false;
  }
  if (baru.equipped) c.pets.forEach(p => { p.equipped = String(p.id) === id; });

  all[key] = c;
  save(all);
  return baru;
}

/* Pasang satu pet sebagai pet aktif. id null/'' = lepas semuanya. */
function setPetEquipped(id) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!Array.isArray(c.pets)) c.pets = [];

  const target = id == null ? '' : String(id);
  if (target && !petBisaBertarung(target)) {
    console.log('   !! pet ' + target + ' tidak punya data skill di PET_DATA -- ' +
                'permintaan aktivasi ditolak agar pertarungan tidak macet.');
    return { id: target, ketemu: false, ditolak: true, total: c.pets.length };
  }
  let ketemu = false;
  c.pets.forEach(p => {
    p.equipped = String(p.id) === target;
    if (p.equipped) ketemu = true;
  });
  all[key] = c;
  save(all);
  return { id: target, ketemu, total: c.pets.length };
}

function removePet(id) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!Array.isArray(c.pets)) c.pets = [];
  const sebelum = c.pets.length;
  c.pets = c.pets.filter(p => String(p.id) !== String(id));
  all[key] = c;
  save(all);
  return { dihapus: sebelum - c.pets.length, sisa: c.pets.length };
}

/* Potong harga pet dari saldo karakter, sesuai PET_DATA.
 *
 * Klien SUDAH mengurangi tampilan saldonya sendiri saat pembelian, jadi tanpa
 * ini angkanya kelihatan benar sampai halaman dimuat ulang -- lalu emasnya
 * kembali utuh karena server tidak pernah mencatat potongan itu.
 *
 * Tidak pernah sampai minus: klien mencegah pembelian saat saldo kurang, jadi
 * kalau di sini negatif berarti ada yang tidak sinkron -- lebih baik berhenti
 * di 0 daripada menyimpan saldo minus (sama seperti addItem).
 */
function bayarPet(id) {
  const d = petById(id);
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const gold  = Number(d && d.gold)  || 0;
  const token = Number(d && d.token) || 0;
  if (gold)  c.gold  = Math.max(0, (Number(c.gold)  || 0) - gold);
  if (token) c.token = Math.max(0, (Number(c.token) || 0) - token);

  all[key] = c;
  save(all);
  return { gold, token, sisaGold: c.gold, sisaToken: c.token };
}

/* Objek pet untuk balasan CharacterDAO.buyPet.
 *
 * PetShop.onAmfBuyItemResult (pet_shop.swf, method 307) TIDAK melewati
 * Main.validateAmfResponse, jadi update_inventory/add_pet_data diabaikan
 * total. Yang dibaca hanya response.result:
 *
 *      pet = response.result as Object;                        @98
 *      if (pet && pet.equipped) {                              @112,@120
 *          db = dataParser.parsePetData(pet, true);            @142
 *          mainChar.deactivatePet();                           @158
 *          mainChar.initPet(db, pet.swfName, pet.clsName);     @189
 *          loadSwf("swf/pets/" + mainChar.pet.swfName + ".swf")
 *      }
 *
 * Tiga syarat yang gampang terlewat:
 *
 *  1. result harus OBJEK, bukan angka. `result: 0` bernilai falsy sehingga
 *     seluruh blok dilompati dan pet tidak pernah ditambahkan.
 *  2. equipped WAJIB true. Kalau false, blok yang sama dilompati -- pet baru
 *     tidak muncul sampai halaman dimuat ulang. Klien memang selalu
 *     mengaktifkan pet yang baru dibeli (deactivatePet lalu initPet), jadi
 *     server harus mencatat hal yang sama.
 *  3. parsePetData dipanggil dengan DUA argumen, jadi hash-nya DIPERIKSA:
 *         Main.getHash(id + "," + swfName + "," + clsName + "," + level + "," + xp)
 *     harus sama dengan pet.hash, kalau tidak Main.onError() dipanggil dan
 *     parsePetData mengembalikan null -- initPet(null, ...) lalu meledak.
 *
 * Emas/token dipotong klien sendiri dari selectedItem (PET_DATA) di @296 dan
 * @316, jadi jangan dikirim lagi di sini; cukup dicatat di server lewat
 * bayarPet() supaya tidak pulih saat muat ulang.
 */
function petBuyResult(pet, sessionKey) {
  const e = petEntry(Object.assign({}, pet, { equipped: true }), sessionKey);
  return e;
}

/* ---- Misi Latihan Sennin (SS Mission / 仙人修行任務) -------------------
 *
 * MissionPanel_2.sageMissionResponse (mission_2.swf, method 660):
 *
 *     this.SsMission = [];
 *     if (Main.validateAmfResponse(res)) {
 *         this.SsMissionStatus = res.result.status;          // @27-33
 *         if (this.SsMissionStatus == 0) {                   // @40
 *             for (i = 0; i < res.result.mission.length; i++)   // @106
 *                 if (res.result.mission[i].status == 0)
 *                     this.SsMission.push(res.result.mission[i].id);
 *         }
 *         Main.hideAmfLoading();                             // @118
 *     }
 *
 * SsMissionStatus bertipe int, jadi `undefined` DIPAKSA jadi 0 -- cabang
 * `== 0` tetap masuk, lalu res.result.mission yang tidak ada dibaca .length
 * -> #1010. Karena hideAmfLoading() berada SETELAH loop, layar loading tidak
 * pernah ditutup: itulah panel misi yang blank.
 *
 * Jadi result WAJIB objek berisi `status` dan ARRAY `mission`.
 *   status 0  -> tab Grade 6 (Sennin) terbuka
 *   status !=0 -> tab terkunci; klien menawarkan beli dengan 5x item825
 * Tiap entri mission: { id, status }, status 0 = misi terbuka.
 *
 * onGradeList @672 juga menuntut RANK > 7, dan gotoMissionList @2668 hanya
 * menampilkan misi yang `level <= level karakter` DAN id-nya ada di SsMission.
 *
 * Daftar di bawah diambil dari MISSION_DATA di data_library_en.swf
 * (MissionDetail.getData): msn279..283, level 80, tanpa grade/event/daily --
 * lima misi latihan Sennin.
 */
const SS_MISSION = ['msn279', 'msn280', 'msn281', 'msn282', 'msn283'];

/* Status misi Sennin untuk SSTraining.getMissionStatus.
 * Misi yang sudah pernah dituntaskan tetap dikirim status 0 supaya bisa
 * diulang -- klien tidak menyembunyikannya. */
function statusMisiSennin(c) {
  const rank = Number(c && c.rank != null ? c.rank : 1) || 1;
  return {
    // Terbuka hanya kalau rank sudah melewati Special Jounin, sama dengan
    // syarat RANK > 7 di onGradeList; kalau belum, klien menampilkan
    // tab terkunci alih-alih daftar kosong yang membingungkan.
    status: rank > 7 ? 0 : 1,
    mission: SS_MISSION.map(id => ({ id, status: 0 })),
  };
}

function listPets() {
  const all = load();
  const key = activeKey(all);
  if (!key) return [];
  return Array.isArray(all[key].pets) ? all[key].pets : [];
}

function databaseCharacter(c) {
  const r = emptyRecord();

  r.character_id      = c.character_id;
  r.account_id        = 1;
  r.character_name    = c.name;
  r.character_level   = c.level;
  r.character_xp      = c.xp;
  r.character_gold    = c.gold;

  // MapBase.initBuildings (map_1.swf) menentukan tampil-tidaknya bangunan:
  //     huntingHouseBtn.visible = level >= DISPLAY_LEVEL_LIMIT_BUILDING_HUNTING_HOUSE (5)
  //     petShopBtn.visible      = level >= 20  ATAU  rank >= RankData.GENIN (1)
  //     btnBloodlineShop.visible= level >= 20  ATAU  rank >= RankData.GENIN (1)
  //         (btnBloodlineShop dibuka lewat gotoBloodlineShop -> panel
  //          bloodline_shop.swf; ini yang di klien disebut "talent")
  // Ketiga flag fitur terkait (FEATURE_BLOODLINE, FEATURE_TALENT,
  // FEATURE_LEVEL_CONTROL) sudah TRUE tanpa syarat di code_library.swf,
  // jadi bukan itu penghalangnya -- murni level dan rank.
  r.character_rank    = c.rank != null ? c.rank : 1;
  // SENJUTSU_SS bertipe String di DB_TYPES, jadi dikirim sebagai string.
  r.character_senjutsu_ss = String(Number(c.senjutsuSS) || 0);

  // Poin bloodline (BP). BloodlineProfile membacanya lewat
  //     getMainChar().getData("character_bloodline")
  // di convertResponse @75 dan upgradeResponse @565-572, dan memasangnya ke
  // TextField yourBPTxt @157-180 -- jadi harus berupa angka, bukan kosong.
  r.character_bloodline = String(Number(c.bloodlinePoint) || 0);
  r.bloodline = daftarBloodline(c);

  // Senjutsu yang dimiliki. CharacterBase.getSenjutsuListArr (code_library
  // method 724) membacanya lewat dbChar.senjutsu:
  //     @15-29  kalau senjutsu null/kosong -> langsung return []
  //     @65-79  SENJUTSU_SKILL_DATA["senjutsu_skill" + e.skill_id]  harus ada
  //     @97-111 SENJUTSU_DATA["senjutsu" + e.senjutsu_id]           harus ada
  //     @143    e.senjutsu_type == SKILL_TYPE_ACTIVE  -> baru di-push
  //
  // Kalau array ini kosong, senjutsuList di BattleActionBar juga kosong dan
  // initButtons melempar #1010 -- bar aksi pertarungan gagal digambar.
  //
  // senjutsu_id WAJIB sama dengan sistem yang dipilih (2 = Toad, 3 = Snake);
  // di SENJUTSU_SKILL_DATA tiap skill sudah punya senjutsu_id sendiri dan
  // klien mencocokkannya dengan SENJUTSU_DATA["senjutsu" + id].
  {
    // Lihat daftarSenjutsu() untuk pembongkaran lengkap rantai
    // parseCharacterData -> Add_Dbchar_Senjutsu -> getSenjutsuListArr.
    const arr = daftarSenjutsu(c);
    r.character_senjutsu = arr;
    r.senjutsu = arr;
  }

  r.character_hp      = c.hp;
  r.character_max_hp  = c.hp;
  r.character_cp      = c.cp;
  r.character_max_cp  = c.cp;

  r.character_strength     = c.str;
  r.character_speed        = c.agi;
  r.character_stamina      = c.sta;
  r.character_chakra       = c.chakra;
  r.character_intelligence = c.intel;

  r.character_gender     = c.gender;
  r.character_hair       = String(c.hair);
  r.character_face       = String(c.face);
  r.character_skin_color = c.skin_color;
  r.character_body_set   = 'set1';

  // elemen yang dipilih bernilai 1
  const el = Array.isArray(c.elements) ? c.elements : [0, 0, 0, 0, 0];
  r.character_fire      = Number(el[0]) || 0;
  r.character_water     = Number(el[1]) || 0;
  r.character_wind      = Number(el[2]) || 0;
  r.character_earth     = Number(el[3]) || 0;
  r.character_lightning = Number(el[4]) || 0;

  // Skill tersimpan. Di jalur databaseCharacter field-nya character_skills
  // (jamak) dan berupa Array angka — DBCharacter.parseDBCharacter meneruskannya
  // apa adanya, lalu CharacterBase.getSkillListArr() membacanya per entri.
  r.character_skills = (Array.isArray(c.skills) ? c.skills : []).map(Number);

  {
    const eq = c.equip || {};
    const polos = v => String(v || '').replace(/^(wpn|set|back|acsy)/, '');
    r.character_equipped_weapon    = polos(eq.weapon);
    r.character_equipped_skills    = (eq.jutsu || []).join(',');
    r.character_equipped_back_item = polos(eq.backItem);
    r.character_equipped_accessory = polos(eq.accessory);
    if (eq.bodySet) r.character_equipped_body_set = polos(eq.bodySet);
  }

  return r;
}




/* Kurva level, disalin persis dari Formula.getLvByXp di code_library.swf:
 *
 *   total = 0; lv = 0
 *   while (total <= xp) { lv++; total += round(lv * 130 * pow(50, lv/50)) }
 *   return lv
 *
 * Klien menghitung levelnya sendiri dari XP total lewat rumus ini, jadi
 * server WAJIB memakai rumus yang sama agar keduanya tidak berbeda.
 */
function getLvByXp(xp) {
  let total = 0, lv = 0;
  while (total <= xp) {
    lv++;
    total += Math.round(lv * 130 * Math.pow(50, lv / 50));
    if (lv > 200) break;              // pengaman
  }
  return lv;
}

/* XP total yang dibutuhkan untuk mencapai level tertentu. */
function xpForLevel(lv) {
  let total = 0;
  for (let i = 1; i < lv; i++) total += Math.round(i * 130 * Math.pow(50, i / 50));
  return total;
}

/* Menambahkan hasil misi ke karakter dan menyimpannya. */
/* Mengubah peta misi tersimpan menjadi string yang dimengerti klien.
 * Bentuk simpanan: { "55": {success:1, fail:0, time:0}, ... }
 * Bentuk kirim   : "55:1:0:0,56:2:0:0"
 */
function serializeMissions(m) {
  if (!m || typeof m !== 'object') return '';
  return Object.keys(m).map(no => {
    const e = m[no] || {};
    return [
      no,
      Number(e.success) || 0,
      Number(e.fail) || 0,
      Number(e.time) || 0,
    ].join(':');
  }).join(',');
}

/* Mencatat satu misi selesai. `missionId` datang dari klien apa adanya
 * ("msn55"); yang disimpan hanya angkanya supaya cocok dengan format kirim.
 * sukses=false menambah penghitung `fail`, bukan `success`.
 */
/* ---- kenaikan rank dari ujian ------------------------------------------
 * Nilai rank dibaca klien dari character_rank (ninjasaga.data::RankData):
 *   0 STUDENT   1 GENIN    2 CHUNIN   3 CHUNIN_TALENTED
 *   4 JOUNIN    5 JOUNIN_TALENTED     6 SPECIAL_JOUNIN
 *   7 SPECIAL_JOUNIN_TALENTED         8 TUTOR   9 TUTOR_SENIOR
 *
 * Rangkaian misi tiap ujian disalin apa adanya dari ninjasaga.data::Data:
 *   EXAM_CHUNIN_ARR              msn55..msn59
 *   EXAM_JOUNIN_ARR              msn132..msn136
 *   EXAM_SPECIAL_JOUNIN_ARR      msn200..msn212
 *   EXAM_SPECIAL_JOUNIN_ARR_EASY msn226..msn238
 *   EXAM_SENNIN_ARR              msn259..msn270
 *   EXAM_SENNIN_ARR_EASY         msn247..msn256
 *
 * Ada dua varian (normal & EASY) untuk ujian Special Jounin dan Sennin;
 * menuntaskan SALAH SATU sudah cukup untuk naik rank.
 *
 * Klien TIDAK pernah menaikkan rank sendiri — panel ujian hanya menjalankan
 * misinya. Kenaikan rank memang tugas server, jadi tanpa perhitungan ini
 * karakter bertahan di rank lama walau seluruh ujian sudah tuntas.
 */
const EXAM_CHUNIN = ['55', '56', '57', '58', '59'];
const EXAM_JOUNIN = ['132', '133', '134', '135', '136'];
const EXAM_SPECIAL_JOUNIN = ['200', '201', '202', '203', '204', '205', '206',
                             '207', '208', '209', '210', '211', '212'];
const EXAM_SPECIAL_JOUNIN_EASY = ['226', '227', '228', '229', '230', '231', '232',
                                  '233', '234', '235', '236', '237', '238'];
const EXAM_SENNIN = ['259', '260', '261', '262', '263', '264',
                     '265', '266', '267', '268', '269', '270'];
const EXAM_SENNIN_EASY = ['247', '248', '249', '250', '251',
                          '252', '253', '254', '255', '256'];

function semuaTuntas(missions, daftar) {
  if (!missions) return false;
  return daftar.every(no => Number((missions[no] || {}).success) > 0);
}

/* Rank yang seharusnya dimiliki karakter berdasarkan riwayat misinya.
 * Tidak pernah menurunkan rank yang sudah tercatat. */
function hitungRank(c) {
  const sekarang = Number(c && c.rank != null ? c.rank : 1) || 1;
  const m = c && c.missions;
  let seharusnya = 1;                                   // GENIN
  if (semuaTuntas(m, EXAM_CHUNIN)) seharusnya = 2;      // CHUNIN
  if (semuaTuntas(m, EXAM_JOUNIN)) seharusnya = 4;      // JOUNIN
  if (semuaTuntas(m, EXAM_SPECIAL_JOUNIN) ||
      semuaTuntas(m, EXAM_SPECIAL_JOUNIN_EASY)) seharusnya = 6;   // SPECIAL_JOUNIN
  if (semuaTuntas(m, EXAM_SENNIN) ||
      semuaTuntas(m, EXAM_SENNIN_EASY)) seharusnya = 8;           // TUTOR (Sennin)
  return Math.max(sekarang, seharusnya);
}

/* Menyimpan kelas Special Jounin yang dipilih pemain.
 * Dipanggil dari handler CharacterDAO.SJClassSelect (argumen ke-2 = nomor kelas).
 * Nilainya dikirim balik lewat character_control, lihat rawCharacter(). */
function simpanKelasSJ(kelas) {
  const n = Number(kelas);
  if (!Number.isFinite(n) || n <= 0) return null;

  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const lama = Number(c.sjClass) || 0;
  c.sjClass = n;
  all[key] = c;
  save(all);
  return { kelas: n, lama, berubah: lama !== n };
}

/* Graduasi Sennin (Lv80 exam) -- dipakai handler CharacterDAO.NTClassSelect.
 *
 * SenninExamPanel.confirmClaimReward() membaca SATU field saja:
 *
 *     rewardStatus = int(response.character_reward);
 *     ... rewardList[rewardStatus - 1].length ...
 *
 * Kalau field itu tidak ada -> int(undefined) = 0 -> rewardList[-1] = undefined
 * -> TypeError #1010 dan panel mentok. Jadi nilainya WAJIB 1, 2, atau 3.
 *
 * rewardList disusun di constructor panel (Panel_lv80exam_battle.swf):
 *   1 -> back430, skill3500                                rank 8
 *   2 -> back430, skill3500, wpn988, bodyset easy          rank 8
 *   3 -> back430, skill3500, wpn988, bodyset hard          rank 9
 * Semua tier juga menambah senjutsu skill_id 3000 level 1.
 *
 * rewardBodyset[gender] = [easy, hard]:
 *   gender 0 -> ['set1786', 'set1788']
 *   gender 1 -> ['set1787', 'set1789']
 *
 * Klien menambahkan semua itu HANYA di memori (DisplayDataAddInventory /
 * addNewSenjutsu / updateData(RANK)), jadi server yang harus menyimpannya.
 */
const REWARD_BODYSET = {
  0: { 2: 'set1786', 3: 'set1788' },
  1: { 2: 'set1787', 3: 'set1789' },
};

function tierSennin(c) {
  const m = c && c.missions;
  if (semuaTuntas(m, EXAM_SENNIN))      return 3;   // hard mode tuntas
  if (semuaTuntas(m, EXAM_SENNIN_EASY)) return 2;   // easy mode tuntas
  return 1;                                         // klaim dasar
}

function graduasiSennin(paksaTier) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  let tier = Number(paksaTier);
  if (![1, 2, 3].includes(tier)) tier = tierSennin(c);

  const rank = tier === 3 ? 9 : 8;
  const gender = Number(c.gender) === 1 ? 1 : 0;

  // barang
  const barang = ['back430'];
  if (tier >= 2) {
    barang.push('wpn988');
    const set = REWARD_BODYSET[gender][tier];
    if (set) barang.push(set);
  }
  for (const id of barang) {
    const k = kantongDari(id);
    if (!k) continue;
    if (!Array.isArray(c[k.bag])) c[k.bag] = [];
    if (!c[k.bag].includes(k.num)) c[k.bag].push(k.num);
  }

  // senjutsu: 3500 dari rewardList + 3000 yang selalu diberikan
  if (!Array.isArray(c.senjutsu)) c.senjutsu = [];
  for (const sid of ['3500', '3000']) {
    if (!c.senjutsu.some(x => String(x && x.skill_id ? x.skill_id : x) === sid)) {
      c.senjutsu.push({ senjutsu_id: '1', level: '1', skill_id: sid });
    }
  }

  const rankLama = Number(c.rank != null ? c.rank : 1) || 1;
  c.rank = Math.max(rankLama, rank);

  all[key] = c;
  save(all);
  return { tier, rank: c.rank, rankLama, gender, barang };
}

/* ===================== KLAN ==========================================
 *
 * Nama field diambil dari konstanta ninjasaga.data::ClanData di
 * clan_panel.swf -- ClanPanel.updateClanStatus membacanya lewat
 * clanData[ClanData.NAME] dan seterusnya, jadi ejaannya harus persis.
 *
 *   ID 'id'                      NAME 'name'
 *   MASTER_ID 'master_id'        MASTER_NAME 'master_name'
 *   MEMBER_SLOTS 'member_slots'  MEMBER_NUMBER 'member_number'
 *   REPUTATION 'reputation'      GOLD 'gold'   TOKEN 'token'
 *   ANNOUNCEMENT 'announcement'  HAVE_NEW_MEMBER_REQUEST 'new_request'
 *   CHARACTER_STAMINA 'character_stamina'
 *   CHARACTER_MAX_STAMINA 'character_max_stamina'
 *   CLAN_STAMINA_BONUS / CLAN_HP_BONUS / CLAN_CP_BONUS / CLAN_DAMAGE_BONUS
 *   TOURNAMENT 'tournament'
 *
 * ClanPanel.updateClanStatus @131-288 membaca NAME, GOLD, TOKEN, REPUTATION,
 * MEMBER_NUMBER, MEMBER_SLOTS, CHARACTER_STAMINA, CHARACTER_MAX_STAMINA
 * tanpa penjagaan null. Kalau clanData null -> #1009 dan panel terus
 * mengulang frame (gejala kelap-kelip).
 *
 * building_data boleh null: Clan.getAttackerBonus (code_library method 1227)
 * @3-13 mengembalikan 0 saat buildingData null, jadi aman.
 */
const BIAYA_BUAT_KLAN_TOKEN = 400;   // ClanPanel.createClanResponse @148-152
                                     // mengurangi saldo klien sebanyak 400

function klanKosong(nama, c) {
  return {
    id:                    1,
    name:                  String(nama || 'Clan'),
    master_id:             Number(c && c.character_id) || 1,
    master_name:           String((c && c.name) || 'Master'),
    member_slots:          10,
    member_number:         1,
    reputation:            0,
    gold:                  0,
    token:                 0,
    announcement:          '',
    new_request:           0,
    tournament:            0,
    character_stamina:     100,
    character_max_stamina: 100,
    clan_stamina_bonus:    0,
    clan_hp_bonus:         0,
    clan_cp_bonus:         0,
    clan_damage_bonus:     0,
    buildings:             [],
  };
}

/* Buat klan baru untuk karakter aktif. Mengembalikan null kalau sudah punya. */
function buatKlan(nama) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (c.clan) return { sudahPunya: true, clan: c.clan };

  c.clan = klanKosong(nama, c);
  c.token = Math.max(0, (Number(c.token) || 0) - BIAYA_BUAT_KLAN_TOKEN);
  all[key] = c;
  save(all);
  return { sudahPunya: false, clan: c.clan, sisaToken: c.token };
}

/* Data klan karakter aktif, atau null kalau belum punya. */
function klanAktif() {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  return all[key].clan || null;
}

function bubarkanKlan() {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const ada = !!all[key].clan;
  delete all[key].clan;
  save(all);
  return { ada };
}

/* Donasi gold/token ke kas klan.
 *
 * ClanPanel.donateGoldResult (method 1246) @65-146:
 *     amt = int(res.result);                       <-- jumlah yang disumbang
 *     clanData[GOLD] = int(clanData[GOLD]) + amt;
 *     getMainChar().saveGold(0 - amt);             <-- gold pemain dikurangi
 * ClanPanel.donateTokenResult (method 1254) @215-310: pola yang sama untuk
 *     clanData[TOKEN] dan Account.balance.
 *
 * Jadi `result` adalah JUMLAHNYA, bukan kode status. Balasan generik
 * `result: []` dikoersi int() jadi 0 -- donasi seolah berhasil tapi tidak
 * ada yang berpindah, dan saldo pemain juga tidak berkurang.
 *
 * jenis: 'gold' | 'token'
 */
function donasiKlan(jenis, jumlah) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!c.clan) return { tidakPunyaKlan: true };

  const token = String(jenis) === 'token';
  const punya = Number(token ? c.token : c.gold) || 0;
  let amt = Math.floor(Number(jumlah) || 0);
  if (amt <= 0) return { jumlahTidakSah: true, diberikan: 0 };
  if (amt > punya) amt = punya;          // jangan sampai saldo minus

  if (token) {
    c.token      = punya - amt;
    c.clan.token = (Number(c.clan.token) || 0) + amt;
  } else {
    c.gold      = punya - amt;
    c.clan.gold = (Number(c.clan.gold) || 0) + amt;
  }

  all[key] = c;
  save(all);
  return {
    diberikan: amt,
    diminta:   Math.floor(Number(jumlah) || 0),
    sisa:      token ? c.token : c.gold,
    kasKlan:   token ? c.clan.token : c.clan.gold,
  };
}

/* Daftar anggota klan untuk ClanService.getMemberList.
 *
 * ClanPanel.gotMemberList (method 1228) @45-58 menjalankan
 * GF.objectToArray(res.result as Object), lalu @61-79 sortOn("level").
 * res.member_number dipakai @100-109 untuk memperbarui clanData.
 */
function anggotaKlan() {
  const all = load();
  const key = activeKey(all);
  if (!key) return [];
  const c = all[key];
  if (!c.clan) return [];
  return [{
    id:           Number(c.character_id) || 1,
    name:         String(c.name || ''),
    level:        Number(c.level) || 1,
    account_type: 0,
    skill_type:   Number(c.sjClass) || 0,
    position:     1,            // 1 = master
    reputation:   0,
    last_login:   Math.floor(Date.now() / 1000),
  }];
}

/* Bangunan klan.
 *
 * Tabel biaya diambil dari ClanData.BUILDING_DATA (clan_panel.swf, cinit
 * method 121 @209-454) -- sumber yang sama dengan yang dipakai klien, jadi
 * potongan di server sama persis dengan yang ditampilkan panel.
 *
 *   id 1 Ramen         bonus clan_stamina_bonus 10
 *   id 2 Hot Spring    bonus clan_hp_bonus      30
 *   id 3 Temple        bonus clan_cp_bonus      30
 *   id 4 Training Hall bonus clan_damage_bonus  30
 *   semuanya maxLevel 3, gold [1jt, 2jt, 0], token [0, 0, 4000]
 *
 * ClanPanel.constructBuildingResponse (method 1151) @174-195 memotong
 *     clanData[GOLD]  -= int(selectedBuilding.gold[ building_data.level - 1 ])
 *     clanData[TOKEN] -= int(selectedBuilding.token[ building_data.level - 1 ])
 * Jadi `level` di balasan adalah level BARU, dan indeks biayanya level-1.
 *
 * Clan.getBuildingBonus (code_library method 1229) @45-83 menghitung
 *     bonus = level * BUILDING_DATA[id].bonus
 * dari tiap entri {id, level}, jadi bentuk entri itu yang harus disimpan.
 */
const BUILDING_DATA = {
  1: { name: 'Ramen',         maxLevel: 3, gold: [1000000, 2000000, 0], token: [0, 0, 4000], bonusType: 'clan_stamina_bonus', bonus: 10 },
  2: { name: 'Hot Spring',    maxLevel: 3, gold: [1000000, 2000000, 0], token: [0, 0, 4000], bonusType: 'clan_hp_bonus',      bonus: 30 },
  3: { name: 'Temple',        maxLevel: 3, gold: [1000000, 2000000, 0], token: [0, 0, 4000], bonusType: 'clan_cp_bonus',      bonus: 30 },
  4: { name: 'Training Hall', maxLevel: 3, gold: [1000000, 2000000, 0], token: [0, 0, 4000], bonusType: 'clan_damage_bonus',  bonus: 30 },
};

function daftarBangunan() {
  const clan = klanAktif();
  return (clan && Array.isArray(clan.buildings)) ? clan.buildings : [];
}

/* Hitung ulang bonus klan dari bangunan yang dimiliki, mengikuti rumus
 * Clan.getBuildingBonus: bonus = level * BUILDING_DATA[id].bonus */
function hitungBonusKlan(clan) {
  const b = { clan_stamina_bonus: 0, clan_hp_bonus: 0, clan_cp_bonus: 0, clan_damage_bonus: 0 };
  (clan.buildings || []).forEach(x => {
    const d = BUILDING_DATA[Number(x.id)];
    if (d) b[d.bonusType] = (Number(x.level) || 0) * d.bonus;
  });
  Object.assign(clan, b);
  return b;
}

/* Bangun/upgrade satu bangunan klan.
 * Mengembalikan { id, level } untuk dikirim sebagai building_data, atau
 * { gagal: <alasan> } kalau tidak bisa. */
function bangunBangunanKlan(id) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!c.clan) return { gagal: 'belum punya klan' };

  const bid = Number(id);
  const d = BUILDING_DATA[bid];
  if (!d) return { gagal: 'id bangunan tidak dikenal: ' + id };

  if (!Array.isArray(c.clan.buildings)) c.clan.buildings = [];
  const ada = c.clan.buildings.find(x => Number(x.id) === bid);
  const levelLama = ada ? (Number(ada.level) || 0) : 0;
  const levelBaru = levelLama + 1;
  if (levelBaru > d.maxLevel) return { gagal: 'sudah level maksimum (' + d.maxLevel + ')' };

  const biayaGold  = Number(d.gold[levelBaru - 1])  || 0;
  const biayaToken = Number(d.token[levelBaru - 1]) || 0;
  const kasGold  = Number(c.clan.gold)  || 0;
  const kasToken = Number(c.clan.token) || 0;
  if (kasGold < biayaGold || kasToken < biayaToken) {
    return { gagal: 'kas klan kurang (butuh ' + biayaGold + ' gold + ' +
                    biayaToken + ' token, ada ' + kasGold + ' + ' + kasToken + ')' };
  }

  c.clan.gold  = kasGold  - biayaGold;
  c.clan.token = kasToken - biayaToken;
  if (ada) ada.level = levelBaru;
  else c.clan.buildings.push({ id: bid, level: levelBaru });

  hitungBonusKlan(c.clan);
  all[key] = c;
  save(all);
  return {
    id: bid, level: levelBaru, nama: d.name,
    biayaGold, biayaToken,
    kasGold: c.clan.gold, kasToken: c.clan.token,
    bonus: { [d.bonusType]: levelBaru * d.bonus },
  };
}

/* Konstanta stamina & slot anggota, dari trait statik ClanPanel
 * (clan_panel.swf): Upgrade_Sta_Amt=50, Upgrade_Sta_requiretoken=500,
 * Upgrade_Sta_Max=200, Restore_Sta_Amt=50, Restore_Sta_requiretoken=20.
 */
const UPGRADE_STA_AMT   = 50;
const UPGRADE_STA_TOKEN = 500;   // token AKUN, bukan token klan
const UPGRADE_STA_MAX   = 200;

/* Upgrade batas stamina klan.
 *
 * ClanPanel.UpgradeStaminaResponse (method 1336):
 *     @87-108  if (res.result) { if (int(res.result) == 9) { showOk(501); return; } }
 *     @142-150 maxSta = int(res.max_stamina as int);      <-- WAJIB ada
 *     @159-181 account.balance -= Upgrade_Sta_requiretoken (500)
 *     @239-276 clanData[CHARACTER_STAMINA]     = maxSta
 *              clanData[CHARACTER_MAX_STAMINA] = maxSta
 *
 * Balasan generik tidak punya max_stamina -> int(undefined) = 0, jadi
 * stamina jadi 0/0. Itu sebabnya upgrade tampak tidak berpengaruh.
 * Klien mengurangi 500 token akun sendiri, jadi server memotong yang sama.
 */
function upgradeStaminaKlan() {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!c.clan) return { gagal: 'belum punya klan' };

  const maxLama = Number(c.clan.character_max_stamina) || 0;
  if (maxLama + UPGRADE_STA_AMT > UPGRADE_STA_MAX) {
    return { gagal: 'sudah mencapai batas ' + UPGRADE_STA_MAX };
  }
  const token = Number(c.token) || 0;
  if (token < UPGRADE_STA_TOKEN) {
    return { gagal: 'token kurang (butuh ' + UPGRADE_STA_TOKEN + ', ada ' + token + ')' };
  }

  const maxBaru = maxLama + UPGRADE_STA_AMT;
  c.token = token - UPGRADE_STA_TOKEN;
  c.clan.character_max_stamina = maxBaru;
  c.clan.character_stamina     = maxBaru;   // klien mengisi penuh juga
  all[key] = c;
  save(all);
  return { maxStamina: maxBaru, biayaToken: UPGRADE_STA_TOKEN, sisaToken: c.token };
}

/* Isi ulang stamina klan (Restore). Biaya 20 token akun, +50 stamina. */
function restoreStaminaKlan() {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!c.clan) return { gagal: 'belum punya klan' };

  const token = Number(c.token) || 0;
  if (token < 20) return { gagal: 'token kurang (butuh 20)' };

  const maks = Number(c.clan.character_max_stamina) || 0;
  c.token = token - 20;
  c.clan.character_stamina = Math.min(maks, (Number(c.clan.character_stamina) || 0) + 50);
  all[key] = c;
  save(all);
  return { stamina: c.clan.character_stamina, maks, sisaToken: c.token };
}

/* Tambah slot anggota klan.
 *
 * ClanPanel.buyMemberSlotResponse (method 1212):
 *     @37-47   slot = int(res.member_slots);              <-- WAJIB ada
 *     @48-65   clanData[MEMBER_SLOTS] = slot
 *     @68-113  clanData[TOKEN] = int(clanData[TOKEN]) - (slot * 10)
 *
 * Perhatikan: yang dipotong adalah slot BARU dikali 10, dari kas TOKEN KLAN.
 * Server memotong dengan rumus yang sama supaya kedua sisi sepakat.
 * Tanpa member_slots di balasan, int(undefined) = 0 -> slot jadi 0.
 */
function tambahSlotAnggota() {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  if (!c.clan) return { gagal: 'belum punya klan' };

  const slotBaru = (Number(c.clan.member_slots) || 0) + 1;
  const biaya = slotBaru * 10;
  const kas = Number(c.clan.token) || 0;
  if (kas < biaya) {
    return { gagal: 'token klan kurang (butuh ' + biaya + ', ada ' + kas + ')' };
  }

  c.clan.member_slots = slotBaru;
  c.clan.token = kas - biaya;
  all[key] = c;
  save(all);
  return { memberSlots: slotBaru, biaya, kasToken: c.clan.token };
}

/* Poin latihan Sennin (SENJUTSU_SS).
 *
 * Callback anonim SSTraining.finishSSMission (code_library method 844,
 * dipasang Mission.completeMission @3306) menambah 30 poin di sisi klien:
 *     mc.updateData(DBCharacterData.SENJUTSU_SS,
 *                   int(mc.getData(SENJUTSU_SS)) + 30);
 * Itu hanya di memori, jadi server menyimpan angkanya sendiri dan
 * mengirimkannya lewat character_senjutsu_ss di databaseCharacter().
 */
function tambahSenjutsuSS(jumlah = 30) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  const lama = Number(c.senjutsuSS) || 0;
  c.senjutsuSS = lama + (Number(jumlah) || 0);
  all[key] = c;
  save(all);
  return { lama, baru: c.senjutsuSS };
}

/* Sistem Senjutsu (Sage Mode) -- Toad / Snake / Slug.
 *
 * SagaShop2015.amfClientLearnSageModeResponse (Panel_2015_Sage_Shop.swf,
 * method 666):
 *      8: if (!validateAmfResponse(res)) return;
 *     22: Central.main.senjutsuSystem = res.senjutsu_system_id;   <-- WAJIB
 *     50: setGold(getGold() - 2000000);        biaya 2 juta gold, dipotong klien
 *     65: if (senjutsuSystem == 2) isToad = true; else isSnake = true;
 *     86: loadPanelContent();
 *     95: hideAmfLoading();
 *    125: panel.show("Panel_2015_Sage_Profile");
 *
 * hideAmfLoading dan perpindahan panel ada DI LUAR cabang validate, jadi
 * balasan kosong tidak menggantung -- tapi senjutsu_system_id yang tidak ada
 * membuat senjutsuSystem jadi undefined, cabang @65 selalu jatuh ke isSnake,
 * dan sistem yang dipilih tidak pernah tersimpan.
 *
 * BIAYA_SENJUTSU_GOLD harus sama dengan angka yang dipotong klien di @50.
 */
const BIAYA_SENJUTSU_GOLD = 2000000;

function pelajariSenjutsu(skillId) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const id = String(skillId == null ? '' : skillId);
  if (!id) return { gagal: 'skillID kosong' };
  if (Number(c.senjutsuSystem) > 1) {
    return { gagal: 'sudah punya sistem senjutsu (' + c.senjutsuSystem + ')',
             sistem: c.senjutsuSystem };
  }

  const gold = Number(c.gold) || 0;
  if (gold < BIAYA_SENJUTSU_GOLD) {
    return { gagal: 'gold kurang (butuh ' + BIAYA_SENJUTSU_GOLD + ', ada ' + gold + ')' };
  }

  // Sistem ditentukan halaman mana yang sedang dibuka, bukan angka skillID:
  //     SagaShop2015.setPanelContent @568-606 -> 2 = Toad, 3 = Snake
  //     amfClientLearnSageModeResponse @65    -> senjutsuSystem == 2 ? Toad : Snake
  // onClickLearn mengirim skillID dari senjutsuModeData, jadi dipetakan lewat
  // angka pertama yang muncul; 2 dan 3 diteruskan apa adanya.
  let sistem = Number(id.replace(/\D/g, ''));
  if (sistem !== 2 && sistem !== 3) sistem = 2;   // aman: default Toad

  c.gold = gold - BIAYA_SENJUTSU_GOLD;
  c.senjutsuSystem = sistem;
  if (!Array.isArray(c.senjutsu)) c.senjutsu = [];
  if (!c.senjutsu.some(x => String(x && x.skill_id ? x.skill_id : x) === id)) {
    c.senjutsu.push({ senjutsu_id: String(sistem), level: '1', skill_id: id });
  }
  all[key] = c;
  save(all);
  return { sistem, skillId: id, biaya: BIAYA_SENJUTSU_GOLD, sisaGold: c.gold };
}

/* Konversi token menjadi poin Senjutsu (SS).
 *
 * Tabel diambil dari konstruktor SagaProfile2015 (Panel_2015_Sage_Profile.swf,
 * m736 @26-54):
 *     ssValue    = [10, 55, 120, 250]
 *     tokenValue = [20, 100, 200, 400]
 * onClickSelectTPType @110-123 menyetel currBtnNum = tokenValue[tombol-1],
 * jadi argumen yang dikirim ke server adalah JUMLAH TOKEN, bukan indeks.
 *
 * SagaProfile2015.convertResponse (method 750):
 *      8: if (!validateAmfResponse(res)) return;
 *     31: getproperty final_sen_spirit
 *     34: updateData(SENJUTSU_SS, res.final_sen_spirit)   <-- WAJIB
 *     42: Account.balance = getAccountBalance() - currBtnNum
 *     55: loadPanelContent()      <-- TextField.text = SENJUTSU_SS
 *
 * Tanpa final_sen_spirit, SENJUTSU_SS jadi undefined lalu dipasang ke
 * TextField -> #2007 Parameter text must be non-null.
 */
const SS_TOKEN_VALUE = [20, 100, 200, 400];
const SS_POINT_VALUE = [10, 55, 120, 250];

function konversiSS(jumlahToken) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const bayar = Number(jumlahToken) || 0;
  const idx = SS_TOKEN_VALUE.indexOf(bayar);
  if (idx < 0) return { gagal: 'paket token tidak dikenal: ' + jumlahToken };

  const punya = Number(c.token) || 0;
  if (punya < bayar) {
    return { gagal: 'token kurang (butuh ' + bayar + ', ada ' + punya + ')' };
  }

  const dapat = SS_POINT_VALUE[idx];
  c.token = punya - bayar;
  c.senjutsuSS = (Number(c.senjutsuSS) || 0) + dapat;
  all[key] = c;
  save(all);
  return { bayar, dapat, totalSS: c.senjutsuSS, sisaToken: c.token };
}

/* Naikkan level satu skill senjutsu.
 *
 * SagaProfile2015.onClickUpGrade (method 763) @99-140 sudah mengurangi
 * SENJUTSU_SS sebanyak nextSkillObj.spcost DI KLIEN sebelum AMF dikirim, dan
 * upgradeResponse (747) menghitung level barunya sendiri tanpa membaca satu
 * pun field balasan. Jadi server hanya perlu menyimpan hasilnya.
 */
function naikkanSkillSenjutsu(skillId, biayaSS = 0) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const id = String(skillId == null ? '' : skillId);
  if (!id) return { gagal: 'skill_id kosong' };
  if (!Array.isArray(c.senjutsu)) c.senjutsu = [];

  const ada = c.senjutsu.find(x => String(x && x.skill_id) === id);
  const levelBaru = ada ? (Number(ada.level) || 0) + 1 : 1;
  if (ada) ada.level = String(levelBaru);
  else {
    // senjutsu_type: 1 = SKILL_TYPE_ACTIVE. Tanpa field ini getSenjutsuListArr
    // @143 membuang entrinya dan skill-nya tidak pernah muncul di bar aksi.
    let sistem = Number(c.senjutsuSystem) || 0;
    if (sistem !== 2 && sistem !== 3) sistem = 2;
    c.senjutsu.push({ senjutsu_id: String(sistem), level: '1',
                      skill_id: id, senjutsu_type: 1 });
  }

  if (biayaSS) c.senjutsuSS = Math.max(0, (Number(c.senjutsuSS) || 0) - Number(biayaSS));
  all[key] = c;
  save(all);
  return { skillId: id, level: levelBaru, sisaSS: Number(c.senjutsuSS) || 0 };
}

/* ===================== BLOODLINE / TALENT ============================
 *
 * Tiga AMF, dan hanya SATU yang butuh field balasan khusus:
 *
 * 1. BloodlineService.discoverBloodline  [sessionKey, bloodlineId, seq, hash]
 *    BloodlineShop.BloodlineDiscoverResponse (bloodline_shop.swf, method 649)
 *    TIDAK membaca satu pun field dari balasan -- @59 hanya memeriksa
 *    validateAmfResponse, lalu semuanya dihitung dari selectObj di klien:
 *      @215-245 kalau selectObj.token > 0 -> Account.balance -= token
 *      @495-548 kalau selectObj.gold  > 0 -> updateData(GOLD, gold - harga)
 *      @800-816 saveTP(20)
 *    Kalau validate gagal, @1186 menampilkan "TEST cannot discover".
 *
 * 2. BloodlineService.convertBP  [sessionKey, idx, idx, jumlahToken, seq, hash]
 *    BloodlineProfile.convertResponse (bloodline_profile.swf, method 720)
 *    juga tidak membaca field balasan -- @55-86 menambah BLOODLINE sebanyak
 *    BPPackage dan @90-108 mengurangi Account.balance sebanyak tokenPackage,
 *    keduanya nilai klien.
 *
 * 3. BloodlineService.skillUpdate  [sessionKey, tipe, lv, skillId, seq, hash]
 *    BloodlineProfile.upgradeResponse (method 723) @544-572:
 *        updateData(BLOODLINE, int(res.remain_bp));      <-- WAJIB
 *    Ini SATU-SATUNYA field yang dibaca. Tanpa itu int(undefined) = 0 dan
 *    poin bloodline pemain jadi nol setiap kali menaikkan skill.
 *
 * Karena klien memotong sendiri, server memakai angka yang sama supaya
 * keduanya tetap sepakat setelah muat ulang.
 */
const BP_TOKEN_VALUE = [20, 100, 200, 400];   // sama dengan paket senjutsu
const BP_POINT_VALUE = [10, 55, 120, 250];

function bloodlinePoin() {
  const all = load();
  const key = activeKey(all);
  if (!key) return 0;
  return Number(all[key].bloodlinePoint) || 0;
}

/* Konversi token -> poin bloodline (BP). */
function konversiBP(jumlahToken) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const bayar = Number(jumlahToken) || 0;
  const idx = BP_TOKEN_VALUE.indexOf(bayar);
  if (idx < 0) return { gagal: 'paket token tidak dikenal: ' + jumlahToken };

  const punya = Number(c.token) || 0;
  if (punya < bayar) return { gagal: 'token kurang (butuh ' + bayar + ', ada ' + punya + ')' };

  const dapat = BP_POINT_VALUE[idx];
  c.token = punya - bayar;
  c.bloodlinePoint = (Number(c.bloodlinePoint) || 0) + dapat;
  all[key] = c;
  save(all);
  return { bayar, dapat, totalBP: c.bloodlinePoint, sisaToken: c.token };
}

/* Buka satu bloodline (talent). selectObj.gold/token dipotong klien; server
 * menyimpan kepemilikannya supaya bertahan setelah muat ulang. */
function bukaBloodline(bloodlineId) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const id = String(bloodlineId == null ? '' : bloodlineId);
  if (!id) return { gagal: 'bloodline_id kosong' };
  if (!Array.isArray(c.bloodline)) c.bloodline = [];

  if (c.bloodline.some(x => String(x && x.bloodline_id) === id)) {
    return { gagal: 'bloodline ' + id + ' sudah dimiliki' };
  }
  // Bentuk entri mengikuti BloodlineDiscoverResponse @139-179:
  //     {bloodline_id: selectObj.id, skill_id: "", level: ""}
  c.bloodline.push({ bloodline_id: id, skill_id: '', level: '' });
  all[key] = c;
  save(all);
  return { bloodlineId: id, total: c.bloodline.length };
}

/* Naikkan level skill bloodline. biayaBP dipotong dari poin yang tersimpan. */
function naikkanSkillBloodline(skillId, level, biayaBP = 0) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  const id = String(skillId == null ? '' : skillId);
  if (!id) return { gagal: 'skill_id kosong' };
  if (!Array.isArray(c.bloodline)) c.bloodline = [];

  const lv = Number(level) || 1;
  const ada = c.bloodline.find(x => String(x && x.skill_id) === id);
  if (ada) ada.level = String(lv);
  else c.bloodline.push({ bloodline_id: '', skill_id: id, level: String(lv) });

  if (biayaBP) {
    c.bloodlinePoint = Math.max(0, (Number(c.bloodlinePoint) || 0) - Number(biayaBP));
  }
  all[key] = c;
  save(all);
  return { skillId: id, level: lv, sisaBP: Number(c.bloodlinePoint) || 0 };
}

/* Tandai notice ujian Special Jounin sudah dilihat.
 * Dipanggil handler CharacterDAO.watchSJENotice, yang dikirim klien dari
 * Main.SJENoticeOk saat tombol OK di popup ditekan. */
function tandaiSJENotice() {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  const sudah = !!c.sjeNoticeWatched;
  c.sjeNoticeWatched = true;
  all[key] = c;
  save(all);
  return { sudah };
}

function recordMission(missionId, sukses = true) {
  const no = String(missionId == null ? '' : missionId).replace(/^msn/i, '').trim();
  if (!/^\d+$/.test(no)) return null;

  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  if (!c.missions || typeof c.missions !== 'object') c.missions = {};
  const e = c.missions[no] || { success: 0, fail: 0, time: 0 };
  if (sukses) e.success = (Number(e.success) || 0) + 1;
  else        e.fail    = (Number(e.fail)    || 0) + 1;
  c.missions[no] = e;

  const rankLama = Number(c.rank != null ? c.rank : 1) || 1;
  c.rank = hitungRank(c);
  const naikRank = c.rank !== rankLama;

  all[key] = c;
  save(all);
  return { no, entry: e, total: Object.keys(c.missions).length,
           rank: c.rank, rankLama, naikRank };
}

function addProgress(xpGain, goldGain) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];

  c.xp   = Math.max(0, (c.xp   || 0) + (Number(xpGain)   || 0));
  c.gold = Math.max(0, (c.gold || 0) + (Number(goldGain) || 0));

  const lvLama = c.level || 1;
  c.level = getLvByXp(c.xp);

  // stat ikut naik tiap level (dari konstanta Data.LEVEL_INC_*)
  if (c.level !== lvLama) {
    const d = c.level - lvLama;
    c.hp  = 100 + (c.level - 1) * 40;
    c.cp  = 100 + (c.level - 1) * 40;
    c.agi = 1   + (c.level - 1);
    c.naikLevel = d > 0;
  }

  all[key] = c;
  save(all);
  return { c, lvLama, naik: c.level - lvLama };
}

/* Menggabungkan statistik pencapaian dari Achievement.flushCharStat. */
function mergeStats(stat) {
  const all = load();
  const key = activeKey(all);
  if (!key) return null;
  const c = all[key];
  c.stats = c.stats || {};
  let n = 0;
  for (const k of Object.keys(stat || {})) {
    const v = Number(stat[k]) || 0;
    if (!v) continue;
    c.stats[k] = (c.stats[k] || 0) + v;
    n++;
  }
  if (n) { all[key] = c; save(all); }
  return n;
}

/* Tanggal format datetime MySQL: "YYYY-MM-DD HH:MM:SS"
 * Klien memprosesnya dengan .replace("-","")... .replace(":","")
 * untuk jadi "YYYYMMDDHHMMSS", jadi WAJIB berupa String — bukan angka.
 */
function sqlDate(unix) {
  const d = new Date((unix || Math.floor(Date.now() / 1000)) * 1000);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* Hash verifikasi extra data.
 *
 * Direkonstruksi dari parseCharacterData @6161-6280 (code_library.swf yang
 * SEDANG dipakai; build lama punya susunan berbeda dan pemeriksaannya di-NOP):
 *
 *   s = pvp + "," + training + "," + petList + "," + consecutive_days
 *       + "," + (roulette_allowed ? "1":"0") + "," + (is_fan ? "1":"0")
 *
 *   6269: Main.getHash(s)
 *   6277: result.extra_data_hash
 *   6280: ifeq -> 6296          cocok, lanjut
 *   6290: Main.onError()        TIDAK cocok
 *   6295: return false
 *
 * PENTING: bagian ketiga adalah daftar PET, bukan daftar skill. Build lama
 * memakai daftar skill di posisi itu; kalau server masih mengirim skill,
 * hash-nya meleset dan parseCharacterData langsung mengembalikan false.
 * Karena Main.onError() menyetel mainChar=null dan mainMc=null, gejalanya
 * menyesatkan: yang terlihat di flashlog cuma "#1009 at initRank()" dan
 * "parseCharacterData failed" tanpa pesan apa pun.
 *
 * Susunan tiap pet, dari @3709-3900:
 *   id "," swfName "," clsName "," level "," xp "," (equipped?"1":"0") ","
 *   lalu DITEMPEL skills.toString() kalau skills truthy   <- tanpa koma lagi
 * Antar pet digabung dengan "," (@3902-3941).
 *
 * pvp      = play,win,lose,disconnect,avg_level_diff; kalau pvp_record null
 *            klien melewati blok itu dan bagiannya tetap "" (@382-412)
 * training = training_skill.id + "," + training_skill.time, atau "" kalau null
 *
 * Main.getHash(s) = SHA1(s + SALT + sessionKey)
 */
function extraDataHash(d, sessionKey) {
  const crypto = require('crypto');
  const SALT = 'Vmn34aAciYK00Hen26nT01';

  const n = v => String(v == null ? 0 : v);
  // @382-412: kalau pvp_record null klien LOMPAT melewati blok ini, jadi
  // bagiannya tetap string kosong -- bukan "0,0,0,0,0".
  const p = d.pvp_record;
  const pvp = p ? [p.play, p.win, p.lose, p.disconnect, p.avg_level_diff].map(n).join(',') : '';

  // DataParser.parseCharacterData memakai penjaga:
  //     var s:String = "";
  //     if (data.training_skill) { s = String(id) + "," + String(time); }
  // Jadi saat training_skill null, klien menghitung string KOSONG — bukan
  // "0,0". Bagian ini harus meniru penjaga itu persis, atau hash tidak cocok
  // dan login ditolak.
  const t = d.training_skill;
  const training = t ? (n(t.id) + ',' + n(t.time)) : '';

  // Daftar pet, meniru @3709-3941 persis termasuk koma penutup sebelum skills.
  const petList = (Array.isArray(d.player_pet) ? d.player_pet : []).map(pet => {
    let e = String(pet && pet.id) + ',' + (pet && pet.swfName) + ',' +
            (pet && pet.clsName) + ',' + String(pet && pet.level) + ',' +
            String(pet && pet.xp) + ',' + ((pet && pet.equipped) ? '1' : '0') + ',';
    if (pet && pet.skills) e += String(pet.skills);
    return e;
  }).join(',');

  const s = [
    pvp,
    training,
    petList,
    String(d.consecutive_days == null ? '' : d.consecutive_days),
    d.roulette_allowed ? '1' : '0',
    d.is_fan ? '1' : '0',
  ].join(',');

  return { input: s, hash: crypto.createHash('sha1').update(s + SALT + sessionKey, 'binary').digest('hex') };
}


/* Rekaman karakter MENTAH untuk CharacterDAO.getCharacterById.
 *
 * Format ini BERBEDA dari databaseCharacter(). DataParser.parseRawCharacter
 * membacanya seperti baris database asli: sebagian besar field adalah
 * string berdelimiter koma yang di-split klien, bukan array.
 *
 *   character_item   = "item1,item2,item3"
 *   character_skill  = "skill13,skill20"
 *   character_weapon = "wpn1,wpn2"
 *
 * String kosong aman: "".split(",") menghasilkan [""], dan klien melewati
 * entri kosong lewat pemeriksaan != "".
 */
/* Blok expiry item untuk getCharacterById.
 *
 * Klien memverifikasi isinya:
 *     slot26 = remove_inv.join(",") + add_inv.join(",") + equip.join(",")
 *            + current_expiry.join(",") + remove_equip.join(",")
 *     if (Main.getHash(String(slot26)) != expiry_data.expiry_hash) {
 *         Main.onError("1300"); return null;
 *     }
 * dan Main.getHash(x) = ClientLibrary.getHash(sessionKey, x) = SHA1(x + SALT + sessionKey).
 * Dengan semua array kosong, slot26 = "" sehingga hash = SHA1(SALT + sessionKey).
 */
/* Daftar bloodline/talent yang dimiliki, dalam bentuk yang dibaca klien.
 *
 * Rantainya persis sama dengan senjutsu, dan salah kirimnya juga sama:
 *     parseCharacterData @5172  getMainChar().bloodline = []
 *                        @5186-5214  push(res.bloodline[i])
 *                        @5449  Add_Dbchar_Bloodline(getMainChar().bloodline)
 *                                 -> @7: dbChar.bloodline = arg
 *
 * `res` = balasan getExtraData. Perhatikan @5449: baris itu MENIMPA
 * dbChar.bloodline. Jadi walaupun sub-objek databaseCharacter di dalam balasan
 * yang sama sudah membawa daftar lengkap, isinya langsung ditimpa oleh array
 * tingkat atas res.bloodline. Selama field itu dikirim kosong, semua talent
 * hilang setiap kali muat ulang -- ini yang bikin "talent terbeli hilang
 * setelah relogin".
 *
 * Bentuk entri: getBloodlineListArr (723) menuntut SATU entri membawa
 * skill_id DAN bloodline_id sekaligus (@62-84 dan @94-114). Entri hasil
 * discoverBloodline yang skill_id-nya kosong, dan entri hasil skillUpdate yang
 * bloodline_id-nya kosong, dua-duanya gugur. Di sini keduanya digabungkan:
 * bloodline_id untuk tiap skill diambil dari tabel BLOODLINE_SKILL.
 *
 * Entri "kepemilikan" (skill_id kosong) tetap ikut dikirim, karena
 * BloodlineShop memakainya untuk menandai bloodline yang sudah dibuka.
 */
function daftarBloodline(c) {
  const src = Array.isArray(c && c.bloodline) ? c.bloodline : [];
  const out = [];
  const sudah = new Set();

  // a. entri per-skill: skill_id + bloodline_id dari tabel klien
  for (const x of src) {
    const sid = String((x && x.skill_id) || '');
    if (!sid) continue;
    const tabel = BLOODLINE_SKILL[sid];
    if (!tabel) continue;                 // skill tak dikenal klien -> dibuang juga di @62-84
    out.push({
      bloodline_id: tabel.bloodline_id,
      skill_id:     sid,
      level:        String((x && x.level) || '1'),
    });
    sudah.add(tabel.bloodline_id);
  }

  // b. entri kepemilikan untuk bloodline yang belum punya skill terlatih
  for (const x of src) {
    const bid = String((x && x.bloodline_id) || '');
    if (!bid || sudah.has(bid)) continue;
    sudah.add(bid);
    out.push({ bloodline_id: bid, skill_id: '', level: '' });
  }

  return out;
}

/* Daftar senjutsu yang dimiliki, dalam bentuk yang dibaca klien.
 *
 * DataParser.parseCharacterData (code_library method 3386) @5247-5395:
 *     5259: getMainChar().senjutsu = []
 *     5266: if (!res.senjutsu) goto 5372          <- kosong = langsung lewat
 *     5285-5312: getMainChar().senjutsu.push(res.senjutsu[i])
 *     5395: getMainChar().Add_Dbchar_Senjutsu(getMainChar().senjutsu)
 *              -> Add_Dbchar_Senjutsu (2243) @3-7:  dbChar.senjutsu = arg
 *
 * `res` di situ adalah balasan getExtraData (slot 32 -- @5403 membaca
 * res.senjutsu_system dari objek yang sama). Jadi daftar senjutsu HARUS ikut
 * di buildExtraData; mengirimnya hanya di databaseCharacter tidak berpengaruh
 * sama sekali, karena dbChar.senjutsu diisi dari sini.
 *
 * CharacterBase.getSenjutsuListArr (724) lalu membaca dbChar.senjutsu dan
 * menyaring tiap entri dengan tiga syarat:
 *     @57-84   SENJUTSU_SKILL_DATA["senjutsu_skill" + e.skill_id]  ada
 *     @89-114  SENJUTSU_DATA["senjutsu" + e.senjutsu_id]           ada
 *     @142-152 tabel["senjutsu_skill"+skill_id].senjutsu_type == SKILL_TYPE_ACTIVE
 *
 * Perhatikan syarat ketiga: senjutsu_type dibaca dari local2 -- yaitu dari
 * TABEL SENJUTSU_SKILL_DATA di data_library_en.swf, BUKAN dari entri kiriman
 * server. Jadi server tidak bisa memaksa satu skill jadi aktif; nilainya sudah
 * tetap di tabel (mis. 3101 dan 3107 bertipe 0 = pasif, jadi memang tidak
 * pernah muncul sebagai tombol).
 *
 * senjutsu_id yang sah hanya 2 (Toad) dan 3 (Snake) -- SENJUTSU_DATA punya
 * senjutsu1/2/3, tapi senjutsu1 dipakai untuk skill Sage Mode (3000), bukan
 * untuk skill bernomor 31xx.
 */
function daftarSenjutsu(c) {
  let sistem = Number(c && c.senjutsuSystem) || 0;
  if (sistem !== 2 && sistem !== 3) sistem = 2;
  return (Array.isArray(c && c.senjutsu) ? c.senjutsu : []).map(x => ({
    senjutsu_id:   String(sistem),
    skill_id:      String((x && x.skill_id) || ''),
    level:         String((x && x.level) || '1'),
    senjutsu_type: (x && x.senjutsu_type != null) ? Number(x.senjutsu_type) : 1,
  })).filter(x => x.skill_id);
}

function expiryBlock(sessionKey) {
  const crypto = require('crypto');
  const SALT = 'Vmn34aAciYK00Hen26nT01';
  const gabungan = '';   // kelima join dari array kosong
  return {
    remove_inv_arr:     [],
    add_inv_arr:        [],
    equip_arr:          [],
    remove_equip_arr:   [],
    current_expiry_arr: [],
    expiry_pet_data:    [],
    expiry_hash: crypto.createHash('sha1')
      .update(gabungan + SALT + String(sessionKey), 'binary').digest('hex'),
  };
}

function rawCharacter(c, sessionKey) {
  const r = {
    bloodline:                             daftarBloodline(c),
    character_accessory:                   '',
    character_armor:                       0,
    character_back_item:                   '',
    // Poin bloodline (BP). BloodlineProfile membacanya lewat
    //     getMainChar().getData("character_bloodline")
    // dan memasangnya ke yourBPTxt -- kalau 0 di sini, BP tampil nol setelah
    // muat ulang walaupun tersimpan benar di server.
    character_bloodline:                   String(Number(c && c.bloodlinePoint) || 0),
    character_body_set:                    '',
    character_common_currency:             '',
    character_control:                     0,
    character_earth:                       0,    // elemen: angka, samakan dgn createCharacter
    character_equipped_accessory:          '',
    character_equipped_back_item:          '',
    character_equipped_body_set:           [],
    character_equipped_skills:             '',
    character_equipped_trade_back_item:    '',
    character_equipped_trade_body_set:     '',
    character_equipped_trade_weapon:       '',
    character_equipped_weapon:             '',
    character_face:                        '',
    character_fire:                        0,
    character_gender:                      0,
    character_genjutsu:                    0,
    character_gold:                        0,
    character_hair:                        '',
    character_hair_color:                  [],   // dipakai sbg indeks getHairColorArr()
    character_hash:                        '',
    character_id:                          '',
    character_inv_hair:                    '',
    character_inv_slots:                   0,
    character_item:                        '',
    character_level:                       '',
    character_lightning:                   0,
    character_magatama:                    '',
    character_material:                    '',
    character_mission:                     '',
    character_name:                        '',
    character_ninja_essence:               '',
    character_npc:                         '',
    character_pre_hash:                    '',
    character_rank:                        '',  // ditimpa dari c.rank di bawah
    character_skill:                       '',
    character_skin_color:                  0,    // indeks getSkinColorArr(), createCharacter kirim angka
    character_summon:                      0,
    character_taijutsu:                    0,
    character_trade_item:                  '',
    character_water:                       0,
    character_weapon:                      '',
    character_wind:                        0,
    character_xp:                          '',
    daily:                                 {},
    // expiry_data WAJIB objek berisi kelima array di bawah — bukan [].
    //
    // Di parseRawCharacter, tiap array dipasang lewat penjaga:
    //     if (data.expiry_data.remove_inv_arr) { slot27 = ...; }
    // Kalau field-nya tidak ada, penjaga melompat dan slot27 TETAP null
    // (variabel bertipe Array, nilai awalnya null). Beberapa ratus instruksi
    // kemudian, di luar try/catch mana pun:
    //     if (slot27.length > 0 || slot28.length > 0 || ...)
    // -> null.length -> #1009, dan parser mati di tengah jalan.
    //
    // Dengan array kosong (bukan tidak ada), penjaga lolos, slot terisi,
    // dan .length aman bernilai 0.
    //
    // expiry_pet_data dan expiry_hash juga SUB-FIELD dari expiry_data,
    // bukan field tingkat atas — dibaca di offset 3878 dan 4086 sebagai
    // data.expiry_data.expiry_pet_data dan data.expiry_data.expiry_hash.
    expiry_data:                           expiryBlock(sessionKey),
    stateInventory:                        {},
    senjutsu:                              daftarSenjutsu(c),
    senjutsu_spirit:                       '',
    stateInv:                              {},
  };

  // Diberikan langsung ke dbChar[INVSLOT] tanpa diparsing, lalu klien
  // membaca .weapon/.body_set/.item/.essence/.material/.back/.pet darinya
  // untuk mengisi Data.INV_SPACE_*_CURNUM. Kalau bukan objek, aksesnya
  // melempar #1010 di onAmfGetCharacterResult — callback berhenti dan
  // spinner loading tidak pernah ditutup.
  r.character_inv_slots = {
    item:      40,
    weapon:    200,
    body_set:  200,
    back:      200,
    accessory: 200,
    essence:   200,
    material:  200,
    pet:       99,
  };

  r.character_id     = String(c.character_id);
  r.character_name   = c.name;
  r.character_level  = String(c.level);
  r.character_xp     = String(c.xp);
  r.character_gold   = c.gold;
  r.character_gender = c.gender;
  r.character_face   = String(c.face);
  r.character_hair   = String(c.hair);
  r.character_skin_color = Number(c.skin_color);

  // Riwayat misi yang sudah diselesaikan. Format dibaca DataParser.parseRawCharacter:
  //   antar-misi dipisah ','  dan tiap entri 4 bagian dipisah ':' ->
  //   "<nomor>:<success>:<fail>:<time>"  mis. "55:1:0:0,56:2:0:0"
  // Klien menyimpannya sebagai mission['msn' + nomor] = {success, fail, time}.
  // Kalau dikirim string kosong, klien menganggap belum ada misi yang selesai
  // dan rantai misi berjenjang (mis. ujian Chuunin) mengulang dari tahap awal.
  r.character_mission = serializeMissions(c.missions);

  // Kelas Special Jounin. Klien menyimpannya di DBCharacterData.CONTROL
  // (= field character_control), lihat ExamPanel.onAmfSPClassResult:
  //     mainChar.updateData(DBCharacterData.CONTROL, spClass)
  //     mainChar.setClassSkillListArr(CLASS_SKILL_ARR[spClass - 1])
  // Nilainya 1..n sesuai kelas yang dipilih; 0 berarti belum memilih.
  // Tanpa dikirim balik, kelas (beserta skill kelasnya) hilang tiap relogin.
  r.character_control = Number(c.sjClass) || 0;

  // Lihat komentar panjang di databaseCharacter() -- rank ini yang membuka
  // bangunan pet shop dan bloodline (talent) di peta tanpa menunggu level 20.
  r.character_rank = c.rank != null ? c.rank : 1;

  const el = Array.isArray(c.elements) ? c.elements : [0, 0, 0, 0, 0];
  r.character_fire      = Number(el[0]) || 0;
  r.character_water     = Number(el[1]) || 0;
  r.character_wind      = Number(el[2]) || 0;
  r.character_earth     = Number(el[3]) || 0;
  r.character_lightning = Number(el[4]) || 0;

  // Inventaris tersimpan, dipisah per kantong. Klien menambahkan awalannya
  // sendiri, jadi yang dikirim hanya angkanya.
  const bag = k => (Array.isArray(c[k]) ? c[k] : []).join(',');
  r.character_item       = bag('items');
  r.character_weapon     = bag('weapons');
  // Nilai cadangan HARUS tanpa awalan. parseRawCharacter @2332-2348 memecah
  // character_body_set dengan "," lalu menambahkan sendiri awalan "set":
  //     2334: pushstring 'set'
  //     2345: getproperty [rt]        <- potongan hasil split
  //     2348: add                     -> "set" + "1"
  // Mengirim 'set1' menghasilkan "setset1", yang tidak ada di BODY_SET_BOY/
  // BODY_SET_GIRL, sehingga parseCharacterData @4906 melempar
  //     "parseCharacterData :: bodySetId >> setset1 not exist."
  // dan seluruh getExtraData gagal diurai. Bug ini hanya muncul saat daftar
  // bodysets KOSONG, karena hanya waktu itulah nilai cadangan ini terpakai.
  r.character_body_set   = bag('bodysets') || '1';
  r.character_inv_hair   = bag('hairs');
  r.character_back_item  = bag('backitems');
  r.character_accessory  = bag('accessories');

  // Skill tersimpan. Di jalur rawCharacter field-nya bernama character_skill
  // (tunggal) dan berupa string dipisah koma.
  r.character_skill = (Array.isArray(c.skills) ? c.skills : []).join(',');

  // Perlengkapan TERPASANG — terpisah dari daftar kepemilikan di atas, dan
  // TANPA awalan, karena parseRawCharacter menambahkannya sendiri:
  //
  //   @1341  BODY_PARTS.weapon = "wpn" + character_equipped_weapon
  //   @2202  BODY_SET          = "set" + character_equipped_body_set
  //
  // Jadi mengirim "wpn2" menghasilkan "wpnwpn2" dan senjatanya tidak
  // ditemukan — tampak seperti kembali ke bawaan.
  //
  // character_body_set BUKAN yang dipakai melainkan yang DIMILIKI (@2271,
  // di-split "," lalu diberi awalan "set"), jadi jangan ditimpa di sini.
  {
    const eq = c.equip || {};
    const polos = v => String(v || '').replace(/^(wpn|set|back|acsy)/, '');
    r.character_equipped_weapon     = polos(eq.weapon);
    r.character_equipped_body_set   = polos(eq.bodySet);
    r.character_equipped_skills     = (eq.jutsu || []).join(',');
    r.character_equipped_back_item  = polos(eq.backItem);
    r.character_equipped_accessory  = polos(eq.accessory);
  }

  // Gerbang terakhir parseRawCharacter (offset 7831..7982):
  //
  //   slot60 = String(character_level)  + "," + String(character_xp)
  //          + "," + String(character_rank) + "," + String(character_equipped_skills)
  //          + "," + String(character_fire)  + "," + String(character_water)
  //          + "," + String(character_earth) + "," + String(character_lightning);
  //
  //   if (character_pre_hash != Main.getHash(slot60)) {
  //       Out.error("Character Data Error 2"); Main.onError(); return null;
  //   }
  //
  // Perhatikan: character_wind TIDAK ikut, dan urutannya bukan urutan elemen
  // yang biasa. Hash-nya dihitung dari isi `r` sendiri supaya tidak pernah
  // melenceng kalau salah satu field di atas diubah kemudian.
  {
    const crypto = require('crypto');
    const SALT = 'Vmn34aAciYK00Hen26nT01';
    const preInput = [
      r.character_level, r.character_xp, r.character_rank,
      r.character_equipped_skills, r.character_fire, r.character_water,
      r.character_earth, r.character_lightning,
    ].map(v => String(v)).join(',');
    r.character_pre_hash = crypto.createHash('sha1')
      .update(preInput + SALT + String(sessionKey), 'binary').digest('hex');
  }

  return r;
}

/* Respons lengkap untuk getExtraData.
 *
 * Berisi SEMUA field yang dibaca DataParser.parseCharacterData (hasil
 * pemindaian bytecode), dengan tipe yang disimpulkan dari cara klien
 * memakainya: .length / push / coerce Array -> Array, split -> String,
 * Boolean() -> Boolean, int()/parseInt() -> Number, akses .sub -> Object.
 *
 * Mengirim field yang tidak dipakai tidak berbahaya; yang berbahaya
 * adalah field yang dipakai tapi tidak dikirim, atau salah tipe.
 */
function buildExtraData(c, sessionKey) {
  const now = Math.floor(Date.now() / 1000);
  const d = {
    // Dipakai Roulette2 di daily_login.swf (Roulette2.onRun):
    //     var times:int   = int(claimResponse.claimed_times);
    //     var items:Array = claimResponse.items as Array;
    //     mc.dayBar.gotoAndPlay("day" + Math.min(times, items.length - 1));
    //
    // Tanpa `items`, `as Array` menghasilkan null dan `.length` melempar
    // #1009 di Roulette2/frame9. Kalau items KOSONG, indeksnya jadi -1 dan
    // label frame "day-1" tidak ada — jadi harus berisi.
    // allow_to_claim 0 membuat tombol klaim di-disable, sehingga
    // checkResult()/onResult() yang membaca items[i] tidak pernah jalan.
    DailyReward: {
      allow_to_claim: 0,
      claimed_times:  0,
      // Tiap entri harus OBJEK, bukan String. Roulette2.getDisplayStr():
      //     var t:String = String(item.item_type);
      //     var amt:int  = int(item.amount);
      //     switch (t) { case "GOLD": return amt + "gold"; ... }
      // Entri berupa String melempar
      //   #1069: Property item_type not found on String
      // di getDisplayStr <- renderSlot <- onRun.
      items: [
        { item_type: 'GOLD', amount: 100 },
        { item_type: 'GOLD', amount: 150 },
        { item_type: 'GOLD', amount: 200 },
        { item_type: 'XP',   amount: 100 },
        { item_type: 'GOLD', amount: 250 },
        { item_type: 'XP',   amount: 150 },
        { item_type: 'GOLD', amount: 300 },
      ],
    },
    GodSnapCountDown: null,
    UnstoppableRageCountDown: null,
    achievement: null,
    achievement_point:                       0,
    adsArr: null,
    all_event_login_data: null,
    anni5th_tutorial_need_display: null,
    anni8thDoubleExpGold_times: null,
    anni_mission_id: null,
    arena_version:                           '',
    // WAJIB berisi daftar sungguhan: parseCharacterData @5449 memakai array ini
    // untuk MENIMPA dbChar.bloodline. Kosong di sini = semua talent hilang tiap
    // kali login, tak peduli apa yang ada di sub-objek databaseCharacter.
    bloodline:                               daftarBloodline(c),
    bp_mission_id: null,
    canClaimFK: null,
    char_statistic: null,
    character_create_date:                   0,
    christmas_2014_special_reward: null,
    christmas_coin: null,
    claim_remain: null,
    clan_chain:                              '',
    clan_id:                                 0,
    clan_version:                            '',
    combine_boost_time: null,
    combine_boost_time_in_period: null,
    combine_boost_time_period_end_left: null,
    combine_boost_time_period_start_left: null,
    consecutive_days:                        '',
    daily_login: null,
    daily_login_data:                        [],
    daily_stamp_available: null,
    dailygift_gift_list: null,
    dailygift_request_limit: null,
    date: null,
    double_exp: null,
    dragon_pet_christmas: null,
    event_170m_like: null,
    event_daily_login:                       {},
    event_gift_bag: null,
    extra_data_hash: null,
    file_1:                                  [],
    file_2:                                  [],
    file_3:                                  [],
    football_2018_claim: null,
    // Jumlah gosokan gratis yang tersisa. DataParser.parseCharacterData
    // @6326-6362:
    //     if (data.free_roulette_times) {
    //         Main.dailyRoulette_remainTime = data.free_roulette_times;
    //         Main.currScartchCard          = data.free_roulette_times;
    //     } else Main.currScartchCard = -1;
    //
    // daily_login4.updateIdlePanel @236-258 baru MENGAKTIFKAN tombol gosok
    // kalau remainScratchTime != 0 atau remainSpcScratchTime != 0; kalau
    // nol keduanya, ketiga tombol tetap disabled dan panel terlihat kosong.
    free_roulette_times: 3,
    friend_accept_reward: null,
    friendship_kunai: null,
    gacha: null,
    get_hunting_passport: null,
    get_learning_status:                     [],
    handoff_nonce:                           '',
    handoff_token:                           '',
    invite_accepted: null,
    isGraphic: null,
    // updateIdlePanel @229-232: if (!getMainChar().isFan) lompat ke cabang
    // non-fan yang tidak pernah menyalakan tombol gosok gratis.
    // parseCharacterData @4994-4997: mainChar.isFan = data.is_fan
    is_fan: true,
    is_founder: null,
    is_hard_mode_locked: null,
    is_valentine: null,
    kojima_event: null,
    layout: null,
    level_80_exam_reward_list_read: null,
    lny_2012_cake: null,
    lny_2012_cake_added: null,
    lucky_draw_case: null,
    lucky_spin_consecutive_day: null,
    lucky_spin_multiplier: null,
    lucky_spin_remaining_spin: null,
    lucky_spin_show_wheel: null,
    map_key: '00',
    minik_xmas_gift:                         '',
    new_account_reward: null,
    new_clan_promote:                        {},
    new_mail:                                false,
    new_year_2015_clothes: null,
    newsArr: null,
    newsId: null,
    newsfeed_easter_2014_posted: null,
    newsfeed_material_posted: null,
    noticeText: null,
    once_gift:                               [],
    option_data:                             { music_index: 0, music_volume: 1, sound_on: 1 },
    // Diisi dari c.pets -- lihat daftarPet(). Entri equipped:true masuk
    // Character._pet (ikut bertarung), sisanya ke _standbyPet (koleksi).
    player_pet:                              daftarPet(c, sessionKey),
    popup_arr: null,
    premium_claim_level: null,
    premium_claim_skill_set: null,
    premium_daily_token: null,
    prestige:                                0,
    proc:                                    null,
    promo_expired: null,
    promotion: null,
    pve_version:                             '',
    pvpSchedule: null,
    pvp_invite: null,
    // PvpShopPanel membaca extraData.pvp_record.pvp_currency di enam method
    // (onShow, setPanelContent, updateGoldDisplay, showBuySellQuantity,
    // onAddBtn, buyItem, buyItemResponse, sellItemResponse). Dengan null,
    // onShow() langsung melempar #1009 dan panel PvP Shop tidak pernah tampil.
    //
    // Lima field pertama ikut dihitung ke extra_data_hash (lihat
    // extraDataHash di bawah), dan nilainya 0 semua -> "0,0,0,0,0",
    // sama seperti saat pvp_record masih null. Jadi hash tidak bergeser.
    pvp_record: {
      play: 0, win: 0, lose: 0, disconnect: 0, avg_level_diff: 0,
      pvp_currency: 0,
    },
    reaming_pet: null,
    recent_achievement: null,
    remaining_skill: null,
    request_list_length: null,
    requests:                                [],
    roulette_allowed:                        true,
    sakura_event: null,
    se_day_count_open: null,
    se_end_date: null,
    se_end_date_notice: null,
    // WAJIB string 2 digit, bukan angka. MapBase.initBuildings() merender digit
    // "Season" di gedung Clan/Crew dengan gotoAndStop("d" + charAt(i)) dan loop-nya
    // SELALU 2 iterasi tanpa cek panjang string. Kalau nilainya angka (mis. 0) lalu
    // ke-coerce jadi string 1 karakter ("0"), charAt(1) mengembalikan "" sehingga
    // jadi gotoAndStop("d") -> ArgumentError #2109 "Frame label d not found" ->
    // initBuildings() berhenti di tengah dan gedung/tombol lain ikut gagal dirender
    // (gejala "klip klip" di peta).
    seasonNumber:                            '00',
    seasonNumber_crew:                       '00',
    // WAJIB berisi daftar sungguhan. parseCharacterData @5266 hanya menyalin
    // dari SINI ke dbChar.senjutsu; selama array ini kosong, getSenjutsuListArr
    // selalu mengembalikan [] dan tidak ada satu pun tombol senjutsu di bar aksi
    // pertarungan -- persis gejala "SenjutsuListArr length: 0" di flashlog.
    senjutsu:                                daftarSenjutsu(c),
    // Sistem Sage Mode. DataParser.parseCharacterData @5401-5423:
    //     if (data.senjutsu_system) Central.main.senjutsuSystem = data.senjutsu_system;
    // Perhatikan `if` di @5406: nilai 0/null/undefined DILEWATI, dan
    // Main.senjutsuSystem tetap -1 (nilai awal di m18 @471-476).
    //
    // SagaShop2015.setPanelContent memakai nilai itu untuk menentukan tampilan:
    //     @568-606  isToad  = (senjutsuSystem == 2)
    //               isSnake = (senjutsuSystem == 3)
    //     @894-913  btnLearnToad  tampil kalau senjutsuSystem == 1
    //     @919-929  txtLearnedDesc tampil kalau senjutsuSystem > 1
    //     @930-945  btnLearnPad    tampil kalau senjutsuSystem > 1
    //
    // Jadi artinya:
    //     1 = belum memilih  -> tombol Learn AKTIF
    //     2 = sudah Toad
    //     3 = sudah Snake
    // Selama field ini null, senjutsuSystem bernilai -1: bukan 1, jadi tombol
    // Learn tidak pernah tampil, dan bukan > 1, jadi teks "sudah dipelajari"
    // juga tidak tampil -- halaman terlihat kosong dan tidak bisa diklik.
    senjutsu_system: Number(c && c.senjutsuSystem) || 1,
    showFanPage: null,
    showNotice: null,
    sje_end_date:                            0,
    // Notice "14 days activation has past..." pada ujian Special Jounin.
    //
    // DataParser.parseCharacterData @7581-7587:
    //     Central.main.sje_notice = int(data.sje_end_date_notice);
    // Main.updateMapSideBtn @820-892:
    //     if (getMainChar().getData(CONTROL) > 0 && Central.main.sje_notice == 0)
    //         Central.main.showOk(langLib.get(1437)[33], SJENoticeOk);
    //
    // character_control (= sjClass) sudah > 0 begitu kelas Special Jounin
    // dipilih, jadi selama field ini 0 notice-nya muncul TIAP login. Klien
    // menaikkannya sendiri di Main.onSJENoticeResult setelah tombol OK
    // ditekan, tapi hanya di memori -- server yang harus mengingatnya.
    sje_end_date_notice:                     (c && c.sjeNoticeWatched) ? 1 : 0,
    statistic_battle: null,
    sum_1:                                   [],
    sum_2:                                   [],
    sum_3:                                   [],
    total_friend_accepted: null,
    trainingFdSkill:                         { trainingTime: 0 },
    // null, BUKAN { id: 0, time: 0 }.
    // Character.verifyTrainingSkill() berbunyi:
    //     if (this._trainingSkill == null) { cb(); return; }
    // Dengan objek (walau id-nya 0) penjaga itu terlewati, klien menaikkan
    // lapisan pemblokir lalu mengirim CharacterDAO.verifyTrainingSkill. Kalau
    // balasannya membuat klien lanjut, ia menyimpan trainingSkill = {id:"0"},
    // dan UIModule_TrainTimer.updateSkillTimerInfo membaca
    // SKILL_DATA["0"].type -> undefined -> #1010, akademi membeku.
    // Dengan null, seluruh rantai itu tidak pernah dimulai.
    training_skill:                          null,
    tutorial_expiry_item: null,
    valentine_event: null,
    veteran_return_fk_accepted: null,
    xmas2014_tutorial_need_display: null,
  };


  // Field ini diakses klien lewat variabel lokal, sehingga luput dari
  // pemindaian otomatis. Dikirim manual agar tidak undefined.
  d.skills   = [];
  d.socket   = null;
  d.coreData = {};

  // Field ini dibaca klien dengan pengaman `if (field) { ...isi... }`.
  // Kalau null, blok pengisinya DILEWATI dan objek tujuannya tetap null —
  // lalu Achievement.updateCharStat() melempar #1009 saat misi selesai.
  // Jadi harus non-null meski isinya kosong.
  d.achievement        = [];   // -> mainChar.achievement
  d.recent_achievement = [];   // -> mainChar.recentAchievement
  d.statistic_battle   = {};   // -> mainChar.statisticBattle
  d.char_statistic     = c.stats || {};   // -> mainChar.statisticChar
  d.gacha              = {};
  d.daily_login        = {};
  d.all_event_login_data = {};
  d.event_daily_login  = {};
  d.pvpSchedule        = [];
  d.pvp_invite         = [];
  d.adsArr             = [];
  d.newsArr            = [];
  d.popup_arr          = [];
  d.lucky_draw_case    = [];
  d.dailygift_gift_list = [];
  d.requestData        = [];

  // nilai nyata
  d.databaseCharacter    = databaseCharacter(c);
  d.coreData             = {};
  d.server_time          = now;
  d.current_date         = now;
  d.character_create_date = sqlDate(c.created);   // String, bukan angka
  d.pvp_server_status    = 0;

  return d;
}

module.exports = {
  validate, DB_TYPES, extraDataHash, rawCharacter,
  getLvByXp, xpForLevel, addProgress, mergeStats,
  recordMission, serializeMissions, simpanKelasSJ,
  graduasiSennin, tierSennin, tandaiSJENotice, tambahSenjutsuSS,
  pelajariSenjutsu, BIAYA_SENJUTSU_GOLD,
  konversiSS, naikkanSkillSenjutsu, SS_TOKEN_VALUE, SS_POINT_VALUE,
  konversiBP, bukaBloodline, naikkanSkillBloodline, bloodlinePoin,
  buatKlan, klanAktif, bubarkanKlan, klanKosong, BIAYA_BUAT_KLAN_TOKEN,
  donasiKlan, anggotaKlan,
  bangunBangunanKlan, daftarBangunan, hitungBonusKlan, BUILDING_DATA,
  upgradeStaminaKlan, restoreStaminaKlan, tambahSlotAnggota,
  setActiveCharacter, getActiveId, characterById, hitungRank,
  createCharacter, firstCharacter, listCharacters,
  setElements, addItem, removeItem, addSkill, setEquip, kantongDari,
  addPet, removePet, setPetEquipped, listPets, daftarPet, xpPetUntukLevel,
  petBuyResult, bayarPet, petAsset, petById, PET_DATA,
  petBisaBertarung, skillPetTerlatih, latihSkillPet, biayaLatih,
  statusMisiSennin, SS_MISSION,
  databaseCharacter, buildExtraData,
};
