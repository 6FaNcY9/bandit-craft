'use strict';
// Chat jobs report start, end and (with laut) 10 % steps; other jobs say nothing. No Minecraft server.
(async () => {
  const assert = require('node:assert/strict'), {EventEmitter} = require('node:events');
  const {makeSayer, chatLabel, germanReason} = require('../owner');
  const {BotRunner, JOBS, VALIDATE} = require('../bots');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // labels and reasons
  const L = (type, args) => chatLabel({type, args});
  assert.equal(L('mine', {block: 'iron_ore', count: 16}), 'hol 16 eisen'); assert.equal(L('mine', {block: 'coal_ore', count: 2}), 'hol 2 kohle');
  assert.equal(L('mine', {block: 'stone', count: 1}), 'hol 1 stein'); assert.equal(L('mine', {block: 'diamond_ore', count: 4}), 'hol 4 diamond_ore');
  assert.equal(L('chop', {count: 64}), 'hol 64 holz'); assert.equal(L('schematic', {file: 'haus.litematic'}), 'bau haus');
  assert.equal(L('trade', {item: 'stick'}), 'handel sticks'); assert.equal(L('trade', {item: 'stick', minutes: 30}), 'handel sticks 30min'); assert.equal(L('trade', {item: 'stick', target: 500}), 'handel sticks 500');
  for (const [t, w] of [['come', 'komm'], ['follow', 'folge'], ['guard', 'wache'], ['give', 'gib'], ['deposit', 'lagern'], ['clear', 'abbau']]) assert.equal(L(t, {}), w);
  assert.equal(chatLabel({type: 'fake', args: {}}, 'fake '), 'fake');
  for (const [en, de] of [['bot is offline', 'Bot ist offline'], ['bot went offline', 'Bot ist offline'], ['no path to fancy8869', 'kein Weg zu fancy8869'],
    ['inventory still full after depositing (chest full?)', 'Inventar voll, Kiste auch'], ['no chest at 1 2 3 (found air)', 'keine Kiste bei 1 2 3'],
    ['no chests within 6 blocks of 1 2 3', 'keine Kiste in der Nähe'], ['no pickaxe for iron_ore and could not make or fetch one: x', 'keine Spitzhacke für iron_ore'],
    ['needs a tool that can harvest obsidian: diamond_pickaxe', 'kein Werkzeug für obsidian'], ['no free stone within 128 blocks (collected 1/4)', 'kein stone in Reichweite'],
    ['5 6 is inside a protected area', 'liegt im Schutzgebiet'], ['bob is not visible and not on the map (offline, or BlueMap unavailable)', 'Spieler nicht zu finden'],
    ['unknown block: foo', 'unbekannter Block: foo'], ['no torches available', 'keine Fackeln'], ['kaputt', 'kaputt']]) assert.equal(germanReason(en), de, en);
  // FIFO sayer: in order, one per gap, 8 waiting at most
  const sent = [], fifo = makeSayer((t) => sent.push(t), {gapMs: 10, max: 5, queue: true});
  fifo('first'); for (let i = 1; i <= 10; i++) fifo(`l${i}xxxx`);
  for (let i = 0; i < 100 && sent.length < 9; i++) await sleep(50); // generous: the full suite loads the timers
  assert.deepEqual(sent, ['first', 'l3xxx', 'l4xxx', 'l5xxx', 'l6xxx', 'l7xxx', 'l8xxx', 'l9xxx', 'l10xx']);
  // a runner with a fake job type
  let fail = false, noop = false;
  VALIDATE.fake = (a) => a;
  JOBS.fake = async (r, job) => {
    Object.assign(job.t, {total: 10, done: 0});
    job.t.done = 5; await sleep(30); job.t.done = 10; await sleep(30);
    if (noop) job.noop = true;
    if (fail) throw new Error('no path to bob');
  };
  const mk = (chat, verbose) => {
    const said = [];
    const r = new BotRunner('bot1', {log: () => {}, ownerUuids: [], onEvent: (b, k, t) => { if (k === 'say') said.push(t.slice(t.indexOf(': ') + 2)); }});
    r.bot = new EventEmitter(); r.online = true; r.answerTo = 'fancy8869'; r.progressEveryMs = 5; r.prefs.verbose = verbose;
    r.say = (t) => r.emit('say', `fancy8869: ${t}`); // unthrottled
    if (chat) r.chatJobs.add(r.jobSeq + 1);
    const job = r.enqueue('fake', {});
    return {r, said, job};
  };
  let t = mk(true, true); await sleep(200);
  assert.deepEqual(t.said, ['start: fake', 'fake 50%', 'fertig: fake, 0 s']);
  t = mk(true, false); await sleep(200);
  assert.deepEqual(t.said, ['start: fake', 'fertig: fake, 0 s']);
  noop = true; t = mk(true, false); await sleep(200); noop = false;
  assert.deepEqual(t.said, ['start: fake', 'fertig: fake, war schon erledigt']);
  fail = true; t = mk(true, true); await sleep(200); fail = false;
  assert.deepEqual(t.said, ['start: fake', 'fake 50%', 'Problem: fake: kein Weg zu bob']);
  t = mk(false, true); await sleep(200);
  assert.deepEqual(t.said, []);
  // laut during the job takes effect; nothing after the end
  t = mk(true, false); t.r.prefs.verbose = false; setTimeout(() => { t.r.prefs.verbose = true; }, 10); await sleep(200);
  assert.deepEqual(t.said, ['start: fake', 'fake 50%', 'fertig: fake, 0 s']);
  const n = t.said.length; await sleep(60); assert.equal(t.said.length, n);
  // dropped queue and "zu oft unterbrochen"
  t = mk(true, false); t.r.queue = [{id: 50, type: 'come', args: {}}]; t.r.chatJobs.add(50); t.r.orders.set(50, 'x'); t.r.dropQueue();
  assert.equal(t.said.at(-1), 'gestoppt: komm');
  t.r.chatJobs.add(51); t.r.resumeLater({id: 51, type: 'mine', args: {block: 'stone', count: 3}, interruptions: 3}, 'died');
  assert.equal(t.said.at(-1), 'Problem: hol 3 stein: zu oft unterbrochen');
  // through the real constructor sayer both lines arrive
  const heard = [];
  const real = new BotRunner('bot1', {log: () => {}, ownerUuids: [], onEvent: (b, k, x) => { if (k === 'say') heard.push(x); }});
  real.answerTo = 'fancy8869'; real.say('start: x'); real.say('fertig: x, 0 s');
  await sleep(2600);
  assert.deepEqual(heard, ['fancy8869: start: x', 'fancy8869: fertig: x, 0 s']);
})();
