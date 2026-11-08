'use strict';
const APP = require('node:path').join(__dirname, '..');
const assert = require('node:assert');
const {VALIDATE} = require('../bots');
const {BotRunner} = require('../bots');
const {WorldModel} = require('../world');
// ---- Codex round 6 ----
(async () => {
  const {WorldModel} = require('../world');
  const {Vec3} = require('vec3');
  { // R6-1: another bot's retained stair steps are reserved wherever a walk digs; own strip bounds the dig
    const w = new WorldModel({now: () => 0});
    w.claim('bot1', 'shaft:0,60,0');
    w.claim('bot1', 'shaftend:2,58,2');
    assert.strictEqual(w.stepHeldByOther('bot2', 0, 60, 0), true, 'layer 0 keeps ring cell 0');
    assert.strictEqual(w.stepHeldByOther('bot2', 1, 59, 0), true, 'layer 1 keeps ring cell 1');
    assert.strictEqual(w.stepHeldByOther('bot2', 1, 60, 0), false, 'other cells of the strip are not steps');
    assert.strictEqual(w.stepHeldByOther('bot2', 1, 57, 0), false, 'below the shaft');
    assert.strictEqual(w.stepHeldByOther('bot1', 0, 60, 0), false, 'own steps are the job\'s keepCells');
    w.release('bot1', 'shaft:0,60,0');
    assert.strictEqual(w.stepHeldByOther('bot2', 0, 60, 0), false, 'released with the job');
    const runner = new BotRunner('bot2', {host: 'x', port: 1, log: () => {}, world: w, onEvent: () => {}});
    w.claim('bot1', 'shaft:0,60,0');
    assert.strictEqual(runner.reserved(0, 60, 0), true, 'BotRunner.reserved consults the shared claims');
    assert.strictEqual(runner.reserved(5, 60, 0), false);
  }
  { // R6-4: stock observations belong to their chest
    const w = new WorldModel({now: () => 0});
    const base = {x: -271, y: 66, z: -214}, supply = {x: -37, y: 65, z: -200};
    w.noteStock('bot1', {coal: 0}, 3, base);
    w.noteStock('bot2', {coal: 40}, 3, supply);
    assert.strictEqual(w.stockAt(base).items.coal, 0, 'the supply chest does not stand for the base chest');
    assert.strictEqual(w.stockAt(supply).items.coal, 40);
    assert.strictEqual(w.stockAt({x: 1, y: 2, z: 3}), null, 'a chest nobody counted');
    assert.deepStrictEqual(w.snapshot().stock.chest, supply, 'the dashboard still shows the latest');
  }
  { // R6-5: a restart keeps the whole chain behind the first long job
    const {tailFrom} = require('../bots');
    const chain = ['withdraw', 'excavate', 'withdraw', 'craft', 'place', 'place'].map((type) => ({type}));
    assert.deepStrictEqual(tailFrom(chain).map((j) => j.type), ['excavate', 'withdraw', 'craft', 'place', 'place']);
    assert.deepStrictEqual(tailFrom([{type: 'craft'}, {type: 'say'}]), [], 'no long job: nothing to bring back');
  }
  { // R6-6: Stop is its own signal in the snapshot (the job board reads it)
    const r = new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: null, onEvent: () => {}});
    assert.strictEqual(r.snapshot().stoppedAgoS, null);
    r.enqueue('stop');
    assert.ok(r.snapshot().stoppedAgoS <= 1);
  }
  { // R6-2 + R6-3: smelting honours Stop after every await, and one bot at a time uses a furnace
    const {makeCrafting} = require('../crafting');
    const {Cancelled} = require('../bots');
    const guard = (job) => { if (job.cancelled) throw new Cancelled('stopped'); };
    const crafting = makeCrafting({goNear: async () => {}, guard});
    const world = new WorldModel();
    const key = 'furnace:0,64,0';
    const mkFurnace = (log) => ({log, putFuel: async () => log.push('fuel'), putInput: async () => log.push('input'), outputItem: () => ({}), takeOutput: async () => ({count: 3}), inputItem: () => null, fuelItem: () => null, takeInput: async () => log.push('takeInput'), takeFuel: async () => log.push('takeFuel'), close() { log.push('close'); }});
    const mkRunner = (name, furnace, onOpen = () => {}) => ({name, world, inventoryBusy: 0, protectedAreas: [], bot: {
      inventory: {items: () => [{name: 'raw_iron', count: 3}, {name: 'coal', count: 2}]},
      registry: {blocksByName: {furnace: {id: 1}}, itemsByName: {coal: {id: 10}, raw_iron: {id: 11}}},
      findBlock: () => ({position: new Vec3(0, 64, 0)}),
      entity: {position: new Vec3(0.5, 64, 0.5)},
      blockAt: (p) => ({position: p, name: 'furnace'}),
      openFurnace: async () => { onOpen(); return furnace; },
    }});
    // a Stop while the furnace opens: no fuel, no input, window closed, reservation released
    let log = [];
    const job = {cancelled: false, t: {}};
    let r = mkRunner('bot1', mkFurnace(log), () => { job.cancelled = true; });
    await assert.rejects(crafting.smelt(r, job, 'raw_iron', 3), Cancelled);
    assert.deepStrictEqual(log, ['close']);
    assert.strictEqual(r.inventoryBusy, 0);
    assert.strictEqual(world.claimedByOther('bot2', key), false, 'furnace released');
    // a Stop between fuel and input
    log = [];
    const job2 = {cancelled: false, t: {}};
    const f2 = mkFurnace(log);
    f2.putFuel = async () => { log.push('fuel'); job2.cancelled = true; };
    await assert.rejects(crafting.smelt(mkRunner('bot1', f2), job2, 'raw_iron', 3), Cancelled);
    assert.deepStrictEqual(log, ['fuel', 'close'], 'the input is not moved after the Stop');
    // a furnace another bot holds is not opened; a Stop ends the wait
    world.claim('bot2', key);
    log = [];
    const job3 = {cancelled: true, t: {}};
    r = mkRunner('bot1', mkFurnace(log), () => log.push('opened'));
    await assert.rejects(crafting.smelt(r, job3, 'raw_iron', 3), Cancelled);
    assert.deepStrictEqual(log, [], 'never opened');
    world.release('bot2', key);
    // a clean smelt holds the furnace for others while it runs and frees it after
    log = [];
    let heldWhile = null;
    r = mkRunner('bot1', mkFurnace(log), () => { heldWhile = world.claim('bot2', key); });
    await crafting.smelt(r, {cancelled: false, t: {}}, 'raw_iron', 3);
    assert.strictEqual(heldWhile, false, 'bot2 is refused while bot1 smelts');
    assert.deepStrictEqual(log, ['fuel', 'input', 'close']);
    assert.strictEqual(world.claimedByOther('bot2', key), false);
    // a full inventory: the smelt fails clearly before it puts anything into the furnace
    log = [];
    r = mkRunner('bot1', mkFurnace(log));
    r.bot.inventory = {items: () => [{name: 'raw_iron', count: 5}, {name: 'coal', count: 2}], emptySlotCount: () => 0};
    await assert.rejects(crafting.smelt(r, {cancelled: false, t: {}}, 'raw_iron', 3), /inventory is full: no room for the smelted raw_iron/);
    assert.deepStrictEqual(log, ['close']);
    // a furnace left with another input refuses ours ("destination full"): that comes out first; the same fuel stays
    log = [];
    const f5 = mkFurnace(log);
    f5.inputItem = () => ({name: 'cobblestone'});
    f5.fuelItem = () => ({name: 'coal'});
    await crafting.smelt(mkRunner('bot1', f5), {cancelled: false, t: {}}, 'raw_iron', 3);
    assert.deepStrictEqual(log, ['takeInput', 'fuel', 'input', 'close']);
    log = [];
    const f6 = mkFurnace(log);
    f6.fuelItem = () => ({name: 'oak_planks'});
    await crafting.smelt(mkRunner('bot1', f6), {cancelled: false, t: {}}, 'raw_iron', 3);
    assert.deepStrictEqual(log, ['takeFuel', 'fuel', 'input', 'close'], 'another fuel comes out too');
    log = [];
    const f7 = mkFurnace(log);
    f7.inputItem = () => ({name: 'raw_iron', count: 62});
    f7.fuelItem = () => ({name: 'coal', count: 64});
    await crafting.smelt(mkRunner('bot1', f7), {cancelled: false, t: {}}, 'raw_iron', 3);
    assert.deepStrictEqual(log, ['takeInput', 'takeFuel', 'fuel', 'input', 'close'], 'the same kind comes out when it would pass 64');
    log = [];
    const f8 = mkFurnace(log);
    f8.inputItem = () => ({name: 'raw_iron', count: 2});
    f8.fuelItem = () => ({name: 'coal', count: 5});
    await crafting.smelt(mkRunner('bot1', f8), {cancelled: false, t: {}}, 'raw_iron', 3);
    assert.deepStrictEqual(log, ['fuel', 'input', 'close'], 'what still fits stays');
  }
  { // R6-7: the 3D panel's level order is one the server accepts, or says why not
    const html = require('node:fs').readFileSync(require('node:path').join(APP, 'public/legacy.html'), 'utf8');
    const body = html.slice(html.indexOf('function boxJob('), html.indexOf('const VJOBS'));
    const boxJob = new Function(`${body}; return boxJob;`)();
    const box = (y1, y2) => ({x1: 0, z1: 0, x2: 8, z2: 8, y1, y2});
    const [type, args] = boxJob('level', box(-50, 60), {length: 32, branch: 8});
    assert.doesNotThrow(() => VALIDATE[type](args));
    assert.throws(() => boxJob('level', box(-59, 60), {}), /at least -58/);
    assert.throws(() => boxJob('level', box(10, 10), {}), /at least 2 high/);
    assert.doesNotThrow(() => VALIDATE.level(boxJob('level', box(-58, -57), {length: 32, branch: 8})[1]));
  }
})();
{ // an unreachable block waits 5 min, then twice as long each time, at most 2 h (2026-10-20)
  const {backoff} = require('../bots');
  assert.deepStrictEqual([1, 2, 3, 5, 6, 9].map((n) => backoff(n) / 60000), [5, 10, 20, 80, 120, 120]);
}
{ // the wait for an unreachable block is shared: a second bot sees it, it doubles, and it is forgotten after 4 h
  let t = 0;
  const w = new WorldModel({now: () => t}), key = 'reach:overworld:-208,44,-169';
  assert.strictEqual(w.learned(key), null);
  w.learn(key, {ok: false});
  assert.strictEqual(w.learned(key).blocked, true);
  t = 5 * 60000 + 1;
  assert.strictEqual(w.learned(key).blocked, false);
  w.learn(key, {ok: false}); // the second bot's failed walk: 10 min now
  t += 9 * 60000;
  assert.strictEqual(w.learned(key).blocked, true);
  t += 3 * 3600000 + 55 * 60000; // past 4 h since the last failure
  assert.strictEqual(w.learned(key).blocked, false);
  w.learn(key, {ok: false}); // the old streak is gone: 5 min again
  assert.strictEqual(w.learned(key).until - t, 300000);
  assert.throws(() => w.learn('reach:overworld:x,y,z', {ok: false}), /invalid experience/);
}
