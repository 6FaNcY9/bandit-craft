'use strict';
const assert = require('node:assert');
// EM_Trader, full health, mobs nearby: "retreating to heal" for hours and the trade stood still (main server 2026-11-03).
(async () => {
  const {Combat} = require('../combat');
  const {Vec3} = require('vec3');
  const mob = (id, name, x, y = 64) => ({id, name, type: 'hostile', position: new Vec3(x, y, 0), height: 1.8});
  const mk = (mobs, {wallAt = null, health = 20} = {}) => {
    const logs = [], goals = [];
    const bot = {
      health, food: 20, entity: {position: new Vec3(0, 64, 0)}, entities: Object.fromEntries(mobs.map((m) => [m.id, m])), heldItem: {name: 'iron_sword', type: 1},
      inventory: {items: () => [{name: 'iron_sword', type: 1}], slots: {}}, getEquipmentDestSlot: () => 1, registry: {blocksByName: {}}, findBlock: () => null,
      blockAt: () => ({name: 'air'}), game: {dimension: 'overworld'}, pathfinder: {setGoal: (g) => goals.push(g)},
      // A wall between x = wallAt and the bot stops any ray going that way.
      world: {raycast: (_from, dir, range) => (wallAt !== null && Math.sign(dir.x) === Math.sign(wallAt) && Math.abs(wallAt) <= range ? {name: 'stone', position: new Vec3(wallAt, 64, 0)} : null)},
    };
    const c = Object.create(Combat.prototype);
    Object.assign(c, {r: {bot, online: true, name: 'b', world: {noteMob() {}}, log: (_, s) => logs.push(s), getSettings: () => ({defend: true, retreatHealth: 8, fightRange: 8})},
      epoch: 0, busy: false, mode: null, ignore: new Map(), ticks: 1, eat: async () => {}, fight: async () => {}, duel: async () => {}, release() { this.mode = null; this.busy = false; this.released = (this.released || 0) + 1; }});
    return {c, logs, goals};
  };
  const witches = () => [1, 2, 3, 4, 5].map((i) => mob(i, 'witch', 10 + i));

  // Too many to fight, in plain sight, at full health: it keeps away until out of range, not a new retreat every other tick.
  let t = mk(witches());
  for (let i = 0; i < 6; i++) await t.c.tick();
  assert.strictEqual(t.c.mode, 'retreat', 'still retreating');
  assert.strictEqual(t.goals.length, 1, 'one walk away: every new retreat replaces the job\'s walk');
  assert.strictEqual(t.logs.filter((l) => l.startsWith('retreat:')).length, 1, 'one retreat, not one a second');
  for (const m of Object.values(t.c.r.bot.entities)) m.position = new Vec3(30, 64, 0);
  await t.c.tick();
  assert.strictEqual(t.c.mode, null, 'out of range: back to work');

  // The same mobs behind a wall can neither hit nor shoot: no retreat at all, the job goes on.
  t = mk(witches(), {wallAt: 5});
  for (let i = 0; i < 6; i++) await t.c.tick();
  assert.strictEqual(t.c.mode, null, 'mobs behind a wall do not stop the job');
  assert.strictEqual(t.goals.length, 0, 'and its walk is left alone');

  // One around the corner next to the bot still counts: the ray is blocked, but it is close enough to arrive at once.
  t = mk([mob(1, 'zombie', 2), mob(2, 'vindicator', 2.5), mob(3, 'vindicator', 3), mob(4, 'vindicator', 3.5)], {wallAt: 1});
  await t.c.tick();
  assert.ok(t.logs.some((l) => /keep away/.test(l)), 'close mobs count through a corner');

  // A kind that just hit the bot counts through the wall too: a shot came through a gap the ray misses.
  t = mk(witches(), {wallAt: 5});
  t.c.r.hits = [{t: Date.now(), by: 'witch'}];
  await t.c.tick();
  assert.strictEqual(t.c.mode, 'retreat', 'hit by that kind just now: it keeps away');

  // Hurt, with nothing to keep away from in sight: it still heals at a distance, and comes back once healed and clear.
  t = mk([mob(1, 'zombie', 12)], {health: 5});
  await t.c.tick();
  assert.strictEqual(t.c.mode, 'retreat', 'hurt: it backs off');
  t.c.r.bot.health = 20;
  await t.c.tick();
  assert.strictEqual(t.c.mode, null, 'healed and the odds are fine: retreat over');
})().catch((e) => { console.error(e); process.exitCode = 1; });
