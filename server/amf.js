'use strict';
/* Minimal AMF0 + AMF3 codec for Flash Remoting (Zend AMF style). */

// ---------------- Reader ----------------
class Reader {
  constructor(buf) {
    this.b = buf; this.p = 0;
    this.s3 = []; this.o3 = []; this.t3 = [];  // AMF3 ref tables
    this.o0 = [];
  }
  u8()  { return this.b[this.p++]; }
  u16() { const v = this.b.readUInt16BE(this.p); this.p += 2; return v; }
  u32() { const v = this.b.readUInt32BE(this.p); this.p += 4; return v; }
  dbl() { const v = this.b.readDoubleBE(this.p); this.p += 8; return v; }
  utf(n){ const v = this.b.toString('utf8', this.p, this.p + n); this.p += n; return v; }

  u29() {
    let b = this.b[this.p++];
    if (b < 128) return b;
    let v = (b & 0x7F) << 7;
    b = this.b[this.p++];
    if (b < 128) return v | b;
    v = (v | (b & 0x7F)) << 7;
    b = this.b[this.p++];
    if (b < 128) return v | b;
    v = (v | (b & 0x7F)) << 8;
    b = this.b[this.p++];
    return v | b;
  }

  // ---- AMF3 ----
  str3() {
    const h = this.u29();
    if ((h & 1) === 0) return this.s3[h >> 1];
    const s = this.utf(h >> 1);
    if (s !== '') this.s3.push(s);
    return s;
  }

  val3() {
    const m = this.u8();
    switch (m) {
      case 0x00: return undefined;
      case 0x01: return null;
      case 0x02: return false;
      case 0x03: return true;
      case 0x04: { let i = this.u29(); if (i > 0x0FFFFFFF) i -= 0x20000000; return i; }
      case 0x05: return this.dbl();
      case 0x06: return this.str3();
      case 0x08: { const h = this.u29(); if ((h & 1) === 0) return this.o3[h >> 1];
                   const d = new Date(this.dbl()); this.o3.push(d); return d; }
      case 0x09: return this.arr3();
      case 0x0A: return this.obj3();
      case 0x0C: { const h = this.u29(); if ((h & 1) === 0) return this.o3[h >> 1];
                   const ba = this.b.slice(this.p, this.p + (h >> 1)); this.p += (h >> 1);
                   this.o3.push(ba); return ba; }
      case 0x07:
      case 0x0B: return this.str3();
      default: throw new Error('AMF3 marker tak dikenal: 0x' + m.toString(16));
    }
  }

  arr3() {
    const h = this.u29();
    if ((h & 1) === 0) return this.o3[h >> 1];
    const dense = h >> 1;
    const out = []; this.o3.push(out);
    let assoc = null;
    for (;;) {
      const k = this.str3();
      if (k === '') break;
      assoc = assoc || {};
      assoc[k] = this.val3();
    }
    for (let i = 0; i < dense; i++) out.push(this.val3());
    if (assoc) { for (const k in assoc) out[k] = assoc[k]; }
    return out;
  }

  obj3() {
    const h = this.u29();
    if ((h & 1) === 0) return this.o3[h >> 1];
    let traits;
    if ((h & 2) === 0) {
      traits = this.t3[h >> 2];
    } else if ((h & 4) !== 0) {
      // externalizable — tidak didukung, kembalikan objek kosong
      const cn = this.str3();
      const o = { __class: cn, __externalizable: true };
      this.o3.push(o);
      return o;
    } else {
      const dynamic = (h & 8) !== 0;
      const count = h >> 4;
      const cn = this.str3();
      const props = [];
      for (let i = 0; i < count; i++) props.push(this.str3());
      traits = { cn, dynamic, props };
      this.t3.push(traits);
    }
    const o = {}; this.o3.push(o);
    if (traits.cn) o.__class = traits.cn;
    for (const p of traits.props) o[p] = this.val3();
    if (traits.dynamic) {
      for (;;) { const k = this.str3(); if (k === '') break; o[k] = this.val3(); }
    }
    return o;
  }

  // ---- AMF0 ----
  val0() {
    const m = this.u8();
    switch (m) {
      case 0x00: return this.dbl();
      case 0x01: return this.u8() !== 0;
      case 0x02: return this.utf(this.u16());
      case 0x03: return this.obj0({});
      case 0x05: return null;
      case 0x06: return undefined;
      case 0x07: return this.o0[this.u16()];
      case 0x08: { this.u32(); return this.obj0({}); }
      case 0x0A: { const n = this.u32(); const a = []; this.o0.push(a);
                   for (let i = 0; i < n; i++) a.push(this.val0()); return a; }
      case 0x0B: { const t = this.dbl(); this.u16(); return new Date(t); }
      case 0x0C: return this.utf(this.u32());
      case 0x10: { const cn = this.utf(this.u16()); const o = this.obj0({}); o.__class = cn; return o; }
      case 0x11: { const r = new Reader(this.b); r.p = this.p; const v = r.val3(); this.p = r.p; return v; }
      case 0x0D: return undefined;
      default: throw new Error('AMF0 marker tak dikenal: 0x' + m.toString(16));
    }
  }

  obj0(o) {
    this.o0.push(o);
    for (;;) {
      const k = this.utf(this.u16());
      if (k === '') { this.u8(); break; }   // 0x09 end
      o[k] = this.val0();
    }
    return o;
  }
}

// ---------------- Writer ----------------
class Writer {
  constructor() { this.c = []; this.s3 = new Map(); }
  push(b) { this.c.push(b); }
  u8(v)  { this.push(Buffer.from([v & 0xFF])); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xFFFF); this.push(b); }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); this.push(b); }
  dbl(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.push(b); }
  raw(b) { this.push(b); }
  utf(s) { const b = Buffer.from(s, 'utf8'); this.u16(b.length); this.push(b); }
  buf()  { return Buffer.concat(this.c); }

  u29(v) {
    v &= 0x1FFFFFFF;
    if (v < 0x80) this.push(Buffer.from([v]));
    else if (v < 0x4000) this.push(Buffer.from([(v >> 7) | 0x80, v & 0x7F]));
    else if (v < 0x200000) this.push(Buffer.from([(v >> 14) | 0x80, ((v >> 7) & 0x7F) | 0x80, v & 0x7F]));
    else this.push(Buffer.from([(v >> 22) | 0x80, ((v >> 15) & 0x7F) | 0x80, ((v >> 8) & 0x7F) | 0x80, v & 0xFF]));
  }

  str3(s) {
    if (s === '') { this.u29(1); return; }
    if (this.s3.has(s)) { this.u29(this.s3.get(s) << 1); return; }
    this.s3.set(s, this.s3.size);
    const b = Buffer.from(s, 'utf8');
    this.u29((b.length << 1) | 1);
    this.push(b);
  }

  val3(v) {
    if (v === undefined) return this.u8(0x00);
    if (v === null)      return this.u8(0x01);
    if (v === false)     return this.u8(0x02);
    if (v === true)      return this.u8(0x03);
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= -0x10000000 && v <= 0x0FFFFFFF) { this.u8(0x04); return this.u29(v); }
      this.u8(0x05); return this.dbl(v);
    }
    if (typeof v === 'string') { this.u8(0x06); return this.str3(v); }
    if (v instanceof Date)     { this.u8(0x08); this.u29(1); return this.dbl(v.getTime()); }
    if (Buffer.isBuffer(v))    { this.u8(0x0C); this.u29((v.length << 1) | 1); return this.push(v); }
    if (Array.isArray(v)) {
      this.u8(0x09); this.u29((v.length << 1) | 1); this.str3('');
      for (const x of v) this.val3(x);
      return;
    }
    // objek anonim dinamis
    this.u8(0x0A);
    this.u29(0x0B);       // traits: dynamic, 0 sealed prop, bukan externalizable
    this.str3('');        // nama kelas kosong
    for (const k of Object.keys(v)) {
      if (k === '__class') continue;
      this.str3(k); this.val3(v[k]);
    }
    this.str3('');
    return;
  }

  val0(v) {
    if (v === null)      return this.u8(0x05);
    if (v === undefined) return this.u8(0x06);
    if (typeof v === 'boolean') { this.u8(0x01); return this.u8(v ? 1 : 0); }
    if (typeof v === 'number')  { this.u8(0x00); return this.dbl(v); }
    if (typeof v === 'string')  {
      const b = Buffer.from(v, 'utf8');
      if (b.length <= 0xFFFF) { this.u8(0x02); this.u16(b.length); return this.push(b); }
      this.u8(0x0C); this.u32(b.length); return this.push(b);
    }
    if (v instanceof Date) { this.u8(0x0B); this.dbl(v.getTime()); return this.u16(0); }
    if (Array.isArray(v))  { this.u8(0x0A); this.u32(v.length); for (const x of v) this.val0(x); return; }
    this.u8(0x03);
    for (const k of Object.keys(v)) {
      if (k === '__class') continue;
      this.utf(k); this.val0(v[k]);
    }
    this.utf(''); this.u8(0x09);
  }
}

// ---------------- Paket Flash Remoting ----------------
function decodePacket(buf) {
  const r = new Reader(buf);
  const version = r.u16();
  const nh = r.u16();
  const headers = [];
  for (let i = 0; i < nh; i++) {
    const name = r.utf(r.u16());
    const must = r.u8() !== 0;
    r.u32();
    headers.push({ name, must, data: r.val0() });
  }
  const nb = r.u16();
  const bodies = [];
  for (let i = 0; i < nb; i++) {
    const target = r.utf(r.u16());
    const response = r.utf(r.u16());
    r.u32();                       // panjang body (sering 0xFFFFFFFF)
    const rr = new Reader(buf);
    rr.p = r.p;
    const marker = buf[rr.p];
    const amf3 = marker === 0x11;
    const data = rr.val0();
    r.p = rr.p;
    bodies.push({ target, response, amf3, data });
  }
  return { version, headers, bodies };
}

function encodePacket(bodies, amf3) {
  const w = new Writer();
  w.u16(amf3 ? 3 : 0);
  w.u16(0);
  w.u16(bodies.length);
  for (const b of bodies) {
    w.utf(b.target);
    w.utf(b.response || '');
    const bw = new Writer();
    if (amf3) { bw.u8(0x11); bw.val3(b.data); }
    else bw.val0(b.data);
    const body = bw.buf();
    w.u32(body.length);
    w.raw(body);
  }
  return w.buf();
}

module.exports = { decodePacket, encodePacket, Reader, Writer };
