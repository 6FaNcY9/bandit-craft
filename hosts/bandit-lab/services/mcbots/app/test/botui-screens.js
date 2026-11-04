'use strict';
// Lagebild and Bot dialogs: pure builders, German copy, hostile input, stable output.
const assert = require('node:assert/strict');
const {lage, bot, confirmStop, render, explain, safe, REFRESHING} = require('../botui-screens');

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(text).join('') : c && typeof c === 'object' ? (c.text || '') + text(c.extra) : '');
const texts = (o, out = []) => { // every text string anywhere in a dialog
  if (Array.isArray(o)) o.forEach((x) => texts(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) k === 'text' || k === 'contents' && typeof v === 'string' ? out.push(String(v)) : texts(v, out);
  return out;
};
const longestText = (d) => Math.max(...texts(d).map((t) => t.length));
const base = {online: true, dead: false, health: 20, food: 18, freeSlots: 12, pos: [10, 64, -5], dimension: 'overworld', isDay: true, inventory: [], queue: [], armour: [null, null, null, null], lastError: null, lastErrorAgoS: null};
const work = (name, over = {}) => ({...base, name, activity: 'chopping', job: {label: 'Baumfarm', progress: '5/64', runningS: 725}, ...over});
const idle = (name) => ({...base, name, activity: 'idle', job: null});
const off = (name) => ({...base, name, online: false, health: null, food: null, pos: null, isDay: null, activity: 'offline', job: null});
const view = (over) => ({viewer: 'Fancy', snaps: [], allowed: '*', owner: true, keeper: null, flash: null, ...over});
const botButtons = (d) => d.actions.filter((a) => a.action.payload.a === 'bot');
const labels = (d) => d.actions.map((a) => text(a.label));
const body = (d) => d.body.map((b) => text(b.contents));

assert.match(body(lage(view({snaps: [work('bot1'), idle('bot2'), off('bot3')], allowed: ['bot1', 'bot2'], })))[0], /2 Bots · 1 arbeiten · 1 frei · Tag/);
assert.equal(botButtons(lage(view({snaps: [work('bot1'), idle('bot2'), off('bot3')], allowed: ['bot1', 'bot2']}))).length, 2);

{ // every dialog carries the contract fields; the buttons stay inside what the client can show
  const d = lage(view({snaps: Array.from({length: 8}, (_, i) => work('bot' + i))}));
  assert.equal(d.type, 'minecraft:multi_action'); assert.equal(d.after_action, 'none'); assert.equal(d.pause, false);
  assert.deepEqual(d.exit_action.action, {type: 'minecraft:custom', id: 'botui:do', payload: {a: 'close'}});
  assert.equal(text(d.exit_action.label), 'Schließen');
  assert.equal(d.actions.length, 12); assert.ok(d.actions.every((a) => a.width === 200));
  assert.ok(d.body.length <= 6);
  assert.match(labels(d)[0], /^● bot0 +Baumfarm 5\/64 · 12 min$/);
  assert.equal(d.actions[0].label[1].color, 'green');
  assert.deepEqual(d.actions[0].action.payload, {a: 'bot', bot: 'bot0'});
  assert.match(text(d.actions[0].tooltip), /chopping/);
  assert.deepEqual(labels(d).slice(8), ['Neuer Auftrag', 'Ziele', 'Karte', 'Alle stopp']);
  assert.deepEqual(d.actions.slice(8).map((a) => a.action.payload.a), ['new', 'ziele', 'karte', 'stopall']);
}
{ // problems say the cause, at most 3; dead and offline are not "free"
  const err = (n, e) => ({...work(n), lastError: e, lastErrorAgoS: 130});
  const d = lage(view({snaps: [err('bot1', 'inventory still full after depositing (chest full?)'), err('bot2', 'x'), err('bot3', 'y'), err('bot4', 'z'), {...work('bot5'), dead: true}]}));
  const b = body(d);
  assert.match(b[1], /^bot1: Kiste voll, Baumfarm steht \(vor 2 min\)$/);
  assert.equal(b.filter((x) => /steht|tot/.test(x)).length, 3);
  assert.equal(d.body[1].contents[1].color, 'red');
}
{
  assert.match(explain('no free iron_ore within 96 blocks (collected 0/64, searched 12 more spots)'), /nichts .*Reichweite/i);
  assert.match(explain('could not reach 1 2 3: No path to the goal!'), /kein Weg/i);
  assert.match(explain('unsafe: water next to it'), /Wasser/);
  assert.match(explain('need 3 more iron_ingot'), /3 .*iron_ingot/);
  assert.equal(explain('something new'), 'something new');
}
{ // Bedarf
  const keeper = (quotas) => ({state: () => ({available: true, quotas})});
  const low = body(lage(view({snaps: [idle('bot1')], keeper: keeper([{item: 'coal', want: 32, have: 20}, {item: 'raw_iron', want: 16, have: 3}, {item: 'logs', want: 9, have: 9}, {item: 'sand', want: 9, have: null}])})));
  assert.equal(low[1], 'Bedarf: coal 20/32, raw_iron 3/16');
  assert.equal(body(lage(view({snaps: [idle('bot1')], keeper: keeper([{item: 'logs', want: 9, have: 9}])})))[1], 'Alles auf Lager');
  assert.equal(body(lage(view({snaps: [idle('bot1')]}))).length, 1); // no keeper configured: no line
}
{ // flash
  const d = lage(view({snaps: [idle('bot1')], flash: {text: 'bot1: Baumfarm gestartet', ok: true}}));
  assert.equal(body(d).at(-1), '✔ bot1: Baumfarm gestartet');
  assert.equal(body(lage(view({snaps: [idle('bot1')], flash: {text: 'Geht nicht: x', ok: false}}))).at(-1), '✖ Geht nicht: x');
}
{ // hostile snapshot: valid JSON, no colour codes, every text short
  const s = {name: 'bot1', online: false, lastError: '"§c\n' + 'x'.repeat(500), lastErrorAgoS: 1};
  const d = lage(view({snaps: [s], allowed: ['bot1']}));
  const j = JSON.stringify(d);
  assert.doesNotMatch(j, /§/); assert.ok(JSON.parse(j)); assert.ok(longestText(d) <= 200);
  const evil = {...work('bot"\n1'), activity: '§k' + 'a'.repeat(900), queue: ['§1' + 'q'.repeat(900)], inventory: ['i'.repeat(900)], lastError: '§c' + 'e'.repeat(900), lastErrorAgoS: 3};
  for (const d2 of [lage(view({snaps: [evil]})), bot(view({snaps: [evil]}), evil.name)]) {
    assert.doesNotMatch(JSON.stringify(d2), /§/); assert.ok(longestText(d2) <= 200);
  }
}
{ // bot screen
  const s = work('bot1', {queue: ['Holz', 'Schicht', 'Einlagern', 'Heim'], inventory: Array.from({length: 12}, (_, i) => `item${i} x${i + 1}`), health: 19.6, tool: {name: 'iron_pickaxe', left: 120, max: 250}, armour: ['a', 'b', null, null]});
  const d = bot(view({snaps: [s]}), 'bot1');
  const b = body(d).join('\n');
  assert.match(b, /Baumfarm 5\/64 · 12 min/); assert.match(b, /Danach: Holz, Schicht, Einlagern \+1/);
  assert.match(b, /Leben 20 · Essen 18 · Rüstung 2\/4 · frei 12/); assert.match(b, /iron_pickaxe 120\/250/);
  assert.match(b, /item7 x8/); assert.doesNotMatch(b, /item8/);
  assert.match(b, /Position 10 64 -5 Oberwelt/);
  assert.deepEqual(d.actions.map((a) => a.action.payload), [{a: 'stop', bot: 'bot1'}, {a: 'new', bot: 'bot1'}, {a: 'quick', bot: 'bot1', job: 'deposit'}, {a: 'quick', bot: 'bot1', job: 'rearm'}, {a: 'quick', bot: 'bot1', job: 'homebed'}, {a: 'quick', bot: 'bot1', job: 'graves'}]);
  assert.equal(text(d.actions[1].label), 'Auftrag für bot1');
  assert.equal(d.exit_action.action.payload.a, 'lage'); // back to the Lagebild; Escape still closes
  assert.equal(d.after_action, 'none');
}
{ // offline bot: no position, no throw; unknown or foreign bot: a notice, not an exception
  const b = body(bot(view({snaps: [off('bot3')]}), 'bot3')).join('\n');
  assert.doesNotMatch(b, /Position|Leben/); assert.match(b, /offline/);
  assert.match(body(bot(view({snaps: [idle('bot1')], allowed: ['bot1']}), 'bot9'))[0], /nicht gefunden/);
  assert.match(body(bot(view({snaps: [idle('bot2')], allowed: ['bot1']}), 'bot2'))[0], /nicht gefunden/);
}
{ // Alle stopp: owner only, behind a confirmation that goes back instead of closing
  const snaps = [idle('bot1')];
  assert.ok(labels(lage(view({snaps, owner: true}))).includes('Alle stopp'));
  assert.ok(!labels(lage(view({snaps, owner: false, allowed: ['bot1']}))).includes('Alle stopp'));
  const c = confirmStop(view());
  assert.deepEqual(c.actions.map((a) => a.action.payload.a), ['stopall_ok']);
  assert.equal(text(c.exit_action.label), 'Abbrechen'); assert.equal(c.exit_action.action.payload.a, 'lage');
}
{ // stable output: equal snapshots build equal JSON, runningS within a minute and health decimals do not matter, progress does
  const mk = (over, jobOver) => view({snaps: [work('bot1', {health: 19.9, ...over, job: {label: 'Baumfarm', progress: '5/64', runningS: 725, ...jobOver}})]});
  const a = lage(mk()), b = lage(mk({health: 19.6}, {runningS: 731}));
  assert.deepEqual(a, b); assert.deepEqual(bot(mk(), 'bot1'), bot(mk({health: 19.6}, {runningS: 739}), 'bot1'));
  assert.notDeepEqual(a, lage(mk({}, {progress: '6/64'})));
}
assert.deepEqual([...REFRESHING], ['lage', 'bot']);
assert.equal(render({name: 'stopall'}, view()).exit_action.action.payload.a, 'lage');
assert.equal(text(render({name: 'nonsense'}, view({snaps: []})).title), 'Kommandostand');
assert.equal(safe('a§cb\u0007c\n d', 99), 'a b c d'.replace('a b', 'ab')); // colour code stripped, control chars become spaces
console.log('botui-screens ok');
