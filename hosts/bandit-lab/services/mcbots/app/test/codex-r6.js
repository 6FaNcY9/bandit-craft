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
  { // R6-6: Stop reaches the plan as its own signal, not as a clean finish
    const {stoppedSince} = require('../plan');
    assert.strictEqual(stoppedSince({stoppedAgoS: 5}, 1000, 20000), true);
    assert.strictEqual(stoppedSince({stoppedAgoS: 50}, 1000, 20000), false, 'a stop before the chain was given');
    assert.strictEqual(stoppedSince({stoppedAgoS: null}, 1000, 20000), false);
    const r = new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: null, onEvent: () => {}});
    assert.strictEqual(r.snapshot().stoppedAgoS, null);
    r.enqueue('stop');
    assert.ok(r.snapshot().stoppedAgoS <= 1);
    const {Plan} = require('../plan');
    const {IDLE_MS} = require('../keeper');
    let now = 1e6;
    const snap = (o = {}) => ({online: true, dead: false, job: null, queue: [], inventory: [], lastError: '', lastErrorAgoS: null, ...o});
    const bot = {name: 'bot11', sent: [], working: false, stopped: null, snapshot() { return snap({job: this.working ? {type: 'excavate', runningS: 5} : null, stoppedAgoS: this.stopped === null ? null : Math.round((now - this.stopped) / 1000)}); }, enqueue(type, args) { this.sent.push(type); this.working = true; }};
    const objectives = [{id: 'room', label: 'room', needs: [], roles: [{count: 1, jobs: [['excavate', {}]]}]}];
    const plan = new Plan({runners: new Map([['bot11', bot]]), world: new WorldModel({now: () => now}), objectives, roster: ['bot11'], chest: {x: 1, y: 2, z: 3}, now: () => now});
    plan.setEnabled(true);
    plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(bot.sent.length, 1);
    now += 6000; plan.tick(); // seen busy
    bot.working = false; bot.stopped = now; now += 6000; // Stop: idle again, no error
    plan.tick();
    assert.strictEqual(plan.completed.has('room'), false, 'a stopped chain does not close the objective');
    assert.strictEqual([...plan.results.values()].length, 0);
    now += IDLE_MS; plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(bot.sent.length, 2, 'the slot is open again: the next idle bot gets the chain');
  }
  { // owner request: the plan stays on across restarts
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const {Plan} = require('../plan');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-planon-')), 'plan.json');
    const mk = () => new Plan({runners: new Map(), world: new WorldModel(), objectives: [{id: 'a', label: 'a', needs: [], roles: []}], roster: [], chest: null, file});
    const p = mk();
    assert.strictEqual(p.enabled, false);
    p.setEnabled(true);
    assert.strictEqual(mk().enabled, true, 'restored on start');
    p.setEnabled(false);
    assert.strictEqual(mk().enabled, false, 'Stop all is remembered too');
  }
  { // 2026-10-12: two shaft strips "finished" 1-3 s after a deploy, 20-30 layers short, and the parked shaft stalled the plan
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const {Plan, MIN_HOLD_MS} = require('../plan');
    const {IDLE_MS} = require('../keeper');
    const HOUR = 3600 * 1000;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-planrestart-')), 'plan.json');
    let now = 1e6, bottom = 'stone';
    const snap = (o = {}) => ({online: true, dead: false, job: null, queue: [], inventory: [], lastError: '', lastErrorAgoS: null, ...o});
    const bot = {name: 'bot11', sent: [], working: false, online: true, snapshot() { return snap({online: this.online, job: this.working ? {type: 'shaft', runningS: 5} : null}); }, enqueue(type) { this.sent.push(type); this.working = true; }};
    const objectives = [
      {id: 'shaft', label: 'shaft', needs: [], onBlocked: 'park', roles: [{count: 1, jobs: [['shaft', {}]]}], done: () => bottom === 'air'},
      {id: 'later', label: 'later', needs: ['shaft'], onBlocked: 'skip', roles: [{count: 1, jobs: [['goto', {}]]}]},
    ];
    const mk = () => new Plan({runners: new Map([['bot11', bot]]), world: new WorldModel({now: () => now}), objectives, roster: ['bot11'], chest: {x: 1, y: 2, z: 3}, file, now: () => now});
    let plan = mk();
    plan.setEnabled(true);
    plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(bot.sent.length, 1);
    now += 6000; plan.tick(); // seen busy
    // the deploy: a new hub, and the bot is online a moment before its job is resumed
    plan = mk();
    bot.working = false;
    bot.online = false;
    plan.tick(); // the new hub; the bot still logs in
    bot.online = true;
    now += MIN_HOLD_MS; plan.tick();
    bot.working = true;
    now += 1000; plan.tick();
    assert.strictEqual(plan.results.size, 0, 'a bot idle for a moment after a restart has not finished its chain');
    // the chain ends without an error, but the shaft bottom is still stone: the strip goes out again, as a failure
    bot.working = false;
    now += IDLE_MS; plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(plan.completed.has('shaft'), false, 'every slot says done, the world says no');
    assert.strictEqual(plan.fails.get('shaft'), 1);
    now += 11 * 60 * 1000; plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(bot.sent.length, 2, 'the strip is dug again after the wait');
    bottom = 'air';
    now += 6000; plan.tick();
    assert.strictEqual(plan.completed.has('shaft'), true, 'the world says done');
    // a parked step is tried again after an hour instead of stalling the plan for good
    const file2 = path.join(path.dirname(file), 'plan2.json');
    bottom = 'stone';
    const p2 = new Plan({runners: new Map([['bot11', bot]]), world: new WorldModel({now: () => now}), objectives, roster: ['bot11'], chest: {x: 1, y: 2, z: 3}, file: file2, now: () => now});
    p2.setEnabled(true);
    p2.fails.set('shaft', 3);
    p2.tick();
    assert.deepStrictEqual(p2.state().parked.map((o) => o.id), ['shaft']);
    now += HOUR - 1000; p2.tick();
    assert.strictEqual(p2.blocked.has('shaft'), true, 'parked within the hour');
    now += 2000; p2.tick();
    assert.deepStrictEqual([p2.blocked.has('shaft'), p2.fails.get('shaft') ?? 0, p2.state().current?.id], [false, 0, 'shaft'], 'tried again after the hour');
    // a block saved before its time was kept (the shaft of 2026-10-11) is tried again at once
    fs.writeFileSync(file2, JSON.stringify({enabled: true, completed: [], skipped: [], fails: {shaft: 3}, blocked: {shaft: '3 chains failed'}, assigned: {}, results: {}}));
    const p3 = new Plan({runners: new Map([['bot11', bot]]), world: new WorldModel({now: () => now}), objectives, roster: ['bot11'], chest: {x: 1, y: 2, z: 3}, file: file2, now: () => now});
    p3.tick();
    assert.strictEqual(p3.blocked.has('shaft'), false);
    // a step skipped by its block (nothing needs it) stays skipped
    const p4 = new Plan({runners: new Map([['bot11', bot]]), world: new WorldModel({now: () => now}), objectives: objectives.slice(1).map((o) => ({...o, needs: []})), roster: ['bot11'], chest: {x: 1, y: 2, z: 3}, now: () => now});
    p4.setEnabled(true);
    p4.fails.set('later', 3);
    p4.tick(); now += 2 * HOUR; p4.tick();
    assert.strictEqual(p4.skipped.has('later'), true, 'only parked steps come back');
  }
  { // 2026-10-12: strip 3 kept failing while strips 1 and 2 stood "done" 30 layers short; once every strip has ended, the done ones go out again too
    const {Plan} = require('../plan');
    const {IDLE_MS} = require('../keeper');
    let now = 1e6;
    const snap = (o = {}) => ({online: true, dead: false, job: null, queue: [], inventory: [], lastError: '', lastErrorAgoS: null, ...o});
    const fake = (name) => ({name, sent: [], working: false, err: '', snapshot() { return snap({job: this.working ? {type: 'shaft', runningS: 5} : null, lastError: this.err, lastErrorAgoS: this.err ? 1 : null}); }, enqueue(type) { this.sent.push(type); this.working = true; }});
    const bots = ['bot11', 'bot12'].map(fake);
    const objectives = [{id: 'shaft', label: 'shaft', needs: [], onBlocked: 'park', roles: [{count: 2, jobs: [['shaft', {}]]}], done: () => false}];
    const plan = new Plan({runners: new Map(bots.map((b) => [b.name, b])), world: new WorldModel({now: () => now}), objectives, roster: ['bot11', 'bot12'], chest: {x: 1, y: 2, z: 3}, now: () => now});
    plan.setEnabled(true);
    plan.tick(); now += IDLE_MS; plan.tick();
    now += 6000; plan.tick(); // both seen busy
    bots[0].working = false; // strip 1 "finishes"
    bots[1].working = false;
    bots[1].err = 'the shaft reached y -54 but 2 blocks were left'; // strip 3 fails
    now += 6000; plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(plan.results.size, 0, 'the finished strip is open again: the shaft is not done');
    assert.strictEqual(plan.fails.get('shaft'), 2, 'the failure and the recheck');
    bots[1].err = '';
    now += 11 * 60 * 1000; plan.tick(); now += IDLE_MS; plan.tick();
    assert.deepStrictEqual(bots.map((b) => b.sent.length), [2, 2], 'both strips are dug again');
  }
  { // Codex R8-1: a bot waiting for its slot's retry is not put on the farm: its farm job would hold that strip for good
    const {Plan} = require('../plan');
    const {IDLE_MS} = require('../keeper');
    let now = 1e6;
    const snap = (o = {}) => ({online: true, dead: false, job: null, queue: [], inventory: [], lastError: '', lastErrorAgoS: null, ...o});
    const fake = (name) => ({name, sent: [], job: null, err: '', snapshot() { return snap({job: this.job, lastError: this.err, lastErrorAgoS: this.err ? 1 : null}); }, enqueue(type) { this.sent.push(type); this.job = {type, runningS: 0}; }});
    const [a1, b2, c3] = ['a1', 'b2', 'c3'].map(fake);
    const running = (ctx, type, s) => [...ctx.snaps.values()].some((x) => x?.job?.type === type && x.job.runningS >= s);
    const objectives = [
      {id: 'farm', label: 'farm', needs: [], onBlocked: 'skip', standing: 'wheatfarm', roles: [{count: 1, jobs: [['wheatfarm', {}]]}], done: (ctx) => running(ctx, 'wheatfarm', 120)},
      {id: 'shaft', label: 'shaft', needs: ['farm'], onBlocked: 'park', roles: [{count: 2, jobs: [['shaft', {}]]}], done: () => false},
    ];
    const plan = new Plan({runners: new Map([a1, b2, c3].map((b) => [b.name, b])), world: new WorldModel({now: () => now}), objectives, roster: ['a1', 'b2', 'c3'], chest: {x: 1, y: 2, z: 3}, now: () => now});
    plan.setEnabled(true);
    plan.tick(); now += IDLE_MS; plan.tick();
    a1.job.runningS = 200;
    now += 6000; plan.tick(); now += IDLE_MS; plan.tick();
    assert.deepStrictEqual([a1, b2, c3].map((b) => b.sent), [['wheatfarm'], ['shaft'], ['shaft']]);
    now += 6000; plan.tick(); // the strips are seen busy
    c3.job = null; // c3's strip fails and waits for its retry
    c3.err = 'the shaft reached y -54 but 2 blocks were left';
    a1.job = {type: 'mine', runningS: 5}; // the owner took the farmer for something else
    now += 6000; plan.tick(); now += IDLE_MS; plan.tick(); now += IDLE_MS; plan.tick();
    assert.ok(!c3.sent.includes('wheatfarm'), 'c3 holds a strip waiting for its retry');
    c3.err = '';
    now += 11 * 60 * 1000; plan.tick(); now += IDLE_MS; plan.tick();
    assert.deepStrictEqual(c3.sent, ['shaft', 'shaft'], 'c3 digs its strip again after the wait');
  }
  { // 2026-10-12: the wheat farm counted as done after 2 min, then nobody farmed and the chest had no bread for days
    const {Plan} = require('../plan');
    const {IDLE_MS} = require('../keeper');
    let now = 1e6;
    const snap = (o = {}) => ({online: true, dead: false, job: null, queue: [], inventory: [], lastError: '', lastErrorAgoS: null, ...o});
    const fake = (name) => ({name, sent: [], job: null, snapshot() { return snap({job: this.job}); }, enqueue(type) { this.sent.push(type); this.job = {type, runningS: 0}; }});
    const bots = ['bot11', 'bot12'].map(fake);
    const running = (ctx, type, s) => [...ctx.snaps.values()].some((x) => x?.job?.type === type && x.job.runningS >= s);
    const objectives = [
      {id: 'farm', label: 'farm', needs: [], onBlocked: 'skip', standing: 'wheatfarm', roles: [{count: 1, jobs: [['wheatfarm', {}]]}], done: (ctx) => running(ctx, 'wheatfarm', 120)},
      {id: 'dig', label: 'dig', needs: ['farm'], onBlocked: 'park', roles: [{count: 1, jobs: [['shaft', {}]]}], done: () => false},
    ];
    const plan = new Plan({runners: new Map(bots.map((b) => [b.name, b])), world: new WorldModel({now: () => now}), objectives, roster: ['bot11', 'bot12'], chest: {x: 1, y: 2, z: 3}, now: () => now});
    plan.setEnabled(true);
    plan.tick(); now += IDLE_MS; plan.tick();
    assert.deepStrictEqual(bots.map((b) => b.sent), [['wheatfarm'], []]);
    bots[0].job.runningS = 200;
    now += 6000; plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(plan.completed.has('farm'), true);
    assert.deepStrictEqual(bots.map((b) => b.sent), [['wheatfarm'], ['shaft']], 'the next objective runs beside the farm');
    now += 3600 * 1000; plan.tick();
    assert.strictEqual(bots[0].sent.length, 1, 'a running farm is left alone');
    bots[0].job = null; // the farmer died, or a deploy dropped its job
    plan.tick();
    assert.strictEqual(bots[0].sent.length, 1, 'idle for IDLE_MS first');
    now += IDLE_MS; plan.tick();
    assert.deepStrictEqual(bots[0].sent, ['wheatfarm', 'wheatfarm'], 'an idle roster bot farms again');
    now += 1000; plan.tick();
    assert.strictEqual(bots.flatMap((b) => b.sent).filter((x) => x === 'wheatfarm').length, 2, 'once, not on every tick');
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
