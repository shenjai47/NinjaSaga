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
    const c = chars.firstCharacter();
    if (!c) return { status: 1, error: null, result: null };
    log('   karakter dipilih: ' + c.name + ' lv' + c.level);
    return { status: 1, error: null, result: chars.rawCharacter(c, args && args[0]) };
  },

  // Mengirim seluruh rekaman karakter. parseCharacterData membaca 200+ field;
  // yang diakses berantai wajib berupa objek/array (lihat chardata.js).
  'CharacterDAO.getExtraData': () => {
    const c = chars.firstCharacter();
    if (!c) {
      log('   !! getExtraData dipanggil tapi belum ada karakter tersimpan');
      return { status: 1, error: null, result: null };
    }
    const data = chars.buildExtraData(c);

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

  'EudemonGarden.getHuntingStatus': () => ({
    status: 1, error: null,
    result: { room: [] },
  }),

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
  // status dipilih -1, bukan 0 atau 1:
  //   '0' = AMFData.STATUS_ERROR -> validateAmfResponse memunculkan dialog error
  //   1   -> lolos ke pemeriksaan hash_str, lalu ke Central.sns.publishFeedById()
  //          (posting Facebook — tidak tersedia di server pribadi)
  //   -1  -> String(-1) != '0' sehingga validateAmfResponse lolos, tapi
  //          int(-1) > 0 bernilai false sehingga klien berhenti dengan tenang.
  'FriendReward.getFriendReward': () => ({
    status: -1, error: null,
    reward_type: 0, reward_amount: 0, reward_id: 0, wallfeed_id: 0,
  }),

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

  'ItemDAO.getBossReward': () => ({
    status: 1, error: null, result: [], reward_items: [],
  }),

  // Dipanggil layar pembuatan/pemilihan karakter.
  // args: [sessionKey, TEST_VERSION]
  //
  // Karena Data.TEST_VERSION = false, klien mengambil SKILL_DATA, ITEM_DATA,
  // WEAPON_DATA, ENEMY_DATA, BLOODLINE, dan BODY_SET dari data_library_en.swf
  // (lewat dataLib.getSkill(), dst) — jadi server TIDAK perlu mengirimnya.
  // Yang tetap dibaca dari respons hanya field di bawah ini.
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
  log('   -> handler BELUM ADA, balas status=1 kosong');
  return { status: 1, error: null, result: [], data: {} };
}

// ---------------------------------------------------------------
const missing = new Set();

// Folder aset. Server ada di C:\ninjasaga\server, web di C:\ninjasaga\web
const WEB_ROOT = path.resolve(__dirname, '..', 'web');

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
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
    });
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
    res.writeHead(200, {
      'Content-Type': 'application/x-shockwave-flash',
      'Content-Length': swf.length,
    });
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
        cloneFrom(fs.readFileSync(p), 'uji_donor_x');
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
      const swf = cloneFrom(fs.readFileSync(donor), name);
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
