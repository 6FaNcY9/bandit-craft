'use strict';
// The dialogs left (upload, stop-all confirmation, Ziele sliders): pure builders, German copy, hostile input.
const assert = require('node:assert/strict');
const {confirmStop, render, explain, safe, REFRESHING, DIALOGS} = require('../botui-screens');

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(text).join('') : c && typeof c === 'object' ? (c.text || '') + text(c.extra) : '');
const base = {online: true, dead: false, health: 20, food: 18, freeSlots: 12, pos: [10, 64, -5], dimension: 'overworld', isDay: true, inventory: [], queue: [], armour: ['a', 'b', null, null]};
const work = (name, over = {}) => ({...base, name, activity: 'chopping', job: {label: 'Baumfarm', progress: '5/64', runningS: 725}, ...over});
const idle = (name) => ({...base, name, activity: 'idle', job: null});
const off = (name) => ({...base, name, online: false, health: null, food: null, pos: null, isDay: null, activity: 'offline', job: null});
const view = (over) => ({viewer: 'Fancy', snaps: [], allowed: '*', owner: true, keeper: null, flash: null, ...over});
const body = (d) => d.body.map((b) => text(b.contents));

{ // every dialog carries the contract fields
  for (const d of [render({name: 'stopall'}, view()), render({name: 'upload', url: 'https://x/y'}, view()), render({name: 'ziele'}, view())]) {
    assert.equal(d.type, 'minecraft:multi_action'); assert.equal(d.after_action, 'none'); assert.equal(d.pause, false);
    assert.equal(d.can_close_with_escape, true); assert.ok(d.actions.every((a) => a.width === 200));
    assert.equal(d.exit_action.action.id, 'botui:do');
  }
  assert.deepEqual([...DIALOGS].sort(), ['stopall', 'upload', 'ziele']);
}
{ // a kick and a stall in plain German, never the server's raw JSON
  assert.match(explain('kicked: {"text":"You are logging in too fast, try again later."}'), /zu schnell/);
  assert.equal(explain('kicked: {"text":"Server closed"}'), 'vom Server geworfen: Server closed');
  assert.equal(explain('kicked: {"translate":"multiplayer.disconnect.x"}'), 'vom Server geworfen');
  assert.equal(explain('schematic: no progress for 300 s: could not clear'), 'kommt nicht voran');
}
{
  assert.match(explain('no free iron_ore within 96 blocks (collected 0/64, searched 12 more spots)'), /nichts .*Reichweite/i);
  assert.match(explain('could not reach 1 2 3: No path to the goal!'), /kein Weg/i);
  assert.match(explain('unsafe: water next to it'), /Wasser/);
  assert.match(explain('need 3 more iron_ingot'), /3 .*iron_ingot/);
  assert.equal(explain('something new'), 'something new');
  // real strings, bare and with a job prefix
  for (const [raw, re] of [
    ['inventory still full after depositing (chest full?)', /^Kiste voll$/],
    ['no free stone within 64 blocks (collected 0/8; seen 1024, searched 3 more spots)', /nichts zu finden: stone in Reichweite/],
    ['unsafe: water next to it', /^Wasser daneben/], ['unsafe: lava next to it', /^Lava daneben/],
    ['could not reach 1 2 3: No path to the goal!', /kein Weg/], ['could not reach -294 82 -184: no path (cached, 357 s ago)', /kein Weg/],
    ['need 3 more iron_ingot', /^3 iron_ingot fehlen/], ['need 4 raw_iron, have 1', /^4 raw_iron nötig, nur 1 da/],
    ['MidariBread is not visible and not on the map (offline, or BlueMap unavailable)', /nicht sichtbar/],
    ['the stick chests are empty, waiting for 30 s', /Stick-Kisten leer/],
  ]) for (const e of [raw, 'shift: ' + raw, 'goto: ' + raw]) assert.match(explain(e), re, e);
  assert.equal(explain('goto: something new'), 'goto: something new');
}
{ // upload: the link is a browser button, back goes to the overview
  const d = render({name: 'upload', url: 'https://hub/u/abc'}, view({flash: {text: 'Geht nicht: x', ok: false}}));
  assert.equal(d.actions[0].action.type, 'minecraft:open_url'); assert.equal(d.actions[0].action.url, 'https://hub/u/abc');
  assert.equal(d.exit_action.action.payload.a, 'ov'); assert.equal(body(d).at(-1), '✖ Geht nicht: x');
}
{ // Alle stopp: behind a confirmation that goes back to the overview instead of closing
  const c = confirmStop(view());
  assert.deepEqual(c.actions.map((a) => a.action.payload.a), ['stopall_ok']);
  assert.equal(text(c.exit_action.label), 'Abbrechen'); assert.equal(c.exit_action.action.payload.a, 'ov');
  assert.equal(render({name: 'stopall'}, view()).exit_action.action.payload.a, 'ov');
}
{ // hostile input goes through safe(): no colour codes, no control characters, bounded
  assert.equal(safe('a§cb\u0007c\n d', 99), 'abc d'.replace('abc', 'ab c')); // colour code stripped, control chars become spaces
  assert.equal(safe('x'.repeat(500), 20).length, 20);
  const evil = {item: '§c' + 'i'.repeat(900) + '\n', want: 10, have: 1};
  const d = JSON.parse(JSON.stringify(render({name: 'ziele'}, view({keeper: {state: () => ({available: true, quotas: [evil]})}, flash: {text: '§4' + 'f'.repeat(900), ok: false}}))));
  assert.doesNotMatch(JSON.stringify([d.body, d.inputs[0].label]), /§/); assert.ok(d.inputs[0].label.text.length <= 40); assert.ok(d.body.every((b) => text(b.contents).length <= 100));
}
{ // a name that is no dialog is refused loudly (BotUi sends such a viewer to the overview)
  assert.throws(() => render({name: 'lage'}, view()), /unbekannter Bildschirm/);
  assert.throws(() => render({name: 'constructor'}, view()), /unbekannter Bildschirm/);
  assert.deepEqual([...REFRESHING], ['ov', 'botm', 'kartem', 'zielm']);
}
console.log('botui-screens ok');
{ // Ziele: only the quota sliders, Speichern and Zurück (the toggles live in the zielm menu)
  const {ziele} = require('../botui-screens');
  const keeper = {state: () => ({available: true, enabled: true, quotas: [{item: 'logs', want: 64, have: 10}, {item: 'coal', want: 100, have: null}, {item: 'torch', want: 2000, have: 5}]})};
  const d = render({name: 'ziele'}, view({keeper}));
  assert.deepEqual(d.inputs.map((i) => [i.key, i.end, i.initial]), [['want_logs', 256, 64], ['want_coal', 400, 100], ['want_torch', 4096, 2000]]);
  assert.ok(d.inputs.every((i) => i.type === 'minecraft:number_range' && i.start === 0 && i.step === 1));
  assert.ok(!REFRESHING.has('ziele'), 'an input screen never refreshes');
  assert.deepEqual(d.actions.map((a) => text(a.label)), ['Speichern', 'Zurück']);
  assert.equal(d.actions[0].action.additions.a, 'saveziele'); assert.equal(d.actions[1].action.payload.a, 'zielm');
  const m = JSON.parse(JSON.stringify(render({name: 'ziele'}, view({keeper, owner: false, allowed: ['MisaBot']}))));
  assert.equal(m.inputs, undefined); assert.ok(!JSON.stringify(m).includes('saveziele'));
  { // the configured numbers; initial never above end
    const b = render({name: 'ziele'}, view({keeper: {state: () => ({available: true, enabled: true, quotas: [{item: 'planonly', want: 5, have: 0}], configured: [{item: 'logs', want: 64, have: 1}, {item: 'big', want: 9999, have: 1}]})}, traders: []}));
    assert.deepEqual(b.inputs.map((i) => [i.key, i.end, i.initial]), [['want_logs', 256, 64], ['want_big', 4096, 4096]]);
  }
}
{ // Karte: the markers sent to the plugin follow the viewer's rights (the zoom/centre buttons are the kartem menu)
  const snaps = [work('bot1'), work('MisaBot')];
  const {markersOf} = require('../botui');
  const all = [work('bot1', {pos: [10, 64, -5]}), work('MisaBot', {pos: [1, 70, 2], dimension: 'the_nether'}), idle('EM'), off('gone'), work('dead1', {dead: true}), work('bad', {pos: [NaN, 0, 0]})];
  assert.deepEqual(markersOf(all, ['MisaBot']), [{x: 1, z: 2, dim: 'the_nether', kind: 'work', label: 'MisaBot'}]);
  assert.deepEqual(markersOf(all, '*').map((k) => [k.label, k.kind]), [['bot1', 'work'], ['MisaBot', 'work'], ['EM', 'idle'], ['dead1', 'bad']]);
}
{ // helpers in the sandbox: off the map, marked by placeBots
  const {markersOf, placeBots} = require('../botui');
  const sb = (n, over) => ({...idle(n), sandbox: true, ...over});
  const snaps = [sb('bot1', {isDay: false}), work('bot19'), sb('bot2')];
  assert.deepEqual(markersOf(snaps, '*').map((m) => m.label), ['bot19']);
  const named = [{name: 'bot1'}, {name: 'bot19'}, {name: 'MisaBot'}];
  assert.deepEqual(placeBots(named, {vhost: 'sandbox.bots', guests: ['MisaBot'], mainBots: ['bot19']}), [{name: 'bot1', guest: false, sandbox: true}, {name: 'bot19', guest: false, sandbox: false}, {name: 'MisaBot', guest: true, sandbox: false}]);
  assert.deepEqual(placeBots(named, {vhost: '', guests: ['MisaBot'], mainBots: []}).map((s) => s.sandbox), [false, false, false], 'without a sandbox nothing is marked');
}
// the plugin compares marker worlds with Bukkit's world keys
assert.deepEqual(['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].map(require('../world').normDim), ['overworld', 'the_nether', 'the_end']);
console.log('botui-screens karte ok');
