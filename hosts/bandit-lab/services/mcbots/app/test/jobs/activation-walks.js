'use strict';
const assert = require('node:assert');
const {VALIDATE} = require('../../bots');
module.exports = async () => {
  { // activation (bone meal, a bed, shears, a grave click) looks first: a Stop or a new job in that look sends no packet (Codex R5-1)
    const {guardDigs, BotRunner} = require('../../bots');
    const EventEmitter = require('node:events');
    const {Vec3} = require('vec3');
    const rig = () => {
      let release = () => {}; const packets = [];
      const bot = Object.assign(new EventEmitter(), {
        lookAt: () => new Promise((res) => { release = res; }),
        entity: {position: new Vec3(0, 64, 3)}, pathfinder: {stop() {}, setGoal() {}, isMining: () => false, isBuilding: () => false},
        equip: async () => {}, dig: async () => {}, placeBlock: async () => {},
      });
      bot.activateBlock = async (b) => { await bot.lookAt(b.position); packets.push('block_place'); }; // the native order: look, then packet
      bot.activateEntity = async () => { await bot.lookAt(new Vec3(0, 0, 0)); packets.push('use_entity'); };
      const runner = Object.assign(Object.create(BotRunner.prototype), {bot, current: {cancelled: false}, protectedAreas: []});
      guardDigs(runner, bot);
      return {bot, runner, packets, release: () => release()};
    };
    const sapling = () => ({position: new Vec3(1, 65, 1)});
    for (const [name, call] of [['activateBlock', (x) => x.bot.activateBlock(sapling())], ['activateEntity', (x) => x.bot.activateEntity({})]]) {
      let x = rig(), p = call(x);
      x.release(); await p;
      assert.strictEqual(x.packets.length, 1, `${name}: untouched, the packet goes ahead`);
      for (const [how, act] of [
        ['Stop, pump clears the job', (q) => { q.runner.cancel(); q.runner.current = null; }],
        ['Stop, then a new job', (q) => { q.runner.cancel(); q.runner.current = {cancelled: false}; }],
      ]) {
        x = rig(); p = call(x); act(x); x.release();
        await assert.rejects(p, /Activating aborted/, `${name} after: ${how}`);
        assert.deepStrictEqual(x.packets, [], `${name} packet after: ${how}`);
      }
      x = rig(); x.runner.current.cancelled = true;
      await assert.rejects(call(x), /Activating aborted/, `${name} for a job stopped before the call`);
    }
    // the grave click writes its own packets: a Stop during its look sends neither
    const {JOBS, Cancelled} = require('../../bots');
    const writes = []; let release2 = () => {}, job2;
    const slots = new Array(46).fill(null);
    const bot2 = {
      entities: {1: {id: 1, name: 'armor_stand', type: 'other', position: new Vec3(0, 65, 0), height: 2}}, game: {dimension: 'overworld'}, entity: {position: new Vec3(0, 64, 0)},
      inventory: {slots, items: () => []}, pathfinder: {goto: async () => {}, setGoal() {}, stop() {}}, setControlState() {},
      lookAt: () => new Promise((res) => { release2 = res; }), _client: {write: (packet, p) => writes.push(p.mouse)}, equip: async () => {},
    };
    const r2 = {bot: bot2, world: {hostilesNear: () => []}, combat: {busy: false, epoch: 0}, emit() {}, protectedAreas: [], supplyChest: null};
    job2 = {t: {}, cancelled: false, type: 'grave', args: {x: 0, y: 64, z: 0}};
    const gp = JOBS.grave(r2, job2);
    while (release2.toString() === '() => {}') await new Promise((res) => setTimeout(res, 20)); // until the click's look is pending
    job2.cancelled = true; release2();
    await assert.rejects(gp, Cancelled);
    assert.deepStrictEqual(writes, [], 'no use_entity packet after a Stop');
  }
  { // a treefarm walk digs natural ground inside the farm box only: no log, stripped log, leaves, or anything outside (Codex R5-2)
    const {safeMovements, guardDigs, BotRunner, NATURAL, JOBS} = require('../../bots');
    const {Movements} = require('mineflayer-pathfinder');
    const md = require('minecraft-data')('26.1');
    const {Vec3} = require('vec3');
    const blocks = new Map();
    const box = {x1: 10, z1: 10, x2: 12, z2: 12};
    for (const [i, n] of ['oak_log', 'stripped_oak_log', 'oak_leaves', 'stone', 'dirt'].entries()) { blocks.set(`${i},65,0`, n); blocks.set(`${10 + (i % 3)},65,${10 + (i % 3)}`, n); }
    const dug = [];
    const bot = {
      blockAt: (p) => { const n = blocks.get(`${p.x},${p.y},${p.z}`); return n ? {name: n, type: md.blocksByName[n].id, stateId: 1, position: p, boundingBox: 'block', getProperties: () => ({})} : {name: 'air', type: 0, position: p, boundingBox: 'empty', getProperties: () => ({})}; },
      entity: {position: new Vec3(0, 66, 3), onGround: true}, game: {dimension: 'overworld'}, entities: {}, food: 20, registry: md,
      inventory: {items: () => [{type: md.itemsByName.stone_pickaxe.id, name: 'stone_pickaxe'}], emptySlotCount: () => 30, slots: []},
      pathfinder: {goto: async () => {}, stop() {}, setGoal() {}, isMining: () => true}, tool: {equipForBlock: async () => {}},
      dig: async (b) => { dug.push(b.name); }, equip: async () => {}, placeBlock: async () => {}, stopDigging() {}, on() {}, getEquipmentDestSlot: () => 5,
    };
    const runner = Object.assign(Object.create(BotRunner.prototype), {name: 'bot5', bot, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, log() {}, protectedAreas: [], supplyChest: null, combat: {epoch: 0}, current: null, online: true, queue: []});
    guardDigs(runner, bot);
    const seen = {};
    const real = JOBS.treefarm;
    JOBS.treefarm = async (r) => { seen.digOnly = r.digOnly; seen.digBox = r.digBox; };
    runner.queue.push({id: 1, type: 'treefarm', args: box, status: 'queued'});
    await runner.pump();
    JOBS.treefarm = real;
    assert.strictEqual(seen.digOnly, NATURAL, 'a farm walk may dig natural ground only');
    assert.deepStrictEqual(seen.digBox, box, '... inside the farm box');
    assert.strictEqual(runner.digBox, null, 'released when the job ends');
    runner.digOnly = NATURAL; runner.digBox = box;
    const mv = safeMovements(bot, [], runner);
    mv.getBlock = () => ({liquid: false, canFall: false});
    for (const n of ['oak_log', 'stripped_oak_log', 'oak_leaves', 'stone']) {
      blocks.set('0,65,0', n);
      assert.ok(!mv.safeToBreak(bot.blockAt(new Vec3(0, 65, 0))), `${n} outside the farm is never planned as a dig`);
      await assert.rejects(bot.dig(bot.blockAt(new Vec3(0, 65, 0)), true), /not part of the job|outside the farm/, `${n} outside: the raw dig is refused`);
    }
    for (const [i, n] of ['oak_log', 'stripped_oak_log', 'oak_leaves'].entries()) {
      blocks.set(`${10 + i},65,${10 + i}`, n);
      assert.ok(!mv.safeToBreak(bot.blockAt(new Vec3(10 + i, 65, 10 + i))), `${n} inside the farm is not dug by a walk either`);
      await assert.rejects(bot.dig(bot.blockAt(new Vec3(10 + i, 65, 10 + i)), true), /not part of the job/);
    }
    blocks.set('11,65,11', 'dirt');
    assert.ok(mv.safeToBreak(bot.blockAt(new Vec3(11, 65, 11))), 'natural ground inside the farm may still be dug');
    await bot.dig(bot.blockAt(new Vec3(11, 65, 11)), true);
    assert.deepStrictEqual(dug, ['dirt']);
    // digInside: a box with a height keeps the walk out of the roof above a fill (bot51, sandbox 2026-10-20)
    assert.strictEqual(VALIDATE.schematic({file: 'fill-1.litematic', origin: {x: 0, y: 0, z: 0}, tight: true, digInside: true}).digInside, true);
    runner.digOnly = null; runner.digBox = {x1: 5, x2: 15, y1: 50, y2: 60, z1: 5, z2: 15};
    blocks.set('11,61,11', 'stone'); blocks.set('11,58,11', 'stone');
    assert.deepStrictEqual([mv.safeToBreak(bot.blockAt(new Vec3(11, 61, 11))), mv.safeToBreak(bot.blockAt(new Vec3(11, 58, 11)))], [false, true], 'the roof above the box no, the fill inside yes');
  }
};
