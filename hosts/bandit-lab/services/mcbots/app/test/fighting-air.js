'use strict';
const assert = require('node:assert');
(async () => { // only a fit bot walks up to a mob, never to a creeper; an unfit one still hits what comes close (2026-10-16)
  const {Combat} = require('../combat');
  const {Vec3} = require('vec3');
  const mob = (name, x) => ({id: x, name, type: 'hostile', position: new Vec3(x, 64, 0), height: 1.8});
  const run = async (gear, ents) => {
    const c = Object.create(Combat.prototype);
    const goals = [], hits = [];
    const slots = {head: gear ? {name: 'iron_helmet'} : null, torso: gear ? {name: 'iron_chestplate'} : null};
    const bot = {
      health: 20, food: 20, entity: {position: new Vec3(0, 64, 0)}, entities: Object.fromEntries(ents.map((e) => [e.id, e])),
      inventory: {items: () => (gear ? [{name: 'iron_sword'}] : []), slots: {1: slots.head, 2: slots.torso}},
      getEquipmentDestSlot: (s) => ({head: 1, torso: 2, legs: 3, feet: 4})[s],
      registry: {blocksByName: {}}, findBlock: () => null, game: {dimension: 'overworld'},
      pathfinder: {setGoal: (g) => goals.push(g)},
    };
    Object.assign(c, {r: {bot, online: true, name: 'b', world: {noteMob() {}}, getSettings: () => ({defend: true, fightRange: 8, retreatHealth: 8}), log() {}},
      epoch: 0, busy: false, mode: null, ignore: new Map(), ticks: 1, eat: async () => {}, fight: async (t) => hits.push(t.name), scanBlocks() {}});
    await c.tick();
    return {mode: c.mode, hits};
  };
  assert.strictEqual((await run(true, [mob('zombie', 6)])).mode, 'hunt', 'armoured and armed: it goes for the zombie');
  assert.strictEqual((await run(false, [mob('zombie', 6)])).mode, null, 'bare: it lets the zombie come');
  assert.deepStrictEqual((await run(false, [mob('zombie', 3)])).hits, ['zombie'], 'and hits it once it is close');
  assert.strictEqual((await run(true, [mob('creeper', 7)])).mode, null, 'a creeper 7 blocks off is never hunted');
})();

(async () => { // shield: up between swings, down for the swing; a creeper is kited, struck from range (2026-10-17)
  const {Combat, hasShield} = require('../combat');
  const {Vec3} = require('vec3');
  const mk = (shield, mobs) => {
    const log = [], goals = [];
    const bot = {health: 20, food: 20, entity: {position: new Vec3(0, 64, 0), onGround: false, velocity: {y: -1}}, game: {dimension: 'overworld'},
      entities: Object.fromEntries(mobs.map((m) => [m.id, m])), heldItem: {name: 'iron_sword', type: 1},
      inventory: {items: () => [{name: 'iron_sword', type: 1}], slots: {45: shield ? {name: 'shield'} : null}}, getEquipmentDestSlot: (s) => (s === 'off-hand' ? 45 : 5),
      registry: {blocksByName: {}}, findBlock: () => null, blockAt: () => ({name: 'air'}), lookAt: async () => {}, setControlState() {}, waitForTicks: async () => {},
      activateItem: (off) => log.push(off ? 'up' : 'use'), deactivateItem: () => log.push('down'), attack: (e) => log.push(`hit ${e.name}`),
      pathfinder: {setGoal: (g) => goals.push(g)}};
    const c = new Combat({bot, online: true, name: 'bot1', world: {noteMob() {}}, log() {}, getSettings: () => ({defend: true, retreatHealth: 8, fightRange: 8})});
    c.stop();
    return {c, bot, log, goals};
  };
  const mob = (name, x) => ({id: x, name, type: 'hostile', position: new Vec3(x, 64, 0), height: 1.8});
  let t = mk(true, [mob('zombie', 2)]);
  assert.strictEqual(hasShield(t.bot), true);
  await t.c.tick();
  assert.deepStrictEqual(t.log, ['down', 'hit zombie', 'up'].slice(t.log[0] === 'down' ? 0 : 1), 'down for the swing, up again at once: ' + t.log);
  t.c.lastAttack = Date.now(); // cooling down: the next tick only raises (it is up already)
  await t.c.tick();
  assert.strictEqual(t.log.at(-1), 'up');
  t = mk(false, [mob('zombie', 2)]);
  await t.c.tick();
  assert.deepStrictEqual(t.log, ['hit zombie'], 'no shield: no blocking');
  for (const shield of [true, false]) {
    t = mk(shield, [mob('creeper', 3)]);
    t.bot.waitForTicks = async () => { t.bot.entities[3].isValid = false; }; // gone after a tick
    await t.c.tick();
    assert.ok(t.log.includes('hit creeper') && t.c.mode === null, `kited and struck, shield ${shield}: ${t.log}`);
  }
})();

(async () => { // air: under water with little left the bot surfaces before anything else, then goes on (6 drownings, 2026-10-17)
  const {Combat} = require('../combat');
  const {Vec3} = require('vec3');
  const controls = {}, goals = [];
  let roof = true; // a stone roof at y 57 over the bot: it needs the pathfinder to the air at 2 60 0
  const water = (p) => (roof && p.y === 57 && p.x === 0 ? {name: 'stone', boundingBox: 'block'} : p.y < 60 ? {name: 'water', boundingBox: 'empty'} : {name: 'air', boundingBox: 'empty'});
  const bot = {health: 20, food: 20, ownAir: 6, oxygenLevel: 20, entity: {position: new Vec3(0.5, 55, 0.5)}, entities: {}, game: {dimension: 'overworld'},
    registry: {blocksByName: {air: {id: 0}, cave_air: {id: 1}}}, blockAt: water, setControlState: (k, v) => { controls[k] = v; },
    findBlock: ({useExtraInfo}) => [new Vec3(1, 50, 0), new Vec3(2, 60, 0), new Vec3(3, 61, 0)].map((p) => ({position: p})).find(useExtraInfo) ?? null,
    pathfinder: {setGoal: (g) => goals.push(g)}, inventory: {items: () => [], slots: {}}, getEquipmentDestSlot: () => 5};
  const c = new Combat({bot, online: true, name: 'bot1', world: {noteMob() {}}, log() {}, getSettings: () => ({defend: true, retreatHealth: 8, fightRange: 8})});
  c.stop();
  await c.tick();
  assert.deepStrictEqual([c.mode, c.busy, controls.jump], ['air', true, true]);
  assert.deepStrictEqual([goals[0].x, goals[0].y, goals[0].z], [2, 59, 0], 'feet in the water under the air at 2 60 0, not the cave at 1 50 0');
  bot.ownAir = 19;
  await c.tick();
  assert.deepStrictEqual([c.mode, c.busy, controls.jump], [null, false, false], 'breathing again: on with the job');
  // open water up to the air: straight up, no pathfinder goal (it let go of the jump, sandbox 2026-10-17)
  roof = false;
  bot.ownAir = 5;
  await c.tick();
  assert.deepStrictEqual([c.mode, controls.jump, goals.at(-1)], ['air', true, null]);
  // on dry land a low air reading (another entity's, via mineflayer's oxygenLevel) is ignored (all three bots, 2026-10-17)
  c.release();
  bot.entity.position = new Vec3(0.5, 61, 0.5);
  bot.ownAir = 5;
  bot.oxygenLevel = 5;
  await c.tick();
  assert.strictEqual(c.mode, null, 'head in the air: no surfacing');
})();

(async () => { // air within reach: it swims there itself; no air at all: it digs the roof (bot1 drowned beside air, 2026-10-19)
  const {Combat} = require('../combat');
  const {Vec3} = require('vec3');
  const controls = {}, goals = [], ticks = [], dug = [];
  let air = [new Vec3(1, 57, 0)];
  const blockAt = (p) => (p.y === 57 && p.x === 0 ? {name: 'stone', boundingBox: 'block', position: p} : p.y < 58 ? {name: 'water', boundingBox: 'empty'} : {name: 'air', boundingBox: 'empty'});
  const bot = {health: 20, food: 20, ownAir: 6, oxygenLevel: 20, entity: {position: new Vec3(0.5, 55, 0.5), onGround: true}, entities: {}, game: {dimension: 'overworld'},
    registry: {blocksByName: {air: {id: 0}, cave_air: {id: 1}}}, blockAt, setControlState: (k, v) => { controls[k] = v; },
    findBlock: ({useExtraInfo}) => air.map((p) => ({position: p})).find(useExtraInfo) ?? null, lookAt: async () => {},
    on: (e, f) => ticks.push(f), removeListener: (e, f) => ticks.splice(ticks.indexOf(f), 1), canDigBlock: () => true, dig: async (b) => dug.push(b.name),
    pathfinder: {setGoal: (g) => goals.push(g)}, inventory: {items: () => [], slots: {}}, getEquipmentDestSlot: () => 5};
  const c = new Combat({bot, online: true, name: 'bot1', protectedAreas: [], world: {noteMob() {}}, log() {}, getSettings: () => ({defend: true, retreatHealth: 8, fightRange: 8})});
  c.stop();
  await c.tick();
  assert.deepStrictEqual([c.mode, goals.at(-1), ticks.length, controls.forward, controls.jump], ['air', null, 1, true, true], 'air 1.3 away: swims, no pathfinder');
  c.release();
  assert.deepStrictEqual([ticks.length, controls.forward], [0, false], 'steering ends with the mode');
  air = [];
  await c.tick();
  await new Promise((res) => setImmediate(res));
  assert.deepStrictEqual([c.mode, dug, controls.jump, c.straightUp], ['air', ['stone'], true, true], 'no air: the roof is dug, then up');
})();

{ // an enderman is left alone until one hits: then those near are threats (2026-10-20)
  const {provoked} = require('../combat');
  const {Vec3} = require('vec3');
  const me = new Vec3(0, 64, 0), now = 100000;
  const ender = (x) => ({name: 'enderman', position: new Vec3(x, 64, 0)});
  assert.strictEqual(provoked(ender(2), [], me, now), false, 'no hit: left alone');
  assert.strictEqual(provoked(ender(2), [{t: now - 3000, by: 'enderman'}], me, now), true, 'hit 3 s ago: fought');
  assert.strictEqual(provoked(ender(9), [{t: now - 3000, by: 'enderman'}], me, now), false, 'too far');
  assert.strictEqual(provoked(ender(2), [{t: now - 15000, by: 'enderman'}], me, now), false, 'an old hit');
  assert.strictEqual(provoked(ender(2), [{t: now - 3000, by: 'zombie'}], me, now), false, 'hit by something else');
}

{ // a guard job fights even with the defend setting off
  const {Combat} = require('../combat');
  const c = Object.create(Combat.prototype);
  c.r = {getSettings: () => ({defend: false, fightRange: 8}), current: {type: 'guard'}};
  assert.strictEqual(c.settings().defend, true);
  c.r.current = {type: 'mine'};
  assert.strictEqual(c.settings().defend, false);
}
