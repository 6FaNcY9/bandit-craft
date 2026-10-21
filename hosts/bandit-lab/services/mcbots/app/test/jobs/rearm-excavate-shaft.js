'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // rearm: the optional spare pickaxe / logs / planks never end the equipment step (R2-4)
    const {JOBS, Cancelled} = require('../../bots');
    const {Vec3} = require('vec3');
    const SLOT = {head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45};
    const it = (name, count = 1) => ({name, count, type: name.length * 7 + name.charCodeAt(0), metadata: null});
    const PLANKS = {oak_planks: 900, birch_planks: 901};
    // a shared chest so two bots can race for the same stack; cap = most stacks the bot can carry
    const chestOf = (items) => ({items: items.map((i) => ({...i})), opened: 0, closed: 0});
    const botOf = (chest, {inv = [], cap = 36, craft, failAt = {}} = {}) => {
      const slots = [];
      const equipped = [];
      const bot = {
        findBlocks: () => [new Vec3(0, 64, 0)],
        blockAt: (p) => (p.y === 64 ? {name: 'chest', position: p, boundingBox: 'block', getProperties: () => ({})} : null),
        entity: {position: new Vec3(0, 64, 3), onGround: true}, game: {dimension: 'overworld'}, entities: {},
        registry: {blocksByName: {chest: {id: 1}}, itemsByName: {...Object.fromEntries(Object.entries(PLANKS).map(([k, v]) => [k, {id: v}]))}, foodsByName: {bread: {}}},
        pathfinder: {goto: async () => {}, stop() {}, setGoal() {}},
        inventory: {items: () => inv, slots},
        getEquipmentDestSlot: (s) => SLOT[s],
        openContainer: async () => {
          chest.opened++;
          return {
            containerItems: () => chest.items,
            close: () => chest.closed++,
            withdraw: async (type, _m, n) => {
              if (failAt.withdraw) throw new Error(failAt.withdraw);
              const src = chest.items.find((i) => i.type === type);
              if (!src || src.count < n) throw new Error('Server rejected transaction');
              if (!inv.some((i) => i.type === type) && inv.length >= cap) throw new Error('Inventory is full');
              src.count -= n;
              if (!src.count) chest.items.splice(chest.items.indexOf(src), 1);
              const mine = inv.find((i) => i.type === type);
              if (mine) mine.count += n; else inv.push({...src, count: n});
            },
          };
        },
        recipesFor: (id) => [{id}],
        craft: craft || (async (recipe, n) => {
          const logI = inv.findIndex((i) => /_log$/.test(i.name));
          inv[logI].count -= n; if (!inv[logI].count) inv.splice(logI, 1);
          inv.push({name: 'oak_planks', type: recipe.id, count: 4 * n});
        }),
        equip: async (item, dest) => { equipped.push(`${item.name}>${dest}`); },
      };
      return {bot, inv, equipped};
    };
    const run = (b, job = {t: {}, cancelled: false}) => {
      const infos = [];
      const r = {bot: b.bot, world: {hostilesNear: () => []}, emit: (k, m) => infos.push(m), protectedAreas: [], supplyChest: null};
      return {go: () => JOBS.rearm(r, Object.assign(job, {args: {x: 0, y: 64, z: 0}})), job, infos};
    };
    // 1. full inventory with a pickaxe and carried armour: the spare pickaxe cannot be taken, the armour is worn
    let chest = chestOf([it('iron_pickaxe'), it('bread', 20)]);
    let b = botOf(chest, {inv: [it('stone_pickaxe'), it('iron_helmet'), it('iron_chestplate')], cap: 3});
    let x = run(b);
    await x.go();
    assert.deepStrictEqual(b.equipped, ['iron_helmet>head', 'iron_chestplate>torso']);
    assert.strictEqual(chest.closed, chest.opened, 'window closed');
    assert.ok(x.infos.some((m) => /could not take iron_pickaxe/.test(m)), 'reported');
    assert.strictEqual(b.inv.filter((i) => i.name === 'iron_pickaxe').length, 0);
    // 2. the last spare is taken between containerItems() and withdraw(): rearm still equips and feeds
    chest = chestOf([it('diamond_sword'), it('iron_pickaxe'), it('bread', 20)]);
    b = botOf(chest, {inv: [it('stone_pickaxe'), it('iron_boots')]});
    const left = b.bot.openContainer;
    b.bot.openContainer = async (...a) => {
      const box = await left(...a);
      const w = box.withdraw;
      box.withdraw = async (type, m, n) => {
        if (chest.items.find((i) => i.type === type)?.name === 'iron_pickaxe') chest.items.splice(chest.items.findIndex((i) => i.type === type), 1); // another bot was faster
        return w(type, m, n);
      };
      return box;
    };
    x = run(b);
    await x.go();
    assert.deepStrictEqual(b.equipped.sort(), ['diamond_sword>hand', 'iron_boots>feet']);
    assert.strictEqual(b.inv.find((i) => i.name === 'bread')?.count, 20, 'food still taken');
    assert.strictEqual(chest.closed, 1);
    // 3. the log stack changed (a taller one than offered): not an error either
    chest = chestOf([it('oak_log', 1)]);
    b = botOf(chest, {inv: [it('stone_sword')]});
    b.bot.openContainer = ((f) => async () => { const box = await f(); const w = box.withdraw; box.withdraw = async () => { chest.items.length = 0; return w(1, null, 2); }; return box; })(b.bot.openContainer);
    await run(b).go();
    assert.deepStrictEqual(b.equipped, ['stone_sword>hand']);
    // 4. full output inventory: the planks craft fails; reported, the rest done, no throw
    chest = chestOf([it('oak_log', 2)]);
    b = botOf(chest, {inv: [it('iron_sword')], craft: async () => { throw new Error('Inventory full'); }});
    x = run(b);
    await x.go();
    assert.ok(/no planks/.test(x.job.progress), x.job.progress);
    assert.ok(x.infos.some((m) => /no planks \(oak_log: Inventory full\)/.test(m)));
    assert.deepStrictEqual(b.equipped, ['iron_sword>hand']);
    // 4b. a craft that returns but makes nothing is reported too
    b = botOf(chestOf([it('oak_log', 1)]), {craft: async () => {}});
    x = run(b);
    await x.go();
    assert.ok(/no planks/.test(x.job.progress) && x.infos.some((m) => /nothing crafted/.test(m)));
    // 5. 0 / 1 / 2 logs become planks, a woodcutter's 3+ stay logs
    for (const [logs, planks] of [[0, 0], [1, 4], [2, 8], [3, 0], [20, 0]]) {
      b = botOf(chestOf([]), {inv: logs ? [it('oak_log', logs)] : []});
      x = run(b);
      await x.go();
      const n = (re) => b.inv.filter((i) => re.test(i.name)).reduce((s, i) => s + i.count, 0);
      assert.strictEqual(n(/_planks$/), planks, `${logs} logs`);
      assert.strictEqual(n(/_log$/), planks ? 0 : logs, `${logs} logs left`);
      assert.ok(!/no planks/.test(x.job.progress), `${logs} logs: ${x.job.progress}`);
    }
    // 5b. logs from the chest: never more than 2 in total, then converted
    chest = chestOf([it('oak_log', 64)]);
    b = botOf(chest, {inv: [it('oak_log', 1)]});
    await run(b).go();
    assert.strictEqual(chest.items[0].count, 63);
    assert.strictEqual(b.inv.find((i) => /_planks/.test(i.name))?.count, 8);
    // 6. a Stop during a failed withdrawal ends the job and closes the window
    chest = chestOf([it('iron_helmet')]);
    b = botOf(chest);
    const job = {t: {}, cancelled: false};
    b.bot.openContainer = ((f) => async () => { const box = await f(); box.withdraw = async () => { job.cancelled = true; throw new Error('aborted'); }; return box; })(b.bot.openContainer);
    await assert.rejects(run(b, job).go(), Cancelled);
    assert.strictEqual(chest.closed, chest.opened);
    // 7. two bots re-arm from the same chest with one spare pickaxe: one gets it, nobody throws or duplicates
    chest = chestOf([it('iron_pickaxe'), it('bread', 40)]);
    const A = botOf(chest, {inv: [it('stone_pickaxe')]}), B = botOf(chest, {inv: [it('stone_pickaxe')]});
    await Promise.all([run(A).go(), run(B).go()]);
    const picks = [A, B].map((q) => q.inv.filter((i) => i.name === 'iron_pickaxe').reduce((s, i) => s + i.count, 0));
    assert.strictEqual(picks[0] + picks[1], 1, 'one spare, one owner');
    assert.strictEqual(chest.closed, chest.opened);
    // 8. a Stop inside the first armour equip (or the craft) starts no further equip or craft (Codex R2-3)
    for (const at of ['equip', 'craft']) {
      chest = chestOf([]);
      const carried = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'totem_of_undying', 'diamond_sword'].map((n) => it(n));
      b = botOf(chest, {inv: [...carried, ...(at === 'craft' ? [it('oak_log', 2)] : [])]});
      const j = {t: {}, cancelled: false};
      let calls = 0;
      const stop = async () => { calls++; j.cancelled = true; };
      if (at === 'equip') b.bot.equip = stop;
      else { b.bot.craft = stop; b.bot.equip = async () => { calls++; }; }
      await assert.rejects(run(b, j).go(), Cancelled, at);
      assert.strictEqual(calls, 1, `${at}: nothing is started after the Stop`);
      assert.strictEqual(chest.closed, chest.opened);
    }
  }
  { // excavate: digs natural ground top-down, leaves placed blocks and protected areas alone
    const {JOBS, VALIDATE} = require('../../bots');
    assert.deepStrictEqual(VALIDATE.excavate({x1: 5, y1: 60, z1: 5, x2: 3, y2: 58, z2: 4}), {x1: 3, y1: 58, z1: 4, x2: 5, y2: 60, z2: 5});
    assert.throws(() => VALIDATE.excavate({x1: 0, y1: 60, z1: 0, x2: 9, y2: 60, z2: 0}), /at most 9/);
    assert.throws(() => VALIDATE.excavate({x1: 0, y1: 60, z1: 0, x2: 0, y2: 65, z2: 0}), /5 high/);
    const {Vec3} = require('vec3');
    const blocks = new Map([['0,60,0', 'stone'], ['1,60,0', 'cobblestone'], ['0,59,0', 'dirt'], ['1,59,0', 'chest'], ['0,58,0', 'iron_ore']]);
    const order = [];
    const bot = {
      blockAt: (p) => (blocks.get(`${p.x},${p.y},${p.z}`) ? {name: blocks.get(`${p.x},${p.y},${p.z}`), type: 1, position: p, boundingBox: 'block', getProperties: () => ({})} : {name: 'air', type: 0, position: p, boundingBox: 'empty'}),
      entity: {position: new Vec3(0, 61, 2), onGround: true}, game: {dimension: 'overworld'}, entities: {}, food: 20,
      registry: {blocks: {}, foodsByName: {}},
      inventory: {items: () => [{type: 2, name: 'stone_pickaxe'}], emptySlotCount: () => 30, slots: []}, getEquipmentDestSlot: () => 5,
      pathfinder: {goto: async () => {}, stop() {}, setGoal() {}}, tool: {equipForBlock: async () => {}},
      dig: async (b) => { order.push(`${b.name}@${b.position.y}`); blocks.delete(`${b.position.x},${b.position.y},${b.position.z}`); },
      stopDigging() {},
    };
    const job = {t: {}, cancelled: false, type: 'excavate', args: {x1: 0, y1: 58, z1: 0, x2: 1, y2: 60, z2: 0}};
    const r = {bot, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [], supplyChest: null, combat: null};
    await JOBS.excavate(r, job);
    assert.ok(!job.noop, 'a dig that removed blocks is not "already complete"');
    assert.deepStrictEqual(order, ['stone@60', 'dirt@59', 'iron_ore@58'], 'top-down, natural ground only');
    const again = {...job, t: {}};
    await JOBS.excavate(r, again);
    assert.strictEqual(again.noop, true, 'a second dig of the same room had nothing to do');
    assert.deepStrictEqual([...blocks.values()].sort(), ['chest', 'cobblestone'], 'placed blocks stay');
    await assert.rejects(JOBS.excavate({...r, protectedAreas: [[-5, -5, 5, 5]]}, {...job, t: {}}), /protected/);
    { // 2026-10-12: a pillar block hanging over the open shaft (-277 54 -209) ended the whole shaft; it is left, the rest is dug
      for (const [k, v] of [['0,60,0', 'stone'], ['0,59,0', 'dirt'], ['0,58,0', 'iron_ore']]) blocks.set(k, v);
      order.length = 0;
      const far = {...bot, entity: {position: new Vec3(0, 61, 20), onGround: true}, pathfinder: {...bot.pathfinder, goto: async (g) => { if (g?.pos?.y === 59) throw new Error('No path to the goal!'); }}};
      const infos = [];
      await assert.rejects(JOBS.excavate({...r, bot: far, emit: (kind, text) => infos.push(text)}, {...job, t: {}}), /1 blocks of the room were not dug/);
      assert.deepStrictEqual(order, ['stone@60', 'iron_ore@58'], 'the layers below the unreachable block are still dug');
      assert.ok(infos.some((t) => /left a dirt block at 0 59 0: could not reach/.test(t)), infos.join('\n'));
      // A shaft's later passes skip what had no way to it: bot2 walked to each such block three times (2026-10-14).
      let walks = 0;
      const counting = {...far, pathfinder: {...far.pathfinder, goto: async (g) => { if (g?.pos?.y === 59) { walks++; throw new Error('No path to the goal!'); } }}};
      const pass = (unreachable) => Object.assign({...job, t: {}}, {unreachable});
      const seen = new Set();
      await assert.rejects(JOBS.excavate({...r, bot: counting, emit() {}}, pass(seen)), /were not dug/);
      const first = walks;
      assert.deepStrictEqual([...seen], ['overworld:0,59,0']);
      await assert.rejects(JOBS.excavate({...r, bot: counting, emit() {}}, pass(seen)), /1 blocks of the room were not dug/);
      assert.strictEqual(walks, first, 'no walk to it in the next pass');
    }
  }
  { // shaft: 1-high excavate layers top-down, one stair step per layer spiralling along the walls
    const {JOBS, VALIDATE, stairRing} = require('../../bots');
    const {Vec3} = require('vec3');
    assert.deepStrictEqual(VALIDATE.shaft({x1: 15, z1: 0, x2: 0, z2: 15}), {x1: 0, z1: 0, x2: 15, z2: 15, top: 80, bottom: -59});
    assert.strictEqual(VALIDATE.shaft({x1: 0, z1: 0, x2: 3, z2: 3, top: 60, bottom: -64}).bottom, -59, 'never into bedrock');
    assert.throws(() => VALIDATE.shaft({x1: 0, z1: 0, x2: 16, z2: 3}), /16 x 16/);
    const ring = stairRing(0, 0, 15, 15);
    assert.strictEqual(ring.length, 60);
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; assert.strictEqual(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), 1, 'each step is next to the one below'); }
    const blocks = new Map();
    for (let y = 58; y <= 60; y++) for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) blocks.set(`${x},${y},${z}`, 'stone');
    const bot = {
      blockAt: (p) => (blocks.get(`${p.x},${p.y},${p.z}`) ? {name: 'stone', type: 1, position: p, boundingBox: 'block', getProperties: () => ({})} : {name: 'air', type: 0, position: p, boundingBox: 'empty'}),
      entity: {position: new Vec3(0, 61, 4), onGround: true}, game: {dimension: 'overworld'}, entities: {}, food: 20,
      registry: {blocks: {}, foodsByName: {}},
      inventory: {items: () => [{type: 2, name: 'stone_pickaxe'}], emptySlotCount: () => 30, slots: []}, getEquipmentDestSlot: () => 5,
      pathfinder: {goto: async () => {}, stop() {}, setGoal() {}}, tool: {equipForBlock: async () => {}},
      dig: async (b) => { blocks.delete(`${b.position.x},${b.position.y},${b.position.z}`); },
      stopDigging() {},
    };
    const job = {t: {}, cancelled: false, type: 'shaft', args: VALIDATE.shaft({x1: 0, z1: 0, x2: 2, z2: 2, top: 60, bottom: 58})};
    const dug = [];
    const dig0 = bot.dig;
    bot.dig = async (b) => { dug.push(`${b.position.x},${b.position.z}`); return dig0(b); };
    await JOBS.shaft({name: 'bot18', bot, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [], supplyChest: null, combat: null}, job);
    assert.strictEqual(dug[0], '0,2', 'bot18 (corner 2) starts at x1 z2');
    assert.deepStrictEqual([...blocks.keys()].sort(), ['0,60,0', '1,59,0', '2,58,0'], 'one step left per layer, each one further along');
    { // a gravel step is replaced with cobblestone before the layer below goes
      const {JOBS: J} = require('../../bots');
      const place0 = J.place, fixed = [];
      J.place = async (r2, j) => { fixed.push(j.args); blocks.set(`${j.args.x},${j.args.y},${j.args.z}`, 'cobblestone'); };
      for (let y = 58; y <= 60; y++) for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) blocks.set(`${x},${y},${z}`, 'stone');
      blocks.set('1,59,0', 'gravel');
      const name0 = bot.blockAt;
      bot.blockAt = (p) => { const n = blocks.get(`${p.x},${p.y},${p.z}`); return n ? {name: n, type: 1, position: p, boundingBox: 'block', getProperties: () => ({})} : {name: 'air', type: 0, position: p, boundingBox: 'empty'}; };
      try {
        await JOBS.shaft({name: 'bot18', bot, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [], supplyChest: null, combat: null}, {...job, t: {}});
      } finally { J.place = place0; bot.blockAt = name0; }
      assert.deepStrictEqual(fixed.map((a) => [a.item, a.x, a.y, a.z]), [['cobblestone', 1, 59, 0]]);
    }
    assert.deepStrictEqual([job.t.done, job.t.total], [3, 3]);
    { // unloaded chunks are not "done": the shaft does not finish in 0 s after a login
      await assert.rejects(JOBS.shaft({name: 'bot18', bot: {...bot, blockAt: () => null}, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [], supplyChest: null, combat: null}, {...job, t: {}}), /24 blocks were left/);
    }
    { // above the surface (an all-air layer) no step is "fixed": no floating stair
      const {JOBS: J} = require('../../bots');
      const place0 = J.place, fixed = [];
      J.place = async (r2, j) => { fixed.push(j.args); };
      try {
        await JOBS.shaft({name: 'bot18', bot: {...bot, blockAt: (p) => ({name: 'air', type: 0, position: p, boundingBox: 'empty'})}, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [], supplyChest: null, combat: null}, {...job, t: {}});
      } finally { J.place = place0; }
      assert.deepStrictEqual(fixed, []);
    }
    for (let y = 58; y <= 60; y++) for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) blocks.set(`${x},${y},${z}`, 'stone');
    dug.length = 0;
    await JOBS.shaft({name: 'bot17', bot, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [], supplyChest: null, combat: null}, {...job, t: {}});
    assert.strictEqual(dug[0], '2,0', 'bot17 (corner 1) starts at x2 z1');
    const {layerOrder} = require('../../bots');
    assert.deepStrictEqual(layerOrder(0, 0, 2, 2, 3).slice(0, 4), [[2, 2], [1, 2], [2, 1], [1, 1]], 'growing squares from the corner');
    assert.deepStrictEqual(layerOrder(0, 0, 1, 1, -1), [[0, 0], [0, 1], [1, 0], [1, 1]], 'rooms row by row');
  }
  { // junk toss keeps one pillar stack (cobbled_deepslate here), so the bot can climb out of a deep shaft
    const {tossJunk} = require('../../bots');
    const tossed = [];
    const inv = [{name: 'cobbled_deepslate', count: 64}, {name: 'andesite', count: 64}];
    const r = {bot: {inventory: {items: () => inv}, tossStack: async (it) => { tossed.push(it.name); }}};
    await tossJunk(r, {args: {}, cancelled: false});
    assert.deepStrictEqual(tossed, ['andesite'], 'keeps cobbled_deepslate, tosses andesite');
  }
  { // the floor under the supply chest and a running shaft's stair steps are never dug, by a job or a walk (Codex R4-3, R4-4)
    const {JOBS, VALIDATE, BotRunner, guardDigs, safeMovements, NATURAL} = require('../../bots');
    const {Movements} = require('mineflayer-pathfinder');
    const md = require('minecraft-data')('26.1');
    const {Vec3} = require('vec3');
    const blocks = new Map([['-37,65,-200', 'chest']]);
    for (let x = -38; x <= -36; x++) for (let z = -201; z <= -199; z++) blocks.set(`${x},64,${z}`, 'stone');
    const dug = [];
    const bot = {
      blockAt: (p) => { const n = blocks.get(`${p.x},${p.y},${p.z}`); return n ? {name: n, type: md.blocksByName[n].id, position: p, boundingBox: 'block', getProperties: () => ({})} : {name: 'air', type: 0, position: p, boundingBox: 'empty', getProperties: () => ({})}; },
      entity: {position: new Vec3(-37, 66, -196), onGround: true}, game: {dimension: 'overworld'}, entities: {}, food: 20, registry: md,
      inventory: {items: () => [{type: md.itemsByName.stone_pickaxe.id, name: 'stone_pickaxe'}], emptySlotCount: () => 30, slots: []},
      pathfinder: {goto: async () => {}, stop() {}, setGoal() {}, isMining: () => true}, tool: {equipForBlock: async () => {}},
      dig: async (b) => { dug.push(b.position.toString()); blocks.delete(`${b.position.x},${b.position.y},${b.position.z}`); },
      equip: async () => {}, placeBlock: async () => {}, stopDigging() {}, on() {}, getEquipmentDestSlot: () => 5,
    };
    const runner = Object.assign(Object.create(BotRunner.prototype), {name: 'bot5', bot, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [[-80, -144, 80, 80], [112, 368, 272, 592]], supplyChest: {x: -37, y: 65, z: -200}, combat: null, current: {cancelled: false}});
    guardDigs(runner, bot);
    // the exact reproduction: a shaft over the chest's floor fails before it digs anything
    const job = {t: {}, cancelled: false, type: 'shaft', args: VALIDATE.shaft({x1: -38, z1: -201, x2: -36, z2: -199, top: 65, bottom: 64})};
    await assert.rejects(JOBS.shaft(runner, job), /holds up the supply chest/);
    assert.deepStrictEqual(dug, []);
    assert.strictEqual(blocks.get('-37,64,-200'), 'stone');
    await assert.rejects(JOBS.excavate(runner, {t: {}, cancelled: false, type: 'excavate', args: {x1: -38, y1: 64, z1: -201, x2: -36, y2: 64, z2: -199}}), /holds up the supply chest/);
    // a walk (the pathfinder) cannot dig the floor either, and does not plan to
    await assert.rejects(bot.dig(bot.blockAt(new Vec3(-37, 64, -200)), true), /holds up the base/);
    await assert.rejects(bot.dig(bot.blockAt(new Vec3(-38, 64, -201)), true), /holds up the base/);
    const mv = safeMovements(bot, runner.protectedAreas, runner);
    mv.getBlock = () => ({liquid: false, canFall: false});
    assert.ok(!mv.safeToBreak(bot.blockAt(new Vec3(-37, 64, -200))), 'never planned as a dig');
    blocks.set('-37,63,-200', 'stone');
    assert.ok(mv.safeToBreak(bot.blockAt(new Vec3(-37, 63, -200))), 'ground further down is not reserved');
    assert.deepStrictEqual(dug, []);

    // a shaft's retained steps are reserved from the start until the job ends
    blocks.clear();
    for (let y = 58; y <= 60; y++) for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) blocks.set(`${x},${y},${z}`, 'stone');
    runner.supplyChest = null; runner.protectedAreas = [];
    let seen = null;
    const dig0 = bot.dig;
    let bridging = null;
    const mvShaft = safeMovements(bot, [], runner);
    const items0 = bot.inventory.items;
    bot.inventory.items = () => [...items0(), {type: md.itemsByName.cobblestone.id, name: 'cobblestone', count: 16}];
    bot.dig = async (b) => { seen ||= [...runner.keepCells].sort(); bridging ??= mvShaft.countScaffoldingItems(); return dig0(b); };
    await JOBS.shaft(runner, {t: {}, cancelled: false, type: 'shaft', args: VALIDATE.shaft({x1: 0, z1: 0, x2: 2, z2: 2, top: 60, bottom: 58})});
    assert.deepStrictEqual(seen, ['0,60,0', '1,59,0', '2,58,0']);
    assert.strictEqual(runner.keepCells, null, 'released when the job ends');
    // no scaffolding while the shaft is dug: bot2 bridged over the void and stranded on one block (2026-10-15)
    assert.strictEqual(bridging, 0, 'a walk during the shaft places none of its 16 cobblestone');
    assert.strictEqual(mvShaft.countScaffoldingItems(), 16, 'after the shaft the blocks count again');
    bot.inventory.items = items0;
    runner.keepCells = new Set(seen);
    runner.digOnly = NATURAL;
    blocks.set('0,60,0', 'stone'); blocks.set('1,60,0', 'stone');
    dug.length = 0;
    await assert.rejects(bot.dig(bot.blockAt(new Vec3(0, 60, 0)), true), /holds up the base or a shaft step/);
    const mv2 = safeMovements(bot, [], runner);
    mv2.getBlock = () => ({liquid: false, canFall: false});
    assert.ok(!mv2.safeToBreak(bot.blockAt(new Vec3(0, 60, 0))), 'a retained step is never planned as a dig');
    assert.ok(mv2.safeToBreak(bot.blockAt(new Vec3(1, 60, 0))), 'other natural ground still is');
    blocks.set('5,60,5', 'chest');
    const placeCost = (x, y, z) => Math.max(...mv2.exclusionAreasPlace.map((f) => f(bot.blockAt(new Vec3(x, y, z)))));
    assert.deepStrictEqual([placeCost(5, 61, 5), placeCost(1, 61, 0)], [100, 0], 'no block on a chest, on stone it may');
    // a zone keeps its height for digs too: a tunnel under the iron hall (y60-64) may be dug (highway route1, 2026-10-19)
    const kept = [runner.keepCells, runner.digOnly];
    runner.keepCells = null; runner.digOnly = null; runner.protectedAreas = [[0, 0, 10, 10, 60, 64]];
    blocks.set('3,57,3', 'stone'); blocks.set('3,61,3', 'stone');
    dug.length = 0;
    await bot.dig(bot.blockAt(new Vec3(3, 57, 3)), true);
    await assert.rejects(bot.dig(bot.blockAt(new Vec3(3, 61, 3)), true), /protected area/);
    assert.deepStrictEqual(dug, [new Vec3(3, 57, 3).toString()], 'under the zone yes, in it no');
    [runner.keepCells, runner.digOnly] = kept; runner.protectedAreas = [];

    // a shaft that could not dig everything is incomplete, not finished (Codex R4-5)
    runner.keepCells = null; runner.digOnly = null;
    const one = () => ({t: {}, cancelled: false, type: 'shaft', args: VALIDATE.shaft({x1: 0, z1: 0, x2: 2, z2: 2, top: 60, bottom: 60})});
    const fill = () => { blocks.clear(); for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) blocks.set(`${x},60,${z}`, 'stone'); };
    fill(); dug.length = 0;
    const real = bot.blockAt;
    bot.blockAt = () => null; // nothing loaded
    await assert.rejects(JOBS.shaft(runner, one()), /the shaft reached y 60 but 8 blocks were left/);
    bot.blockAt = real;
    assert.deepStrictEqual(dug, []);
    fill();
    runner.world.claim = async () => false; // every cell held by someone else
    await assert.rejects(JOBS.shaft(runner, one()), /the shaft reached y 60 but 8 blocks were left/);
    runner.world.claim = async () => true;
    fill();
    await JOBS.shaft(runner, one());
    assert.strictEqual(blocks.size, 1, 'a complete shaft still finishes (the kept step is left)');
  }
  { // rim: a wall one block outside the shaft on the ground, with a gap at the stair entrance
    const {JOBS, VALIDATE} = require('../../bots');
    const {Vec3} = require('vec3');
    const bot = {
      blockAt: (p) => (p.y <= 64 ? {name: 'grass_block', boundingBox: 'block'} : {name: 'air', boundingBox: 'empty'}),
      entity: {position: new Vec3(0, 65, -3), onGround: true}, game: {dimension: 'overworld'}, entities: {},
      pathfinder: {goto: async () => {}, stop() {}, setGoal() {}},
    };
    const placed = [];
    const place0 = JOBS.place;
    JOBS.place = async (r, j) => { placed.push(j.args); };
    try {
      const job = {t: {}, cancelled: false, type: 'rim', args: VALIDATE.rim({x1: 0, z1: 0, x2: 2, z2: 2, top: 80})};
      await JOBS.rim({bot, name: 'bot16', world: {hostilesNear: () => []}, emit() {}, protectedAreas: []}, job);
      assert.ok(placed.every((p) => p.y === 65 && p.item === 'cobblestone_wall'), 'on the ground');
      assert.ok(placed.length > 0 && placed.length < 16, 'the ring of 16 has a gap');
      assert.ok(placed.every((p) => p.x < 0 || p.x > 2 || p.z < 0 || p.z > 2), 'never inside the shaft');
    } finally {
      JOBS.place = place0;
    }
  }
  { // explore: a protected direction is skipped, not the whole search
    const {explore} = require('../../bots');
    const {Vec3} = require('vec3');
    const goals = [];
    const bot = {entity: {position: new Vec3(0, 64, 0), onGround: true}, game: {dimension: 'overworld'}, entities: {},
      pathfinder: {goto: async (g) => { goals.push(g); }, stop() {}, setGoal() {}}};
    // bot17 + n 1 starts east ([1, 0]); the east target 32 0 is protected.
    await explore({bot, name: 'bot17', protectedAreas: [[20, -10, 40, 10]], emit() {}, world: {hostilesNear: () => []}}, {t: {}, cancelled: false, type: 'chop', args: {}}, 'logs', 1);
    assert.ok(goals.length >= 1, 'it still walks somewhere');
    assert.ok(!goals.some((g) => g.x === 32 && g.z === 0), 'not into the protected area');
    // A wood search walks over the ground to the next spot instead of tunnelling at its height (2026-10-14).
    goals.length = 0;
    const said = [];
    await explore({bot, name: 'bot17', protectedAreas: [], emit: (k, m) => said.push(m), world: {hostilesNear: () => []}}, {t: {}, cancelled: false, type: 'chop', args: {}}, 'logs', 1, 192, true);
    assert.deepStrictEqual(goals.map((g) => g.constructor.name), ['GoalNearXZ']);
    assert.ok(/walking 32 blocks/.test(said[0]), said[0]);
    // Over ground it keeps its heading (it walked a square round the base before, 2026-10-14); a stopped walk turns it.
    const walker = {bot, name: 'bot17', protectedAreas: [], emit() {}, world: {hostilesNear: () => []}};
    goals.length = 0;
    for (const n of [1, 2, 3]) await explore(walker, {t: {}, cancelled: false, type: 'chop', args: {}}, 'logs', n, 192, true);
    assert.deepStrictEqual(goals.map((g) => `${g.x} ${g.z}`), ['0 -32', '0 -32', '0 -32'], 'bot17 heads north three times (the fake bot stays at 0 0)');
    walker.bot = {...bot, pathfinder: {...bot.pathfinder, goto: async () => { throw new Error('No path to the goal!'); }}};
    await explore(walker, {t: {}, cancelled: false, type: 'chop', args: {}}, 'logs', 4, 192, true);
    walker.bot = bot;
    goals.length = 0;
    await explore(walker, {t: {}, cancelled: false, type: 'chop', args: {}}, 'logs', 5, 192, true);
    assert.deepStrictEqual(goals.map((g) => `${g.x} ${g.z}`), ['32 0'], 'east after the blocked walk');
  }
};
