#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_petskill.py -- menambahkan blok `skill` untuk pet lama di data_library_en.swf

MASALAH
    PetBase.setPetAttributes (pet_184.swf, method 272) @1061-1078 membangun
    skillData[] dari  Main.PET_DATA.find("pet" + id).skill  -- dan
    Main.PET_DATA dibangun DataParser.parseSystemData @233 dari
    dataLib.getPet(), yaitu object literal PET di SystemDataEN method 19.

    Di berkas ini 63 dari 170 pet TIDAK punya kunci `skill` (semua pet lama:
    id 1..20, 23, 33, 56, ...). Akibatnya:
      - availableSkills selalu kosong -> PetBase.getBattleAction tidak
        menemukan aksi -> giliran pet membekukan pertarungan
      - tombol latih skill di panel Pets tetap gelap, karena tidak ada skill
        untuk dibuka meski trainskill_gold/token-nya ada

SOLUSI
    Menyisipkan kunci `skill` berisi N entri (N = jumlah slot pada
    trainskill_gold) ke tiap pet yang belum punya. Semua entri memakai aksi
    dasar `attack` / animasi `attack_01` / posType `melee1` -- satu-satunya
    kombinasi yang pasti ada di setiap berkas pet -- dengan level, damageBonus,
    dan cooldown menaik.

AMAN KARENA
    Method 19 murni membangun literal: 634.353 instruksi, NOL percabangan dan
    NOL exception handler (sudah diverifikasi). Jadi penyisipan tidak merusak
    offset lompatan apa pun. Semua string yang dipakai sudah ada di constant
    pool, jadi pool tidak perlu diubah sama sekali.

Pakai:
    python patch_petskill.py data_library_en.swf data_library_en_patched.swf
"""

import sys, zlib, struct
sys.path.insert(0, '/home/claude/ns')
import avm2 as A

# level, damageBonus, cooldown per slot
LEVELS   = [1, 10, 20, 30, 40, 50]
DMGBONUS = [1, 2, 2, 3, 3, 4]
COOLDOWN = [0, 3, 5, 7, 9, 11]


def u30(v):
    out = bytearray()
    while True:
        b, v = v & 0x7F, v >> 7
        out.append(b | 0x80 if v else b)
        if not v:
            return bytes(out)


def read_u30(buf, i):
    v = sh = 0
    for _ in range(5):
        b = buf[i]; i += 1
        v |= (b & 0x7F) << sh
        if not b & 0x80:
            break
        sh += 7
    return v, i


class Emit:
    """Penghasil bytecode untuk literal; indeks string dicari di constant pool."""
    def __init__(self, abc):
        self.abc = abc
        # PENTING: lewati indeks 0. Di ABC, entri ke-0 constant pool adalah
        # slot cadangan yang bermakna "null", bukan string kosong. Parser
        # menaruh '' di sana, jadi tanpa penjagaan ini `target: ""` akan
        # menghasilkan `pushstring 0` -- instruksi tidak sah yang membuat
        # verifier AVM2 menolak seluruh method (Flash lalu membuang listing
        # 634.000 instruksi ke flashlog dan tampak hang).
        # String kosong yang sah ada di indeks lain (di berkas ini: 4).
        self.si = {}
        for i, s in enumerate(abc.strings):
            if i == 0:
                continue
            self.si.setdefault(s, i)
        self.buf = bytearray()

    def s(self, text):
        if text not in self.si:
            raise KeyError('string %r tidak ada di constant pool' % text)
        self.buf += b'\x2c' + u30(self.si[text])

    def i(self, n):
        if 0 <= n <= 127:
            self.buf += b'\x24' + bytes([n])
        else:
            self.buf += b'\x25' + u30(n)

    def true(self):  self.buf += b'\x26'
    def false(self): self.buf += b'\x27'
    def obj(self, n):   self.buf += b'\x55' + u30(n)
    def arr(self, n):   self.buf += b'\x56' + u30(n)


def build_skill_array(em, slots, nama_pet):
    """Emit array skill berisi `slots` entri (12 field, sama seperti pet ber-skill)."""
    for k in range(slots):
        em.s('level');        em.i(LEVELS[k])
        em.s('damageBonus');  em.i(DMGBONUS[k])
        em.s('cooldown');     em.i(COOLDOWN[k])
        em.s('target');       em.s('')
        em.s('name');         em.s('Basic attack')
        em.s('description');  em.s("<b>Basic attack</b><br>Pet's basic attack.")
        em.s('action');       em.s('attack')
        em.s('animation');    em.s('attack_01')
        em.s('posType');      em.s('melee1')
        em.s('hasDamage');    em.true()
        em.s('skill_cp');     em.i(0)
        em.s('effect')
        em.s('type');         em.s('no effect')
        em.obj(1)
        em.arr(1)
        em.obj(12)
    em.arr(slots)


def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]

    d = open(src, 'rb').read()
    if d[:3] == b'CWS':
        raw = bytearray(d[:8] + zlib.decompress(d[8:])); comp = True
    elif d[:3] == b'FWS':
        raw = bytearray(d); comp = False
    else:
        sys.exit('bukan SWF: %r' % d[:3])

    tags = A.find_abc(bytes(raw))
    tag = next(t for t in tags if t[0] == 82)
    _, tag_pos, tag_len = tag
    r = A.R(bytes(raw), tag_pos); r.p += 4; r.utf()
    abc_start = r.p
    abc = A.ABC(bytes(raw)[abc_start:tag_pos + tag_len])

    body = abc.body_by_method[19]
    if body['exc']:
        sys.exit('method 19 punya exception handler -- penyisipan tidak aman')
    code = bytes(body['code'])
    ins = A.disasm(abc, code)
    if any(n.startswith('if') or n in ('jump', 'lookupswitch') for _, _, n, _ in ins):
        sys.exit('method 19 punya percabangan -- penyisipan tidak aman')

    # --- batas blok PET ---
    start = end = None
    for k, (off, op, nm, txt) in enumerate(ins):
        if nm == 'findproperty' and txt and txt[0].startswith('PET '):
            start = k + 1
        if nm == 'initproperty' and txt and txt[0].startswith('PET '):
            end = k
    if start is None or end is None:
        sys.exit('blok PET tidak ditemukan')

    # --- indeks instruksi kunci "petN" tingkat atas ---
    import re
    keys = [(k, ins[k][3][0][1:-1]) for k in range(start, end)
            if ins[k][2] == 'pushstring' and re.fullmatch(r'"pet\d+"', ins[k][3][0])]
    print('entri pet ditemukan: %d' % len(keys))

    # --- rekonstruksi data untuk tahu siapa yang belum punya skill ---
    def extract(a, b):
        st = []
        for off, op, nm, txt in ins[a:b]:
            if nm == 'pushstring':  st.append(txt[0][1:-1])
            elif nm in ('pushbyte', 'pushshort', 'pushint', 'pushuint'): st.append(int(txt[0]))
            elif nm == 'pushdouble': st.append(float(txt[0]))
            elif nm == 'pushtrue':  st.append(True)
            elif nm == 'pushfalse': st.append(False)
            elif nm in ('pushnull', 'pushnan'): st.append(None)
            elif nm == 'convert_s': st[-1] = '' if st[-1] is None else str(st[-1])
            elif nm == 'newarray':
                n = int(txt[0]); it = st[len(st)-n:]; del st[len(st)-n:]; st.append(it)
            elif nm == 'newobject':
                n = int(txt[0]); kv = st[len(st)-2*n:]; del st[len(st)-2*n:]
                st.append({kv[i]: kv[i+1] for i in range(0, len(kv), 2)})
        return st[0]

    PET = extract(start, end)

    # --- untuk tiap entri sasaran: cari newobject penutupnya ---
    em_base = Emit(abc)
    sisip = []           # (indeks_instruksi_newobject, bytes_sisipan, n_lama)
    for idx, (kpos, key) in enumerate(keys):
        v = PET.get(key)
        if not v or v.get('skill'):
            continue
        slots = len(v.get('trainskill_gold') or [])
        if slots < 1:
            slots = 5
        slots = min(slots, len(LEVELS))

        # Untuk entri terakhir, batasnya HARUS sebelum `newobject 170`
        # yang menutup objek PET itu sendiri -- kalau tidak, kunci `skill`
        # akan disisipkan ke tingkat atas dan PET jadi punya 171 anggota.
        batas = keys[idx+1][0] if idx + 1 < len(keys) else end - 1
        tutup = None
        for j in range(batas - 1, kpos, -1):
            if ins[j][2] == 'newobject':
                tutup = j; break
        if tutup is None:
            sys.exit('newobject penutup untuk %s tidak ketemu' % key)

        em = Emit(abc)
        em.s('skill')
        build_skill_array(em, slots, v.get('name', ''))
        sisip.append((tutup, bytes(em.buf), int(ins[tutup][3][0]), key, slots))

    print('pet yang ditambal: %d' % len(sisip))
    print('contoh:', ', '.join('%s(%d slot)' % (k, s) for _, _, _, k, s in sisip[:6]))

    # --- rakit ulang code ---
    sisip.sort()
    out = bytearray()
    prev_off = 0
    for tutup, blob, n_lama, key, slots in sisip:
        off = ins[tutup][0]
        out += code[prev_off:off]          # sampai sebelum newobject
        out += blob                        # key "skill" + array
        out += b'\x55' + u30(n_lama + 1)   # newobject N+1
        # lewati newobject lama
        nxt = ins[tutup+1][0] if tutup + 1 < len(ins) else len(code)
        prev_off = nxt
    out += code[prev_off:]

    print('code_length: %d -> %d' % (len(code), len(out)))

    new_body = (u30(body['method']) + u30(body['max_stack'] + 8)
                + u30(body['local_count']) + u30(body['init_scope'])
                + u30(body['max_scope']) + u30(len(out)) + bytes(out))
    tail_start = body['code_pos'] + body['clen']
    new_body += bytes(raw)[abc_start + tail_start: abc_start + body['end']]

    delta = len(new_body) - (body['end'] - body['start'])
    raw[abc_start + body['start']: abc_start + body['end']] = new_body

    hdr = tag_pos - 6
    assert struct.unpack_from('<H', raw, hdr)[0] >> 6 == 82
    struct.pack_into('<I', raw, hdr + 2, tag_len + delta)
    struct.pack_into('<I', raw, 4, len(raw))

    # --- penjagaan: tidak boleh ada pushstring/pushnamespace beroperan 0 ---
    def ru30(buf, i):
        v = sh = 0
        while True:
            x = buf[i]; i += 1; v |= (x & 0x7F) << sh
            if not x & 0x80: return v, i
            sh += 7
    nol = 0
    for off, op, nm, txt in A.disasm(abc, bytes(out)):
        if nm == 'pushstring' and ru30(bytes(out), off + 1)[0] == 0:
            nol += 1
    if nol:
        sys.exit('GAGAL: %d instruksi `pushstring 0` -- indeks 0 tidak sah, '
                 'verifier AVM2 akan menolak method ini.' % nol)
    print('periksa: pushstring beroperan 0 -> 0 (aman)')

    blob = bytes(raw[:8]) + zlib.compress(bytes(raw[8:]), 9) if comp else bytes(raw)
    open(dst, 'wb').write(blob)
    print('ditulis %s (%d byte, uncompressed %d)' % (dst, len(blob), len(raw)))


main()
