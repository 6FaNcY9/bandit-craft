'use strict';
const APP = require('node:path').join(__dirname, '..');
const assert = require('node:assert');
const {loadConfig} = require('../config');
const {VALIDATE} = require('../bots');
// ---- shared world / combat logic ----
const W = require('../world');
const {Combat, weaponScore, wantsToEat, deathCause, fightReady} = require('../combat');
const O = require('../odds');
{
  // Deep miners with coal but no wood cannot make torches (bot2 at y -55, 2026-10-10).
  const {needsWood} = require('../bots');
  assert.equal(needsWood([{name: 'coal', count: 8}]), true);
  assert.equal(needsWood([]), true);
  assert.equal(needsWood([{name: 'oak_log', count: 1}, {name: 'oak_planks', count: 7}]), true);
  assert.equal(needsWood([{name: 'oak_log', count: 2}]), false);
  assert.equal(needsWood([{name: 'birch_planks', count: 8}]), false);
  assert.equal(needsWood([{name: 'oak_log', count: 1}, {name: 'spruce_log', count: 1}]), false);
}
{
  // The death line says what hurt the bot in its last 30 s and what it was doing (bot1, main server 2026-10-17).
  const {hitsNote} = require('../bots');
  const now = 100000, hit = (by, ago) => ({t: now - ago, by});
  assert.equal(hitsNote([hit('zombie', 1000), hit('skeleton', 2000), hit('zombie', 3000), hit('creeper', 40000)], 'walking', now), ' (last 30 s: zombie x2, skeleton x1; walking)');
  assert.equal(hitsNote([], 'idle - no job', now), ' (last 30 s: no hits seen; idle - no job)');
}
{
  // acquire.js: how to get an item, worked out from the game's data (owner, 2026-10-17: derive, do not describe).
  const A = require('../acquire');
  const data = require('minecraft-data')('26.1');
  const near = {oak_log: 12, stone: 3, iron_ore: 30, coal_ore: 20, oak_planks: 1, deepslate: 6};
  const world = (o = {}) => ({data, have: {}, stores: [], blockNear: (b) => near[b] ?? null, mobNear: (m) => ({sheep: 20})[m] ?? null,
    canKill: (m) => ['sheep', 'cow', 'pig', 'chicken'].includes(m), canMine: (b) => b !== 'cobblestone', ...o});
  const nodes = (n) => [n, ...n.children.flatMap(nodes)];
  // From an empty inventory: logs, a table, a wooden pickaxe for the stone, sticks; the first thing to do is a log.
  let p = A.plan({item: 'stone_pickaxe', count: 1}, world());
  assert.deepStrictEqual(p.missing, []);
  assert.deepStrictEqual([A.nextStep(p.node).via, A.nextStep(p.node).block], ['mine', 'oak_log']);
  assert.ok(nodes(p.node).some((n) => n.item === 'wooden_pickaxe' && n.kept), A.explain(p.node));
  assert.ok(nodes(p.node).some((n) => n.via === 'mine' && n.block === 'stone'), A.explain(p.node));
  // Planks are crafted, never dug out of a house next door (a crafted block that drops itself was placed).
  assert.ok(!nodes(p.node).some((n) => n.via === 'mine' && n.block === 'oak_planks'));
  assert.match(A.summary(p.node), /^~\d+ s: mine \d+ oak_log, mine 3 stone; then \d+ crafts$/);
  // A known chest beats digging; a way that failed lately is left out.
  p = A.plan({item: 'cobblestone', count: 20}, world({stores: [{at: {x: 1, y: 64, z: 2}, dist: 8, stock: {cobblestone: 64}}]}));
  assert.deepStrictEqual([p.node.via, p.node.count, p.node.at], ['chest', 20, {x: 1, y: 64, z: 2}]);
  p = A.plan({item: 'stone_pickaxe', count: 1}, world({have: {wooden_pickaxe: 1, stick: 2, crafting_table: 1}, failed: new Set(['mine:stone'])}));
  assert.ok(!nodes(p.node).some((n) => n.key === 'mine:stone'), A.explain(p.node));
  assert.ok(nodes(p.node).some((n) => n.key === 'mine:deepslate'), A.explain(p.node)); // cobbled deepslate does too
  // A way blocked by shared experience is left out like a failed one (world.learned).
  p = A.plan({item: 'stone_pickaxe', count: 1}, world({have: {wooden_pickaxe: 1, stick: 2, crafting_table: 1}, learned: (k) => k === 'mine:stone' ? {blocked: true, pOk: 1} : null}));
  assert.ok(!nodes(p.node).some((n) => n.key === 'mine:stone'), A.explain(p.node));
  assert.ok(nodes(p.node).some((n) => n.key === 'mine:deepslate'), A.explain(p.node));
  p = A.plan({item: 'white_bed', count: 1}, world({have: {crafting_table: 1, oak_planks: 3}, learned: (k) => k === 'kill:sheep' ? {each: 1000, pOk: 1} : null}));
  assert.ok(nodes(p.node).some((n) => n.via === 'craft' && n.item === 'white_bed'), A.explain(p.node));
  p = A.plan({item: 'cobblestone', count: 3}, world({learned: (k) => k === 'mine:stone' ? {pOk: 0.1} : null}));
  assert.ok(p.node.cost > A.plan({item: 'cobblestone', count: 3}, world()).node.cost);
  // Wool from sheep (minecraft-data keeps it in loot tables it does not list); a bed from that and planks.
  p = A.plan({item: 'white_bed', count: 1}, world({have: {crafting_table: 1, oak_planks: 3}}));
  assert.deepStrictEqual(nodes(p.node).filter((n) => n.via === 'kill').map((n) => [n.mob, n.kills]), [['sheep', 3]]);
  // Held raw iron must not make raw_iron -> raw_iron_block -> raw_iron look free: the plan ended in a stack overflow
  // (sandbox 2026-10-17). The third raw iron is dug.
  p = A.plan({item: 'iron_ingot', count: 3}, world({have: {raw_iron: 2, coal: 1, stone_pickaxe: 1}, stationNear: (n) => n === 'furnace'}));
  assert.deepStrictEqual(nodes(p.node).filter((n) => n.item === 'raw_iron').map((n) => [n.via, n.count]), [['parts', 3], ['have', 2], ['mine', 1]]);
  // Iron ingots are smelted, not crafted from 27 nuggets that only ingots make (a dead end the plan backs out of).
  p = A.plan({item: 'iron_pickaxe', count: 1}, world());
  assert.deepStrictEqual(p.missing, []);
  assert.ok(nodes(p.node).some((n) => n.item === 'iron_ingot' && n.via === 'smelt'), A.explain(p.node));
  // Held items count even where nothing near makes more: diamonds in hand, no diamond ore to be mined.
  p = A.plan({item: 'diamond_pickaxe', count: 1}, world({have: {diamond: 3, stick: 2, crafting_table: 1}, canMine: (b) => !/diamond/.test(b)}));
  assert.deepStrictEqual([p.missing, p.node.via, p.node.children.map((c) => c.via)], [[], 'craft', ['have', 'have']]);
  // A furnace standing near is used, not a new one made.
  p = A.plan({item: 'iron_ingot', count: 1}, world({have: {raw_iron: 1, coal: 1}, stationNear: (n) => n === 'furnace'}));
  assert.deepStrictEqual(p.node.children.map((c) => c.via), ['have', 'have']);
  // What no way reaches is missing, and there is no next step.
  p = A.plan({item: 'nether_star', count: 1}, world({canKill: () => false}));
  assert.deepStrictEqual([p.missing, A.nextStep(p.node)], [['nether_star'], null]);
  // Cycles (iron_block <-> iron_ingot) end; held ingots are used.
  p = A.plan({item: 'iron_block', count: 1}, world({have: {iron_ingot: 9, crafting_table: 1}}));
  assert.deepStrictEqual([p.node.via, p.node.children.map((c) => [c.item, c.via, c.count])], ['craft', [['iron_ingot', 'have', 9]]]);
  // Drops without silk touch: an iron ore gives raw iron; the loot table's flattened side drops count a tenth.
  assert.ok(Math.abs(A.yieldOf(data.blockLoot.iron_ore.drops).raw_iron - 1) < 1e-9);
  assert.ok(!A.lootIndex(data).blocks.get('stick').some((b) => b.block === 'oak_leaves' && b.per > 0.2));
}
// Hurt bots eat at food 15-17 so they regenerate (bot1 sat at 6.7 health with food 17, 2026-10-10).
assert.equal(wantsToEat(17, 6.7, 15), true);
assert.equal(wantsToEat(17, 20, 15), false);
assert.equal(wantsToEat(14, 20, 15), true);
assert.equal(wantsToEat(19, 10, 15), false);
assert.equal(O.taken(3, {points: 15, toughness: 0}).toFixed(2), '1.38'); // vanilla: 3 * (1 - max(15 / 5, 15 - 4 * 3 / 8) / 25)
assert.equal(O.taken(13, {points: 20, toughness: 8}).toFixed(2), '4.29');
for (const [name, value] of Object.entries({wooden_sword: [4, 1.6], golden_sword: [4, 1.6], stone_sword: [5, 1.6], iron_sword: [6, 1.6], diamond_sword: [7, 1.6], netherite_sword: [8, 1.6], wooden_axe: [7, 0.8], golden_axe: [7, 1], stone_axe: [9, 0.8], iron_axe: [9, 0.9], diamond_axe: [9, 1], netherite_axe: [10, 1]})) assert.deepStrictEqual(O.weapon(name), {dmg: value[0], speed: value[1]}, name);
assert.deepStrictEqual(O.weapon('stone_pickaxe'), {dmg: 1, speed: 4});
assert.equal(O.odds({health: 20, weapon: O.weapon('iron_sword'), armour: O.armour(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']), threats: [{name: 'zombie', dist: 3}]}).fight, true);
assert.equal(O.odds({health: 20, weapon: O.weapon('fist'), armour: O.armour([]), threats: [{name: 'zombie', dist: 1}, {name: 'zombie', dist: 1}, {name: 'zombie', dist: 1}]}).fight, false);
{ // four provoked endermen are no fight even in iron; they were weighed at nothing (bot19, 2026-10-20)
  const iron = {health: 16, weapon: O.weapon('iron_sword'), armour: O.armour(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'])};
  const four = O.odds({...iron, threats: [1, 2, 2, 3].map((dist) => ({name: 'enderman', dist}))});
  assert.equal(four.fight, false);
  assert.ok(four.loss > 10, `loss ${four.loss}`);
}
// An archer hurts from the start, a zombie only once it walked up; unknown and creeper threats are not counted.
const shot = O.odds({health: 20, weapon: O.weapon('iron_sword'), armour: O.armour([]), threats: [{name: 'skeleton', dist: 15}]});
const walked = O.odds({health: 20, weapon: O.weapon('iron_sword'), armour: O.armour([]), threats: [{name: 'zombie', dist: 15}]});
assert.ok(shot.loss > walked.loss, `${shot.loss} ${walked.loss}`);
assert.deepStrictEqual(O.odds({health: 20, weapon: O.weapon('iron_sword'), armour: O.armour([]), threats: [{name: 'creeper', dist: 3}]}), {secs: 0, loss: 0, fight: true});
// Ready for a usual night (two zombies, a skeleton) from the numbers: full iron and an iron sword at full health only.
const IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
assert.equal(fightReady(['iron_sword', 'bread'], IRON, 20), true);
assert.equal(fightReady(['iron_sword'], IRON, 12), false); // hurt
assert.equal(fightReady(['stone_sword'], ['leather_chestplate', 'leather_leggings'], 20), false); // the old two-piece rule said yes
assert.equal(fightReady(['stone_pickaxe'], IRON, 20), false); // unarmed
assert.equal(fightReady(['iron_sword'], [], 20), false); // unarmoured
{
  const mk = (defend, health, items, worn = []) => {
    const slots = Object.fromEntries(worn.map((name, i) => [5 + i, {name}]));
    const c = Object.create(Combat.prototype);
    c.r = {getSettings: () => ({defend}), bot: {health, getEquipmentDestSlot: (s) => ({head: 5, torso: 6, legs: 7, feet: 8})[s], inventory: {slots, items: () => items.map((name) => ({name}))}}};
    return c;
  };
  assert.equal(mk(true, 20, ['iron_sword'], IRON).fit(), true); // no mob in sight: a usual night
  assert.equal(mk(true, 20, ['iron_sword']).fit(), false);
  assert.equal(mk(false, 20, ['iron_sword'], IRON).fit(), false); // defend off: combat will not fight, so the bot waits
  assert.equal(mk(true, 8, ['iron_sword'], IRON).fit(), false);
}
{
  const {EventEmitter} = require('node:events');
  const {Vec3} = require('vec3');
  const mineflayer = require('mineflayer'), {BotRunner} = require('../bots');
  const vehicle = {id: 8, position: new Vec3(2, 64, 0), passengers: []};
  const rider = {id: 7, position: new Vec3(100, 64, 0), vehicle};
  const kept = {id: 9, vehicle};
  vehicle.passengers = [rider, kept];
  const bot = Object.assign(new EventEmitter(), {_client: new EventEmitter(), entities: {7: rider, 8: vehicle, 9: kept}});
  // Model the upstream plugin's deferred registration and its missing dismount cleanup.
  bot.once('inject_allowed', () => bot._client.on('set_passengers', ({passengers}) => {
    assert.ok(vehicle.passengers.includes(rider), 'upstream runs before our cleanup');
    for (const id of passengers) bot.entities[id].vehicle = vehicle;
  }));
  const done = new Error('stop setup before collectBlock'), createBot = mineflayer.createBot;
  let plugins = 0;
  bot.loadPlugin = () => { if (++plugins === 2) throw done; };
  mineflayer.createBot = () => bot;
  try {
    assert.throws(() => BotRunner.prototype.connect.call({log() {}, bindOwner() {}}), (e) => e === done);
  } finally { mineflayer.createBot = createBot; }
  bot.emit('inject_allowed');
  assert.equal(bot._client.listenerCount('set_passengers'), 2);
  assert.strictEqual(W.mobLocation(rider), vehicle);
  bot._client.emit('set_passengers', {entityId: vehicle.id, passengers: [kept.id]});
  assert.strictEqual(rider.vehicle, null);
  assert.deepStrictEqual(vehicle.passengers, [kept]);
  assert.strictEqual(kept.vehicle, vehicle);
  assert.strictEqual(W.mobLocation(rider).position, rider.position, 'dismounted rider uses its own position');
  rider.vehicle = vehicle;
  vehicle.isValid = false;
  assert.strictEqual(W.mobLocation(rider).position, rider.position, 'dead mount cannot supply the rider position');
}
(async () => {
  // Riders kept old positions as their mounts approached (suspected spearing deaths, 2026-10-16).
  const {Vec3} = require('vec3');
  for (const mounted of [false, true]) {
    const vehicle = {position: new Vec3(2, 64, 0), height: 1.6};
    const zombie = {id: 7, type: 'hostile', name: 'zombie', height: 1.9, position: new Vec3(mounted ? 100 : 2, 64, 0)};
    if (mounted) zombie.vehicle = vehicle;
    const location = mounted ? vehicle : zombie;
    const world = new W.WorldModel(), hits = [], aims = [], paths = [], hazards = [], controls = [];
    const bot = {health: 20, food: 20, entity: {position: new Vec3(0, 64, 0)}, entities: {7: zombie}, game: {dimension: 'overworld'},
      heldItem: {name: 'iron_sword'}, inventory: {items: () => [], slots: {}}, getEquipmentDestSlot: () => 5,
      lookAt: async (p) => aims.push(p), attack: (e) => hits.push(e), setControlState: (k, v) => controls.push(`${k} ${v}`),
      blockAt: (p) => (p.y < 64 ? {name: 'stone', boundingBox: 'block'} : {name: 'air', boundingBox: 'empty'}),
      pathfinder: {setGoal: (g) => paths.push(g)}, findBlock: ({point}) => { hazards.push(point); return null; }, registry: {blocksByName: {}}};
    const c = new Combat({bot, online: true, name: 'bot3', world, log() {}, getSettings: () => ({defend: true, retreatHealth: 8, fightRange: 16})});
    c.stop();
    await c.tick();
    assert.deepStrictEqual(hits, [zombie], 'attack the rider even with its own position far away');
    assert.deepStrictEqual(aims[0], location.position.offset(0, (mounted ? vehicle.height : 0) + zombie.height * 0.8, 0));
    assert.equal(world.hostilesNear(2, 0, 'overworld', 1).length, 1);
    assert.equal(world.snapshot().mobs[0].x, 2);
    assert.equal(zombie.position.x, mounted ? 100 : 2, 'leave the protocol position alone');
    bot.health = 6;
    // Hurt by a zombie close by: it kites it (backwards, striking), it does not turn its back (some 20 deaths
    // "retreating to heal" in one night, main server 2026-10-17); from an archer alone it still walks off.
    bot.waitForTicks = async () => { zombie.isValid = false; };
    await c.tick();
    assert.ok(controls.includes('back true') && c.mode === null, `hurt by a zombie: kites it (${controls})`);
    zombie.isValid = true;
    delete bot.waitForTicks;
    zombie.name = 'skeleton';
    await c.tick();
    assert.equal(c.mode, 'retreat');
    assert.strictEqual(paths.at(-1).goal.entity, location);
    location.position = new Vec3(25, 64, 0);
    assert.equal(paths.at(-1).goal.hasChanged(), true, 'retreat follows mount movement');
    await c.tick();
    assert.equal(c.mode, null, 'release when the threat moves away');
    // Healthy but outmatched: the retreat holds instead of being dropped and retaken every tick (bot1, 2026-10-22).
    location.position = new Vec3(5, 64, 0);
    bot.health = 20;
    c.odds = () => ({fight: false, loss: 30, secs: 0});
    await c.tick();
    await c.tick();
    assert.equal(c.mode, 'retreat', 'a healthy bot keeps away while the odds say so');
    delete c.odds;
    c.release();
    location.position = new Vec3(25, 64, 0);
    zombie.name = 'zombie';
    bot.health = 20;
    c.fit = () => true;
    location.position = new Vec3(10, 64, 0);
    await c.tick();
    assert.equal(c.mode, 'hunt');
    assert.strictEqual(paths.at(-1).entity, location);
    assert.strictEqual(hazards.at(-1), location.position);
    c.release();
    // A creeper: a fit bot kites it tick by tick, striking from 5.5 blocks (it lights within 3) and walking backwards
    // while it is closer than 5; an unfit one only backs off (the iron farm's chest, main server 2026-10-17).
    zombie.name = 'creeper';
    let ticks = 0;
    bot.waitForTicks = async () => { if (++ticks >= 2) zombie.isValid = false; }; // killed on the second tick
    location.position = new Vec3(5, 64, 0);
    hits.length = 0;
    controls.length = 0;
    c.lastAttack = 0;
    await c.tick();
    assert.deepStrictEqual(hits, [zombie], 'fit, at 5: struck');
    assert.ok(!controls.includes('back true'), 'fit, at 5: stands');
    assert.equal(c.mode, null, 'and done once it is gone');
    Object.assign(zombie, {isValid: true});
    ticks = 0;
    c.lastAttack = 0;
    controls.length = 0;
    location.position = new Vec3(3, 64, 0);
    await c.tick();
    assert.deepStrictEqual([controls[0], controls.at(-1)], ['back true', 'back false'], 'fit, at 3: walks backwards, and stops after');
    assert.ok(aims.at(-1).x > 0, 'facing the creeper while it backs off');
    // Unfit, it kites the creeper too: walking backwards keeps it off better than the pathfinder backing off did
    // (bot2, naked, was blown up "backing off a creeper", main server 2026-10-17).
    c.fit = () => false;
    Object.assign(zombie, {isValid: true});
    ticks = 0;
    controls.length = 0;
    location.position = new Vec3(3, 64, 0);
    await c.tick();
    assert.strictEqual(controls[0], 'back true', 'unfit: kites it too');
  }
})();
// Death causes: only the bot's own death messages; chat and other players are ignored.
assert.equal(deathCause('bot1', 'bot1 was slain by Zombie'), 'was slain by Zombie');
assert.equal(deathCause('bot1', 'bot1 fell from a high place'), 'fell from a high place');
assert.equal(deathCause('bot1', 'bot1 hit the ground too hard'), 'hit the ground too hard');
assert.equal(deathCause('bot3', 'bot3 was speared by Zombie'), 'was speared by Zombie'); // a zombie with a spear (26.x)
assert.equal(deathCause('bot1', 'bot1 tried to swim in lava'), 'tried to swim in lava');
assert.equal(deathCause('bot1', 'bot1 experienced kinetic energy'), 'experienced kinetic energy');
for (const m of ['bot1 drowned', 'bot1 burned to death', 'bot1 went up in flames', 'bot1 blew up', 'bot1 was blown up by Creeper', 'bot1 suffocated in a wall', 'bot1 starved to death', 'bot1 froze to death', 'bot1 was killed by magic', 'bot1 withered away', 'bot1 was pricked to death', 'bot1 was shot by Skeleton', 'bot1 was doomed to fall by Creeper', 'bot1 was squashed by a falling block', 'bot1 died', 'bot1 walked into fire while fighting Zombie', 'bot1 fell out of the world', 'bot1 was obliterated by a sonically-charged shriek']) assert.ok(deathCause('bot1', m), m);
assert.equal(deathCause('bot1', 'bot2 was slain by Zombie'), null);
assert.equal(deathCause('bot1', '<bot1> fell from a high place'), null);
assert.equal(deathCause('bot1', 'bot1 joined the game'), null);
assert.equal(deathCause('bot1', 'bot10 fell from a high place'), null);
{
  // A fight during a dig ends the dig before the weapon goes into the hand (wrong-tool digs, 2026-10-10).
  const {Combat} = require('../combat');
  const calls = [];
  const bot = {targetDigBlock: {name: 'stone'}, stopDigging: () => calls.push('stop'), currentWindow: null,
    heldItem: {name: 'stone_pickaxe', type: 2}, inventory: {items: () => [{name: 'stone_sword', type: 1}]},
    equip: async () => calls.push('equip')};
  const c = new Combat({bot, inventoryBusy: 0});
  c.stop();
  c.fight({isValid: false}).then(() => {
    assert.deepStrictEqual(calls, ['stop', 'equip'], 'dig stopped first, then the weapon');
    assert.ok(Date.now() - c.lastFight < 1000);
  });
}
(async () => {
  // A mob behind a wall: bot3 retreated for 6 h at 6.8 health and food 17 (no regeneration, no eating), bot1
  // hunted for 14 h (lab 2026-10-13). The retreat eats, a mode ends after its cap, the mob is then ignored.
  const {Combat} = require('../combat');
  const {Vec3} = require('vec3');
  const goals = [], ate = [], logs = [];
  const zombie = {id: 7, type: 'hostile', name: 'zombie', position: new Vec3(10, 64, 0), height: 1.9};
  const bot = {health: 6.8, food: 17, entity: {position: new Vec3(0, 64, 0)}, entities: {7: zombie}, game: {dimension: 'overworld'},
    pathfinder: {setGoal: (g) => goals.push(g)}, registry: {foodsByName: {bread: {foodPoints: 5}}}, currentWindow: null,
    inventory: {items: () => [{name: 'bread'}], slots: {}}, getEquipmentDestSlot: () => 5, equip: async () => {}, consume: async () => ate.push('bread'), lookAt: async () => {}};
  const c = new Combat({bot, online: true, inventoryBusy: 0, name: 'bot3', world: {noteMob() {}}, log: (n, m) => logs.push(m), getSettings: () => ({defend: true, retreatHealth: 8, fightRange: 16, eatBelow: 14})});
  c.stop();
  await c.tick();
  assert.strictEqual(c.mode, 'retreat');
  await c.tick();
  assert.deepStrictEqual(ate, ['bread'], 'a retreating bot eats');
  c.since -= 31000;
  await c.tick();
  assert.strictEqual(c.mode, null, 'a retreat that does not resolve ends');
  assert.ok(logs.some((m) => /gave up on zombie/.test(m)));
  await c.tick();
  assert.strictEqual(c.mode, null, 'the mob is ignored for a while');
  zombie.position = new Vec3(2, 64, 0);
  let hit = false;
  c.fight = async () => { hit = true; };
  await c.tick();
  assert.ok(hit, 'an ignored mob is still fought at arm\'s length');
})();
(async () => {
  // A hungry bot eats unless a hostile is close: with a zombie 16 blocks off, bot50 held bread at food 6 for minutes,
  // then a zombie beat it to 2.5 health before it ate while fleeing, and died (sandbox, 2026-10-15). At night some
  // hostile is nearly always within 24 blocks.
  const {Combat} = require('../combat');
  const {Vec3} = require('vec3');
  const ate = [];
  const zombie = {id: 8, type: 'hostile', name: 'zombie', position: new Vec3(16, 64, 0), height: 1.9};
  const bot = {health: 20, food: 6, entity: {position: new Vec3(0, 64, 0)}, entities: {8: zombie}, game: {dimension: 'overworld'}, findBlock: () => null,
    pathfinder: {setGoal() {}}, registry: {foodsByName: {bread: {foodPoints: 5}}, blocksByName: {}}, currentWindow: null,
    inventory: {items: () => [{name: 'bread'}], slots: {}}, getEquipmentDestSlot: () => 5, equip: async () => {}, consume: async () => ate.push('bread'), lookAt: async () => {}};
  const c = new Combat({bot, online: true, inventoryBusy: 0, name: 'bot50', world: {noteMob() {}}, log() {}, getSettings: () => ({defend: true, retreatHealth: 8, fightRange: 8, eatBelow: 15})});
  c.stop();
  await c.tick();
  assert.deepStrictEqual([c.mode, ate], [null, ['bread']], 'it eats with the zombie 16 blocks off');
  zombie.position = new Vec3(5, 64, 0);
  ate.length = 0;
  c.fight = async () => {};
  c.hunt = () => {};
  await c.tick();
  assert.deepStrictEqual(ate, [], 'not with one 5 blocks off');
})();
(async () => {
  // Rotten flesh only when starving or nearly dead and nothing better is left (bot3, food 0, health 7, 2026-10-16).
  const {Combat} = require('../combat');
  const {Vec3} = require('vec3');
  const ate = [];
  let items = [{name: 'rotten_flesh'}];
  const bot = {health: 15, food: 12, entity: {position: new Vec3(0, 64, 0)}, entities: {}, registry: {foodsByName: {bread: {foodPoints: 5}, rotten_flesh: {foodPoints: 4}}},
    inventory: {items: () => items}, equip: async (i) => ate.push(i.name), consume: async () => {}};
  const c = new Combat({bot, online: true, name: 'bot3', getSettings: () => ({eatBelow: 15})});
  c.stop();
  await c.eat();
  assert.deepStrictEqual(ate, [], 'hungry but well: no rotten flesh');
  bot.food = 0; bot.health = 7;
  await c.eat();
  assert.deepStrictEqual(ate, ['rotten_flesh'], 'starving with nothing else: rotten flesh');
  ate.length = 0; items = [{name: 'rotten_flesh'}, {name: 'bread'}];
  await c.eat();
  assert.deepStrictEqual(ate, ['bread'], 'bread first');
})();
assert.ok(W.isHostile({type: 'hostile', name: 'zombie'}));
assert.ok(W.isHostile({type: 'mob', category: 'Hostile mobs', name: 'phantom'}));
assert.ok(!W.isHostile({type: 'player', name: 'x'}) && !W.isHostile({type: 'animal', name: 'wolf'}) && !W.isHostile(null));
assert.ok(W.shouldFight({type: 'hostile', name: 'creeper'}));
for (const n of ['enderman', 'zombified_piglin', 'warden']) assert.ok(!W.shouldFight({type: 'hostile', name: n}), n);
assert.strictEqual(W.normDim('minecraft:the_nether'), 'the_nether');
assert.strictEqual(W.deadlineMs(0), 90000);
assert.strictEqual(W.deadlineMs(100), 190000);
assert.strictEqual(W.deadlineMs(1e6), 600000);
assert.ok(weaponScore('iron_sword') > weaponScore('diamond_axe') && weaponScore('diamond_sword') > weaponScore('iron_sword') && weaponScore('stick') === 0);
const bm = {players: [
  {uuid: 'u1', name: 'steve', foreign: false, position: {x: 1.5, y: 64, z: -3}},
  {uuid: 'u2', name: 'alex', foreign: true, position: {x: 0, y: 0, z: 0}},
  {uuid: 'u3', name: 'bad name!', foreign: false, position: {x: 0, y: 0, z: 0}},
  {uuid: 'u4', name: 'nopos', foreign: false},
]};
assert.deepStrictEqual(W.parsePlayers(bm, 'overworld'), [{name: 'steve', uuid: 'u1', x: 1.5, y: 64, z: -3, dim: 'overworld'}]);
assert.deepStrictEqual(W.parsePlayers(null, 'overworld'), []);
let clock = 1000;
const wm = new W.WorldModel({now: () => clock});
assert.strictEqual(wm.learned('mine:stone'), null);
wm.learn('mine:stone', {ok: true, secs: 12, units: 1});
assert.strictEqual(wm.learned('mine:stone').each, null);
wm.learn('mine:stone', {ok: true, secs: 8, units: 1});
assert.deepStrictEqual(wm.learned('mine:stone'), {each: 10, pOk: 1, blocked: false, until: 0});
wm.learn('kill:sheep', {ok: false}); wm.learn('kill:sheep', {ok: false});
assert.strictEqual(wm.learned('kill:sheep').blocked, true);
clock += 600001; assert.strictEqual(wm.learned('kill:sheep').blocked, false); clock -= 600001;
wm.learn('kill:sheep', {ok: false}); assert.strictEqual(wm.learned('kill:sheep').blocked, true);
clock += 1200001; assert.strictEqual(wm.learned('kill:sheep').blocked, false); clock -= 1200001;
for (let i = 0; i < 200; i++) wm.learn('kill:sheep', {ok: false});
assert.strictEqual(wm.learned('kill:sheep').blocked, true);
clock += 86400001; assert.strictEqual(wm.learned('kill:sheep').blocked, false); clock -= 86400001;
// A craft that keeps failing gets dearer but stays in the plan: often nothing else makes the item.
wm.learn('craft:white_bed', {ok: false}); wm.learn('craft:white_bed', {ok: false}); wm.learn('craft:white_bed', {ok: false});
assert.deepStrictEqual([wm.learned('craft:white_bed').blocked, wm.learned('craft:white_bed').pOk], [false, 0.25]);
// A record from the hub is taken over whole; a bad one is dropped.
wm.noteExperience('mine:sand', {ok: 3, fail: 1, streak: 0, secs: 30, units: 10, lastFail: 5, t: 6});
assert.strictEqual(wm.learned('mine:sand').each, 3);
wm.noteExperience('mine:gravel', {ok: -1, fail: 0, streak: 0, secs: 0, units: 0, lastFail: 0, t: 0});
wm.noteExperience('mine:bad key', {ok: 1, fail: 0, streak: 0, secs: 0, units: 0, lastFail: 0, t: 0});
assert.deepStrictEqual([wm.learned('mine:gravel'), wm.learned('mine:bad key')], [null, null]);
assert.throws(() => wm.learn('chest:1,2.5,3:stone', {ok: true}), /invalid experience/);
assert.throws(() => wm.learn('craft:stone', {ok: true, secs: Infinity}), /invalid experience/);
for (let i = 0; i < 39; i++) wm.learn('mine:stone', {ok: false});
assert.ok(wm.experience.get('mine:stone').ok + wm.experience.get('mine:stone').fail <= 40);
wm.setPlayers(W.parsePlayers(bm, 'the_nether'));
assert.strictEqual(wm.player('steve').dim, 'the_nether');
wm.postNeed('bot2', 'hopper', 9, {x: -356, y: 72, z: -191}, 'waiting for material');
wm.postNeed('bot3', 'iron_ingot', 4, {x: 1, y: 2, z: 3}, 'gear');
assert.deepStrictEqual(wm.openNeeds().map((n) => n.item), ['hopper', 'iron_ingot']);
for (const args of [['Bad', 1, {x: 0, y: 0, z: 0}, ''], ['stone', 0, {x: 0, y: 0, z: 0}, ''], ['stone', 1, {x: 0, y: 0.5, z: 0}, ''], ['stone', 1, {x: 0, y: 0, z: 0}, 'x'.repeat(161)], ['stone', 1, {x: 0, y: 0, z: 0}, 'bad\ntext']]) assert.throws(() => wm.postNeed('bot1', ...args), /invalid need/);
clock += 600001;
assert.deepStrictEqual(wm.openNeeds(), [], 'needs expire after ten minutes');
clock -= 600001;
const mob = (id, x) => ({id, name: 'zombie', position: {x, y: 64, z: 0}});
wm.noteMob('bot1', mob(1, 10), 'overworld');
assert.strictEqual(wm.hostilesNear(12, 0, 'overworld', 8).length, 1);
assert.strictEqual(wm.hostilesNear(12, 0, 'the_nether', 8).length, 0);
assert.strictEqual(wm.hostilesNear(100, 0, 'overworld', 8).length, 0);
wm.forgetMob(1);
assert.strictEqual(wm.mobs.size, 0);
wm.noteMob('bot1', mob(2, 10), 'overworld');
clock += W.MOB_TTL_MS + 1; // mobs expire; players (10 s) too
assert.strictEqual(wm.snapshot().mobs.length, 0);
assert.strictEqual(wm.player('steve'), undefined);
for (let i = 0; i < W.MAX_MOBS + 50; i++) { clock++; wm.noteMob('bot1', mob(i, i), 'overworld'); }
assert.strictEqual(wm.mobs.size, W.MAX_MOBS);
assert.ok(wm.mobs.has(`overworld:${W.MAX_MOBS + 49}`) && !wm.mobs.has('overworld:0')); // oldest evicted
for (let i = 0; i < W.MAX_BLOCKS + 20; i++) { clock++; wm.noteBlock('bot1', 'chest', {x: i, y: 1, z: 1}, 'overworld'); }
assert.strictEqual(wm.blocks.size, W.MAX_BLOCKS);
assert.strictEqual(loadConfig({BOT_NAMES: 'bot1', BLUEMAP_URL: 'http://minecraft:8100/'}).bluemapUrl, 'http://minecraft:8100');
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BLUEMAP_URL: 'file:///etc'}));
assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', SUPPLY_CHEST: '-100,71,12'}).supplyChest, {x: -100, y: 71, z: 12});
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', SUPPLY_CHEST: '1,2'}));
assert.deepStrictEqual(VALIDATE.rearm({x: 1, y: 2, z: 3}), {x: 1, y: 2, z: 3});
// Constructing a runner must not throw (it does not connect until start()).
const {BotRunner} = require('../bots');
const runner = new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: null, protectedAreas: [], supplyChest: {x: 1, y: 2, z: 3}});
assert.deepStrictEqual(runner.supplyChest, {x: 1, y: 2, z: 3});
{ // graves go first: the running job is interrupted, queued right behind them, and goes on afterwards
  const q = new BotRunner('bot3', {host: 'x', port: 1, log: () => {}, world: null, protectedAreas: [], onEvent: () => {}});
  q.pump = () => {};
  q.enqueue('mine', {block: 'stone', count: 5});
  q.current = q.queue.shift();
  q.enqueue('graves', {spots: [{x: 1, y: 64, z: 1}]}, {first: true});
  assert.strictEqual(q.current.cancelled, true);
  assert.deepStrictEqual(q.queue.map((j) => j.type), ['graves', 'mine']);
}
{
  // The same shaft ordered again while it runs or waits is not queued twice; another job is (lab 2026-10-13).
  const q = new BotRunner('bot2', {host: 'x', port: 1, log: () => {}, world: null, protectedAreas: []});
  q.pump = () => {};
  const shaft = {x1: -291, z1: -222, x2: -276, z2: -207, top: 80, bottom: -59};
  q.enqueue('shaft', shaft);
  q.current = q.queue.shift();
  q.enqueue('shaft', shaft);
  q.enqueue('mine', {block: 'stone', count: 5});
  q.enqueue('mine', {block: 'stone', count: 5});
  q.enqueue('shaft', {...shaft, bottom: -40});
  q.enqueue('shaft', {...shaft, bottom: -40});
  assert.deepStrictEqual(q.queue.map((j) => `${j.type} ${j.args.bottom ?? ''}`), ['mine ', 'mine ', 'shaft -40']);
  // ordered again with replace: the running one is cancelled and the new one queued, not dropped as its double
  q.cancel = () => { if (q.current) q.current.cancelled = true; };
  q.enqueue('shaft', shaft, {replace: true});
  assert.deepStrictEqual(q.queue.map((j) => j.type), ['shaft'], 'the same shaft again, after the stop');
}
// Block claims: a second bot cannot take a block the first one holds.
const {WorldModel} = require('../world');
const claims = new WorldModel();
assert.ok(claims.claim('bot1', 'o:1,2,3'));
assert.ok(!claims.claim('bot2', 'o:1,2,3'));
assert.ok(claims.claimedByOther('bot2', 'o:1,2,3'));
claims.release('bot1', 'o:1,2,3');
assert.ok(claims.claim('bot2', 'o:1,2,3'));
assert.deepStrictEqual(claims.claimStats('bot1'), {granted: 1, refused: 0, timedOut: 0});
assert.deepStrictEqual(claims.claimStats('bot2'), {granted: 1, refused: 1, timedOut: 0});
assert.deepStrictEqual(claims.claimStats('nobody'), {granted: 0, refused: 0, timedOut: 0});
// Protected boxes are inclusive; a block outside every box may be dug.
const boxes = [[-80, -144, 80, 80], [112, 368, 272, 592]];
assert.ok(W.insideAreas(boxes, 0, 0) && W.insideAreas(boxes, 80, 80) && W.insideAreas(boxes, 200, 400));
assert.ok(!W.insideAreas(boxes, 81, 0) && !W.insideAreas(boxes, -36, -197) && !W.insideAreas([], 0, 0));
// A box with y bounds only covers those levels when the caller passes y (the pathfinder); without y it stays the whole column.
const hall = [[-265, -221, -248, -212, 57, 61]];
assert.ok(W.insideAreas(hall, -257, -220) && W.insideAreas(hall, -257, -220, 57) && W.insideAreas(hall, -257, -220, 61), 'no y: the column; y inside: covered');
assert.ok(!W.insideAreas(hall, -257, -220, 44) && !W.insideAreas(hall, -257, -220, 62), 'bedrock to y 56 and above y 61 may be dug');
assert.ok(W.insideAreas(boxes, 0, 0, 44) && !W.insideAreas(hall, -300, -220, 58), 'a 4-element entry covers every level');
// Login passwords are stable per seed and name, and differ between bots.
const pw = (n) => new BotRunner(n, {host: 'x', port: 1, log: () => {}, world: null, loginSeed: 'seed'}).password;
assert.strictEqual(pw('bot1'), pw('bot1'));
assert.notStrictEqual(pw('bot1'), pw('bot2'));
assert.strictEqual(pw('bot1').length, 32);
const {normalize} = require('../itemfix');
assert.deepStrictEqual(normalize({enchantments: [{id: 1, level: 5}]}, {enchantments: {1: {name: 'efficiency'}}}), [{name: 'efficiency', lvl: 5}]);
assert.deepStrictEqual(normalize([{name: 'x', lvl: 1}], {}), [{name: 'x', lvl: 1}]);
{ // digfix.js: ore blocks get the pickaxe speed bonus (vanilla times)
  const {fix} = require('../digfix');
  assert.strictEqual(fix('26.1'), false); // already applied by bots.js
  const reg = require('prismarine-registry')('26.1');
  const Block = require('prismarine-block')(reg);
  const ms = (block, tool) => Block.fromStateId(reg.blocksByName[block].defaultState, 0).digTime(reg.itemsByName[tool]?.id ?? null, false, false, false, [], []);
  assert.strictEqual(ms('iron_ore', 'iron_pickaxe'), 750);
  assert.strictEqual(ms('deepslate_diamond_ore', 'iron_pickaxe'), 1150);
  assert.strictEqual(ms('stone', 'iron_pickaxe'), 400);
  assert.strictEqual(ms('iron_ore', 'wooden_pickaxe'), 7500); // cannot harvest: no drop, slow
  assert.ok(ms('iron_ore', 'wooden_axe') > ms('iron_ore', 'wooden_pickaxe')); // an axe is no ore tool
  assert.strictEqual(ms('diamond_ore', 'stone_pickaxe'), 3750); // tier rules unchanged
}
assert.deepStrictEqual(VALIDATE.craft({item: 'stone_pickaxe', count: '2'}), {item: 'stone_pickaxe', count: 2});
assert.throws(() => VALIDATE.craft({item: 'Stone Pickaxe'}));
assert.deepStrictEqual(VALIDATE.shift({block: 'logs', x: 1, y: 2, z: 3}), {block: 'logs', x: 1, y: 2, z: 3});
require('../crafting');
// hub.js cleanPng: a worker's view frame must be a real, small PNG.
{
  const {cleanPng} = require('../hub');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  assert.ok(cleanPng(png.toString('base64')));
  assert.strictEqual(cleanPng(Buffer.from('<html>evil').toString('base64')), null, 'not a PNG');
  assert.strictEqual(cleanPng('x'.repeat(230000)), null, 'too big');
  assert.strictEqual(cleanPng({}), null);
}
// alerts.js: chest gone/back once each, night/morning on change, mobs at most every 2 minutes.
{
  const {Alerts, MOB_EVERY_MS} = require('../alerts');
  const {EventLog} = require('../events');
  let t = 0;
  const ev = new EventLog({now: () => t});
  const al = new Alerts({events: ev, now: () => t});
  const chest = {x: 1, y: 2, z: 3};
  al.check({chestBlock: 'chest', timeOfDay: 6000, hostiles: []}, chest);
  assert.strictEqual(ev.items.length, 0, 'all well');
  al.check({chestBlock: 'air', timeOfDay: 6000, hostiles: []}, chest);
  al.check({chestBlock: 'air', timeOfDay: 6000, hostiles: []}, chest);
  assert.deepStrictEqual(ev.items.map((e) => [e.kind, e.text]), [['alert', 'the supply chest at 1 2 3 is gone (air there now)']]);
  al.check({chestBlock: null, timeOfDay: 14000, hostiles: [{type: 'creeper'}, {type: 'creeper'}, {type: 'zombie'}]}, chest);
  assert.match(ev.items.at(-2).text, /night falls/);
  assert.match(ev.items.at(-1).text, /creeper x2, zombie x1/);
  t += 1000;
  al.check({chestBlock: 'chest', timeOfDay: 14000, hostiles: [{type: 'creeper'}]}, chest);
  assert.match(ev.items.at(-1).text, /is back/, 'no second mob alert within 2 minutes');
  t += MOB_EVERY_MS;
  al.check({chestBlock: 'chest', timeOfDay: 23500, hostiles: [{type: 'creeper'}]}, chest);
  assert.deepStrictEqual(ev.items.slice(-2).map((e) => e.text.split(':')[0]), ['morning', 'hostile mobs near the base']);
}
// chest panel: warnings, the full alert fires once per fill, free slots travel with the stock
{
  const {Alerts, chestWarnings} = require('../alerts');
  const {EventLog} = require('../events');
  const {WorldModel} = require('../world');
  assert.deepStrictEqual(chestWarnings({bread: 3, torch: 8, stone_pickaxe: 1, oak_sapling: 4}, 20), []);
  assert.deepStrictEqual(chestWarnings({cobblestone: 64}, 3), ['full (3 free slots)', 'no food', 'no torches or coal', 'no pickaxes', 'no saplings']);
  assert.deepStrictEqual(chestWarnings({cooked_beef: 1, charcoal: 1, iron_pickaxe: 1, birch_sapling: 1}, null), [], 'unknown free slots: no full warning');
  const ev = new EventLog();
  const al = new Alerts({events: ev});
  al.checkChest(null);
  al.checkChest({items: {}, free: null});
  al.checkChest({items: {}, free: 10});
  assert.strictEqual(ev.items.length, 0);
  al.checkChest({items: {}, free: 3});
  al.checkChest({items: {}, free: 0});
  assert.deepStrictEqual(ev.items.map((e) => [e.kind, e.text]), [['alert', 'the supply chest is full (3 free slots): empty it or build another chest']]);
  al.checkChest({items: {}, free: 12});
  al.checkChest({items: {}, free: 2});
  assert.strictEqual(ev.items.length, 2, 'emptied, then full again: a new alert');
  const w = new WorldModel();
  w.noteStock('bot1', {coal: 2}, 7);
  assert.strictEqual(w.snapshot().stock.free, 7);
  w.noteStock('bot1', {coal: 2});
  assert.strictEqual(w.snapshot().stock.free, null);
}
// projects.js: the last project per bot survives a restart; pause keeps it, forget drops it
{
  const {Projects, PROJECTS} = require('../projects');
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mcbots-'));
  for (const t of PROJECTS) assert.ok(VALIDATE[t], `${t} is a job`);
  const p = new Projects(dir);
  p.note('bot3', 'shaft', VALIDATE.shaft({x1: 0, z1: 0, x2: 8, z2: 8}));
  p.note('bot4', 'build', {origin: {x: 1, y: 2, z: 3}, blocks: [{x: 0, y: 0, z: 0, block: 'stone'}], remove: false});
  p.pause('bot3');
  const again = new Projects(dir);
  assert.deepStrictEqual(Object.entries(again.view()).map(([b, v]) => [b, v.type, v.paused]), [['bot3', 'shaft', true], ['bot4', 'build', false]]);
  assert.match(again.view().bot4.summary, /origin 1 2 3 1 blocks/);
  assert.deepStrictEqual(again.get('bot3').args, VALIDATE.shaft({x1: 0, z1: 0, x2: 8, z2: 8}), 'the arguments come back whole');
  again.forget('bot3');
  assert.strictEqual(new Projects(dir).get('bot3'), null);
  require('node:fs').writeFileSync(require('node:path').join(dir, 'projects.json'), JSON.stringify({bot5: {type: 'say', args: {}}, bot6: {type: 'rim', args: 5}}));
  assert.deepStrictEqual(new Projects(dir).view(), {}, 'entries that are no project are dropped');
}
// crews.js: validation and persistence of the dashboard's crews, goals and bed slots
{
  const {Crews, MAX_GOAL} = require('../crews');
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mcbots-'));
  const ctx = {agentBots: ['bot1', 'bot2', 'bot3', 'bot4'], bots: ['bot1', 'bot2', 'bot3', 'bot4', 'bot5']};
  const c = new Crews(dir, ctx);
  const agents = new Set(['bot1', 'bot2']);
  assert.deepStrictEqual(c.data, {crews: {}, goals: {}, slots: {}});
  c.set({crews: {bot1: ['bot3'], bot2: ['bot4']}, goals: {bot1: ' mine things '}, slots: {bot5: 2}}, agents);
  assert.deepStrictEqual(new Crews(dir, ctx).data, {crews: {bot1: ['bot3'], bot2: ['bot4']}, goals: {bot1: 'mine things'}, slots: {bot5: 2}}, 'survives a restart');
  c.set({crews: {bot1: ['bot4'], bot2: ['bot3']}}, agents); // a worker moves between agents
  assert.deepStrictEqual(c.data.crews, {bot1: ['bot4'], bot2: ['bot3']});
  assert.strictEqual(c.data.goals.bot1, 'mine things', 'sections left out stay');
  const bad = [[{crews: {bot1: ['bot3'], bot2: ['bot3']}}, /two crews/], [{crews: {bot1: ['bot2']}}, /agent/], [{crews: {bot1: ['bot3'], bot3: ['bot4']}}, /agent/], [{crews: {bot5: []}}, /not an agent bot/],
    [{crews: {bot1: ['bot9']}}, /not an agent bot/], [{crews: {bot1: 'bot3'}}, /list/], [{crews: {bot1: Array(13).fill('bot3')}}, /list/], [{goals: {bot1: ''}}, /goal/], [{goals: {bot1: 'x'.repeat(MAX_GOAL + 1)}}, /goal/],
    [{goals: {bot7: 'x'}}, /not an agent bot/], [{slots: {bot5: 2, bot1: 2}}, /twice/], [{slots: {bot5: 14}}, /slot/], [{slots: {bot9: 1}}, /unknown bot/], [{slots: {bot5: 1.5}}, /slot/], [{junk: 1}, /unknown section/], [{crews: []}, /object/]];
  for (const [input, re] of bad) assert.throws(() => c.set(input, agents), re, JSON.stringify(input).slice(0, 60));
  assert.deepStrictEqual(c.data.crews, {bot1: ['bot4'], bot2: ['bot3']}, 'a refused edit changes nothing');
  c.set({goals: 'x'.repeat(MAX_GOAL) && {bot2: 'x'.repeat(MAX_GOAL)}}, agents);
  c.set({crews: null, goals: null, slots: null}, agents);
  assert.deepStrictEqual(c.data, {crews: {}, goals: {}, slots: {}}, 'null clears a section: back to the env');
}
{ // the agent token reads the crews and nothing else of the dashboard's editors
  const A = require('../agentauth');
  assert.ok(A.agentEndpoint('GET', '/api/crews'));
  for (const [m, u] of [['POST', '/api/crews'], ['POST', '/api/project'], ['GET', '/api/project'], ['POST', '/api/settings']]) assert.ok(!A.agentEndpoint(m, u), `${m} ${u}`);
  // the page's job picker only offers jobs the server validates, and its quick actions exist
  const html = require('node:fs').readFileSync(require('node:path').join(APP, 'public/legacy.html'), 'utf8');
  const picker = /const PICKER = \[([^\]]*)\]/.exec(html);
  assert.ok(picker, 'job picker list');
  for (const t of picker[1].match(/'(\w+)'/g).map((q) => q.slice(1, -1))) assert.ok(VALIDATE[t], `picker offers ${t}`);
}
// pathcache.js: one Block per position inside the window, a fresh one after it.
{
  const {cacheGetBlock, WINDOW_MS} = require('../pathcache');
  let calls = 0;
  let t = 1000;
  const mv = cacheGetBlock({getBlock: (pos, dx, dy, dz) => ({n: ++calls, y: pos ? pos.y + dy : null})}, () => t);
  const a = mv.getBlock({x: 1, y: 2, z: 3}, 0, 1, 0);
  assert.strictEqual(mv.getBlock({x: 1, y: 3, z: 3}, 0, 0, 0), a, 'same absolute position, same block');
  assert.notStrictEqual(mv.getBlock({x: 1, y: 2, z: 3}, 0, 0, 0), a);
  t += WINDOW_MS + 1;
  assert.notStrictEqual(mv.getBlock({x: 1, y: 2, z: 3}, 0, 1, 0), a, 'expired');
  assert.strictEqual(calls, 3);
  assert.strictEqual(mv.getBlock(null, 0, 0, 0).n, 4, 'no position: not cached');
  let ver = 0; // a block update inside the window: the next ask is fresh (air -> water must not be cached)
  const mv2 = cacheGetBlock({getBlock: () => ({n: ++calls})}, () => t, () => ver);
  const b = mv2.getBlock({x: 1, y: 2, z: 3}, 0, 0, 0);
  assert.strictEqual(mv2.getBlock({x: 1, y: 2, z: 3}, 0, 0, 0), b);
  ver++;
  assert.notStrictEqual(mv2.getBlock({x: 1, y: 2, z: 3}, 0, 0, 0), b, 'block update empties the cache');
}
// Paper refuses a position whose box touches a block face exactly, so every
// horizontal collision must end a hair short (physicsfix.js).
{
  const AABB = require('prismarine-physics/lib/aabb');
  const {GAP} = require('../physicsfix');
  const wall = new AABB(-5, 58, -5, -4, 59, -4);
  const player = (x) => new AABB(x - 0.3, 58, -5, x + 0.3, 59.8, -4.4);
  const stop = wall.computeOffsetX(player(-3.5), -1); // would end flush at x=-3.7
  assert.ok(Math.abs(stop - -0.2) < 2 * GAP && stop > -0.2, `gap kept, got ${stop}`);
  assert.strictEqual(wall.computeOffsetX(player(-3.7), -1), 0); // already flush: stay
  assert.strictEqual(wall.computeOffsetX(player(-3.7 + GAP / 2), -1), 0); // inside the margin: stay
  assert.strictEqual(wall.computeOffsetX(player(-3.5), -0.1), -0.1); // free move untouched
  assert.strictEqual(wall.computeOffsetX(player(-3.5), 0.5), 0.5); // moving away untouched
  const zwall = new AABB(-5, 58, -5, -4, 59, -4);
  const zp = (z) => new AABB(-4.8, 58, z - 0.3, -4.2, 59.8, z + 0.3);
  assert.ok(zwall.computeOffsetZ(zp(-3.5), -1) > -0.2 && zwall.computeOffsetZ(zp(-3.5), -1) < -0.2 + 2 * GAP);
}
