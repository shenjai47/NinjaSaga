#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_senjutsu_type.py -- perbaiki tipe senjutsu_type di data_library_en.swf

MASALAH
    CharacterBase.getSenjutsuListArr (code_library.swf, method 724) @142-152
    menyaring senjutsu yang boleh tampil di bar aksi pertarungan:

        if (SENJUTSU_SKILL_DATA["senjutsu_skill"+e.skill_id].senjutsu_type
            == SenjutsuData.SKILL_TYPE_ACTIVE)
                senjutsuList.push(e);

    SenjutsuData.SKILL_TYPE_ACTIVE bernilai 1 (integer), tapi di
    data_library_en.swf senjutsu_type ditulis sebagai BOOLEAN true/false.
    Opcode pembandingnya `ifne` -- perbandingan ketat -- jadi true !== 1 dan
    SEMUA entri dibuang:

        SENJUTSU_DEBUG :: character_senjutsu length: 4
        SENJUTSU_DEBUG :: SenjutsuListArr length: 0     <-- kosong
        TypeError #1010 at BattleActionBar/initButtons()

    Akibatnya bar aksi pertarungan gagal digambar dan tidak ada tombol
    senjutsu sama sekali.

SOLUSI
    Ganti `pushtrue` -> `pushbyte 1` dan `pushfalse` -> `pushbyte 0` HANYA
    pada nilai yang mengikuti kunci "senjutsu_type" di dalam blok
    SENJUTSU_SKILL. Sisa berkas tidak disentuh.

    pushtrue/pushfalse 1 byte, pushbyte 2 byte, jadi kode bertambah 1 byte
    per entri. Method 19 tidak punya percabangan maupun exception handler
    (sudah diverifikasi), jadi tidak ada offset lompatan yang rusak.

Pakai:
    python patch_senjutsu_type.py data_library_en.swf hasil.swf
"""

import sys, zlib, struct
sys.path.insert(0, '/home/claude/ns')
import avm2 as A


def u30(v):
    out = bytearray()
    while True:
        b, v = v & 0x7F, v >> 7
        out.append(b | 0x80 if v else b)
        if not v:
            return bytes(out)


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
        sys.exit('method 19 punya exception handler -- tidak aman')
    code = bytes(body['code'])
    ins = A.disasm(abc, code)
    if any(n.startswith('if') or n in ('jump', 'lookupswitch') for _, _, n, _ in ins):
        sys.exit('method 19 punya percabangan -- tidak aman')

    # batas blok SENJUTSU_SKILL
    start = end = None
    for k, (off, op, nm, txt) in enumerate(ins):
        if nm == 'findproperty' and txt and txt[0].split(' ')[0] == 'SENJUTSU_SKILL':
            start = k + 1
        if nm == 'initproperty' and txt and txt[0].split(' ')[0] == 'SENJUTSU_SKILL':
            end = k
    if start is None or end is None:
        sys.exit('blok SENJUTSU_SKILL tidak ditemukan')

    # kumpulkan posisi nilai yang harus diganti
    ganti = []          # (offset_opcode, byte_baru)
    n_true = n_false = 0
    for k in range(start, end):
        off, op, nm, txt = ins[k]
        if nm == 'pushstring' and txt[0] == '"senjutsu_type"':
            noff, _, nnm, _ = ins[k + 1]
            if nnm == 'pushtrue':
                ganti.append((noff, b'\x24\x01')); n_true += 1
            elif nnm == 'pushfalse':
                ganti.append((noff, b'\x24\x00')); n_false += 1
            else:
                sys.exit('nilai senjutsu_type tak terduga: %s @%d' % (nnm, noff))

    print('senjutsu_type ditemukan: %d true, %d false' % (n_true, n_false))
    if not ganti:
        sys.exit('tidak ada yang perlu diganti (mungkin sudah dipatch)')

    # rakit ulang code
    out = bytearray()
    prev = 0
    for off, baru in sorted(ganti):
        out += code[prev:off]
        out += baru
        prev = off + 1          # pushtrue/pushfalse = 1 byte
    out += code[prev:]

    print('code_length: %d -> %d' % (len(code), len(out)))

    new_body = (u30(body['method']) + u30(body['max_stack'])
                + u30(body['local_count']) + u30(body['init_scope'])
                + u30(body['max_scope']) + u30(len(out)) + bytes(out))
    tail = body['code_pos'] + body['clen']
    new_body += bytes(raw)[abc_start + tail: abc_start + body['end']]

    delta = len(new_body) - (body['end'] - body['start'])
    raw[abc_start + body['start']: abc_start + body['end']] = new_body

    hdr = tag_pos - 6
    assert struct.unpack_from('<H', raw, hdr)[0] >> 6 == 82
    struct.pack_into('<I', raw, hdr + 2, tag_len + delta)
    struct.pack_into('<I', raw, 4, len(raw))

    blob = bytes(raw[:8]) + zlib.compress(bytes(raw[8:]), 9) if comp else bytes(raw)
    open(dst, 'wb').write(blob)
    print('ditulis %s (%d byte)' % (dst, len(blob)))


main()
