'use strict';
// Ingame helpers: sidebar lines, panel values and the order inbox parser (pure functions).
const assert = require('node:assert/strict');
const {word, botState, botFields, summary, sidebarLines, parseInbox} = require('../ingame');
const NB = '\u00a0';
assert.equal(word('Holz holen  3/8'), `Holz${NB}holen${NB}3/8`);
assert.equal(word('§aStein &c%player_name% <red>\nx'), ['Stein', 'c', 'player_name', 'red', 'x'].join(NB)); // no colour, placeholder, tag or line break
assert.equal(word(''), NB); assert.equal(word(null), NB);
assert.equal(word('a'.repeat(99)).length, 56);
assert.deepEqual(parseInbox('bot1:hol_32_holz'), {bot: 'bot1', words: ['hol', '32', 'holz']});
assert.deepEqual(parseInbox('alle:stopp'), {bot: 'alle', words: ['stopp']});
for (const bad of [null, '', 'x', 'bot1:', 'bot1:a b', 'bot1:' + 'a'.repeat(200), 'bot1:__']) assert.equal(parseInbox(bad), null, String(bad));
const snap = (name, extra = {}) => ({name, online: true, dead: false, activity: 'idle - no job', lastErrorAgoS: null, ...extra});
const lines = sidebarLines([snap('bot1', {activity: 'walking to "the" \\chest', lastErrorAgoS: 10}), snap('bot2', {dead: true}), snap('bot3', {online: false})], {guests: [], now: 0});
assert.equal(lines.length, 3); assert.deepEqual(lines.map((l) => l.score), [15, 14, 13]);
assert.deepEqual(JSON.parse(lines[0].component)[2], {text: 'walking to "the" \\chest', color: 'red'});
assert.equal(JSON.parse(lines[1].component)[2].color, 'dark_red'); assert.equal(JSON.parse(lines[2].component)[2].color, 'gray');
const many = sidebarLines([...Array(17)].map((_, i) => snap('b' + i)), {guests: ['b3', 'b5'], now: 0});
assert.equal(many.length, 15); assert.ok(!many.some((l) => l.entry === 'b3' || l.entry === 'b5'));
assert.equal(JSON.parse(sidebarLines([snap('b', {activity: 'x'.repeat(40)})], {guests: [], now: 0})[0].component)[2].text.length, 29);

// /bots values: the state decides the icon, the fields the lore.
const full = {health: 19.6, food: 18, freeSlots: 12, role: 'helfer', pos: [-25, 66, -94], dimension: 'overworld', isDay: true,
  tool: {name: 'iron_pickaxe', max: 250, left: 70}, job: {label: 'trade ', progress: '16 trades', runningS: 3700}, activity: 'walking'};
assert.deepEqual(botFields(snap('b', full)), {state: 'work', role: 'helfer', job: 'trade: 16 trades', doing: 'seit 1 h 1 min · walking', error: '',
  vitals: 'Leben 20 · Essen 18 · frei 12 · iron_pickaxe 70/250', where: '-25 66 -94 Oberwelt'});
assert.equal(botFields(snap('b', {...full, lastError: 'kein Weg', lastErrorAgoS: 120})).error, 'Fehler vor 2 min: kein Weg');
assert.equal(botFields(snap('b', {...full, lastError: 'alt', lastErrorAgoS: 900})).error, ''); // long over
assert.deepEqual(botFields(snap('b', {online: false, activity: 'offline'})), {state: 'offline', role: 'keine', job: 'frei', doing: 'offline', error: '', vitals: '', where: 'unbekannt'});
for (const [extra, want] of [[{online: false}, 'offline'], [{dead: true}, 'dead'], [{lastErrorAgoS: 10}, 'error'], [{sheltered: true}, 'sheltered'], [{}, 'idle'], [{activity: 'chop'}, 'work']]) assert.equal(botState(snap('b', extra)), want);
assert.deepEqual(summary([snap('a', {activity: 'chop', isDay: false}), snap('g', {isDay: true}), snap('x', {dead: true}), snap('y', {lastErrorAgoS: 5}), snap('z', {online: false})],
  {guests: ['g'], quotas: [{item: 'logs', want: 64, have: null}, {item: 'coal', want: 32, have: 40}, {item: 'iron', want: 16, have: 13}]}),
  {sum_bots: '4/5 online · 1 arbeiten', sum_problems: '2: x, y', sum_need: 'iron 13/16', sum_day: 'Tag'});
assert.deepEqual(summary([snap('z', {online: false})], {guests: [], quotas: []}), {sum_bots: '0/1 online · 0 arbeiten', sum_problems: 'keine', sum_need: 'alles da', sum_day: 'unbekannt'});

// Ingame class: console push, inbox poll, replies.
const {Ingame} = require('../ingame');
(async () => {
  const calls = []; let replies = [];
  const call = async (cmds) => { calls.push(...cmds); return cmds.map(() => replies.shift() ?? ''); };
  let snaps = [snap('bot1'), snap('bot23')];
  const orders = [];
  const g = new Ingame({call, viewers: ['fancy8869', 'MidariBread'], guests: ['bot23'], snapshots: () => snaps, gapMs: 0, order: (v, b, w) => { orders.push([v, b, w]); if (b === 'nope') throw new Error('unbekannter Bot'); return 'ok: komme'; }, log: () => {}, now: () => 0});
  const flush = () => new Promise((r) => setTimeout(r, 5));
  await g.setup();
  assert.ok(!calls.some((c) => c.startsWith('team join')) && calls.includes('scoreboard objectives setdisplay sidebar.team.aqua mcbots')); // sidebar is opt-in
  calls.length = 0; replies = ['There are 1 of a max of 16 players online: bot1']; await g.push();
  assert.deepEqual(calls, ['minecraft:list']); // no viewer online: nothing is written
  const viewer = () => { calls.length = 0; replies = ['There are 2 of a max of 16 players online: bot1, fancy8869']; };
  viewer(); await g.push();
  assert.ok(calls.some((c) => c.startsWith('scoreboard players display name bot1 mcbots ')) && calls.includes('pa data set mcbots bot1_state idle') && calls.includes(`pa data set mcbots sum_bots 2/2${NB}online${NB}·${NB}0${NB}arbeiten`));
  assert.ok(calls.indexOf('pa data del mcbots bot1_state') === calls.indexOf('pa data set mcbots bot1_state idle') - 1); // set keeps an existing value
  viewer(); await g.push(); assert.deepEqual(calls, ['minecraft:list']); // nothing changed
  snaps = [snap('bot1', {activity: 'chopping'})]; viewer(); await g.push();
  assert.ok(calls.includes('scoreboard players reset bot23 mcbots') && calls.includes('pa data set mcbots bot1_state work') && !calls.some((c) => c.includes('bot1_where'))); // only what changed
  replies = ['[CommandPanels] Value: bot1:komm', '[CommandPanels] Value: null']; calls.length = 0; await g.poll(); await flush();
  assert.deepEqual(orders, [['fancy8869', 'bot1', ['komm']]]); assert.ok(calls.includes('pa data del fancy8869 order'));
  assert.ok(calls.some((c) => c.startsWith('tellraw fancy8869 ') && c.includes('ok: komme')));
  calls.length = 0;
  g.event({bot: 'bot1', kind: 'fail', text: 'kein Weg'}); g.event({bot: 'bot1', kind: 'say', text: 'fancy8869: nochmal'}); await flush();
  const t1 = calls.filter((c) => c.startsWith('tellraw fancy8869 '));
  assert.equal(t1.length, 1); assert.ok(t1[0].includes('nochmal') && !t1[0].includes('kein Weg')); // one per burst, newest wins
  replies = ['[CommandPanels] Value: bot1:komm', '']; await g.poll(); await flush(); calls.length = 0;
  g.event({bot: 'bot1', kind: 'fail', text: 'kein Weg'}); await flush();
  assert.ok(calls.some((c) => c.startsWith('tellraw fancy8869 ') && c.includes('Problem: kein Weg')));
  g.event({bot: 'bot1', kind: 'done', text: 'again'}); await flush(); // pending was cleared: no further reply
  assert.equal(calls.filter((c) => c.startsWith('tellraw')).length, 1);
  replies = ['[CommandPanels] Value: nope:komm', '']; calls.length = 0; await g.poll(); await flush();
  assert.ok(calls.some((c) => c.includes('geht nicht: unbekannter Bot')));
  replies = ['[CommandPanels] Value: garbage', '']; calls.length = 0; await g.poll(); await flush();
  assert.ok(calls.some((c) => c.includes('kenne ich nicht: garbage')) && calls.includes('pa data del fancy8869 order'));
  calls.length = 0;
  g.event({bot: 'bot2', kind: 'say', text: 'MidariBread: ok: folge dir'});
  g.event({bot: 'bot2', kind: 'death', text: 'died at 1 2 3'}); await flush();
  const mb = calls.filter((c) => c.startsWith('tellraw MidariBread '));
  assert.equal(mb.length, 1); assert.ok(mb[0].includes('ok: folge dir')); // deaths are not told in chat (owner 2026-11-03: no chat noise)
  assert.ok(!calls.some((c) => c.includes('gestorben')));
  calls.length = 0; g.event({bot: 'bot2', kind: 'say', text: 'MidariBread: ok: folge dir'}); await flush();
  assert.ok(calls[0].includes('[bot2] ') && calls[0].includes('ok: folge dir'));
  calls.length = 0; g.event({bot: 'bot1', kind: 'say', text: 'Stranger: hi'}); await flush(); assert.ok(!calls.some((c) => c.startsWith('tellraw'))); // unknown name: no relay
  // a burst: one line per bot, the newest text of each
  calls.length = 0; g.say('fancy8869', 'bot1', 'eins'); g.say('fancy8869', 'bot2', 'zwei'); g.say('fancy8869', 'bot1', 'drei'); await flush();
  const burst = calls.filter((c) => c.startsWith('tellraw fancy8869 '));
  assert.equal(burst.length, 2); assert.ok(burst.some((c) => c.includes('[bot1] ') && c.includes('drei') && !c.includes('eins')) && burst.some((c) => c.includes('[bot2] ')));
  // a call that never resolves: one call over three pushes
  let n = 0;
  const s = new Ingame({call: () => { n++; return new Promise(() => {}); }, viewers: ['a'], guests: [], snapshots: () => [snap('b')], order: () => '', log: () => {}});
  s.push(); s.push(); s.push(); await flush();
  assert.equal(n, 1);
  let m = 0; const p = new Ingame({call: () => { m++; return new Promise(() => {}); }, viewers: ['a'], guests: [], snapshots: () => [], order: () => '', log: () => {}});
  p.poll(); p.poll(); p.poll(); await flush();
  assert.equal(m, 1); // a poll in flight skips the tick
  const logs = []; const t = new Ingame({call, viewers: ['a'], guests: [], snapshots: () => { throw new Error('boom'); }, order: () => '', log: (x) => logs.push(x)});
  replies = ['a']; await t.push(); assert.deepEqual(logs, ['ingame push: boom']);
})().catch((e) => { console.error(e); process.exit(1); });
