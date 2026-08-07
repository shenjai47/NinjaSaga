'use strict';
/*
 * ntclassselect.js
 * Handler untuk AMF  CharacterDAO.NTClassSelect  (Lv80 Sennin Exam / graduasi).
 *
 * KENAPA PERLU
 *   SenninExamPanel.confirmClaimReward() membaca response.character_reward:
 *       rewardStatus = int(response.character_reward);
 *       ... rewardList[rewardStatus - 1].length ...
 *   Kalau field itu tidak ada -> int(undefined) = 0 -> rewardList[-1] = undefined
 *   -> TypeError #1010. Server harus mengirim character_reward = 1, 2, atau 3.
 *
 * TIER REWARD (dari constructor SenninExamPanel di Panel_lv80exam_battle.swf)
 *   1 -> back430, skill3500                                  rank 8
 *   2 -> back430, skill3500, wpn988, bodyset easy            rank 8
 *   3 -> back430, skill3500, wpn988, bodyset hard            rank 9
 *   Semua tier juga menambah senjutsu skill_id 3000 level 1.
 *
 *   rewardBodyset[gender]:  gender 0 -> [set1786(easy), set1788(hard)]
 *                           gender 1 -> [set1787(easy), set1789(hard)]
 *
 * CARA PAKAI  (lihat catatan integrasi di bawah file ini)
 */

// ---------------------------------------------------------------- konfigurasi
const REWARD_TIER = 3;      // 1 | 2 | 3   -> 3 = graduasi penuh (rank 9)
const GRANT_ITEMS = true;   // true = ikut menaruh item ke inventory server

// -------------------------------------------------------------------- konstan
const RANK_BY_TIER = { 1: 8, 2: 8, 3: 9 };

const BODYSET = {
  0: { 2: 'set1786', 3: 'set1788' },   // gender 0
  1: { 2: 'set1787', 3: 'set1789' },   // gender 1
};

/** Daftar item yang klien tambahkan sendiri untuk tier tertentu. */
function rewardItemsFor(tier, gender) {
  const items = ['back430'];
  if (tier >= 2) {
    items.push('wpn988');
    const g = BODYSET[Number(gender) === 1 ? 1 : 0];
    if (g[tier]) items.push(g[tier]);
  }
  return items;
}

/** Senjutsu yang ditambahkan klien: skill3500 (dari rewardList) + 3000 (selalu). */
function rewardSenjutsuFor(tier) {
  return [
    { senjutsu_id: '1', level: '1', skill_id: '3500' },
    { senjutsu_id: '1', level: '1', skill_id: '3000' },
  ];
}

// -------------------------------------------------------------------- handler
/**
 * @param {Array}  args  argumen AMF: [ sessionKey ]
 * @param {Object} deps  { getCharacter, saveCharacter, addItem, addSenjutsu }
 *                       semuanya opsional; kalau tidak ada, handler tetap
 *                       mengembalikan response yang benar tanpa persist.
 */
function ntClassSelect(args, deps) {
  deps = deps || {};
  const sessionKey = Array.isArray(args) ? args[0] : args;

  const tier = RANK_BY_TIER[REWARD_TIER] ? REWARD_TIER : 3;
  const rank = RANK_BY_TIER[tier];

  let char = null;
  try {
    if (typeof deps.getCharacter === 'function') char = deps.getCharacter(sessionKey);
  } catch (e) {
    console.error('[NTClassSelect] getCharacter gagal:', e.message);
  }

  if (char) {
    const gender = (char.gender != null) ? char.gender
                 : (char.character_gender != null) ? char.character_gender : 0;

    // rank: klien memanggil updateData(RANK, n) hanya di memori,
    // jadi tanpa baris ini rank balik lagi setelah reload.
    char.rank = rank;
    if ('character_rank' in char) char.character_rank = rank;

    if (GRANT_ITEMS) {
      try {
        if (typeof deps.addItem === 'function') {
          rewardItemsFor(tier, gender).forEach(function (id) { deps.addItem(char, id); });
        }
        if (typeof deps.addSenjutsu === 'function') {
          rewardSenjutsuFor(tier).forEach(function (s) { deps.addSenjutsu(char, s); });
        }
      } catch (e) {
        console.error('[NTClassSelect] gagal menaruh reward:', e.message);
      }
    }

    try {
      if (typeof deps.saveCharacter === 'function') deps.saveCharacter(char);
    } catch (e) {
      console.error('[NTClassSelect] saveCharacter gagal:', e.message);
    }

    console.log('[NTClassSelect] tier=%d rank=%d gender=%s items=%j',
      tier, rank, gender, rewardItemsFor(tier, gender));
  } else {
    console.log('[NTClassSelect] tier=%d (karakter tidak ditemukan, tanpa persist)', tier);
  }

  // Satu-satunya field yang WAJIB dibaca klien:
  return {
    status: 1,
    error: null,
    character_reward: tier,
  };
}

/** Pakai ini kalau mau MENOLAK claim. Jangan balas character_reward = 0. */
function ntClassSelectDenied(message) {
  return { status: 0, error: message || 'not eligible' };
}

module.exports = {
  ntClassSelect,
  ntClassSelectDenied,
  REWARD_TIER,
  rewardItemsFor,
  rewardSenjutsuFor,
};

/* ---------------------------------------------------------------------------
 * INTEGRASI di index.js
 *
 *   const { ntClassSelect } = require('./ntclassselect');
 *
 *   // di tempat kamu mendaftarkan handler AMF:
 *   handlers['CharacterDAO.NTClassSelect'] = function (args) {
 *     return ntClassSelect(args, {
 *       getCharacter : getCharacter,    // ganti dengan helper chardata.js kamu
 *       saveCharacter: saveCharacter,
 *       addItem      : addItem,         // boleh dihilangkan kalau belum ada
 *       addSenjutsu  : addSenjutsu,     // boleh dihilangkan
 *     });
 *   };
 *
 * Kalau helper-nya belum ada, panggil tanpa deps saja:
 *   handlers['CharacterDAO.NTClassSelect'] = (args) => ntClassSelect(args);
 * Panel akan jalan normal, cuma reward-nya tidak permanen.
 * ------------------------------------------------------------------------- */
