'use strict';
const assert = require('node:assert');
const {VALIDATE} = require('../bots');
// ---- build job: blueprint validation, order, next block (fake world) ----
{
  const B = require('../build');
  { // a double chest half whose partner lies outside the schematic is planned single (sandbox sorter, 2026-10-14)
    const c = (z, type, facing = 'east') => ({x: 0, y: 0, z, name: 'chest', props: {facing, type, waterlogged: 'false'}});
    const types = (cells) => B.loneChests(cells).map((x) => x.props.type);
    assert.deepStrictEqual(types([c(0, 'left'), c(1, 'right')]), ['left', 'right'], 'a whole pair stays');
    assert.deepStrictEqual(types([c(0, 'right')]), ['single'], 'a lone half');
    assert.deepStrictEqual(types([c(0, 'right'), c(1, 'left')]), ['single', 'single'], 'two halves that do not face each other');
    assert.deepStrictEqual(types([c(0, 'left'), c(1, 'right', 'west')]), ['single', 'single'], 'a different facing is no partner');
    assert.deepStrictEqual(types([c(0, 'single')]), ['single']);
  }
  const cube = (n, block = 'cobblestone') => Array.from({length: n}, (_, i) => ({x: i % 3, y: Math.floor(i / 9), z: Math.floor(i / 3) % 3, block}));
  const bp = {origin: {x: 100, y: 64, z: 100}, blocks: cube(18).reverse()};
  const plan = B.validate(bp);
  assert.deepStrictEqual(plan.blocks.slice(0, 2).map((b) => [b.x, b.y, b.z]), [[100, 64, 100], [101, 64, 100]], 'bottom layer first, then z, then x');
  assert.ok(plan.blocks.every((b, i, a) => !i || a[i - 1].y <= b.y));
  assert.deepStrictEqual(B.materials(plan), {cobblestone: 18});
  assert.deepStrictEqual(B.shortfall({cobblestone: 18, stone: 2}, {cobblestone: 20}), {stone: 2}, 'counts of what is missing');
  assert.deepStrictEqual(B.shortfall({cobblestone: 18, stone: 2}, {cobblestone: 5, stone: 2}), {cobblestone: 13});
  assert.deepStrictEqual(B.shortfall({cobblestone: 9}, {cobblestone: 9}), {}, 'nothing missing');
  assert.deepStrictEqual(B.formatShortfall({stone: 2, cobblestone: 13}), ['2 stone', '13 cobblestone']);
  assert.deepStrictEqual(B.countHave([{name: 'cobblestone', count: 40}, {name: 'dirt', count: 3}, {name: 'cobblestone', count: 24}]), {cobblestone: 64, dirt: 3}, 'stacks add up');
  {
    // withdraw only what is missing: 9 needed, 5 carried -> take 4; afterwards nothing is missing
    const need = {cobblestone: 9};
    const before = B.shortfall(need, B.countHave([{name: 'cobblestone', count: 5}]));
    assert.deepStrictEqual(before, {cobblestone: 4});
    assert.deepStrictEqual(B.shortfall(need, B.countHave([{name: 'cobblestone', count: 5 + before.cobblestone}])), {});
  }
  {
    // B4: what to gather, in which order
    const rich = {furnace: true, wood: true, hasFuel: () => true};
    assert.deepStrictEqual(B.gatherPlan({cobblestone: 9}, rich), {jobs: [['mine', {block: 'stone', count: 9}]], unknown: [], total: 9});
    assert.deepStrictEqual(B.gatherPlan({dirt: 4}).jobs, [['mine', {block: 'dirt', count: 4}]]);
    assert.deepStrictEqual(B.gatherPlan({stone: 9}, rich).jobs, [['mine', {block: 'stone', count: 9}], ['smelt', {item: 'cobblestone', count: 9}]], 'furnace and fuel at hand');
    assert.deepStrictEqual(B.gatherPlan({stone: 9}, {furnace: false, wood: true, hasFuel: () => false}).jobs,
      [['mine', {block: 'stone', count: 17}], ['mine', {block: 'coal_ore', count: 2}], ['smelt', {item: 'cobblestone', count: 9}]], '8 more stone for the furnace, coal for fuel');
    assert.deepStrictEqual(B.gatherPlan({stone: 3}, {furnace: false, wood: false, hasFuel: () => true}).jobs.map((j) => j[0]), ['mine', 'chop', 'smelt'], 'a table needs a log');
    assert.deepStrictEqual(B.gatherPlan({stone: 3}, {furnace: true, wood: false, hasFuel: () => true}).jobs.map((j) => j[0]), ['mine', 'smelt'], 'a furnace in reach needs no table');
    assert.deepStrictEqual(B.gatherPlan({stone: 70}, rich).jobs.filter((j) => j[0] === 'smelt').map((j) => j[1].count), [64, 6], 'one furnace load at most');
    assert.deepStrictEqual(B.gatherPlan({cobblestone: 5, stone: 4}, rich).jobs, [['mine', {block: 'stone', count: 9}], ['smelt', {item: 'cobblestone', count: 4}]], 'both mine stone: one job');
    assert.deepStrictEqual(B.gatherPlan({cobblestone: 5, oak_planks: 2, glass: 1}, rich).unknown, ['2 oak_planks', '1 glass'], 'cannot gather yet');
  }
  for (const [bad, re] of [
    [{...bp, blocks: [{x: 0, y: 0, z: 0, block: 'chest'}]}, /cannot be built/],
    [{...bp, blocks: [{x: 0, y: 0, z: 0, block: 'sand'}]}, /cannot be built/],
    [{...bp, blocks: [{x: 0, y: 0, z: 0, block: 'oak_door'}]}, /cannot be built/],
    [{...bp, blocks: [{x: 0, y: 0, z: 0, block: 'Stone'}]}, /cannot be built/],
    [{...bp, blocks: [{x: 0, y: 0, z: 0, block: 'stone'}, {x: 0, y: 0, z: 0, block: 'dirt'}]}, /two blocks/],
    [{...bp, blocks: [{x: 0, y: 0, z: 0, block: 'stone'}, {x: 0, y: 3, z: 0, block: 'stone'}]}, /larger than/],
    [{...bp, blocks: [{x: 0, y: 0, z: 0, block: 'stone'}, {x: 5, y: 0, z: 0, block: 'stone'}]}, /larger than/],
    [{...bp, blocks: Array.from({length: 76}, () => ({x: 0, y: 0, z: 0, block: 'stone'}))}, /at most 75/],
    [{...bp, blocks: []}, /no blocks/],
    [{...bp, origin: {x: 1.5, y: 64, z: 0}}, /whole number/],
  ]) assert.throws(() => B.validate(bad), re);
  assert.ok(B.validate({...bp, blocks: [{x: 0, y: 0, z: 0, block: 'sandstone'}]}), 'sandstone is not a gravity block');
  assert.throws(() => B.validate(bp, [[90, 90, 110, 110]]), /protected area/);
  assert.ok(B.validate(bp, [[0, 0, 10, 10]]));
  // VALIDATE.build keeps the blueprint relative so a resumed job validates the same way.
  assert.deepStrictEqual(VALIDATE.build({origin: {x: '1', y: 64, z: 2}, blocks: [{x: 0, y: '0', z: 0, block: 'dirt'}]}),
    {origin: {x: 1, y: 64, z: 2}, blocks: [{x: 0, y: 0, z: 0, block: 'dirt'}], remove: false});
  // Fake world: ground (stone) at y 63, air above; placing fills the map.
  const world = new Map();
  const nameAt = (x, y, z) => world.get(`${x},${y},${z}`) ?? (y <= 63 ? 'stone' : 'air');
  let s = B.step(plan, nameAt);
  assert.deepStrictEqual([s.next.x, s.next.y, s.next.z, s.face], [100, 64, 100, [0, -1, 0]], 'first block goes on the ground');
  assert.ok(B.step(plan, nameAt, new Set(['100,64,100'])).next.x === 101, 'a claimed block is skipped');
  let n = 0;
  while (!(s = B.step(plan, nameAt)).done) {
    assert.ok(s.next && ++n <= 18, 'every block gets placed, in order');
    world.set(`${s.next.x},${s.next.y},${s.next.z}`, s.next.block);
  }
  assert.strictEqual(n, 18);
  assert.deepStrictEqual(B.materials(plan, nameAt), {});
  // A floating second layer waits until the first exists (no neighbour yet).
  const floating = B.validate({origin: {x: 0, y: 70, z: 0}, blocks: [{x: 0, y: 1, z: 0, block: 'dirt'}]});
  assert.ok(B.step(floating, nameAt).wait === 1);
  world.set('100,65,100', 'dirt'); // wrong block where the blueprint wants cobblestone
  assert.match(B.step(plan, nameAt).stuck, /dirt is in the way/);
  world.set('100,65,100', 'wildflowers'); // a plant is broken first, not refused
  assert.deepStrictEqual(B.step(plan, nameAt, new Set(), (n) => n === 'wildflowers').clear, true);
  assert.match(B.step(plan, nameAt).stuck, /wildflowers is in the way/);
  world.set('100,65,100', 'cobblestone');
  // Remove: only blocks the build placed, top layer first; a block that was there before stays.
  const rm = B.validate({...bp, remove: true});
  const placedKeys = new Set(rm.blocks.map((q) => `${q.x},${q.y},${q.z}`).filter((k) => k !== '100,64,100'));
  assert.strictEqual(B.removeStep(rm, nameAt, new Set(), placedKeys).next.y, 65);
  assert.ok(B.removeStep(rm, nameAt).done, 'no record: nothing is removed');
  for (let k = 0; !(s = B.removeStep(rm, nameAt, new Set(), placedKeys)).done; k++) {
    assert.ok(k < 18);
    world.delete(`${s.next.x},${s.next.y},${s.next.z}`);
  }
  assert.deepStrictEqual([...world.keys()], ['100,64,100'], 'the pre-existing block stays');
  // Plants are an explicit list: a player's torch or redstone wire is never cleared.
  for (const n of ['wildflowers', 'short_grass', 'poppy']) assert.ok(B.PLANTS.has(n), n);
  for (const n of ['torch', 'redstone_wire', 'rail', 'lever', 'tripwire']) assert.ok(!B.PLANTS.has(n), n);
}
