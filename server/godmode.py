"""Menanam penjaga godmode dari build lama ke build yang sedang dipakai.

Perbedaan nyatanya ada di CharacterBase.updateHP. Build LAMA (440.306) punya
21 byte tambahan di awal yang TIDAK ada di build baru (444.987):

     15: getlocal0
     16: getproperty  type
     19: getproperty  TYPE_CHARACTER
     23: ifne         9  (-> 36)     <- bukan karakter pemain, lanjut normal
     27: getlocal1
     28: pushbyte     0
     30: ifnlt        2  (-> 36)     <- perubahan HP >= 0 (penyembuhan), lanjut
     34: getlocal2
     35: returnvalue                 <- karakter pemain + HP berkurang: ABAIKAN

Artinya: setiap pengurangan HP pada karakter pemain dibuang, sedangkan
penyembuhan tetap jalan dan musuh tetap bisa terluka. Itulah "logika battle"
yang dicari.

Menyalin bytecode antar build TIDAK bisa mentah-mentah: penomoran constant
pool kedua berkas berbeda (2577 metode berbeda hanya karena penomoran ulang).
Jadi urutan instruksinya ditulis ulang memakai indeks multiname milik build
TUJUAN, yang dibaca langsung dari berkasnya:

     getproperty type            -> 66 e4 06
     getproperty TYPE_CHARACTER  -> 66 bb 49

Karena sisipan berada SEBELUM semua percabangan di metode itu (cabang pertama
di @33), seluruh offset relatif sesudahnya bergeser sama rata dan tetap sah —
tidak ada satu pun target lompatan yang perlu dihitung ulang.
"""
import sys, zlib, struct
sys.path.insert(0, '/home/claude/ns')
from swfparse import decompress
from tool import abcs
import avm2

SUMBER = '/mnt/user-data/uploads/code_library.swf'      # build yang dipakai
HASIL  = '/home/claude/ns/fix/code_library.swf'

raw = decompress(open(SUMBER, 'rb').read())
abc = abcs(SUMBER)[0]

# ---- ambil badan CharacterBase.updateHP -------------------------------
body = None
for i, inst in enumerate(abc.instances):
    if abc.mn(inst['name']) == 'ninjasaga.base::CharacterBase':
        for t in list(inst['traits']) + list(abc.classes[i]['traits']):
            if 'method' in t and abc.mn(t['name']) == 'updateHP':
                body = abc.body_by_method[t['method']]
assert body is not None, 'CharacterBase.updateHP tidak ketemu'
code = body['code']
print('updateHP asli: %d byte' % len(code))
assert len(code) == 120, 'panjang tak terduga — build berbeda?'

# ---- ambil operand getproperty dari build ini sendiri -------------------
def operand(nama):
    for b in abc.bodies:
        for off, op, nm, txt in avm2.disasm(abc, b['code']):
            if nm == 'getproperty' and txt and txt[0] == nama:
                # getproperty = 0x66 + u30; baca u30-nya
                p = off + 1
                out = bytearray()
                while True:
                    x = b['code'][p]
                    out.append(x); p += 1
                    if not (x & 0x80):
                        break
                return bytes(out)
    raise SystemExit('operand %s tidak ketemu' % nama)

op_type = operand('type')
op_tchar = operand('TYPE_CHARACTER')
print('operand type           =', op_type.hex())
print('operand TYPE_CHARACTER =', op_tchar.hex())


def s24(n):
    n &= 0xFFFFFF
    return bytes([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF])


# ---- rakit sisipan ------------------------------------------------------
# panjangnya dihitung dulu supaya target lompatan bisa menunjuk ke akhir sisipan
def rakit(panjang):
    b = bytearray()
    b += b'\xd0'                       # getlocal0
    b += b'\x66' + op_type             # getproperty type
    b += b'\xd0'                       # getlocal0   <- WAJIB: this kedua
    b += b'\x66' + op_tchar            # getproperty TYPE_CHARACTER
    sisa1 = panjang - (len(b) + 4)     # ifne -> akhir sisipan
    b += b'\x14' + s24(sisa1)          # ifne (0x14; 0x0D itu ifnle)
    b += b'\xd1'                       # getlocal1
    b += b'\x24\x00'                   # pushbyte 0
    sisa2 = panjang - (len(b) + 4)
    b += b'\x0c' + s24(sisa2)          # ifnlt -> akhir sisipan
    b += b'\xd2'                       # getlocal2
    b += b'\x48'                       # returnvalue
    return bytes(b)

n = len(rakit(0))                      # panjang sebenarnya
sisipan = rakit(n)
assert len(sisipan) == n
print('sisipan: %d byte' % n)

baru = code[:15] + sisipan + code[15:]
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


# ---- tanam ke ABC mentah ----------------------------------------------
# code_length adalah u30 tepat sebelum badan kode
lama_blok = u30(len(code)) + code
baru_blok = u30(len(baru)) + baru
pos = raw.find(lama_blok)
assert pos >= 0 and raw.find(lama_blok, pos + 1) < 0, 'badan metode tidak unik'
print('offset di berkas mentah:', hex(pos))

raw2 = raw[:pos] + baru_blok + raw[pos + len(lama_blok):]
selisih = len(raw2) - len(raw)
print('pertumbuhan berkas mentah: +%d byte' % selisih)

# ---- perbaiki panjang tag DoABC yang memuatnya -------------------------
def rect_len(b):
    return (5 + (b[0] >> 3) * 4 + 7) // 8

awal = 8 + rect_len(raw2[8:]) + 4
p = awal
while p < len(raw2) - 1:
    th, = struct.unpack_from('<H', raw2, p)
    kode = th >> 6
    pjg = th & 0x3F
    hlen = 2
    if pjg == 0x3F:
        pjg, = struct.unpack_from('<I', raw2, p + 2)
        hlen = 6
    if kode == 82 and p + hlen <= pos < p + hlen + pjg + selisih:
        assert hlen == 6, 'tag DoABC memakai bentuk pendek — tak terduga'
        raw2 = raw2[:p + 2] + struct.pack('<I', pjg + selisih) + raw2[p + 6:]
        print('tag DoABC: %d -> %d byte' % (pjg, pjg + selisih))
        break
    p += hlen + pjg
else:
    raise SystemExit('tag DoABC pemuat tidak ketemu')

# ---- perbaiki FileLength di header, lalu kemas ulang -------------------
raw2 = raw2[:4] + struct.pack('<I', len(raw2)) + raw2[8:]
open(HASIL, 'wb').write(b'CWS' + raw2[3:4] + struct.pack('<I', len(raw2)) +
                        zlib.compress(raw2[8:], 9))
import os
print('ditulis %s (%d byte)' % (HASIL, os.path.getsize(HASIL)))
