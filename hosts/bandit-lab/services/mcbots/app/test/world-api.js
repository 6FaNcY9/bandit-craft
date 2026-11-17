'use strict';
// World API: the area text, which RCON commands change blocks, and the /api/world/* routes in front of the model.
const assert = require('node:assert');
const {parseArea, dirtyBoxes, withDirty, handle} = require('../worldapi');

assert.deepStrictEqual(parseArea('-270,-20,320'), {cx1: -37, cz1: -22, cx2: 3, cz2: 18});
assert.throws(() => parseArea('-270,-20'), /WORLD_AREA/);
for (const bad of ['a,b,c', '1,2,0', '1,2,-5', '1.5,2,3', ' ']) assert.throws(() => parseArea(bad), /WORLD_AREA/, bad);

assert.deepStrictEqual(dirtyBoxes('fill -3 70 -3 3 70 3 minecraft:stone'), [{x1: -3, y1: 70, z1: -3, x2: 3, y2: 70, z2: 3}]);
assert.deepStrictEqual(dirtyBoxes('/minecraft:setblock -323 105 -30 minecraft:chest[facing=north]'), [{x1: -323, y1: 105, z1: -30, x2: -323, y2: 105, z2: -30}]);
assert.deepStrictEqual(dirtyBoxes('fill ~ ~ ~ ~1 ~ ~ stone'), []);
assert.deepStrictEqual(dirtyBoxes('setblock ^ ^ ^1 stone'), []);
assert.deepStrictEqual(dirtyBoxes('minecraft:list'), []);

(async () => {
  const seen = [];
  const call = withDirty(async (c) => c.map(() => 'ok'), (b) => seen.push(b));
  assert.deepStrictEqual(await call(['setblock 1 2 3 stone', 'tps']), ['ok', 'ok']);
  assert.strictEqual(seen.length, 1);
  await assert.rejects(withDirty(async () => { throw new Error('rcon'); }, (b) => seen.push(b))(['setblock 1 2 3 stone']));
  assert.strictEqual(seen.length, 1, 'a rejected call reports nothing');

  const u = (p) => new URL('http://x' + p);
  const off = await handle('GET', u('/api/world/blocks?x1=0'), null);
  assert.deepStrictEqual([off[0], JSON.parse(off[2])], [503, {error: 'world model is off'}]);
  assert.deepStrictEqual([(await handle('GET', u('/api/world/nope'), null))[0], (await handle('POST', u('/api/world/stats'), null))[0]], [503, 404], 'off: every GET is 503, a POST is still 404');
  const asked = [];
  const model = {request: async (op, args) => { asked.push([op, args]); return {status: 200, type: 'application/json', body: Buffer.from(JSON.stringify({op, args}))}; }};
  const [code, headers, body] = await handle('GET', u('/api/world/height?x1=1&z1=2&x2=3&z2=4'), model);
  assert.deepStrictEqual([code, headers['Content-Type'], JSON.parse(body)], [200, 'application/json', {op: 'height', args: {x1: '1', z1: '2', x2: '3', z2: '4'}}]);
  assert.strictEqual((await handle('GET', u('/api/world/nope'), model))[0], 404);
  assert.strictEqual((await handle('POST', u('/api/world/blocks'), model))[0], 404);
  const gz = await handle('GET', u('/api/world/sections?cx=0&cz=0&r=1'), {request: async () => ({status: 200, type: 'application/octet-stream', body: Buffer.alloc(1), gzip: true})});
  assert.strictEqual(gz[1]['Content-Encoding'], 'gzip');
  assert.strictEqual((await handle('GET', u('/api/world/stats'), model))[1]['Content-Encoding'], undefined);

  // only the documented arguments reach the worker: changes gets `since` (no limit), sample n/seed/box
  asked.length = 0;
  await handle('GET', u('/api/world/changes?since=7&limit=99999'), model);
  await handle('GET', u('/api/world/sample?n=5&seed=1&box=0,0,0,1,1,1&x=evil'), model);
  await handle('GET', u('/api/world/sections?cx=1&cz=2&r=3&x=evil'), model);
  await handle('GET', u('/api/world/stats?x=evil'), model);
  assert.deepStrictEqual(asked, [['changes', {since: '7'}], ['sample', {n: '5', seed: '1', box: '0,0,0,1,1,1'}], ['sections', {cx: '1', cz: '2', r: '3'}], ['stats', {}]]);
  console.log('world-api ok');
})();
