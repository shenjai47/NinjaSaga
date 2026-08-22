"""Menutup seluruh rantai verifikasi tersamar di code_library.swf.

Build code_library 444.987 memanggil sekumpulan metode berhuruf pendek pada
dokumen utama (getMainMc()) — _msc, _uc, _fd, _cc, _sd, _za, _zc, _zd, ...
Semua itu TIDAK ADA di ninja_saga.swf yang dipakai, jadi setiap kali salah satu
rantai dijalankan hasilnya:

    ReferenceError #1069: Property _xx not found on NinjaSaga

Sudah terbukti dua kali: _msc menjatuhkan Mission.start (misi tak bisa dimulai)
dan _uc menjatuhkan Character.updateDB lewat Battle.getBossRewardResponse02
(jendela hadiah tak muncul, level pet tak tersimpan).

Setiap rantai punya satu "pintu depan" berpola sama:

    if (arg1.length == 0 || arg2.length == 0) return '';   <- jalur aman
    ... rantai _xa/_xb/_xc/_xd ...                          <- yang meledak

Jadi tiap pintu depan cukup dibelokkan ke jalur aman itu: instruksi kedua
diganti `jump` ke offset `pushstring ''`, sisanya sampai situ diisi nop.
Panjang metode tidak berubah, jadi tidak ada offset lain yang bergeser.

Aman karena hasil semua rantai ini hanya dipakai sebagai parameter hash pada
panggilan AMF yang dilayani server sendiri dan tidak diverifikasi:

    Mission.start            -> CharacterService.startMission
    Character.updateDB       -> CharacterService.updateCharacter
    Mission.completeMission  -> CharacterService.completeMission
    Battle.callBattleFinishHAV / actionFinish_CB

Dan jalur "kembalikan ''" itu memang sudah ada di kode aslinya untuk kasus
argumen kosong, jadi setiap pemanggilnya sudah siap menerima nilai tersebut.
"""
import sys, zlib
sys.path.insert(0, '/home/claude/ns')
from swfparse import decompress
from tool import abcs
import avm2

BERKAS = '/home/claude/ns/fix/code_library.swf'

# pintu depan tiap rantai
TARGET = [
    ('ninjasaga::Mission', '_msk'),
    ('ninjasaga::Mission', '_frk'),
    ('ninjasaga::Mission', '_srk'),
    ('ninjasaga::Main',    '_urk'),
    ('ninjasaga::Main',    '_crk'),
    ('ninjasaga::Main',    '_zra'),
    ('ninjasaga::Main',    '_zrb'),
    ('ninjasaga::Main',    '_srk'),
]


def s24(n):
    n &= 0xFFFFFF
    return bytes([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF])


raw = decompress(open(BERKAS, 'rb').read())
abc = abcs(BERKAS)[0]


def cari(cls, met):
    for i, inst in enumerate(abc.instances):
        if abc.mn(inst['name']) == cls:
            for t in list(inst['traits']) + list(abc.classes[i]['traits']):
                if 'method' in t and abc.mn(t['name']) == met:
                    return abc.body_by_method[t['method']]
    return None


buf = bytearray(raw)
diubah, dilewati = [], []

for cls, met in TARGET:
    b = cari(cls, met)
    if b is None:
        dilewati.append('%s.%s (tidak ada di build ini)' % (cls.split('::')[-1], met))
        continue

    code = b['code']
    ins = avm2.disasm(abc, code)

    # sudah dipatch sebelumnya?
    if ins[2][2] == 'jump':
        dilewati.append('%s.%s (sudah dipatch)' % (cls.split('::')[-1], met))
        continue

    # cari `pushstring ''` yang diikuti returnvalue -> jalur aman
    aman = None
    for k, (off, op, nm, txt) in enumerate(ins):
        if nm == 'pushstring' and txt and txt[0] == "''" \
           and k + 1 < len(ins) and ins[k + 1][2] == 'returnvalue':
            aman = off
            break
    if aman is None:
        dilewati.append('%s.%s (jalur aman tidak ketemu)' % (cls.split('::')[-1], met))
        continue

    baru = bytearray(code)
    baru[2] = 0x10                    # jump
    baru[3:6] = s24(aman - 6)         # instruksi sesudah jump ada di offset 6
    for i in range(6, aman):
        baru[i] = 0x02                # nop
    baru = bytes(baru)
    assert len(baru) == len(code)

    n = raw.find(code)
    assert n >= 0 and raw.find(code, n + 1) < 0, 'badan metode tidak unik: ' + met
    buf[n:n + len(baru)] = baru
    diubah.append('%s.%s -> jump ke @%d' % (cls.split('::')[-1], met, aman))

raw2 = bytes(buf)
open(BERKAS, 'wb').write(b'CWS' + raw2[3:8] + zlib.compress(raw2[8:], 9))

print('dipatch:')
for x in diubah:
    print('   ', x)
print('dilewati:')
for x in dilewati:
    print('   ', x)
import os
print('\nukuran:', os.path.getsize(BERKAS))
