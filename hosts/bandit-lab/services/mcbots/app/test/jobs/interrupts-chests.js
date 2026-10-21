'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // the pathfinder's equip-then-dig / equip-then-place survives neither a Stop, a path reset nor a new job (Codex R2-2, R3-2)
    const {guardDigs, BotRunner} = require('../../bots');
    const EventEmitter = require('node:events');
    const {Vec3} = require('vec3');
    const world = new Map();
    const rig = ({areas = []} = {}) => {
      world.clear();
      world.set('0,60,0', {name: 'stone', stateId: 1});
      let release = () => {}, digs = 0, places = 0, mining = false, building = false;
      const bot = Object.assign(new EventEmitter(), {
        equip: () => new Promise((res) => { release = res; }),
        dig: async () => { digs++; },
        placeBlock: async () => { places++; },
        entity: {position: new Vec3(0, 64, 3)},
        pathfinder: {stop() {}, setGoal() {}, isMining: () => mining, isBuilding: () => building},
        blockAt: (p) => { const b = world.get(`${p.x},${p.y},${p.z}`); return b ? {...b, position: p, getProperties: () => ({})} : null; },
      });
      const runner = Object.assign(Object.create(BotRunner.prototype), {bot, current: {cancelled: false}, protectedAreas: areas});
      guardDigs(runner, bot);
      // the pathfinder's executor: equip, then dig (its catch swallows an equip error, then digs anyway)
      const pfDig = () => { mining = true; return bot.equip({}, 'hand').catch(() => {}).then(() => bot.dig({name: 'stone', stateId: 1, position: new Vec3(0, 60, 0)}, true)).catch(() => {}); };
      const pfPlace = () => { building = true; return bot.equip({}, 'hand').then(() => bot.placeBlock({position: new Vec3(0, 60, 0)}, new Vec3(0, 1, 0))).catch(() => {}); };
      return {bot, runner, pfDig, pfPlace, release: () => release(), digs: () => digs, places: () => places};
    };
    const flush = () => new Promise((res) => setImmediate(res));
    let x = rig(), p = x.pfDig();
    x.release(); await p;
    assert.strictEqual(x.digs(), 1, 'untouched: the dig goes ahead');
    for (const [how, act] of [
      ['Stop, pump clears the job', (q) => { q.runner.cancel(); q.runner.current = null; }],
      ['Stop, then a new job', (q) => { q.runner.cancel(); q.runner.current = {cancelled: false}; }],
      ['path reset', (q) => q.bot.emit('path_reset', 'x')],
      ['goal replaced', (q) => q.bot.emit('goal_updated', null)],
      ['block state swapped', () => world.set('0,60,0', {name: 'stone', stateId: 2})],
      ['water arrives', () => world.set('1,60,0', {name: 'water', stateId: 3})],
      ['block turned to another', () => world.set('0,60,0', {name: 'chest', stateId: 4})],
    ]) {
      x = rig();
      p = x.pfDig();
      act(x);
      x.release(); await p; await flush();
      assert.strictEqual(x.digs(), 0, `dig after: ${how}`);
    }
    x = rig({areas: [[-1, -1, 1, 1]]});
    p = x.pfDig(); x.release(); await p;
    assert.strictEqual(x.digs(), 0, 'protected target');
    // scaffolding placement
    x = rig(); p = x.pfPlace(); x.release(); await p;
    assert.strictEqual(x.places(), 1, 'untouched: the scaffold goes ahead');
    for (const [how, act] of [
      ['Stop', (q) => { q.runner.cancel(); q.runner.current = null; }],
      ['Stop, then a new job', (q) => { q.runner.cancel(); q.runner.current = {cancelled: false}; }],
      ['path reset', (q) => q.bot.emit('path_reset', 'x')],
    ]) {
      x = rig(); p = x.pfPlace(); act(x); x.release(); await p; await flush();
      assert.strictEqual(x.places(), 0, `scaffold after: ${how}`);
    }
    x = rig({areas: [[-1, -1, 1, 1]]});
    await assert.rejects(x.bot.placeBlock({position: new Vec3(0, 60, 0)}, new Vec3(0, 1, 0)), /protected/);
    x = rig(); x.runner.current.cancelled = true;
    await assert.rejects(x.bot.placeBlock({position: new Vec3(0, 60, 0)}, new Vec3(0, 1, 0)), /stopped/);
    // a job's own equip does not care about path resets, only about a Stop
    x = rig(); p = x.bot.equip({}, 'hand'); x.bot.emit('path_reset', 'x'); x.release();
    await p;
    x = rig(); p = x.bot.equip({}, 'hand'); x.runner.cancel(); x.release();
    await assert.rejects(p, /Equip aborted/);
  }
  { // mineflayer's native dig / placeBlock await lookAt before the packet: a Stop or path reset there sends nothing (Codex R2-2, R3-2)
    const {guardDigs, BotRunner} = require('../../bots');
    const EventEmitter = require('node:events');
    const {Vec3} = require('vec3');
    const rig = ({areas = [], mining = false} = {}) => {
      let release = () => {}, packets = [];
      const world = new Map([['0,60,0', {name: 'stone', stateId: 1}]]);
      const bot = Object.assign(new EventEmitter(), {
        lookAt: () => new Promise((res) => { release = res; }),
        entity: {position: new Vec3(0, 64, 3)},
        pathfinder: {stop() {}, setGoal() {}, isMining: () => mining, isBuilding: () => false},
        blockAt: (p) => { const b = world.get(`${p.x},${p.y},${p.z}`); return b ? {...b, position: p, getProperties: () => ({})} : null; },
        equip: async () => {},
      });
      bot.dig = async (blk) => { await bot.lookAt(blk.position); packets.push('block_dig'); }; // the native order: look, then packet
      bot.placeBlock = async (ref) => { await bot.lookAt(ref.position); packets.push('block_place'); };
      const runner = Object.assign(Object.create(BotRunner.prototype), {bot, current: {cancelled: false}, protectedAreas: areas});
      guardDigs(runner, bot);
      return {bot, runner, world, packets, release: () => release()};
    };
    const flush = () => new Promise((res) => setImmediate(res));
    const stone = () => ({name: 'stone', stateId: 1, position: new Vec3(0, 60, 0)});
    const ref = () => ({position: new Vec3(0, 60, 0)});
    let x = rig(), p = x.bot.dig(stone(), true);
    x.release(); await p;
    assert.deepStrictEqual(x.packets, ['block_dig'], 'untouched: the dig goes ahead');
    x = rig(); p = x.bot.placeBlock(ref(), new Vec3(0, 1, 0));
    x.release(); await p;
    assert.deepStrictEqual(x.packets, ['block_place'], 'untouched: the placement goes ahead');
    for (const [how, act, opts] of [
      ['Stop, pump clears the job', (q) => { q.runner.cancel(); q.runner.current = null; }],
      ['Stop, then a new job', (q) => { q.runner.cancel(); q.runner.current = {cancelled: false}; }],
      ['path reset (the pathfinder\'s own)', (q) => q.bot.emit('path_reset', 'x'), {mining: true}],
      ['block swapped', (q) => q.world.set('0,60,0', {name: 'stone', stateId: 2})],
      ['water arrives', (q) => q.world.set('1,60,0', {name: 'water', stateId: 3})],
    ]) {
      x = rig(opts); p = x.bot.dig(stone(), true); act(x); x.release();
      await assert.rejects(p, /Digging aborted/, `dig after: ${how}`);
      await flush();
      assert.deepStrictEqual(x.packets, [], `dig packet after: ${how}`);
    }
    for (const [how, act, opts] of [
      ['Stop', (q) => { q.runner.cancel(); q.runner.current = null; }],
      ['Stop, then a new job', (q) => { q.runner.cancel(); q.runner.current = {cancelled: false}; }],
      ['path reset', (q) => q.bot.emit('path_reset', 'x'), {mining: true}],
    ]) {
      x = rig(opts); p = x.bot.placeBlock(ref(), new Vec3(0, 1, 0)); act(x); x.release();
      await assert.rejects(p, /Placing aborted/, `place after: ${how}`);
      assert.deepStrictEqual(x.packets, [], `place packet after: ${how}`);
    }
    // a path reset does not touch a job's own dig (digAt), only the pathfinder's
    x = rig(); p = x.bot.dig(stone(), true); x.bot.emit('path_reset', 'x'); x.release(); await p;
    assert.deepStrictEqual(x.packets, ['block_dig']);
    // other lookAt callers (combat, follow) are not affected
    x = rig(); p = x.bot.lookAt(new Vec3(0, 0, 0)); x.runner.cancel(); x.release(); await p;
    // a drop of more than 3 below the bot is refused for a walk's raw dig too
    x = rig(); x.bot.entity.position = new Vec3(0, 61, 0);
    for (let y = 59; y > 54; y--) x.world.set(`0,${y},0`, {name: 'air', stateId: 9});
    await assert.rejects(x.bot.dig(stone(), true), /drop of more than 3/);
  }
  { // placeNear (crafting table / furnace): a Stop during the equip places nothing (Codex R3-2)
    const {placeNear} = require('../../crafting');
    const {Cancelled} = require('../../bots');
    const {Vec3} = require('vec3');
    let placed = 0, stopped = false, release;
    const bot = {
      inventory: {items: () => [{name: 'crafting_table'}]},
      entity: {position: new Vec3(0.5, 64, 0.5)},
      blockAt: (p) => (p.y === 63 ? {boundingBox: 'block', position: p, name: 'stone'} : {boundingBox: 'empty', position: p, name: 'air'}),
      equip: () => new Promise((res) => { release = res; }),
      placeBlock: async () => { placed++; },
    };
    const p = placeNear(bot, 'crafting_table', [], () => { if (stopped) throw new Cancelled('stopped'); });
    stopped = true;
    release();
    await assert.rejects(p, Cancelled);
    assert.strictEqual(placed, 0);
    // Walled in by stone (a stair shaft): a niche beside the feet is dug and the table goes there.
    const world = new Map();
    const at = (p) => world.get(`${p.x},${p.y},${p.z}`) || (p.y === 64 && p.x === 0 && p.z === 0 ? 'air' : p.y === 65 && p.x === 0 && p.z === 0 ? 'air' : 'stone');
    const walled = {
      inventory: {items: () => [{name: 'crafting_table'}]},
      entity: {position: new Vec3(0.5, 64, 0.5)},
      blockAt: (p) => ({name: at(p), position: p, boundingBox: at(p) === 'stone' ? 'block' : 'empty'}),
      equip: async () => {},
      dig: async (b) => { world.set(`${b.position.x},${b.position.y},${b.position.z}`, 'air'); },
      placeBlock: async (ground) => { world.set(`${ground.position.x},${ground.position.y + 1},${ground.position.z}`, 'crafting_table'); },
    };
    const table = await placeNear(walled, 'crafting_table');
    assert.deepStrictEqual([table.position.x, table.position.y, table.position.z], [1, 64, 0]);
    walled.blockAt = (p) => ({name: 'oak_planks', position: p, boundingBox: 'block'}); // placed walls are not dug
    await assert.rejects(placeNear(walled, 'crafting_table'), /no free spot/);
    // On a lone pillar with a drop all round, ground 2 away takes it (bot1 in a pit by the iron farm, 2026-10-18).
    const placedAt = [];
    const ground = (p) => p.y === 63 && ((p.x === 0 && p.z === 0) || Math.max(Math.abs(p.x), Math.abs(p.z)) >= 2);
    const pillar = {
      inventory: {items: () => [{name: 'crafting_table'}]},
      entity: {position: new Vec3(0.5, 64, 0.5)},
      blockAt: (p) => (placedAt.some((q) => q.x === p.x && q.y === p.y && q.z === p.z) ? {name: 'crafting_table', position: p, boundingBox: 'block'}
        : {name: ground(p) ? 'stone' : 'air', position: p, boundingBox: ground(p) ? 'block' : 'empty'}),
      equip: async () => {},
      placeBlock: async (g) => { placedAt.push(g.position.offset(0, 1, 0)); },
    };
    const lone = await placeNear(pillar, 'crafting_table');
    assert.deepStrictEqual([lone.position.x, lone.position.y, lone.position.z], [-2, 64, 0]);
    // One refused spot is no reason to give up, and a cell the bot's own body reaches into is skipped ("placing
    // crafting_table did not take" ended 7 jobs, main server 2026-10-16): at x .1 its box reaches into x -1.
    const cells = new Map(), tried = [];
    const name = (p) => cells.get(`${p.x},${p.y},${p.z}`) || (p.y === 63 ? 'stone' : 'air');
    const edge = {
      inventory: {items: () => [{name: 'crafting_table'}]},
      entity: {position: new Vec3(0.1, 64, 0.5)},
      blockAt: (p) => ({name: name(p), position: p, boundingBox: name(p) === 'air' ? 'empty' : 'block'}),
      equip: async () => {},
      placeBlock: async (g) => { const k = `${g.position.x},${g.position.y + 1},${g.position.z}`; tried.push(k); if (tried.length > 1) cells.set(k, 'crafting_table'); },
    };
    assert.strictEqual((await placeNear(edge, 'crafting_table')).name, 'crafting_table');
    assert.deepStrictEqual(tried, ['1,64,0', '0,64,1'], 'refused at 1 64 0, -1 64 0 skipped (its own body), placed at 0 64 1');
  }
  { // excavate's walking may dig natural ground only: placed walls stay, also for the ascent (Codex R3-1)
    const {safeMovements, guardDigs, BotRunner, NATURAL} = require('../../bots');
    const {Movements} = require('mineflayer-pathfinder');
    const EventEmitter = require('node:events');
    const {Vec3} = require('vec3');
    const md = require('minecraft-data')('26.1');
    let walking = true, dug = 0;
    const world = {60: 'cobblestone', 61: 'dirt'};
    const bot = Object.assign(new EventEmitter(), {registry: md, version: '26.1', inventory: {items: () => []}, entity: {position: new Vec3(3, 64, 0)}, entities: {}, pathfinder: {isMining: () => walking}, dig: async () => { dug++; }, equip: async () => {}, placeBlock: async () => {},
      blockAt: (p) => ({name: world[p.y], position: p, getProperties: () => ({})})});
    const runner = Object.assign(Object.create(BotRunner.prototype), {bot, current: {cancelled: false}, protectedAreas: []});
    const mv = safeMovements(bot, [], runner);
    // a landing block without a position is no landing (it threw in getMoveDropDown and took the bot process down,
    // main server 2026-10-17)
    bot.game = {minY: -64};
    mv.getBlock = (pos, dx, dy, dz) => (pos.y + dy === 62 ? {physical: true, liquid: false, safe: false, position: new Vec3(pos.x + dx, 62, pos.z + dz)} : {physical: false, liquid: false, safe: false});
    assert.strictEqual(mv.getLandingBlock({x: 0, y: 64, z: 0}, {x: 1, z: 0}), null);
    delete bot.game;
    mv.getBlock = () => ({liquid: false, canFall: false});
    const blk = (n) => ({type: md.blocksByName[n].id, name: n, position: new Vec3(0, 60, 0)});
    for (const n of ['cobblestone', 'oak_planks', 'torch']) assert.ok(mv.safeToBreak(blk(n)), `${n}: free outside an excavation`);
    guardDigs(runner, bot);
    const dig = (y) => bot.dig({name: world[y], position: new Vec3(0, y, 0)}, true);
    await dig(60);
    assert.strictEqual(dug, 1, 'outside an excavation a walk digs what it needs');
    runner.digOnly = NATURAL;
    assert.ok(mv.safeToBreak(blk('dirt')) && mv.safeToBreak(blk('stone')));
    for (const n of ['cobblestone', 'oak_planks', 'torch']) assert.ok(!mv.safeToBreak(blk(n)), `${n}: never planned as a dig during an excavation`);
    await assert.rejects(dig(60), /not part of the job/);
    await dig(61);
    assert.strictEqual(dug, 2, 'natural ground is still dug');
    walking = false; // the job's own dig (digAt: a chest cover) is not a walk
    await dig(60);
    assert.strictEqual(dug, 3);
  }
  { // openChest: the partner is the one block facing + left/right point to (R2-5)
    const {openChest, partnerOf} = require('../../bots');
    const {Vec3} = require('vec3');
    // left half -> offset of its partner (clockwise of facing); the right half's is the opposite
    const STEP = {north: [1, 0], south: [-1, 0], east: [0, 1], west: [0, -1]};
    const world = (chests) => { // chests: [[x, z, name, facing, type]]; a cobblestone cover over each
      const blocks = new Map();
      for (const [x, z, name, facing, type] of chests) {
        blocks.set(`${x},64,${z}`, [name, type ? {facing, type} : {}]);
        blocks.set(`${x},65,${z}`, ['cobblestone', {}]);
      }
      const dug = [];
      const job = {t: {}, cancelled: false};
      const bot = {
        blockAt: (p) => {
          const b = blocks.get(`${p.x},${p.y},${p.z}`);
          return b ? {name: b[0], position: p, boundingBox: 'block', getProperties: () => b[1]} : null;
        },
        entity: {position: new Vec3(0, 64, 5), onGround: true}, game: {dimension: 'overworld'}, entities: {}, inventory: {items: () => [{type: 1, name: 'stone_pickaxe'}]},
        pathfinder: {goto: async () => {}, stop() {}, setGoal() {}}, tool: {equipForBlock: async () => {}},
        dig: async (blk) => { dug.push(`${blk.position.x},${blk.position.z}`); blocks.delete(`${blk.position.x},${blk.position.y},${blk.position.z}`); },
        openContainer: async () => 'box', stopDigging() {},
      };
      const r = {bot, world: {hostilesNear: () => []}, emit() {}, protectedAreas: []};
      return {bot, open: (x, z) => openChest(r, job, bot.blockAt(new Vec3(x, 64, z))), dug};
    };
    for (const [facing, [dx, dz]] of Object.entries(STEP)) {
      for (const half of ['left', 'right']) {
        const s = half === 'left' ? 1 : -1;
        const other = half === 'left' ? 'right' : 'left';
        // the opened half at 10,10; its partner where facing + side say; an unrelated chest of the
        // other half's type, same facing, on the wrong axis (and one opposite the partner)
        const px = 10 + s * dx, pz = 10 + s * dz;
        const wrong = [[10 + dz, 10 + dx, 'chest', facing, other], [10 - s * dx, 10 - s * dz, 'chest', facing, other]];
        const w = world([[10, 10, 'chest', facing, half], [px, pz, 'chest', facing, other], ...wrong]);
        assert.strictEqual(partnerOf(w.bot, w.bot.blockAt(new Vec3(10, 64, 10))).position.x, px, `${facing} ${half}`);
        assert.strictEqual(await w.open(10, 10), 'box');
        assert.deepStrictEqual(w.dug.sort(), [`10,10`, `${px},${pz}`].sort(), `${facing} ${half}: only the pair's covers`);
      }
      // two adjacent double chests: each half pairs with its own partner, never the neighbouring pair's
      const along = (k) => [10 + k * dx, 10 + k * dz];
      const pair = (k, l) => [[...along(k), 'chest', facing, l ? 'left' : 'right'], [...along(k + 1), 'chest', facing, l ? 'right' : 'left']];
      // left at k, right at k+1 (left's partner lies +step); pair 2 starts at k+2
      const two = [...pair(0, true), ...pair(2, true)];
      for (const [k, want] of [[0, [0, 1]], [1, [0, 1]], [2, [2, 3]], [3, [2, 3]]]) {
        const w = world(two);
        await w.open(...along(k));
        assert.deepStrictEqual(w.dug.sort(), want.map((i) => along(i).join(',')).sort(), `${facing} adjacent pairs, opening block ${k}`);
      }
    }
    // missing/unloaded partner, two singles, a different type of chest, a barrel, unknown facing
    let w = world([[0, 0, 'chest', 'north', 'left']]);
    await w.open(0, 0);
    assert.deepStrictEqual(w.dug, ['0,0'], 'unloaded partner: only its own cover');
    w = world([[0, 0, 'chest', 'north', 'single'], [1, 0, 'chest', 'north', 'single']]);
    await w.open(0, 0);
    assert.deepStrictEqual(w.dug, ['0,0'], 'two singles');
    w = world([[0, 0, 'chest', 'north', 'left'], [1, 0, 'trapped_chest', 'north', 'right']]);
    await w.open(0, 0);
    assert.deepStrictEqual(w.dug, ['0,0'], 'a trapped chest is no partner of a chest');
    w = world([[0, 0, 'chest', 'north', 'left'], [1, 0, 'chest', 'south', 'right']]);
    await w.open(0, 0);
    assert.deepStrictEqual(w.dug, ['0,0'], 'facing must match');
    w = world([[0, 0, 'barrel'], [1, 0, 'barrel']]);
    assert.strictEqual(partnerOf(w.bot, w.bot.blockAt(new Vec3(0, 64, 0))), null);
  }
  { // withdraw: a storage chest with no way to it is passed over for 30 min, the next one gives the item
    const {JOBS} = require('../../bots');
    const {Vec3} = require('vec3');
    const {WorldModel} = require('../../world');
    const pc = require('../../plan-config'), L = require('../../storage-layout');
    const world = new WorldModel();
    world.noteChest('-251,59,-214', {iron_ingot: 9}, 0); // its aisle cell -251 58 -215 is walled in
    world.noteChest('-263,58,-219', {iron_ingot: 5}, 0);
    world.noteChest('-251,58,-216', {iron_ingot: 4}, 0); // its neighbour behind the same wall
    const it = (name, count) => ({name, count, type: 7, metadata: null});
    const held = {[L.keyOf(pc.BASE.chest)]: [], '-251,59,-214': [it('iron_ingot', 9)], '-263,58,-219': [it('iron_ingot', 5)], '-251,58,-216': [it('iron_ingot', 4)]};
    const walks = [];
    const bot = {
      entity: {position: new Vec3(-250, 58, -214), onGround: true}, game: {dimension: 'overworld'}, entities: {},
      inventory: {items: () => []},
      blockAt: (p) => (held[L.keyOf(p)] ? {name: 'chest', position: p, boundingBox: 'block', getProperties: () => ({})} : null),
      pathfinder: {searchRadius: -1, stop() {}, setGoal() {}, goto: async (g) => {
        walks.push(`${g.x},${g.z}`);
        if (g.x === -251 && g.z === -215) throw new Error('The goal was changed');
      }},
      openContainer: async (b) => {
        const items = held[L.keyOf(b.position)];
        return {containerItems: () => items, close() {}, withdraw: async (_t, _m, n) => { items[0].count -= n; if (!items[0].count) items.shift(); }};
      },
    };
    const infos = [];
    const r = {bot, world, sheltered: true, emit: (k, m) => infos.push(m), protectedAreas: []};
    const job = (count) => ({type: 'withdraw', t: {}, cancelled: false, args: {...pc.BASE.chest, item: 'iron_ingot', count}});
    await JOBS.withdraw(r, job(12));
    assert.deepStrictEqual(held['-263,58,-219'], [], 'the reachable chest gave its 5');
    assert.ok(infos.some((m) => /-251 59 -214 is out of reach, passed over for 30 min/.test(m)), infos.join('\n'));
    assert.deepStrictEqual([held['-251,58,-216'][0].count, infos.filter((m) => /out of reach/.test(m)).length], [4, 1], 'its neighbour is not walked to');
    walks.length = 0;
    await assert.rejects(JOBS.withdraw(r, job(3)), /no iron_ingot in the chest or the storage room \(2 storage chests out of reach\)/);
    assert.ok(!walks.includes('-251,-215'), `no second walk to the walled-in chest: ${walks}`);
    // goNear under a chest up in the air: the ground cell under it or one beside it, not 3 around (a level lower is
    // out of the server's reach); a chest on the ground keeps its distance
    const goals = [];
    const air = {name: 'air', boundingBox: 'empty'}, solid = {name: 'obsidian', boundingBox: 'block'};
    const floating = {...bot, entity: {position: new Vec3(-356, 67, -189), onGround: true},
      blockAt: (p) => (p.y === 66 || (p.x === -350 && p.y === 63) ? solid : air), pathfinder: {searchRadius: -1, stop() {}, setGoal() {}, goto: async (g) => { goals.push(g); }}};
    const near = require('../../bots').goNear;
    await near({...r, bot: floating}, job(1), -356, 72, -191, 3, {under: true});
    await near({...r, bot: floating}, job(1), -350, 64, -189, 3, {under: true});
    assert.deepStrictEqual(goals.map((g) => [g.y, g.rangeSq]), [[67, 1], [64, 9]]);
  }
};
