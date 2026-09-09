"""Buka SEMBILAN pet ekor di panel Tailed Beast (popup_tail_pet.swf).

Panel sebenarnya sudah siap untuk sembilan:
    tailPetArr  = [0,146,141,131,86,74,73,71,68,65]   -> 9 pet
    tailBtnArr  = [tailx, pet1Btn ... pet9Btn]        -> 9 tombol tab
    toolTipArr  = ['', '1' ... '9']                   -> 9 tooltip

Yang membatasi cuma satu konstanta di konstruktor @409-420:
    pushbyte 1; pushbyte 2; pushbyte 3; pushbyte 4; newarray 4
    initproperty tailPetCanShowArr

getCanBuyTailsResponse hanya mengulang tailPetCanShowArr, jadi ekor 5-9
(Gobi, Rokubi, Nanabi, Hachibi, Kyubi) tak pernah dibangun sama sekali —
tak ada tabnya, tak ada tombol belinya. Ini TIDAK bisa diperbaiki dari sisi
server: active_tail_number cuma disaring TERHADAP daftar ini.

Patch: sisipkan pushbyte 5..9 (10 byte) lalu ubah newarray 4 -> 9.

Aman diperpanjang karena, di konstruktor ini:
  - kelima percabangan ada di @242-268, jauh SEBELUM titik sisipan @418,
    jadi tak ada offset relatif yang melintasi sisipan
  - tidak ada exception handler (offsetnya tak perlu digeser)
  - max_stack sudah 22, sedangkan newarray 9 cuma butuh 10
"""
import sys, zlib, struct
sys.path.insert(0,'/home/claude/ns')
from swfparse import decompress
from avm2 import abcs, disasm

SRC, OUT = sys.argv[1], sys.argv[2]
raw = decompress(SRC); abc = abcs(SRC)[0]

body = None
for i, inst in enumerate(abc.instances):
    if abc.mn(inst['name']) == 'ninjasaga.linkage::paymentTailPet':
        body = abc.body_by_method[inst['iinit']]
assert body, 'kelas paymentTailPet tidak ketemu'
code = body['code']

ins = disasm(abc, code)
titik = None
for k, (off, op, nm, txt) in enumerate(ins):
    if nm == 'initproperty' and txt and txt[0] == 'tailPetCanShowArr' and off > 200:
        assert ins[k-1][2] == 'newarray' and ins[k-1][3][0] == '4', 'pola tak cocok'
        titik = ins[k-1][0]
assert titik is not None, 'tailPetCanShowArr tidak ketemu'
assert bytes(code[titik:titik+2]) == b'\x56\x04'
print('newarray 4 di @%d' % titik)

# pengaman: tak boleh ada cabang yang melintasi titik sisipan
import re
for off, _, nm, txt in ins:
    if nm.startswith('if') or nm == 'jump':
        m = re.search(r'-> (\d+)', ' '.join(txt))
        if m:
            t = int(m.group(1))
            assert not ((off < titik <= t) or (t <= titik < off)), \
                'ada cabang melintasi @%d' % titik
assert not body['handlers'], 'ada exception handler'
assert body['max_stack'] >= 10, 'max_stack kurang'

sisipan = b''.join(b'\x24' + bytes([n]) for n in range(5, 10))   # pushbyte 5..9
baru = code[:titik] + sisipan + b'\x56\x09' + code[titik+2:]
print('sisipan %d byte; clen %d -> %d' % (len(sisipan), len(code), len(baru)))

def u30(v):
    o = bytearray()
    while True:
        x = v & 0x7F; v >>= 7
        if v: x |= 0x80
        o.append(x)
        if not v: break
    return bytes(o)

lama_blok = u30(len(code)) + code
baru_blok = u30(len(baru)) + baru
pos = raw.find(lama_blok)
assert pos >= 0 and raw.find(lama_blok, pos+1) < 0, 'badan konstruktor tidak unik'
raw2 = raw[:pos] + baru_blok + raw[pos+len(lama_blok):]
sel = len(raw2) - len(raw)

def rect_len(b): return (5 + (b[0] >> 3) * 4 + 7) // 8
p = 8 + rect_len(raw2[8:]) + 4
while p < len(raw2) - 1:
    th, = struct.unpack_from('<H', raw2, p); kode = th >> 6; pjg = th & 0x3F; hl = 2
    if pjg == 0x3F:
        pjg, = struct.unpack_from('<I', raw2, p+2); hl = 6
    if kode == 82 and p + hl <= pos < p + hl + pjg + sel:
        raw2 = raw2[:p+2] + struct.pack('<I', pjg + sel) + raw2[p+6:]
        print('tag DoABC: %d -> %d' % (pjg, pjg + sel)); break
    p += hl + pjg
else:
    raise SystemExit('tag DoABC tidak ketemu')

raw2 = raw2[:4] + struct.pack('<I', len(raw2)) + raw2[8:]
open(OUT, 'wb').write(b'CWS' + raw2[3:4] + struct.pack('<I', len(raw2)) + zlib.compress(raw2[8:], 9))
import os
print('ditulis %s (%d byte)' % (OUT, os.path.getsize(OUT)))
