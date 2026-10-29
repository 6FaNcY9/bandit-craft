'use strict';
// Misa's bots (spec 2026-10-29-misa-bots): the @bot exemption of protected areas, the building words, the clear job,
// the trading hall from job arguments and the trading schedule.
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const {BotRunner, VALIDATE, JOBS, NAME_RE} = require('../bots');
  const {loadConfig} = require('../config');
  const {translate, HELP} = require('../owner');
  const misa = require('../misa');
  const {parseHalls, parseSchedule, inWindow, TradeSchedule} = require('../tradeschedule');
  const trade = require('../trade');

  // names: exactly the one extra name, case as written
  for (const n of ['bot1', 'bot23', 'MisaBot']) assert.ok(NAME_RE.test(n), n);
  for (const n of ['misabot', 'MisaBot2', 'xMisaBot', 'bot100']) assert.ok(!NAME_RE.test(n), n);

  // PROTECTED_AREAS with @bots: a fifth/sixth null and the names in the seventh slot, plain boxes unchanged
  const areas = loadConfig({BOT_NAMES: 'bot1', PROTECTED_AREAS: '-80,-144,80,80;272,592,112,368@MisaBot;0,0,9,9@MisaBot+bot23'}).protectedAreas;
  assert.deepEqual(areas, [[-80, -144, 80, 80], [112, 368, 272, 592, null, null, ['MisaBot']], [0, 0, 9, 9, null, null, ['MisaBot', 'bot23']]]);
  for (const bad of ['0,0,9,9@', '0,0,9,9@steve', '0,0,9,9@MisaBot+']) assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PROTECTED_AREAS: bad}), /bad PROTECTED_AREAS/, bad);

  // each bot holds only the areas that do not name it
  assert.deepEqual(misa.forBot(areas, 'MisaBot'), [areas[0]]);
  assert.deepEqual(misa.forBot(areas, 'bot23'), [areas[0], areas[1]]);
  assert.equal(misa.forBot(areas, 'bot1').length, 3);
  const plain = [areas[0]];
  assert.equal(misa.forBot(plain, 'MisaBot'), plain, 'no exemption: the very same array');
  const r = new BotRunner('MisaBot', {log: () => {}, protectedAreas: areas});
  assert.deepEqual(r.protectedAreas, [areas[0]]);
  areas.push([300, 300, 310, 310]); // the shared array is live (hub policy, dashboard zones)
  assert.equal(r.protectedAreas.length, 2);
  areas.pop();
  assert.equal(new BotRunner('bot1', {log: () => {}, protectedAreas: areas}).protectedAreas.length, 3);

  // the area rule: whole box in an area naming the bot, touching no other area (a hall nested in the base wins)
  const base = [112, 368, 272, 592, null, null, ['MisaBot']], hall = [150, 400, 170, 420, 60, 70];
  const box = (x1, z1, x2, z2, y1 = 64, y2 = 70) => ({x1, y1, z1, x2, y2, z2});
  assert.equal(misa.boxRule([base], 'MisaBot', box(120, 380, 130, 390)), null);
  assert.match(misa.boxRule([base], 'MisaBot', box(100, 380, 130, 390)), /nicht ganz in deinem Bereich/);
  assert.match(misa.boxRule([base], 'bot1', box(120, 380, 130, 390)), /nicht ganz/); // not her area
  assert.match(misa.boxRule([base, hall], 'MisaBot', box(140, 390, 155, 405)), /gesperrt/);
  assert.equal(misa.boxRule([base, hall], 'MisaBot', box(140, 390, 155, 405, 80, 90)), null, 'a zone keeps its height');
  assert.equal(misa.boxRule([base, hall], 'MisaBot', box(120, 380, 130, 390)), null);

  // corners: 1, 2, 1 again; per player
  const c = new misa.Corners();
  assert.throws(() => c.box('misa'), /ecke/);
  assert.equal(c.set('misa', {x: 5, y: 64, z: 9}), 1);
  assert.throws(() => c.box('misa'), /ecke/);
  assert.equal(c.set('misa', {x: 1, y: 66, z: 3}), 2);
  assert.deepEqual(c.box('misa'), box(1, 3, 5, 9, 64, 66));
  assert.equal(c.set('misa', {x: 0, y: 0, z: 0}), 1);
  assert.throws(() => c.box('other'), /ecke/);

  // the words
  const tr = (s) => translate(s.split(' '), {owner: 'Misa', ownerPos: null});
  assert.deepEqual(tr('ecke'), {corner: true});
  assert.deepEqual(tr('ABBAU'), {clear: true});
  assert.deepEqual(tr('bau Haus'), {build: {name: 'Haus', rotation: 0}});
  assert.deepEqual(tr('bau haus 270'), {build: {name: 'haus', rotation: 270}});
  for (const s of ['bau', 'bau haus 45', 'bau haus 90 x', 'bau ../x', 'abbau jetzt', 'ecke 1']) assert.deepEqual(tr(s), {unknown: true}, s);
  assert.ok(HELP.length <= 100 && /ecke/.test(HELP) && /abbau/.test(HELP) && /bau <name>/.test(HELP), HELP);

  // clear: size limit, and the job digs everything but containers (and nothing outside the area rule)
  assert.deepEqual(VALIDATE.clear({x1: 31, y1: 23, z1: 31, x2: 0, y2: 0, z2: 0}), box(0, 0, 31, 31, 0, 23));
  for (const a of [{x1: 0, y1: 0, z1: 0, x2: 32, y2: 0, z2: 0}, {x1: 0, y1: 0, z1: 0, x2: 0, y2: 24, z2: 0}, {x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 32}]) assert.throws(() => VALIDATE.clear(a), /zu gross/);
  assert.equal(VALIDATE.schematic({file: 'a.litematic', origin: {x: 1, y: 2, z: 3}, confine: true}).confine, true);
  await assert.rejects(JOBS.clear({allAreas: [base], name: 'MisaBot'}, {args: box(0, 0, 5, 5)}), /nicht ganz in deinem Bereich/);

  // builderOrder: ecke replies, abbau needs two corners and the area, bau finds the file and the chests near the player
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-misa-'));
  try {
    fs.writeFileSync(path.join(dir, 'Haus.litematic'), '');
    const m = new BotRunner('MisaBot', {log: () => {}, protectedAreas: [base]});
    m.schematicDir = dir;
    const found = [];
    m.bot = {findBlocks: (o) => { found.push(o); return [{x: 121, y: 64, z: 381}]; }};
    const pl = (x, y, z) => ({entity: {position: {x, y, z}}});
    assert.deepEqual(m.builderOrder({status: true}, pl(0, 0, 0), 'Misa'), {status: true});
    assert.equal(m.builderOrder({corner: true}, pl(120.5, 65, 380.2), 'Misa').receipt, 'Ecke 1: 120 64 380');
    assert.throws(() => m.builderOrder({clear: true}, pl(0, 0, 0), 'Misa'), /ecke/);
    assert.equal(m.builderOrder({corner: true}, pl(125, 65, 385), 'Misa').receipt, 'Ecke 2: 125 64 385');
    assert.deepEqual(m.builderOrder({clear: true}, pl(0, 0, 0), 'Misa'), {type: 'clear', args: box(120, 380, 125, 385, 64, 64)});
    m.builderOrder({corner: true}, pl(10, 65, 10), 'Misa'); // corner 1 again, now outside her area
    assert.throws(() => m.builderOrder({clear: true}, pl(0, 0, 0), 'Misa'), /nicht ganz in deinem Bereich/);
    assert.throws(() => m.builderOrder({build: {name: 'Turm', rotation: 0}}, pl(0, 0, 0), 'Misa'), /^Error: kenne Turm nicht$/);
    const b = m.builderOrder({build: {name: 'haus', rotation: 90}}, pl(120.5, 65, 380.5), 'Misa');
    assert.deepEqual(b, {type: 'schematic', args: {file: 'Haus.litematic', origin: {x: 120, y: 64, z: 380}, rotation: 90, chests: [{x: 121, y: 64, z: 381}], confine: true}});
    assert.equal(found[0].maxDistance, 8);
    assert.doesNotThrow(() => VALIDATE.schematic(b.args));
    // a bot without an area of its own is refused before anything is looked up
    const other = new BotRunner('bot1', {log: () => {}, protectedAreas: [base]});
    other.schematicDir = dir;
    assert.throws(() => other.builderOrder({build: {name: 'haus', rotation: 0}}, pl(0, 0, 0), 'Misa'), /nicht ganz/);
  } finally { fs.rmSync(dir, {recursive: true}); }

  // trade: the owner's hall by default, another hall from the arguments
  assert.deepEqual(VALIDATE.trade({}), {});
  const mh = {hall: {x1: 9, y1: 70, z1: 5, x2: 0, y2: 60, z2: 0}, stores: [{x: 1, y: 61, z: 1}]};
  assert.deepEqual(VALIDATE.trade(mh), {hall: {x1: 0, y1: 60, z1: 0, x2: 9, y2: 70, z2: 5}, stores: [{x: 1, y: 61, z: 1}]});
  assert.deepEqual(VALIDATE.trade({...mh, sticks: [{x: 2, y: 61, z: 2}]}).sticks, [{x: 2, y: 61, z: 2}]);
  for (const bad of [{...mh, stores: []}, {hall: mh.hall}, {...mh, hall: {...mh.hall, x2: 200}}, {...mh, sticks: 'x'}]) assert.throws(() => VALIDATE.trade(bad), /./);
  {
    // a fake run in a custom hall: the sticks come from the chests found in the box (not the store), the emeralds go to its store
    const inv = {stick: 0};
    const calls = [], job = {args: VALIDATE.trade(mh), t: {}, cancelled: false};
    const bot = {
      entity: {position: {x: 3, y: 61, z: 3}}, entities: {},
      inventory: {items: () => [], emptySlotCount: () => 30},
      findBlocks: () => [{x: 1, y: 61, z: 1}, {x: 4, y: 61, z: 4}, {x: 50, y: 61, z: 4}], // the store, a stick chest, one outside the hall
    };
    const {trade: run} = trade.makeTrade({
      goNear: async (rr, j, x, y, z) => { calls.push(`go ${x} ${y} ${z}`); job.cancelled = true; },
      guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
      sleep: async () => { job.cancelled = true; },
      count: (b, n) => inv[n] || 0, ensureItem: async () => {},
      withdraw: async (rr, j, item, n, from) => { calls.push(`withdraw ${from.x} ${from.y} ${from.z}`); inv.stick = 64; },
      deposit: async () => {},
    });
    await assert.rejects(run({bot, emit: () => {}}, job), /stopped/);
    assert.deepEqual(calls[0], 'withdraw 4 61 4');
    assert.ok(calls.includes('go 4.5 63 2.5'), 'no villager in the box: walk to the middle of its hall');
  }

  // TRADE_HALLS and TRADE_SCHEDULE
  assert.deepEqual(parseHalls(''), {});
  assert.deepEqual(parseHalls(JSON.stringify({misa: mh})).misa.stores, [{x: 1, y: 61, z: 1}]);
  assert.throws(() => parseHalls('{'), /JSON/);
  assert.throws(() => parseHalls('{"misa": {"stores": []}}'), /needs a hall/);
  assert.deepEqual(parseSchedule('bot23=misa@mon,wed,sat/18:00+60'), [{bot: 'bot23', hall: 'misa', days: [1, 3, 6], start: 1080, minutes: 60}]);
  assert.deepEqual(parseSchedule(''), []);
  for (const bad of ['bot23=misa@mon/18:00', 'x=misa@mon/18:00+60', 'bot23=misa@xyz/18:00+60', 'bot23=misa@mon/25:00+60', 'bot23=misa@mon/18:00+0']) assert.throws(() => parseSchedule(bad), /TRADE_SCHEDULE|./, bad);
  assert.equal(loadConfig({BOT_NAMES: 'bot1', TRADE_SCHEDULE: 'bot23=misa@mon/18:00+60'}).tradeHalls.misa, undefined);

  // windows in Vienna time: summer (UTC+2) and winter (UTC+1); Monday 2026-10-26 (CET after the 25th), Mon 2026-07-06 (CEST)
  const e = parseSchedule('bot23=misa@mon,wed,sat/18:00+60')[0];
  const at = (iso) => Date.parse(iso);
  assert.ok(!inWindow(e, at('2026-10-26T16:59:00Z')) && inWindow(e, at('2026-10-26T17:00:00Z')) && inWindow(e, at('2026-10-26T17:59:00Z')) && !inWindow(e, at('2026-10-26T18:00:00Z')), 'winter');
  assert.ok(!inWindow(e, at('2026-07-06T15:59:00Z')) && inWindow(e, at('2026-07-06T16:00:00Z')) && !inWindow(e, at('2026-07-06T17:00:00Z')), 'summer');
  assert.ok(!inWindow(e, at('2026-10-27T17:30:00Z')), 'Tuesday');
  const late = parseSchedule('bot23=misa@sat/23:30+60')[0]; // runs past midnight into Sunday
  assert.ok(!inWindow(late, at('2026-10-31T22:15:00Z')) && inWindow(late, at('2026-10-31T22:45:00Z')) && inWindow(late, at('2026-10-31T23:15:00Z')) && !inWindow(late, at('2026-10-31T23:45:00Z')));

  // the controller: start when idle in the window, once; resume after a restart; stop after the window; nothing without the hall
  const snap = {online: true, dead: false, job: null, queue: []}, sent = [];
  const runner = {snapshot: () => snap, enqueue: (...a) => { sent.push(a); }};
  let now = at('2026-10-26T16:00:00Z');
  const mk = (halls) => new TradeSchedule({runners: new Map([['bot23', runner]]), halls, entries: [e], now: () => now});
  const s = mk({misa: VALIDATE.trade(mh)});
  s.tick();
  assert.equal(sent.length, 0, 'before 18:00');
  now = at('2026-10-26T17:00:30Z');
  s.tick();
  assert.deepEqual(sent, [['trade', VALIDATE.trade(mh)]]);
  snap.job = {type: 'trade'};
  now += 10000; s.tick();
  assert.equal(sent.length, 1, 'already trading');
  snap.job = null; now += 10000; s.tick();
  assert.equal(sent.length, 1, 'ended early: not at once');
  now += 120000; s.tick();
  assert.equal(sent.length, 2, 'ended early: again after the pause');
  const restarted = mk({misa: VALIDATE.trade(mh)}); // process restart inside the window
  snap.job = null; restarted.tick();
  assert.equal(sent.length, 3, 'resumed');
  snap.job = {type: 'mine'}; now = at('2026-10-26T18:30:00Z'); restarted.tick();
  assert.equal(sent.length, 3, 'her other orders are not stopped');
  snap.job = {type: 'trade'}; restarted.tick();
  assert.deepEqual(sent.at(-1), ['stop']);
  const none = mk({}); snap.job = null; now = at('2026-10-26T17:30:00Z'); none.tick();
  assert.equal(sent.length, 4, 'hall not configured: nothing runs');
  console.log('misa ok');
})();
