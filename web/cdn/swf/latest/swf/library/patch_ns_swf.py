#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_ns_swf.py  -- dua patch untuk code_library.swf

  1. BattleProcessor.updateHP   : dmg musuh = -(maxHP * MULTIPLIER)
     Mengganti `pushshort 999999` yang dipotong Flash jadi 16959
     (pushshort = signed 16-bit, 999999 & 0xFFFF = 0x423F).

  2. G_Character.setupWeapon    : penjaga sebelum container["handweapon"]
     Menghentikan spam ReferenceError #1069 pada Skill_178/126/171/203.

Pakai:
    python patch_ns_swf.py code_library.swf1 code_library.swf
    python patch_ns_swf.py code_library.swf1 code_library.swf 25

INPUT harus code_library.swf1 yang belum dipatch. Tidak menimpa input.
"""

import sys, zlib, struct

# ---------------------------------------------------------------- konfigurasi
DEFAULT_MULT = 10

# ------------------------------------------------------- utilitas encoding u30
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

# ------------------------------------------------------------------ SWF/ABC IO
def load_swf(path):
    d = open(path, 'rb').read()
    if d[:3] == b'CWS':
        return bytearray(d[:8] + zlib.decompress(d[8:])), True
    if d[:3] == b'FWS':
        return bytearray(d), False
    sys.exit('bukan SWF: %r' % d[:3])

def save_swf(raw, compressed, path):
    struct.pack_into('<I', raw, 4, len(raw))
    out = bytes(raw[:8]) + zlib.compress(bytes(raw[8:]), 9) if compressed else bytes(raw)
    open(path, 'wb').write(out)
    return len(out)

def fix_doabc_len(raw, inside_offset, delta):
    """Perbaiki panjang tag DoABC yang memuat inside_offset."""
    p = 8
    nb = raw[p] >> 3
    p += (5 + nb * 4 + 7) // 8 + 4
    while p < len(raw):
        hdr = p
        th = struct.unpack_from('<H', raw, p)[0]; p += 2
        code, ln = th >> 6, th & 0x3F
        longform = ln == 0x3F
        if longform:
            ln = struct.unpack_from('<I', raw, p)[0]; p += 4
        if code == 82 and p <= inside_offset < p + ln:
            if not longform:
                sys.exit('tag DoABC short-header, tidak didukung')
            struct.pack_into('<I', raw, hdr + 2, ln + delta)
            return ln, ln + delta
        p += ln
        if code == 0:
            break
    sys.exit('tag DoABC tidak ketemu')

def find_once(raw, pat, label):
    hits, s = [], 0
    while True:
        i = raw.find(pat, s)
        if i < 0:
            break
        hits.append(i); s = i + 1
    if len(hits) != 1:
        sys.exit('pola %s ditemukan %d kali (harus 1). '
                 'Pastikan input belum pernah dipatch.' % (label, len(hits)))
    return hits[0]

def read_code_length(raw, code_start):
    """Baca u30 code_length yang berada tepat sebelum code_start."""
    for L in range(5, 0, -1):
        if code_start - L < 0:
            continue
        val, end = read_u30(raw, code_start - L)
        if end == code_start and 32 <= val <= len(raw) - code_start:
            return val, code_start - L
    sys.exit('gagal membaca code_length')

# ============================================================ PATCH 1: damage
OLD_DMG_PROLOGUE = bytes.fromhex(
    'd030'
    'd066a009' '20' '13290000'
    'd066a009' '668e48' 'd166e706' '141a0000'
    'd1668e48' 'd166e706' '130e0000'
    'd2' '2400' '0c070000'
    '25bf843d' '90' '6302'
)
MN_ATTACKER, MN_TYPE, MN_TYPE_CHAR, MN_MAXHP = 1184, 9230, 871, 9280

def build_dmg_prologue(mult):
    parts = [
        b'\xd0\x30',
        b'\xd0\x66' + u30(MN_ATTACKER) + b'\x20', ('br', 0x13),
        b'\xd0\x66' + u30(MN_ATTACKER) + b'\x66' + u30(MN_TYPE)
        + b'\xd1\x66' + u30(MN_TYPE_CHAR), ('br', 0x14),
        b'\xd1\x66' + u30(MN_TYPE) + b'\xd1\x66' + u30(MN_TYPE_CHAR), ('br', 0x13),
        b'\xd2\x24\x00', ('br', 0x0c),
        b'\xd1\x66' + u30(MN_MAXHP) + b'\x25' + u30(mult)
        + b'\xa2\x90\x73\x63' + u30(2),
    ]
    sizes = [4 if isinstance(p, tuple) else len(p) for p in parts]
    total = sum(sizes)
    out, pos = bytearray(), 0
    for p, sz in zip(parts, sizes):
        out += (bytes([p[1]]) + s24(total - (pos + 4))) if isinstance(p, tuple) else p
        pos += sz
    return bytes(out)

def patch_damage(raw, mult):
    code_start = find_once(raw, OLD_DMG_PROLOGUE, 'prolog damage updateHP')
    clen, clen_pos = read_code_length(raw, code_start)
    new_pro  = build_dmg_prologue(mult)
    new_code = new_pro + raw[code_start + 52: code_start + clen]

    old_field = raw[clen_pos: code_start]
    raw[clen_pos: code_start + clen] = u30(len(new_code)) + new_code
    delta = (len(u30(len(new_code))) + len(new_code)) - (len(old_field) + clen)
    a, b = fix_doabc_len(raw, clen_pos, delta)
    print('  [1] updateHP  : prolog 52->%d, code %d->%d, tag %d->%d'
          % (len(new_pro), clen, len(new_code), a, b))
    return raw

# ==================================================== PATCH 2: handweapon guard
# Awal blok try di setupWeapon:
#     GF.removeAllChild(container["handweapon"])
#     GF.removeAllChild(container["weapon"])
# container bisa berupa Skill_XXX yang tidak punya anak itu -> #1069.
SETUP_ANCHOR = bytes.fromhex(
    # GF.removeAllChild(container["handweapon"])
    '60850865016c0d' '2cf254' '66ea47' '4ffa2a01'
    # GF.removeAllChild(container["weapon"])
    '60850865016c0d' '2ce60b' '66ea47' '4ffa2a01'
)
STR_HANDWEAPON = 10866

def build_guard(jump_delta):
    """if (!('handweapon' in container)) goto <akhir blok try>"""
    body = (b'\x2c' + u30(STR_HANDWEAPON)   # pushstring "handweapon"
            + b'\x65\x01'                    # getscopeobject 1
            + b'\x6c' + u30(13)              # getslot 13  (container)
            + b'\xb4')                       # in
    return body + b'\x12' + s24(jump_delta)  # iffalse

def patch_handweapon(raw):
    anchor = find_once(raw, SETUP_ANCHOR, 'awal try setupWeapon')
    clen, clen_pos = read_code_length(raw, anchor - 122)
    code_start = anchor - 122
    code = bytes(raw[code_start: code_start + clen])
    if clen != 524:
        sys.exit('panjang setupWeapon tak terduga: %d' % clen)

    # ukuran guard tetap: 3 (pushstring) + 2 + 2 + 1 + 4 = 12
    guard_len = len(build_guard(0))
    # iffalse melompat ke offset 463 lama (= 'jump L523'), setelah digeser
    target_new = 463 + guard_len
    after_operand = 122 + guard_len          # posisi tepat setelah operand s24
    guard = build_guard(target_new - after_operand)
    assert len(guard) == guard_len

    new_code = code[:122] + guard + code[122:]

    # --- baca tabel exception lama ---
    p = code_start + clen
    exc_count, p = read_u30(raw, p)
    excs = []
    for _ in range(exc_count):
        rec = []
        for _ in range(5):
            v, p = read_u30(raw, p)
            rec.append(v)
        excs.append(rec)
    traits_pos = p                            # sisa body disalin apa adanya

    # Titik AWAL try tidak digeser (tetap 122) supaya guard-nya sendiri ikut
    # terlindungi -- kalau container null, `in` melempar #1009 dan tetap
    # ditangkap catch yang sudah ada, persis seperti perilaku lama.
    new_exc = bytearray(u30(exc_count))
    for frm, to, tgt, ty, vn in excs:
        frm = frm + guard_len if frm > 122 else frm
        to  = to  + guard_len if to  >= 122 else to
        tgt = tgt + guard_len if tgt >= 122 else tgt
        for v in (frm, to, tgt, ty, vn):
            new_exc += u30(v)

    old_block = raw[clen_pos: traits_pos]
    new_block = u30(len(new_code)) + new_code + bytes(new_exc)
    raw[clen_pos: traits_pos] = new_block
    delta = len(new_block) - len(old_block)
    a, b = fix_doabc_len(raw, clen_pos, delta)
    print('  [2] setupWeapon: guard +%d byte, code %d->%d, exc %s -> %s, tag %d->%d'
          % (guard_len, clen, len(new_code),
             excs[0][:3], [excs[0][0], excs[0][1] + guard_len,
                           excs[0][2] + guard_len], a, b))
    return raw

# ---------------------------------------------------------------------- main
def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    mult = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_MULT
    if not 1 <= mult <= 32767:
        sys.exit('MULTIPLIER harus 1..32767')

    raw, comp = load_swf(src)
    print('patch:')
    raw = patch_damage(raw, mult)
    raw = patch_handweapon(raw)
    n = save_swf(raw, comp, dst)
    print('\nSELESAI -> %s  (%d byte)' % (dst, n))
    print('dmg musuh = -(maxHP * %d)' % mult)

main()
