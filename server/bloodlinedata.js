/* Peta skill bloodline -> bloodline_id, ditarik dari SystemDataEN::cinit
 * (BLOODLINE_SKILL_DATA) di data_library_en.swf.
 *
 * CharacterBase.getBloodlineListArr (code_library method 723) menyaring tiap
 * entri dbChar.bloodline dengan DUA syarat yang harus dipenuhi entri YANG SAMA:
 *     @62-84    BLOODLINE_SKILL_DATA['bloodline_skill' + e.skill_id]  ada
 *     @94-114   BLOODLINE_DATA['bloodline' + e.bloodline_id]          ada
 * Jadi satu entri wajib membawa skill_id DAN bloodline_id sekaligus. Entri yang
 * hanya punya salah satunya (mis. hasil discoverBloodline yang skill_id-nya
 * kosong) selalu dibuang.
 *
 * type: 1 = aktif (bisa jadi tombol), 0 = pasif.
 */
const BLOODLINE_SKILL = {
  '1000': { bloodline_id: '8', type: 1 },  // Secret Enraged Forest: Smothering Bind
  '1001': { bloodline_id: '8', type: 1 },  // Secret Enraged Forest: Matsuri
  '1002': { bloodline_id: '6', type: 1 },  // Secret Lava: Lava Shield
  '1003': { bloodline_id: '6', type: 1 },  // Secret Lava: Lava Spirits
  '1004': { bloodline_id: '3', type: 0 },  // Meridian Kekkai
  '1005': { bloodline_id: '3', type: 1 },  // Acupuncture: Meridian Anesthesia
  '1006': { bloodline_id: '3', type: 1 },  // Acupuncture: Meridians Destruction
  '1007': { bloodline_id: '2', type: 1 },  // Soul Punch
  '1008': { bloodline_id: '2', type: 1 },  // Eight Extremities Fist
  '1009': { bloodline_id: '2', type: 1 },  // Extreme Mode
  '1010': { bloodline_id: '2', type: 1 },  // Ultimate Dance
  '1011': { bloodline_id: '7', type: 1 },  // Secret Silhouette: Strangle
  '1012': { bloodline_id: '7', type: 1 },  // Secret Silhouette: Extinguish
  '1013': { bloodline_id: '5', type: 1 },  // Demon Song: Phantom Wave
  '1014': { bloodline_id: '5', type: 1 },  // Demon Song: Song of Fantasia
  '1015': { bloodline_id: '4', type: 1 },  // Onmyouji: Wondrous Doors
  '1016': { bloodline_id: '4', type: 1 },  // Samurai: One Sword
  '1017': { bloodline_id: '4', type: 1 },  // Burial of Dead Bone
  '1018': { bloodline_id: '4', type: 1 },  // Divine Wind of Onmyousamurai
  '1019': { bloodline_id: '1', type: 1 },  // Mirror of Passion
  '1020': { bloodline_id: '1', type: 1 },  // Mirror of Grace
  '1021': { bloodline_id: '1', type: 1 },  // Mirror of Strength
  '1022': { bloodline_id: '1', type: 0 },  // Mirror of Freedom
  '1023': { bloodline_id: '1', type: 0 },  // Eye of Mirror
  '1024': { bloodline_id: '1', type: 0 },  // Crescent Eye of Mirror
  '1025': { bloodline_id: '2', type: 0 },  // Eight Extremities
  '1026': { bloodline_id: '2', type: 0 },  // Eight Extremities Strengthen
  '1027': { bloodline_id: '3', type: 0 },  // Dark Eye
  '1028': { bloodline_id: '3', type: 0 },  // Meridian Search
  '1029': { bloodline_id: '3', type: 0 },  // Meridian Strengthen
  '1030': { bloodline_id: '4', type: 0 },  // Soul of Onmyouji
  '1031': { bloodline_id: '4', type: 0 },  // Soul of Samurai
  '1032': { bloodline_id: '5', type: 0 },  // Demon Song
  '1033': { bloodline_id: '6', type: 0 },  // Explosive Lava
  '1034': { bloodline_id: '7', type: 0 },  // Silhouette Capture
  '1035': { bloodline_id: '8', type: 0 },  // Nature Power
  '1036': { bloodline_id: '9', type: 0 },  // Absolute Zero Zone
  '1037': { bloodline_id: '9', type: 1 },  // Secret Icy Crystal: Hakukage Horo
  '1038': { bloodline_id: '9', type: 1 },  // Secret Icy Crystal: Icy Kaleidoscope
  '1040': { bloodline_id: '3', type: 1 },  // Acupuncture: Needle Barrage
  '1041': { bloodline_id: '10', type: 0 },  // Saint Soul
  '1042': { bloodline_id: '10', type: 0 },  // Saint Physique
  '1043': { bloodline_id: '10', type: 1 },  // Saint Fist
  '1044': { bloodline_id: '10', type: 1 },  // Saint Light
  '1045': { bloodline_id: '10', type: 1 },  // Saint Blessing
  '1046': { bloodline_id: '10', type: 0 },  // Unyielding Saint
  '1047': { bloodline_id: '11', type: 0 },  // Beetle Carapace
  '1048': { bloodline_id: '11', type: 0 },  // Primal Evolution
  '1049': { bloodline_id: '11', type: 1 },  // Pestilence
  '1050': { bloodline_id: '11', type: 0 },  // Medial Evolution
  '1051': { bloodline_id: '11', type: 0 },  // Ultimate Evolution
  '1052': { bloodline_id: '11', type: 1 },  // Holocaust
  '1053': { bloodline_id: '12', type: 0 },  // 1053
  '1054': { bloodline_id: '12', type: 0 },  // 1054
  '1055': { bloodline_id: '12', type: 0 },  // 1055
  '1056': { bloodline_id: '12', type: 0 },  // 1056
};

module.exports = { BLOODLINE_SKILL };
