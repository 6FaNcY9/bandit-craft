'use strict';
// Ingame helpers: sidebar lines, panel tokens and the order inbox parser (pure functions).
const assert = require('node:assert/strict');
const {token, sidebarLines, parseInbox, statusToken} = require('../ingame');
assert.equal(token('Holz holen 3/8'), 'Holz_holen_3/8');
assert.equal(token('§aStein "x" \\y'), 'Stein_x_y');
assert.equal(token(''), '-');
assert.equal(token('a'.repeat(40)).length, 32);
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
assert.equal(statusToken(snap('b', {online: false, activity: ''})), 'offline');

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
  assert.ok(calls.includes('team join mcbots MidariBread') && calls.includes('scoreboard objectives setdisplay sidebar.team.aqua mcbots'));
  calls.length = 0; await g.push();
  assert.ok(calls.some((c) => c.startsWith('scoreboard players display name bot1 mcbots ')) && calls.includes('pa data set mcbots bot1 idle_-_no_job'));
  calls.length = 0; await g.push(); assert.equal(calls.length, 0); // nothing changed
  snaps = [snap('bot1', {activity: 'chopping'})]; calls.length = 0; await g.push();
  assert.ok(calls.includes('scoreboard players reset bot23 mcbots') && calls.includes('pa data del mcbots bot1'));
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
  assert.equal(mb.length, 1); assert.ok(mb[0].includes('gestorben: died at 1 2 3')); // newest wins within the burst
  assert.ok(calls.some((c) => c.startsWith('tellraw fancy8869 ') && c.includes('gestorben: died at 1 2 3')));
  calls.length = 0; g.event({bot: 'bot2', kind: 'say', text: 'MidariBread: ok: folge dir'}); await flush();
  assert.ok(calls[0].includes('[bot2] ') && calls[0].includes('ok: folge dir'));
  // a call that never resolves: one call over three pushes
  let n = 0;
  const s = new Ingame({call: () => { n++; return new Promise(() => {}); }, viewers: ['a'], guests: [], snapshots: () => [snap('b')], order: () => '', log: () => {}});
  s.push(); s.push(); s.push(); await flush();
  assert.equal(n, 1);
  let m = 0; const p = new Ingame({call: () => { m++; return new Promise(() => {}); }, viewers: ['a'], guests: [], snapshots: () => [], order: () => '', log: () => {}});
  p.poll(); p.poll(); p.poll(); await flush();
  assert.equal(m, 1); // a poll in flight skips the tick
  const logs = []; const t = new Ingame({call, viewers: ['a'], guests: [], snapshots: () => { throw new Error('boom'); }, order: () => '', log: (x) => logs.push(x)});
  await t.push(); assert.deepEqual(logs, ['ingame push: boom']);
})().catch((e) => { console.error(e); process.exit(1); });
