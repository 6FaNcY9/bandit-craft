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

  // Walks dig no natural rock in the zone either, so none tunnels through the castle rock; soil, grass and leaves stay
  // free, so a walk over the hill still finds its way. (bot1's dig-down to Y -4 lay below the zone and beside it: the
  // walk legs' height limit covers that.)
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

  // Nor a night hole (three down) or a crafting niche beside a walled-in bot in its rock; in soil both still go.
  const {nightShelter} = require('../../bots');
  const hole = (ground) => {
    const dug = new Set();
    const solid = (p) => p.y <= 60 && !(p.x === 5 && p.z === 5 && dug.has(p.y));
    const bot = {time: {timeOfDay: 14000}, entity: {position: new Vec3(5.5, 61, 5.5)}, inventory: {items: () => [{name: 'dirt'}]},
      blockAt: (p) => (solid(p) ? {name: ground, boundingBox: 'block', position: p, skyLight: 0, getProperties: () => ({})} : {name: 'air', boundingBox: 'empty', position: p, skyLight: 15, getProperties: () => ({})}),
      dig: async (b) => { dug.add(b.position.y); bot.entity.position = new Vec3(5.5, b.position.y, 5.5); },
      equip: async () => {}, placeBlock: async () => { bot.time.timeOfDay = 1000; }};
    return nightShelter({bot, protectedAreas: [], emit() {}}, {type: 'chop', t: {}, cancelled: false}).then(() => dug.size);
  };
  assert.strictEqual(await hole('stone'), 0, 'no night hole in the castle rock');
  assert.ok(await hole('dirt') > 0, 'a night hole in its soil');
  const {placeNear} = require('../../crafting');
  const niche = (wall) => {
    const dug = new Set(), placed = new Set(), key = (p) => `${p.x},${p.y},${p.z}`;
    const bot = {entity: {position: new Vec3(5.5, 61, 5.5)}, inventory: {items: () => [{name: 'crafting_table', count: 1}]},
      blockAt: (p) => {
        if (placed.has(key(p))) return {name: 'crafting_table', boundingBox: 'block', position: p};
        const solid = !(p.x === 5 && p.z === 5 && p.y >= 61) && !dug.has(key(p)) && p.y <= 62;
        return solid ? {name: p.y <= 60 ? 'stone' : wall, boundingBox: 'block', position: p} : {name: 'air', boundingBox: 'empty', position: p};
      },
      dig: async (b) => { dug.add(key(b.position)); }, equip: async () => {},
      placeBlock: async (ref, face) => { placed.add(key(ref.position.plus(face))); }};
    return placeNear(bot, 'crafting_table', []).then((b) => `placed at ${b.position.y}`, (e) => e.message);
  };
  assert.strictEqual(await niche('stone'), 'no free spot next to the bot to place crafting_table', 'no niche in the castle rock');
  assert.strictEqual(await niche('dirt'), 'placed at 61', 'a niche in its soil');
};
