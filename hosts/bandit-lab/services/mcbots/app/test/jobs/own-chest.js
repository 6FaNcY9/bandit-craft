'use strict';
const assert = require('node:assert/strict');
// The bot's own chest: `lagern`, the keep list, and a full inventory depositing there instead of tossing junk.
module.exports = async () => {
  const {JOBS, VALIDATE, upkeep, chestAway} = require('../../bots');
  const {Vec3} = require('vec3');
  const FOODS = {bread: {}};
  // chests: 'x,y,z' -> {name, room (free item count), items}; the bot starts at 0,64,0 and the walk log records every goto.
  const rig = ({carried, chests, prefs, free = 36}) => {
    const items = carried.map(([name, count]) => ({name, count, type: name, metadata: null}));
    const world = new Map(Object.entries(chests).map(([k, c]) => [k, {...c, items: {}}]));
    const walks = [], opened = [];
    const blockAt = (p) => {
      const c = world.get(`${p.x},${p.y},${p.z}`);
      return c ? {name: c.name, position: new Vec3(p.x, p.y, p.z), boundingBox: 'block', getProperties: () => ({})} : p.y < 64 ? {name: 'stone', boundingBox: 'block', position: p} : {name: 'air', boundingBox: 'empty', position: p};
    };
    const bot = {
      game: {dimension: 'minecraft:overworld'}, entity: {position: new Vec3(0, 64, 0)}, food: 20, health: 20,
      registry: {foodsByName: FOODS, blocksByName: {}}, slots: {},
      inventory: {slots: new Proxy({}, {get: () => ({})}), items: () => items.filter((i) => i.count > 0), emptySlotCount: () => free},
      getEquipmentDestSlot: () => 1,
      pathfinder: {searchRadius: 100, setGoal() {}, stop() {}, goto: async (g) => { walks.push([g.x, g.y, g.z]); bot.entity.position = new Vec3(g.x, g.y, g.z); }},
      blockAt,
      openContainer: async (block) => {
        const c = world.get(`${block.position.x},${block.position.y},${block.position.z}`);
        opened.push(`${block.position.x},${block.position.y},${block.position.z}`);
        return {
          containerItems: () => Object.entries(c.items).map(([name, count]) => ({name, count})),
          deposit: async (type, meta, count) => {
            const it = items.find((i) => i.type === type);
            const stored = Object.values(c.items).reduce((a, b) => a + b, 0);
            if (stored + count > c.room) throw new Error('chest full');
            c.items[it.name] = (c.items[it.name] || 0) + count; it.count -= count;
          },
          close() {},
        };
      },
    };
    const events = [];
    const r = {bot, name: 'bot1', prefs, protectedAreas: [], supplyChest: null, world: {hostilesNear: () => [], noteStock() {}}, combat: {busy: false, epoch: 0},
      emit: (kind, text) => events.push([kind, text]), getSettings: () => ({torches: false}), gearTriedAt: Date.now(), pickaxeTriedAt: Date.now()};
    const left = () => Object.fromEntries(items.filter((i) => i.count > 0).map((i) => [i.name, i.count]));
    return {r, items, world, walks, opened, events, left, stored: (k) => world.get(k).items};
  };
  const job = (type, args) => ({type, args, t: {}, cancelled: false});
  const chest = {x: 3, y: 64, z: 0};
  const here = {'3,64,0': {name: 'chest', room: 1e6}};

  // VALIDATE
  assert.deepEqual(VALIDATE.deposit({own: true}), {own: true});
  assert.deepEqual(VALIDATE.deposit({own: true, keep: {stick: 64}}), {own: true, keep: {stick: 64}});
  assert.throws(() => VALIDATE.deposit({own: true, keep: {'bad name': 1}}));
  assert.throws(() => VALIDATE.deposit({own: true, keep: {stick: 5000}}));
  assert.throws(() => VALIDATE.deposit({own: true, keep: [1]}));

  // own deposit: everything but tools, armour, food and the keep list goes; KEEP_RE does not apply
  const carried = [['stick', 100], ['coal', 20], ['iron_pickaxe', 1], ['iron_helmet', 1], ['bread', 5], ['dirt', 64], ['cobblestone', 70]];
  let x = rig({carried, chests: here, prefs: {chest, keep: {stick: 64}}});
  const own = job('deposit', {own: true});
  await JOBS.deposit(x.r, own);
  assert.deepEqual(x.left(), {stick: 64, iron_pickaxe: 1, iron_helmet: 1, bread: 5, cobblestone: 6}, 'keep list, tools, armour, food and the cobblestone stock stay');
  assert.deepEqual(x.stored('3,64,0'), {stick: 36, coal: 20, dirt: 64, cobblestone: 64});
  assert.deepEqual(own.args, {own: true}, 'the resolved chest never lands in the running job');
  assert.deepEqual(x.walks.at(0).slice(0, 1), [3], 'walked to the own chest');

  // without own: KEEP_RE items (stick, coal) stay up to their keep cap; the sticks above 64 are filed (2026-11-11)
  x = rig({carried, chests: here, prefs: {chest, keep: {}}});
  await JOBS.deposit(x.r, job('deposit', chest));
  assert.equal(x.left().stick, 64); assert.equal(x.stored('3,64,0').stick, 36); assert.equal(x.left().coal, 20); assert.equal(x.stored('3,64,0').dirt, 64);
  // ... but the keep list holds back for every deposit of this bot
  x = rig({carried, chests: here, prefs: {chest, keep: {dirt: 10}}});
  await JOBS.deposit(x.r, job('deposit', chest));
  assert.equal(x.left().dirt, 10);

  // a chest with no way to it is remembered (as withdraw does), so the idle shift does not gather for it again
  x = rig({carried, chests: here, prefs: {chest, keep: {}}});
  x.r.bot.pathfinder.goto = async () => { throw new Error('No path'); };
  await assert.rejects(JOBS.deposit(x.r, job('deposit', {own: true})), /could not reach 3 64 0/);
  assert.ok(chestAway(x.r, chest), 'remembered');
  assert.ok(!chestAway(x.r, {x: 4, y: 64, z: 0}), 'a new chest is tried at once');
  assert.ok(!chestAway(x.r, chest, Date.now() + 30 * 60000), 'tried again after 30 min');
  // the hub sees a worker's bot (RemoteRunner) only through its snapshot
  assert.ok(chestAway({snap: {awayChests: ['3,64,0']}}, chest), 'remote: remembered');
  assert.ok(!chestAway({snap: {}}, chest), 'remote: nothing marked');

  // no own chest
  x = rig({carried, chests: here, prefs: {chest: null, keep: {}}});
  await assert.rejects(JOBS.deposit(x.r, job('deposit', {own: true})), /keine Kiste zugewiesen/);
  x.r.prefs = undefined;
  await assert.rejects(JOBS.deposit(x.r, job('deposit', {own: true})), /keine Kiste zugewiesen/);

  // chest full: the rest lands in the nearest neighbour that has room; all full -> Kiste voll
  const around = {'3,64,0': {name: 'chest', room: 50}, '4,64,0': {name: 'chest', room: 50}, '3,64,2': {name: 'barrel', room: 1e6}};
  x = rig({carried: [['dirt', 64], ['coal', 20]], chests: around, prefs: {chest, keep: {}}});
  await JOBS.deposit(x.r, job('deposit', {own: true}));
  assert.deepEqual(x.left(), {});
  assert.deepEqual(x.opened, ['3,64,0', '4,64,0', '3,64,2'], 'nearest first, one after the other');
  assert.deepEqual(x.walks.slice(-2).map((w) => w[0]), [4, 3], 'walked near each neighbour before opening it');
  assert.equal(Object.values(x.stored('3,64,0')).reduce((a, b) => a + b, 0), 20, 'the stack that did not fit stayed out');
  assert.deepEqual(x.stored('3,64,2'), {dirt: 64});
  x = rig({carried: [['dirt', 64], ['coal', 20]], chests: {...around, '3,64,2': {name: 'barrel', room: 10}}, prefs: {chest, keep: {}}});
  await assert.rejects(JOBS.deposit(x.r, job('deposit', {own: true})), /Kiste voll/);
  assert.ok(x.events.some(([k, t]) => k === 'deposit' && /20 coal/.test(t)), 'what was stored so far is reported');
  assert.equal(x.left().dirt, 64, 'the unstored rest stays with the bot');
  // a neighbour farther than 2 blocks is not tried
  x = rig({carried: [['dirt', 64]], chests: {'3,64,0': {name: 'chest', room: 10}, '3,64,3': {name: 'chest', room: 1e6}}, prefs: {chest, keep: {}}});
  await assert.rejects(JOBS.deposit(x.r, job('deposit', {own: true})), /Kiste voll/);
  assert.deepEqual(x.opened, ['3,64,0']);

  // upkeep, own chest, 3 free slots: deposits, walks back to the noted position, no toss
  x = rig({carried: [['dirt', 64], ['stick', 5]], chests: here, prefs: {chest, keep: {}}, free: 3});
  let freed = 3; x.r.bot.inventory.emptySlotCount = () => freed;
  const realDeposit = JOBS.deposit;
  const trail = [];
  JOBS.deposit = async (rr, j) => { trail.push(['deposit', j.args]); freed = 10; await realDeposit(rr, j); };
  x.r.bot.tossStack = async () => { trail.push(['toss']); };
  x.r.bot.entity.position = new Vec3(40, 64, 40);
  try {
    await upkeep(x.r, job('mine', {block: 'dirt', count: 5}), []);
  } finally { JOBS.deposit = realDeposit; }
  assert.deepEqual(trail, [['deposit', {own: true}]]);
  assert.deepEqual(x.walks.at(-1), [40, 64, 40], 'walked back to where it stood');
  // a failed walk back is no failure of the job
  x = rig({carried: [['dirt', 64]], chests: here, prefs: {chest, keep: {}}, free: 3});
  freed = 3; x.r.bot.inventory.emptySlotCount = () => freed;
  JOBS.deposit = async () => { freed = 10; };
  const go = x.r.bot.pathfinder.goto;
  x.r.bot.pathfinder.goto = async (g) => { if (g.x === 40) throw new Error('No path'); return go(g); };
  x.r.bot.entity.position = new Vec3(40, 64, 40);
  try {
    x.r.bot.pathfinder.goto = async () => { throw new Error('No path'); };
    await upkeep(x.r, job('mine', {block: 'dirt', count: 5}), []);
  } finally { JOBS.deposit = realDeposit; }
  assert.ok(x.events.some(([k]) => k === 'info'), 'the failed walk is reported as info');
  // still full after the deposit
  x = rig({carried: [['stick', 64]], chests: here, prefs: {chest, keep: {stick: 64}}, free: 3});
  JOBS.deposit = async () => {};
  try { await assert.rejects(upkeep(x.r, job('mine', {block: 'dirt', count: 5}), []), /Inventar voll mit behaltenen Sachen/); } finally { JOBS.deposit = realDeposit; }
  // 4 free slots: nothing to do
  x = rig({carried: [['dirt', 64]], chests: here, prefs: {chest, keep: {}}, free: 4});
  JOBS.deposit = async () => { throw new Error('should not deposit'); };
  try { await upkeep(x.r, job('mine', {block: 'dirt', count: 5}), []); } finally { JOBS.deposit = realDeposit; }

  // upkeep without an own chest: the old branch, junk is tossed and a keep-list item is spared
  x = rig({carried: [['cobblestone', 64], ['gravel', 64], ['dirt', 64]], chests: here, prefs: {chest: null, keep: {gravel: 1}}, free: 3});
  const tossed = [];
  x.r.bot.tossStack = async (it) => { tossed.push(it.name); };
  await upkeep(x.r, job('mine', {block: 'iron_ore', count: 1}), []);
  assert.deepEqual(tossed, ['dirt'], 'one stack of cobblestone for pillars and the keep-list gravel stay');
  // a shift uses its own chest argument, even with an own chest set
  x = rig({carried: [['dirt', 64]], chests: here, prefs: {chest, keep: {}}, free: 1});
  const seen = [];
  JOBS.deposit = async (rr, j) => { seen.push(j.args); };
  try { await upkeep(x.r, job('shift', {block: 'stone', x: 9, y: 64, z: 9}), []).catch(() => {}); } finally { JOBS.deposit = realDeposit; }
  assert.deepEqual(seen, [{x: 9, y: 64, z: 9}]);
};
