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
      { // a full bag makes room for a restock with what no open cell uses, then the kinds used last (sorter builders, 2026-11-14)
        const s = (name, count) => ({name, count});
        const bag = [s('stone', 64), s('stone', 41), s('hopper', 64), s('hopper', 37), s('glass', 64), s('dirt', 64), s('dropper', 64), s('comparator', 12), s('rotten_flesh', 3)];
        const open = new Map([['hopper', 300], ['stone', 200], ['glass', 40], ['dropper', 9]]); // build order; every comparator stands
        const kinds = new Set(['hopper', 'stone', 'glass', 'dropper', 'comparator']), sup = ['dirt', 'glass'];
        assert.deepStrictEqual(B.roomKeep(bag, open, kinds, 1, sup), {dirt: 128, glass: 128, dropper: 64, stone: 105, hopper: 101}, 'the unused comparators make the slot: nothing it will place goes');
        assert.deepStrictEqual(B.roomKeep(bag, open, kinds, 2, sup), {dirt: 128, glass: 128, stone: 105, hopper: 101}, 'then the kind used last');
        assert.deepStrictEqual(B.roomKeep(bag, open, kinds, 4, sup), {dirt: 128, glass: 128, hopper: 101}, 'the kind placed next stays to the end, dirt and glass always');
      }
      {
        // The apse's light slot: one wide, walled in by the bot's own build; the nave lies past one wall to the east.
        const open = (x, y, z) => (x === 0 && z >= -1 && z <= 1) || x >= 2;
        assert.deepStrictEqual(B.breakOut({x: 0, y: 5, z: 0}, open, {x: 20, z: 0}), [{x: 1, y: 6, z: 0}, {x: 1, y: 5, z: 0}], 'through the wall towards the site');
        assert.strictEqual(B.breakOut({x: 0, y: 5, z: 0}, () => false, {x: 20, z: 0}), null, 'solid all round: no way within 3');
        // BUILD-2: open ground beside one wall is not walled in, and only the build's own cells may be dug (audit 2026-11-19).
        assert.strictEqual(B.breakOut({x: 0, y: 5, z: 0}, (x) => x !== 1, {x: 20, z: 0}), null, 'one side shut, three open: it walks round');
        assert.strictEqual(B.breakOut({x: 0, y: 5, z: 0}, open, {x: 20, z: 0}, () => false), null, 'walled in, but the wall is not the build: it stays');
        assert.deepStrictEqual(B.breakOut({x: 0, y: 5, z: 0}, open, {x: 20, z: 0}, (c) => c.x === 1), [{x: 1, y: 6, z: 0}, {x: 1, y: 5, z: 0}], 'the west wall is foreign, the east one ours');
      }
      {
        // A chest that stays shut is tried once more from next to it, then passed over: it ended a whole produce job (sandbox 2026-11-05).
        const {Vec3} = require('vec3');
        const walks = [], infos = [];
        let shut = 1;
        const bot = {game: {dimension: 'stock-test'}, blockAt: () => ({name: 'chest'}), openContainer: async (b) => {
          if (shut-- > 0) throw new Error('the container did not open within 10 s');
          return {containerItems: () => [{name: 'cobblestone', count: 5}], close() {}};
        }};
        const r = {bot, emit: (_k, m) => infos.push(m)}, deps = {goNear: async (_r, _j, _x, _y, _z, range) => walks.push(range), guard() {}};
        assert.deepStrictEqual(await B.readStock(r, {t: {}}, [{x: 1, y: 2, z: 3}], deps), {cobblestone: 5}, 'second try counts');
        assert.deepStrictEqual(walks, [3, 2], 'then from next to it');
        B.forgetChest('stock-test', {x: 1, y: 2, z: 3});
        shut = 2;
        assert.deepStrictEqual(await B.readStock(r, {t: {}}, [{x: 1, y: 2, z: 3}, {x: 4, y: 2, z: 3}], deps), {cobblestone: 5}, 'a shut chest is passed over');
        assert.ok(infos.some((i) => /1 2 3 did not open/.test(i)), 'and said');
        bot.openContainer = async () => { throw new Error('boom'); };
        await assert.rejects(B.readStock(r, {t: {}}, [{x: 7, y: 2, z: 3}], deps), /boom/, 'other errors still end it');
      }
      {
        // A blocked way to the chests waits; anything else, and a Stop, still ends the order.
        const {produceStep, Cancelled} = require('../../bots');
        const infos = [], r = {emit: (_k, i) => infos.push(i)};
        const failing = (msg) => ({step: async () => { throw new Error(msg); }});
        assert.ok((await produceStep(failing('could not reach 1 2 3: no progress for 30 s'), r, {t: {}})).idle, 'no way there: wait');
        assert.ok((await produceStep(failing('the container did not open within 10 s'), r, {t: {}})).idle, 'shut chest: wait');
        assert.ok(infos.some((i) => /trying again/.test(i)), 'and said');
        await assert.rejects(produceStep(failing('boom'), r, {t: {}}), /boom/, 'other errors end it');
        await assert.rejects(produceStep(failing('could not reach 1 2 3'), r, {t: {}, cancelled: true}), Cancelled, 'a Stop ends it');
        assert.deepStrictEqual(await produceStep({step: async () => ({ran: 'x'})}, r, {t: {}}), {ran: 'x'});
      }
      const s = (name, count) => ({name, count});
      const rock = /^(stone|dirt|andesite|cobblestone)$/;
      const names = (list) => list.map((i) => `${i.name} ${i.count}`);
      assert.deepStrictEqual(names(B.surplusRock([s('andesite', 64), s('torch', 64), s('andesite', 3)], new Set(), rock)), ['andesite 64', 'andesite 3'], 'rock the build does not use goes, the torches stay');
      assert.deepStrictEqual(names(B.surplusRock([s('cobblestone', 64), s('cobblestone', 64), s('cobblestone', 64), s('cobblestone', 64), s('cobblestone', 64), s('cobblestone', 10)], new Set(['cobblestone']), rock)), ['cobblestone 64', 'cobblestone 10'], 'four stacks of what it uses stay, more than a restock takes');
      assert.deepStrictEqual(names(B.surplusRock([s('dirt', 64), s('dirt', 20)], new Set(), rock)), ['dirt 20'], 'one stack of dirt stays to climb');
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
  { // a deferred cell whose item no chest holds (an observer under a comparator, no quartz) is not picked again at once:
    // the loop said nothing and spun at full CPU for 25 minutes, nothing placed (sorter builders, 2026-11-11)
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), nbt = require('prismarine-nbt'), {gzipSync} = require('node:zlib');
    const {Vec3} = require('vec3');
    const str = (value) => ({type: 'string', value});
    const palette = Array.from({length: 32}, () => ({Name: str('minecraft:stone')}));
    for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
    palette[4] = {Name: str('minecraft:observer'), Properties: {type: 'compound', value: {facing: str('north'), powered: str('false')}}};
    palette[5] = {Name: str('minecraft:comparator'), Properties: {type: 'compound', value: {facing: str('north'), mode: str('compare'), powered: str('false')}}};
    const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, {type: 'int', value}]))});
    const packed = 4n | (5n << 5n); // two 5-bit states: the observer at the bottom, the comparator on top
    const longs = [[Number(BigInt.asIntN(32, packed >> 32n)), Number(BigInt.asIntN(32, packed))]];
    const region = {type: 'compound', value: {Position: xyz({x: 0, y: 0, z: 0}), Size: xyz({x: 1, y: 2, z: 1}),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: longs}}};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-late-'));
    fs.writeFileSync(path.join(dir, 'late.litematic'), gzipSync(nbt.writeUncompressed({type: 'compound', name: '',
      value: {Metadata: {type: 'compound', value: {Name: str('late')}}, Regions: {type: 'compound', value: {r: region}}}})));
    const job = {t: {}, cancelled: false, args: {file: 'late.litematic', origin: {x: 0, y: 64, z: 0}, chests: []}};
    const item = (id) => ({id, stackSize: 64});
    const noop = async () => {};
    const bot = {game: {dimension: 'overworld'}, on() {}, removeListener() {}, setControlState() {}, look: noop, waitForTicks: noop, equip: noop, tossStack: noop, activateBlock: noop, entities: {}, entity: {position: new Vec3(0.5, 64, 3.5), yaw: 0, pitch: 0},
      inventory: {items: () => [], emptySlotCount: () => 36},
      registry: {itemsByName: {observer: item(1), comparator: item(2), dirt: item(3), glass: item(4)}, blocksByName: {}},
      pathfinder: {searchRadius: 100, movements: {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: [], blocksToAvoid: new Set()}},
      blockAt: (p) => ({name: p.y <= 63 ? 'stone' : 'air', position: p, getProperties: () => ({}), boundingBox: p.y <= 63 ? 'block' : 'empty', shapes: []})};
    const schematic = require('../../build').makeSchematic({goNear: async () => {}, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
      sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))), goals: {GoalNear: class {}}, digAt: async () => false, deposit: async () => {}, natural: /^(grass_block|dirt)$/, dir});
    const run = schematic({bot, name: 'b', protectedAreas: [], emit() {}, conflict() {}}, job).catch((e) => e);
    await new Promise((res) => setTimeout(res, 400)); // a spinning loop yields to timers, so this fires either way
    const doing = job.t.doing;
    job.cancelled = true;
    const end = await Promise.race([run, new Promise((res) => setTimeout(() => res('hung'), 3000))]);
    fs.rmSync(dir, {recursive: true, force: true});
    assert.ok(end instanceof Error && /stopped/.test(end.message), `the loop ends on Stop: ${end}`);
    assert.match(String(doing), /^waiting for material: .*observer/, `it waits for the missing observer instead of spinning without a word (doing: ${doing})`);
  }
  { // a support on a chest's lid is glass: dirt there kept 43 sorter chests shut (main server 2026-11-15)
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), nbt = require('prismarine-nbt'), {gzipSync} = require('node:zlib');
    const {Vec3} = require('vec3');
    const str = (value) => ({type: 'string', value});
    const palette = Array.from({length: 32}, () => ({Name: str('minecraft:stone')}));
    for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
    const chestProps = {facing: 'north', type: 'single', waterlogged: 'false'};
    palette[4] = {Name: str('minecraft:chest'), Properties: {type: 'compound', value: Object.fromEntries(Object.entries(chestProps).map(([k, v]) => [k, str(v)]))}};
    palette[5] = {Name: str('minecraft:cobblestone')};
    const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, {type: 'int', value}]))});
    const packed = 4n | (0n << 5n) | (5n << 10n); // chest, air, cobblestone
    const longs = [[Number(BigInt.asIntN(32, packed >> 32n)), Number(BigInt.asIntN(32, packed))]];
    const region = {type: 'compound', value: {Position: xyz({x: 0, y: 0, z: 0}), Size: xyz({x: 1, y: 3, z: 1}),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: longs}}};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-lid-'));
    fs.writeFileSync(path.join(dir, 'lid.litematic'), gzipSync(nbt.writeUncompressed({type: 'compound', name: '',
      value: {Metadata: {type: 'compound', value: {Name: str('lid')}}, Regions: {type: 'compound', value: {r: region}}}})));
    const job = {t: {}, cancelled: false, args: {file: 'lid.litematic', origin: {x: 0, y: 100, z: 0}, chests: []}};
    const item = (id) => ({id, stackSize: 64});
    const noop = async () => {};
    const isChest = (p) => p.x === 0 && p.y === 100 && p.z === 0;
    const bot = {game: {dimension: 'overworld'}, on() {}, removeListener() {}, setControlState() {}, look: noop, waitForTicks: noop, equip: noop, tossStack: noop, activateBlock: noop, entities: {}, entity: {position: new Vec3(0.5, 64, 3.5), yaw: 0, pitch: 0},
      inventory: {items: () => [], emptySlotCount: () => 36},
      registry: {itemsByName: {chest: item(1), cobblestone: item(2), dirt: item(3), glass: item(4)}, blocksByName: {}},
      pathfinder: {searchRadius: 100, movements: {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: [], blocksToAvoid: new Set()}},
      blockAt: (p) => (isChest(p) ? {name: 'chest', position: p, getProperties: () => chestProps, boundingBox: 'block', shapes: []}
        : {name: p.y <= 63 ? 'stone' : 'air', position: p, getProperties: () => ({}), boundingBox: p.y <= 63 ? 'block' : 'empty', shapes: []})};
    const schematic = require('../../build').makeSchematic({goNear: async () => {}, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
      sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))), goals: {GoalNear: class {}}, digAt: async () => false, deposit: async () => {}, natural: /^(grass_block|dirt)$/, dir});
    const run = schematic({bot, name: 'b', protectedAreas: [], emit() {}, conflict() {}}, job).catch((e) => e);
    await new Promise((res) => setTimeout(res, 400));
    const doing = job.t.doing;
    job.cancelled = true;
    const end = await Promise.race([run, new Promise((res) => setTimeout(() => res('hung'), 3000))]);
    fs.rmSync(dir, {recursive: true, force: true});
    assert.match(String(doing), /glass/, `a support on a chest's lid is glass (doing: ${doing})`);
    assert.doesNotMatch(String(doing), /dirt/, `no dirt on a chest's lid: it keeps the chest shut (doing: ${doing})`);
  }
  { // out of dirt and glass a failed walk waits for dirt: bot20 hung below s5's walls with only cobblestone (main server 2026-11-18)
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), nbt = require('prismarine-nbt'), {gzipSync} = require('node:zlib');
    const {Vec3} = require('vec3');
    const str = (value) => ({type: 'string', value});
    const palette = Array.from({length: 32}, () => ({Name: str('minecraft:stone')}));
    for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
    palette[5] = {Name: str('minecraft:cobblestone')};
    const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, {type: 'int', value}]))});
    const region = {type: 'compound', value: {Position: xyz({x: 0, y: 0, z: 0}), Size: xyz({x: 1, y: 1, z: 1}),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: [[0, 5]]}}};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-climb-'));
    fs.writeFileSync(path.join(dir, 'wall.litematic'), gzipSync(nbt.writeUncompressed({type: 'compound', name: '',
      value: {Metadata: {type: 'compound', value: {Name: str('wall')}}, Regions: {type: 'compound', value: {r: region}}}})));
    const job = {t: {}, cancelled: false, args: {file: 'wall.litematic', origin: {x: 0, y: 64, z: 0}, chests: []}};
    const item = (id) => ({id, stackSize: 64});
    const noop = async () => {};
    const bot = {game: {dimension: 'overworld'}, on() {}, removeListener() {}, setControlState() {}, look: noop, waitForTicks: noop, equip: noop, tossStack: noop, activateBlock: noop, entities: {}, entity: {position: new Vec3(20.5, 64, 20.5), yaw: 0, pitch: 0},
      inventory: {items: () => [{name: 'cobblestone', count: 64, type: 2}], emptySlotCount: () => 35},
      registry: {itemsByName: {cobblestone: item(2), dirt: item(3), glass: item(4)}, blocksByName: {}},
      pathfinder: {searchRadius: 100, movements: {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: [], blocksToAvoid: new Set()}},
      blockAt: (p) => ({name: p.y <= 63 ? 'stone' : 'air', position: p, getProperties: () => ({}), boundingBox: p.y <= 63 ? 'block' : 'empty', shapes: []})};
    let walks = 0;
    const schematic = require('../../build').makeSchematic({goNear: async () => { walks++; throw new Error('could not reach 0 64 0: no path'); }, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
      sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))), goals: {GoalNear: class {}}, digAt: async () => false, deposit: async () => {}, natural: /^(grass_block|dirt)$/, dir});
    const run = schematic({bot, name: 'b', protectedAreas: [], emit() {}, conflict() {}}, job).catch((e) => e);
    await new Promise((res) => setTimeout(res, 400));
    const doing = job.t.doing;
    // Its walks dig nothing built above it or beside it: the s4 repair dug out through the finished s5, the cap's walk
    // through K1's wall (main server 2026-11-18).
    const veto = bot.pathfinder.movements.exclusionAreasBreak[0], dig = (x, y, z, name) => veto({position: new Vec3(x, y, z), name});
    const vetoes = [dig(0, 70, 0, 'stone_bricks'), dig(0, 70, 0, 'dirt'), dig(5, 70, 5, 'stone_bricks'), dig(5, 70, 5, 'dirt'), dig(5, 70, 5, 'oak_leaves')];
    job.cancelled = true;
    await Promise.race([run, new Promise((res) => setTimeout(() => res('hung'), 3000))]);
    fs.rmSync(dir, {recursive: true, force: true});
    assert.match(String(doing), /^waiting for material: .*dirt/, `it waits for dirt to climb with (doing: ${doing})`);
    assert.strictEqual(walks, 1, 'and walks no more until there is dirt');
    assert.deepStrictEqual(vetoes, [100, 0, 100, 0, 0], 'above and beside the build a built block stays, ground and leaves may go');
  }
  { // a work torch or a crafting table the bots put down in a planned cell comes out without clearAll; a chest stays, and
    // a torch in an air cell stays without tight: "no progress for 300 s: in the way: wall_torch ..." (castle roof, main server 2026-11-16)
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), nbt = require('prismarine-nbt'), {gzipSync} = require('node:zlib');
    const {Vec3} = require('vec3');
    const str = (value) => ({type: 'string', value});
    const palette = Array.from({length: 32}, () => ({Name: str('minecraft:stone')}));
    for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
    const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, {type: 'int', value}]))});
    const packed = 4n | (4n << 5n) | (4n << 10n) | (0n << 15n); // stone at x 0..2, air at x 3
    const longs = [[Number(BigInt.asIntN(32, packed >> 32n)), Number(BigInt.asIntN(32, packed))]];
    const region = {type: 'compound', value: {Position: xyz({x: 0, y: 0, z: 0}), Size: xyz({x: 4, y: 1, z: 1}),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: longs}}};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-workblocks-'));
    fs.writeFileSync(path.join(dir, 'roof.litematic'), gzipSync(nbt.writeUncompressed({type: 'compound', name: '',
      value: {Metadata: {type: 'compound', value: {Name: str('roof')}}, Regions: {type: 'compound', value: {r: region}}}})));
    const job = {t: {}, cancelled: false, args: {file: 'roof.litematic', origin: {x: 0, y: 64, z: 0}, chests: []}};
    const item = (id) => ({id, stackSize: 64});
    const noop = async () => {};
    const world = new Map([['0,64,0', 'wall_torch'], ['1,64,0', 'crafting_table'], ['2,64,0', 'chest'], ['3,64,0', 'torch']]);
    const at = (p) => world.get(`${p.x},${p.y},${p.z}`) ?? (p.y <= 63 ? 'stone' : 'air');
    const on = {};
    const bot = {game: {dimension: 'overworld'}, on(e, f) { on[e] = f; }, removeListener() {}, setControlState() {}, look: noop, waitForTicks: noop, equip: noop, tossStack: noop, activateBlock: noop, entities: {}, entity: {position: new Vec3(0.5, 64, 3.5), yaw: 0, pitch: 0},
      inventory: {items: () => [], emptySlotCount: () => 36},
      registry: {itemsByName: {stone: item(1), dirt: item(3), glass: item(4)}, blocksByName: {}},
      pathfinder: {searchRadius: 100, movements: {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: [], blocksToAvoid: new Set()}},
      blockAt: (p) => ({name: at(p), position: p, getProperties: () => ({}), boundingBox: at(p) === 'air' || /torch/.test(at(p)) ? 'empty' : 'block', shapes: []})};
    const dug = [];
    const digAt = async (rr, jj, p) => { dug.push(at(p)); world.delete(`${p.x},${p.y},${p.z}`); on.blockUpdate?.(null, {position: p}); return true; };
    const schematic = require('../../build').makeSchematic({goNear: async () => {}, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
      sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))), goals: {GoalNear: class {}}, digAt, deposit: async () => {}, natural: /^(grass_block|dirt)$/, dir});
    const run = schematic({bot, name: 'b', protectedAreas: [], emit() {}, conflict() {}}, job).catch((e) => e);
    await new Promise((res) => setTimeout(res, 400));
    job.cancelled = true;
    await Promise.race([run, new Promise((res) => setTimeout(res, 3000))]);
    fs.rmSync(dir, {recursive: true, force: true});
    assert.deepStrictEqual(dug.sort(), ['crafting_table', 'wall_torch'], `own work blocks in planned cells come out; a chest and an air cell's torch stay (dug: ${dug})`);
  }
  { // BUILD-4: a floating cell's dirt pillar comes out all the way down, also below the cell under the site (audit 2026-11-19)
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), nbt = require('prismarine-nbt'), {gzipSync} = require('node:zlib');
    const {Vec3} = require('vec3');
    const str = (value) => ({type: 'string', value});
    const palette = Array.from({length: 32}, () => ({Name: str('minecraft:stone')}));
    for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
    palette[5] = {Name: str('minecraft:cobblestone')};
    const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, {type: 'int', value}]))});
    const region = {type: 'compound', value: {Position: xyz({x: 0, y: 0, z: 0}), Size: xyz({x: 1, y: 1, z: 1}),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: [[0, 5]]}}};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-pillar-'));
    fs.writeFileSync(path.join(dir, 'float.litematic'), gzipSync(nbt.writeUncompressed({type: 'compound', name: '',
      value: {Metadata: {type: 'compound', value: {Name: str('float')}}, Regions: {type: 'compound', value: {r: region}}}})));
    const item = (id) => ({id, stackSize: 64});
    const noop = async () => {};
    const world = new Map();
    const at = (p) => world.get(`${p.x},${p.y},${p.z}`) ?? (p.y <= 63 ? 'stone' : 'air');
    // stopAt: the job is stopped at its first click with this item; fresh: a new build.js, as after a worker restart
    const float = async ({stopAt = null, fresh = false} = {}) => {
      const job = {t: {}, cancelled: false, args: {file: 'float.litematic', origin: {x: 0, y: 70, z: 0}, chests: []}}; // 6 above the ground at y 63
      const on = {};
      let held = null;
      const bot = {game: {dimension: 'overworld'}, on(e, f) { on[e] = f; }, removeListener() {}, setControlState() {}, look: noop, waitForTicks: noop, tossStack: noop, activateBlock: noop, entities: {}, entity: {position: new Vec3(20.5, 64, 20.5), yaw: 0, pitch: 0},
        inventory: {items: () => [{name: 'cobblestone', count: 64, type: 2}, {name: 'dirt', count: 64, type: 3}], emptySlotCount: () => 34},
        equip: async (it) => { held = it.name; },
        _genericPlace: async (ref, face) => {
          if (held === stopAt) { job.cancelled = true; return; }
          const p = ref.position.plus(face);
          world.set(`${p.x},${p.y},${p.z}`, held);
          on.blockUpdate?.(null, {position: p});
        },
        registry: {itemsByName: {cobblestone: item(2), dirt: item(3), glass: item(4)}, blocksByName: {}},
        pathfinder: {searchRadius: 100, movements: {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: [], blocksToAvoid: new Set()}},
        blockAt: (p) => ({name: at(p), position: p, getProperties: () => ({}), boundingBox: at(p) === 'air' ? 'empty' : 'block', shapes: []})};
      const digAt = async (rr, jj, p) => { world.set(`${p.x},${p.y},${p.z}`, 'air'); on.blockUpdate?.(null, {position: p}); return true; };
      if (fresh) delete require.cache[require.resolve('../../build')];
      const schematic = require('../../build').makeSchematic({goNear: async () => {}, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
        sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))), goals: {GoalNear: class {}}, digAt, deposit: async () => {}, natural: /^(grass_block|dirt)$/, dir});
      const run = schematic({bot, name: 'b', protectedAreas: [], emit() {}, conflict() {}}, job).catch((e) => e);
      const end = await Promise.race([run, new Promise((res) => setTimeout(() => res('hung'), 3000))]);
      job.cancelled = true;
      await run;
      return {end, doing: job.t.doing, dirt: [...world].filter(([, n]) => n === 'dirt').map(([k]) => k)};
    };
    let res = await float();
    assert.strictEqual(at({x: 0, y: 70, z: 0}), 'cobblestone', `the floating cell stands (end: ${res.end}, doing: ${res.doing})`);
    assert.deepStrictEqual(res.dirt, [], `no dirt left under the site (end: ${res.end})`);
    world.clear();
    res = await float({stopAt: 'cobblestone'}); // the pillar stands, then the worker restarts
    assert.strictEqual(res.dirt.length, 6, `the pillar stood before the restart (end: ${res.end})`);
    res = await float({fresh: true});
    fs.rmSync(dir, {recursive: true, force: true});
    assert.deepStrictEqual(res.dirt, [], `after a restart the pillar still comes out (end: ${res.end}, doing: ${res.doing})`);
  }
  { // BUILD-5: a chest whose fill item is in no chest waits for it and asks for it; the block on its lid was left as
    // "1 cells left that this bot cannot place or reach" and the job failed after 300 s (audit 2026-11-19)
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), nbt = require('prismarine-nbt'), {gzipSync} = require('node:zlib');
    const {Vec3} = require('vec3');
    const str = (value) => ({type: 'string', value});
    const int = (value) => ({type: 'int', value});
    const palette = Array.from({length: 32}, () => ({Name: str('minecraft:stone')}));
    for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
    const chestProps = {facing: 'north', type: 'single', waterlogged: 'false'};
    palette[4] = {Name: str('minecraft:chest'), Properties: {type: 'compound', value: Object.fromEntries(Object.entries(chestProps).map(([k, v]) => [k, str(v)]))}};
    palette[5] = {Name: str('minecraft:cobblestone')};
    const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, int(value)]))});
    const packed = 4n | (5n << 5n); // the chest, cobblestone on its lid
    const longs = [[Number(BigInt.asIntN(32, packed >> 32n)), Number(BigInt.asIntN(32, packed))]];
    const shears = {type: 'compound', value: {Slot: {type: 'byte', value: 0}, id: str('minecraft:shears'), Count: {type: 'byte', value: 1}}};
    const region = {type: 'compound', value: {Position: xyz({x: 0, y: 0, z: 0}), Size: xyz({x: 1, y: 2, z: 1}),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: longs},
      TileEntities: {type: 'list', value: {type: 'compound', value: [{x: int(0), y: int(0), z: int(0), Items: {type: 'list', value: {type: 'compound', value: [shears.value]}}}]}}}};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-fill-'));
    fs.writeFileSync(path.join(dir, 'fill.litematic'), gzipSync(nbt.writeUncompressed({type: 'compound', name: '',
      value: {Metadata: {type: 'compound', value: {Name: str('fill')}}, Regions: {type: 'compound', value: {r: region}}}})));
    const store = {x: 5, y: 64, z: 5};
    const job = {t: {}, cancelled: false, args: {file: 'fill.litematic', origin: {x: 0, y: 100, z: 0}, chests: [store]}};
    const item = (id) => ({id, stackSize: 64});
    const noop = async () => {};
    const isChest = (p) => (p.x === 0 && p.y === 100 && p.z === 0) || (p.x === store.x && p.y === store.y && p.z === store.z);
    const bot = {game: {dimension: 'overworld'}, on() {}, removeListener() {}, setControlState() {}, look: noop, waitForTicks: noop, equip: noop, tossStack: noop, activateBlock: noop, entities: {}, entity: {position: new Vec3(0.5, 101, 3.5), yaw: 0, pitch: 0},
      inventory: {items: () => [{name: 'cobblestone', count: 64, type: 2}, {name: 'dirt', count: 64, type: 3}, {name: 'glass', count: 64, type: 4}], emptySlotCount: () => 33},
      openContainer: async () => ({containerItems: () => [], deposit: noop, withdraw: noop, close() {}}),
      registry: {itemsByName: {chest: item(1), cobblestone: item(2), dirt: item(3), glass: item(4), shears: {id: 5, stackSize: 1}}, blocksByName: {}},
      pathfinder: {searchRadius: 100, movements: {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: [], blocksToAvoid: new Set()}},
      blockAt: (p) => (isChest(p) ? {name: 'chest', position: p, getProperties: () => chestProps, boundingBox: 'block', shapes: []}
        : {name: p.y <= 63 ? 'stone' : 'air', position: p, getProperties: () => ({}), boundingBox: p.y <= 63 ? 'block' : 'empty', shapes: []})};
    const needs = [];
    const world = {claim: async () => true, release() {}, postNeed: (b, it, n) => needs.push(`${n} ${it}`), openNeeds: () => [], dropNeed() {}};
    const schematic = require('../../build').makeSchematic({goNear: async () => {}, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
      sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))), goals: {GoalNear: class {}}, digAt: async () => false, deposit: async () => {}, natural: /^(grass_block|dirt)$/, dir});
    const run = schematic({bot, name: 'b', protectedAreas: [], emit() {}, conflict() {}, world}, job).catch((e) => e);
    await new Promise((res) => setTimeout(res, 400));
    const doing = job.t.doing;
    job.cancelled = true;
    await Promise.race([run, new Promise((res) => setTimeout(res, 3000))]);
    fs.rmSync(dir, {recursive: true, force: true});
    assert.match(String(doing), /^waiting for material: .*shears/, `it waits for the shears to fill the chest (doing: ${doing})`);
    assert.ok(needs.includes('1 shears'), `and asks for them (needs: ${needs})`);
  }
};
