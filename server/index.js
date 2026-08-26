'use strict';
/* Gateway AMF Ninja Saga — respons login sesuai hasil pembongkaran bytecode.
 *
 * Rantai verifikasi yang direkonstruksi dari client_library.swf:
 *   Account.setupAccount(result, signature)
 *     result = [ account_id, account_type, account_balance, session_key ]
 *     cek: signature == SHA1( id + "|" + type + "|" + balance + SALT + session_key )
 *     lolos jika account_id > 0
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { decodePacket, encodePacket } = require('./amf');
const { buildStub } = require('./stub');
const chars = require('./chardata');
const { cloneFrom } = require('./assetclone');
const HARGA = require('./harga');   // id -> [gold, crystal]
const { HAIR_DATA } = require('./hairdata');   // tabel rambut Style Shop

const PORT = 8080;
const LOG = path.join(__dirname, 'amf-log.txt');

// Salt dari slot ClientLibrary._s
const SALT = 'Vmn34aAciYK00Hen26nT01';

// ---- Ubah ke 1 kalau ingin klien masuk ke pembuatan karakter ----
const IS_NEW_ACCOUNT = 0;

// Ninja Emblem = keanggotaan premium. Ubah ke false untuk kembali biasa.
// Nilainya dikonfirmasi dari konstanta kelas ninjasaga:Account di
// network_library.swf:  FREE = 1,  PREMIUM = 2
const EMBLEM = true;

const ACCOUNT = {
  id: 1,
  // Dibaca Account.setupAccount() sebagai result[1] lalu disimpan ke
  // account_type; Account.getAccountType() memverifikasinya terhadap
  // accountTypeHash = SHA1(String(account_type)) yang dihitung klien sendiri,
  // jadi tidak ada yang perlu kita tandatangani untuk bagian ini.
  type: EMBLEM ? 2 : 1,
  balance: 0,       // saldo token
  sessionKey: 'localdevsession0001',
};

// Versi aset. Klien memetakan tiap entri ke AppData[type + "Ver"],
// dan nilainya dipakai LANGSUNG sebagai nama folder di path:
//   cdn/swf/<version>/swf/<kategori>/<nama>.swf
// Karena folder Anda bernama "latest", nilainya harus "latest" juga.
// Kategori di bawah ini terkonfirmasi dari permintaan nyata klien.
const SWF_VERSIONS = [
  'data', 'library', 'language', 'panels', 'items', 'actions',
  'sns', 'skills', 'npc', 'enemies', 'mission', 'pets', 'icons', 'sound',
].map(type => ({ type, version: 'latest' }));

const sha1 = s => crypto.createHash('sha1').update(s, 'binary').digest('hex');

// penghitung id pertarungan, dinaikkan tiap misi dimulai
let battleSeq = 0;

function signAccount(a) {
  return sha1(`${a.id}|${a.type}|${a.balance}` + SALT + a.sessionKey);
}

function log(...a) {
  const line = a.map(x => typeof x === 'string' ? x : JSON.stringify(x, null, 1)).join(' ');
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}


/* Field yang dibaca parseSystemData.
 * Data berat (skill/item/weapon/enemy) TIDAK dikirim di sini karena
 * Data.TEST_VERSION = false, sehingga klien mengambilnya dari
 * data_library_en.swf lewat dataLib.getSkill(), dst.
 */
function systemDataFields() {
  const now = Math.floor(Date.now() / 1000);
  return {
    server_time: now,
    current_date: now,
    // kalau diisi, klien memanggil socket.setServer(nilai ini)
    pvp_server_status: 0,
    animation: [],
    news: [],
    ads_path: [],
    special_ads: [],
    proc: null,
  };
}

// ---------------------------------------------------------------
/* Isi paket, dibaca langsung dari Anni4_ClaimCode.show() di tiap popup.
 *
 * PENTING: jangan memakai ClaimRewardArr dari konstruktor. Nilai di situ
 * ('hair_757','set_1255','back_684','wpn_1498') ternyata sisa salinan yang
 * SAMA di p8 maupun p11, dan langsung ditimpa oleh show() @21-80:
 *
 *     if (CHAR_GENDER == 0) ClaimRewardArr = [ ...versi laki-laki... ];
 *     else                  ClaimRewardArr = [ ...versi perempuan... ];
 *
 * Baju, rambut, dan senjata punya versi per jenis kelamin; tas, skill, dan
 * pet dipakai bersama. Sudah dicocokkan dengan data_library_en.swf:
 *     set2248 BOY / set2249 GIRL      hair683 gender 0 / hair684 gender 1
 *     set1430 BOY / set1431 GIRL      hair429 gender 0 / hair430 gender 1
 */
const PAKET_AGUSTUS = {
  0: ['set_2248', 'wpn_1343', 'hair_683', 'back_557', 'skill_719', 'pet_71'],
  1: ['set_2249', 'wpn_1343', 'hair_684', 'back_557', 'skill_719', 'pet_71'],
};
const PAKET_PATRIOT = {
  0: ['set_1430', 'wpn_1109', 'hair_429', 'back_427', 'skill_896', 'pet_205'],
  1: ['set_1431', 'wpn_1109', 'hair_430', 'back_427', 'skill_896', 'pet_205'],
};

/* Magic Package -- popup_4th_claim_code_p15.swf, servis
 * SpecialReward.claimMagicPackage.
 *
 * Dibaca dari Anni4_ClaimCode.show() @21-83, yang menimpa ClaimRewardArr
 * menurut CHAR_GENDER (ingat: nilai di KONSTRUKTOR sama di semua popup dan
 * bukan isi paket):
 *     @27  gender 0 -> set_2424 wpn_1502 hair_765 back_688 skill_914 pet_157
 *     @59  gender 1 -> set_2425 wpn_1502 hair_766 back_688 skill_914 pet_157
 *
 * Semua id dicocokkan ke data_library_en.swf -- "Magic Emissary Set":
 *     set2424  BODY_SET_BOY    set2425  BODY_SET_GIRL
 *     hair765  gender 0        hair766  gender 1
 *     wpn1502 Magic Emissary Sword, back688 Magic Emissary Wing,
 *     skill914 Kinjutsu: Advanced Black Light, pet157 Mini Bat
 * Senjata, tas, skill, dan pet dipakai bersama kedua jenis kelamin.
 */
const PAKET_MAGIC = {
  0: ['set_2424', 'wpn_1502', 'hair_765', 'back_688', 'skill_914', 'pet_157'],
  1: ['set_2425', 'wpn_1502', 'hair_766', 'back_688', 'skill_914', 'pet_157'],
};

const perGender = tabel => c => tabel[Number(c && c.gender) === 1 ? 1 : 0];

/* Peta servis paket -> isi hadiah.
 *
 * Di peta ada beberapa tombol paket (PackageBtn10, PackageBtn13, ...). Tiap
 * tombol memuat popup_4th_claim_code_pNN.swf yang berbeda, tapi SEMUANYA
 * memakai kelas Anni4_ClaimCode yang sama dan callback ClaimItemResponse yang
 * hanya membaca res.message. Yang berbeda cuma nama servisnya:
 *
 *     p8   -> SpecialReward.claimAugustPackage
 *     p11  -> SpecialReward.claimPatriotPackage
 *     p15  -> SpecialReward.claimMagicPackage
 */
const PAKET_KLAIM = {
  'SpecialReward.claimAugustPackage':  perGender(PAKET_AGUSTUS),
  'SpecialReward.claimPatriotPackage': perGender(PAKET_PATRIOT),
  'SpecialReward.claimMagicPackage':   perGender(PAKET_MAGIC),
};

/* Pemberi hadiah generik untuk semua servis di PAKET_KLAIM. */
function klaimPaket(namaServis) {
  const pilih = PAKET_KLAIM[namaServis];
  const balas = pesan => ({ status: 1, error: null, result: [], data: {}, message: pesan });

  if (!pilih) {
    return balas('Paket ini belum tersedia di server.');
  }

  const aktif = chars.getActiveId();
  const c = (aktif && chars.characterById(aktif)) || chars.firstCharacter();
  if (!c) return balas('Karakter tidak ditemukan.');

  const baru = pilih(c).filter(id => !sudahPunya(c, id));
  if (!baru.length) return balas('Kamu sudah mengambil semua hadiah paket ini.');

  // skill dan pet punya jalurnya sendiri; sisanya lewat addItem.
  for (const id of baru) {
    const sk = String(id).match(/^skill_?(\d+)$/);
    const pt = String(id).match(/^pet_?(\d+)$/);
    if (sk)      chars.addSkill(sk[1]);
    else if (pt) chars.addPet({ id: pt[1] });
    else         chars.addItem(String(id).replace('_', ''), 1);
  }
  log('   paket ' + namaServis + ' diberikan: ' + baru.join(', '));
  return balas('Kamu mendapat ' + baru.join(', ') +
               '. Muat ulang permainan supaya muncul di inventaris.');
}

/* Berikan satu hadiah ke karakter aktif.
 *
 * Hadiah datang dalam bentuk "<jenis>_<nomor>" dan disimpan lewat jalur yang
 * berbeda-beda di chardata.js: skill dan pet punya fungsinya sendiri,
 * sisanya (senjata, baju, rambut, tas, aksesori, dan barang biasa) lewat
 * addItem yang sudah mengenali awalannya.
 */
function beriHadiah(id) {
  const sk = String(id).match(/^skill_?(\d+)$/);
  if (sk) return chars.addSkill(sk[1]);
  const pt = String(id).match(/^pet_?(\d+)$/);
  if (pt) return chars.addPet({ id: pt[1] });
  return chars.addItem(String(id).replace('_', ''), 1);
}

/* Apakah karakter sudah memiliki perlengkapan ini?
 * ClaimRewardArr memakai "hair_757"; kantong di characters.json menyimpan
 * nomornya saja ("757"), jadi garis bawahnya dipisah di sini.
 */
function sudahPunya(c, id) {
  const m = String(id).match(/^(wpn|set|hair|back|acsy)_?(\d+)$/);
  if (m) {
    const bag = { wpn: 'weapons', set: 'bodysets', hair: 'hairs',
                  back: 'backitems', acsy: 'accessories' }[m[1]];
    return Array.isArray(c[bag]) && c[bag].includes(m[2]);
  }
  const sk = String(id).match(/^skill_?(\d+)$/);
  if (sk) return Array.isArray(c.skills) && c.skills.map(String).includes(sk[1]);
  const pt = String(id).match(/^pet_?(\d+)$/);
  if (pt) return Array.isArray(c.pets) &&
                 c.pets.some(x => String(x && x.id != null ? x.id : x) === pt[1]);
  return false;
}

/* Kode klaim manual (panel dua kotak). Kunci = isi kotak pertama + "-" +
 * kotak kedua, huruf besar semua. Isinya mengikuti paket Agustus, urutan
 * indeksnya sama dengan PAKET_AGUSTUS di atas:
 *     0 set   1 wpn   2 hair   3 back   4 skill   5 pet
 */
const agustus = perGender(PAKET_AGUSTUS);
const KODE_ANNI4 = {
  'ANNI4-SET':   c => [agustus(c)[0]],
  'ANNI4-WPN':   c => [agustus(c)[1]],
  'ANNI4-HAIR':  c => [agustus(c)[2]],
  'ANNI4-BACK':  c => [agustus(c)[3]],
  'ANNI4-SKILL': c => [agustus(c)[4]],
  'ANNI4-PET':   c => [agustus(c)[5]],
  'ANNI4-ALL':   agustus,
};

/* ====================================================================
 * DAFTAR MUSUH: Eudemon Garden dan Hunting House
 *
 * Pakai kolom "kunci" dari database/enemy.csv (enemy1 ... enemy346).
 * Hanya 209 di antaranya berstat lengkap (kolom stat_lengkap = ya);
 * yang tidak lengkap tetap tampil tapi bisa aneh saat bertarung.
 * ==================================================================== */

/* Eudemon Garden — satu entri = satu "room" di panel.
 *
 *   boss     larik id musuh, MAKSIMAL 2 (panel cuma punya previewMc0 & 1)
 *   rank     nomor frame lencana rankMc; 1 = paling rendah
 *   rewards  larik id barang yang ditampilkan sebagai kemungkinan hadiah
 *   time     sisa pertarungan hari ini; 0 membuat tombol serang mati
 *   xp/gold  angka yang dipamerkan di panel
 *
 * Panel menampilkan 5 room per halaman dan menghitung halaman sendiri,
 * jadi jumlah entri boleh berapa pun.
 */
const EUDEMON_ROOM = [
  { boss: ['enemy338'],            rank: 1, time: 3, xp: 550,  gold: 400,
    rewards: ['wpn_1498', 'set_2248'] },
  { boss: ['enemy339', 'enemy340'], rank: 2, time: 3, xp: 900,  gold: 700,
    rewards: ['wpn_1343', 'back_557'] },
];

/* Hunting House — dikelompokkan per zona di peta dunia panel.
 *
 *   zone0   diperlakukan khusus: hanya elemen pertama tiap sub-larik
 *           yang dipakai, dan masuk daftar SpecialBoss
 *   zoneN   larik id musuh biasa; N menentukan movieclip EasyBoss<N>
 *           mana yang ditampilkan di peta
 *
 * Kosongkan zona yang tidak dipakai dengan larik kosong.
 */
const HUNTING_ZONE = {
  zone0: [],
  zone1: ['enemy338', 'enemy339'],
  zone2: ['enemy340', 'enemy341'],
};

/* Balasan baku untuk semua servis akhir-pertarungan.
 *
 * Battle memakai TIGA callback berbeda tergantung jalurnya:
 *     Battle.callBattleFinishHAV -> getBossRewardResponse02  (paling rewel)
 *     Battle.actionFinish_CB     -> getBossRewardResponse04
 *     jalur bos lain             -> getBossRewardResponse03
 *
 * Servis yang bisa mendarat di salah satunya: ItemDAO.getBossReward,
 * EudemonGarden.finishHunting, ValentinesDay2017.finishHunting, dan
 * CharacterDAO.finishHunting. Karena satu servis bisa dipanggil dari jalur
 * berbeda, SEMUANYA memakai bentuk balasan yang sama di bawah ini.
 *
 * Syarat dari Response02 (yang paling ketat):
 *
 *   reward, reward_get   WAJIB larik. @329/@342 di-coerce Array lalu @878
 *                        dibaca .length. Field yang tak dikirim jadi
 *                        undefined -> coerce Array -> null -> #1009.
 *
 *   result               null ATAU objek. @356 hanya menjaga terhadap null,
 *                        lalu langsung membaca result.add_favorability.
 *                        Mengirim angka (mis. result: 1) menghasilkan
 *                        "#1069 Property add_favorability not found on Number"
 *                        karena Number kelas tertutup, tak punya properti
 *                        dinamis. Jadi null adalah pilihan paling aman.
 *
 *   extra_reward,        diuji dengan Boolean(). Larik kosong bernilai TRUE
 *   extra_reward_get,    di AS3, jadi dikirim null supaya blok hadiah
 *   pet                  tambahan dilewati bersih.
 *
 *   z9f, message         dijaga terhadap null; ikut dikirim agar Response03
 *                        dan Response04 juga aman.
 */
/* Isi hadiah yang muncul di jendela akhir pertarungan.
 *
 * Tiap entri adalah STRING berbentuk "<jenis>_<nilai>", dipecah klien dengan
 * "_" di Main.itemPrototype / Battle.itemPrototype. Cabangnya diuji dengan
 * indexOf di getBossRewardResponse02 @433-857, dengan URUTAN yang penting:
 *
 *     petxp_N   -> bossRewardPetXp = N          (diperiksa PALING AWAL,
 *                                                karena "petxp" mengandung
 *                                                "xp" dan akan tertangkap
 *                                                cabang xp kalau dibalik)
 *     xp_N      -> bossRewardXp, lalu updateXP + showLevelUp
 *     gold_N    -> bossRewardGold, lalu updateGold
 *     item_N    -> masuk daftar barang
 *     wpn_N / set_N / hair_N / back_N / skill_N / pet_N
 *               -> ditampilkan sebagai barang yang didapat
 *
 * Yang berupa perlengkapan juga DISIMPAN ke characters.json oleh handler di
 * bawah, supaya tidak hilang saat muat ulang — klien hanya menampilkannya,
 * tidak menyimpannya sendiri.
 *
 * Kosongkan lariknya kalau tidak mau ada hadiah sama sekali.
 */
const HADIAH_BOS = [
  'xp_1000',
  'gold_500',
];

/* Barang yang ditampilkan sebagai ikon di jendela akhir pertarungan.
 *
 * Rantai lengkapnya (MissionResult di swf/panels/mission_complete.swf):
 *
 *   MissionResult.init(isComplete, tampilkan, missionData, effectData,
 *                      rewardList, rewardGetList, callBack)
 *       @43  rewardList    <- parameter ke-5  = slot3 = field `reward`
 *       @37  rewardGetList <- parameter ke-6  = slot4 = field `reward_get`
 *
 *   MissionResult.rewardDisplay @45-100
 *       mengulang rewardList, lalu rewardIcon(rewardList[i], rewardIcon_<i>)
 *       -> INILAH yang menggambar ikon. Hanya `reward` yang tampil.
 *
 *   MissionResult.rewardIcon @138-149
 *       rewardGetList.indexOf(id)  -> menandai barang mana yang BENAR-BENAR
 *       didapat; rewardList sendiri hanya daftar kemungkinan hadiah.
 *
 * Jadi peran keduanya berbeda, dan kemarin saya menyimpulkannya terbalik:
 *     `reward`      = apa yang DITAMPILKAN
 *     `reward_get`  = mana yang DIDAPAT (penanda saja, tidak menggambar apa pun)
 *
 * Karena itu barang harus masuk ke DUA-DUANYA. Entri xp_/gold_ tidak perlu:
 * angkanya sudah digambar terpisah dari missionData, dan cabangnya di
 * Response02 @525-617 tidak pernah mendorongnya ke rewardList.
 *
 * Batas: panel hanya punya rewardIcon_0 sampai rewardIcon_9, jadi maksimal
 * 10 barang. Lebih dari itu, skin-nya undefined dan panelnya melempar error.
 */
const HADIAH_MATERIAL = [
  'item_600',    // Wolf's Bone
  'item_604',    // Beast's Bone
];

/* Semua hadiah, dan hanya bagian barangnya. */
const semuaHadiah  = () => HADIAH_BOS.concat(HADIAH_MATERIAL);
const barangHadiah = () => semuaHadiah().filter(h => !/^(xp|gold|petxp)_/.test(h));

function balasanHadiah(tambahan) {
  return Object.assign({
    status: 1,
    error: null,
    result: null,          // JANGAN angka
    reward: semuaHadiah(),                 // WAJIB larik -- yang DITAMPILKAN
    reward_get: barangHadiah(),            // WAJIB larik -- penanda DIDAPAT
    reward_items: [],
    player_pet: [],
    extra_reward: null,
    extra_reward_get: null,
    pet: null,
    gold: 0,
    xp: 0,
    dmg: 0,
    double_reward: false,
    message: '',
    z9f: null,
  }, tambahan || {});
}

const handlers = {

  'SystemService.requireLogin': () => ({ status: 1, error: null }),

  // args: [uid, snsType, build, "", tokenSha1, null, null, lang]
  'SystemService.snsLogin': (args) => {
    const lang = (args && args[7]) || 'en';
    return {
      status: 1,
      error: null,
      result: [ACCOUNT.id, ACCOUNT.type, ACCOUNT.balance, ACCOUNT.sessionKey],
      signature: signAccount(ACCOUNT),
      country_area: 'ID',
      isNewAccount: IS_NEW_ACCOUNT,
      promote_id: 0,
      isTrialEmblem: 0,
      isExpired: 0,
      account_lock: null,

      // Status security password akun. NinjaSaga.onAmfLoginResult @705-708:
      //     Main.accRegActiveStatus = res.account_registered_password;
      //     Main.accRegTutStatus    = res.account_registered_tutored;
      // Konstanta di ninjasaga::Main:
      //     ACC_REG_ACTIVE_STATUS_NOT_REGISTERED = 0
      //     ACC_REG_ACTIVE_STATUS_ACTIVE         = 1
      //     ACC_REG_TUT_STATUS_NONE = 0, ACC_REG_TUT_STATUS_READ = 1
      //
      // ClanPanel.confirmDonateTokenPromptSecurity @7-18 membandingkannya:
      //     if (accRegActiveStatus == ACC_REG_ACTIVE_STATUS_ACTIVE)
      //         showSecurityPasswordConfirmation(..., confirmDonateToken, ...)
      //     else
      //         showSecurityPasswordSignupInvitation(...)   <-- notice signup
      //
      // Selama nilainya 0, donasi TOKEN tidak pernah sampai ke
      // ClanManagement.donateToken -- klien berhenti di tawaran pendaftaran.
      // Donasi GOLD tidak lewat jalur ini, makanya gold sudah bisa.
      account_registered_password: 1,   // 1 = ACTIVE
      account_registered_tutored:  1,   // 1 = READ, lewati tutorialnya

      swf_versions: SWF_VERSIONS,
      lang,
      serverTime: Math.floor(Date.now() / 1000),
    };
  },

  'ReportService.reportAmfError2': () => ({ status: 1, error: null }),

  // --- Karakter -----------------------------------------------

  // args: [sessionKey, nama, gender, elemen, warnaKulit, rambut, wajah]
  'CharacterDAO.createCharacter': (args) => {
    const c = chars.createCharacter(args);
    log('   karakter dibuat: ' + c.name + ' (id ' + c.character_id + ')');
    return {
      status: 1, error: null,
      result: chars.databaseCharacter(c),
      character_id: c.character_id,
    };
  },

  // PENTING: klien membaca tiap entri sebagai ARRAY BERINDEKS ANGKA,
  // bukan objek. Dari SelectCharMenu.setupSelectMenu:
  //
  //   charactersList[i][0]  -> character_id
  //   charactersList[i][1]  -> charName.text
  //   charactersList[i][2]  -> charLevel.text
  //   charactersList[i][3]  -> gender (0 = pria, selain itu wanita)
  //
  // Mengirim objek dengan nama field lengkap membuat slot tampil kosong
  // (tulisan "text" bawaan TextField tidak pernah tergantikan).
  'CharacterDAO.getCharactersList': () => {
    const list = chars.listCharacters();
    log('   jumlah karakter: ' + list.length +
        (list.length ? '  ->  ' + list.map(c => c.name + ' lv' + c.level).join(', ') : ''));
    return {
      status: 1,
      error: null,
      result: list.map(c => [
        c.character_id,
        c.name,
        String(c.level),
        Number(c.gender) || 0,
      ]),
    };
  },

  // Dipanggil saat pemain mengklik slot karakter.
  // Responsnya diproses DataParser.parseRawCharacter, yang memakai
  // format MENTAH (baris database) — bukan format databaseCharacter().
  // Lihat rawCharacter() di chardata.js.
  'CharacterDAO.getCharacterById': (args) => {
    // args[1] = id karakter yang dipilih pemain di layar Select Character.
    // Ini WAJIB dipakai: sebelumnya server selalu mengembalikan karakter
    // pertama, sehingga setelah membuat karakter kedua semua progres
    // (xp, gold, misi) tetap tertulis ke karakter lama dan karakter yang
    // sedang dimainkan seolah tidak pernah tersimpan.
    const idDiminta = args && args[1];
    const dipakai = chars.setActiveCharacter(idDiminta);
    const c = dipakai ? chars.characterById(dipakai) : chars.firstCharacter();
    if (!c) return { status: 1, error: null, result: null };
    if (!dipakai && idDiminta != null) {
      log('   !! id karakter ' + idDiminta + ' tidak ada, memakai karakter pertama');
    }
    log('   karakter dipilih: ' + c.name + ' lv' + c.level +
        ' (id=' + (chars.getActiveId() || '?') + ')');
    return { status: 1, error: null, result: chars.rawCharacter(c, args && args[0]) };
  },

  // Pemilihan kelas Special Jounin. args: [sessionKey, nomorKelas]
  //
  // ExamPanel.onAmfSPClassResult() hanya butuh status=1; setelah itu klien
  // sendiri yang menulis kelasnya ke DBCharacterData.CONTROL, memberi skill
  // kelas dari CLASS_SKILL_ARR[spClass-1], plus set1090/set1091 dan skill345.
  // Tapi semua itu hanya di memori — server WAJIB menyimpannya dan
  // mengirimkannya balik lewat character_control (lihat rawCharacter),
  // kalau tidak kelasnya hilang setiap relogin.
  'CharacterDAO.SJClassSelect': (args) => {
    const kelas = args && args[1];
    const hasil = chars.simpanKelasSJ(kelas);
    if (hasil) {
      log('   kelas Special Jounin dipilih: ' + hasil.kelas +
          (hasil.berubah ? ' (sebelumnya ' + hasil.lama + ')' : ' (tidak berubah)'));
    } else {
      log('   !! nomor kelas tidak dikenali: ' + kelas);
    }
    return { status: 1, error: null };
  },

  // Pembelian pet dari Pet Centre.
  // Argumen (dari PetShop.amfBuyItem @73):
  //     [sessionKey, petId, namaPet, bahasa]     mis. ["...", "2", "Chiko", "en"]
  //
  // PetShop.onAmfBuyItemResult TIDAK lewat Main.validateAmfResponse -- yang
  // dibaca cuma response.result, dan hanya kalau result.equipped bernilai
  // true. Lihat komentar di chardata.petBuyResult() untuk rinciannya.
  //
  // Klien selalu MENGAKTIFKAN pet yang baru dibeli (deactivatePet lalu
  // initPet), jadi server mencatat hal yang sama supaya keduanya sepakat
  // setelah muat ulang.
  'CharacterDAO.buyPet': (args) => {
    const id   = String((args && args[1]) != null ? args[1] : '');
    const nama = String((args && args[2]) != null ? args[2] : '');
    if (!id) {
      log('   !! buyPet tanpa id: ' + JSON.stringify(args));
      return { status: 1, error: null, result: null };
    }

    // swfName/clsName dari PET_DATA (petdata.js) -- sumber yang sama dengan
    // yang dipakai klien, jadi grafis dan hash-nya pasti cocok.
    const a = chars.petAsset(id);
    const bisa = chars.petBisaBertarung(id);
    const pet = chars.addPet({
      id, name: nama || a.name, level: 1, xp: 0,
      equipped: true,                 // pet baru selalu jadi pet aktif
    });
    if (!bisa) {
      log('   !! PET_DATA tidak punya blok skill untuk pet ' + id + ' -- pet ini ' +
          'TIDAK BISA bertarung (giliran pet akan membekukan pertarungan). ' +
          'Disimpan sebagai cadangan saja.');
    }

    const bayar = chars.bayarPet(id);
    // equipped hanya true kalau pet-nya memang bisa bertarung; kalau tidak,
    // klien melewati blok initPet dan pet cukup muncul setelah muat ulang.
    const hasil = chars.petBuyResult(pet, ACCOUNT.sessionKey);
    hasil.equipped = !!pet.equipped;

    log('   pet dibeli: id=' + id + ' "' + pet.name + '" swf=' + a.swfName +
        ' cls=' + a.clsName + ' (dipasang sebagai pet aktif)' +
        '  total=' + chars.listPets().length);
    if (bayar) {
      log('   harga: ' + bayar.gold + ' gold + ' + bayar.token + ' token  ->  ' +
          'sisa ' + bayar.sisaGold + ' gold, ' + bayar.sisaToken + ' token');
    }
    log('   hash pet: ' + [hasil.id, hasil.swfName, hasil.clsName,
                           hasil.level, hasil.xp].join(',') + '  -> ' + hasil.hash);

    return { status: 1, error: null, result: hasil };
  },

  // Status misi latihan Sennin, dipanggil MissionPanel_2.getSagaMissionStatus
  // setiap kali panel misi dibuka. args: [sessionKey]
  //
  // Balasan generik {result: []} membuat sageMissionResponse melempar #1010
  // SEBELUM hideAmfLoading(), sehingga layar loading tidak pernah ditutup dan
  // panel misi tampak blank. result WAJIB objek dengan status + array mission
  // -- lihat komentar di chardata.statusMisiSennin().
  'SSTraining.getMissionStatus': () => {
    const aktif = chars.getActiveId();
    const c = (aktif && chars.characterById(aktif)) || chars.firstCharacter();
    const hasil = chars.statusMisiSennin(c || {});
    log('   misi Sennin: status=' + hasil.status +
        (hasil.status === 0 ? ' (terbuka)' : ' (terkunci, rank <= 7)') +
        '  misi=' + hasil.mission.map(m => m.id).join(','));
    return { status: 1, error: null, result: hasil };
  },

  // Mengaktifkan pet dari panel Pets. args: [sessionKey, petId]
  // Klien sudah menukar pet aktifnya sendiri; ini yang membuat pilihannya
  // bertahan setelah muat ulang.
  'CharacterDAO.activatePet': (args) => {
    const id = (args && args[1]) != null ? String(args[1]) : null;
    const hasil = chars.setPetEquipped(id);
    if (hasil && hasil.ditolak) {
      log('   !! aktivasi pet ' + id + ' ditolak: tidak ada data skill di PET_DATA');
      return { status: 0, error: 'pet has no skill data' };
    }
    if (hasil && hasil.ketemu) log('   pet aktif -> id=' + hasil.id);
    else log('   pet dilepas (tidak ada yang aktif), id diminta=' + id);
    return { status: 1, error: null, result: 0 };
  },

  // Menonaktifkan pet aktif. args: [sessionKey]
  'CharacterDAO.deactivatePet': () => {
    chars.setPetEquipped(null);
    log('   semua pet dinonaktifkan');
    return { status: 1, error: null, result: 0 };
  },

  // Melatih skill pet dari panel Pets.
  // args: [sessionKey, petId, indeksSkill, mataUang]   mis. ["...", 13, 0, "token"]
  //
  // MapMenu.trainPetSkillResult meneruskan response.result ke
  // Pet.setupAvailableSkills -> PetBase.setupAvailableSkills, yang di @97-102
  // membaca `skills.length`. Kalau result bukan Array, koersi `as Array`
  // menghasilkan null -> #1009 dan panel membeku. Jadi result WAJIB berupa
  // ARRAY indeks skill, bukan angka.
  'CharacterDAO.trainPetSkill': (args) => {
    const petId = (args && args[1]) != null ? String(args[1]) : '';
    const index = (args && args[2]) != null ? Number(args[2]) : 0;
    const mata  = (args && args[3]) != null ? String(args[3]) : 'gold';

    const hasil = chars.latihSkillPet(petId, index, mata);
    if (!hasil) {
      log('   !! trainPetSkill: pet ' + petId + ' tidak ada di koleksi');
      // Tetap kirim ARRAY supaya klien tidak melempar #1009.
      return { status: 1, error: null, result: [] };
    }
    if (hasil.ditolak) {
      log('   !! trainPetSkill ditolak: ' + hasil.ditolak);
      return { status: 1, error: null, result: hasil.skills };
    }

    log('   latih skill pet ' + petId + ' indeks ' + index +
        ' (butuh level ' + hasil.levelMin + ', bayar ' +
        hasil.biaya.gold + ' gold + ' + hasil.biaya.token + ' token)' +
        '  ->  skills=[' + hasil.skills.join(',') + ']' +
        '  sisa ' + hasil.sisaGold + ' gold, ' + hasil.sisaToken + ' token');

    return { status: 1, error: null, result: hasil.skills };
  },

  // Status klan, dipanggil MapMenu sebelum memuat clan_panel.swf.
  // args: [sessionKey]. Balasan generik tidak memicu error, tapi handler ini
  // membuat tombol Clan menampilkan keadaan yang benar.
  // Graduasi Sennin / Lv80 exam. args: [sessionKey]
  //
  // Dipanggil SenninExamPanel.amfClaimReward(). Callback-nya
  // confirmClaimReward() membaca satu field:
  //
  //     rewardStatus = int(response.character_reward);
  //     ... rewardList[rewardStatus - 1].length ...     <- #1010 kalau 0
  //
  // Jadi character_reward WAJIB 1, 2, atau 3 -- JANGAN 0/null/undefined.
  // Kalau memang mau menolak klaim, balas status 0 + error terisi; klien
  // berhenti di validateAmfResponse sebelum menyentuh rewardList.
  //
  // Tier ditentukan dari riwayat misi: EXAM_SENNIN (hard) -> 3 (rank 9),
  // EXAM_SENNIN_EASY -> 2 (rank 8), selain itu 1.
  'CharacterDAO.NTClassSelect': () => {
    const hasil = chars.graduasiSennin();
    if (hasil) {
      log('   graduasi Sennin: tier=' + hasil.tier +
          ' rank=' + hasil.rankLama + '->' + hasil.rank +
          ' gender=' + hasil.gender +
          ' barang=' + hasil.barang.join(','));
      return { status: 1, error: null, character_reward: hasil.tier };
    }
    // Karakter tidak ketemu: tetap kirim tier valid supaya panel tidak crash.
    log('   !! graduasi Sennin: karakter aktif tidak ditemukan, kirim tier 1');
    return { status: 1, error: null, character_reward: 1 };
  },

  // Notice ujian Special Jounin sudah dilihat. args: [sessionKey]
  //
  // Dikirim Main.SJENoticeOk saat tombol OK di popup ditekan.
  // Main.onSJENoticeResult @19-26 hanya menaikkan Central.main.sje_notice di
  // MEMORI, jadi tanpa handler ini notice-nya kembali setiap kali halaman
  // dimuat ulang -- Main.updateMapSideBtn membacanya dari
  // sje_end_date_notice yang dikirim server.
  'CharacterDAO.watchSJENotice': () => {
    const hasil = chars.tandaiSJENotice();
    if (hasil) {
      log(hasil.sudah
        ? '   notice SJE: sudah ditandai sebelumnya'
        : '   notice SJE ditandai sudah dilihat -- tidak muncul lagi setelah reload');
    }
    return { status: 1, error: null, result: 0 };
  },

  // Status klan, dipanggil MapBase.onClickClan sebelum panel dibuka.
  // args: [sessionKey]
  //
  // MapBase.getClanStatus (map_1.swf, method 283):
  //
  //     Central.main.hideAmfLoading();
  //     Central.main.ClanStatus = res.clan_status;        // @17  TINGKAT ATAS
  //     if (res.result.account_locked) {                  // @24-30
  //         Central.main.showOk(res.result.lock_message, new Function());
  //         return;                                       // panel TIDAK dibuka
  //     }
  //     this.onShowClan();                                // @57 -> panel.show("clan_panel")
  //
  // Dua hal yang gampang salah:
  //  1. `clan_status` dibaca di TINGKAT ATAS response, bukan di dalam result.
  //  2. `result` harus OBJEK. Kalau berupa angka, res.result.account_locked
  //     melempar #1069 (Number kelas tertutup, tidak punya properti itu).
  //     Pada Object dinamis, properti tak dikenal cuma jadi undefined.
  //
  // account_locked falsy -> onShowClan() dipanggil dan clan_panel dibuka.
  'ClanService.getClanStatus': () => {
    const punya = !!chars.klanAktif();
    log('   status klan: akun tidak dikunci, panel dibuka' +
        (punya ? ' (sudah punya klan)' : ' (belum punya klan)'));
    return {
      status: 1,
      error: null,
      clan_status: punya ? 1 : 0,
      result: {
        account_locked: 0,     // truthy = akun dikunci, panel tidak dibuka
        lock_message: '',
      },
    };
  },

  // Data klan untuk ClanPanel. args: [sessionKey]
  //
  // ClanPanel.getClanResponse (clan_panel.swf, method 1153):
  //
  //     if (!validateAmfResponse(res)) return;
  //     if (res.getclan_key != null) clanGetKey = String(res.getclan_key);
  //     Server_Time = res.server_time;
  //     st = int(res.result as int);                       // @64-72
  //     clanDate = res.clan_lang[ lang == ZH ? 0 : 1 ];    // @87-114  <-- #1010
  //     switch (st) {
  //       case 0: gotoAndPlay(NO_CLAN_TL); break;          // belum punya klan
  //       case 1:
  //       case 3: Clan.clanData    = res.clan_data;
  //               Clan.buildingData = res.building_data;
  //               gotoBase(); break;
  //       case 2: showOk(res.message, hide); break;
  //     }
  //     remainingTime = res.remaining_time;
  //     bonusBoardReputationArr = [res.today_reputation,
  //                                res.target_reputation,
  //                                res.extra_reputation];
  //     showBonusBoard = res.daily_reputation_show;
  //
  // `clan_lang` dibaca DI LUAR switch, jadi WAJIB ada berapa pun nilai result,
  // dan harus array dengan minimal 2 elemen (indeks 0 untuk bahasa ZH, 1 untuk
  // selainnya). Tanpa itu res.clan_lang[1] -> #1010, callback berhenti sebelum
  // gotoAndPlay, dan panel tidak pernah digambar -- itulah layar putihnya.
  //
  // result 0 = belum punya klan; panel membuka layar buat/cari klan.
  'ClanService.getClan': () => {
    const now = Math.floor(Date.now() / 1000);
    const clan = chars.klanAktif();

    // result: 0 = belum punya klan (panel ke layar buat/cari),
    //         1 = punya klan (panel ke gotoBase -> updateClanStatus),
    //         2 = tampilkan pesan.
    // clan_data WAJIB objek berisi field ClanData saat result 1 --
    // updateClanStatus membacanya tanpa penjagaan null.
    const dasar = {
      status: 1,
      error: null,
      getclan_key: null,
      server_time: now,
      clan_lang: ['', ''],          // [ZH, selain ZH] -> lbl_date
      remaining_time: 0,
      today_reputation: 0,
      target_reputation: 0,
      extra_reputation: 0,
      daily_reputation_show: false,
      stamina_item: 0,
      group_id: null,
      message: '',
    };

    if (!clan) {
      log('   data klan: result=0 (belum punya klan)');
      return Object.assign(dasar, { result: 0, clan_data: {}, building_data: [] });
    }
    log('   data klan: result=1 "' + clan.name + '" anggota ' +
        clan.member_number + '/' + clan.member_slots);
    // building_data null aman -- Clan.getAttackerBonus mengembalikan 0.
    // getClanResponse @164-171: Clan.buildingData = res.building_data as Array.
    // Entri {id, level} dipakai Clan.getBuildingBonus (code_library method
    // 1229) untuk menghitung bonus stamina/HP/CP/damage.
    const bangunan = chars.daftarBangunan();
    if (bangunan.length) {
      log('   bangunan klan: ' +
          bangunan.map(b => chars.BUILDING_DATA[b.id].name + ' Lv' + b.level).join(', '));
    }
    return Object.assign(dasar, { result: 1, clan_data: clan, building_data: bangunan });
  },

  // Sinkronisasi sisa waktu musim klan. args: [sessionKey]
  //
  // ClanPanel.updateSeasonTimer (method 1339) @98-128 mengurangi intervalTime
  // 15 tiap tick; begitu <= 0 ia memanggil syncRemainingTime (method 1342),
  // yang memanggil AMF ini. Callback-nya syncRemainingTimeResponse (1343)
  // @26-54 hanya membaca satu field:
  //     remainingTime = res.remaining_time;
  //     lastSyncTime  = new Date().time / 1000;
  // Tidak ada koersi berbahaya, jadi balasan generik pun tidak crash --
  // handler ini ada supaya nilainya konsisten dengan getClan dan log tidak
  // penuh "handler BELUM ADA".
  'ClanService.getRemainingTime': () => {
    return { status: 1, error: null, remaining_time: 0 };
  },

  // Penyerahan hasil misi latihan Sennin (grade S / SS training).
  // args: [sessionKey, idMisi, itemDipakai, gagal(0|1), hash]
  //        mis. [..., "msn280", [], 0, ...]
  //
  // Mission.completeMission @3306 memasang callback ANONIM (code_library
  // method 844) sebagai penerima balasan:
  //
  //      0: getlocal1                     res
  //      1: getproperty update_inventory  <-- TANPA penjagaan
  //      4: pushfalse
  //      5: setproperty showPopup         <-- #1010 kalau update_inventory tidak ada
  //     15: validateAmfResponse(res)
  //     36: getproperty SENJUTSU_SS
  //     64: pushbyte 30
  //     67: updateData(SENJUTSU_SS, int(...) + 30)
  //
  // Beda dengan Mission.getSGradeResponse yang @6 punya
  // `if (res.update_inventory)`, di sini baris PERTAMA langsung menulis ke
  // properti objek yang tidak ada. Jadi update_inventory wajib berupa objek;
  // isinya boleh apa saja, klien menyetel showPopup sendiri.
  //
  // args[3]: 0 dari completeMission, 1 dari failMission.
  'SSTraining.finishSSMission': (args) => {
    const idMisi = (args && args[1]) ? String(args[1]) : '';
    const gagal  = Number(args && args[3]) === 1;

    if (idMisi && !gagal) {
      const m = chars.recordMission(idMisi);
      if (m) {
        log('   misi Sennin selesai: msn' + m.no +
            '  (total misi tercatat: ' + m.total + ')');
      } else {
        log('   !! id misi Sennin tidak dikenali: ' + idMisi);
      }
    } else if (gagal) {
      log('   misi Sennin GAGAL: ' + idMisi);
    }

    // Klien menambah 30 poin SENJUTSU_SS hanya di memori; simpan juga di sini
    // supaya tidak hilang saat muat ulang.
    if (!gagal) {
      const p = chars.tambahSenjutsuSS(30);
      if (p) log('   poin latihan Sennin: ' + p.lama + ' -> ' + p.baru);
    }

    const c = chars.characterById(chars.getActiveId());
    return {
      status: 1,
      error: null,
      result: 0,
      update_inventory: {
        showPopup: false,
        xp:    c ? c.xp    : 0,
        gold:  c ? c.gold  : 0,
        token: c ? (c.token || 0) : 0,
      },
    };
  },

  // --- Senjutsu / Sage Mode (SenjutsuService) --------------------

  // Mempelajari sistem senjutsu di Sage Shop.
  // args (SagaShop2015.onClickLearn @95-106):
  //     [sessionKey, skillID, sequence, hash(sessionKey + skillID)]
  //
  // SagaShop2015.amfClientLearnSageModeResponse (method 666):
  //      8: if (!validateAmfResponse(res)) return;
  //     22: Central.main.senjutsuSystem = res.senjutsu_system_id;   <-- WAJIB
  //     50: setGold(getGold() - 2000000);   klien memotong 2 juta gold sendiri
  //     65: if (senjutsuSystem == 2) isToad = true; else isSnake = true;
  //    125: panel.show("Panel_2015_Sage_Profile");
  //
  // Tanpa senjutsu_system_id, senjutsuSystem jadi undefined: pilihan Toad
  // selalu jatuh ke cabang Snake dan tidak ada yang tersimpan.
  'SenjutsuService.discoverSenjutsu': (args) => {
    const skillID = (args && args[1] != null) ? String(args[1]) : '';
    const h = chars.pelajariSenjutsu(skillID);

    if (!h || h.gagal) {
      log('   !! pelajari senjutsu ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      // Tetap kirim senjutsu_system_id yang tersimpan (kalau ada) supaya
      // tampilan panel tidak jadi undefined.
      return {
        status: 1, error: null,
        senjutsu_system_id: (h && h.sistem) || 0,
      };
    }

    log('   senjutsu dipelajari: skillID=' + h.skillId +
        ' sistem=' + h.sistem + ' (' + (h.sistem === 2 ? 'Toad' : 'Snake') + ')' +
        '  biaya ' + h.biaya + ' gold, sisa ' + h.sisaGold);

    return {
      status: 1,
      error: null,
      senjutsu_system_id: h.sistem,
    };
  },

  // Konversi token menjadi poin Senjutsu (SS).
  // args (SagaProfile2015.buyConfirm @119-129):
  //     [sessionKey, jumlahToken, sequence, hash(sessionKey+accountId+charId+jumlah)]
  //     mis. [..., "400", ...] -> paket keempat, 400 token = 250 SS
  //
  // convertResponse (method 750) @31-34:
  //     updateData(SENJUTSU_SS, res.final_sen_spirit)
  // lalu @55 loadPanelContent() memasang nilai itu ke TextField. Kalau
  // final_sen_spirit tidak ada, SENJUTSU_SS jadi undefined dan
  // TextField.text menolaknya -> #2007 Parameter text must be non-null.
  //
  // Klien memotong tokennya sendiri di @42 (balance - currBtnNum), jadi
  // server memotong jumlah yang sama supaya keduanya tetap sepakat.
  'SenjutsuService.convertSS': (args) => {
    const jumlah = (args && args[1] != null) ? args[1] : 0;
    const h = chars.konversiSS(jumlah);
    if (!h || h.gagal) {
      log('   !! konversi SS ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      // Tetap kirim angka supaya TextField tidak menerima null.
      const c = chars.characterById(chars.getActiveId());
      return { status: 1, error: null,
               final_sen_spirit: Number(c && c.senjutsuSS) || 0 };
    }
    log('   konversi SS: ' + h.bayar + ' token -> +' + h.dapat + ' SS' +
        '  (total ' + h.totalSS + ' SS, sisa ' + h.sisaToken + ' token)');
    return { status: 1, error: null, final_sen_spirit: h.totalSS };
  },

  // Naikkan level skill senjutsu.
  // args (onClickUpGrade @152-162): [sessionKey, skillId, sequence, hash]
  //
  // upgradeResponse (method 747) tidak membaca satu pun field dari balasan --
  // level baru dan pengurangan SS dihitung klien sendiri (@99-140). Handler
  // ini hanya menyimpan hasilnya supaya bertahan setelah muat ulang.
  'SenjutsuService.skillUpdate': (args) => {
    const skillId = (args && args[1] != null) ? String(args[1]) : '';
    const h = chars.naikkanSkillSenjutsu(skillId);
    if (!h || h.gagal) {
      log('   !! upgrade skill senjutsu ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      return { status: 1, error: null, result: 0 };
    }
    log('   skill senjutsu ' + h.skillId + ' -> Lv' + h.level);
    return { status: 1, error: null, result: 0 };
  },

  // --- Bloodline / Talent (BloodlineService) ---------------------

  // Membuka satu bloodline di Bloodline Shop.
  // args (BloodlineShop.ConfirmDiscover @114-123):
  //     [sessionKey, bloodlineId, sequence, hash(sessionKey + bloodlineId)]
  //
  // BloodlineShop.BloodlineDiscoverResponse (method 649) tidak membaca satu
  // pun field balasan: @59 hanya validateAmfResponse, lalu harga dipotong dari
  // selectObj di klien (@215-245 token, @495-548 gold) dan saveTP(20) @800.
  // Kalau validate gagal, @1186 menampilkan "TEST cannot discover".
  'BloodlineService.discoverBloodline': (args) => {
    const id = (args && args[1] != null) ? String(args[1]) : '';
    const h = chars.bukaBloodline(id);
    if (!h || h.gagal) {
      log('   !! buka bloodline ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      // status 1 tetap, supaya klien tidak menampilkan "cannot discover"
      // hanya karena bloodline itu sudah dimiliki.
      return { status: 1, error: null, result: 0 };
    }
    log('   bloodline dibuka: id=' + h.bloodlineId + ' (total ' + h.total + ')');
    return { status: 1, error: null, result: 0 };
  },

  // Konversi token menjadi poin bloodline (BP).
  // args (BloodlineProfile.ConfirmConvert):
  //     [sessionKey, idxPaket, idxPaket, jumlahToken, sequence, hash]
  //     mis. [..., "1", "1", "400", ...]
  //
  // convertResponse (method 720) tidak membaca field balasan -- @55-86
  // menambah BLOODLINE sebanyak BPPackage dan @90-108 mengurangi
  // Account.balance sebanyak tokenPackage, keduanya nilai klien. Server
  // memakai tabel yang sama supaya keduanya sepakat setelah muat ulang.
  'BloodlineService.convertBP': (args) => {
    const jumlah = (args && args[3] != null) ? args[3] : 0;
    const h = chars.konversiBP(jumlah);
    if (!h || h.gagal) {
      log('   !! konversi BP ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      return { status: 1, error: null, result: 0, remain_bp: chars.bloodlinePoin() };
    }
    log('   konversi BP: ' + h.bayar + ' token -> +' + h.dapat + ' BP' +
        '  (total ' + h.totalBP + ' BP, sisa ' + h.sisaToken + ' token)');
    return { status: 1, error: null, result: 0, remain_bp: h.totalBP };
  },

  // Naikkan level skill bloodline.
  // args (BloodlineProfile.ConfirmUpgrade):
  //     [sessionKey, tipe, levelBaru, skillId, biayaBP, sequence, hash]
  //     mis. [..., "1", "10", "1041", "2", ...]
  //
  // upgradeResponse (method 723) @544-572:
  //     updateData(BLOODLINE, int(res.remain_bp));
  // SATU-SATUNYA field yang dibaca. Tanpa itu int(undefined) = 0 dan poin
  // bloodline pemain jadi nol setiap kali menaikkan skill.
  'BloodlineService.skillUpdate': (args) => {
    const level   = (args && args[2] != null) ? args[2] : 1;
    const skillId = (args && args[3] != null) ? String(args[3]) : '';
    const biaya   = (args && args[4] != null) ? Number(args[4]) : 0;

    const h = chars.naikkanSkillBloodline(skillId, level, biaya);
    if (!h || h.gagal) {
      log('   !! upgrade skill bloodline ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      return { status: 1, error: null, remain_bp: chars.bloodlinePoin() };
    }
    log('   skill bloodline ' + h.skillId + ' -> Lv' + h.level +
        ' (biaya ' + biaya + ' BP, sisa ' + h.sisaBP + ')');
    return { status: 1, error: null, remain_bp: h.sisaBP };
  },

  // --- Arena / PvP (SystemData) ----------------------------------

  // Inisialisasi server PvP. args: [sessionKey, bahasa]
  //
  // ArenaPanel2.setPvpServer (arena.swf, method 1157):
  //     11: Out.debug("setPvpServer", "#1")
  //     24: result.pvpstatus.status        <-- #1010 kalau pvpstatus tidak ada
  //     48: if (result == null || status == null || status == false) {
  //             Central.main.pvpstatus = result.pvpstatus;
  //             Central.main.checkPVPinvite();
  //             this.hide();                  <-- panel DITUTUP dengan rapi
  //             return;
  //         }
  //     ... selain itu lanjut ke:
  //     190: socket.stx(result.handoff_token)
  //     207: socket.stn(result.handoff_nonce)
  //     240: Main.pvpTimeList = result.time_list
  //     261: result.pvpstatus.mode[0..2]  -> 1v1 / 2v2 / 3v3
  //     568: socket.setUpServer(result.pvp_server, charId, startConnectPVPServer)
  //     614: result.ads, 635: result.pvp_layout,
  //     661: result.daily_first_bonus, 754: result.choose_room_message
  //
  // Balasan generik membuat result berupa Array kosong; result.pvpstatus
  // undefined lalu .status melempar #1010 -- callback berhenti sebelum
  // hideAmfLoading, jadi Arena "loading terus".
  //
  // KENAPA status: false
  // Ninja Saga menjalankan Arena lewat XMLSocket, bukan AMF. Alamat servernya
  // di-hardcode di code_library (xmlsocket://8.19.33.107:843 dan seterusnya)
  // dan server ini hanya melayani AMF di port 8080. Kalau status diisi true,
  // klien akan meneruskan ke socket.setUpServer() lalu menggantung di
  // connectTimeoutTimer -- loading yang sama, hanya lebih lama.
  //
  // Dengan status false, Main.checkPVPinvite (code_library method 160)
  // @57-133 mengambil pvpstatus["status_" + AppData.lang] (jatuh ke
  // status_en kalau kosong) dan menampilkannya lewat showGeneralNotice.
  // Jadi pemain dapat pesan yang jelas, bukan layar menggantung.
  'SystemData.getPvpServerInit': (args) => {
    const lang = (args && args[1]) ? String(args[1]) : 'en';
    log('   PvP init: status=false (Arena butuh server socket, tidak tersedia)');
    return {
      status: 1,
      error: null,
      result: {
        pvpstatus: {
          status: false,
          status_en: 'Arena is not available on this server.',
          ['status_' + lang]: 'Arena is not available on this server.',
        },
      },
    };
  },

  // --- Kartu gosok harian (RouletteService) ----------------------

  // Data awal panel kartu gosok. args: [sessionKey]
  //
  // daily_login4.show (daily_login_4.swf, method 786):
  //     Central.main.showAmfLoading();
  //     amfClient.service("RouletteService.getScratchCardData",
  //                       [session_key], getEventResponse);
  //
  // getEventResponse (method 787):
  //      8: if (!validateAmfResponse(res)) return;      <-- kalau gagal, BERHENTI
  //     30: remainScratchTime = res.dailyRoulette_remainTime;
  //     37: if (res.bouns_discount) scratchTokenPrice = 3;
  //     67: Central.main.hideAmfLoading();
  //     77: this.gotoAndPlay(Timeline.SHOW);
  //
  // hideAmfLoading DAN gotoAndPlay(SHOW) dua-duanya ada DI DALAM cabang
  // validateAmfResponse. Jadi kalau balasannya tidak lolos, layar loading
  // tidak pernah ditutup dan panel tidak pernah pindah ke frame isinya --
  // yang terlihat: panel putih kosong.
  'RouletteService.getScratchCardData': () => {
    log('   data kartu gosok dikirim');
    return {
      status: 1,
      error: null,
      // JUMLAH gosokan gratis yang tersisa -- bukan hitungan waktu.
      // updateIdlePanel @236-258:
      //     if (remainScratchTime != 0 || remainSpcScratchTime != 0) {
      //         scratchType = "free";
      //         scratch1/2/3.gotoAndStop("button");
      //         initButton(scratchBtn, checkScratch);     <-- tombol AKTIF
      //     }
      // Nilai 0 membuat ketiga tombol tetap disabled dan panel tampak kosong.
      dailyRoulette_remainTime: 3,
      bouns_discount: false,         // true -> harga gosok jadi 3 token
    };
  },

  // Penambahan kartu gosok acak setelah menyelesaikan misi. args: [sessionKey]
  // Dipanggil dari Character.updateCharacterResponse @175 dengan callback
  // ScratchAddAmfGetResult. Balasan sederhana sudah cukup.
  'RouletteService.randomAddScatchCard': () => {
    return { status: 1, error: null, result: 0, add_card: 0 };
  },

  // Menggosok satu kartu.
  // args: [sessionKey, scratchType, selectScratch, ...]
  //       scratchType "token" = beli pakai token, selain itu kartu gratis
  //
  // daily_login4.ScratchAmfGetResult (method 811):
  //     157: if (!validateAmfResponse(res)) return;
  //     173: reward_type   = res.reward_type
  //     185: reward_amount = res.reward_amount
  //     199: if (res.signature != Main.getHash(String(reward_type) +
  //                                            String(reward_amount)))
  //              onError("1216"); return;          <-- TANDA TANGAN DIPERIKSA
  //     343: startScratch(res)
  //
  // startScratch @1669-1899 mencocokkan reward_type dengan daftar:
  //     GOLD, XP%, XP, TOKEN, TP, SP, ITEM, WEAPON, BACK, SKILL,
  //     CLOTH, EMBLEM, PET, PACKAGE
  // Nilai di luar daftar itu jatuh ke default dan tidak menampilkan apa pun.
  'RouletteService.scratchCardAtfer20Level': (args) => {
    const jenis  = 'GOLD';
    const jumlah = 5000;

    // Main.getHash(x) = sha1(x + SALT + sessionKey) -- sama seperti hash lain
    // di server ini. Kalau meleset, klien memanggil onError("1216").
    const signature = sha1(String(jenis) + String(jumlah) + SALT + ACCOUNT.sessionKey);

    const c = chars.characterById(chars.getActiveId());
    log('   kartu gosok: ' + jenis + ' ' + jumlah +
        ' (tipe gosok: ' + ((args && args[1]) || '-') + ')');

    return {
      status: 1,
      error: null,
      reward_type:   jenis,
      reward_amount: jumlah,
      signature,
      update_inventory: {
        showPopup: false,
        xp:    c ? c.xp    : 0,
        gold:  c ? c.gold  : 0,
        token: c ? (c.token || 0) : 0,
      },
    };
  },

  // --- Misi Lv80 (SLevelMission) --------------------------------

  // Penyerahan hasil misi Lv80.
  // args: [sessionKey, idMisi, arrayItem, skor, hash]   mis. [..., "msn274", [], 0, ...]
  //
  // Mission.getSGradeResponse (code_library, method 846):
  //      6: if (res.update_inventory) res.update_inventory.showPopup = false;   <- ADA penjagaan
  //     26: if (!validateAmfResponse(res)) return;
  //     37: if (Mission.sMissioncomplete != 1) return;
  //     48: arr = res.update_inventory.add_item_id as Array;   <- TANPA penjagaan -> #1010
  //     68: if (arr[0] !== "item1") {
  //             Main.showSMissionReward  = true;
  //             Main.sMissionRewardItem  = arr[0];
  //             Main.sMissionRewardList  = res.reward_list;
  //             MISSION_DATA[id].xp   = arr[1].replace("xp","").replace("_1","");
  //             MISSION_DATA[id].gold = arr[2].replace("gold","").replace("_1","");
  //         }
  //
  // Jadi update_inventory WAJIB ada dan add_item_id WAJIB array.
  //
  // arr[0] sengaja diisi "item1" -- itu penanda "tidak ada item hadiah
  // khusus", dan membuat klien melompat ke akhir (@74 ifstricteq L185).
  // Kalau diisi selain itu, klien akan membaca arr[1] dan arr[2] sebagai
  // "xp<n>_1" / "gold<n>_1" dan MENIMPA MISSION_DATA; kalau salah satunya
  // tidak ada, .replace() pada undefined melempar #1009. Lebih aman
  // memberi xp/gold lewat update_inventory seperti misi biasa.
  'SLevelMission.finishMission': (args) => {
    const idMisi = (args && args[1]) ? String(args[1]) : '';
    const m = idMisi ? chars.recordMission(idMisi) : null;
    if (m) {
      log('   misi Lv80 selesai: msn' + m.no +
          '  success=' + m.entry.success +
          '  (total misi tercatat: ' + m.total + ')');
    } else if (idMisi) {
      log('   !! id misi Lv80 tidak dikenali: ' + idMisi);
    }

    const c = chars.characterById(chars.getActiveId());
    return {
      status: 1,
      error: null,
      result: 0,
      reward_list: [],
      update_inventory: {
        add_item_id: ['item1'],   // penanda "tanpa item hadiah"
        showPopup: false,
        xp:    c ? c.xp    : 0,
        gold:  c ? c.gold  : 0,
        token: c ? (c.token || 0) : 0,
      },
    };
  },

  // Upgrade batas stamina klan. args: [sessionKey]
  //
  // UpgradeStaminaResponse (method 1336) @142-150 membaca res.max_stamina dan
  // memakainya untuk CHARACTER_STAMINA sekaligus CHARACTER_MAX_STAMINA.
  // Tanpa field itu int(undefined) = 0 -> stamina jadi 0/0.
  // result 9 = gagal (klien menampilkan langLib 501).
  'ClanService.upgradeStamina': () => {
    const h = chars.upgradeStaminaKlan();
    if (!h || h.gagal) {
      log('   !! upgrade stamina ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      return { status: 1, error: null, result: 9 };
    }
    log('   stamina klan -> ' + h.maxStamina +
        ' (biaya ' + h.biayaToken + ' token, sisa ' + h.sisaToken + ')');
    return { status: 1, error: null, result: 0, max_stamina: h.maxStamina };
  },

  // Isi ulang stamina klan. args: [sessionKey]
  // RestoreStaminaResponse (method 1333) @232-289 memakai konstanta klien
  // (Restore_Sta_Amt 50, Restore_Sta_requiretoken 20); server menyamakan.
  // show_captcha JANGAN diisi -- @60-64 akan membuka webview captcha.
  'ClanService.restoreStamina': () => {
    const h = chars.restoreStaminaKlan();
    if (!h || h.gagal) {
      log('   !! isi ulang stamina ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      return { status: 1, error: null, result: 9 };
    }
    log('   stamina klan diisi -> ' + h.stamina + '/' + h.maks +
        ' (sisa token ' + h.sisaToken + ')');
    return { status: 1, error: null, result: 0 };
  },

  // Tambah slot anggota klan. args: [sessionKey]
  //
  // buyMemberSlotResponse (method 1212) @37-113:
  //     slot = int(res.member_slots);
  //     clanData[MEMBER_SLOTS] = slot;
  //     clanData[TOKEN] -= slot * 10;      <-- token KLAN, slot BARU x 10
  // Tanpa member_slots, slot jadi 0 dan panel menampilkan "0".
  'ClanManagement.buyMemberSlot': () => {
    const h = chars.tambahSlotAnggota();
    if (!h || h.gagal) {
      log('   !! tambah slot ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      return { status: 1, error: null, result: 9 };
    }
    log('   slot anggota -> ' + h.memberSlots +
        ' (biaya ' + h.biaya + ' token klan, kas ' + h.kasToken + ')');
    return { status: 1, error: null, member_slots: h.memberSlots };
  },

  // Riwayat klan. args: [sessionKey, hash, halaman]
  //
  // loadClanHistoryResponse (method 1214) @51-135: int(res.result) dipakai
  // sebagai penanda; kalau 0 klien memakai clan_history sebagai Array.
  // Array kosong aman -- klien menyiapkan entri "tidak ada riwayat" sendiri.
  'ClanService.getHistory': () => {
    return { status: 1, error: null, result: 0, clan_history: [] };
  },

  // Bangun / upgrade bangunan klan.
  // args: [sessionKey, hash, idBangunan]   mis. ["...", "b1e984fb…", 1]
  //
  // ClanPanel.constructBuildingResponse (method 1151):
  //     @52-73  if (res.result) { if (int(res.result) == 9) { showOk(501); return; } }
  //     @107    b = res.building_data as Object;          <-- WAJIB objek
  //     @184    ... selectedBuilding.gold[ b.level - 1 ]  <-- b null -> #1009
  //     @264+   masukkan/perbarui b di Clan.buildingData
  //
  // Balasan generik tidak punya building_data, jadi `as Object` menghasilkan
  // null dan pembacaan b.level melempar #1009 -- upgrade gagal diam-diam.
  //
  // result 9 = gagal (klien menampilkan pesan langLib 501). result 0/falsy
  // dilewati pemeriksaannya, jadi itu yang dipakai untuk sukses.
  //
  // Biaya dipotong dari KAS KLAN, bukan dari saldo pemain -- tabelnya sama
  // dengan ClanData.BUILDING_DATA yang dipakai klien, jadi angka di panel
  // dan di server cocok.
  'ClanManagement.constructBuilding': (args) => {
    const id = (args && args[2] != null) ? args[2] : null;
    const h = chars.bangunBangunanKlan(id);
    if (!h || h.gagal) {
      log('   !! upgrade bangunan ditolak: ' + ((h && h.gagal) || 'karakter tidak ada'));
      return { status: 1, error: null, result: 9 };
    }
    log('   ' + h.nama + ' -> Lv' + h.level +
        '  (biaya ' + h.biayaGold + ' gold + ' + h.biayaToken + ' token)' +
        '  kas klan: ' + h.kasGold + ' gold, ' + h.kasToken + ' token' +
        '  bonus: ' + JSON.stringify(h.bonus));
    return {
      status: 1,
      error: null,
      result: 0,
      building_data: { id: h.id, level: h.level },
    };
  },

  // Donasi gold ke kas klan.
  // args (ClanPanel.confirmDonateGold): [sessionKey, sequence, hash, jumlah]
  //
  // ClanPanel.donateGoldResult (method 1246) @65-146:
  //     amt = int(res.result);
  //     clanData[GOLD] = int(clanData[GOLD]) + amt;
  //     getMainChar().saveGold(0 - amt);
  //
  // `result` adalah JUMLAH yang benar-benar disumbang, bukan kode status.
  // Balasan generik `result: []` -> int([]) = 0, jadi klien menambah 0 ke kas
  // dan mengurangi 0 dari gold pemain: donasi tampak berhasil tapi tidak ada
  // yang berpindah. Karena itu kembalikan angkanya, dan kembalikan 0 kalau
  // ditolak supaya klien tidak mengurangi apa pun.
  'ClanManagement.donateGold': (args) => {
    const jumlah = Number((args && args[3]) || 0);
    const h = chars.donasiKlan('gold', jumlah);
    if (!h || h.tidakPunyaKlan || h.jumlahTidakSah) {
      log('   !! donasi gold ditolak: ' +
          (h && h.tidakPunyaKlan ? 'belum punya klan' : 'jumlah tidak sah'));
      return { status: 1, error: null, result: 0 };
    }
    log('   donasi gold ' + h.diberikan +
        (h.diberikan !== h.diminta ? ' (diminta ' + h.diminta + ', dibatasi saldo)' : '') +
        '  -> kas klan ' + h.kasKlan + ', sisa gold ' + h.sisa);
    return { status: 1, error: null, result: h.diberikan };
  },

  // Donasi token ke kas klan.
  // args (ClanPanel.confirmDonateToken): [sessionKey, password, sequence,
  //                                       hash(tokenToDonate), jumlah, ...]
  //
  // ClanPanel.donateTokenResult (method 1254) @215-310 memakai pola yang sama
  // dengan donateGold. Selain itu @71-201 memeriksa res.msg lebih dulu:
  //     "wrong_password"  -> showInfo(langLib 1823)
  //     "not_registered"  -> showInfo("Not Registered")
  // Jadi msg TIDAK boleh diisi kalau donasinya berhasil.
  'ClanManagement.donateToken': (args) => {
    // args[1] = security password yang diketik pemain. Server ini tidak
    // menyimpan password akun, jadi apa pun diterima. Yang penting `msg`
    // TIDAK diisi -- donateTokenResult @151-201 memeriksanya lebih dulu dan
    // "wrong_password" / "not_registered" akan menghentikan alur.
    const jumlah = Number((args && args[4]) || 0);
    const h = chars.donasiKlan('token', jumlah);
    if (!h || h.tidakPunyaKlan || h.jumlahTidakSah) {
      log('   !! donasi token ditolak: ' +
          (h && h.tidakPunyaKlan ? 'belum punya klan' : 'jumlah tidak sah'));
      return { status: 1, error: null, result: 0 };
    }
    log('   donasi token ' + h.diberikan +
        (h.diberikan !== h.diminta ? ' (diminta ' + h.diminta + ', dibatasi saldo)' : '') +
        '  -> kas klan ' + h.kasKlan + ', sisa token ' + h.sisa);
    return { status: 1, error: null, result: h.diberikan };
  },

  // Daftar anggota klan. args: [sessionKey]
  //
  // ClanPanel.gotMemberList (method 1228) @45-58:
  //     memberList = GF.objectToArray(res.result as Object);
  //     memberList.sortOn("level", NUMERIC | DESCENDING);
  //     clanData[MEMBER_NUMBER] = int(res.member_number);
  // result dibaca sebagai Object lalu diubah jadi array, jadi array biasa pun
  // diterima. member_number ada di TINGKAT ATAS, bukan di dalam result.
  'ClanService.getMemberList': () => {
    const anggota = chars.anggotaKlan();
    log('   daftar anggota klan: ' + anggota.length + ' orang');
    return {
      status: 1,
      error: null,
      result: anggota,
      member_number: anggota.length,
    };
  },

  // Data ruang klan (Clan Hall). args: [sessionKey]
  //
  // ClanPanel.getClanHallDataResponse (method 1198) @35-113 MENIMPA tiga
  // field di clanData yang sudah ada:
  //     clanData[GOLD]          = res.result.clan_gold
  //     clanData[TOKEN]         = res.result.clan_token
  //     clanData[MEMBER_NUMBER] = res.result.member_number
  // lalu clanHallMc.gotoAndStop("profile") -> frame11 -> onClanProfile().
  //
  // onClanProfile @460-540 memasang nilai itu ke TextField:
  //     goldTxt.text = clanData[GOLD]
  // Balasan generik membuat res.result berupa Array kosong, jadi ketiganya
  // undefined. TextField.text bertipe String, dan undefined dikoersi jadi
  // null -> #2007 Parameter text must be non-null, panel profil klan gagal
  // digambar. Karena itu result harus objek dengan ketiga field tersebut.
  //
  // res.status juga diperiksa @26-31 dan harus bernilai 1.
  'ClanService.getClanHallData': () => {
    const clan = chars.klanAktif();
    if (!clan) {
      log('   !! getClanHallData dipanggil tapi karakter belum punya klan');
      return {
        status: 1, error: null,
        result: { clan_gold: 0, clan_token: 0, member_number: 0 },
      };
    }
    log('   data ruang klan "' + clan.name + '": gold=' + clan.gold +
        ' token=' + clan.token + ' anggota=' + clan.member_number);
    return {
      status: 1,
      error: null,
      result: {
        clan_gold:     clan.gold,
        clan_token:    clan.token,
        member_number: clan.member_number,
      },
    };
  },

  // Pembuatan klan. args (dari ClanPanel.confirmCreateClan @90-107):
  //     [sessionKey, sequence, hash(saldo token), namaKlan, saldoToken]
  //
  // ClanPanel.createClanResponse (method 1157) @39-47 membaca
  // int(response.result as int):
  //     0 = BERHASIL -> saldo dikurangi 400, Clan.clanData = res.clan_data,
  //         lalu gotoBase() (kalau group_id ada) atau gotoAndPlay(BASE_TL)
  //     1 = nama sudah dipakai   -> showInfo(langLib 172)
  //     2 = token tidak cukup    -> showOk(langLib 1792[8])
  //
  // Balasan generik `result: []` dikoersi jadi 0 alias BERHASIL, padahal
  // clan_data-nya tidak ada -> Clan.clanData = null -> panel loncat ke
  // frame13 -> onBase -> updateClanStatus -> #1009, dan frame terus diulang
  // sehingga panel tampak kelap-kelip. Karena itu result harus jujur.
  'ClanManagement.createClan': (args) => {
    const nama = (args && args[3] != null) ? String(args[3]).trim() : '';
    if (!nama) {
      log('   !! createClan tanpa nama: ' + JSON.stringify(args));
      return { status: 1, error: null, result: 1, stamina_item: 0 };
    }

    const saldo = Number(chars.characterById(chars.getActiveId())?.token) || 0;
    if (saldo < chars.BIAYA_BUAT_KLAN_TOKEN) {
      log('   createClan ditolak: token ' + saldo + ' < ' +
          chars.BIAYA_BUAT_KLAN_TOKEN);
      return { status: 1, error: null, result: 2, stamina_item: 0 };
    }

    const hasil = chars.buatKlan(nama);
    if (!hasil) {
      log('   !! createClan: karakter aktif tidak ditemukan');
      return { status: 1, error: null, result: 1, stamina_item: 0 };
    }
    if (hasil.sudahPunya) {
      log('   createClan ditolak: sudah punya klan "' + hasil.clan.name + '"');
      return { status: 1, error: null, result: 1, stamina_item: 0 };
    }

    log('   klan dibuat: "' + hasil.clan.name + '" (biaya ' +
        chars.BIAYA_BUAT_KLAN_TOKEN + ' token, sisa ' + hasil.sisaToken + ')');
    return {
      status: 1,
      error: null,
      result: 0,                       // berhasil
      clan_data: hasil.clan,
      group_id: hasil.clan.id,         // non-null -> gotoBase()
      server_time: Math.floor(Date.now() / 1000),
      stamina_item: 0,
    };
  },

  // Merekrut NPC jadi anggota party (dipanggil dari panel Recruit Friends).
  // args: [sessionKey, npcId, saldoTokenSaatIni]
  //
  // Main.setNpcParty() memverifikasi:
  //     response.signature == Main.getHash( response.status + response.npc_id
  //                                         + Account.getAccountBalance() )
  // dan Main.getHash(x) = SHA1(x + SALT + sessionKey).
  //
  // PENTING: penjumlahannya NUMERIK, bukan penggabungan string — ketiganya
  // angka, jadi hasilnya 1 + 3 + 999999999 = 1000000003, lalu String()-nya
  // yang di-hash. Ini terbukti dari log klien: saat npc_id tidak dikirim,
  // 1 + undefined + saldo menghasilkan "AC Full: NaN" dan hash yang dihitung
  // klien sama persis dengan SHA1("NaN" + SALT + sessionKey).
  //
  // Tanpa npc_id + signature yang benar, klien memanggil Main.onError('120')
  // dan panel rekrut mentok.
  //
  // old_recruit=true membuat klien melewati perhitungan potongan token dan
  // langsung memuat SWF NPC-nya — sesuai untuk server pribadi tanpa ekonomi token.
  'CharacterDAO.recruitNpc': (args) => {
    const status = 1;
    const npcId  = Number(args && args[1] != null ? args[1] : 0) || 0;
    const saldo  = Number(args && args[2] != null ? args[2] : ACCOUNT.balance) || 0;
    const input  = String(status + npcId + saldo);
    const signature = sha1(input + SALT + ACCOUNT.sessionKey);
    log('   rekrut NPC: id=' + npcId + ' saldo=' + saldo +
        '  input=' + input + '  signature=' + signature);
    return {
      status, error: null,
      npc_id: npcId,
      old_recruit: true,
      signature,
    };
  },

  // Dipakai saat misi memakai "salinan diri" sebagai lawan (dan pada tantangan
  // teman). Mission.gotCharacterProfile() menyuapkan response.result langsung ke
  // dataParser.parseRawCharacter(), jadi bentuknya WAJIB sama persis dengan
  // CharacterDAO.getCharacterById — bukan objek kosong. Tanpa handler ini
  // parser gagal ("Character Data Error 2") lalu gotCharacterProfile() meledak
  // dengan TypeError #1009 dan peta ikut error beruntun di checkGameStatus().
  'CharacterDAO.getCharacterProfileById': (args) => {
    const id = args && args[1];
    const c = (id != null && chars.characterById(id)) || chars.firstCharacter();
    if (!c) return { status: 1, error: null, result: null };
    log('   profil karakter diminta: ' + c.name + ' lv' + c.level + ' (id=' + id + ')');
    return {
      status: 1, error: null,
      result: chars.rawCharacter(c, args && args[0]),
      pet_data: {},   // dibaca sebagai Object; {} aman kalau lawan bukan pet
    };
  },

  // Mengirim seluruh rekaman karakter. parseCharacterData membaca 200+ field;
  // yang diakses berantai wajib berupa objek/array (lihat chardata.js).
  'CharacterDAO.getExtraData': () => {
    const aktif = chars.getActiveId();
    const c = (aktif && chars.characterById(aktif)) || chars.firstCharacter();
    if (!c) {
      log('   !! getExtraData dipanggil tapi belum ada karakter tersimpan');
      return { status: 1, error: null, result: null };
    }
    const data = chars.buildExtraData(c, ACCOUNT.sessionKey);

    // Klien memverifikasi hash ini; kalau salah, parseCharacterData
    // memanggil onError() dan mengembalikan false tanpa exception.
    const h = chars.extraDataHash(data, ACCOUNT.sessionKey);
    data.extra_data_hash = h.hash;
    log('   hash extra data: input=' + JSON.stringify(h.input));
    log('                    hash =' + h.hash);

    // Periksa rekaman terhadap tipe deklarasi DBCharacter di klien.
    const bad = chars.validate(data.databaseCharacter);
    if (bad.length) {
      log('   !! TIPE FIELD TIDAK COCOK (' + bad.length + '):');
      bad.forEach(b => log('        ' + b));
    } else {
      log('   tipe rekaman karakter: semua benar (72 field)');
    }
    log('   character_skills = ' + JSON.stringify(data.databaseCharacter.character_skills));
    const pets = data.player_pet || [];
    log('   player_pet = ' + pets.length + ' pet' +
        (pets.length ? ' (aktif: ' +
          (pets.filter(p => p.equipped).map(p => p.name).join(',') || 'tidak ada') + ')' : ''));

    return { status: 1, error: null, result: data };
  },

  // PENTING: berbeda dengan SystemData.get, callback-nya memanggil
  //   dataParser.parseSystemData(response)   <- respons UTUH
  // bukan parseSystemData(response.result). Jadi field harus ada di
  // tingkat atas. Disertakan juga di dalam .result supaya aman
  // kalau ada jalur lain yang membacanya dari sana.
  'SystemData.getCreateCharacter': () => {
    const f = systemDataFields();
    return Object.assign({ status: 1, error: null, result: f }, f);
  },

  'ReportService.reportLogDump': () => ({ status: 1, error: null }),

  // --- Panel & fitur lain ---------------------------------------

  // Responsnya diproses NewDailyLogin2017.showResponseFunction, yang
  // melakukan `item_list as Array` lalu membaca .length di akhir loop.
  // Kalau item_list bukan Array, hasil coerce-nya null -> #1009.
  // Responsnya diproses NewDailyLogin2017.showResponseFunction.
  // Tipe diambil dari deklarasi slot di Panel_New_Daily_Login.swf:
  //   loginDay   : Array      <- bukan angka
  //   rewardDay  : Array      <- bukan angka
  //   nowtime    : int
  //   part2      : Boolean
  // dan item_list di-coerce ke Array lalu dibaca .length-nya,
  // sedangkan tiap elemennya juga di-coerce ke Array lalu di-join.
  'NewDailyRewardStamp2017.getStatus': () => ({
    status: 1, error: null,
    // onShow() mengulang 31 kali dan mengisi TextField dari kedua array
    // ini. Kalau isinya kosong, loginDay[i] bernilai undefined; AS3
    // meng-coerce undefined ke null saat dimasukkan ke parameter
    // bertipe String, dan TextField.text = null melempar
    // "#2007: Parameter text must be non-null".
    // Karena itu keduanya harus punya 31 entri, bukan array kosong.
    loginDay:  Array.from({ length: 31 }, (_, i) => String(i + 1)),
    rewardDay: Array.from({ length: 31 }, () => '0'),

    // Panel selalu mengulang 31 kali di onShow():
    //     String(stampReward[i]).split("_")
    // dan stampReward diisi dari item_list saat respons diterima:
    //     stampReward.push( item_list[i].join(",") )
    //
    // Jadi tiap entri adalah Array berisi satu string "itemId_jumlah".
    // Kalau item_list kosong, stampReward[i] jadi undefined dan
    // pencarian data itemnya melempar #1009.
    item_list: Array.from({ length: 31 }, () => ['item1_1']),

    // Saat hadiah diklaim, panel menulis ke respons yang ia simpan:
    //     this.showResponse.claimReward[this.claimNum] = "2"
    // Jadi field ini harus ada dan bisa diindeks, kalau tidak
    // undefined[claimNum] melempar #1010 di getDailyReward().
    // "0" = belum diklaim, "2" = sudah.
    claimReward: Array.from({ length: 31 }, () => '0'),
    // -> panel.serverDesc (Object). initButtonAndText membaca
    //    .desc1, .desc2, .desc3 darinya. String kosong menyebabkan
    //    "#1069: Property desc1 not found on String".
    txt: { desc1: '', desc2: '', desc3: '' },
    now_time: Math.floor(Date.now() / 1000),
    part2: false,
  }),

  'NewDailyRewardStamp2017.claimReward': () => ({
    status: 1, error: null, item_list: [], result: [],
  }),

  'SpecialReward.getLvUpReward': () => ({
    status: 1, error: null, result: [], reward_list: [],
  }),

  'SpecialReward.claimLvUpReward': () => ({
    status: 1, error: null, result: [],
  }),

  // --- Paket / kode klaim ulang tahun ke-4 -----------------------------
  //
  // ClaimItemResponse (popup_4th_claim_code_p8.swf) HANYA membaca satu field:
  //
  //    @58-65:  if (res.message == 'You do not have a claim for this package.')
  //                  -> buka toko (webview / postMessage), selesai
  //             else Central.main.showOk(res.message);
  //    ConfirmationDoc.onShow @26-30:  displayTxt.htmlText = confirmationTxt
  //
  // Tanpa `message`, showOk() menerima undefined dan set htmlText melempar
  // #2007 "Parameter text must be non-null". Jadi field ini WAJIB string.
  //
  // Tombol "claim code" di panel depan (onShow @296-315) terikat ke
  // gotoClaimPanel, yang memanggil SpecialReward.claimAugustPackage dan
  // hasilnya cuma pesan -- tombol itu memang tidak pernah membuka panel kode.
  // Panel kodenya dibuka lewat detailBtn -> gotoRewardListPanel -> pilih
  // hadiah -> rewardGotoClaimPanel @330.
  // Tombol "Claim" di panel depan -> gotoClaimPanel @19 -> servis ini,
  // callback ClaimItemResponse. Inilah SATU-SATUNYA jalur klaim yang terbukti
  // jalan di log: panel kode (popupClaimCodeMc) terbuka tapi klik pada
  // claimItemBtn tidak pernah sampai ke claimReward, jadi hadiahnya diberikan
  // langsung dari sini.
  //
  // ClaimItemResponse @58-65 hanya membaca res.message:
  //     == 'You do not have a claim for this package.' -> buka toko
  //     selain itu                                     -> showOk(res.message)
  // Jadi pesan di bawah sekaligus jadi tampilan hasilnya.
  'SpecialReward.claimAugustPackage':  () => klaimPaket('SpecialReward.claimAugustPackage'),
  'SpecialReward.claimPatriotPackage': () => klaimPaket('SpecialReward.claimPatriotPackage'),
  'SpecialReward.claimMagicPackage':   () => klaimPaket('SpecialReward.claimMagicPackage'),

  // Jalur kode klaim: claimReward @449-486 mengirim
  // [sessionKey, ClaimCode_1, ClaimCode_2].
  //
  // MAX_CHARS_ONE / MAX_CHARS_TWO tidak pernah diisi di SWF, jadi
  // pemeriksaan panjang di claimReward @49-113 tinggal "tidak boleh kosong"
  // -- panjang kode bebas.
  //
  // Server tidak menerima hadiah mana yang dipilih (selectedClaimID hanya
  // ada di klien), jadi KODE-lah yang menentukan hadiahnya.
  'Anni4th.claimStickerGift': (args) => {
    const gabung = (a, b) => (String(a || '').trim() + '-' + String(b || '').trim()).toUpperCase();
    const kode = gabung(args[1], args[2]);
    const pilih = KODE_ANNI4[kode];

    if (!pilih) {
      log('   kode klaim ditolak: ' + JSON.stringify(kode));
      return { status: 1, error: null, result: [], data: {},
               message: 'Kode klaim tidak dikenal.' };
    }

    const aktif = chars.getActiveId();
    const c = (aktif && chars.characterById(aktif)) || chars.firstCharacter();
    if (!c) {
      return { status: 1, error: null, result: [], data: {},
               message: 'Karakter tidak ditemukan.' };
    }

    const baru = pilih(c).filter(id => !sudahPunya(c, id));
    if (!baru.length) {
      return { status: 1, error: null, result: [], data: {},
               message: 'Hadiah untuk kode ini sudah pernah kamu ambil.' };
    }

    for (const id of baru) {
      const sk = String(id).match(/^skill_?(\d+)$/);
      const pt = String(id).match(/^pet_?(\d+)$/);
      if (sk)      chars.addSkill(sk[1]);
      else if (pt) chars.addPet({ id: pt[1] });
      else         chars.addItem(String(id).replace('_', ''), 1);
    }
    log('   kode klaim ' + kode + ' -> ' + baru.join(', '));

    return {
      status: 1, error: null, result: [], data: {},
      message: 'Berhasil! Kamu mendapat ' + baru.join(', ') +
               '. Muat ulang permainan supaya muncul di inventaris.',
    };
  },

  // Tanpa Facebook, daftar teman selalu kosong.
  // RequestBox.gotoHide() berbunyi:
  //     Central.main.currRequest = this.requestListResult.requests.length;
  // dan requestListResult diisi mentah dari balasan servis ini. Tanpa field
  // `requests`, `.length` dibaca dari undefined -> #1010, dan panelnya tidak
  // pernah bisa ditutup. `remain` dipakai updatePanel()/acceptGiftResponse()
  // sebagai peta yang diindeks request_type.
  // InviteReward2.gotInviteRecord(response):
  //     Central.main.friendship_kunai = response.friendship_kunai;
  //     this.CLAIM_REWARD_ARR = response.reward_list;
  //     this.Maxpage = Math.ceil((CLAIM_REWARD_ARR.length - 1) / PER_PAGE);
  // Tanpa `reward_list`, .length dibaca dari null -> #1009 dan panel ajak
  // teman tidak pernah tampil.
  // reward_list TIDAK BOLEH kosong. InviteReward2.updateRewardList():
  //     this.clearRewardList();
  //     this.LoadRewardItem(0, this.CLAIM_REWARD_ARR[0]);   // <- tanpa penjaga
  // dan LoadRewardItem membaca data itu di instruksi pertamanya:
  //     panel["item" + idx].claimBtn.numToClaim = data.price;
  // Array kosong -> arr[0] undefined -> #1009 di LoadRewardItem.
  //
  // Field yang dibaca dari tiap entri (hasil pembongkaran LoadRewardItem):
  //   price     -> claimBtn.numToClaim, dan label tombolnya
  //   rewardId  -> Central.main.itemPrototype(String(rewardId))
  //   amount    -> kalau > 1 dan type gold/token, ditulis "x<amount>"
  //   type      -> dibandingkan dengan "gold" dan "token"
  //   priority  -> dibandingkan dengan 3 untuk menampilkan penanda "new"
  //
  // amount 1 dipilih supaya cabang label "x<amount>" tidak diambil, dan
  // rewardId "item1" karena id itu terbukti dikenali ITEM_DATA (dipakai juga
  // oleh panel daily login).
  // Daftar rambut yang DIMILIKI pemain. Katalognya sendiri sudah ada di
  // klien (HAIR_DATA berisi 575 entri dari data_library), jadi server cuma
  // perlu menyebut mana yang dipunya.
  //
  // StyleShop.getInvHairResponse():
  //     Central.main.hideAmfLoading();
  //     if (validateAmfResponse(response)) {
  //         var arr:Array = response.inv_hair as Array;      // null kalau absen
  //         this.invHair = arr;
  //         for (i = 0; i < arr.length; i++)                 // null.length -> #1009
  //             getMainChar().addInventory(InventoryData.TYPE_HAIR, "hair" + arr[i]);
  //         this.gotoShow();                                 // <- tidak pernah tercapai
  //     }
  // Tanpa `inv_hair`, gotoShow() tidak jalan dan panelnya tinggal putih.
  // Array kosong aman: perulangannya dilewati dan gotoShow() tetap dipanggil.
  //
  // Isi entri berupa id telanjang — klien menambahkan awalan "hair" sendiri,
  // pola yang sama dengan character_item.
  // Rumah berburu lama. OldHuntingHouse.BattleStatusResponse():
  //     if (validateAmfResponse(response)) {
  //         this.enemyList = [];
  //         for (i = 0; i < response.result.room.length; i++) { ... }
  //         this.currPage = 1;
  //         this.initDetail();
  //         this.loadPanelContent();
  //         this.gotoAndPlay(Timeline.SHOW);
  //         Central.main.hideAmfLoading();          // <- PALING AKHIR
  //     }
  //
  // Catch-all mengirim result: [] sehingga result.room undefined, dan
  // `.length` melempar #1010. Karena hideAmfLoading() ada di baris terakhir,
  // exception itu meninggalkan lapisan pemblokir tetap terpasang — layarnya
  // macet, bukan sekadar panel kosong.
  //
  // `room` satu-satunya field yang dibaca dari result di seluruh SWF ini.
  // Array kosong aman: perulangannya dilewati, dan initDetail() maupun
  // loadPanelContent() tidak menyentuh enemyList sama sekali.
  // Panel tail pet (popup_tail_pet.swf, kelas paymentTailPet).
  //
  //   getCanBuyTailsResponse(response) {
  //       this.method_tokenBuy = response.active_tail_number;         // <- Array
  //       this.ownedTailArr = (response.owned_tail_number != null)
  //                           ? response.owned_tail_number as Array : [];
  //       for (i = 0; i < tailPetCanShowArr.length; i++)
  //           if (method_tokenBuy.indexOf(tailPetCanShowArr[i]) < 0) ...
  //       this.defaultPost = method_tokenBuy[method_tokenBuy.length - 1];
  //       Central.main.hideAmfLoading();                              // <- sesudahnya
  //   }
  //
  // `method_tokenBuy` bertipe Array, jadi `active_tail_number` yang tidak ada
  // ter-coerce jadi NULL (bukan undefined) — lalu .indexOf() atau .length
  // melempar #1009. Karena hideAmfLoading() baru dipanggil sesudah itu,
  // layarnya ikut macet.
  //
  // `owned_tail_number` sudah punya penjaga null di klien, jadi sebenarnya
  // opsional — dikirim juga supaya bentuknya konsisten.
  //
  // Array KOSONG tidak cukup: defaultPost jadi undefined, lalu checkMcPost()
  // dan updateTab() meledak saat panel digambar (#1009 dan #1010 di frame10).
  //
  // Isinya diambil dari nilai bawaan panel itu sendiri. Konstruktornya
  // menyiapkan:
  //     tailPetArr        = [141, 131, 86, 74, 73, 71, 68, 65]
  //     tailSwfArr        = ['pet_146','pet_141','pet_131','tail_4_3',
  //                          'tail_5','tail_6','tail_7','snake_0','fox_1']
  //     tailBtnArr        = ['tailx','pet1Btn' ... 'pet9Btn']
  //     tailPetCanShowArr = [1, 2]
  //     method_tokenBuy   = [1, 2, 3, 4, 5, 6, 7, 8, 9]   <- lalu DITIMPA respons ini
  //
  // Jadi mengirim 1..9 mengembalikan panel ke perilaku bawaannya, dan
  // defaultPost = method_tokenBuy[length-1] = 9 seperti semula.
  'Anni5th.getTailPet': () => ({
    status: 1, error: null, result: [],
    // Nilai TERAKHIR-nya yang menentukan, karena:
    //     defaultPost = method_tokenBuy[method_tokenBuy.length - 1];
    // dan defaultPost dipakai sebagai `nowPost`, yaitu INDEKS ke
    // tailPetCanShowArr — bukan nomor tail. Rantainya:
    //     getTailDetail( tailPetCanShowArr[nowPost] )
    //         -> PET_DATA.find("pet" + tailPetArr[tailNum])
    //
    // tailPetCanShowArr = [1, 2]  (hanya dua indeks sah: 0 dan 1)
    // tailPetArr[1] = 141  -> PET_DATA.find("pet141")  KETEMU
    // tailPetArr[9] = 0    -> PET_DATA.find("pet0")    null -> #1009
    //
    // Dengan [1,2,3,...,9] nilai terakhirnya 9, dan itu menembak slot kosong
    // tailPetArr[9] = 0 — persis yang dicetak panel sendiri di log:
    //     Jane..............this.tailPetArr[tailNum] = 0
    //     Jane..............petObj = null
    //
    // Jadi: 1 dan 2 di depan supaya kedua tail dianggap masih aktif
    // (method_tokenBuy.indexOf(tailPetCanShowArr[i]) >= 0), lalu 0 di akhir
    // supaya defaultPost menunjuk indeks 0 -> tail 141, yang terbukti
    // ditemukan PET_DATA di log Anda.
    active_tail_number: [1, 2, 0],
    owned_tail_number: [],
  }),

  // args: [sessionKey, characterId, tradingBodySet, tradingWeapon, ?, tradingBackItem, accessory]
  //
  // KETIDAKPASTIAN: saya sudah menelusuri pemanggilnya (Character.equipCharacter)
  // sampai ke titik ini, tapi belum memverifikasi apakah tiap argumen berupa
  // string tunggal atau array (mis. getTradingWeapon() bisa saja mengembalikan
  // Array kalau senjata dua tangan). Untuk sekarang disimpan sebagai string
  // apa adanya lewat setEquip(). Kalau nanti equip masih tidak sinkron
  // sesudah dipasang, kirim flashlog saat mengganti perlengkapan -- errornya
  // (kalau ada) akan menunjukkan bentuk yang benar.
  //
  // Callback klien (Main.onAmfResult) generik -- tidak menuntut field selain
  // status, jadi balasan minimal ini aman.
  // args: [sessionKey, characterId, "wpn2", jumlah]
  //
  // ShopPanel.sellItemResponse() menghapus barang dari inventaris KLIEN sendiri
  // (removeInventory) sesudah balasan valid, tapi tidak pernah memberi tahu
  // server apa yang terjual. Tanpa handler ini, catch-all menjawab tanpa
  // menyentuh characters.json, jadi barangnya muncul lagi saat login.
  //
  // update_inventory bernilai ABSOLUT. Harga jual di Ninja Saga adalah
  // separuh harga beli untuk barang ber-gold; barang ber-token tidak
  // menghasilkan token kembali.
  'CharacterDAO.sellItem': (args) => {
    // KOREKSI: susunannya BUKAN [sessionKey, characterId, id, jumlah].
    // Dari log nyata:
    //   [ "localdevsession0001", "wpn2", "<hash 40 hex>", 1 ]
    // Jadi id ada di args[1] dan jumlah di args[3]; args[2] hash verifikasi.
    // Versi sebelumnya mengambil args[2], sehingga removeItem() mencari
    // "b1e984fb..." di inventaris, tidak menemukan apa pun, dan barangnya
    // tetap ada saat login berikutnya.
    const id = args && args[1];
    const n  = Math.max(1, Number(args && args[3]) || 1);
    const h  = HARGA[String(id)];
    const kembali = h ? Math.floor(h[0] / 2) * n : 0;

    const c = chars.removeItem(id, n, kembali);
    if (!c) return { status: 1, error: null, result: 1 };

    log('   jual ' + id + ' x' + n + '  +' + kembali + ' gold' +
        '  -> gold=' + c.gold);
    return {
      status: 1, error: null, result: 1,
      update_inventory: { xp: c.xp, gold: c.gold, token: c.token || 0 },
    };
  },

  'CharacterDAO.equipCharacter': (args) => {
    // args: [sessionKey, characterId, bodySet, weapon, jutsuArr, backItem, accessory]
    // args[4] adalah daftar jutsu yang DIPASANG di slot bertarung, mis.
    // ["skill13","skill16"]. Klien membacanya kembali dari
    // character_equipped_skills (@722, di-split ","), dan tanpa disimpan
    // slot jutsu selalu kosong lagi setiap login.
    const c = chars.setEquip(args && args[3], args && args[2],
                             args && args[5], args && args[6], args && args[4]);
    if (c) log('   equip -> ' + JSON.stringify(c.equip));
    return { status: 1, error: null };
  },

  // ---- Eudemon Garden (hunting_house.swf, kelas OldHuntingHouse) --------
  //
  // OldHuntingHouse.getBattleStatus @19 memanggil servis ini, lalu
  // BattleStatusResponse @90-233 menyalin tiap entri result.room jadi:
  //
  //     { enemyId: room[i].boss,     <- ARRAY id musuh, maksimal 2
  //       rank:    room[i].rank,     <- nomor frame rankMc.gotoAndStop()
  //       rewards: room[i].rewards,  <- ARRAY id barang
  //       status:  room[i].status,
  //       time:    room[i].time,     <- sisa pertarungan hari ini
  //       xp:      room[i].xp,
  //       gold:    room[i].gold }
  //
  // Konstanta panelnya: enemyPerPage=5 (5 room per halaman), maxEnemy=2
  // (hanya previewMc0 dan previewMc1 ada), maxItem=6 (6 ikon hadiah).
  //
  // enemyId dicari di ENEMY_DATA (updateEnemy @33-41), jadi isinya harus id
  // yang benar-benar ada di tabel ENEMY — lihat database/enemy.csv. Kalau
  // tidak ketemu, entri itu dilewati diam-diam dan preview-nya kosong.
  //
  // `time` menentukan tampilan tombol serang:
  //     time == 0  -> "You have used all chances today", tombol mati
  //     time  > 0  -> "You still have N time(s) to battle"
  // Kunci level diambil dari minLevel musuh PERTAMA (setPanelContent @1497).
  //
  // `rewards` dipisah klien jadi dua kolom di updateItem @18-27: yang
  // mengandung "wpn" masuk kolom senjata, sisanya kolom pakaian/barang.
  // Garis bawahnya dibuang, jadi 'wpn_1498' dan 'wpn1498' sama saja.
  'EudemonGarden.getHuntingStatus': () => ({
    status: 1, error: null,
    result: { room: EUDEMON_ROOM.map(r => ({
      boss:    r.boss,
      rank:    r.rank || 1,
      rewards: r.rewards || [],
      status:  0,
      time:    r.time == null ? 3 : r.time,
      xp:      r.xp || 0,
      gold:    r.gold || 0,
    })) },
  }),

  // Dipanggil sesudah pertarungan Eudemon Garden selesai
  // (Battle.callBattleFinishHAV @2124, Battle.actionFinish_CB @1991).
  'EudemonGarden.finishHunting':     () => balasanHadiah(),

  // ---- Hunting House (hunting_house2.swf, kelas HuntingHouse2) ----------
  //
  // HuntingHouse2.show @523 memanggil ItemDAO.getCharacterHuntingList, lalu
  // getHuntingListResponse @54-122 membaca:
  //
  //     hunting_list          objek berisi kunci "zone0", "zone1", ...
  //     hunting_cost          harga tiket berburu
  //     update_time           hitung mundur penyegaran
  //     get_hunting_passport  status paspor
  //     show_item             STRING dipisah koma (@174 split ',')
  //     hunting_daren         hanya dibaca kalau fitur material tambahan aktif
  //
  // Perlakuan zona berbeda (@221-361):
  //     "zone0"  -> tiap elemennya diambil [0]-nya saja, masuk SpecialBoss
  //     "zoneN"  -> seluruh larik masuk HuntingBoss, dan N (tanpa "zone")
  //                 masuk HuntingBossHolder, dipakai memilih movieclip
  //                 EasyBoss<N> di peta dunia panel
  //
  // Isi tiap zona = id musuh, dicari lewat ENEMY_DATA.find() di
  // updateBossList @218-243 lalu diambil swfName-nya untuk ikon.
  'ItemDAO.getCharacterHuntingList': () => ({
    status: 1, error: null,
    hunting_list: HUNTING_ZONE,
    hunting_cost: 0,
    update_time: 0,
    get_hunting_passport: 1,
    hunting_daren: [],
    show_item: '',
  }),

  // Mulai & selesai berburu. Argumennya tidak diverifikasi server sendiri.
  'ItemDAO.startHunting':        () => ({ status: 1, error: null, result: 1 }),
  'CharacterDAO.startHunting':   () => ({ status: 1, error: null, result: 1 }),
  'CharacterDAO.finishHunting':      () => balasanHadiah(),
  'ValentinesDay2017.finishHunting': () => balasanHadiah(),

  'CharacterManagement.getInvHair': () => ({
    status: 1, error: null, result: [],
    inv_hair: [],
  }),

  'FacebookService.getInviteRecord': () => ({
    status: 1, error: null, result: [],
    friendship_kunai: 0,
    reward_list: [
      // `active` WAJIB dan harus truthy. gotInviteRecord memanggil
      // removeInactiveReward() sebelum gotoAndPlay(SHOW), dan isinya:
      //     for (i ...) if (!CLAIM_REWARD_ARR[i].active) CLAIM_REWARD_ARR.splice(i, 1);
      // Entri tanpa `active` dibuang, array kembali kosong, dan
      // updateRewardList() -> LoadRewardItem(0, arr[0]) menabrak undefined.
      // Itulah kenapa menambahkan entri saja belum cukup kemarin.
      { rewardId: 'item1', type: 'gold', amount: 1, price: 1, priority: 1, active: 1 },
    ],
  }),

  'FacebookService.getRequestList': () => ({
    status: 1, error: null, result: [],
    requests: [], remain: {},
  }),

  'FacebookService.getFriendList': () => ({
    status: 1, error: null, result: [], friend_list: [],
  }),

  'FacebookService.getFriendsData': () => ({
    status: 1, error: null, result: [],
  }),

  // Alokasi attribute point
  // Character.updateAP mengirim TOTAL poin elemen, bukan selisih:
  //   service("CharacterDAO.updateAP", [sessionKey, dbChar.character_id,
  //            [character_fire, character_water, character_wind,
  //             character_earth, character_lightning]], onAmfResult)
  // Jadi "atribut" yang dinaikkan pemain sebenarnya penguasaan elemen.
  'CharacterDAO.updateAP': (args) => {
    const el = (args && args[2]) || [];
    const c = chars.setElements(el);
    if (c) log('   poin elemen -> api=' + c.elements[0] + ' air=' + c.elements[1] +
               ' angin=' + c.elements[2] + ' tanah=' + c.elements[3] +
               ' petir=' + c.elements[4]);
    return { status: 1, error: null, result: 1 };
  },

  // Pembelian di toko. Emas dipotong lewat update_inventory
  // (nilainya ABSOLUT — total baru, bukan selisih).
  // args: [sessionKey, itemId, jumlah, ...]
  'CharacterDAO.buyItem': (args) => {
    // args: [sessionKey, "item1", jumlah]
    const id = args && args[1];
    const n  = Math.max(1, Number(args && args[2]) || 1);
    const h  = HARGA[String(id)];            // [gold, crystal] atau undefined

    const c = chars.addItem(id, n, h ? h[0] : 0, h ? h[1] : 0);
    if (!c) return { status: 1, error: null, result: 1 };

    if (h) {
      log('   beli ' + id + ' x' + n + '  -' + (h[0] * n) + ' gold' +
          (h[1] ? '  -' + (h[1] * n) + ' token' : '') +
          '  -> gold=' + c.gold + '  inventaris: [' + c.items.join(',') + ']');
    } else {
      log('   beli ' + id + ' x' + n + '  (harga TIDAK DIKENAL, tidak dipotong)' +
          '  -> inventaris: [' + c.items.join(',') + ']');
    }

    // update_inventory SENGAJA dikirim kosong.
    //
    // Emas dipotong DUA KALI kalau kita mengirim `gold`:
    //   ShopPanel.buyItemResponse() -> validateAmfResponse(response)
    //        -> if (update_inventory.gold !== undefined) setGold(gold)   // ABSOLUT
    //   lalu di offset 1832 method yang sama:
    //        getMainChar().updateGold(0 - selectedItem.gold * amount)    // SELISIH
    //
    // Jadi klien selalu mengurangi sendiri dari saldonya. Dengan mengirim
    // saldo yang SUDAH kita potong, pengurangan itu terjadi lagi dan angka
    // di layar melenceng dua kali lipat harga.
    //
    // Objek kosong tetap truthy, jadi validateAmfResponse masuk ke blok
    // update_inventory lalu melewati semua field karena semuanya undefined.
    // Item juga tidak perlu dikirim: buyItemResponse memanggil
    // addInventory() sendiri untuk tiap kategori.
    return { status: 1, error: null, result: 1, update_inventory: {} };
  },

  // Dikirim klien setelah misi selesai, membawa statistik pencapaian.
  // args: [sessionKey, hash1, hash2, { "12": 250, "13": 0, ... }]
  // Kuncinya id tipe statistik, nilainya jumlah tambahan.
  'Achievement.flushCharStat': (args) => {
    const stat = (args && args[3]) || {};
    const n = chars.mergeStats(stat);
    const isi = Object.keys(stat).filter(k => stat[k]);
    if (isi.length) log('   statistik disimpan: ' + isi.map(k => k + '=+' + stat[k]).join(', '));
    return { status: 1, error: null, result: [] };
  },

  // --- Pelatihan skill -----------------------------------------

  // Klien: `recall = int(response.recall); if (recall != 1) { ...proses... }`
  //
  // Perhitungan target lompatan (pc 60, ifne, panjang 4 byte):
  //   pc berikutnya = 64, target = 64 + 1 = 65
  // Jadi recall != 1 -> LANJUT memproses; recall == 1 -> returnvoid.
  //
  // Kalau diproses, klien memanggil addNewSkill() untuk skill yang
  // sedang dilatih dan mencari SKILL_DATA[id].name -> #1010 kalau
  // tidak ada pelatihan berjalan. Maka recall=1 = "tidak ada apa-apa".
  // JANGAN kembalikan recall:1 di sini. Character.verifyTrainingSkill()
  // memanggil Main.showAmfLoading() sebelum mengirim permintaan ini, dan
  // lapisan loading itu MEMBLOKIR seluruh klik di panggung. Penurunannya
  // hanya terjadi di baris terakhir Character.verifyTrainingSkillResult:
  //
  //     if (String(response.status) == "0") { Main.onError(...); return; }
  //     if (int(response.recall) == 1) return;      // <- keluar dini
  //     ... proses result ...
  //     Main.hideAmfLoading();                      // <- hanya tercapai bila recall != 1
  //
  // Dengan recall:1 klien keluar lewat pintu kedua dan lapisan pemblokir
  // tidak pernah turun -> layar hasil misi tampak beku, tidak bisa diklik.
  //
  // result juga harus > 0. Kalau result:0, klien masuk ke cabang
  // addNewSkill(_trainingSkill.id, cb) dengan id "0" — memberi skill palsu.
  // Dengan result positif ia mengambil cabang aman: mengisi trainingSkill,
  // memanggil callback, lalu hideAmfLoading().
  'CharacterDAO.verifyTrainingSkill': () => ({
    status: 1, error: null, recall: 0, result: 1,
  }),

  // Dipanggil dua tempat, dan keduanya menaikkan lapisan pemblokir lebih dulu:
  //   Popup.readyMissionComplete()  -> showAmfLoading(), lalu servis ini
  //   MissionResult.hide()          -> showAmfLoading(), lalu servis ini
  // Pembuka kuncinya masing-masing Popup.onFriendReward dan
  // MissionResult.popFeedResponse, dan keduanya memanggil hideAmfLoading()
  // TANPA syarat — jadi balasan apa pun sudah cukup membuka layar.
  //
  // status HARUS 1. Catatan lama (-1 dianggap "lolos diam-diam") ternyata salah:
  // Main.validateAmfResponse hanya meneruskan kalau String(status) == "1"
  // (AMFData.STATUS_SUCCESS). Untuk nilai lain -- termasuk -1 -- ia jatuh ke
  // cabang onError(String(response.error)) lalu meledak dengan TypeError #1009
  // di Main.hideAmfLoading().
  //
  // hash_str WAJIB ikut dikirim. Popup.onMissionComplete menghitung:
  //     Main.getHash( String(status) + String(reward_type) +
  //                   String(reward_amount) + String(reward_id) +
  //                   String(wallfeed_id) )
  // dan Main.getHash(x) = clientLib.getHash(sessionKey, x)
  //                     = SHA1(x + SALT + sessionKey)   (pola sama seperti
  //                       yang sudah dipakai SystemService.checkAmf).
  // Kalau hasilnya tidak sama dengan reward.hash_str, klien memanggil
  // Main.onError('120') -> dialog error + #1009 di Main.initButton.
  //
  // Dengan semua nilai reward 0, reward_id 0 jatuh ke cabang default switch
  // reward_id, dan cabang itu aman (lanjut normal, tanpa publishShareFeed).
  'FriendReward.getFriendReward': () => {
    const r = {
      status: 1, error: null,
      reward_type: 0, reward_amount: 0, reward_id: 0, wallfeed_id: 0,
    };
    const input = String(r.status) + String(r.reward_type) +
                  String(r.reward_amount) + String(r.reward_id) +
                  String(r.wallfeed_id);
    r.hash_str = sha1(input + SALT + ACCOUNT.sessionKey);
    log('   hash_str reward: input=' + input + ' hash=' + r.hash_str);
    return r;
  },

  // AMAN apa adanya. AcademyPanel.onAmfTrainSkillResult memanggil
  // hideAmfLoading() di instruksi PERTAMA, sebelum pemeriksaan apa pun, dan
  // tidak pernah membaca `recall`. Jadi jebakan yang mengunci layar hasil misi
  // tidak berlaku di sini.
  //   result <  0  -> trainSkillFailure()
  //   result >= 0  -> sukses, klien memotong gold sendiri
  // args: [sessionKey, skillId, sequence]
  //
  // AcademyPanelUpgradeSkill.onAmfTrainSkillResult():
  //     hideAmfLoading();                       // instruksi pertama, aman
  //     if (String(status) == STATUS_ERROR) { onError(error); return; }
  //     var r:int = int(response.result);
  //     if (r < 0)  { trainSkillFailure(); return; }
  //     if (r == 0) { trainSkillSuccess(); ... }
  //
  // trainSkillSuccess() memotong gold/token di sisi KLIEN saja dan tidak
  // menambahkan skill ke dbChar.character_skills — daftar itu hanya diisi
  // ulang dari respons server saat login. Karena itu skill harus disimpan
  // di sini, atau hilang tiap kali keluar-masuk game.
  'CharacterDAO.trainSkill': (args) => {
    const c = chars.addSkill(args && args[1]);
    if (c) log('   pelajari skill: ' + args[1] + '  -> [' + c.skills.join(',') + ']');
    return { status: 1, error: null, recall: 1, result: 0 };
  },

  // Melepas skill yang sedang dilatih (UIModule_TrainTimer.amfUnlearnSkill).
  // status HARUS persis 1. onAmfUnlearnSkillResult begini:
  //     if (String(status) == "0") { Out.error(...); return; }   // tanpa hide
  //     if (String(status) == "1") {
  //         getMainChar().trainingFdSkill = null;
  //         updateProgress();
  //         Central.main.hideAmfLoading();                        // <- HANYA di sini
  //     }
  // Nilai selain "1" membuat klien keluar tanpa menurunkan lapisan pemblokir,
  // dan akademi membeku seperti layar hasil misi dulu.
  'VisitFriendService.unlearn': () => ({
    status: 1, error: null, result: 1,
  }),

  // Melatih skill milik teman. Tanpa Facebook fitur ini tidak ada isinya.
  // onPracticeFdSkill memanggil hideAmfLoading() lebih dulu tanpa syarat, jadi
  // layar tetap aman berapa pun status-nya. status -1 dipilih supaya klien
  // melewati cabang sukses — cabang itu membaca banyak field lanjutan dari
  // respons dan akan melempar #1009 kalau kita mengarangnya.
  'VisitFriendService.getLearnedSkill': () => ({
    status: -1, error: null, result: [],
  }),

  'CharacterService.selectFreeSkill': () => ({
    status: 1, error: null, result: 1,
  }),

  // --- Misi ---------------------------------------------------

  // args: [sessionKey, missionId, ?, ?, ?]
  // Klien menyimpan startBattleId lalu memulai pertarungan.
  'CharacterService.startMission': (args) => {
    battleSeq += 1;
    log('   mulai misi: ' + (args && args[1]) + '  startBattleId=' + battleSeq);
    return { status: 1, error: null, startBattleId: battleSeq };
  },

  // Dipanggil saat misi selesai (Character.updateDB).
  // args: [sessionKey, character_id, character_level, xpDidapat, goldDidapat,
  //        itemDipakai, skillId, skillLevel, ...]
  //
  // Klien menerapkan hadiah lewat field `update_inventory` di respons —
  // mekanisme universal yang diproses Main.validateAmfResponse untuk
  // SEMUA respons AMF. Nilainya ABSOLUT (total baru), bukan selisih:
  //   setGold(update_inventory.gold)  ->  dbChar.character_gold = nilai
  //   setXp(update_inventory.xp, ...) ->  dbChar.character_xp = nilai,
  //                                       lalu level dihitung ulang klien
  //                                       lewat Formula.getLvByXp()
  'CharacterService.updateCharacter': (args) => {
    const xpGain   = Number(args && args[3]) || 0;
    const goldGain = Number(args && args[4]) || 0;

    // args[8] berisi id misi yang barusan diselesaikan, mis. "msn55".
    // Tanpa ini progres misi hanya hidup di memori klien: begitu relogin
    // server mengirim character_mission kosong dan rantai misi berjenjang
    // (mis. ujian Chuunin) mengulang dari tahap pertama.
    const missionId = args && args[8];
    if (missionId) {
      const m = chars.recordMission(missionId);
      if (m) {
        log('   misi selesai: msn' + m.no +
            '  success=' + m.entry.success +
            '  (total misi tercatat: ' + m.total + ')');
        if (m.naikRank) {
          const nama = { 0:'Student', 1:'Genin', 2:'Chunin', 3:'Chunin Talented',
                         4:'Jounin', 5:'Jounin Talented', 6:'Special Jounin',
                         7:'Special Jounin Talented', 8:'Tutor', 9:'Tutor Senior' };
          log('   *** NAIK RANK: ' + (nama[m.rankLama] || m.rankLama) +
              ' -> ' + (nama[m.rank] || m.rank) + ' ***');
        }
      }
      else   log('   !! id misi tidak dikenali: ' + missionId);
    }

    // Level pet ikut dikirim di sini. Character.updateDB menyusun 20 argumen
    // (@624-730), dan dua di antaranya milik pet:
    //     args[6] = local14.id      args[7] = local14.level
    // Selama dua nilai itu diabaikan, pet naik level hanya di layar hasil
    // battle lalu kembali ke level lama begitu dimuat ulang.
    const petId = args && args[6];
    const petLv = Number(args && args[7]);
    if (petId && petLv > 0) {
      const lama = (chars.listPets() || []).find(x => String(x.id) === String(petId));
      if (lama && petLv > (Number(lama.level) || 1)) {
        // XP wajib ikut disimpan. Klien TIDAK memakai field `level` yang kita
        // kirim -- Pet menghitung ulang levelnya dari `xp` lewat
        // Formula.getPetLvByXp. Menyimpan level saja membuat pet kembali ke
        // level 1 tiap muat ulang walau characters.json sudah benar.
        const xp = chars.xpPetUntukLevel(petLv);
        chars.addPet({ id: petId, level: petLv, xp });
        log('   pet ' + petId + ' naik level: ' + lama.level + ' -> ' + petLv +
            '  (xp disetel ke ' + xp + ')');
      }
    }

    const hasil = chars.addProgress(xpGain, goldGain);
    if (!hasil) {
      log('   !! updateCharacter tapi belum ada karakter tersimpan');
      return { status: 1, error: null, maintenance: 0, reward_items: [] };
    }

    const { c, lvLama, naik } = hasil;
    log('   +' + xpGain + ' xp, +' + goldGain + ' gold  ->  ' +
        'xp=' + c.xp + ' gold=' + c.gold + ' level=' + c.level +
        (naik > 0 ? '  NAIK LEVEL dari ' + lvLama : ''));

    return {
      status: 1,
      error: null,
      maintenance: 0,
      reward_items: [],
      update_inventory: {
        xp: c.xp,
        gold: c.gold,
        token: c.token || 0,
      },
    };
  },

  // Hadiah setelah bos dikalahkan.
  //
  // Battle.getBossRewardResponse02 membaca field-field ini dari balasan, dan
  // dua di antaranya DIPAKAI SEBAGAI ARRAY TANPA PENJAGAAN:
  //
  //     @329  slot5 = res.reward       -> coerce Array
  //     @342  slot6 = res.reward_get   -> coerce Array
  //     @878  slot5.length             <- #1009 kalau slot5 null
  //
  // Field yang tidak dikirim menjadi undefined, dan `coerce Array` atas
  // undefined menghasilkan null — lalu .length pada null melempar
  //     "#1009 Cannot access a property or method of a null object reference"
  //     at Battle$/getBossRewardResponse02()
  // Jadi `reward` dan `reward_get` WAJIB berupa larik, walau kosong.
  //
  // Sisanya lebih longgar:
  //     result           dijaga null (@356); [] aman, add_favorability -> 0
  //     player_pet       hanya di-push ke petData
  //     dmg              -> Central.main.crewDamage
  //     double_reward    -> Central.main.showDoubleCrewWarReward
  //
  // extra_reward, extra_reward_get, dan pet diuji dengan Boolean() @1054-1105.
  // Sengaja dikirim null: larik kosong pun bernilai TRUE di AS3, dan itu
  // membuat klien masuk ke blok pemrosesan hadiah tambahan tanpa perlu.
  'ItemDAO.getBossReward': () => {
    // Klien hanya MENAMPILKAN isi `reward`; penyimpanannya tetap tugas server.
    // xp_ dan gold_ dilewati karena sudah diterapkan klien lewat
    // updateXP()/updateGold() di @525-617.
    for (const h of barangHadiah()) {
      try { beriHadiah(h); } catch (e) { log('   !! hadiah ' + h + ': ' + e.message); }
    }
    return balasanHadiah();
  },

  // Dipanggil layar pembuatan/pemilihan karakter.
  // args: [sessionKey, TEST_VERSION]
  //
  // Karena Data.TEST_VERSION = false, klien mengambil SKILL_DATA, ITEM_DATA,
  // WEAPON_DATA, ENEMY_DATA, BLOODLINE, dan BODY_SET dari data_library_en.swf
  // (lewat dataLib.getSkill(), dst) — jadi server TIDAK perlu mengirimnya.
  // Yang tetap dibaca dari respons hanya field di bawah ini.
  // Daftar rambut untuk Style Shop.
  //
  // Tanpa handler ini, panel Style Shop menjatuhkan:
  //     #1009 at ninjasaga::DataParser/parseHairData()
  //        <- ninjasaga.linkage.panel::StyleShop/getHairDataResponse()
  //
  // parseHairData @16-60 langsung membaca param.length untuk mengisi
  // Central.main.HAIR_DATA. Field yang tidak dikirim jadi undefined, dan
  // undefined.length melempar #1009; larik kosong sekalipun sudah aman.
  //
  // Nama field yang dibaca StyleShop.getHairDataResponse belum dipastikan
  // (kelasnya ada di swf/panels/style_shop.swf, bukan di code_library),
  // jadi daftarnya dikirim di BEBERAPA nama sekaligus. Mengirim field
  // berlebih tidak berbahaya; yang berbahaya adalah field yang dipakai
  // tapi tidak dikirim.
  'SystemData.getHairData': () => ({
    status: 1, error: null,
    result: HAIR_DATA,
    data: HAIR_DATA,
    hair: HAIR_DATA,
    hair_data: HAIR_DATA,
    hairData: HAIR_DATA,
  }),

  // Dua servis di bawah tidak menimbulkan error dengan balasan generik,
  // tapi didaftarkan supaya tidak lagi tercatat "handler BELUM ADA".
  'CharacterDAO.getSkillProfiles': () => ({
    status: 1, error: null, result: [], data: {},
  }),

  'SkillPackageLimit.getPackageStatus': () => ({
    status: 1, error: null, result: [], data: {},
  }),

  'SystemData.get': () => ({
    status: 1, error: null, result: systemDataFields(),
  }),

  // Dipanggil setelah data_library termuat.
  // args: [BUILD_NO, cls, hash, sessionKey]  — hash = SHA1(cls + SALT + sessionKey)
  // status 1 -> klien memanggil gotoSelchar() (layar pilih karakter)
  'SystemService.checkAmf': (args) => {
    if (args && args[1] != null && args[2] != null) {
      const expect = sha1(String(args[1]) + SALT + String(args[3]));
      log('   cek hash cls: klien=' + args[2] + ' hitung=' + expect +
          (expect === args[2] ? '  COCOK' : '  BEDA (diabaikan)'));
    }
    return { status: 1, error: null };
  },

  'SystemService.login': () => ({ status: 1, error: null }),
};

function dispatch(target, args) {
  const h = handlers[target];
  if (h) {
    log('   -> handler ADA');
    try {
      return h(args);
    } catch (e) {
      // Tanpa ini, exception di dalam handler membuat server DIAM: klien
      // menunggu balasan yang tidak pernah datang dan layar membeku tanpa
      // satu pun pesan error — gejala yang paling mahal untuk dilacak.
      log('   !! HANDLER ERROR: ' + (e && e.stack ? e.stack : String(e)));
      return { status: 1, error: null, result: [], data: {} };
    }
  }
  // Jaring pengaman untuk semua servis klaim paket. Callback ClaimItemResponse
  // (Anni4_ClaimCode) meneruskan res.message langsung ke showOk(), lalu
  // ConfirmationDoc.onShow menulis displayTxt.htmlText = confirmationTxt.
  // Balasan tanpa `message` berarti htmlText = null -> #2007 "Parameter text
  // must be non-null". Jadi setiap tombol paket -- termasuk yang belum pernah
  // saya lihat -- tetap harus menerima string.
  if (/^SpecialReward\.claim.*Package$/.test(target)) {
    log('   -> servis paket belum terdaftar, balas message aman');
    return { status: 1, error: null, result: [], data: {},
             message: 'Paket ini belum tersedia di server.' };
  }

  log('   -> handler BELUM ADA, balas status=1 kosong');
  return { status: 1, error: null, result: [], data: {} };
}

// ---------------------------------------------------------------
const missing = new Set();

// Folder aset. Server ada di C:\ninjasaga\server, web di C:\ninjasaga\web
const WEB_ROOT = path.resolve(__dirname, '..', 'web');

/* Header anti-cache untuk semua aset.
 *
 * Tanpa ini peramban menyimpan ninja_saga.swf selamanya (URL-nya tidak punya
 * "?_t=<timestamp>" seperti SWF lain), sehingga setiap patch bytecode pada
 * berkas itu tidak pernah sampai ke klien -- gejalanya: patch yang sudah
 * disalin ke folder web tapi log tetap menunjukkan perilaku versi lama.
 */
const TANPA_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
};

const MIME = {
  '.swf': 'application/x-shockwave-flash',
  '.xml': 'text/xml',
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};

// File inti — kalau ini sampai hilang, JANGAN dibuatkan stub.
// Stub kosong untuk file inti = layar putih tanpa pesan error apa pun.
const INTI = new Set([
  'ninja_saga', 'code_library', 'client_library', 'network_library',
  'library', 'menu', 'popup', 'en', 'data_library_en', 'facebook_connector',
  'action_base',
]);

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safe = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const full = path.join(WEB_ROOT, safe);

  // jangan biarkan keluar dari WEB_ROOT
  if (!full.startsWith(WEB_ROOT)) { res.writeHead(403); return res.end(); }

  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    const data = fs.readFileSync(full);

    // Catat ukuran SWF utama setiap kali diminta.
    //
    // ninja_saga.swf adalah SATU-SATUNYA berkas yang URL-nya tanpa pembusuk
    // cache: semua SWF lain dimuat Preloader dengan "?_t=<timestamp>",
    // sedangkan yang ini dipanggil halaman sebagai
    //     cdn.ninjasaga.cc/ninja_saga.swf?fb_uid=...   (querynya tetap)
    // Jadi tanpa header cache, peramban memakai salinan lamanya terus dan
    // patch bytecode apa pun terlihat "hilang sendiri". Baris log ini
    // memastikan versi mana yang benar-benar terkirim.
    if (path.basename(full).toLowerCase() === 'ninja_saga.swf') {
      log('   [aset] ninja_saga.swf terkirim, ' +
          data.length.toLocaleString('id-ID') + ' byte');
    }

    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
    }, TANPA_CACHE));
    return res.end(data);
  }

  // Tidak ada di disk. Kalau .swf, buatkan pengganti kosong.
  if (full.toLowerCase().endsWith('.swf')) {
    const name = path.basename(full, path.extname(full));

    if (INTI.has(name)) {
      log('\n!! FILE INTI TIDAK DITEMUKAN: ' + name + '.swf');
      log('   dicari di: ' + full);
      log('   Ini TIDAK dibuatkan stub, karena stub kosong akan');
      log('   menghasilkan layar putih tanpa penjelasan.');
      log('   Periksa letak file ini.\n');
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('file inti hilang: ' + name + '.swf\n');
    }

    if (!missing.has(name)) {
      missing.add(name);
      fs.writeFileSync(path.join(__dirname, 'aset-hilang.txt'),
                       [...missing].sort().join('\n'));
    }

    // Coba KLONING aset lain dari folder yang sama.
    //
    // SWF stub kosong tidak bisa dipakai: klien memanggil
    // applicationDomain.getDefinition(nama), yang mensyaratkan kelasnya
    // ada di bytecode ABC. Stub cuma punya entri SymbolClass, sehingga
    // Flash melempar "Variable X is not defined" saat memuatnya.
    //
    // Donor asli punya ABC lengkap, jadi cukup diganti namanya.
    // Hasilnya terlihat seperti donor, tapi tidak error.
    const swf = cloneOrStub(path.dirname(full), name);
    res.writeHead(200, Object.assign({
      'Content-Type': 'application/x-shockwave-flash',
      'Content-Length': swf.length,
    }, TANPA_CACHE));
    return res.end(swf);
  }

  log('   [404] ' + urlPath);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('tidak ditemukan: ' + urlPath + '\n');
}


// Cache donor per folder supaya tidak memindai ulang tiap permintaan.
const donorCache = new Map();

function isSwf(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(3);
    fs.readSync(fd, b, 0, 3, 0);
    fs.closeSync(fd);
    const s = b.toString();
    return s === 'FWS' || s === 'CWS' || s === 'ZWS';
  } catch { return false; }
}

/* Mencari donor yang benar-benar bisa dikloning.
 * Kandidat diurutkan dari yang terkecil, lalu dicoba satu per satu —
 * tidak semua SWF punya SymbolClass + DoABC yang dibutuhkan.
 */
// Batas pemindaian donor. Folder swf/items/ berisi ribuan file (rambut,
// senjata, body set, ikon), dan versi lama fungsi ini menyentuh SEMUANYA:
//
//     .filter(isSwf)                                    // buka & baca tiap file
//     .sort((a,b) => fs.statSync(a).size - fs.statSync(b).size)
//
// `sort` memanggil statSync DUA KALI per perbandingan, jadi jumlah panggilan
// sinkron tumbuh seperti n log n. Semuanya di thread tunggal Node, sehingga
// event loop terkunci dan permintaan HTTP yang sedang berjalan tidak pernah
// dijawab — klien melihat "http=-1 STALL=no-open" dan menunggu selamanya.
//
// Sekarang: nama file dulu (murah), stat SEKALI per kandidat, baru buka
// beberapa yang terkecil.
const MAKS_PINDAI = 200;   // nama file yang dipertimbangkan per folder
const MAKS_COBA   = 8;     // file yang benar-benar dibuka sebagai calon donor

function findDonor(dir) {
  if (donorCache.has(dir)) return donorCache.get(dir);

  const t0 = Date.now();
  const cari = [dir, path.join(WEB_ROOT, 'cdn', 'swf', 'latest', 'swf', 'items')];
  let hasil = null;

  for (const d of cari) {
    if (!fs.existsSync(d)) continue;

    const nama = fs.readdirSync(d)
      .filter(x => x.toLowerCase().endsWith('.swf'))
      .slice(0, MAKS_PINDAI);

    // satu statSync per kandidat, ukurannya disimpan — bukan dihitung ulang
    // di dalam pembanding sort.
    const terukur = [];
    for (const x of nama) {
      const p = path.join(d, x);
      try { terukur.push({ p, size: fs.statSync(p).size }); } catch { /* lewati */ }
    }
    terukur.sort((a, b) => a.size - b.size);

    for (const { p } of terukur.slice(0, MAKS_COBA)) {
      try {
        if (!isSwf(p)) continue;
        cloneFrom(fs.readFileSync(p), 'uji_donor_x', path.basename(p, '.swf'));
        hasil = p;
        break;
      } catch { /* donor ini tidak cocok, coba berikutnya */ }
    }
    if (hasil) break;
  }

  const ms = Date.now() - t0;
  if (ms > 200) log('   [donor] pemindaian ' + dir + ' makan ' + ms + 'ms');

  donorCache.set(dir, hasil);
  return hasil;
}

function cloneOrStub(dir, name) {
  const donor = findDonor(dir);
  if (donor) {
    try {
      // nama berkas donor ikut dikirim supaya cloneFrom bisa memilih simbol
      // yang benar (kelas utama aset senama dengan berkasnya) dan menyamakan
      // pola huruf besar/kecilnya
      const swf = cloneFrom(fs.readFileSync(donor), name, path.basename(donor, '.swf'));
      log('   [klon] ' + name + '  <- ' + path.basename(donor));
      return swf;
    } catch (e) {
      log('   [klon gagal] ' + name + ' : ' + e.message);
    }
  }
  log('   [stub kosong] ' + name + '  (tidak ada donor cocok di ' + dir + ')');
  return buildStub(name);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') return serveStatic(req, res);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
   // Seluruh pemrosesan dibungkus supaya server TIDAK PERNAH diam.
   // decodePacket sudah punya penjaga sendiri, tapi log(), encodePacket(),
   // dan penulisan respons belum. Kalau salah satunya melempar, koneksi
   // menggantung tanpa jawaban: klien menunggu sampai timeout dan layarnya
   // membeku tanpa satu pun pesan error. Itu mode kegagalan yang paling
   // mahal untuk dilacak, jadi lebih baik membalas 500 daripada bisu.
   try {
    const buf = Buffer.concat(chunks);
    let pkt;
    try { pkt = decodePacket(buf); }
    catch (e) {
      log('\n!! GAGAL DECODE:', e.message);
      log('   hex:', buf.slice(0, 64).toString('hex'));
      res.writeHead(500); return res.end();
    }

    const out = [];
    let amf3 = false;
    for (const b of pkt.bodies) {
      amf3 = amf3 || b.amf3;
      log('\n======================================');
      log('AMF ->', b.target, '  (responseURI=' + b.response + ', amf3=' + b.amf3 + ')');
      log('   argumen:', b.data);
      const result = dispatch(b.target, b.data);
      log('   balasan:', result);
      out.push({ target: (b.response || '/1') + '/onResult', response: '', data: result });
    }
    const body = encodePacket(out, amf3);
    res.writeHead(200, { 'Content-Type': 'application/x-amf', 'Content-Length': body.length });
    res.end(body);
   } catch (e) {
    console.log('!! ERROR MEMPROSES AMF: ' + (e && e.stack ? e.stack : String(e)));
    try {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('error\n');
    } catch { /* koneksi sudah tertutup */ }
   }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log('\n\n### Server jalan di http://127.0.0.1:' + PORT + ' — ' + new Date().toLocaleString());
  log('### folder aset : ' + WEB_ROOT);

  if (!fs.existsSync(WEB_ROOT)) {
    log('\n!! FOLDER ASET TIDAK DITEMUKAN.');
    log('   Server berhenti, karena kalau diteruskan SEMUA file akan');
    log('   dijawab stub kosong dan hasilnya cuma layar putih.');
    log('   Struktur yang diharapkan:');
    log('      C:\\ninjasaga\\server\\index.js   (file ini)');
    log('      C:\\ninjasaga\\web\\ninja_saga.swf');
    process.exit(1);
  }

  const cek = path.join(WEB_ROOT, 'ninja_saga.swf');
  log('### ninja_saga.swf : ' + (fs.existsSync(cek) ? 'ADA' : 'TIDAK ADA di ' + cek));
  log('### signature login = ' + signAccount(ACCOUNT));
  log('### ninja emblem = ' + (ACCOUNT.type === 2 ? 'AKTIF (premium)' : 'mati (biasa)'));
});
