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
 *   0 STUDENT  1 GENIN  2 CHUNIN  3 CHUNIN_TALENTED  4 JOUNIN
 *   5 JOUNIN_TALENTED  6 SPECIAL_JOUNIN  ...
 *
 * Rangkaian misi tiap ujian diambil dari ninjasaga.data::Data:
 *   EXAM_CHUNIN_ARR = msn55..msn59
 *   EXAM_JOUNIN_ARR = msn132..msn136
 *
 * Klien TIDAK pernah menaikkan rank sendiri — panel ujian hanya menjalankan
 * misinya. Kenaikan rank memang tugas server, jadi tanpa perhitungan ini
 * karakter selamanya bertahan di Genin walau seluruh ujian sudah tuntas.
 */
const EXAM_CHUNIN = ['55', '56', '57', '58', '59'];
const EXAM_JOUNIN = ['132', '133', '134', '135', '136'];

function semuaTuntas(missions, daftar) {
  if (!missions) return false;
  return daftar.every(no => Number((missions[no] || {}).success) > 0);
}

/* Rank yang seharusnya dimiliki karakter berdasarkan riwayat misinya.
 * Tidak pernah menurunkan rank yang sudah tercatat. */
function hitungRank(c) {
  const sekarang = Number(c && c.rank != null ? c.rank : 1) || 1;
  const m = c && c.missions;
  let seharusnya = 1;                        // GENIN
  if (semuaTuntas(m, EXAM_CHUNIN)) seharusnya = 2;   // CHUNIN
  if (semuaTuntas(m, EXAM_JOUNIN)) seharusnya = 4;   // JOUNIN
  return Math.max(sekarang, seharusnya);
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
 * Direkonstruksi dari parseCharacterData (code_library.swf, pc 5793-5927):
 *   s = pvp + "," + training + "," + skillList + "," + consecutive_days
 *       + "," + (roulette_allowed ? "1":"0") + "," + (is_fan ? "1":"0")
 *   dan klien membandingkan Main.getHash(s) dengan result.extra_data_hash.
 *
 * pvp      = play,win,lose,disconnect,avg_level_diff  (dari pvp_record;
 *            kalau pvp_record null, klien memakai 0 untuk semuanya)
 * training = training_skill.id + "," + training_skill.time
 * skillList= daftar id skill dipisah koma ("" kalau belum punya skill)
 *
 * Main.getHash(s) = SHA1(s + SALT + sessionKey)   <- sama seperti login
 */
function extraDataHash(d, sessionKey) {
  const crypto = require('crypto');
  const SALT = 'Vmn34aAciYK00Hen26nT01';

  const p = d.pvp_record || {};
  const n = v => String(v == null ? 0 : v);
  const pvp = [p.play, p.win, p.lose, p.disconnect, p.avg_level_diff].map(n).join(',');

  // DataParser.parseCharacterData memakai penjaga:
  //     var s:String = "";
  //     if (data.training_skill) { s = String(id) + "," + String(time); }
  // Jadi saat training_skill null, klien menghitung string KOSONG — bukan
  // "0,0". Bagian ini harus meniru penjaga itu persis, atau hash tidak cocok
  // dan login ditolak.
  const t = d.training_skill;
  const training = t ? (n(t.id) + ',' + n(t.time)) : '';

  const skillList = (d.databaseCharacter.character_skills || [])
    .map(s => (s && s.id != null) ? s.id : s).join(',');

  const s = [
    pvp,
    training,
    skillList,
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
    bloodline:                             [],   // createCharacter kirim Array, bukan ''
    character_accessory:                   '',
    character_armor:                       0,
    character_back_item:                   '',
    character_bloodline:                   0,
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
    senjutsu:                              [],
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
  r.character_body_set   = bag('bodysets') || 'set1';
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
function buildExtraData(c) {
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
    bloodline:                               [],
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
    free_roulette_times: null,
    friend_accept_reward: null,
    friendship_kunai: null,
    gacha: null,
    get_hunting_passport: null,
    get_learning_status:                     [],
    handoff_nonce:                           '',
    handoff_token:                           '',
    invite_accepted: null,
    isGraphic: null,
    is_fan: null,
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
    player_pet:                              [],
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
    roulette_allowed:                        false,
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
    senjutsu:                                [],
    senjutsu_system: null,
    showFanPage: null,
    showNotice: null,
    sje_end_date:                            0,
    sje_end_date_notice:                     0,
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
  recordMission, serializeMissions,
  setActiveCharacter, getActiveId, characterById, hitungRank,
  createCharacter, firstCharacter, listCharacters,
  setElements, addItem, removeItem, addSkill, setEquip, kantongDari,
  databaseCharacter, buildExtraData,
};
