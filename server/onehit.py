"""Menambahkan one-hit-kill ke CharacterBase.updateHP.

Patch godmode sebelumnya hanya menghadang HP MASUK ke karakter pemain, jadi
damage KELUAR tetap dihitung normal oleh Formula.calcDamage. Ini melengkapinya
dari sisi yang sama: begitu musuh menerima perubahan HP negatif, HP-nya
langsung dijadikan 0.

Kenapa di updateHP dan bukan di calcDamage:
  - calcDamage panjang (ribuan byte), bercabang banyak, dan hasilnya masih
    dilewatkan berlapis modifikator (kritikal, elemen, pengurang damage,
    perisai). Menambal satu titik di sana gampang meleset.
  - updateHP adalah SATU pintu terakhir yang dilewati semua bentuk pengurangan
    HP, termasuk racun dan damage berulang. Menutup di sini berlaku menyeluruh.

Sisipan ditaruh SESUDAH penjaga godmode (yang berakhir di @36) dan SEBELUM
cabang pertama sisa metode, jadi sama seperti sebelumnya: seluruh offset
relatif sesudahnya bergeser sama rata dan tak ada target lompatan yang perlu
dihitung ulang.

Susunannya:
     getlocal0 / getproperty type
     getlocal0 / getproperty TYPE_ENEMY
     ifne   -> lewati            bukan musuh: biarkan normal
     getlocal1 / pushbyte 0
     ifnlt  -> lewati            perubahan HP >= 0 (penyembuhan): biarkan
     getlocal0
     getlex DBCharacterData / getproperty HP / pushbyte 0
     callpropvoid updateData 2   tulis HP = 0
     pushbyte 0
     returnvalue

TYPE_ENEMY = 4 dipilih supaya hanya musuh yang kena. Pet (5), NPC (6), dan
AICharacter (2) sengaja dibiarkan — kalau ikut dimatikan, rekan satu tim bisa
tumbang sendiri dan rantai giliran berhenti.

Semua operand disalin dari bytecode metode ini sendiri agar indeks constant
pool dijamin cocok dengan build yang dipatch:
     getproperty type        66 e4 06
     getproperty TYPE_ENEMY  66 c5 49
     getlex DBCharacterData  60 c5 07
     getproperty HP          66 b3 1f
     callpropvoid updateData 4f f7 06 02
"""
import sys, zlib, struct
sys.path.insert(0, '/home/claude/ns')
from swfparse import decompress
from tool import abcs
import avm2

SUMBER = '/home/claude/ns/fix/code_library.swf'   # sudah berisi godmode
HASIL = '/home/claude/ns/fix/code_library.swf'

raw = decompress(open(SUMBER, 'rb').read())
abc = abcs(SUMBER)[0]

body = None
for i, inst in enumerate(abc.instances):
    if abc.mn(inst['name']) == 'ninjasaga.base::CharacterBase':
        for t in list(inst['traits']) + list(abc.classes[i]['traits']):
            if 'method' in t and abc.mn(t['name']) == 'updateHP':
                body = abc.body_by_method[t['method']]
assert body is not None
code = body['code']
print('updateHP sekarang: %d byte' % len(code))
assert len(code) == 141, 'jalankan godmode.py dulu'

# pastikan penjaga godmode memang berakhir di @36
ins = avm2.disasm(abc, code)
peta = {o: (n, ' '.join(t)) for o, _, n, t in ins}
assert peta[35][0] == 'returnvalue', 'penjaga godmode tidak seperti dugaan'


def ambil(off, n):
    return code[off:off + n]


OP_TYPE = ambil(16, 3)        # getproperty type
OP_DBC = ambil(128, 3)        # getlex DBCharacterData
OP_HP = ambil(131, 3)         # getproperty HP
OP_UPD = ambil(135, 4)        # callpropvoid updateData 2

# getproperty TYPE_ENEMY diambil dari metode mana pun di berkas ini
OP_ENEMY = None
for bb in abc.bodies:
    for o, _, nm, txt in avm2.disasm(abc, bb['code']):
        if nm == 'getproperty' and txt and txt[0] == 'TYPE_ENEMY':
            OP_ENEMY = bb['code'][o:o + 3]
            break
    if OP_ENEMY:
        break
assert OP_ENEMY, 'TYPE_ENEMY tidak ketemu'
print('operand: type=%s enemy=%s dbc=%s hp=%s upd=%s' % (
    OP_TYPE.hex(), OP_ENEMY.hex(), OP_DBC.hex(), OP_HP.hex(), OP_UPD.hex()))


def s24(n):
    n &= 0xFFFFFF
    return bytes([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF])


def rakit(panjang):
    b = bytearray()
    b += b'\xd0' + OP_TYPE                 # getlocal0; getproperty type
    b += b'\xd0' + OP_ENEMY                # getlocal0; getproperty TYPE_ENEMY
    b += b'\x14' + s24(panjang - (len(b) + 4))   # ifne -> lewati
    b += b'\xd1'                           # getlocal1
    b += b'\x24\x00'                       # pushbyte 0
    b += b'\x0c' + s24(panjang - (len(b) + 4))   # ifnlt -> lewati
    b += b'\xd0' + OP_DBC + OP_HP          # getlocal0; getlex DBC; getproperty HP
    b += b'\x24\x00'                       # pushbyte 0
    b += OP_UPD                            # callpropvoid updateData 2
    b += b'\x24\x00'                       # pushbyte 0
    b += b'\x48'                           # returnvalue
    return bytes(b)


n = len(rakit(0))
sisipan = rakit(n)
assert len(sisipan) == n
print('sisipan: %d byte' % n)

baru = code[:36] + sisipan + code[36:]
print('updateHP baru: %d byte' % len(baru))


def u30(v):
    out = bytearray()
    while True:
        x = v & 0x7F
        v >>= 7
        if v:
            x |= 0x80
        out.append(x)
        if not v:
            break
    return bytes(out)


lama_blok = u30(len(code)) + code
baru_blok = u30(len(baru)) + baru
pos = raw.find(lama_blok)
assert pos >= 0 and raw.find(lama_blok, pos + 1) < 0, 'badan metode tidak unik'
raw2 = raw[:pos] + baru_blok + raw[pos + len(lama_blok):]
selisih = len(raw2) - len(raw)
print('pertumbuhan: +%d byte' % selisih)


def rect_len(b):
    return (5 + (b[0] >> 3) * 4 + 7) // 8


p = 8 + rect_len(raw2[8:]) + 4
while p < len(raw2) - 1:
    th, = struct.unpack_from('<H', raw2, p)
    kode, pjg, hlen = th >> 6, th & 0x3F, 2
    if pjg == 0x3F:
        pjg, = struct.unpack_from('<I', raw2, p + 2)
        hlen = 6
    if kode == 82 and p + hlen <= pos < p + hlen + pjg + selisih:
        raw2 = raw2[:p + 2] + struct.pack('<I', pjg + selisih) + raw2[p + 6:]
        print('tag DoABC: %d -> %d' % (pjg, pjg + selisih))
        break
    p += hlen + pjg
else:
    raise SystemExit('tag DoABC tidak ketemu')

raw2 = raw2[:4] + struct.pack('<I', len(raw2)) + raw2[8:]
open(HASIL, 'wb').write(b'CWS' + raw2[3:4] + struct.pack('<I', len(raw2)) +
                        zlib.compress(raw2[8:], 9))
import os
print('ditulis %s (%d byte)' % (HASIL, os.path.getsize(HASIL)))
