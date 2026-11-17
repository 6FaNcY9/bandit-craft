'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openStore} = require('../worldstore');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-'));
try {
  let st = openStore(dir);
  const A = Buffer.from('a'), hA = Buffer.alloc(8, 1), hB = Buffer.alloc(8, 2);
  assert.strictEqual(st.chunk(-37, -22), 'unknown');
  assert.strictEqual(st.put(-37, -4, -22, hA, A), true);
  assert.strictEqual(st.put(-37, -4, -22, hA, A), false);              // same hash: no change
  assert.strictEqual(st.seq(), 1);
  assert.strictEqual(st.put(-37, -4, -22, hB, Buffer.from('b')), true);
  assert.strictEqual(st.seq(), 2);
  assert.strictEqual(st.chunk(-37, -22), 'unknown');                   // 1 of 24 sections
  for (let sy = -3; sy <= 19; sy++) st.put(-37, sy, -22, hA, A);
  assert.strictEqual(st.chunk(-37, -22), 'known');
  assert.deepStrictEqual(st.get(-37, -4, -22), Buffer.from('b'));
  assert.strictEqual(st.get(0, 0, 0), null);
  assert.strictEqual(st.markUngenerated(3, 18), true);
  assert.strictEqual(st.chunk(3, 18), 'ungenerated');
  assert.strictEqual(st.markUngenerated(-37, -22), false);             // has sections
  st.put(3, 0, 18, hA, A);
  assert.strictEqual(st.chunk(3, 18), 'unknown');                      // generated meanwhile
  const page = st.since(2, 10);
  assert.strictEqual(page.sections.length, 10); assert.strictEqual(page.more, true);
  assert.deepStrictEqual(st.since(st.seq(), 10), {seq: st.seq(), sections: [], more: false});
  st.close(); st = openStore(dir);                                     // survives a restart
  assert.strictEqual(st.chunk(-37, -22), 'known'); assert.strictEqual(st.counts().sections, 25);

  // seq continues from the stored max after a restart
  assert.strictEqual(st.seq(), 26);
  assert.strictEqual(st.put(9, 0, 9, hA, A), true);
  assert.strictEqual(st.seq(), 27);
  // a page ends at its last seq; the next page continues from there
  const p1 = st.since(0, 20), p2 = st.since(p1.seq, 20);
  assert.strictEqual(p1.sections.length, 20); assert.strictEqual(p1.more, true); assert.strictEqual(p1.seq, 21);  // seq 1 was overwritten by seq 2, so the 20 oldest are 2..21
  assert.strictEqual(p2.sections.length, 6); assert.strictEqual(p2.more, false); assert.strictEqual(p2.seq, 27);
  assert.deepStrictEqual(st.since(26, 5).sections, [[9, 0, 9]]);
  // blobs come back as Buffers; the caller's view is copied, not kept
  const big = Buffer.from('xxabcxx'), view = big.subarray(2, 5);
  st.put(5, 0, 5, hA, view); big.fill(0);
  assert.ok(Buffer.isBuffer(st.get(5, 0, 5)));
  assert.deepStrictEqual(st.get(5, 0, 5), Buffer.from('abc'));
  // column is ordered by sy and carries hash and blob
  const col = st.column(-37, -22);
  assert.strictEqual(col.length, 24); assert.strictEqual(col[0].sy, -4); assert.strictEqual(col[23].sy, 19);
  assert.deepStrictEqual(col[0], {sy: -4, hash: hB, blob: Buffer.from('b')});
  assert.deepStrictEqual(st.column(99, 99), []);
  // ungenerated marks are counted and persist; marking twice is fine
  assert.strictEqual(st.markUngenerated(7, 7), true); assert.strictEqual(st.markUngenerated(7, 7), true);
  assert.deepStrictEqual(st.counts(), {sections: 27, ungenerated: 1});
  // tx: result passes through, nesting joins the outer one, a throw rolls everything back
  assert.strictEqual(st.tx(() => st.tx(() => 'ok')), 'ok');
  const before = st.seq();
  assert.throws(() => st.tx(() => { st.put(8, 0, 8, hA, A); throw new Error('boom'); }), /boom/);
  assert.strictEqual(st.get(8, 0, 8), null); assert.strictEqual(st.seq(), before);
  st.tx(() => { st.put(8, 0, 8, hA, A); st.put(8, 1, 8, hA, A); });
  assert.strictEqual(st.seq(), before + 2);
  st.close(); st = openStore(dir);
  assert.deepStrictEqual(st.counts(), {sections: 29, ungenerated: 1});
  st.close();
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
