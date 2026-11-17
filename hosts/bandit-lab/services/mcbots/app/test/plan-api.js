'use strict';
const assert = require('node:assert');
const {handle} = require('../planapi');
const {Projects} = require('../projects');
const u = (q) => new URL('http://x/api/plan/status' + q);
const projects = {get: (b) => ({bot1: {type: 'schematic', args: {file: 'a.litematic', origin: {x: 1, y: 64, z: -3}, rotation: 90, mirror: 'none', chests: [{x: 0, y: 0, z: 0}], substitute: {smooth_stone: 'cobblestone'}}}, bot2: {type: 'shaft', args: {}}}[b] || null)};
const asked = [];
const model = {request: async (op, args) => { asked.push([op, args]); return {status: 200, type: 'application/json', body: Buffer.from('gz'), gzip: true}; }};
const ctx = {model, projects, dir: '/s'};
(async () => {
  let r = await handle('GET', u('?bot=bot1'), ctx);
  assert.deepStrictEqual([r[0], r[1]['Content-Type'], r[1]['Content-Encoding'], String(r[2])], [200, 'application/json', 'gzip', 'gz']);
  assert.deepStrictEqual(asked.pop(), ['planStatus', {dir: '/s', file: 'a.litematic', origin: {x: 1, y: 64, z: -3}, rotation: 90, mirror: 'none', substitute: {smooth_stone: 'cobblestone'}, anySolid: []}]);
  await handle('GET', u('?file=b.litematic&origin=-323,104,-30'), ctx);
  assert.deepStrictEqual(asked.pop()[1], {dir: '/s', file: 'b.litematic', origin: {x: -323, y: 104, z: -30}, rotation: 0, mirror: 'none', substitute: {}, anySolid: []});
  for (const [q, code] of [['?bot=bot2', 404], ['?bot=nobody', 404], ['', 400], ['?bot=bot1&file=a.litematic&origin=0,0,0', 400], ['?file=../x.litematic&origin=0,0,0', 400],
    ['?file=a.litematic', 400], ['?file=a.litematic&origin=1,2', 400], ['?file=a.litematic&origin=1,999,2', 400], ['?file=a.litematic&origin=1.5,2,3', 400]]) assert.strictEqual((await handle('GET', u(q), ctx))[0], code, q);
  assert.strictEqual(asked.length, 0, 'a refused request never reaches the worker');   // Review Focus 4: a bot without a schematic project
  assert.strictEqual((await handle('POST', u('?bot=bot1'), ctx))[0], 404);
  assert.strictEqual((await handle('GET', u('?bot=bot1'), {...ctx, model: null}))[0], 503);
  const p = new Projects('');
  p.note('bot1', 'schematic', {file: 'a.litematic', origin: {x: 1, y: 2, z: 3}, rotation: 0});
  p.note('bot2', 'shaft', {x: 1});
  assert.deepStrictEqual([p.view().bot1.file, p.view().bot1.origin, 'file' in p.view().bot2], ['a.litematic', [1, 2, 3], false]);
})().catch((e) => { console.error(e); process.exit(1); });
