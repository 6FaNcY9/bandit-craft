'use strict';
const assert = require('node:assert');
module.exports = async () => {
  // build orchestration with a fake bot (MC-3): Stop, provenance, failed digs, no-progress deadline
  {
    const B = require('../../build');
    const fakeRun = ({preset = [], equipStops = false, digOk = true, claimOk = true} = {}) => {
      const blocks = new Map(preset.map((k) => [k, 'cobblestone']));
      const name = (v) => blocks.get(`${v.x},${v.y},${v.z}`) ?? (v.y <= 63 ? 'stone' : 'air');
      const job = {t: {}, cancelled: false};
      const log = {placed: 0, expects: []};
      const mv = {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: [1, 2]};
      const bot = {game: {dimension: 'overworld'}, pathfinder: {movements: mv}, world: {},
        registry: {itemsByName: {cobblestone: {id: 1}}},
        inventory: {items: () => [{name: 'cobblestone', count: 64, type: 1}]},
        blockAt: (v) => ({name: name(v), position: v}),
        equip: async () => { if (equipStops) job.cancelled = true; },
        placeBlock: async (against, face) => { log.placed++; const t = against.position.plus(face); blocks.set(`${t.x},${t.y},${t.z}`, 'cobblestone'); }};
      const r = {bot, protectedAreas: [], name: 'b', world: claimOk ? null : {claim: async () => false, release() {}}, conflict() {}};
      const guard = (j) => { if (j.cancelled) throw new Error('stopped'); };
      const build = B.makeBuild({goNear: async () => {}, guard, sleep: async () => new Promise((res) => setTimeout(res, 5)), goals: {GoalPlaceBlock: class {}}, withdraw: async () => {},
        digAt: async (rr, jj, p, expect) => { log.expects.push(expect); if (!digOk) return false; blocks.delete(`${p.x},${p.y},${p.z}`); return true; }, waitMs: 50});
      return {build, r, job, blocks, log, mv};
    };
    const pad = (o, extra = {}) => ({origin: o, blocks: [0, 1, 2].map((x) => ({x, y: 0, z: 0, block: 'cobblestone'})), ...extra});
    let f = fakeRun({equipStops: true}); // a Stop during the equip places nothing; pathfinder settings come back
    f.job.args = pad({x: 500, y: 64, z: 500});
    await assert.rejects(f.build(f.r, f.job), /stopped/);
    assert.strictEqual(f.log.placed, 0, 'nothing placed after Stop');
    assert.deepStrictEqual([f.mv.exclusionAreasBreak.length, f.mv.exclusionAreasPlace.length, f.mv.scafoldingBlocks], [0, 0, [1, 2]], 'settings restored');
    f = fakeRun({preset: ['600,64,600']}); // build next to a pre-existing block, then remove: only ours come out
    f.job.args = pad({x: 600, y: 64, z: 600});
    await f.build(f.r, f.job);
    assert.strictEqual(f.log.placed, 2);
    assert.ok(!f.job.noop, 'a build that placed blocks is not "already complete"');
    assert.deepStrictEqual(B.finishOf(true, []), {noop: true}, 'nothing to do: already complete');
    assert.deepStrictEqual([B.stacksPerKind([{p: {item: 'cobblestone'}}, {p: {item: 'cobblestone'}}]), B.stacksPerKind([{p: {item: 'cobblestone'}}, {p: {item: 'oak_planks'}}])], [8, 2], 'a fill takes 8 stacks a trip, a mixed build 2 (2026-10-20)');
    { // a restock stows the dug-out stone kinds the build does not use, and dirt over a stack (bot21, 2026-10-20)
      const NAT = /^(stone|dirt|andesite|diorite|granite)$/;
      const inv = [{name: 'andesite', count: 64}, {name: 'diorite', count: 60}, {name: 'dirt', count: 64}, {name: 'dirt', count: 46}, {name: 'cobblestone', count: 37}, {name: 'iron_pickaxe', count: 1}];
      assert.deepStrictEqual(B.bycatch(inv, new Set(['cobblestone']), NAT), ['andesite', 'diorite', 'dirt']);
      assert.deepStrictEqual(B.bycatch([{name: 'dirt', count: 64}], new Set(['cobblestone']), NAT), [], 'one stack of dirt stays');
      assert.deepStrictEqual(B.bycatch(inv, new Set(['andesite', 'dirt']), NAT), ['diorite'], 'what the build uses stays');
    }
    assert.deepStrictEqual(B.finishOf(false, ['1,2,3']), {noop: false}, 'some work done, a cell left: done, the cell reported');
    assert.match(B.finishOf(true, ['1,68,3', '2,68,3']).error, /no way to any of the 2 cells to clear: 1,68,3 2,68,3/, 'nothing reached: a failure (2026-10-20)');
    const again = {t: {}, cancelled: false, args: pad({x: 600, y: 64, z: 600})};
    await f.build(f.r, again);
    assert.strictEqual(again.noop, true, 'a second build of the finished blueprint had nothing to do');
    assert.strictEqual(f.log.placed, 2);
    f.job.args = pad({x: 600, y: 64, z: 600}, {remove: true});
    await f.build(f.r, f.job);
    assert.deepStrictEqual([...f.blocks.keys()], ['600,64,600'], 'the pre-existing block stays');
    assert.ok(f.log.expects.length && f.log.expects.every((e) => e && e('cobblestone') && !e('torch')), 'removal digs only the recorded block type');
    f = fakeRun(); // remove without a record is refused
    f.job.args = pad({x: 700, y: 64, z: 700}, {remove: true});
    await assert.rejects(f.build(f.r, f.job), /no record/);
    const g = fakeRun({digOk: false}); // a dig that never works ends with an error
    g.job.args = pad({x: 800, y: 64, z: 800});
    await g.build(g.r, g.job);
    g.job.args = pad({x: 800, y: 64, z: 800}, {remove: true});
    await assert.rejects(g.build(g.r, g.job), /could not dig|no progress/);
    const h = fakeRun({claimOk: false}); // claims refused past the deadline: fail, not wait forever
    h.job.args = pad({x: 900, y: 64, z: 900});
    const t0 = Date.now();
    await assert.rejects(h.build(h.r, h.job), /no progress/);
    assert.ok(Date.now() - t0 < 2000);
  }
  { // openChest: a bot's diorite pillar kept storage shut (2026-10-16)
    const {openChest} = require('../../bots');
    const {Vec3} = require('vec3');
    const chest = {name: 'chest', position: new Vec3(-271, 59, -219)};
    let cover = {name: 'diorite', position: chest.position.offset(0, 1, 0), boundingBox: 'block'};
    const log = [];
    const bot = {
      blockAt: (p) => p.equals(chest.position) ? chest : p.equals(chest.position.offset(0, 1, 0)) ? cover : null,
      entity: {position: chest.position.offset(0, 0, 3), onGround: true}, game: {dimension: 'overworld'}, entities: {}, inventory: {items: () => [{type: 1, name: 'stone_pickaxe'}]},
      pathfinder: {goto: async () => {}, stop() {}, setGoal() {}}, tool: {equipForBlock: async () => {}},
      dig: async (blk) => { log.push(`dig ${blk.name}`); cover = null; },
      openContainer: async (blk) => { assert.strictEqual(blk, chest); log.push('open chest'); return 'box'; }, stopDigging() {},
    };
    const r = {bot, world: {hostilesNear: () => []}, emit() {}, protectedAreas: []};
    assert.strictEqual(await openChest(r, {t: {}, cancelled: false}, chest), 'box');
    assert.deepStrictEqual(log, ['dig diorite', 'open chest']);
    // a hopper on top does not keep it shut (the iron storage hall, 2026-10-19): opened, nothing dug
    cover = {name: 'hopper', position: chest.position.offset(0, 1, 0), boundingBox: 'block'};
    log.length = 0;
    assert.strictEqual(await openChest(r, {t: {}, cancelled: false}, chest), 'box');
    assert.deepStrictEqual(log, ['open chest']);
  }
  { // openChest: a Stop between two covers digs no more and opens nothing; a single chest has no partner
    const {openChest, Cancelled} = require('../../bots');
    const {Vec3} = require('vec3');
    const run = (types) => {
      const blocks = new Map([['0,64,0', ['chest', types[0]]], ['1,64,0', ['chest', types[1]]], ['0,65,0', ['cobblestone']], ['1,65,0', ['cobblestone']]]);
      const job = {t: {}, cancelled: false};
      const log = {digs: 0, opened: 0};
      const bot = {
        blockAt: (p) => {
          const b = blocks.get(`${p.x},${p.y},${p.z}`);
          return b ? {name: b[0], position: p, boundingBox: 'block', getProperties: () => (b[1] ? {facing: 'north', type: b[1]} : {})} : null;
        },
        entity: {position: new Vec3(0, 64, 3), onGround: true}, game: {dimension: 'overworld'}, entities: {}, inventory: {items: () => [{type: 1, name: 'stone_pickaxe'}]},
        pathfinder: {goto: async () => {}, stop() {}, setGoal() {}}, tool: {equipForBlock: async () => {}},
        dig: async (blk) => { log.digs++; blocks.delete(`${blk.position.x},${blk.position.y},${blk.position.z}`); job.cancelled = true; },
        openContainer: async () => { log.opened++; }, stopDigging() {},
      };
      const r = {bot, world: {hostilesNear: () => []}, emit() {}, protectedAreas: []};
      return {go: () => openChest(r, job, bot.blockAt(new Vec3(0, 64, 0))), log};
    };
    let x = run(['left', 'right']);
    await assert.rejects(x.go(), Cancelled);
    assert.deepStrictEqual(x.log, {digs: 1, opened: 0}, 'Stop after the first cover');
    x = run(['single', 'single']);
    await assert.rejects(x.go(), Cancelled); // its own cover is dug (and the Stop then holds) ...
    assert.strictEqual(x.log.digs, 1, '... but never the single neighbour\'s');
  }
  { // guardDigs: the pathfinder's own digs stop for a stopped job, a protected area, a changed block or a fluid
    const {guardDigs} = require('../../bots');
    const {Vec3} = require('vec3');
    const world = new Map([['0,60,0', 'stone'], ['5,60,5', 'stone'], ['6,60,5', 'water'], ['20,60,20', 'stone']]);
    let dug = 0;
    const bot = {dig: async () => { dug++; }, equip: async () => {}, placeBlock: async () => {}, entity: {position: new Vec3(0, 62, 3)},
      blockAt: (p) => (world.get(`${p.x},${p.y},${p.z}`) ? {name: world.get(`${p.x},${p.y},${p.z}`), position: p, getProperties: () => ({})} : null)};
    const runner = {current: {cancelled: false}, protectedAreas: [[15, 15, 25, 25]]};
    guardDigs(runner, bot);
    const blk = (x, y, z, name = 'stone') => ({name, position: new Vec3(x, y, z)});
    await bot.dig(blk(0, 60, 0));
    assert.strictEqual(dug, 1, 'a plain dig passes');
    await assert.rejects(bot.dig(blk(5, 60, 5)), /water next to it/);
    await assert.rejects(bot.dig(blk(20, 60, 20)), /protected/);
    await assert.rejects(bot.dig(blk(0, 60, 0, 'dirt')), /changed/);
    runner.current.cancelled = true;
    await assert.rejects(bot.dig(blk(0, 60, 0)), /stopped/);
    assert.strictEqual(dug, 1);
  }
  { // the water of a field is never filled, other water is (main server 2026-10-18)
    const {guardDigs} = require('../../bots');
    const {Vec3} = require('vec3');
    let field = true, placed = 0;
    const bot = {dig: async () => {}, equip: async () => {}, placeBlock: async () => { placed++; }, lookAt: async () => {}, entity: {position: new Vec3(0.5, 66, 3.5)},
      blockAt: (p) => ({name: p.x === 0 && p.y === 66 && p.z === 0 ? 'water' : field && p.y === 66 && Math.abs(p.x) <= 4 ? 'farmland' : 'air', position: p, getProperties: () => ({})})};
    guardDigs({current: {cancelled: false, type: 'wheatfarm'}, protectedAreas: [], pillars: new Map()}, bot);
    const below = {name: 'dirt', position: new Vec3(0, 65, 0)};
    await assert.rejects(bot.placeBlock(below, new Vec3(0, 1, 0)), /waters a field/);
    field = false;
    await bot.placeBlock(below, new Vec3(0, 1, 0));
    assert.strictEqual(placed, 1, 'a lake can still be bridged');
  }
  { // pillar steps are remembered in any job out in the open, not under a stone roof (main server 2026-10-18)
    const {guardDigs} = require('../../bots');
    const {Vec3} = require('vec3');
    let roof = null, building = true;
    const bot = {dig: async () => {}, equip: async () => {}, placeBlock: async () => {}, lookAt: async () => {}, heldItem: {name: 'cobblestone'},
      entity: {position: new Vec3(10.5, 67, 20.5)}, pathfinder: {isBuilding: () => building},
      blockAt: (p) => (p.y === 66 || (roof && p.y === roof) ? {name: p.y === 66 ? 'dirt' : 'stone', position: p, boundingBox: 'block', getProperties: () => ({})}
        : {name: 'air', position: p, boundingBox: 'empty', getProperties: () => ({})})};
    const runner = {current: {cancelled: false, type: 'produce'}, protectedAreas: [], pillars: new Map()};
    guardDigs(runner, bot);
    const under = {name: 'dirt', position: new Vec3(10, 66, 20)};
    await bot.placeBlock(under, new Vec3(0, 1, 0));
    assert.deepStrictEqual([...runner.pillars.keys()], ['10,67,20'], 'a tower step under the sky is remembered');
    runner.pillars.clear(); roof = 75;
    await bot.placeBlock(under, new Vec3(0, 1, 0));
    assert.strictEqual(runner.pillars.size, 0, 'under a stone roof it is the way back up');
    roof = null;
    await bot.placeBlock({name: 'dirt', position: new Vec3(12, 66, 20)}, new Vec3(1, 0, 0));
    assert.deepStrictEqual([...runner.pillars.keys()], ['13,66,20'], 'a bridge block under the sky is remembered too (2026-10-20)');
    runner.pillars.clear(); building = false;
    await bot.placeBlock(under, new Vec3(0, 1, 0));
    assert.strictEqual(runner.pillars.size, 0, 'a block the job itself places (a build) is no pillar');
  }
};
