#!/usr/bin/env python3
"""
Patch BattleProcessor.updateHP (method 1514) di code_library.swf.
Basis: code_library.swf1 (versi yang battle-nya normal).

Perubahan: konstanta `pushshort 999999` (yang terpotong jadi 16959 oleh
Flash karena pushshort = signed 16-bit) diganti dengan perhitungan
berbasis HP target, sehingga damage selalu cukup untuk one-hit kill.

  dmg = -(target.maxHP * MULTIPLIER)
"""
import sys, zlib, struct
sys.path.insert(0, '/home/claude/ns')
import avm2 as A

MULTIPLIER = 10          # ubah di sini kalau mau angka lain
SRC  = '/home/claude/ns/old.raw'      # = code_library.swf1 (dekompresi)
OUT  = '/mnt/user-data/outputs/code_library.swf'

# ---- index constant pool (dari file ini, jangan diubah) ----
MN_ATTACKER       = 1184
MN_TYPE           = 9230
MN_TYPE_CHARACTER = 871
MN_MAXHP          = 9280
MN_HP             = 9285

def u30(v):
    out = bytearray()
    while True:
        b = v & 0x7f
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)

def s24(v):
    if v < 0:
        v += 1 << 24
    return bytes([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff])

class Asm:
    """Mini-assembler dengan satu label ('SKIP') di akhir prologue."""
    def __init__(self):
        self.parts = []          # list of (bytes) atau ('br', opcode)
    def raw(self, b):   self.parts.append(b)
    def br(self, op):   self.parts.append(('br', op))

    def getlocal0(self):        self.raw(b'\xd0')
    def getlocal1(self):        self.raw(b'\xd1')
    def getlocal2(self):        self.raw(b'\xd2')
    def pushscope(self):        self.raw(b'\x30')
    def pushnull(self):         self.raw(b'\x20')
    def pushbyte(self, v):      self.raw(b'\x24' + bytes([v & 0xff]))
    def pushshort(self, v):     self.raw(b'\x25' + u30(v))
    def getproperty(self, mn):  self.raw(b'\x66' + u30(mn))
    def multiply(self):         self.raw(b'\xa2')
    def negate(self):           self.raw(b'\x90')
    def convert_i(self):        self.raw(b'\x73')
    def setlocal(self, n):      self.raw(b'\x63' + u30(n))

    def assemble(self):
        # panjang tiap bagian: branch = 1 opcode + 3 byte s24
        sizes = [4 if isinstance(p, tuple) else len(p) for p in self.parts]
        total = sum(sizes)
        out = bytearray()
        pos = 0
        for p, sz in zip(self.parts, sizes):
            if isinstance(p, tuple):
                after = pos + 4              # s24 relatif terhadap byte SETELAH operand
                out += bytes([p[1]]) + s24(total - after)
            else:
                out += p
            pos += sz
        return bytes(out)


def build_prologue():
    a = Asm()
    a.getlocal0(); a.pushscope()                       # prolog wajib

    # if (this.attacker == null) goto SKIP
    a.getlocal0(); a.getproperty(MN_ATTACKER); a.pushnull()
    a.br(0x13)                                          # ifeq

    # if (this.attacker.type != target.TYPE_CHARACTER) goto SKIP
    a.getlocal0(); a.getproperty(MN_ATTACKER); a.getproperty(MN_TYPE)
    a.getlocal1(); a.getproperty(MN_TYPE_CHARACTER)
    a.br(0x14)                                          # ifne

    # if (target.type == target.TYPE_CHARACTER) goto SKIP   (jangan sakiti player)
    a.getlocal1(); a.getproperty(MN_TYPE)
    a.getlocal1(); a.getproperty(MN_TYPE_CHARACTER)
    a.br(0x13)                                          # ifeq

    # if (!(dmg < 0)) goto SKIP   (hanya untuk serangan, bukan heal)
    a.getlocal2(); a.pushbyte(0)
    a.br(0x0c)                                          # ifnlt

    # dmg = -(target.maxHP * MULTIPLIER)
    a.getlocal1(); a.getproperty(MN_MAXHP)
    a.pushshort(MULTIPLIER)
    a.multiply(); a.negate(); a.convert_i()
    a.setlocal(2)
    return a.assemble()


def main():
    raw = open(SRC, 'rb').read()
    tags = A.find_abc(raw)
    abc_tag = next(t for t in tags if t[0] == 82)
    tag_code, tag_pos, tag_len = abc_tag
    r = A.R(raw, tag_pos); r.p += 4; r.utf()
    abc_start = r.p
    abc = A.ABC(raw[abc_start:tag_pos + tag_len])

    b = abc.body_by_method[1514]
    old = b['code']

    # sanity check: prologue lama harus persis 52 byte & diakhiri pushshort 999999
    assert old[45:52] == bytes.fromhex('25bf843d906302'), \
        'prologue lama tidak dikenali: ' + old[45:52].hex()

    new_pro = build_prologue()
    new_code = new_pro + old[52:]

    print(f'prologue lama : 52 byte')
    print(f'prologue baru : {len(new_pro)} byte')
    print(f'code_length   : {len(old)} -> {len(new_code)}')

    # rakit ulang method_body
    body = (u30(b['method']) + u30(b['max_stack']) + u30(b['local_count'])
            + u30(b['init_scope']) + u30(b['max_scope'])
            + u30(len(new_code)) + new_code)
    tail_start = b['code_pos'] + b['clen']
    body += raw[abc_start + tail_start: abc_start + b['end']]

    # splice ke dalam file mentah
    out = bytearray(raw)
    out[abc_start + b['start']: abc_start + b['end']] = body
    delta = len(body) - (b['end'] - b['start'])

    # perbaiki panjang tag DoABC (long-form header: 2 byte kode + 4 byte length)
    hdr = tag_pos - 6
    assert struct.unpack_from('<H', out, hdr)[0] >> 6 == 82
    struct.pack_into('<I', out, hdr + 2, tag_len + delta)

    # perbaiki FileLength di header SWF
    struct.pack_into('<I', out, 4, len(out))

    comp = out[:8] + zlib.compress(bytes(out[8:]), 9)
    open(OUT, 'wb').write(comp)
    print(f'ditulis: {OUT}  ({len(comp)} byte, uncompressed {len(out)})')

    # verifikasi ulang dengan parser
    ver_raw = out[:8] + zlib.decompress(comp[8:])
    open('/home/claude/ns/verify.raw', 'wb').write(bytes(ver_raw))
    v, _, _ = A.load('/home/claude/ns/verify.raw')
    vb = v.body_by_method[1514]
    print('\n--- verifikasi disassembly prologue baru ---')
    for off, op, name, txt in A.disasm(v, vb['code'])[:26]:
        print('%5d: %-14s %s' % (off, name, ' '.join(txt)))
    assert vb['code'][len(new_pro):] == old[52:], 'body sisa tidak cocok!'
    print('\nOK: sisa method identik dengan aslinya, semua method lain utuh.')

main()
