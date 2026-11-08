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
const botButtons = (d) => d.actions.filter((a) => a.action.payload?.a === 'bot');
const labels = (d) => d.actions.map((a) => text(a.label));
const body = (d) => d.body.map((b) => text(b.contents));

assert.match(body(lage(view({snaps: [work('bot1'), idle('bot2'), off('bot3')], allowed: ['bot1', 'bot2'], })))[0], /2 Bots · 1 arbeiten · 1 frei · Tag/);
assert.equal(botButtons(lage(view({snaps: [work('bot1'), idle('bot2'), off('bot3')], allowed: ['bot1', 'bot2']}))).length, 2);

{ // every dialog carries the contract fields; the buttons stay inside what the client can show
  const d = lage(view({snaps: Array.from({length: 8}, (_, i) => work('bot' + i))}));
  assert.equal(d.type, 'minecraft:multi_action'); assert.equal(d.after_action, 'none'); assert.equal(d.pause, false);
  assert.deepEqual(d.exit_action.action, {type: 'minecraft:custom', id: 'botui:do', payload: {a: 'close'}});
  assert.equal(text(d.exit_action.label), 'Schließen');
  assert.equal(d.actions.length, 14); assert.ok(d.actions.every((a) => a.width === 200));
  assert.ok(d.body.length <= 6);
  assert.match(labels(d)[0], /^● bot0 +Baumfarm 5\/64 · 12 min$/);
  assert.equal(d.actions[0].label[1].color, 'green');
  assert.deepEqual(d.actions[0].action.payload, {a: 'bot', bot: 'bot0'});
  assert.match(text(d.actions[0].tooltip), /chopping/);
  assert.deepEqual(labels(d).slice(8), ['Neuer Auftrag', 'Ziele', 'Karte', 'Alle stopp', 'Bauplan hochladen', 'Zauberstab holen']);
  assert.deepEqual(d.actions.slice(8).map((a) => a.action.payload?.a ?? a.action.command), ['new', 'ziele', 'karte', 'stopall', 'upload', '/zauberstab']);
}
{ // a kick and a stall in plain German, never the server's raw JSON
  assert.match(explain('kicked: {"text":"You are logging in too fast, try again later."}'), /zu schnell/);
  assert.equal(explain('kicked: {"text":"Server closed"}'), 'vom Server geworfen: Server closed');
  assert.equal(explain('kicked: {"translate":"multiplayer.disconnect.x"}'), 'vom Server geworfen');
  assert.equal(explain('schematic: no progress for 300 s: could not clear'), 'kommt nicht voran');
}
{ // a button says what a bot does, not the job's raw arguments
  const raw = (type, label) => work('bot1', {job: {type, label, progress: '', runningS: 10}});
  const say = (s) => labels(lage(view({snaps: [s]})))[0];
  assert.match(say(raw('schematic', 'schematic untergrund-kirche.litematic at -190 -12 -108 0 none 8 blocks true 1 blocks')), /Bauen untergrund-kirche$/);
  assert.match(say(raw('light', 'light -253 58 -90 -200 70 -40')), /Ausleuchten$/);
  assert.match(say(raw('trade', 'trade crafting emerald_block')), /Handel$/);
  assert.match(say(raw('highway', 'highway east 2000 1000')), /Straße$/);
  assert.match(say(raw('mine', 'mine iron_ore 64')), /Abbauen Eisenerz$/);
  assert.match(say(raw('someday', 'someday a b')), /someday a b$/, 'an unknown type keeps its label');
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
  assert.deepEqual(d.actions.map((a) => a.action.payload), [{a: 'stop', bot: 'bot1'}, {a: 'new', bot: 'bot1'}, {a: 'idle_open', bot: 'bot1'}, {a: 'quick', bot: 'bot1', job: 'deposit'}, {a: 'quick', bot: 'bot1', job: 'rearm'}, {a: 'quick', bot: 'bot1', job: 'homebed'}, {a: 'quick', bot: 'bot1', job: 'graves'}]);
  assert.equal(text(d.actions[2].label), 'Wenn frei: Nichts');
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
{ // Bedarf (the owner's base stock) is the owner's line
  const keeper = {state: () => ({available: true, quotas: [{item: 'coal', want: 32, have: 3}]})}, snaps = [idle('bot1')];
  assert.match(JSON.stringify(lage(view({snaps, keeper}))), /Bedarf: coal 3\/32/);
  assert.doesNotMatch(JSON.stringify(lage(view({snaps, keeper, owner: false, allowed: ['bot1']}))), /Bedarf|coal/);
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
assert.deepEqual([...REFRESHING], ['lage', 'bot', 'ov', 'botm']);
assert.equal(render({name: 'stopall'}, view()).exit_action.action.payload.a, 'lage');
assert.equal(text(render({name: 'nonsense'}, view({snaps: []})).title), 'Kommandostand');
assert.equal(safe('a§cb\u0007c\n d', 99), 'a b c d'.replace('a b', 'ab')); // colour code stripped, control chars become spaces
{ // an error older than 5 min is neither a problem nor shown on the Bot screen
  const old = work('bot1', {lastError: 'need 3 more iron_ingot', lastErrorAgoS: 400});
  assert.doesNotMatch(body(lage(view({snaps: [old]}))).join('\n'), /fehlen/); assert.doesNotMatch(body(bot(view({snaps: [old]}), 'bot1')).join('\n'), /fehlen/);
  const fresh = {...old, lastErrorAgoS: 200};
  assert.match(body(lage(view({snaps: [fresh]}))).join('\n'), /fehlen/); assert.match(body(bot(view({snaps: [fresh]}), 'bot1')).join('\n'), /fehlen/);
}
console.log('botui-screens ok');
{ // Ziele: owner gets toggles and one slider per quota, a restricted viewer only the sidebar and their trader chests
  const {ziele} = require('../botui-screens');
  const keeper = {state: () => ({available: true, enabled: true, quotas: [{item: 'logs', want: 64, have: 10}, {item: 'coal', want: 100, have: null}, {item: 'torch', want: 2000, have: 5}]})};
  const traderChests = {list: (b) => (b === 'MisaBot' ? {sticks: [{x: 1, y: 2, z: 3}], stores: []} : {sticks: [], stores: [{x: 4, y: 5, z: 6}]})};
  const v = view({keeper, traders: ['MisaBot', 'EM_Trader'], traderChests});
  const d = render({name: 'ziele'}, v);
  assert.deepEqual(d.inputs.map((i) => [i.key, i.end, i.initial]), [['want_logs', 256, 64], ['want_coal', 400, 100], ['want_torch', 4096, 2000]]);
  assert.ok(d.inputs.every((i) => i.type === 'minecraft:number_range' && i.start === 0 && i.step === 1));
  assert.ok(!REFRESHING.has('ziele'), 'an input screen never refreshes');
  assert.deepEqual(d.actions.filter((a) => a.action.payload?.a === 'keeper').map((a) => [a.action.payload.a, a.action.payload.on]), [['keeper', 0]]);
  assert.equal(d.actions.find((a) => a.label.text === 'Speichern').action.additions.a, 'saveziele');
  assert.deepEqual(d.actions.filter((a) => a.action.payload?.a === 'trader_del').map((a) => a.action.payload), [{a: 'trader_del', bot: 'MisaBot', kind: 'sticks', x: 1, y: 2, z: 3}, {a: 'trader_del', bot: 'EM_Trader', kind: 'stores', x: 4, y: 5, z: 6}]);
  const m = JSON.parse(JSON.stringify(render({name: 'ziele'}, view({keeper, owner: false, allowed: ['MisaBot'], traders: ['MisaBot', 'EM_Trader'], traderChests}))));
  assert.equal(m.inputs, undefined); assert.ok(!JSON.stringify(m).includes('keeper') && !JSON.stringify(m).includes('saveziele'));
  assert.deepEqual(m.actions.filter((a) => a.action.payload?.a === 'trader_del').map((a) => a.action.payload.bot), ['MisaBot']);
  assert.ok(m.actions.some((a) => a.action.payload?.a === 'sidebar'));
  { // the configured numbers; initial never above end
    const b = render({name: 'ziele'}, view({keeper: {state: () => ({available: true, enabled: true, quotas: [{item: 'planonly', want: 5, have: 0}], configured: [{item: 'logs', want: 64, have: 1}, {item: 'big', want: 9999, have: 1}]})}, traders: []}));
    assert.deepEqual(b.inputs.map((i) => [i.key, i.end, i.initial]), [['want_logs', 256, 64], ['want_big', 4096, 4096]]);
  }
  // the chest context offers Handelskiste buttons only for traders the viewer may command
  const gaze = {x: 7, y: 8, z: 9, block: 'chest'};
  const hk = (o) => render({name: 'auftrag'}, view({ctx: {gaze}, traders: ['MisaBot', 'EM_Trader'], ...o})).actions.filter((a) => a.action?.payload?.a === 'trader_add').map((a) => [a.action.payload.bot, a.action.payload.kind]);
  assert.deepEqual(hk({}), [['MisaBot', 'sticks'], ['MisaBot', 'stores'], ['EM_Trader', 'sticks'], ['EM_Trader', 'stores']]);
  assert.deepEqual(hk({owner: false, allowed: ['MisaBot']}).map((x) => x[0]), ['MisaBot', 'MisaBot']);
  assert.deepEqual(render({name: 'auftrag'}, view({ctx: {gaze: {...gaze, block: 'stone'}}, traders: ['MisaBot']})).actions.filter((a) => a.action?.payload?.a === 'trader_add'), []);
}
{ // Karte: six zoom buttons, "Mitte: ich" and one centre button per allowed bot; an input screen, so it never refreshes
  const snaps = [work('bot1'), work('MisaBot')];
  const pay = (d, a) => d.actions.filter((x) => x.action.payload?.a === a).map((x) => x.action.payload);
  assert.ok(!REFRESHING.has('karte'));
  assert.ok(lage(view({snaps})).actions.some((a) => a.action.payload?.a === 'karte'), 'Karte button is wired');
  const d = render({name: 'karte'}, view({snaps, mapState: {zoom: 10, center: 'bot1'}}));
  assert.deepEqual(pay(d, 'zoom').map((p) => p.z), [1, 2, 5, 10, 25, 50]);
  assert.deepEqual(pay(d, 'center'), [{a: 'center', me: 1}, {a: 'center', bot: 'bot1'}, {a: 'center', bot: 'MisaBot'}]);
  const m = render({name: 'karte'}, view({snaps, owner: false, allowed: ['MisaBot']}));
  assert.deepEqual(pay(m, 'center').map((p) => p.bot), [undefined, 'MisaBot']);
  const {markersOf} = require('../botui');
  const all = [work('bot1', {pos: [10, 64, -5]}), work('MisaBot', {pos: [1, 70, 2], dimension: 'the_nether'}), idle('EM'), off('gone'), work('dead1', {dead: true}), work('bad', {pos: [NaN, 0, 0]})];
  assert.deepEqual(markersOf(all, ['MisaBot']), [{x: 1, z: 2, dim: 'the_nether', kind: 'work', label: 'MisaBot'}]);
  assert.deepEqual(markersOf(all, '*').map((k) => [k.label, k.kind]), [['bot1', 'work'], ['MisaBot', 'work'], ['EM', 'idle'], ['dead1', 'bad']]);
}
{ // helpers in the sandbox work in another world than the viewer's: marked, counted apart, listed last, off the map
  const {ziele} = require('../botui-screens');
  const {markersOf, placeBots} = require('../botui');
  const sb = (n, over) => ({...idle(n), sandbox: true, ...over});
  const snaps = [sb('bot1', {isDay: false}), work('bot19'), sb('bot2')];
  const d = lage(view({snaps}));
  assert.equal(body(d)[0], '1 Bots · 1 arbeiten · 0 frei · 2 in der Sandbox · Tag', 'day and night come from the viewer\'s world');
  assert.deepEqual(botButtons(d).map((b) => b.action.payload.bot), ['bot19', 'bot1', 'bot2']);
  assert.match(labels(d)[0], /^● bot19 +Baumfarm/);
  assert.match(labels(d)[1], /^● bot1 +Sandbox · frei$/);
  assert.match(text(botButtons(d)[1].tooltip), /In der Sandbox, nicht in deiner Welt/);
  assert.doesNotMatch(text(botButtons(d)[0].tooltip), /Sandbox/);
  assert.match(body(bot(view({snaps}), 'bot1')).join('\n'), /In der Sandbox, nicht in deiner Welt/);
  assert.doesNotMatch(body(bot(view({snaps}), 'bot19')).join('\n'), /Sandbox/);
  const err = sb('bot1', {lastError: 'light: no torches available', lastErrorAgoS: 10});
  assert.match(body(lage(view({snaps: [err, work('bot19')]}))).join('\n'), /bot1 \(Sandbox\): light/);

  const keeper = (have) => ({state: () => ({available: true, enabled: true, quotas: [{item: 'coal', want: 32, have}]})});
  assert.match(body(lage(view({snaps, keeper: keeper(1)}))).join('\n'), /Bedarf \(Sandbox\): coal 1\/32/);
  assert.match(body(lage(view({snaps, keeper: keeper(32)}))).join('\n'), /Alles auf Lager \(Sandbox\)/);
  assert.match(body(lage(view({snaps: [work('bot19')], keeper: keeper(1)}))).join('\n'), /Bedarf: coal 1\/32/);
  assert.equal(lage(view({snaps, keeper: keeper(32)})).body.find((b) => /Lager/.test(text(b.contents))).contents[1].color, 'green');
  assert.match(body(ziele(view({snaps, keeper: keeper(1)}))).join('\n'), /Daueraufträge laufen in der Sandbox, nicht in deiner Welt/);
  assert.doesNotMatch(body(ziele(view({snaps: [work('bot19')], keeper: keeper(1)}))).join('\n'), /Sandbox/);

  const who = render({name: 'job', key: 'goto'}, view({snaps})).inputs.find((i) => i.key === 'who');
  assert.deepEqual(who.options.map((o) => o.display.text), ['Erster freier Bot', 'Alle meine Bots', 'bot19', 'bot1 (Sandbox)', 'bot2 (Sandbox)']);

  const karte = render({name: 'karte'}, view({snaps})).actions.filter((a) => a.action.payload?.a === 'center').map((a) => a.action.payload.bot);
  assert.deepEqual(karte, [undefined, 'bot19'], 'no centre on a world the map does not show');
  assert.deepEqual(markersOf(snaps, '*').map((m) => m.label), ['bot19']);

  const named = [{name: 'bot1'}, {name: 'bot19'}, {name: 'MisaBot'}];
  assert.deepEqual(placeBots(named, {vhost: 'sandbox.bots', guests: ['MisaBot'], mainBots: ['bot19']}), [{name: 'bot1', guest: false, sandbox: true}, {name: 'bot19', guest: false, sandbox: false}, {name: 'MisaBot', guest: true, sandbox: false}]);
  assert.deepEqual(placeBots(named, {vhost: '', guests: ['MisaBot'], mainBots: []}).map((s) => s.sandbox), [false, false, false], 'without a sandbox nothing is marked');
}
// the plugin compares marker worlds with Bukkit's world keys
assert.deepEqual(['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].map(require('../world').normDim), ['overworld', 'the_nether', 'the_end']);
console.log('botui-screens karte ok');

{ // movement counters on the bot screen, and "wartet auf" for a waiting bot
  const s = work('bot1', {moves: {pullbacks: 0, noPath: 1, stalls: 0}});
  assert.ok(body(bot(view({snaps: [s]}), 'bot1')).includes('Wege/h: 0 Rücksetzer · 1 kein Weg · 0 fest'));
  assert.ok(!body(bot(view({snaps: [work('bot1')]}), 'bot1')).some((l) => l.startsWith('Wege/h')));
  const w = work('bot1', {activity: 'waiting: material stone_bricks'});
  assert.ok(JSON.stringify(lage(view({snaps: [w]}))).includes('wartet auf: material stone_bricks'));
  assert.ok(body(bot(view({snaps: [w]}), 'bot1')).includes('wartet auf: material stone_bricks'));
}
