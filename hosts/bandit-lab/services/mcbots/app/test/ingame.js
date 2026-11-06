'use strict';
// Ingame helpers: sidebar lines and bot state (pure functions), the sidebar push and the fertig line.
const assert = require('node:assert/strict');
const {botState, sidebarLines} = require('../ingame');
const snap = (name, extra = {}) => ({name, online: true, dead: false, activity: 'idle - no job', lastErrorAgoS: null, ...extra});
const lines = sidebarLines([snap('bot1', {activity: 'walking to "the" \\chest', lastErrorAgoS: 10}), snap('bot2', {dead: true}), snap('bot3', {online: false})], {guests: [], now: 0});
assert.equal(lines.length, 3); assert.deepEqual(lines.map((l) => l.score), [15, 14, 13]);
assert.deepEqual(JSON.parse(lines[0].component)[2], {text: 'walking to "the" \\chest', color: 'red'});
assert.equal(JSON.parse(lines[1].component)[2].color, 'dark_red'); assert.equal(JSON.parse(lines[2].component)[2].color, 'gray');
const many = sidebarLines([...Array(17)].map((_, i) => snap('b' + i)), {guests: ['b3', 'b5'], now: 0});
assert.equal(many.length, 15); assert.ok(!many.some((l) => l.entry === 'b3' || l.entry === 'b5'));
assert.equal(JSON.parse(sidebarLines([snap('b', {activity: 'x'.repeat(40)})], {guests: [], now: 0})[0].component)[2].text.length, 29);

for (const [extra, want] of [[{online: false}, 'offline'], [{dead: true}, 'dead'], [{lastErrorAgoS: 10}, 'error'], [{sheltered: true}, 'sheltered'], [{}, 'idle'], [{activity: 'chop'}, 'work']]) assert.equal(botState(snap('b', extra)), want);

// Ingame class: console push, replies.
const {Ingame} = require('../ingame');

(async () => {
  const calls = []; let replies = [];
  const call = async (cmds) => { calls.push(...cmds); return cmds.map(() => replies.shift() ?? ''); };
  let snaps = [snap('bot1'), snap('bot23')];
  const g = new Ingame({call, viewers: ['fancy8869', 'MidariBread'], guests: ['bot23'], snapshots: () => snaps, gapMs: 0, log: () => {}, now: () => 0});
  // Waits for the say timers themselves: when the shared loop stalls, a fixed sleep's timer list can run before theirs.
  const flush = async () => { do await new Promise((r) => setTimeout(r, 5)); while (g.waiting.size); };
  await g.setup();
  assert.ok(!calls.some((c) => c.startsWith('team join')) && calls.includes('scoreboard objectives setdisplay sidebar.team.aqua mcbots')); // sidebar is opt-in
  calls.length = 0; replies = ['There are 1 of a max of 16 players online: bot1']; await g.push();
  assert.deepEqual(calls, ['minecraft:list']); // no viewer online: nothing is written
  const viewer = () => { calls.length = 0; replies = ['There are 2 of a max of 16 players online: bot1, fancy8869']; };
  viewer(); await g.push();
  assert.ok(calls.some((c) => c.startsWith('scoreboard players display name bot1 mcbots ')) && !calls.some((c) => c.startsWith('pa ')));
  viewer(); await g.push(); assert.deepEqual(calls, ['minecraft:list']); // nothing changed
  snaps = [snap('bot1', {activity: 'chopping'})]; viewer(); await g.push();
  assert.ok(calls.includes('scoreboard players reset bot23 mcbots') && calls.some((c) => c.includes('display name bot1 mcbots ') && c.includes('chopping'))); // the changed line is rewritten
  calls.length = 0;
  g.event({bot: 'bot1', kind: 'fail', text: 'kein Weg'}); await flush(); assert.ok(!calls.some((c) => c.startsWith('tellraw'))); // nobody ordered it: no line
  g.event({bot: 'bot1', kind: 'say', text: 'fancy8869: nochmal'}); await flush();
  const t1 = calls.filter((c) => c.startsWith('tellraw fancy8869 '));
  assert.equal(t1.length, 1); assert.ok(t1[0].includes('nochmal')); // a viewer's own chat line is relayed
  g.expect('bot1', 'fancy8869'); calls.length = 0;
  g.event({bot: 'bot1', kind: 'fail', text: 'kein Weg'}); await flush();
  assert.ok(calls.some((c) => c.startsWith('tellraw fancy8869 ') && c.includes('Problem: kein Weg')));
  g.event({bot: 'bot1', kind: 'done', text: 'again'}); await flush(); // pending was cleared: no further reply
  assert.equal(calls.filter((c) => c.startsWith('tellraw')).length, 1);
  calls.length = 0;
  g.event({bot: 'bot2', kind: 'say', text: 'MidariBread: ok: folge dir'});
  g.event({bot: 'bot2', kind: 'death', text: 'died at 1 2 3'}); await flush();
  const mb = calls.filter((c) => c.startsWith('tellraw MidariBread '));
  assert.equal(mb.length, 1); assert.ok(mb[0].includes('ok: folge dir')); // deaths are not told in chat (owner 2026-11-03: no chat noise)
  assert.ok(!calls.some((c) => c.includes('gestorben')));
  calls.length = 0; g.event({bot: 'bot2', kind: 'say', text: 'MidariBread: ok: folge dir'}); await flush();
  assert.ok(calls[0].includes('[bot2] ') && calls[0].includes('ok: folge dir'));
  calls.length = 0; g.event({bot: 'bot1', kind: 'say', text: 'Stranger: hi'}); await flush(); assert.ok(!calls.some((c) => c.startsWith('tellraw'))); // unknown name: no relay
  // tell: one tellraw, at most 6 lines of 100 chars
  calls.length = 0; await g.tell('fancy8869', [...Array(8)].map((_, i) => 'z'.repeat(150) + i));
  assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0].slice('tellraw fancy8869 '.length)).text.split('\n').length, 6);
  assert.ok(JSON.parse(calls[0].slice('tellraw fancy8869 '.length)).text.split('\n').every((l) => l.length === 100));
  // a burst: one line per bot, the newest text of each
  calls.length = 0; g.say('fancy8869', 'bot1', 'eins'); g.say('fancy8869', 'bot2', 'zwei'); g.say('fancy8869', 'bot1', 'drei'); await flush();
  const burst = calls.filter((c) => c.startsWith('tellraw fancy8869 '));
  assert.equal(burst.length, 2); assert.ok(burst.some((c) => c.includes('[bot1] ') && c.includes('drei') && !c.includes('eins')) && burst.some((c) => c.includes('[bot2] ')));
  // a call that never resolves: one call over three pushes
  let n = 0;
  const s = new Ingame({call: () => { n++; return new Promise(() => {}); }, viewers: ['a'], guests: [], snapshots: () => [snap('b')], log: () => {}});
  s.push(); s.push(); s.push(); await flush();
  assert.equal(n, 1);
  const logs = []; const t = new Ingame({call, viewers: ['a'], guests: [], snapshots: () => { throw new Error('boom'); }, log: (x) => logs.push(x)});
  replies = ['a']; await t.push(); assert.deepEqual(logs, ['ingame push: boom']);
})().catch((e) => { console.error(e); process.exit(1); });
