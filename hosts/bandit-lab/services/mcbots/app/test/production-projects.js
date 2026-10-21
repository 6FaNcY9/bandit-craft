'use strict';
// Production: the next chain for a project, crafts with ingredients in the store first, then smelts, then gathering.
{
  const assert = require('node:assert/strict');
  const {nextChain} = require('../production');
  const store = {x: 1, y: 64, z: 2};
  const craft = nextChain({need: {hopper: 10}, stock: {iron_ingot: 20, chest: 10}, store});
  assert.deepStrictEqual(craft, {key: 'craft:hopper', label: 'craft 4 hopper', chain: [
    ['withdraw', {item: 'iron_ingot', count: 20, ...store}], ['withdraw', {item: 'chest', count: 4, ...store}],
    ['craft', {item: 'hopper', count: 4}], ['deposit', {...store, only: 'hopper'}]]});
  const smelt = nextChain({need: {hopper: 2}, stock: {raw_iron: 10, coal: 2}, store});
  assert.deepStrictEqual(smelt.chain, [['withdraw', {item: 'raw_iron', count: 10, ...store}], ['withdraw', {item: 'coal', count: 2, ...store}],
    ['smelt', {item: 'raw_iron', count: 10}], ['deposit', {...store, only: 'iron_ingot'}]]);
  assert.strictEqual(nextChain({need: {stone: 200}, stock: {cobblestone: 200, coal: 25}, store}).chain[2][1].count, 64, 'a smelt takes 64 at most');
  assert.strictEqual(nextChain({need: {stone: 200}, stock: {cobblestone: 200, coal: 2}, store}).chain[2][1].count, 16, 'no more than the fuel lasts');
  const gather = nextChain({need: {hopper: 2}, store});
  assert.match(gather.key, /^gather:/);
  assert.deepStrictEqual(gather.chain[1], ['deposit', {...store, only: gather.key.slice(7)}]);
  // the whole gather amount rides along, so produce can take it from storage first (1600 stored cobblestone, 2026-10-16)
  assert.deepStrictEqual(nextChain({need: {cobblestone: 1529}, store}).gather, {item: 'cobblestone', count: 1529});
  assert.deepStrictEqual(nextChain({need: {oak_planks: 4}, store}).chain[0], ['mine', {block: 'oak_log', count: 1}], 'oak stays oak');
  assert.deepStrictEqual(nextChain({need: {snowball: 64}, store}).chain[0], ['mine', {block: 'snow_block', count: 16}], 'four snowballs a snow block');
  // a step that just ran rests while another one is open, and runs again when it is the only one (2026-10-18)
  const both = {need: {cobblestone: 64, sand: 10}, store};
  assert.deepStrictEqual([nextChain(both).key, nextChain({...both, resting: new Set(['gather:sand'])}).key], ['gather:sand', 'gather:cobblestone'], 'the other material gets its turn');
  assert.strictEqual(nextChain({need: {sand: 10}, store, resting: new Set(['gather:sand'])}).key, 'gather:sand', 'alone it goes on');
  const {rawUnknown} = require('../recipes');
  assert.deepStrictEqual(rawUnknown({comparator: 5, sticky_piston: 2, shulker_box: 1}), {quartz: 5, slime_ball: 2, shulker_shell: 2}, 'the raw items the owner brings');
  assert.deepStrictEqual(rawUnknown({comparator: 5}, {have: {quartz: 3}}), {quartz: 2}, 'net of what the chests hold');
  assert.deepStrictEqual(rawUnknown({sticky_piston: 22}), {slime_ball: 22}, 'not round the slime block');
  assert.deepStrictEqual(nextChain({need: {hopper: 1}, stock: {iron_ingot: 5, chest: 1}, store, taken: new Set(['craft:hopper'])}), {idle: 'the other bots have the open steps', left: []});
  assert.deepStrictEqual(nextChain({need: {}, store}), {idle: 'the project has all it needs', left: []});
  assert.deepStrictEqual(nextChain({need: {white_wool: 2}, store}), {idle: 'nothing the bots can make: white_wool', left: ['white_wool']}); // the producer asks acquire.js for these
  console.log('production: next chains ok');
}

(async () => { // Project cards count placed cells, unique chests, and only materials with no acquire plan (main server 2026-10-18).
  const assert = require('node:assert/strict');
  const bots = require('../bots');
  const {projectPlaced, projectChests, projectOwner} = bots;
  const targets = [
    {p: {item: 'stone', again: false}}, {p: {item: 'stone', again: false}}, {p: {item: 'oak_slab', again: true}},
  ];
  assert.strictEqual(projectPlaced(3, targets, {stone: 1, oak_slab: 2}), 1, 'remaining blocks map to missing cells');
  const chest = {x: 1, y: 64, z: 2};
  assert.deepStrictEqual(projectChests({store: chest, chests: [chest, {x: 2, y: 64, z: 2}]}), [chest, {x: 2, y: 64, z: 2}], 'store/chests are unique by position');
  const data = require('minecraft-data')('26.1');
  const world = {data, have: {}, stores: [], blockNear: () => null, mobNear: (mob) => mob === 'sheep' ? 20 : null, canKill: (mob) => mob === 'sheep'};
  assert.deepStrictEqual(projectOwner({white_wool: 4, nether_star: 1}, world), {nether_star: 1}, 'sheep makes wool acquirable; impossible drops stay on the owner list');
  const build = require('../build'), old = {plan: build.schematicPlan, needed: build.stillNeeded, stock: build.chestStock};
  const storeChest = {x: 1, y: 64, z: 2}, job = {type: 'produce', args: {file: 'fake.litematic', origin: {x: 0, y: 64, z: 0}, store: storeChest, chests: [storeChest]}};
  let scans = 0;
  const pos = {x: 0, y: 64, z: 0, distanceTo: () => 20};
  const bot = {entity: {position: pos}, game: {dimension: 'overworld'}, registry: data, inventory: {items: () => []}, blockAt: () => ({}), findBlock: () => null, findBlocks: () => [], world: {getColumn: () => null},
    nearestEntity: (match) => { const sheep = {name: 'sheep', position: pos}; return match(sheep) ? sheep : null; }};
  const runner = {current: job, bot, world: {chests: new Map()}, acquireFailed: new Map(), protectedAreas: []};
  build.schematicPlan = async () => ({lo: {x: 0, y: 64, z: 0}, hi: {x: 1, y: 64, z: 0}, targets: [{p: {item: 'white_wool'}}, {p: {item: 'white_wool'}}]});
  build.stillNeeded = () => { scans++; return {white_wool: 1}; };
  build.chestStock = () => new Map();
  try {
    const m = await bots.projectMaterials(runner);
    assert.deepStrictEqual([m.placed, m.chests, m.counted, m.owner], [1, 1, 1, {}], 'materials show exact remaining cells and do not ask for sheep drops');
    m.lacking.white_wool = 99;
    const cached = await bots.projectMaterials(runner);
    assert.deepStrictEqual(cached.lacking, {white_wool: 1}, 'API consumers cannot mutate the cached result');
    assert.strictEqual(scans, 1, 'dashboard polls reuse one bot result for a minute');
  } finally { build.schematicPlan = old.plan; build.stillNeeded = old.needed; build.chestStock = old.stock; }
  console.log('project materials: progress, chest dedupe, and acquire owner list ok');
})();

// hostilesNear with a height: a mob in a cave far below the target is not near it.
{
  const assert = require('node:assert/strict');
  const {WorldModel} = require('../world');
  const w = new WorldModel();
  w.mobs.set('overworld:1', {id: 1, type: 'zombie', x: 0, y: 64, z: 0, dim: 'overworld', t: w.now()});
  w.mobs.set('overworld:2', {id: 2, type: 'zombie', x: 3, y: 30, z: 0, dim: 'overworld', t: w.now()});
  assert.strictEqual(w.hostilesNear(0, 0, 'overworld', 8).length, 2, 'without a height as before');
  assert.deepStrictEqual(w.hostilesNear(0, 0, 'overworld', 8, 66).map((m) => m.id), [1]);
  console.log('world: hostiles near a height ok');
}

// archive: a full file becomes FILE.1 and the FILE.1 before it is kept, never overwritten; only events and
// states files are served.
{
  const assert = require('node:assert/strict');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const archive = require('../archive');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-archive-'));
  const file = path.join(dir, 'sub', 'events.jsonl');
  archive.append(file, {n: 1}, {maxBytes: 5}); // over the limit at once: FILE.1
  archive.append(file, {n: 2}, {maxBytes: 5}); // FILE.1 -> FILE.<ms>, FILE -> FILE.1
  const names = fs.readdirSync(path.dirname(file));
  const kept = names.find((n) => /^events\.jsonl\.\d{4,}$/.test(n));
  assert.deepEqual(names.sort(), ['events.jsonl.1', kept].sort());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(file), kept), 'utf8')), {n: 1});
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.1`, 'utf8')), {n: 2});
  for (const ok of ['events.jsonl', 'states.jsonl.1', 'states.jsonl.1792026990411']) assert.ok(archive.ARCHIVE_NAME.test(ok), ok);
  for (const bad of ['../events.jsonl', 'events.jsonl/x', 'chests.json', 'settings.json', 'events.jsonl.1x', '.events.jsonl']) assert.ok(!archive.ARCHIVE_NAME.test(bad), bad);
  fs.rmSync(dir, {recursive: true});
  console.log('archive: rotation keeps old files ok');
}
