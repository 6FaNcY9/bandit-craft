'use strict';
const assert = require('node:assert/strict');
// The castle rock (owner 2026-11-19): a 'rock' zone keeps mining out of the natural rock, while builds there go on
// (no protected area: build.js refuses every plan cell inside one). Own process: it sets the active zone list.
module.exports = async () => {
  const {Vec3} = require('vec3');
  const P = require('../../places');
  const {JOBS} = require('../../bots');
  const pl = new P.Places();
  pl.list = [P.clean({name: 'Burg-Fels', kind: 'rock', box: {x1: 0, y1: 50, z1: 0, x2: 9, y2: 70, z2: 9}})];
  P.use(pl);
  assert.deepStrictEqual(P.rockBoxes(), [[0, 0, 9, 9, 50, 70]], 'the rock zone with its height');
  assert.deepStrictEqual(P.protectedBoxes(pl.list), [], 'and no protected area');

  // A mine job sees stone only in the zone: it takes none of it. Above the zone the stone counts as free (the fake walk
  // there fails, so the job ends with that block blocked).
  const registry = require('minecraft-data')('26.1');
  const mineIn = (rock) => {
    const bot = {entity: {position: new Vec3(5, 61, 5)}, registry, inventory: {items: () => []}, findBlock: () => null, findBlocks: () => rock,
      world: {getColumn: () => null}, nearestEntity: () => null, game: {dimension: 'overworld'}, time: {timeOfDay: 1000}, on() {}, once() {},
      blockAt: (p) => ({name: 'stone', type: registry.blocksByName.stone.id, position: p, boundingBox: 'block'}),
      pathfinder: {searchRadius: 100, stop() {}, setGoal() {}, goto: async (g) => { throw new Error(`not expected: a walk to ${g.x} ${g.y} ${g.z}`); }}};
    const r = {name: 'bot1', emit() {}, log() {}, bot, supplyChest: null, protectedAreas: [], world: null, skip: new Map(), unreached: new Map(), acquireFailed: new Map(), conflict() {},
      combat: {busy: false, hostilesNear: () => [], fit: () => true}, moves: null};
    return JOBS.mine(r, {id: 1, type: 'mine', args: {block: 'stone', count: 1}, t: {upkeep: true}, collected: 0, progress: '', noFar: true}).then(() => 'ok', (e) => e.message);
  };
  assert.match(await mineIn([new Vec3(6, 60, 5)]), /^no free stone within 64 blocks .*seen 1, 0 outside base and protected areas/, 'no stone from the castle rock');
  assert.match(await mineIn([new Vec3(6, 75, 5)]), /seen 1, 1 outside base and protected areas, 1 within leash 64, 1 blocked/, 'above the zone it is free (the zone keeps its height)');

  // Walks dig no natural rock in the zone either (bot1's walk to the spruce wood dug down to Y -4 under the castle's
  // west edge, 2026-11-19); soil, grass and leaves stay free, so a walk over the hill still finds its way.
  const {safeMovements} = require('../../bots');
  const walker = Object.assign(new (require('node:events'))(), {registry, entity: {position: new Vec3(0, 64, 0)}, pathfinder: {}, blockAt: () => null});
  const cost = (r, name, x, y, z) => safeMovements(walker, [], r).exclusionAreasBreak.reduce((a, f) => a + f({type: registry.blocksByName[name].id, name, position: new Vec3(x, y, z), boundingBox: 'block'}), 0);
  for (const r of [{current: {type: 'goto'}}, {current: {type: 'schematic'}, planVeto: true}, null]) {
    const who = r?.current?.type || 'no job';
    for (const name of ['stone', 'deepslate', 'granite', 'iron_ore', 'deepslate_coal_ore']) assert.ok(cost(r, name, 5, 60, 5) >= 100, `${who}: a walk leaves ${name} of the castle rock standing`);
    for (const name of ['dirt', 'grass_block', 'oak_leaves', 'short_grass']) assert.strictEqual(cost(r, name, 5, 60, 5), 0, `${who}: ${name} in the zone is still dug`);
    assert.strictEqual(cost(r, 'stone', 5, 75, 5), 0, `${who}: stone above the zone is still dug`);
    assert.strictEqual(cost(r, 'stone', 20, 60, 5), 0, `${who}: stone beside the zone is still dug`);
  }
};
