'use strict';
const assert = require('node:assert');
const {loadConfig} = require('../config');
const {WorldModel} = require('../world');
// ---- keeper: standing orders ----
{
  const {Keeper, parseQuotas, IDLE_MS, COOLDOWN_MS, STOCK_MAX_AGE_MS} = require('../keeper');
  assert.deepStrictEqual(parseQuotas('logs:64, cobblestone:128'), [['logs', 64], ['cobblestone', 128]]);
  assert.deepStrictEqual(parseQuotas(''), []);
  for (const bad of ['logs', 'logs:0', 'Logs:5', 'logs:5000', 'logs:1,logs:2', 'a:b']) assert.throws(() => parseQuotas(bad), bad);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', KEEPER_QUOTAS: 'coal:32', KEEPER_SITE: '1,2,3'}).keeperSite, {x: 1, y: 2, z: 3});
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', KEEPER_SITE: '1,2'}));

  let now = 1e6;
  const chest = {x: 1, y: 2, z: 3};
  const world = new WorldModel({now: () => now});
  const fake = (name) => ({name, sent: [], idle: true, online: true, snapshot() { return {online: this.online, dead: false, job: this.idle ? null : {label: 'x'}, queue: []}; }, enqueue(type, args) { this.sent.push([type, args]); this.idle = false; }});
  const bots = [fake('bot1'), fake('bot2'), fake('bot3')];
  const runners = new Map(bots.map((b) => [b.name, b]));
  const {EventLog} = require('../events');
  const events = new EventLog();
  const k = new Keeper({runners, world, chest, quotas: [['logs', 64], ['cobblestone', 128], ['torch', 16]], events, now: () => now});
  assert.throws(() => new Keeper({runners, world, chest: null, quotas: [], now: () => now}).setEnabled(true), /no supply chest/);
  k.tick();
  assert.strictEqual(bots.every((b) => !b.sent.length), true, 'off by default: nothing is assigned');
  assert.strictEqual(k.state().enabled, false);
  k.setEnabled(true);
  k.tick(); // idle bots are only taken after IDLE_MS
  assert.strictEqual(bots.every((b) => !b.sent.length), true);
  now += IDLE_MS;
  k.tick(); // no numbers yet: the first idle bot is sent to count the chest
  assert.deepStrictEqual(bots[0].sent, [['stock', chest]]);
  assert.strictEqual(k.state().counting, 'bot1');
  k.tick();
  assert.strictEqual(bots[1].sent.length, 0, 'only one bot counts');
  // bot1 reports and goes idle again
  world.noteStock('bot1', {oak_log: 20, birch_log: 4, cobblestone: 200, coal: 0});
  bots[0].idle = true;
  now += 6000;
  k.tick();
  const st = k.state();
  assert.deepStrictEqual(st.quotas.map((q) => [q.item, q.have, q.want]), [['logs', 24, 64], ['cobblestone', 200, 128], ['torch', 0, 16]]);
  // logs are short: a chop of the missing 40 and a deposit of logs only, on an idle bot (not the one that just finished)
  const logBot = bots.find((b) => b.sent.some((x) => x[0] === 'chop'));
  assert.ok(logBot && logBot !== bots[0]);
  assert.deepStrictEqual(logBot.sent, [['chop', {count: 40}], ['deposit', {...chest, only: 'logs'}]]);
  assert.strictEqual(k.state().quotas[0].bot, logBot.name);
  assert.match(k.state().quotas[2].note, /needs 4 coal/); // torches wait for coal
  assert.strictEqual(k.state().quotas[1].bot, null, 'cobblestone is above its target: no job');
  // cobblestone falls short: a second chain, on another bot
  world.noteStock('bot1', {oak_log: 24, cobblestone: 0, coal: 8});
  k.tick();
  const stoneBot = bots.find((b) => b.sent.some((x) => x[0] === 'mine'));
  assert.ok(stoneBot && stoneBot !== logBot);
  assert.deepStrictEqual(stoneBot.sent, [['mine', {block: 'stone', count: 64}], ['deposit', {...chest, only: 'cobblestone'}]]);
  // 2026-10-20: a quota item without a PLANS entry is fetched by the acquire planner (get) and shelved
  {
    let t2 = Date.now();
    const solo = fake('bot9'), w2 = new WorldModel({now: () => t2});
    const k2 = new Keeper({runners: new Map([[solo.name, solo]]), world: w2, chest, quotas: [['diamond', 5]], now: () => t2});
    k2.setEnabled(true);
    t2 += IDLE_MS; k2.tick();
    w2.noteStock('bot9', {cobblestone: 1});
    solo.idle = true; solo.sent.length = 0; t2 += 6000; k2.tick(); t2 += IDLE_MS; k2.tick();
    assert.deepStrictEqual(solo.sent, [['get', {item: 'diamond', count: 5}], ['deposit', {...chest, only: 'diamond'}]]);
  }
  // 2026-11-11: a full supply chest is emptied to the hall by an idle bot with room, once per cooldown (1443 cobblestone, 1 slot free)
  {
    let t2 = Date.now();
    const roomy = fake('bot7'), cramped = fake('bot8');
    roomy.snapshot = function () { return {online: true, dead: false, job: this.idle ? null : {label: 'x'}, queue: [], freeSlots: 30}; };
    cramped.snapshot = function () { return {online: true, dead: false, job: null, queue: [], freeSlots: 0}; };
    const w2 = new WorldModel({now: () => t2});
    const k2 = new Keeper({runners: new Map([[cramped.name, cramped], [roomy.name, roomy]]), world: w2, chest, quotas: [['logs', 64]], now: () => t2});
    k2.setEnabled(true);
    k2.tick();
    w2.noteStock('bot7', {oak_log: 64, cobblestone: 1443}, 1, chest);
    t2 += IDLE_MS; k2.tick();
    assert.deepStrictEqual(roomy.sent, [['deposit', chest]]);
    assert.deepStrictEqual(cramped.sent, [], 'a bot without room carries nothing');
    roomy.idle = true; roomy.sent.length = 0;
    k2.tick(); t2 += IDLE_MS; k2.tick();
    assert.deepStrictEqual(roomy.sent, [], 'once per cooldown');
    t2 += COOLDOWN_MS; k2.tick();
    assert.deepStrictEqual(roomy.sent, [['deposit', chest]]);
    w2.noteStock('bot7', {oak_log: 64, cobblestone: 1443}, 3, chest);
    roomy.idle = true; roomy.sent.length = 0;
    k2.tick(); t2 += COOLDOWN_MS + IDLE_MS; k2.tick();
    assert.deepStrictEqual(roomy.sent, [], 'three free slots are not full');
  }
  // 2026-10-23: the board's bots are never the keeper's, idle or not (it took them for light and treefarm in the spike)
  for (const skip of [['bot2'], []]) {
    let t2 = Date.now();
    const solo = fake('bot2');
    solo.snapshot = function () { return {name: this.name, online: true, dead: false, job: null, queue: []}; };
    const k2 = new Keeper({runners: new Map([[solo.name, solo]]), world: new WorldModel({now: () => t2}), chest, quotas: [['logs', 64]], now: () => t2, skip});
    k2.setEnabled(true);
    for (let i = 0; i < 3; i++) { t2 += IDLE_MS; k2.tick(); }
    assert.strictEqual(solo.sent.length > 0, !skip.length, skip.length ? 'a skipped bot gets nothing' : 'the same bot unskipped is used');
  }
  // 2026-11-11: a bot under an order hold (orderRetryAt, a death hold) gets no keeper job either
  for (const held of [() => true, () => false]) {
    let t2 = Date.now();
    const solo = fake('bot2');
    solo.snapshot = function () { return {name: this.name, online: true, dead: false, job: null, queue: []}; };
    const k2 = new Keeper({runners: new Map([[solo.name, solo]]), world: new WorldModel({now: () => t2}), chest, quotas: [['logs', 64]], now: () => t2, held});
    k2.setEnabled(true);
    for (let i = 0; i < 3; i++) { t2 += IDLE_MS; k2.tick(); }
    assert.strictEqual(solo.sent.length > 0, !held('bot2'), held('bot2') ? 'a held bot gets nothing' : 'the same bot not held is used');
  }
  // 2026-10-20: with one free bot the quota that is shortest relative to its want goes first, not the first one listed
  {
    let t2 = Date.now();
    const solo = fake('bot9'), w2 = new WorldModel({now: () => t2});
    const k2 = new Keeper({runners: new Map([[solo.name, solo]]), world: w2, chest, quotas: [['logs', 100], ['cobblestone', 10]], now: () => t2});
    k2.setEnabled(true);
    t2 += IDLE_MS; k2.tick();
    w2.noteStock('bot9', {oak_log: 90, cobblestone: 0});
    solo.idle = true; solo.sent.length = 0; t2 += 6000; k2.tick(); t2 += IDLE_MS; k2.tick();
    assert.strictEqual(solo.sent[0]?.[0], 'mine', 'cobblestone (10 of 10 missing) before logs (10 of 100)');
  }
  // the third bot is never used: at most two at once
  now += IDLE_MS; k.tick();
  assert.strictEqual(bots.filter((b) => b.sent.length).length, 3, 'bot1 counted, two worked');
  assert.match(k.state().quotas[2].note, /waiting for a free bot|needs 4 coal/);
  // the log bot finishes but the chest did not get more logs: cooldown, no retry loop
  k.tick();
  logBot.idle = true;
  now += 5000;
  world.noteStock(logBot.name, {oak_log: 24, cobblestone: 20, coal: 8});
  k.tick();
  assert.match(events.items.map((e) => e.text).join('\n'), new RegExp(`${logBot.name} is done with logs, but the chest did not get more \\(24 -> 24\\)`));
  const sentBefore = bots.map((b) => b.sent.length);
  now += IDLE_MS; k.tick(); k.tick();
  assert.ok(bots.every((b) => !b.sent.slice(sentBefore[bots.indexOf(b)]).some((x) => x[0] === 'chop')), 'logs on cooldown: no new chop');
  assert.match(k.state().quotas[0].note, /retrying in \d+ min/);
  for (const b of bots) b.idle = true; // everyone is done (the torch chain started when coal appeared)
  world.noteStock('bot1', {oak_log: 24, cobblestone: 200, coal: 8, torch: 16});
  now += 1000; k.tick(); // chains end, their items cool down
  now += COOLDOWN_MS + 1;
  world.noteStock('bot1', {oak_log: 24, cobblestone: 200, coal: 8, torch: 16});
  k.tick(); now += IDLE_MS; k.tick();
  assert.ok(bots.some((b, i) => b.sent.slice(sentBefore[i]).some((x) => x[0] === 'chop')), 'after the cooldown logs are tried again');
  // old numbers: nothing is planned from them, a bot counts again
  now += STOCK_MAX_AGE_MS + 1;
  const n0 = bots.reduce((n, b) => n + b.sent.length, 0);
  for (const b of bots) b.idle = true;
  k.work.clear(); k.counting = null; k.idleSince.clear();
  k.tick(); now += IDLE_MS; k.tick();
  assert.ok(bots.some((b) => b.sent.at(-1)?.[0] === 'stock') && bots.reduce((n, b) => n + b.sent.length, 0) === n0 + 1);
  // off again: nothing more is assigned
  k.setEnabled(false);
  const n1 = bots.reduce((n, b) => n + b.sent.length, 0);
  k.tick();
  assert.strictEqual(bots.reduce((n, b) => n + b.sent.length, 0), n1);
  // a busy bot and an offline bot are never taken
  k.setEnabled(true);
  for (const b of bots) { b.idle = false; }
  bots[1].idle = true; bots[1].online = false;
  k.idleSince.clear(); now += IDLE_MS; k.tick(); now += IDLE_MS; k.tick();
  assert.strictEqual(bots.reduce((n, b) => n + b.sent.length, 0), n1);
  // torches: 4 coal and a log in the chest allow a chain that takes both, crafts and puts the torches back
  const {PLANS} = require('../keeper');
  assert.deepStrictEqual(PLANS.torch(16, chest, {coal: 4, birch_log: 1}).map((j) => j[0]), ['withdraw', 'withdraw', 'craft', 'deposit']);
  assert.match(PLANS.torch(16, chest, {coal: 3, oak_log: 1}).blocked, /4 coal/);
  assert.match(PLANS.torch(16, chest, {coal: 4}).blocked, /log/);
  // spare pickaxes: cobblestone and logs from the chest, crafted, put back
  assert.deepStrictEqual(PLANS.stone_pickaxe(3, chest, {cobblestone: 9, oak_log: 3}).map((j) => [j[0], j[1].item, j[1].count]), [['withdraw', 'cobblestone', 9], ['withdraw', 'logs', 3], ['craft', 'stone_pickaxe', 3], ['deposit', undefined, undefined], ['deposit', undefined, undefined]]);
  assert.strictEqual(PLANS.stone_pickaxe(3, chest, {cobblestone: 9, oak_log: 3})[3][1].only, 'stone_pickaxe');
  assert.match(PLANS.stone_pickaxe(3, chest, {cobblestone: 8, oak_log: 3}).blocked, /9 cobblestone/);
  assert.match(PLANS.stone_pickaxe(3, chest, {cobblestone: 9, oak_log: 2}).blocked, /3 logs/);
  assert.strictEqual(PLANS.stone_pickaxe(1, chest, {cobblestone: 3, birch_log: 2}).length, 5);
  // iron kit: raw iron, coal, cobblestone and logs come out, the bot smelts and crafts, the tool goes back
  const kitStock = {raw_iron: 6, coal: 1, cobblestone: 8, oak_log: 2};
  assert.deepStrictEqual(PLANS.iron_pickaxe(2, chest, kitStock).map((j) => j[0]), ['withdraw', 'withdraw', 'withdraw', 'withdraw', 'smelt', 'craft', 'deposit', 'deposit']);
  assert.deepStrictEqual(PLANS.iron_pickaxe(2, chest, kitStock).find((j) => j[0] === 'smelt')[1], {item: 'raw_iron', count: 6});
  assert.strictEqual(PLANS.iron_pickaxe(2, chest, kitStock).at(-2)[1].only, 'iron_pickaxe');
  assert.strictEqual(PLANS.iron_pickaxe(2, chest, kitStock).at(-1)[1].only, undefined, 'then a plain deposit returns the leftovers (review M4)');
  assert.match(PLANS.iron_pickaxe(2, chest, {...kitStock, raw_iron: 5}).blocked, /6 raw_iron/);
  assert.match(PLANS.iron_sword(1, chest, {...kitStock, coal: 0}).blocked, /1 coal/);
  assert.deepStrictEqual(PLANS.coal(32, chest, {oak_log: 500}).map((j) => j[0]), ['withdraw', 'smelt', 'deposit', 'deposit'], 'logs to spare: charcoal');
  assert.deepStrictEqual([PLANS.coal(32, chest, {oak_log: 500})[0][1].count, PLANS.coal(32, chest, {oak_log: 500})[1][1].count], [64, 32]);
  assert.deepStrictEqual(PLANS.coal(32, chest, {oak_log: 191}).map((j) => j[0]), ['mine', 'deposit'], 'too few logs: mine');
  assert.deepStrictEqual(PLANS.coal(32, chest, {coal: 0}).map((j) => j[0]), ['mine', 'deposit']);
  assert.deepStrictEqual(PLANS.coal(32, chest).map((j) => j[0]), ['mine', 'deposit'], 'no stock: mine');
  assert.match(PLANS.iron_sword(1, chest, {...kitStock, cobblestone: 7}).blocked, /8 cobblestone/);
  assert.deepStrictEqual(PLANS.raw_iron(16, chest).map((j) => [j[0], j[1].block || j[1].only]), [['mine', 'iron_ore'], ['deposit', 'raw_iron']]);
  // gear: pickaxe, sword, then the cheapest armour; never what is already held or worn
  const {gearPlan, ingotsWanted} = require('../gear');
  assert.deepStrictEqual(gearPlan(0, []), []);
  assert.deepStrictEqual(gearPlan(3, []), ['iron_pickaxe']);
  assert.deepStrictEqual(gearPlan(2, []), ['iron_sword']);
  assert.deepStrictEqual(gearPlan(9, ['stone_pickaxe']), ['iron_pickaxe', 'iron_sword', 'shield'], 'a shield right after the sword');
  assert.deepStrictEqual(gearPlan(30, ['diamond_pickaxe', 'iron_sword', 'iron_boots']), ['shield', 'iron_helmet', 'iron_leggings', 'iron_chestplate']);
  assert.deepStrictEqual(gearPlan(30, ['netherite_sword', 'leather_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'iron_pickaxe', 'shield']), []);
  assert.deepStrictEqual(gearPlan(8, ['iron_pickaxe', 'iron_sword']), ['shield', 'iron_boots']);
  assert.strictEqual(ingotsWanted([]), 30);
  assert.strictEqual(ingotsWanted(['iron_pickaxe', 'iron_sword', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']), 1, 'the shield');
  assert.strictEqual(ingotsWanted(['iron_pickaxe', 'iron_sword', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'shield']), 0);
  // chain arguments pass the real validators (the bots would refuse them otherwise)
  const {VALIDATE: V} = require('../bots');
  for (const [type, args] of [...PLANS.logs(40, chest), ...PLANS.cobblestone(64, chest), ...PLANS.coal(8, chest), ...PLANS.torch(16, chest, {coal: 9, oak_log: 3}), ...PLANS.stone_pickaxe(3, chest, {cobblestone: 9, oak_log: 3}), ...PLANS.raw_iron(16, chest), ...PLANS.iron_pickaxe(2, chest, kitStock), ...PLANS.iron_sword(1, chest, kitStock), ['stock', chest], ['goto', chest]]) assert.doesNotThrow(() => V[type](args), type);
  assert.throws(() => V.deposit({...chest, only: 'Bad Name'}));
  assert.deepStrictEqual(V.deposit(chest), chest); // plain deposits are unchanged
}
{ // setWant: persisted next to `enabled`, survives a new Keeper, bounded, old files keep working
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const {Keeper} = require('../keeper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-'));
  const file = path.join(dir, 'keeper.json'), chest = {x: 1, y: 2, z: 3};
  const mk = () => new Keeper({runners: new Map(), world: new WorldModel({now: () => 0}), chest, quotas: [['logs', 64], ['coal', 32]], file});
  const k = mk();
  k.setWant('logs', 200);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {enabled: false, wants: {logs: 200, coal: 32}});
  assert.deepStrictEqual(mk().state().quotas.map((q) => [q.item, q.want]), [['logs', 200], ['coal', 32]]);
  k.setWant('coal', 0); k.setWant('coal', 4096);
  for (const [item, n] of [['gold', 5], ['logs', -1], ['logs', 4097], ['logs', 1.5], ['logs', NaN]]) assert.throws(() => k.setWant(item, n), item + n);
  assert.strictEqual(k.state().quotas[1].want, 4096, 'a refused value changes nothing');
  k.setEnabled(true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).wants, {logs: 200, coal: 4096}, 'toggling keeps the quotas');
  fs.writeFileSync(file, JSON.stringify({enabled: true})); // the old format
  const old = mk();
  assert.strictEqual(old.enabled, true); assert.deepStrictEqual(old.state().quotas.map((q) => q.want), [64, 32]);
  fs.rmSync(dir, {recursive: true});
}
