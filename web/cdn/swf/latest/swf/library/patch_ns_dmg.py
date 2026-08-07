#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_ns_dmg.py  -- patch damage Ninja Saga di BattleProcessor.updateHP

Pakai:
    python patch_ns_dmg.py code_library.swf1 code_library.swf
    python patch_ns_dmg.py code_library.swf1 code_library.swf 25

Argumen ke-3 (opsional) = MULTIPLIER, default 10.
    dmg = -(maxHP musuh * MULTIPLIER)

INPUT harus versi yang battle-nya masih normal (code_library.swf1),
BUKAN yang sudah crash. Script menolak jalan kalau pola lama tidak ketemu.
Tidak menimpa file input.
"""

import sys, zlib, struct

# --- pola prolog patch lama (52 byte, diakhiri pushshort 999999) ---
OLD_PROLOGUE = bytes.fromhex(
    'd030'                  # getlocal0 ; pushscope
    'd066a009' '20' '13290000'          # attacker == null      -> ifeq SKIP
    'd066a009' '668e48' 'd166e706' '141a0000'   # attacker.type != TYPE -> ifne SKIP
    'd1668e48' 'd166e706' '130e0000'            # target.type == TYPE   -> ifeq SKIP
    'd2' '2400' '0c070000'                      # !(dmg < 0)            -> ifnlt SKIP
    '25bf843d' '90' '6302'                      # dmg = -999999  (<- diganti)
)

MN_ATTACKER, MN_TYPE, MN_TYPE_CHAR, MN_MAXHP = 1184, 9230, 871, 9280


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


def s24(v):
    if v < 0:
        v += 1 << 24
    return bytes([v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF])


def build_prologue(mult):
    """Rakit ulang prolog; semua branch menuju SKIP = akhir prolog."""
    parts = [
        b'\xd0\x30',
        b'\xd0' + b'\x66' + u30(MN_ATTACKER) + b'\x20', ('br', 0x13),
        b'\xd0' + b'\x66' + u30(MN_ATTACKER) + b'\x66' + u30(MN_TYPE)
        + b'\xd1' + b'\x66' + u30(MN_TYPE_CHAR), ('br', 0x14),
        b'\xd1' + b'\x66' + u30(MN_TYPE)
        + b'\xd1' + b'\x66' + u30(MN_TYPE_CHAR), ('br', 0x13),
        b'\xd2' + b'\x24\x00', ('br', 0x0c),
        b'\xd1' + b'\x66' + u30(MN_MAXHP) + b'\x25' + u30(mult)
        + b'\xa2\x90\x73' + b'\x63' + u30(2),
    ]
    sizes = [4 if isinstance(p, tuple) else len(p) for p in parts]
    total = sum(sizes)
    out, pos = bytearray(), 0
    for p, sz in zip(parts, sizes):
        if isinstance(p, tuple):
            out += bytes([p[1]]) + s24(total - (pos + 4))
        else:
            out += p
        pos += sz
    return bytes(out)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    mult = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    if not 1 <= mult <= 32767:
        sys.exit('MULTIPLIER harus 1..32767')

    data = open(src, 'rb').read()
    sig = data[:3]
    if sig == b'CWS':
        raw = bytearray(data[:8] + zlib.decompress(data[8:]))
        compressed = True
    elif sig == b'FWS':
        raw = bytearray(data)
        compressed = False
    else:
        sys.exit('bukan file SWF (signature %r)' % sig)

    # --- cari prolog lama ---
    hits = []
    start = 0
    while True:
        i = raw.find(OLD_PROLOGUE, start)
        if i < 0:
            break
        hits.append(i)
        start = i + 1
    if len(hits) != 1:
        sys.exit('pola prolog lama ditemukan %d kali (harus tepat 1). '
                 'Pastikan input = code_library.swf1 yang belum dipatch ulang.'
                 % len(hits))
    code_start = hits[0]

    # --- baca mundur code_length (u30 tepat sebelum code) ---
    # (baca dari yang terpanjang; kandidat 1 byte bisa cocok palsu)
    clen = None
    for L in range(5, 0, -1):
        if code_start - L < 0:
            continue
        val, end = read_u30(raw, code_start - L)
        if end == code_start and 52 <= val <= len(raw) - code_start:
            clen, clen_pos = val, code_start - L
            break
    if clen is None:
        sys.exit('gagal membaca code_length')
    print('code_length lama : %d (varint %d byte)' % (clen, L))

    new_pro = build_prologue(mult)
    new_code = new_pro + raw[code_start + 52: code_start + clen]
    delta = len(new_code) - clen

    print('prolog  : 52 -> %d byte' % len(new_pro))
    print('code_len: %d -> %d' % (clen, len(new_code)))

    raw[clen_pos: code_start + clen] = u30(len(new_code)) + new_code
    delta += len(u30(len(new_code))) - L

    # --- perbaiki panjang tag DoABC yang memuat offset ini ---
    p = 8
    nb = raw[p] >> 3
    p += (5 + nb * 4 + 7) // 8 + 4          # rect + framerate + framecount
    fixed = False
    while p < len(raw):
        hdr = p
        th = struct.unpack_from('<H', raw, p)[0]; p += 2
        code, ln = th >> 6, th & 0x3F
        longform = ln == 0x3F
        if longform:
            ln = struct.unpack_from('<I', raw, p)[0]; p += 4
        if code == 82 and p <= clen_pos < p + ln:
            if not longform:
                sys.exit('tag DoABC pakai short header, tidak didukung')
            struct.pack_into('<I', raw, hdr + 2, ln + delta)
            print('tag DoABC: %d -> %d byte' % (ln, ln + delta))
            fixed = True
            break
        p += ln
        if code == 0:
            break
    if not fixed:
        sys.exit('tag DoABC tidak ketemu')

    struct.pack_into('<I', raw, 4, len(raw))      # FileLength di header SWF

    out = bytes(raw[:8]) + zlib.compress(bytes(raw[8:]), 9) if compressed else bytes(raw)
    open(dst, 'wb').write(out)
    print('\nSELESAI -> %s  (%d byte)' % (dst, len(out)))
    print('dmg musuh sekarang = -(maxHP * %d)' % mult)


main()
