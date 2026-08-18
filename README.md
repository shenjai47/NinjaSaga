# Ninja Saga — Private Server

Server lokal untuk menjalankan Ninja Saga (game Flash yang sudah ditutup) di komputer
sendiri. Terdiri dari gateway AMF berbasis Node.js, penyaji aset statis, dan sejumlah
patch bytecode pada SWF klien.

Semua respons server direkonstruksi dengan membongkar bytecode AS3 milik klien — bukan
menebak. Sebagian besar catatan di dalam kode menyertakan offset bytecode-nya supaya bisa
diverifikasi ulang.

> **Catatan hukum.** Repositori ini **tidak** memuat aset game. Ninja Saga adalah karya
> Emagist Entertainment Limited. Yang ada di sini hanya kode server dan alat bantu buatan
> sendiri. Kamu harus menyediakan berkas SWF-mu sendiri. Proyek ini untuk keperluan belajar
> dan pelestarian pribadi, dijalankan offline di `127.0.0.1`.

---

## Daftar isi

1. [Cara kerjanya](#cara-kerjanya)
2. [Prasyarat](#prasyarat)
3. [Langkah 1 — Pasang Node.js](#langkah-1--pasang-nodejs)
4. [Langkah 2 — Pasang Caddy](#langkah-2--pasang-caddy)
5. [Langkah 3 — Arahkan domain lewat hosts](#langkah-3--arahkan-domain-lewat-hosts)
6. [Langkah 4 — Susun struktur folder](#langkah-4--susun-struktur-folder)
7. [Langkah 5 — Konfigurasi Caddy](#langkah-5--konfigurasi-caddy)
8. [Langkah 6 — Jalankan server](#langkah-6--jalankan-server)
9. [Langkah 7 — Buka game](#langkah-7--buka-game)
10. [Konfigurasi server](#konfigurasi-server)
11. [Alat bantu aset SWF](#alat-bantu-aset-swf)
12. [Patch SWF yang diterapkan](#patch-swf-yang-diterapkan)
13. [Data karakter](#data-karakter)
14. [Pemecahan masalah](#pemecahan-masalah)
15. [Catatan pengembangan](#catatan-pengembangan)

---

## Cara kerjanya

Klien Flash meminta tiga domain. Semuanya diarahkan ke komputer sendiri lewat berkas
`hosts`, lalu Caddy menerima HTTPS dan meneruskannya ke Node.

```
                  hosts: 127.0.0.1
Flash Player  ────────────────────────►  Caddy  :443 (HTTPS)
  ninjasaga.cc                             │
  cdn.ninjasaga.cc                         │  reverse_proxy
  amf.ninjasaga.cc                         ▼
                                     Node.js :8080
                                       ├── POST  → gateway AMF
                                       └── GET   → aset statis dari ../web
```

Pembagian tugas di dalam Node sesederhana ini:

| permintaan | ditangani |
|---|---|
| `POST` apa pun | dibaca sebagai paket AMF, diarahkan ke tabel handler |
| selain `POST` | disajikan sebagai berkas dari folder `web/` |

Kalau sebuah SWF diminta tapi tidak ada di disk, server tidak membalas 404 — ia mencoba
**mengkloning** SWF lain sebagai donor dan mengganti nama kelasnya, atau membuat stub kosong.
Ini yang membuat game tetap berjalan meski koleksi asetmu tidak lengkap.

---

## Prasyarat

| kebutuhan | keterangan |
|---|---|
| Windows 10/11 | panduan ini memakai path Windows; Linux/macOS jalan dengan penyesuaian path |
| Node.js 18+ | menjalankan server |
| Caddy 2 | HTTPS lokal dan reverse proxy |
| Pemutar Flash | Flash Player Projector, atau peramban dengan Flash (mis. Basilisk, Waterfox Classic, Pale Moon) |
| Aset Ninja Saga | `ninja_saga.swf` beserta folder `cdn/swf/latest/...` |
| Hak Administrator | untuk mengedit `hosts` dan memasang sertifikat lokal Caddy |

Sangat disarankan memakai **Flash Player versi debug** (`flashplayer_..._sa_debug.exe`).
Tanpa itu tidak ada `flashlog.txt`, dan hampir semua bug di proyek ini hanya bisa dilacak
dari log tersebut.

---

## Langkah 1 — Pasang Node.js

1. Unduh Node.js LTS dari <https://nodejs.org>
2. Pasang dengan opsi bawaan
3. Verifikasi lewat Command Prompt:

```cmd
node --version
npm --version
```

Server ini **tidak memakai dependensi eksternal sama sekali** — hanya modul bawaan Node
(`http`, `crypto`, `fs`, `path`, `zlib`). Jadi tidak ada `npm install` yang perlu dijalankan.

---

## Langkah 2 — Pasang Caddy

Cara termudah lewat winget:

```cmd
winget install CaddyServer.Caddy
```

Atau unduh manual dari <https://caddyserver.com/download> (pilih Windows amd64), lalu
letakkan `caddy.exe` di folder proyek.

Verifikasi:

```cmd
caddy version
```

**Kenapa perlu Caddy?** Klien Ninja Saga meminta `https://`. Caddy menerbitkan sertifikat
lokal sendiri (`tls internal`) dan memasang CA-nya ke Windows Certificate Store saat pertama
kali dijalankan sebagai Administrator. Tanpa itu, Flash menolak koneksinya.

---

## Langkah 3 — Arahkan domain lewat hosts

Buka Notepad **sebagai Administrator**, lalu edit:

```
C:\Windows\System32\drivers\etc\hosts
```

Tambahkan:

```
127.0.0.1    ninjasaga.cc
127.0.0.1    cdn.ninjasaga.cc
127.0.0.1    amf.ninjasaga.cc
```

Simpan, lalu bersihkan cache DNS:

```cmd
ipconfig /flushdns
```

Uji:

```cmd
ping cdn.ninjasaga.cc
```

Harus menjawab dari `127.0.0.1`.

---

## Langkah 4 — Susun struktur folder

```
C:\ninjasaga\
├── server\
│   ├── index.js              gateway AMF + penyaji aset
│   ├── amf.js                encoder/decoder AMF0/AMF3
│   ├── chardata.js           status karakter + penyusun respons
│   ├── petdata.js            tabel pet
│   ├── bloodlinedata.js      peta skill bloodline → bloodline_id
│   ├── harga.js              tabel harga barang
│   ├── stub.js               pembuat SWF stub kosong
│   ├── assetclone.js         pengklon SWF (ganti nama kelas)
│   ├── periksa-aset.js       pemindai aset rusak
│   ├── characters.json       dibuat otomatis saat pertama jalan
│   └── amf-log.txt           dibuat otomatis
│
├── web\                      ← folder aset, WAJIB bernama "web"
│   ├── ninja_saga.swf
│   └── cdn\swf\latest\swf\
│       ├── library\          code_library.swf, client_library.swf, ...
│       ├── language\         en.swf, data_library_en.swf
│       ├── panels\           popup_*.swf
│       ├── skills\           skill_*.swf
│       ├── items\            set_*.swf, wpn_*.swf, hair_*.swf, back_*.swf
│       ├── npc\  enemies\  mission\  pets\  icons\  actions\  sound\  sns\
│       └── ...
│
└── Caddyfile
```

Nama folder `web` dan `server` **tidak boleh diubah** — `index.js` menghitung lokasi aset
dengan `path.resolve(__dirname, '..', 'web')`. Kalau folder `web` tidak ditemukan, server
sengaja berhenti daripada melanjutkan dan menghasilkan layar putih.

Nama folder `latest` juga terikat: klien memakai nilai versi aset langsung sebagai nama
folder pada path `cdn/swf/<versi>/swf/<kategori>/<nama>.swf`, dan server mengirim `latest`
untuk semua kategori.

---

## Langkah 5 — Konfigurasi Caddy

Buat berkas bernama `Caddyfile` (tanpa ekstensi) di `C:\ninjasaga\`:

```caddyfile
{
	# sertifikat lokal, bukan Let's Encrypt
	local_certs
}

ninjasaga.cc, cdn.ninjasaga.cc, amf.ninjasaga.cc {
	tls internal

	reverse_proxy 127.0.0.1:8080 {
		# klien memakai header Host untuk membedakan domain
		header_up Host {host}
	}

	encode gzip
}
```

Jalankan Caddy **sebagai Administrator** (perlu untuk mengikat port 443 dan memasang CA):

```cmd
cd C:\ninjasaga
caddy run
```

Saat pertama kali, Caddy meminta izin memasang sertifikat root-nya. **Setujui** — kalau
ditolak, Flash akan menolak semua koneksi HTTPS-nya.

Verifikasi CA sudah terpasang:

```cmd
certutil -store Root | findstr /i caddy
```

---

## Langkah 6 — Jalankan server

Di jendela Command Prompt terpisah:

```cmd
cd C:\ninjasaga\server
node index.js
```

Keluaran yang benar terlihat seperti ini (juga tertulis ke `amf-log.txt`):

```
### Server jalan di http://127.0.0.1:8080 — 17/08/2026, 15.16.46
### folder aset : C:\ninjasaga\web
### ninja_saga.swf : ADA
### signature login = 401dfceb24aac074a62bf9b2fa6c10da4da3a728
### ninja emblem = AKTIF (premium)
```

Kalau tertulis `FOLDER ASET TIDAK DITEMUKAN`, periksa lagi struktur folder di Langkah 4.

---

## Langkah 7 — Buka game

Buka alamat ini di pemutar Flash:

```
https://cdn.ninjasaga.cc/ninja_saga.swf?fb_uid=1%26fb_name=Player%26time=0&nocache=1
```

Bagian `fb_uid` dibaca klien sebagai satu parameter yang isinya digabung dengan `%26`
(tanda `&` yang dikodekan). Ganti `1` dan `Player` sesuka hati.

### Kenapa ada `&nocache=1`

`ninja_saga.swf` adalah **satu-satunya** SWF yang URL-nya tidak punya pembusuk cache. Semua
SWF lain dimuat oleh `Preloader` dengan `?_t=<timestamp>`, sedangkan yang ini dipanggil
langsung dengan query tetap. Akibatnya peramban menyimpannya tanpa batas, dan setiap patch
bytecode terlihat "tidak berpengaruh".

Server sudah mengirim header anti-cache:

```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: 0
```

tapi itu hanya berlaku untuk permintaan **berikutnya**. Entri yang sudah terlanjur tersimpan
tidak tersentuh. Karena itu, naikkan angka `nocache` setiap kali kamu mengganti
`ninja_saga.swf`.

Untuk memastikan versi mana yang benar-benar terkirim, lihat `amf-log.txt`:

```
[aset] ninja_saga.swf terkirim, 2.870.608 byte
```

---

## Konfigurasi server

Semua tombol pengaturan ada di bagian atas `index.js`:

| konstanta | arti |
|---|---|
| `PORT` | port Node, bawaannya `8080` (harus cocok dengan `reverse_proxy` di Caddyfile) |
| `SALT` | garam SHA-1 untuk tanda tangan login, diambil dari slot `ClientLibrary._s` |
| `IS_NEW_ACCOUNT` | `1` = klien masuk ke layar pembuatan karakter |
| `EMBLEM` | `true` = Ninja Emblem (premium). `Account` di `network_library.swf`: `FREE = 1`, `PREMIUM = 2` |
| `ACCOUNT` | id, tipe, saldo token, dan session key |
| `SWF_VERSIONS` | pemetaan kategori aset → nama folder versi (semuanya `latest`) |

Rantai verifikasi login yang direkonstruksi dari `client_library.swf`:

```
Account.setupAccount(result, signature)
  result = [ account_id, account_type, account_balance, session_key ]
  cek    : signature == SHA1( id + "|" + type + "|" + balance + SALT + session_key )
  lolos  : account_id > 0
```

Tabel hadiah paket ulang tahun juga bisa diubah di `index.js`:

```js
const PAKET_AGUSTUS = {
  0: ['set_2248', 'wpn_1343', 'hair_683', 'back_557', 'skill_719', 'pet_71'],
  1: ['set_2249', 'wpn_1343', 'hair_684', 'back_557', 'skill_719', 'pet_71'],
};
```

Kunci `0` dan `1` adalah jenis kelamin karakter. Baju dan rambut punya versi berbeda per
jenis kelamin; senjata, tas, skill, dan pet dipakai bersama.

---

## Alat bantu aset SWF

### `assetclone.js` — mengisi aset yang hilang

Kalau klien meminta SWF yang tidak ada, server mengkloning SWF lain dan mengganti nama
kelasnya. Ini perlu karena klien memanggil `applicationDomain.getDefinition(nama)`, yang
menuntut kelasnya benar-benar ada di bytecode — stub kosong tidak cukup.

Yang perlu diketahui: SymbolClass sebuah aset skill berisi **dua** simbol, dan urutannya
menjebak.

```
id=109  icon          ← kebetulan yang PERTAMA
id=100  Skill_3110    ← kelas utama, ini yang dicari getAsset()
```

Pemilihan simbol karena itu dibatasi ke kandidat berhuruf besar. Kalau tidak, `icon` yang
terpilih, dan karena diawali huruf kecil, penyeragaman kapital tidak jalan — hasilnya kelas
bernama `skill_3109` padahal klien meminta `Skill_3109`.

### `periksa-aset.js` — memindai aset rusak

```cmd
node periksa-aset.js "C:\ninjasaga\web\cdn\swf\latest\swf\skills"
node periksa-aset.js "C:\ninjasaga\web\cdn\swf\latest\swf\skills" --hapus
```

Tanpa `--hapus` skrip hanya melaporkan. Berkas yang dihapus akan dikloning ulang otomatis
saat diminta lagi.

> **Backup dulu sebelum `--hapus`.** Dan perhatikan: pemindai ini hanya memeriksa berkas
> berawalan `skill_`, `npc_`, `back_`, `set_`, `item_`, `hair_`, `acsy_`, `wpn_`, `pet_`,
> `icon_`. Berkas pustaka seperti `code_library.swf` sengaja dilewati, karena kelasnya
> CamelCase ber-namespace (`ninjasaga.linkage.CodeLibrary`) dan akan salah ditandai rusak.

---

## Patch SWF yang diterapkan

Semua patch mengubah byte **di tempat** tanpa mengubah panjang metode, sehingga tidak ada
offset lain yang bergeser.

### `ninja_saga.swf` — `BattleActionBar.initButtons`

```
@875: pushbyte  0
@877: ifngt     50  (-> 931)      asli
@877: ifngt     462 (-> 1343)     patch
```

Pemeriksaan `senjutsuSageMode.length > 0` pada aslinya hanya menjaga dua baris debug, lalu
jatuh terus ke `@931`. Di `@1049` kode membaca `senjutsuSageMode[0].level` tanpa penjagaan,
sehingga siapa pun yang punya senjutsu tapi belum punya skill Sage Mode (3000) pasti kena
`#1010` dan bar aksi gagal digambar.

Patch mengalihkan cabang itu ke `@1343`. Blok yang dilewati (`@931`–`@1339`) hanya menyiapkan
tombol Sennin Mode; tombol senjutsu biasa dibangun di tempat lain, jadi tidak ikut hilang.

Ukuran: **2.870.608** byte (asli 2.871.752).

### `code_library.swf` — tiga metode

| metode | jadi | alasan |
|---|---|---|
| `Mission._msk` | `jump -> 26`, lalu `pushstring ''` | melewati `_msc`, yang tidak ada di `ninja_saga.swf` |
| `Battle.godModeHackCheck` | `pushfalse; returnvalue` | menyamai build lama |
| `Character.validateSkill` | `returnvoid` | menyamai build lama |

`_msk` aman dikosongkan karena hasilnya hanya dipakai sebagai parameter
`CharacterService.startMission` — servis yang dilayani server sendiri dan tidak diverifikasi.
Jalur "kembalikan `''`" bahkan sudah ada di kode aslinya (`@26-28`) untuk kasus argumen kosong.

Hanya 3 dari 3561 metode yang berubah. Ukuran: **444.407** byte.

### `popup_4th_claim_code_p8.swf` — `updateRewardPanel`

Instruksi pertama diubah jadi `returnvoid`. Metode itu hanya menggambar ikon dan tooltip,
tapi melempar `#1010` di tengah animasi tampil sehingga animasi keluar tidak pernah jalan
dan panel kode tertutup panel di atasnya.

Konsekuensinya ikon hadiah tidak dirender. `initButton` untuk tombol claim tetap jalan
karena dipanggil **sebelum** metode ini (`@99-124` vs `@128`).

---

## Data karakter

Semua progres tersimpan di `server/characters.json`. Berkas ini dibuat otomatis; hapus saja
kalau ingin mulai dari nol.

```json
{
  "1": {
    "character_id": 1,
    "name": "Shen",
    "level": 80,
    "xp": 55735935,
    "gold": 887506613,
    "token": 900,
    "gender": 0,
    "elements": [1, 0, 0, 0, 0],
    "skills": [],
    "items": [],
    "weapons": [],
    "bodysets": [],
    "hairs": [],
    "backitems": [],
    "accessories": [],
    "pets": [],
    "bloodline": [],
    "senjutsu": [],
    "senjutsuSystem": 3,
    "bloodlinePoint": 0,
    "missions": {},
    "equip": {}
  }
}
```

Kantong barang menyimpan **nomornya saja**: `weapons: ["1498"]`, bukan `"wpn_1498"`.

`senjutsuSystem` hanya boleh `2` (Toad) atau `3` (Snake). Nilai lain membuat klien membuang
seluruh daftar senjutsu, karena `SENJUTSU_DATA["senjutsu1"]` tidak ada.

---

## Pemecahan masalah

Sebelum apa pun: buka `flashlog.txt` (butuh Flash Player debug) dan `server/amf-log.txt`.
Hampir semua masalah di bawah ini terbaca jelas dari keduanya.

| gejala | penyebab | tindakan |
|---|---|---|
| Layar putih, tidak ada AMF sama sekali | folder `web` salah letak, atau Caddy tidak jalan | cek baris `### folder aset` di `amf-log.txt` |
| Flash menolak koneksi | CA lokal Caddy belum terpasang | jalankan `caddy run` sebagai Administrator, setujui pemasangan sertifikat |
| Patch SWF "tidak berpengaruh" | peramban memakai salinan cache | naikkan `&nocache=N`, cek baris `[aset] ninja_saga.swf terkirim, N byte` |
| `#1010 at BattleActionBar/initButtons` | patch `ninja_saga.swf` tidak aktif | pastikan ukurannya 2.870.608 byte; log harus memuat `Senjutsu feature disabled or no senjutsu data` |
| `#1069 Property _msc not found` | `code_library.swf` menuntut `_msc` yang tak ada di `ninja_saga.swf`-mu | pakai `code_library.swf` yang sudah dipatch (444.407 byte) |
| `#2007 Parameter text must be non-null` | balasan servis paket tanpa field `message` | `ClaimItemResponse` hanya membaca `res.message`; server wajib mengirim string |
| `bodySetId >> setset1 not exist` | awalan `set` dobel | `character_body_set` harus berisi nomor saja; klien menambahkan `set` sendiri |
| `bodySetId >> setNNNN not exist` | baju milik jenis kelamin lain | `BODY_SET_BOY` dan `BODY_SET_GIRL` terpisah; cek `gender` karakter |
| `Variable Skill_NNNN is not defined` | klon aset salah nama simbol | jalankan `periksa-aset.js`, lalu hapus yang rusak |
| Pertarungan berhenti di giliran pet | pet tanpa blok skill di `data_library_en.swf` | jangan pasang pet itu; `getBattleAction` tidak menemukan aksi dan rantai giliran mati |
| Talent/senjutsu hilang setiap login | `getExtraData` mengirim array kosong di tingkat atas | `parseCharacterData` menimpa `dbChar` dari situ, bukan dari sub-objek `databaseCharacter` |

---

## Catatan pengembangan

Alur kerja yang dipakai sepanjang proyek ini:

1. Reproduksi bug, kumpulkan `flashlog.txt` dan `amf-log.txt`
2. Bongkar metode yang muncul di stack trace
3. Cari cabang yang menyebabkannya, catat offsetnya
4. Perbaiki di sisi **server** kalau bisa; patch SWF hanya kalau bug memang ada di klien
5. Simpan offset dan alasannya sebagai komentar di kode

Beberapa pelajaran yang mahal:

- **Selalu pakai berkas yang sedang berjalan.** Beberapa kali salah diagnosis terjadi karena
  membongkar salinan lama, padahal build di folder `web` sudah berbeda. Cek ukuran berkasnya
  dulu.
- **Cache bisa menyembunyikan segalanya.** Sebuah build yang "bekerja" ternyata hanya hidup di
  cache peramban dan lebih baru dari berkas di disk. Begitu cache dibersihkan, ia hilang.
- **Urutan di log bukan urutan sebab-akibat.** `Main.onError` menyetel `mainChar = null` dan
  `mainMc = null`, jadi error yang tampil paling mencolok justru akibat terakhir, bukan
  penyebabnya.
- **Field yang sama bisa punya dua format.** `character_body_set` butuh nomor saja di satu
  jalur dan bentuk lengkap `set1` di jalur lain, tergantung siapa yang membacanya.

Untuk membongkar SWF sendiri, alat yang praktis: [JPEXS Free Flash Decompiler](https://github.com/jindrapetrik/jpexs-decompiler).

---

## Lisensi

Kode server dan alat bantu di repositori ini dirilis di bawah lisensi MIT. Aset game tidak
termasuk dan tetap milik pemegang haknya masing-masing.
