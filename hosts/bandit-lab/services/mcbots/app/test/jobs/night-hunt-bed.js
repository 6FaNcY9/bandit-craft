'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // night outside: three blocks down, a lid on top, out in the morning; nothing by day, under a roof, without a lid
    const {nightShelter} = require('../../bots');
    const {Vec3} = require('vec3');
    const mk = ({time = 14000, sky = 15, lid = true, areas = [], top = 'grass_block'} = {}) => {
      const solid = (p) => p.y <= 90 && !(p.x === 0 && p.z === 0 && p.y >= 88 && p.y <= 90 && dug.has(p.y));
      const dug = new Set(), placed = [];
      const inv = lid ? [{name: 'dirt'}] : [];
      const bot = {time: {timeOfDay: time}, entity: {position: new Vec3(0.5, 91, 0.5)}, inventory: {items: () => inv},
        blockAt: (p) => (solid(p) ? {name: p.y === 90 ? top : 'dirt', boundingBox: 'block', position: p, skyLight: 0, getProperties: () => ({})} : {name: 'air', boundingBox: 'empty', position: p, skyLight: sky, getProperties: () => ({})}),
        dig: async (b) => { dug.add(b.position.y); bot.entity.position = new Vec3(0.5, b.position.y, 0.5); if (/dirt|grass/.test(b.name)) inv.push({name: 'dirt'}); },
        equip: async () => {}, placeBlock: async (ref, face) => { placed.push(ref.position.plus(face).y); dug.delete(ref.position.plus(face).y); bot.time.timeOfDay = 1000; }};
      return {r: {bot, protectedAreas: areas, emit() {}}, dug, placed};
    };
    const job = {type: 'chop', t: {}, cancelled: false};
    const a = mk();
    await nightShelter(a.r, job);
    assert.deepStrictEqual(a.placed, [90], 'a lid at the old ground level');
    assert.ok(a.dug.has(89) && a.dug.has(88) && a.dug.has(90), 'three down, and the lid dug out again in the morning');
    const e = mk({lid: false});
    await nightShelter(e.r, job);
    assert.deepStrictEqual(e.placed, [90], 'with nothing in hand the dug grass gives the lid (after a death, 2026-10-15)');
    for (const [why, o] of [['day', {time: 1000}], ['under a roof', {sky: 0}], ['no lid and stone on top', {lid: false, top: 'stone'}], ['protected', {areas: [[-5, -5, 5, 5]]}]]) {
      const b = mk(o);
      await nightShelter(b.r, job);
      assert.strictEqual(b.dug.size, 0, why);
    }
    // combat put a sword back in hand between equip and place: the lid goes back in hand and is placed on the second try
    const sw = mk();
    let equips = 0;
    sw.r.bot.equip = async (it) => { sw.r.bot.heldItem = ++equips === 1 ? {name: 'iron_sword'} : it; };
    const placeLid = sw.r.bot.placeBlock;
    sw.r.bot.placeBlock = async (ref, face) => { if (sw.r.bot.heldItem?.name !== 'dirt') throw new Error('No block has been placed : the block is still air'); return placeLid(ref, face); };
    await nightShelter(sw.r, job);
    assert.deepStrictEqual(sw.placed, [90], 'the lid is placed after the sword swap');
    const c = mk();
    await nightShelter(c.r, {...job, type: 'goto'});
    assert.strictEqual(c.dug.size, 0, 'an owner\'s walk is not paused');
    // A bot more than 0.2 off the cell centre rests on the wall and does not fall: no lid over the open hole (BOTS-1-2).
    const stuck = mk(), said = [];
    stuck.r.emit = (k, m) => said.push(m);
    const dig = stuck.r.bot.dig;
    stuck.r.bot.dig = async (b) => { const p = stuck.r.bot.entity.position; await dig(b); stuck.r.bot.entity.position = p; };
    await nightShelter(stuck.r, job);
    assert.deepStrictEqual([stuck.placed, stuck.r.shelterAt ?? null, !!stuck.r.sheltered], [[], null, false], 'no lid when the bot did not drop');
    assert.ok(said.some((m) => /night shelter given up: did not drop/.test(m)), said.join(' | '));
    const off = mk();
    off.r.bot.entity.position = new Vec3(0.8, 91, 0.5);
    await nightShelter(off.r, job);
    assert.strictEqual(off.dug.size, 0, 'off the cell centre: no hole');
    // a builder shelters only while unfit (bot2 without armour at the iron farm, 2026-10-17)
    const fitB = mk(), bare = mk();
    fitB.r.combat = {fit: () => true};
    bare.r.combat = {fit: () => false};
    await nightShelter(fitB.r, {...job, type: 'schematic'});
    await nightShelter(bare.r, {...job, type: 'schematic'});
    assert.deepStrictEqual([fitB.dug.size, bare.placed], [0, [90]], 'with gear it builds on, without it shelters');
    // the same for chopping and mining: in full iron the crew sat in holes all night (main server 2026-10-19)
    const fitC = mk(), bareC = mk();
    fitC.r.combat = {fit: () => true};
    bareC.r.combat = {fit: () => false};
    await nightShelter(fitC.r, job);
    await nightShelter(bareC.r, job);
    assert.deepStrictEqual([fitC.dug.size, bareC.placed], [0, [90]], 'a fit bot chops on, an unfit one shelters');
    // The night rearm walk only for missing gear: bot20 in full iron at 6 hp walked 240 blocks through the dark from
    // the sorter site (main server 2026-11-14); it heals in a hole on the spot instead.
    {
      const B = require('../../bots');
      const realRearm = B.JOBS.rearm;
      const walks = [];
      B.JOBS.rearm = async (r) => { walks.push(r.name); };
      try {
        const geared = (name, {armour = true, sword = true, food = true} = {}) => {
          const m = mk();
          const inv = [{name: 'dirt'}, ...(sword ? [{name: 'iron_sword'}] : []), ...(food ? [{name: 'bread'}] : [])];
          Object.assign(m.r.bot.inventory, {items: () => inv, slots: armour ? {5: {name: 'iron_helmet'}, 6: {name: 'iron_chestplate'}, 7: {name: 'iron_leggings'}, 8: {name: 'iron_boots'}} : {}});
          m.r.bot.getEquipmentDestSlot = (s) => ({head: 5, torso: 6, legs: 7, feet: 8})[s];
          m.r.bot.registry = {foodsByName: {bread: {}}};
          Object.assign(m.r, {name, combat: {fit: () => false}, supplyChest: {x: 100, y: 64, z: 100}});
          return m;
        };
        const full = geared('full'), noArmour = geared('noArmour', {armour: false}), noSword = geared('noSword', {sword: false}), noFood = geared('noFood', {food: false});
        for (const m of [full, noArmour, noSword, noFood]) await nightShelter(m.r, {...job, type: 'schematic'});
        assert.deepStrictEqual(walks, ['noArmour', 'noSword', 'noFood'], 'only a bot missing armour, a weapon or food walks to the supply chest');
        assert.deepStrictEqual(full.placed, [90], 'the bot in full gear shelters on the spot');
        // with an armoury: there first, the supply chest only while gear is still missing (review 2026-11-16)
        const at = [];
        B.JOBS.rearm = async (r, j) => { at.push(`${r.name}@${j.args.x}`); };
        const emptyArm = geared('emptyArm', {sword: false});
        emptyArm.r.gearChest = {x: -50, y: 64, z: 0};
        await nightShelter(emptyArm.r, {...job, type: 'schematic'});
        const stocked = geared('stocked', {sword: false});
        stocked.r.gearChest = {x: -50, y: 64, z: 0};
        B.JOBS.rearm = async (r, j) => { at.push(`${r.name}@${j.args.x}`); if (j.args.x === -50) r.bot.inventory.items = () => [{name: 'iron_sword'}, {name: 'bread'}]; };
        await nightShelter(stocked.r, {...job, type: 'schematic'});
        assert.deepStrictEqual(at, ['emptyArm@-50', 'emptyArm@100', 'stocked@-50'], 'the supply chest as the fallback, not a second walk when the armoury had it');
      } finally {
        B.JOBS.rearm = realRearm;
      }
    }
    // An agent's new job replaced the waiting one (main server 2026-10-14): back in tonight's hole it waits on
    // without digging a new one, and digs only the lid out in the morning.
    const d = mk({sky: 0});
    d.r.bot.entity.position = new Vec3(0.5, 88, 0.5);
    d.r.shelterAt = new Vec3(0, 90, 0);
    setTimeout(() => { d.r.bot.time.timeOfDay = 1000; }, 50);
    await nightShelter(d.r, job);
    assert.deepStrictEqual([...d.dug], [90], 'only the lid came out');
    assert.deepStrictEqual(d.placed, [], 'no new hole, no new lid');
    assert.strictEqual(d.r.shelterAt, null);
    // An unfit bot's grave waits for SAFE_TRIP (1000), not the end of spawning (23000): the night's mobs are still out at
    // dawn (bot19, 2026-11-19). It waits in the open, so combat must keep fleeing and kiting: no `sheltered`.
    for (const time of [14000, 23100, 200]) {
      const g = mk({time});
      g.r.combat = {fit: () => false};
      let seen = 'never asked';
      const gj = {type: 'grave', t: {}, get cancelled() { seen = !!g.r.sheltered; return true; }};
      await assert.rejects(nightShelter(g.r, gj), /stopped/, `the grave still waits at ${time}`);
      assert.strictEqual(seen, false, `not sheltered while waiting in the open at ${time}`);
    }
    const day = mk({time: 1000});
    day.r.combat = {fit: () => false};
    await nightShelter(day.r, {type: 'grave', t: {}, get cancelled() { return true; }});
  }
  { // digAt rechecks the block after every walk and equip: a Stop or a swapped block means no dig
    const {digAt, Cancelled} = require('../../bots');
    const {Vec3} = require('vec3');
    const pos = new Vec3(5, 64, 5);
    const run = ({onEquip = () => {}, onWalk = () => {}, expect} = {}) => {
      const blocks = new Map([['5,64,5', 'blue_orchid']]);
      const job = {t: {}, cancelled: false};
      let digs = 0;
      const goalsSeen = [];
      const bot = {
        blockAt: (p) => (blocks.get(`${p.x},${p.y},${p.z}`) ? {name: blocks.get(`${p.x},${p.y},${p.z}`), position: p, boundingBox: blocks.get(`${p.x},${p.y},${p.z}`) === 'stone' ? 'block' : 'empty', getProperties: () => ({})} : null),
        entity: {position: new Vec3(3, 64, 3), onGround: true}, game: {dimension: 'overworld'}, entities: {}, inventory: {items: () => []},
        pathfinder: {goto: async (g) => { goalsSeen.push(g.constructor.name); return onWalk(blocks, job); }, stop() {}, setGoal() {}},
        tool: {equipForBlock: async () => onEquip(blocks, job)},
        dig: async () => { digs++; blocks.delete('5,64,5'); },
        stopDigging() {},
      };
      const r = {bot, world: {hostilesNear: () => []}, emit() {}};
      return {go: () => digAt(r, job, pos, expect), digs: () => digs, goalsSeen, blocks};
    };
    let x = run({onEquip: (_, job) => (job.cancelled = true)});
    await assert.rejects(x.go(), Cancelled);
    assert.strictEqual(x.digs(), 0);
    const plant = (n) => n === 'blue_orchid';
    for (const at of ['onEquip', 'onWalk']) {
      x = run({expect: plant, [at]: (blocks) => blocks.set('5,64,5', 'torch')});
      assert.strictEqual(await x.go(), false, at);
      assert.strictEqual(x.digs(), 0, at);
    }
    x = run({onWalk: (blocks) => blocks.set('5,64,5', 'chest')}); // default expect: the block seen first
    assert.strictEqual(await x.go(), false);
    assert.strictEqual(x.digs(), 0);
    x = run({expect: plant});
    assert.strictEqual(await x.go(), true);
    assert.strictEqual(x.digs(), 1);
    // a block with no collision shape is never seen by GoalLookAtBlock's raycast (wheat plot: 4 s search timeouts per cell)
    assert.deepStrictEqual(x.goalsSeen, ['GoalNear']);
    x = run({});
    x.blocks.set('5,64,5', 'stone');
    assert.strictEqual(await x.go(), true);
    assert.deepStrictEqual(x.goalsSeen, ['GoalLookAtBlock']);
  }
  { // hunt and bed (R5): validation, the pure picks, then both jobs against a fake bot
    const {JOBS, VALIDATE, Cancelled} = require('../../bots');
    const H = require('../../hunt');
    const {Vec3} = require('vec3');
    assert.deepStrictEqual(VALIDATE.hunt({animal: 'sheep', count: 3, x: 1, y: 64, z: 2}), {animal: 'sheep', count: 3, x: 1, y: 64, z: 2, radius: 24});
    for (const bad of [{animal: 'wolf'}, {animal: 'constructor'}, {animal: 'cow', count: 99}, {animal: 'cow', radius: 2}]) assert.throws(() => VALIDATE.hunt({x: 1, y: 64, z: 2, ...bad}), bad.animal);
    assert.deepStrictEqual(VALIDATE.bed({x: 1, y: 60, z: 2, facing: 'north'}), {x: 1, y: 60, z: 2, facing: 'north'});
    for (const facing of ['up', 'constructor', undefined]) assert.throws(() => VALIDATE.bed({x: 1, y: 60, z: 2, facing}), /facing/);

    // huntTarget: nearest sheep in range; never named, baby, handled, protected, other kinds or players
    const sheep = (id, x, z, extra = {}) => ({id, name: 'sheep', position: new Vec3(x, 64, z), ...extra});
    const base = {animal: 'sheep', x: 0, y: 64, z: 0, radius: 20, areas: [[100, 100, 120, 120]], done: new Set([9]), me: new Vec3(0, 64, 0)};
    const list = [sheep(1, 10, 0), sheep(2, 3, 0, {metadata: [0, 0, {text: 'Dolly'}]}), sheep(3, 4, 0, {metadata: Object.assign([], {16: true})}), sheep(4, 5, 0, {isValid: false}),
      sheep(5, 6, 0, {type: 'player'}), sheep(9, 2, 0), sheep(6, 105, 105), sheep(7, 30, 0), {id: 8, name: 'cow', position: new Vec3(1, 64, 0)}, sheep(10, 0, 0, {metadata: [0, 0, null]})];
    assert.strictEqual(H.huntTarget(list, base).id, 10, 'a null name is no name');
    assert.strictEqual(H.huntTarget(list.filter((e) => e.id !== 10), base).id, 1, 'nearest unnamed adult sheep in range');
    assert.strictEqual(H.huntTarget(list, {...base, x: 105, z: 105, radius: 30}), undefined, 'protected (and the rest out of range)');
    assert.strictEqual(H.huntTarget(list, {...base, areas: [[5, -5, 12, 5]], me: new Vec3(10, 64, 0)})?.id, 10, 'the one at 10,0 is inside the area, so the next nearest');
    // shaft and rim torches: every 8 layers down, every 6th rim block; a wall torch never needs more than a wall
    const B = require('../../bots');
    assert.deepStrictEqual([0, 7, 8, 9, 16].map((d) => B.shaftTorchDue(80, 80 - d)), [false, false, true, false, true]);
    assert.deepStrictEqual([0, 5, 6, 7, 12].map(B.rimTorchDue), [false, false, true, false, true]);
    {
      const map = new Map([['0,10,0', ['air', 'empty', 15]], ['0,9,0', ['stone', 'block']], ['0,11,0', ['air', 'empty', 15]], ['1,11,0', ['stone', 'block']]]);
      const placed = [];
      const mkr = (items, walls = true) => ({
        getSettings: () => ({torches: true}), combat: {busy: false}, protectedAreas: [], emit() {},
        bot: {
          currentWindow: null, entity: {position: new Vec3(0.5, 10, 0.5)}, heldItem: null, findBlock: () => null,
          registry: {blocksByName: {torch: {id: 1}, wall_torch: {id: 2}}},
          inventory: {items: () => items.map((name) => ({name}))},
          blockAt: (p) => { const b = map.get(`${p.x},${p.y},${p.z}`); return b && (walls || b[0] !== 'stone' || p.y !== 11) ? {name: b[0], boundingBox: b[1], light: b[2], position: p, type: 5} : null; },
          equip: async () => {}, placeBlock: async (ref) => { placed.push(ref.position.toString()); map.set('0,11,0', ['wall_torch', 'empty']); },
        },
      });
      const job = {t: {}};
      await B.lightUp(mkr([]), job, [], {wall: true}); // no torch, no coal: returns quietly, the dig goes on
      await B.lightUp(mkr(['torch'], false), job, [], {wall: true}); // no wall: nothing placed on the floor
      assert.deepStrictEqual(placed, []);
      await B.lightUp(mkr(['torch']), job, [], {wall: true}); // bright enough for an ordinary torch, but a shaft torch is placed
      assert.deepStrictEqual(placed, ['(1, 11, 0)']);
      // never on the wall it faces: in a tunnel that block is dug next and the torch falls with it (main server 2026-10-20)
      const facing = () => { const r = mkr(['torch']); r.bot.entity.yaw = -Math.PI / 2; return r; }; // looking at +x
      map.set('0,11,0', ['air', 'empty', 15]);
      placed.length = 0;
      await B.lightUp(facing(), job, [], {wall: true});
      assert.deepStrictEqual(placed, [], 'the only wall is the one ahead');
      map.set('0,11,1', ['stone', 'block']);
      await B.lightUp(facing(), job, [], {wall: true});
      assert.deepStrictEqual(placed, ['(0, 11, 1)'], 'a side wall instead');
    }
    // foodAnimal: cows, then pigs; chickens only when the meat can be cooked
    const mob = (id, name, x) => ({id, name, position: new Vec3(x, 64, 0)});
    const fo = {x: 0, y: 64, z: 0, radius: 24, areas: [], done: new Set(), me: new Vec3(0, 64, 0)};
    assert.strictEqual(H.foodAnimal([mob(1, 'pig', 3), mob(2, 'cow', 9), mob(3, 'chicken', 1)], fo, true), 'cow');
    assert.strictEqual(H.foodAnimal([mob(1, 'pig', 3), mob(3, 'chicken', 1)], fo, true), 'pig');
    assert.strictEqual(H.foodAnimal([mob(3, 'chicken', 1)], fo, true), 'chicken');
    assert.strictEqual(H.foodAnimal([mob(3, 'chicken', 1)], fo, false), undefined, 'raw chicken is not food');
    assert.strictEqual(H.foodAnimal([mob(2, 'cow', 40)], fo, false), undefined, 'out of range');
    assert.deepStrictEqual([H.MEAT.cow, H.MEAT.pig, H.MEAT.chicken], ['beef', 'porkchop', 'chicken']);

    // bed cells and checks
    const world = (cells) => (x, y, z) => cells[`${x},${y},${z}`] || null;
    const ground = {name: 'stone', boundingBox: 'block'}, air = {name: 'air', boundingBox: 'empty'};
    const flat = (extra = {}) => world({'5,59,5': ground, '5,59,6': ground, '5,60,5': air, '5,60,6': air, ...extra});
    const cells = H.bedCells({x: 5, y: 60, z: 5}, 'south');
    assert.deepStrictEqual([cells.head, cells.back(2)], [{x: 5, y: 60, z: 6}, {x: 5, y: 60, z: 3}]);
    assert.deepStrictEqual(H.bedCheck(flat(), cells, []), {});
    assert.match(H.bedCheck(flat(), cells, [[0, 0, 9, 9]]).problem, /protected/);
    assert.match(H.bedCheck(flat({'5,60,6': {name: 'chest', boundingBox: 'block'}}), cells, []).problem, /chest is in the way/);
    assert.match(H.bedCheck(flat({'5,59,6': air}), cells, []).problem, /nothing solid under 5 60 6/);
    assert.match(H.bedCheck(flat({'5,60,5': {name: 'water', boundingBox: 'empty'}}), cells, []).problem, /water is in the way/);
    assert.match(H.bedCheck(flat({'5,60,6': null}), cells, []).problem, /not loaded/);
    assert.deepStrictEqual(H.bedCheck(flat({'5,60,5': {name: 'red_bed'}, '5,60,6': {name: 'red_bed'}}), cells, []), {present: true});
    assert.deepStrictEqual(H.bedCheck(flat({'5,60,5': {name: 'white_bed'}}), cells, []), {present: true, click: {x: 5, y: 60, z: 5}}, 'one half of any bed is enough');
    assert.deepStrictEqual(H.bedCheck(flat({'5,60,6': {name: 'blue_bed'}}), cells, []), {present: true, click: {x: 5, y: 60, z: 6}});
    assert.ok(H.standable(flat({'5,59,3': ground, '5,60,3': air, '5,61,3': air}), cells.back(2)) === true && !H.standable(flat(), cells.back(2)));
    const woolOf = (o) => Object.entries(o).map(([k, count]) => ({name: `${k}_wool`, count}));
    assert.strictEqual(H.woolColour(woolOf({white: 2, red: 1})), null, 'no colour has 3');
    assert.strictEqual(H.woolColour([...woolOf({white: 2}), {name: 'white_wool', count: 1}, ...woolOf({black: 5})]), 'black', 'the most of a colour with 3+');
    assert.strictEqual(H.woolColour([{name: 'oak_planks', count: 9}]), null);

    // a fake bot: sheep that die after 3 hits (or give wool when sheared), drops, a bed that appears when placed
    const fake = ({sheeps = [], inv = [], blocks = {}, areas = [], night = false, onAttack = () => {}} = {}) => {
      const entities = {}, hits = {}, events = [], infos = [], listeners = new Set();
      for (const s of sheeps) entities[s.id] = {name: 'sheep', height: 1.3, ...s};
      const cell = new Map(Object.entries(blocks));
      const it = (name, count = 1) => ({name, count, type: name.length});
      const bot = {
        entities, inventory: {items: () => inv}, heldItem: null, game: {dimension: 'overworld'}, time: {timeOfDay: night ? 14000 : 1000}, isSleeping: false,
        entity: {position: new Vec3(0, 64, 0), onGround: true},
        pathfinder: {goto: async () => {}, setGoal() {}, stop() {}, isMoving: () => true},
        equip: async (item) => { bot.heldItem = item; events.push(`equip ${item.name}`); },
        lookAt: async () => {},
        attack: (e) => { hits[e.id] = (hits[e.id] || 0) + 1; onAttack(e, hits[e.id]); if (hits[e.id] >= 3) { delete entities[e.id]; entities[100 + e.id] = {name: 'item', position: e.position}; inv.push(it('mutton')); } },
        activateEntity: async (e) => { events.push(`shear ${e.id}`); inv.push(it('white_wool', 2)); },
        blockAt: (p) => { const c = cell.get(`${p.x},${p.y},${p.z}`); return c ? {position: p, ...c} : null; },
        placeBlock: async (ref, face) => { events.push(`place ${ref.position.x},${ref.position.y + 1},${ref.position.z}`); cell.set(`${ref.position.x},${ref.position.y + 1},${ref.position.z}`, {name: 'red_bed'}); cell.set(`${ref.position.x},${ref.position.y + 1},${ref.position.z + 1}`, {name: 'red_bed'}); },
        activateBlock: async (b) => { events.push(`click ${b.name}`); for (const l of listeners) l('Respawn point set'); },
        sleep: async () => { events.push('sleep'); bot.isSleeping = true; for (const l of listeners) l('Respawn point set'); },
        wake: async () => { events.push('wake'); bot.isSleeping = false; },
        on: (n, f) => n === 'messagestr' && listeners.add(f), off: (n, f) => listeners.delete(f),
      };
      return {bot, events, infos, hits, entities, cell, it, r: {bot, world: {hostilesNear: () => []}, combat: {busy: false, epoch: 0}, emit: (k, t) => infos.push(t), protectedAreas: areas}};
    };
    const hunt = (extra = {}) => ({t: {}, cancelled: false, type: 'hunt', args: {animal: 'sheep', count: 2, x: 0, y: 64, z: 0, radius: 20}, ...extra});

    // kills the 2 nearest sheep with the sword, leaves the third and the named one alone
    let f = fake({sheeps: [{id: 1, position: new Vec3(4, 64, 0)}, {id: 2, position: new Vec3(6, 64, 1)}, {id: 3, position: new Vec3(8, 64, 0)}, {id: 4, position: new Vec3(2, 64, 0), metadata: [0, 0, {text: 'Bob'}]}], inv: [{name: 'iron_sword', count: 1, type: 99}]});
    f.bot.entity.position = new Vec3(3.5, 64, 0); // everything within 3 blocks: no walking needed
    let job = hunt();
    await JOBS.hunt(f.r, job);
    assert.strictEqual(job.collected, 2);
    assert.ok(f.entities[3] && f.entities[4] && !f.entities[1] && !f.entities[2], 'two killed, the far and the named one alive');
    assert.ok(f.events.includes('equip iron_sword') && f.infos.some((m) => /hunted 2 sheep/.test(m)), f.infos.join('|'));
    // a sword sweep kills the sheep next to the target: it counts, and nothing is attacked twice
    f = fake({sheeps: [{id: 1, position: new Vec3(2, 64, 0)}, {id: 2, position: new Vec3(2, 64, 1)}, {id: 3, position: new Vec3(3, 64, 0)}], onAttack: (e, n) => { if (e.id === 1 && n === 3) delete f.entities[2]; }});
    job = hunt({args: {animal: 'sheep', count: 3, x: 0, y: 64, z: 0, radius: 20}});
    await JOBS.hunt(f.r, job);
    assert.ok(job.collected === 3 && f.hits[2] === undefined && f.hits[3] === 3, `sweep: ${job.collected}`);
    // not enough sheep: the job fails with the count it reached; protected sheep do not count
    f = fake({sheeps: [{id: 1, position: new Vec3(2, 64, 0)}, {id: 2, position: new Vec3(3, 64, 0)}], areas: [[2.5, -5, 10, 5]]});
    await assert.rejects(JOBS.hunt(f.r, hunt()), /1 of 2 sheep hunted: no more within 20 blocks/);
    assert.strictEqual(f.hits[2], undefined, 'nothing attacked inside the protected area');
    // a point beyond what the server sends is walked to first (bot3 from the wheat fields to sheep 170 blocks off, 2026-10-18)
    f = fake({inv: [{name: 'iron_sword', count: 1, type: 99}]});
    f.bot.pathfinder.goto = async (g) => {
      if (g.x !== undefined) f.bot.entity.position = new Vec3(g.x, 64, g.z);
      if (Math.abs(f.bot.entity.position.x - 120) < 12) f.entities[7] ||= {id: 7, name: 'sheep', height: 1.3, position: new Vec3(121, 64, 1)};
    };
    job = hunt({args: {animal: 'sheep', count: 1, x: 120, y: 64, z: 0, radius: 20}});
    await JOBS.hunt(f.r, job);
    assert.strictEqual(job.collected, 1);
    // shears: the sheep lives and the wool counts; a sheep that gives no wool is left and does not count
    f = fake({sheeps: [{id: 1, position: new Vec3(2, 64, 0)}, {id: 2, position: new Vec3(2, 64, 1)}], inv: [{name: 'shears', count: 1, type: 7}]});
    job = hunt({args: {animal: 'sheep', count: 2, x: 0, y: 64, z: 0, radius: 20}});
    await JOBS.hunt(f.r, job);
    assert.deepStrictEqual(f.events.filter((e) => e.startsWith('shear')), ['shear 1', 'shear 2']);
    assert.ok(f.entities[1] && f.entities[2] && !f.hits[1], 'sheared, not hit');
    f.bot.inventory.items().length = 1; // only the shears are left: nothing more to gain from a sheared sheep
    f.bot.activateEntity = async () => {};
    job = hunt({args: {animal: 'sheep', count: 1, x: 0, y: 64, z: 0, radius: 20}});
    await assert.rejects(JOBS.hunt(f.r, job), /0 of 1 sheep hunted/);
    // a Stop in the middle of the fight ends the job
    f = fake({sheeps: [{id: 1, position: new Vec3(2, 64, 0)}], onAttack: () => (job.cancelled = true)});
    job = hunt();
    await assert.rejects(JOBS.hunt(f.r, job), Cancelled);
    assert.strictEqual(f.hits[1], 1, 'no second blow after the Stop');

    // an animal named or walked into a protected area during the equip, the wait or the look is not hit or sheared (Codex R4-1)
    for (const [how, swap] of [['equip', 'equip'], ['look', 'lookAt']]) {
      for (const [what, change] of [
        ['named', (e) => { e.metadata = [0, 0, {text: 'Dolly'}]; }],
        ['moved into the protected area', (e) => { e.position = new Vec3(2, 64, 0); }],
      ]) {
        for (const shear of [false, true]) {
          f = fake({sheeps: [{id: 1, position: new Vec3(1, 64, 0)}], inv: shear ? [{name: 'shears', count: 1, type: 7}] : [{name: 'iron_sword', count: 1, type: 99}], areas: [[1.5, -5, 5, 5]]});
          const hold = f.bot[swap];
          f.bot[swap] = async (...a) => { change(f.entities[1]); return hold(...a); };
          await assert.rejects(JOBS.hunt(f.r, hunt({args: {animal: 'sheep', count: 1, x: 0, y: 64, z: 0, radius: 20}})), /0 of 1 sheep hunted/);
          assert.ok(!f.hits[1] && !f.events.some((ev) => ev.startsWith('shear')), `${what} during the ${how}${shear ? ' (shears)' : ''}`);
        }
      }
    }

    // bed: protected and blocked cells are refused, a bed lying there is only clicked, a new one is placed then clicked
    const floor = (z) => ({[`5,59,${z}`]: {name: 'stone', boundingBox: 'block'}, [`5,60,${z}`]: {name: 'air', boundingBox: 'empty'}, [`5,61,${z}`]: {name: 'air', boundingBox: 'empty'}});
    const field = () => ({...floor(3), ...floor(4), ...floor(5), ...floor(6)});
    const bedJob = (extra = {}) => ({t: {}, cancelled: false, type: 'bed', args: {x: 5, y: 60, z: 5, facing: 'south'}, ...extra});
    f = fake({blocks: field(), areas: [[0, 0, 9, 9]]});
    await assert.rejects(JOBS.bed(f.r, bedJob()), /protected/);
    f = fake({blocks: {...field(), '5,60,6': {name: 'chest', boundingBox: 'block'}}});
    await assert.rejects(JOBS.bed(f.r, bedJob()), /chest is in the way/);
    f = fake({blocks: field(), inv: woolOf({white: 2, red: 1}).map((w) => ({...w, type: 1}))});
    await assert.rejects(JOBS.bed(f.r, bedJob()), /need 3 wool of one colour/);
    f = fake({blocks: field(), inv: [{name: 'white_wool', count: 3, type: 1}]});
    await assert.rejects(JOBS.bed(f.r, bedJob()), /need 3 more planks and have no logs/);
    f = fake({blocks: field(), inv: [{name: 'red_bed', count: 1, type: 5}]});
    await JOBS.bed(f.r, bedJob());
    assert.deepStrictEqual(f.events, ['equip red_bed', 'place 5,60,5', 'click red_bed'], 'placed on the stone under the foot, then clicked');
    assert.ok(f.infos.some((m) => /^spawn set at 5 60 5$/.test(m)), f.infos.join('|'));
    f = fake({blocks: {...field(), '5,60,5': {name: 'red_bed'}, '5,60,6': {name: 'red_bed'}}}); // the bed is already there: click only
    await JOBS.bed(f.r, bedJob());
    assert.deepStrictEqual(f.events, ['click red_bed']);
    f = fake({blocks: {...field(), '5,60,5': {name: 'red_bed'}, '5,60,6': {name: 'red_bed'}}, night: true}); // at night it sleeps a moment and wakes
    await JOBS.bed(f.r, bedJob());
    assert.deepStrictEqual(f.events, ['sleep', 'wake']);
    f = fake({blocks: {...field(), '5,60,5': {name: 'red_bed'}, '5,60,6': {name: 'red_bed'}}, night: true}); // monsters near: sleep refuses, the click is made anyway
    f.bot.sleep = async () => { throw new Error('there are monsters nearby'); };
    await JOBS.bed(f.r, bedJob());
    assert.deepStrictEqual(f.events, ['click red_bed']);
    assert.ok(f.infos.some((m) => /could not sleep \(there are monsters nearby\)/.test(m)));
    // a Stop while walking to a bed that lies there, or while sleep fails, clicks nothing (Codex R4-2)
    const lying = () => ({...field(), '5,60,5': {name: 'red_bed'}, '5,60,6': {name: 'red_bed'}});
    f = fake({blocks: lying()});
    const arriving = bedJob();
    f.bot.pathfinder.goto = async () => { arriving.cancelled = true; };
    await assert.rejects(JOBS.bed(f.r, arriving), Cancelled);
    assert.deepStrictEqual(f.events, [], 'no click after a Stop on arrival');
    f = fake({blocks: lying(), night: true});
    const sleeping = bedJob();
    f.bot.sleep = async () => { sleeping.cancelled = true; throw new Error('there are monsters nearby'); };
    await assert.rejects(JOBS.bed(f.r, sleeping), Cancelled);
    assert.deepStrictEqual(f.events, [], 'no fallback click after a Stop');
    f = fake({blocks: field(), inv: [{name: 'red_bed', count: 1, type: 5}]}); // a Stop during the equip places nothing
    const stopped = bedJob();
    f.bot.equip = async () => { stopped.cancelled = true; };
    await assert.rejects(JOBS.bed(f.r, stopped), Cancelled);
    assert.deepStrictEqual(f.events, []);
    f = fake({blocks: field(), inv: [{name: 'red_bed', count: 1, type: 5}]}); // the server never shows the bed
    f.bot.placeBlock = async () => {};
    await assert.rejects(JOBS.bed(f.r, bedJob()), /did not take/);
  }
  { // hungry at the site: food from the project's chests, not a 240-block walk to the supply chest (bot3 at the
    // sorter depot at night with 5-8 health, main server 2026-11-15); the supply chest when they hold none or lie farther off
    const B = require('../../bots');
    const {Vec3} = require('vec3');
    const realRearm = B.JOBS.rearm;
    const walks = [];
    B.JOBS.rearm = async (r) => { walks.push(r.name); };
    try {
      const hungry = (name, {depot = [], at = new Vec3(0, 64, 3)} = {}) => {
        const inv = [], chest = {items: depot.map((i) => ({...i})), opened: 0};
        const bot = {food: 17, health: 8, entity: {position: at, onGround: true}, game: {dimension: 'overworld'}, entities: {},
          blockAt: (p) => (p.x === 0 && p.y === 64 && p.z === 0 ? {name: 'chest', position: p, boundingBox: 'block', getProperties: () => ({})} : {name: 'air', position: p, boundingBox: 'empty', getProperties: () => ({})}),
          registry: {foodsByName: {bread: {}}, blocksByName: {}}, pathfinder: {goto: async () => {}, stop() {}, setGoal() {}},
          inventory: {items: () => inv, slots: []},
          openContainer: async () => { chest.opened++; return {containerItems: () => chest.items, close() {}, withdraw: async (type, _m, n) => { inv.push({name: 'bread', type, count: n}); }}; }};
        const r = {name, bot, world: {hostilesNear: () => []}, emit() {}, protectedAreas: [], supplyChest: {x: 240, y: 64, z: 0}, boardPart: true, pickaxeTriedAt: Date.now(),
          current: {type: 'schematic', args: {chests: [{x: 0, y: 64, z: 0}]}}};
        return {r, inv, chest};
      };
      const bread = [{name: 'bread', type: 7, metadata: null, count: 40}];
      const near = hungry('near', {depot: bread}), empty = hungry('empty'), far = hungry('far', {depot: bread, at: new Vec3(239, 64, 0)});
      for (const m of [near, empty, far]) await B.care(m.r, {t: {}, cancelled: false, type: 'schematic', args: m.r.current.args});
      assert.deepStrictEqual(walks, ['empty', 'far'], 'the supply chest only when the project chests hold no food or lie farther off');
      assert.deepStrictEqual([near.inv[0]?.count, empty.chest.opened, far.chest.opened], [32, 1, 0], '32 bread from the depot; an empty depot is looked into once; a far one not at all');
      // no supply chest (MisaBot starved, 2026-11-15 08:34): no rearm walk, but the hunt is still tried
      const misa = hungry('misa'), said = [];
      Object.assign(misa.r, {supplyChest: null, current: {type: 'chop', args: {}}, emit: (k, t) => said.push(t)});
      misa.r.bot.food = 5;
      walks.length = 0;
      await B.care(misa.r, {t: {}, cancelled: false, type: 'chop', args: {}});
      assert.deepStrictEqual(walks, [], 'no supply chest: no rearm walk');
      assert.ok(said.some((t) => /hungry: no cow, pig or cookable chicken/.test(t)), 'the hunt is still tried: ' + said.join('|'));
      // with an armoury: food there first, the supply chest when it has none (review 2026-11-16)
      const at = [];
      B.JOBS.rearm = async (r, j) => { at.push(`${r.name}@${j.args.x}`); };
      const armEmpty = hungry('armEmpty');
      Object.assign(armEmpty.r, {gearChest: {x: -20, y: 64, z: 0}, current: {type: 'chop', args: {}}});
      await B.care(armEmpty.r, {t: {}, cancelled: false, type: 'chop', args: {}});
      const armFood = hungry('armFood');
      Object.assign(armFood.r, {gearChest: {x: -20, y: 64, z: 0}, current: {type: 'chop', args: {}}});
      B.JOBS.rearm = async (r, j) => { at.push(`${r.name}@${j.args.x}`); if (j.args.x === -20) armFood.inv.push({name: 'bread', type: 7, count: 32}); };
      await B.care(armFood.r, {t: {}, cancelled: false, type: 'chop', args: {}});
      assert.deepStrictEqual(at, ['armEmpty@-20', 'armEmpty@240', 'armFood@-20'], 'the supply chest as the fallback for food');
    } finally {
      B.JOBS.rearm = realRearm;
    }
  }
  { // ensureGear at the armoury (review 2026-11-16): a 1-ingot gap (the shield) is fetched while standing there, and a
    // visit that got nothing waits 30 minutes instead of walking back every 5; without an armoury nothing changes
    const B = require('../../bots');
    const {Vec3} = require('vec3');
    const real = {rearm: B.JOBS.rearm, withdraw: B.JOBS.withdraw};
    const calls = [];
    B.JOBS.rearm = async (r, j) => { calls.push(`rearm@${j.args.x}`); };
    B.JOBS.withdraw = async (r, j) => { calls.push(`${j.args.item}@${j.args.x}`); };
    try {
      const mk2 = (gearChest) => {
        const inv = [{name: 'iron_pickaxe', count: 1}, {name: 'iron_sword', count: 1}, {name: 'iron_axe', count: 1}, {name: 'bread', count: 10}];
        const slots = {5: {name: 'iron_helmet'}, 6: {name: 'iron_chestplate'}, 7: {name: 'iron_leggings'}, 8: {name: 'iron_boots'}};
        const bot = {food: 20, health: 20, entity: {position: new Vec3(-20, 64, 0), onGround: true}, game: {dimension: 'overworld'}, entities: {},
          registry: {foodsByName: {bread: {}}, blocksByName: {}}, pathfinder: {goto: async () => {}, stop() {}, setGoal() {}},
          inventory: {items: () => inv, slots}, getEquipmentDestSlot: (s) => ({head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45})[s]};
        return {name: 'bot2', bot, world: {hostilesNear: () => [], dropNeed() {}, postNeed() {}}, emit() {}, protectedAreas: [], supplyChest: {x: 240, y: 64, z: 0}, gearChest, pickaxeTriedAt: Date.now(), current: {type: 'chop', args: {}}};
      };
      const job2 = {t: {}, cancelled: false, type: 'chop', args: {}};
      const r = mk2({x: -20, y: 64, z: 0});
      await B.care(r, job2);
      // only there (raw iron too, on the spot): the supply chest 260 blocks off for one shield ingot is no walk (bots-2-1, audit 2026-11-19)
      assert.deepStrictEqual(calls, ['rearm@-20', 'iron_ingot@-20', 'raw_iron@-20'], 'the shield ingot is taken at the armoury: ' + calls.join(' '));
      calls.length = 0;
      r.gearTriedAt = Date.now() - 6 * 60000; // six minutes later
      await B.care(r, job2);
      assert.deepStrictEqual(calls, [], 'a visit that got nothing waits 30 minutes');
      // beside the supply chest, chestplate missing, store empty: no walk to the armoury, and a rest after the empty round
      const sup = mk2({x: -20, y: 64, z: 0});
      sup.bot.entity.position = new Vec3(240, 64, 0);
      delete sup.bot.inventory.slots[6];
      await B.care(sup, job2);
      assert.deepStrictEqual(calls, ['iron_ingot@240', 'raw_iron@240'], 'only the near source: ' + calls.join(' '));
      calls.length = 0;
      sup.gearTriedAt = Date.now() - 6 * 60000;
      await B.care(sup, job2);
      assert.deepStrictEqual(calls, [], 'an empty round off the armoury waits 30 minutes too: ' + calls.join(' '));
      // the far armoury only when the storage index says it holds the item, and not in the dark
      const idx = mk2({x: -20, y: 64, z: 0});
      idx.bot.entity.position = new Vec3(240, 64, 0);
      delete idx.bot.inventory.slots[6];
      idx.world.stockAt = (c) => (c.x === -20 ? {items: {iron_ingot: 8}} : null);
      await B.care(idx, job2);
      assert.deepStrictEqual(calls, ['iron_ingot@240', 'iron_ingot@-20', 'raw_iron@240'], 'the indexed far chest: ' + calls.join(' '));
      calls.length = 0;
      Object.assign(idx, {gearTriedAt: 0, gearIdleUntil: 0});
      idx.bot.time = {timeOfDay: 14000};
      await B.care(idx, job2);
      assert.ok(!calls.some((c) => c.endsWith('@-20')), 'no far walk at night: ' + calls.join(' '));
      calls.length = 0;
      // far from every source in the dark every source is only skipped: that is no visit, so no 30-minute rest
      Object.assign(idx, {gearTriedAt: 0, gearIdleUntil: 0});
      idx.bot.entity.position = new Vec3(500, 64, 0);
      await B.care(idx, job2);
      assert.deepStrictEqual([calls, idx.gearIdleUntil], [[], 0], 'skipped sources rest nothing: ' + calls.join(' '));
      calls.length = 0;
      const old = mk2(null);
      await B.care(old, job2);
      assert.deepStrictEqual(calls, [], 'no armoury: a 1-ingot gap fetches nothing, as before');
      // A worn-out iron pickaxe waits while a lesser one digs on and no gear source is near: bot19 climbed towards the
      // armoury twice from 100 blocks down with a stone pickaxe in its pack (2026-11-18). A missing sword never waits.
      const deep = (x, y, z, swap) => {
        const w = mk2({x: -20, y: 64, z: 0}), inv = w.bot.inventory.items();
        w.bot.entity.position = new Vec3(x, y, z);
        w.bot.inventory.slots[45] = {name: 'shield'};
        for (const [from, to] of swap) inv.splice(inv.findIndex((i) => i.name === from), 1, ...(to ? [{name: to, count: 1}] : []));
        return w;
      };
      await B.care(deep(100, 0, 100, [['iron_pickaxe', 'stone_pickaxe']]), job2);
      assert.deepStrictEqual(calls, [], 'a stone pickaxe digs on: no walk to the armoury');
      await B.care(deep(-20, 60, 10, [['iron_pickaxe', 'stone_pickaxe']]), job2);
      assert.deepStrictEqual(calls.slice(0, 1), ['rearm@-20'], 'beside the armoury it is replaced at once');
      calls.length = 0;
      await B.care(deep(100, 0, 100, [['iron_pickaxe', null]]), job2);
      assert.deepStrictEqual(calls.slice(0, 1), ['rearm@-20'], 'no pickaxe at all: as before');
      calls.length = 0;
      await B.care(deep(100, 0, 100, [['iron_pickaxe', 'stone_pickaxe'], ['iron_sword', null]]), job2);
      assert.deepStrictEqual(calls.slice(0, 1), ['rearm@-20'], 'a missing sword never waits');
    } finally {
      Object.assign(B.JOBS, real);
    }
  }
  { // light: a dark spot the walk could not get near rests 24 h, as a refused torch does; the keeper re-walked it every
    // 30 min (audit bots-3-4)
    const {JOBS} = require('../../bots');
    const {Vec3} = require('vec3');
    const blocks = new Map([['0,0,0', {name: 'stone', boundingBox: 'block', light: 0}], ['0,1,0', {name: 'air', boundingBox: 'empty', light: 0}], ['0,2,0', {name: 'air', boundingBox: 'empty', light: 0}]]);
    let walks = 0;
    const bot = {
      blockAt: (p) => { const b = blocks.get(`${p.x},${p.y},${p.z}`); return b ? {...b, position: new Vec3(p.x, p.y, p.z)} : null; },
      entity: {position: new Vec3(0, 1, 9), onGround: true}, game: {dimension: 'overworld'}, entities: {}, food: 20, health: 20, heldItem: null,
      registry: {blocks: {}, blocksByName: {torch: {id: 1}, wall_torch: {id: 2}}, foodsByName: {}}, inventory: {items: () => [{name: 'torch', count: 30}], emptySlotCount: () => 20, slots: []},
      pathfinder: {goto: async () => { walks++; bot.entity.position = new Vec3(0, 1, 6); }, stop() {}, setGoal() {}, movements: {}}, findBlocks: () => [],
      equip: async (it) => { bot.heldItem = it; }, placeBlock: async () => { throw new Error('no torch expected'); },
    };
    const r = {bot, world: {hostilesNear: () => [], snapshot: () => ({blocks: []})}, emit() {}, protectedAreas: [], supplyChest: null, combat: {fit: () => true}};
    const job = () => ({t: {}, cancelled: false, type: 'light', args: {x1: 0, y1: 0, z1: 0, x2: 0, y2: 2, z2: 0, zone: 'Far'}});
    await JOBS.light(r, job());
    assert.ok(walks > 0, 'the first round walks to the spot');
    walks = 0; r.noPath = null; bot.entity.position = new Vec3(0, 1, 9); // next keeper round, the 10 min no-path memory is gone
    await JOBS.light(r, job());
    assert.strictEqual(walks, 0, 'the second round does not walk to a spot it could not reach');
  }
};
