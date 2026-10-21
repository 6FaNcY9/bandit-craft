'use strict';
const assert = require('node:assert');
const {loadConfig} = require('../config');
const {WorldModel} = require('../world');
// ---- plan (R7): objectives, role assignment, advance, keeper borrowing, restart ----
{
  const {Plan, assignRoles, objectiveDone, nextIndex, slotsOf, strip, MIN_HOLD_MS, MAX_FAILS} = require('../plan');
  const {OBJECTIVES, BASE, bedSlot} = require('../plan-config');
  const {Keeper, PLANS, IDLE_MS} = require('../keeper');
  const {EventLog} = require('../events');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const snap = (o = {}) => ({online: true, dead: false, job: null, queue: [], inventory: [], lastError: '', lastErrorAgoS: null, ...o});
  const busy = {type: 'shaft', label: 'shaft', runningS: 30};
  const ids = OBJECTIVES.map((o) => o.id);

  // the shipped objectives: ordered needs, jobs the keeper/validators accept, disjoint shaft strips
  assert.strictEqual(new Set(ids).size, ids.length);
  OBJECTIVES.forEach((o, i) => {
    assert.ok(o.needs.every((n) => ids.indexOf(n) >= 0 && ids.indexOf(n) < i), `${o.id}: needs point at earlier objectives`);
    assert.ok(!!o.keeper !== !!o.roles, `${o.id}: keeper-driven or direct, never both`);
    assert.ok(['park', 'skip'].includes(o.onBlocked));
    for (const [item] of o.keeper || []) assert.ok(PLANS[item], `${o.id}: the keeper can make ${item}`);
  });
  {
    const {VALIDATE: V} = require('../bots');
    const names = ['bot11', 'bot12', 'bot13'];
    for (const o of OBJECTIVES.filter((x) => x.roles)) {
      const got = assignRoles(o, new Map(names.map((n) => [n, snap()])), new Map(), 1e9, 0);
      assert.ok(got.size > 0, o.id);
      for (const chain of got.values()) for (const [type, args] of chain) assert.doesNotThrow(() => V[type](args), `${o.id}: ${type} ${JSON.stringify(args)}`);
    }
    const shaft = OBJECTIVES.find((o) => o.id === 'shaft-to-ore');
    const strips = slotsOf(shaft, names).map((s) => strip(s.role.jobs[0][1], 'x', s.i, s.n));
    assert.strictEqual(strips.length, 3);
    assert.deepStrictEqual(strips.map((b) => [b.x1, b.x2]), [[-291, -286], [-285, -281], [-280, -276]]);
    assert.ok(strips.every((b) => b.z1 === BASE.shaft.z1 && b.z2 === BASE.shaft.z2));
    assert.deepStrictEqual([bedSlot('bot2', names), bedSlot('bot12', names), bedSlot('bot13', names)], [1, 8, 9]);
  }

  // objectiveDone, per kind
  const kobj = {id: 'k', keeper: [['logs', 64], ['coal', 8]]};
  const dctx = (o = {}) => ({stock: null, snaps: new Map([['a', snap()], ['b', snap()]]), results: new Map(), completed: new Set(), skipped: new Set(), blocked: new Map(), ...o});
  assert.strictEqual(objectiveDone(kobj, dctx()), false, 'no numbers yet');
  assert.strictEqual(objectiveDone(kobj, dctx({stock: {items: {oak_log: 40, birch_log: 24, coal: 7}}})), false);
  assert.strictEqual(objectiveDone(kobj, dctx({stock: {items: {oak_log: 40, birch_log: 24, coal: 8}}})), true, 'logs count every kind');
  const robj = {id: 'r', roles: [{each: true, jobs: [['homebed', {}]]}]};
  assert.strictEqual(objectiveDone(robj, dctx()), false);
  assert.strictEqual(objectiveDone(robj, dctx({results: new Map([['r#0:a', {ok: true}]])})), false, 'one of two slots');
  assert.strictEqual(objectiveDone(robj, dctx({results: new Map([['r#0:a', {ok: true}], ['r#0:b', {ok: true}]])})), true);
  assert.strictEqual(objectiveDone({...robj, done: () => true}, dctx()), true, 'its own predicate');
  const inv = dctx({snaps: new Map([['a', snap({inventory: ['cobblestone x4', 'iron_pickaxe x1']})]])});
  assert.strictEqual(objectiveDone(OBJECTIVES.find((o) => o.id === 'iron-tools'), inv), true);
  assert.strictEqual(objectiveDone(OBJECTIVES.find((o) => o.id === 'iron-tools'), dctx()), false);
  const air = (name) => dctx({blockAt: () => name});
  assert.strictEqual(objectiveDone(OBJECTIVES.find((o) => o.id === 'shaft-to-ore'), air('cave_air')), true);
  assert.strictEqual(objectiveDone(OBJECTIVES.find((o) => o.id === 'shaft-to-ore'), air('stone')), false);
  assert.strictEqual(objectiveDone(OBJECTIVES.find((o) => o.id === 'shaft-to-ore'), air(null)), false, 'chunk not loaded');
  { // Codex R8-2: done() is authoritative now, so it may only ask for what the chain builds (two of the eight chests)
    const seeded = new Set(BASE.roomChests.slice(0, 2).map((c) => `${c.x},${c.y},${c.z}`));
    const room = OBJECTIVES.find((o) => o.id === 'storage-room');
    assert.strictEqual(objectiveDone(room, dctx({blockAt: (x, y, z) => (seeded.has(`${x},${y},${z}`) ? 'chest' : 'air')})), true, 'the two seeded chests');
    assert.strictEqual(objectiveDone(room, dctx({blockAt: () => 'air'})), false);
  }
  const farm = (runningS) => dctx({snaps: new Map([['a', snap({job: {type: 'treefarm', runningS}})]])});
  assert.strictEqual(objectiveDone(OBJECTIVES.find((o) => o.id === 'tree-farm'), farm(200)), true);
  assert.strictEqual(objectiveDone(OBJECTIVES.find((o) => o.id === 'tree-farm'), farm(10)), false);

  // assignRoles: 3 idle, 1 dead, 1 tasked
  {
    const shaft = {id: 'sh', roles: [{count: 3, split: 'x', jobs: [['shaft', {x1: 0, z1: 0, x2: 15, z2: 15, top: 60, bottom: 0}]]}]};
    const snaps = new Map([['a', snap()], ['b', snap()], ['c', snap()], ['d', snap({dead: true})], ['e', snap({job: busy})], ['f', snap({queue: ['mine']})]]);
    const assigned = new Map();
    const t0 = 1e6;
    const got = assignRoles(shaft, snaps, assigned, t0);
    assert.deepStrictEqual([...got.keys()], ['a', 'b', 'c'], 'idle bots only, in name order; dead, busy and queued ones untouched');
    const boxes = [...got.values()].map((c) => [c[0][1].x1, c[0][1].x2]);
    assert.deepStrictEqual(boxes, [[0, 5], [6, 10], [11, 15]], 'disjoint strips that cover the box');
    assert.ok([...got.values()].every((c) => c[0][0] === 'shaft' && c[0][1].top === 60));
    for (const b of ['a', 'b', 'c']) snaps.set(b, snap({job: busy}));
    assert.strictEqual(assignRoles(shaft, snaps, assigned, t0 + 5000).size, 0, 'nothing is replaced while the bots work');
    // c dies: its slot stays taken for the hold time, then another idle bot gets the same strip
    snaps.set('c', snap({dead: true}));
    snaps.set('g', snap());
    assert.strictEqual(assignRoles(shaft, snaps, assigned, t0 + MIN_HOLD_MS - 1).size, 0, 'minHoldMs');
    const refill = assignRoles(shaft, snaps, assigned, t0 + MIN_HOLD_MS);
    assert.deepStrictEqual([...refill.keys()], ['g']);
    assert.deepStrictEqual([refill.get('g')[0][1].x1, refill.get('g')[0][1].x2], [11, 15]);
    // an offline bot frees its slot the same way; a bot that is not idle for IDLE_MS yet is not taken
    snaps.set('b', snap({online: false}));
    snaps.set('h', snap());
    const idleSince = new Map([['h', t0 + MIN_HOLD_MS * 3]]);
    assert.strictEqual(assignRoles(shaft, snaps, assigned, t0 + MIN_HOLD_MS * 3 + 1, MIN_HOLD_MS, {idleSince}).size, 0);
    assert.deepStrictEqual([...assignRoles(shaft, snaps, assigned, t0 + MIN_HOLD_MS * 3 + IDLE_MS, MIN_HOLD_MS, {idleSince}).keys()], ['h']);
    // a finished slot (done) is not given out again
    const fin = new Map([['0:0', {bot: 'a', at: 0, done: true}]]);
    assert.strictEqual(assignRoles({id: 'x', roles: [{count: 1, jobs: [['goto', {x: 1, y: 2, z: 3}]]}]}, new Map([['a', snap()]]), fin, 1e9).size, 0);
    // per-bot roles go to their own bot only, whatever the order
    const each = assignRoles(OBJECTIVES[0], new Map([['bot11', snap({job: busy})], ['bot12', snap()]]), new Map(), 1e9, 0);
    assert.deepStrictEqual([...each], [['bot12', [['homebed', {slot: 8}]]]]);
  }

  // nextIndex: done advances, a blocked step with a dependant parks, one without is skipped
  {
    const o = (id, needs = [], onBlocked = 'park') => ({id, needs, onBlocked, roles: [], done: (c) => c.completed.has(`never-${id}`) || c.finished?.has(id)});
    const list = [o('a'), o('b', ['a']), o('c', ['a']), o('d', ['b'], 'skip')];
    const ctx = (extra = {}) => ({snaps: new Map(), results: new Map(), completed: new Set(), skipped: new Set(), blocked: new Map(), ...extra});
    assert.deepStrictEqual(nextIndex(list, 0, ctx()).idx, 0);
    const adv = nextIndex(list, 0, ctx({finished: new Set(['a'])}));
    assert.deepStrictEqual([adv.idx, adv.done], [1, ['a']], 'a finished predicate advances');
    const parked = nextIndex(list, 0, ctx({completed: new Set(['a']), blocked: new Map([['b', 'no wood']])}));
    assert.deepStrictEqual([parked.idx, parked.parked, parked.skipped], [2, ['b'], []], 'b is needed by d: parked; c runs meanwhile');
    assert.match(parked.note, /b parked: no wood/);
    const noDep = nextIndex(list, 0, ctx({completed: new Set(['a', 'b', 'c']), blocked: new Map([['d', 'x']])}));
    assert.deepStrictEqual([noDep.idx, noDep.skipped, noDep.parked], [4, ['d'], []], 'blocked and nothing needs it: skipped, nothing left');
    const waiting = nextIndex(list, 0, ctx({blocked: new Map([['a', 'broken']])}));
    assert.deepStrictEqual([waiting.idx, waiting.parked], [4, ['a']], 'everything else needs a: the plan stalls, parked');
    // a parked step blocks an already-listed lone park without dependants: skipped, not parked
    assert.deepStrictEqual(nextIndex([o('z')], 0, ctx({blocked: new Map([['z', 'x']])})).skipped, ['z']);
    // closed steps before idx are not looked at again
    assert.strictEqual(nextIndex(list, 3, ctx({completed: new Set(['a', 'b'])})).idx, 3);
  }

  // the scheduler: roles, then the borrowed keeper, then done; restart safe
  {
    let now = 1e6;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-plan-'));
    const file = path.join(dir, 'plan.json');
    const fake = (name) => ({name, sent: [], working: false, online: true, snapshot() { return snap({online: this.online, job: this.working ? {type: 'homebed', runningS: 5} : null, lastError: this.err || '', lastErrorAgoS: this.err ? 1 : null}); }, enqueue(type, args) { this.sent.push([type, args]); this.working = true; }});
    const bots = ['bot11', 'bot12', 'bot13'].map(fake);
    const runners = new Map(bots.map((b) => [b.name, b]));
    const world = new WorldModel({now: () => now});
    const events = new EventLog();
    const chest = {x: 5, y: 6, z: 7};
    const keeperChest = {x: 1, y: 2, z: 3};
    const keeper = new Keeper({runners, world, chest: keeperChest, quotas: [['diamond', 1]], site: {x: 9, y: 9, z: 9}, now: () => now});
    const objectives = [
      {id: 'beds', label: 'beds', needs: [], onBlocked: 'park', roles: [{each: true, jobs: [['homebed', ({bot}) => ({slot: bot === 'bot11' ? 7 : 8})]]}]},
      {id: 'stock', label: 'stock', needs: [], onBlocked: 'park', keeper: [['logs', 10]]},
      {id: 'after', label: 'after', needs: ['stock'], onBlocked: 'skip', roles: [{count: 1, jobs: [['goto', {x: 1, y: 2, z: 3}]]}]},
    ];
    const mk = () => new Plan({runners, world, keeper, events, objectives, roster: ['bot11', 'bot12'], chest, file, now: () => now});
    let plan = mk();
    plan.tick();
    assert.ok(bots.every((b) => !b.sent.length), 'off by default: nothing is assigned');
    assert.strictEqual(plan.state().enabled, false);
    assert.throws(() => plan.skip('nope'), /no objective/);
    plan.setEnabled(true);
    plan.tick();
    assert.ok(bots.every((b) => !b.sent.length), 'idle bots are only taken after IDLE_MS');
    now += IDLE_MS;
    plan.tick();
    assert.deepStrictEqual(bots[0].sent, [['homebed', {slot: 7}]]);
    assert.deepStrictEqual(bots[1].sent, [['homebed', {slot: 8}]]);
    assert.deepStrictEqual(bots[2].sent, [], 'bot13 is not in the roster');
    assert.deepStrictEqual(plan.state().bots.map((b) => b.role), ['beds', 'beds']);
    assert.strictEqual(plan.state().current.id, 'beds');
    // bot11 finishes cleanly, bot12 fails: bot11's part is closed, bot12 retries later (not at once)
    now += 6000;
    plan.tick(); // both seen busy
    bots[0].working = false;
    bots[1].working = false;
    bots[1].err = 'homebed: no wool';
    now += 6000;
    plan.tick();
    now += IDLE_MS; // a chain is over once its bot has been idle this long
    plan.tick();
    assert.strictEqual(plan.state().objectives[0].pct, 50);
    assert.match(events.items.map((e) => e.text).join('\n'), /bot12 did not finish beds \(homebed: no wool\)/);
    const n = bots[1].sent.length;
    now += MIN_HOLD_MS; plan.tick(); now += 6000; plan.tick();
    assert.strictEqual(bots[1].sent.length, n, 'a failed slot waits before the next try');
    // it succeeds on the retry
    bots[1].err = '';
    now += 11 * 60 * 1000; plan.tick(); now += IDLE_MS; plan.tick();
    assert.strictEqual(bots[1].sent.length, n + 1, 'retried after the wait');
    now += 6000; plan.tick(); bots[1].working = false; now += 6000; plan.tick(); now += IDLE_MS; plan.tick();
    // the keeper is borrowed for the stock objective: plan quotas, plan chest, roster only, no site
    assert.strictEqual(plan.state().current.id, 'stock');
    assert.deepStrictEqual([keeper.enabled, keeper.chest, keeper.quotas, keeper.site, [...keeper.runners.keys()]], [true, chest, [['logs', 10]], null, ['bot11', 'bot12']]);
    keeper.tick(); now += IDLE_MS; plan.tick(); keeper.tick();
    assert.ok(bots[0].sent.at(-1)[0] === 'stock' || bots[1].sent.at(-1)[0] === 'stock', 'a roster bot counts the plan chest');
    assert.strictEqual(bots[2].sent.length, 0);
    // numbers from before the borrow do not count; a fresh count with enough logs finishes it
    world.noteStock('bot11', {oak_log: 30});
    for (const b of bots) b.working = false;
    now += 6000; plan.tick();
    assert.strictEqual(plan.completed.has('stock'), true);
    assert.deepStrictEqual([keeper.enabled, keeper.chest, keeper.quotas, keeper.site, keeper.runners === runners], [false, keeperChest, [['diamond', 1]], {x: 9, y: 9, z: 9}, true], 'the keeper is given back');
    assert.strictEqual(plan.state().current.id, 'after');
    // restart: still switched on (a deploy must not stop it), and what was done is remembered
    const again = mk();
    assert.strictEqual(again.enabled, true);
    assert.deepStrictEqual([...again.completed].sort(), ['beds', 'stock']);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).results['beds#0:bot11'].ok, true);
    assert.deepStrictEqual(again.state().objectives.map((o) => o.status), ['done', 'done', 'upcoming']);
    again.skip('after');
    assert.ok(mk().skipped.has('after'), 'a skip is saved at once, also while switched off');
    // Stop all: switched off
    plan.setEnabled(false);
    assert.strictEqual(plan.state().enabled, false);
    // a hand-switched keeper is never taken over
    const k2 = new Keeper({runners, world, chest: keeperChest, quotas: [['diamond', 1]], now: () => now});
    k2.setEnabled(true);
    const p2 = new Plan({runners, world, keeper: k2, objectives: objectives.slice(1, 2), roster: ['bot11'], chest, now: () => now});
    p2.setEnabled(true);
    p2.tick();
    assert.deepStrictEqual([k2.chest, k2.quotas], [keeperChest, [['diamond', 1]]]);
    assert.match(p2.state().current.note, /switched on by hand/);
    // a chain that fails between two ticks (never seen busy) is retried after the wait, not at once
    {
      const quick = fake('bot11');
      quick.enqueue = function (type, args) { this.sent.push([type, args]); this.err = 'homebed: no path'; };
      const p4 = new Plan({runners: new Map([['bot11', quick]]), world, objectives: objectives.slice(0, 1), roster: ['bot11'], chest, now: () => now});
      p4.setEnabled(true);
      p4.tick(); now += IDLE_MS; p4.tick();
      assert.strictEqual(quick.sent.length, 1);
      for (let i = 0; i < 20; i++) { now += 6000; p4.tick(); }
      assert.strictEqual(quick.sent.length, 1, 'held, then waiting: no resend');
      assert.strictEqual(p4.fails.get('beds'), 1);
      quick.err = '';
      now += 10 * 60 * 1000; p4.tick();
      assert.strictEqual(quick.sent.length, 2, 'retried after the wait');
    }
    // no keeper at all, or a step that keeps failing: blocked, parked or skipped, never a loop
    const p3 = new Plan({runners, world, keeper: null, objectives: objectives.slice(1), roster: ['bot11'], chest, now: () => now});
    p3.setEnabled(true);
    p3.tick();
    assert.match(p3.blocked.get('stock'), /no keeper/);
    assert.deepStrictEqual(p3.state().parked, [{id: 'stock', why: 'no keeper to run the quotas'}]);
    p3.skip('stock');
    assert.strictEqual(p3.state().current.id, 'after');
    p3.retry('stock');
    assert.strictEqual(p3.state().objectives[0].status, 'parked', 'still no keeper: parked again, not looping');
    assert.ok(MAX_FAILS >= 2);
  }
  // config
  assert.strictEqual(loadConfig({BOT_NAMES: 'bot1'}).planEnable, false);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot11,bot12', PLAN_ENABLE: '1', PLAN_ROSTER: 'bot11, bot12'}).planRoster, ['bot11', 'bot12']);
  assert.strictEqual(loadConfig({BOT_NAMES: 'bot1', PLAN_ENABLE: '', PLAN_ROSTER: ''}).planEnable, false);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PLAN_ENABLE: '1'}), /PLAN_ROSTER/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PLAN_ENABLE: '1', PLAN_ROSTER: 'steve'}), /bot names/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PLAN_ENABLE: '1', PLAN_ROSTER: 'bot1', AGENT_TOKEN: 'a'.repeat(40), AGENT_BOTS: 'bot1'}), /agent bots/);
}
