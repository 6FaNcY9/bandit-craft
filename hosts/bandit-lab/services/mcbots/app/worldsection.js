'use strict';
// Codec for the world model: one 16x16x16 section as a palette blob, and batch frames of section records.
// Byte for byte the same layout as the Java encoder (SectionCodec); the formats are in the world-model plan.
const crypto = require('node:crypto');

const SY_MIN = -4, SY_MAX = 19;
const CELLS = 4096;
const bad = (what) => new Error('bad ' + what);

const cellIndex = (x, y, z) => (y << 8) | (z << 4) | x;
const nameOf = (state) => { const i = state.indexOf('['); return i < 0 ? state : state.slice(0, i); };
const isAir = (state) => /^minecraft:(cave_|void_)?air$/.test(nameOf(state));
const sectionHash = (blob) => crypto.createHash('sha256').update(blob).digest().subarray(0, 8);
const bitsFor = (n) => (n < 2 ? 0 : 32 - Math.clz32(n - 1)); // ceil(log2(n)); n = 4096 gives 12

function encodeSection(palette, idx) {
  const n = palette.length, bits = bitsFor(n);
  if (n < 1 || n > CELLS || (idx === null) !== (n === 1) || (idx && idx.length !== CELLS)) throw bad('section');
  const strs = palette.map((p) => Buffer.from(p, 'utf8'));
  const out = Buffer.alloc(4 + 2 * n + strs.reduce((a, s) => a + s.length, 0) + (CELLS * bits >> 3));
  out[0] = 1; out[1] = bits; out.writeUInt16LE(n, 2);
  let o = 4;
  for (const s of strs) { o = out.writeUInt16LE(s.length, o); o += s.copy(out, o); }
  let acc = 0, nb = 0; // 4096 * bits is a multiple of 8, so nb is 0 again at the end
  if (bits) for (let i = 0; i < CELLS; i++) {
    if (idx[i] >= n) throw bad('section');
    acc |= idx[i] << nb; nb += bits;
    while (nb >= 8) { out[o++] = acc & 255; acc >>>= 8; nb -= 8; }
  }
  return out;
}

function decodeSection(buf) {
  if (buf.length < 4 || buf[0] !== 1) throw bad('section');
  const bits = buf[1], n = buf.readUInt16LE(2);
  if (n < 1 || n > CELLS || bits !== bitsFor(n)) throw bad('section');
  const palette = [];
  let o = 4;
  for (let i = 0; i < n; i++) {
    if (o + 2 > buf.length) throw bad('section');
    const len = buf.readUInt16LE(o); o += 2;
    if (o + len > buf.length) throw bad('section');
    palette.push(buf.toString('utf8', o, o + len));
    o += len;
  }
  if (buf.length !== o + (CELLS * bits >> 3)) throw bad('section');
  if (bits === 0) return {palette, idx: null};
  const idx = new Uint16Array(CELLS), mask = (1 << bits) - 1;
  let acc = 0, nb = 0;
  for (let i = 0; i < CELLS; i++) {
    while (nb < bits) { acc |= buf[o++] << nb; nb += 8; }
    if ((idx[i] = acc & mask) >= n) throw bad('section');
    acc >>>= bits; nb -= bits;
  }
  return {palette, idx};
}

// Kind 0 section (hash, blob), 1 ungenerated chunk, 2 unknown chunk; only kind 0 carries hash and blob.
function encodeBatch({boot, batch, records}) {
  const head = Buffer.alloc(15);
  head[0] = 1; head.writeBigUInt64LE(boot, 1); head.writeUInt32LE(batch, 9); head.writeUInt16LE(records.length, 13);
  const parts = [head];
  for (const {kind, cx, sy, cz, hash, blob} of records) {
    if (!(kind >= 0 && kind <= 2) || (kind === 0 && hash.length !== 8)) throw bad('batch');
    const r = Buffer.alloc(kind === 0 ? 22 : 10);
    r[0] = kind; r.writeInt32LE(cx, 1); r.writeInt8(sy, 5); r.writeInt32LE(cz, 6);
    parts.push(r);
    if (kind === 0) { hash.copy(r, 10); r.writeUInt32LE(blob.length, 18); parts.push(blob); }
  }
  return Buffer.concat(parts);
}

function decodeBatch(buf) {
  if (buf.length < 15 || buf[0] !== 1) throw bad('batch');
  const boot = buf.readBigUInt64LE(1), batch = buf.readUInt32LE(9), count = buf.readUInt16LE(13);
  const records = [];
  let o = 15;
  for (let i = 0; i < count; i++) {
    if (o + 10 > buf.length || buf[o] > 2) throw bad('batch');
    const rec = {kind: buf[o], cx: buf.readInt32LE(o + 1), sy: buf.readInt8(o + 5), cz: buf.readInt32LE(o + 6)};
    o += 10;
    if (rec.kind === 0) {
      if (o + 12 > buf.length) throw bad('batch');
      const len = buf.readUInt32LE(o + 8);
      if (o + 12 + len > buf.length) throw bad('batch');
      rec.hash = buf.subarray(o, o + 8); rec.blob = buf.subarray(o + 12, o + 12 + len);
      o += 12 + len;
    }
    records.push(rec);
  }
  if (o !== buf.length) throw bad('batch');
  return {boot, batch, records};
}

module.exports = {encodeSection, decodeSection, sectionHash, encodeBatch, decodeBatch, cellIndex, nameOf, isAir, SY_MIN, SY_MAX};
