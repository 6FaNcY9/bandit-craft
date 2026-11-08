'use strict';
// Auftrag: job catalog, gaze context, area corners, step 2 inputs and the send path (hostile payloads included).
const assert = require('node:assert/strict');
const {BotUi} = require('../botui');
const {JOBS, CRAFTS, SMELTS, ITEMS, contextJobs, build, areaJobs, resolveTarget, resolveBots, germanName} = require('../botui-jobs');
const {VALIDATE} = require('../bots');
const screens = require('../botui-screens');

const keys = (g) => contextJobs(g).map((j) => j.key);
const ore = {x: 5, y: 12, z: -7, block: 'iron_ore'}, chestG = {x: -271, y: 66, z: -214, block: 'chest'};
const ctx = {pos: [1.7, 64, -3.2], dim: 'overworld', yaw: 0, gaze: chestG, supply: {x: 10, y: 65, z: 10}};

{ // context
  assert.deepEqual(keys(ore), ['summon', 'mine', 'shift', 'goto', 'guard', 'tidy']);
  assert.deepEqual(contextJobs(ore)[1].preset, {block: 'iron_ore'});
  assert.deepEqual(keys(chestG).slice(1, 4), ['deposit', 'withdraw', 'stock']);
  assert.deepEqual(contextJobs(chestG)[1].preset, {x: -271, y: 66, z: -214});
  assert.deepEqual(keys(null), []); assert.deepEqual(keys(undefined), []); assert.deepEqual(keys({}), []);
  assert.deepEqual(keys({x: 1, y: 2, z: 3, block: 'oak_log'}).slice(1, 3), ['chop', 'shiftlogs']);
  assert.equal(keys({block: 'spawner'})[1], 'lightspawner');
  assert.equal(keys({block: 'farmland'})[1], 'wheatfarm');
  assert.equal(germanName('iron_ore'), 'Eisenerz'); assert.equal(germanName('some_new_block'), 'some new block');
}

{ // material for a plan, summon, aimed-at entities
  const env = {ctx: {gaze: null, pos: [3.4, 64, 4.9], dim: 'overworld'}, sel: {}, supply: {x: 10, y: 65, z: 10}, places: [], snaps: [{name: 'Bot1', online: true}], allowed: '*', schematics: ['house.litematic']};
    const pick = (key, data, extra = {}) => { const {type, args} = build(key, data, {...env, ...extra}); return {type, args}; };
  assert.deepEqual(pick('produce', {file: 'house.litematic', where: 'pos', rotation: 0, chest: 'supply'}).args,
    {file: 'house.litematic', origin: {x: 3, y: 64, z: 4}, rotation: 0, chests: [{x: 10, y: 65, z: 10}], store: {x: 10, y: 65, z: 10}});
  assert.deepEqual(pick('summon', {}), {type: 'goto', args: {x: 3, y: 64, z: 4}});
  assert.deepEqual(pick('followme', {}, {viewer: 'Midari'}), {type: 'follow', args: {player: 'Midari'}});
  assert.deepEqual(pick('hunt', {animal: 'cow', n: 3, x: 1, y: 2, z: 3}), {type: 'hunt', args: {animal: 'cow', count: 3, x: 1, y: 2, z: 3, radius: 24}});
  assert.throws(() => pick('hunt', {animal: 'creeper', x: 1, y: 2, z: 3}));
  assert.throws(() => pick('hunt', {animal: 'Cow!', x: 1, y: 2, z: 3}));
  const cow = {x: 1, y: 2, z: 3, block: 'air', entity: {type: 'cow', name: null, x: 1.5, y: 2, z: 3.2}};
  assert.deepEqual(contextJobs(cow, '*', 'Fancy').map((r) => r.key), ['summon', 'hunt', 'goto', 'guard', 'tidy']);
  assert.deepEqual(contextJobs(cow, '*', 'Fancy')[1].preset, {x: 1, y: 2, z: 3, animal: 'cow'});
  const bot = {x: 1, y: 2, z: 3, block: 'air', entity: {type: 'player', name: 'MisaBot', x: 1, y: 2, z: 3}};
  assert.deepEqual(contextJobs(bot, ['MisaBot'], 'Midari').slice(0, 2), [{key: 'summon', preset: {}}, {key: 'botscreen', preset: {bot: 'MisaBot'}}]);
  assert.ok(!contextJobs(bot, ['MisaBot'], 'Midari').some((r) => r.key === 'followme'));
  assert.deepEqual(contextJobs(bot, '*', 'Fancy', ['bot1', 'MisaBot']).slice(0, 2).map((r) => r.key), ['summon', 'botscreen']); // the owner: any of their bots
  assert.ok(!contextJobs({...bot, entity: {...bot.entity, name: 'bot1'}}, ['MisaBot'], 'Midari', ['MisaBot']).some((r) => r.key === 'botscreen')); // a foreign bot: no row
  const steve = {...bot, entity: {...bot.entity, name: 'Steve'}};
  assert.deepEqual(contextJobs(steve, ['MisaBot'], 'Midari').map((r) => r.key), ['summon', 'followme', 'goto', 'guard', 'tidy']);
  assert.ok(!contextJobs({...steve, entity: {...steve.entity, name: 'Midari'}}, ['MisaBot'], 'Midari').some((r) => r.key === 'followme'));
  assert.deepEqual(keys({x: 1, y: 2, z: 3, block: 'air'}), ['summon', 'goto', 'guard', 'tidy']);
}

{ // every job builds args its VALIDATE accepts
  const box = {x1: 0, z1: 0, x2: 4, z2: 4};
  const sel = {a: {x: 0, y: 60, z: 0, dim: 'overworld'}, b: {x: 6, y: 62, z: 6, dim: 'overworld'}};
  const values = {block: 'iron_ore', item: 'stick', n: 16, radius: 16, at: {x: 1, y: 64, z: 2}, chest: {x: 1, y: 64, z: 2}, file: 'a.litematic', rotation: 90, zone: box, animal: 'cow'};
  for (const [key, job] of Object.entries(JOBS)) {
    assert.doesNotThrow(() => VALIDATE[job.type](job.args(values, {sel, supply: {x: 1, y: 2, z: 3}, viewer: 'Midari', pos: [1, 64, 2], dim: 'overworld'})), key);
    assert.ok(job.label && typeof job.say(values) === 'string', key);
  }
  assert.deepEqual(JOBS.mine.args({block: 'iron_ore', n: 64.0}, ctx), {block: 'iron_ore', count: 64});
  assert.deepEqual(JOBS.mine.args({block: 'iron_ore', n: 63.9999}, ctx), {block: 'iron_ore', count: 64});
}

{ // offered items pass VALIDATE for their job; ender chests offer nothing chest-like
  for (const i of CRAFTS) assert.doesNotThrow(() => VALIDATE.craft({item: i, count: 1}), i);
  for (const i of SMELTS) assert.doesNotThrow(() => VALIDATE.smelt({item: i, count: 1}), i);
  for (const i of ITEMS) assert.doesNotThrow(() => VALIDATE.get({item: i, count: 1}) && VALIDATE.withdraw({item: i, count: 1, x: 0, y: 0, z: 0}), i);
  assert.deepEqual(keys({x: 1, y: 2, z: 3, block: 'ender_chest'}), ['summon', 'goto', 'guard', 'tidy']);
  assert.deepEqual(keys({x: 1, y: 2, z: 3, block: 'trapped_chest'}).slice(1, 4), ['deposit', 'withdraw', 'stock']);
}

{ // resolveTarget
  assert.deepEqual(resolveTarget('1 2 3', ctx), {x: 1, y: 2, z: 3, dim: 'overworld'});
  assert.deepEqual(resolveTarget('-4, 70, 9', ctx), {x: -4, y: 70, z: 9, dim: 'overworld'});
  assert.throws(() => resolveTarget('a b c', ctx), /Koordinaten/);
  assert.throws(() => resolveTarget('1 2', ctx), /Koordinaten/);
  assert.throws(() => resolveTarget('1 999 3', ctx), /außerhalb/);
  assert.throws(() => resolveTarget('gaze', {}), /keinen Block/);
  assert.deepEqual(resolveTarget('pos', ctx), {x: 1, y: 64, z: -4, dim: 'overworld'});
  const places = [{name: 'Nether', kind: 'base', dim: 'the_nether', x: 1, y: 2, z: 3}, {name: 'Verboten', kind: 'protected', dim: 'overworld', x: 1, y: 2, z: 3}];
  assert.equal(resolveTarget('place:Nether', ctx, places).dim, 'the_nether');
  assert.throws(() => resolveTarget('place:Verboten', ctx, places), /nicht gefunden/);
}

{ // resolveBots
  const s = (name, over = {}) => ({name, online: true, dead: false, job: null, queue: [], dimension: 'overworld', ...over});
  const snaps = [s('bot1', {job: {label: 'x'}}), s('bot2'), s('MisaBot'), s('bot4', {dimension: 'the_nether'}), s('bot5', {online: false})];
  assert.deepEqual(resolveBots('frei', snaps, '*'), ['bot2']);
  assert.deepEqual(resolveBots('frei', snaps, ['MisaBot']), ['MisaBot']);
  assert.deepEqual(resolveBots('alle', snaps, '*', 'overworld'), ['bot1', 'bot2', 'MisaBot']);
  assert.throws(() => resolveBots('frei', [s('a', {job: {}})], '*'), /^Error: Kein freier Bot$/);
  assert.throws(() => resolveBots('frei', [s('a', {dimension: 'the_end'})], '*', 'overworld'), /in dieser Welt/);
  assert.throws(() => resolveBots('bot1', snaps, ['MisaBot']), /nicht dein Bot/);
  assert.throws(() => resolveBots('bot4', snaps, '*', 'overworld'), /bot4 ist in einer anderen Welt/);
  assert.deepEqual(resolveBots('bot4', snaps, '*'), ['bot4']);
}

{ // the viewer plays on main: a free pick stays in their world and off a guest's bots; a helper in the sandbox only by name and without a place
  const {build} = require('../botui-jobs');
  const s = (name, over = {}) => ({name, online: true, dead: false, job: null, queue: [], dimension: 'overworld', ...over});
  const snaps = [s('bot1', {sandbox: true}), s('MisaBot', {guest: true}), s('bot19'), s('bot2', {sandbox: true})];
  assert.deepEqual(resolveBots('frei', snaps, '*'), ['bot19']);
  assert.deepEqual(resolveBots('alle', snaps, '*'), ['bot19']);
  assert.deepEqual(resolveBots('frei', snaps, ['MisaBot']), ['MisaBot'], 'a guest keeps their own bots');
  assert.deepEqual(resolveBots('MisaBot', snaps, '*', 'overworld'), ['MisaBot'], 'the owner may still name a guest bot');
  assert.throws(() => resolveBots('frei', [s('bot1', {sandbox: true})], '*'), /^Error: Kein freier Bot in deiner Welt$/);
  assert.throws(() => resolveBots('bot1', snaps, '*', 'overworld'), /^Error: bot1 ist in der Sandbox, nicht in deiner Welt$/);
  assert.deepEqual(resolveBots('bot1', snaps, '*'), ['bot1'], 'a named helper may still take a job without a place');
  const env = {ctx: {gaze: null, pos: [1, 64, 2], dim: 'overworld'}, sel: {}, supply: null, places: [], snaps, allowed: '*', schematics: []};
  assert.throws(() => build('goto', {where: 'pos', who: 'bot1'}, env), /bot1 ist in der Sandbox/);
  assert.deepEqual(build('goto', {where: 'pos', who: 'frei'}, env).bots, ['bot19']);
}

{ // areaJobs
  const sel = (b) => ({a: {x: 0, y: 60, z: 0, dim: 'overworld'}, b: {...b, dim: b.dim || 'overworld'}});
  assert.deepEqual(areaJobs({a: {x: 0, y: 0, z: 0}, b: null}), []);
  const by = (list) => Object.fromEntries(list.map((j) => [j.key, j]));
  let r = by(areaJobs(sel({x: 8, y: 64, z: 8})));
  assert.ok(r.excavate.ok && r.clear.ok && r.light.ok && r.shaft.ok && r.seal.ok);
  r = by(areaJobs(sel({x: 20, y: 60, z: 20})));
  assert.equal(r.excavate.ok, false); assert.match(r.excavate.why, /9 x 9 x 5/); assert.equal(r.clear.ok, true);
  r = by(areaJobs(sel({x: 40, y: 60, z: 40})));
  assert.equal(r.clear.ok, false); assert.equal(r.light.ok, true);
  r = by(areaJobs(sel({x: 1, y: 60, z: 1})));
  assert.equal(r.shaft.ok, false); // 2 x 2 is under the minimum
  assert.ok(areaJobs(sel({x: 8, y: 64, z: 8, dim: 'the_nether'})).every((j) => !j.ok && j.why === 'Ecken in verschiedenen Welten'));
}

// --- the hub side: BotUi with a recording fetch, events fed straight into handle()
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(text).join('') : c && typeof c === 'object' ? (c.text || '') + text(c.extra) : '');
const base = {online: true, dead: false, health: 20, food: 18, freeSlots: 12, pos: [10, 64, -5], dimension: 'overworld', isDay: true, inventory: [], queue: [], armour: [null, null, null, null], lastError: null, lastErrorAgoS: null, activity: 'idle', job: null};
const harness = (over = {}) => {
  const calls = [], submits = [];
  const snaps = [{...base, name: 'bot1'}, {...base, name: 'bot2'}, {...base, name: 'MisaBot'}];
  let id = 0;
  const fetch = async (url, o) => { calls.push({path: new URL(url).pathname, body: o.body && JSON.parse(o.body)}); return {ok: true, json: async () => ({ok: true})}; };
  const api = {snapshots: () => snaps, places: () => over.places || [], schematics: async () => [{file: 'house.litematic', size: {x: 1, y: 1, z: 1}, offset: {x: 0, y: 0, z: 0}, blocks: 1, top: 'stone', mtime: 1, owner: null}], keeper: {state: () => ({chest: {x: 10, y: 65, z: 10}})},
    submit: (v, j) => { if (over.fail) throw new Error(over.fail); submits.push({v, ...j}); return {ok: true, unreached: []}; }, stopAll: () => ({})};
  const ui = new BotUi({url: 'http://x', token: 't', viewerBots: {Fancy: '*', Midari: ['MisaBot']}, api, log: () => {}, fetch});
  const ev = (type, player, extra = {}) => ui.handle({id: ++id, type, player, pos: [1, 64, 1], dim: 'overworld', yaw: 0, gaze: chestG, ...extra});
  const click = (player, data, extra) => ev('click', player, {data, ...extra});
  const shown = () => calls.filter((c) => c.path === '/show').map((c) => JSON.parse(c.body.dialog));
  return {ui, calls, submits, snaps, ev, click, shown, last: () => shown().at(-1)};
};
const btn = (d, label) => d.actions.find((a) => text(a.label) === label);
const inputKeys = (d) => (d.inputs || []).map((i) => i.key);
const flashOf = (d) => d.body.map((b) => text(b.contents)).find((t) => /^[✔✖]/.test(t));

(async () => {
  { // step 1 with context; the Lagebild names the gazed block
    const h = harness();
    await h.ev('lage', 'Fancy');
    await h.click('Fancy', {a: 'oldmenu'}); // the old dialog is still one click away
    assert.equal(text(btn(h.last(), 'Auftrag: Truhe ▸').label), 'Auftrag: Truhe ▸');
    await h.click('Fancy', {a: 'new'});
    const d = h.last();
    assert.equal(d.columns, 2);
    assert.match(text(d.body[0].contents), /^Du schaust auf: Truhe \(-271 66 -214\)$/);
    const ls = d.actions.map((a) => text(a.label));
    assert.deepEqual(ls.slice(0, 7), ['Hierher rufen', 'Hier einlagern', 'Hier entnehmen', 'Hier zählen', 'Als Kiste merken', 'Hierhin gehen', 'Hier bewachen']);
    assert.equal(d.actions[1].label.color ?? d.actions[1].label.extra?.[0]?.color ?? 'gold', 'gold');
    assert.equal(ls.at(-1), 'Zurück'); assert.equal(d.actions.at(-1).action.payload.a, 'lage');
    assert.ok(ls.includes('Bereich wählen') && !ls.includes('Raum graben'));
    assert.deepEqual(d.actions[1].action.payload, {a: 'job', key: 'deposit', x: -271, y: 66, z: -214});
    assert.equal(text(d.exit_action.label), 'Schließen');
    assert.equal(d.inputs, undefined);
  }
  { // no gaze: no crash, no context buttons
    const h = harness();
    await h.ev('open', 'Fancy', {gaze: null});
    await h.click('Fancy', {a: 'new'}, {gaze: null});
    const d = h.last();
    assert.equal(text(d.body[0].contents), 'Du schaust auf nichts');
    assert.ok(!d.actions.some((a) => /Hier /.test(text(a.label))));
    assert.ok(d.actions.some((a) => text(a.label) === 'Besorgen'));
  }
  { // the auftrag screen offers Bereich wählen (aream) instead of corner buttons, and the area jobs once both corners are set
    const h = harness();
    await h.ev('lage', 'Fancy');
    await h.click('Fancy', {a: 'oldmenu'});
    await h.click('Fancy', {a: 'new'});
    assert.equal(btn(h.last(), 'Bereich wählen').action.payload.a, 'aream');
    h.ui.state('Fancy').sel = {a: {x: -271, y: 66, z: -214, dim: 'overworld'}, b: {x: -265, y: 70, z: -210, dim: 'overworld'}, dim: 'overworld'};
    await h.click('Fancy', {a: 'new'});
    const d = h.last();
    assert.ok(text(d.body[1].contents).startsWith('Bereich: 7 x 5 x 5'), text(d.body[1].contents));
    assert.ok(btn(d, 'Raum graben') && btn(d, 'Schacht'));
  }
  { // step 2 shows only that job's inputs plus Wer and Wann
    const h = harness();
    await h.click('Fancy', {a: 'job', key: 'mine', block: 'iron_ore'});
    let d = h.last();
    assert.deepEqual(inputKeys(d), ['n', 'who', 'when']);
    assert.match(d.body.map((b) => text(b.contents)).join('|'), /Eisenerz/);
    const n = d.inputs[0];
    assert.deepEqual([n.type, n.start, n.end, n.step], ['minecraft:number_range', 16, 2048, 16]);
    assert.deepEqual(d.inputs[1].options.map((o) => o.id), ['frei', 'alle', 'bot1', 'bot2', 'MisaBot']);
    assert.equal(d.inputs.find((i) => i.key === 'when').options.length, 2);
    const send = btn(d, 'Senden').action;
    assert.deepEqual([send.type, send.id, send.additions], ['minecraft:dynamic/custom', 'botui:do', {a: 'send', key: 'mine', block: 'iron_ore'}]);
    assert.ok(btn(d, 'Zurück'));
    await h.click('Fancy', {a: 'job', key: 'mine'});
    assert.deepEqual(inputKeys(h.last()), ['block', 'blockx', 'n', 'who', 'when']);
    assert.ok(h.last().inputs.every((i) => !i.max_length || i.max_length === 48));
    await h.click('Fancy', {a: 'job', key: 'craft'});
    assert.deepEqual(inputKeys(h.last()), ['item', 'itemx', 'n', 'who', 'when']);
    await h.click('Fancy', {a: 'job', key: 'schematic'});
    assert.deepEqual(inputKeys(h.last()), ['file', 'where', 'wheretext', 'rotation', 'who', 'when']);
    await h.click('Fancy', {a: 'job', key: 'help'});
    assert.deepEqual(inputKeys(h.last()), ['who', 'when']);
    await h.click('Fancy', {a: 'job', key: 'nope'});
    assert.match(h.ui.state('Fancy').flash.text, /unbekannter Auftrag/);
    await h.click('Fancy', {a: 'job', key: '__proto__'});
    assert.match(h.ui.state('Fancy').flash.text, /unbekannter Auftrag/);
    await h.click('Fancy', {a: 'quick', job: '__proto__', bot: 'bot1'});
    assert.match(h.ui.state('Fancy').flash.text, /unbekannter Auftrag/);
    await h.click('Fancy', {a: '__proto__'});
    assert.match(h.ui.state('Fancy').flash.text, /Unbekannte Aktion/);
  }
  { // send: deposit at the gazed chest; the result is the Lagebild's result line, no chat
    const h = harness();
    await h.click('Fancy', {a: 'job', key: 'deposit', x: -271, y: 66, z: -214});
    await h.click('Fancy', {a: 'send', key: 'deposit', x: -271, y: 66, z: -214, who: 'frei', when: 'next'});
    assert.deepEqual(h.submits[0], {v: 'Fancy', bots: ['bot1'], type: 'deposit', args: {x: -271, y: 66, z: -214}, replace: false});
    assert.equal(h.ui.state('Fancy').screen.name, 'lage');
    assert.equal(flashOf(h.last()), '✔ bot1: Einlagern');
    assert.ok(!h.calls.some((c) => /chat|say|tellraw/.test(c.path)));
  }
  { // send: slider float, Jetzt replaces, alle, text fields win
    const h = harness();
    await h.click('Fancy', {a: 'send', key: 'mine', block: 'iron_ore', n: 64.0000001, who: 'bot2', when: 'now'});
    assert.deepEqual(h.submits[0], {v: 'Fancy', bots: ['bot2'], type: 'mine', args: {block: 'iron_ore', count: 64}, replace: true});
    assert.equal(flashOf(h.last()), '✔ bot2: Eisenerz abbauen');
    await h.click('Fancy', {a: 'send', key: 'mine', block: 'stone', blockx: ' Coal_Ore ', n: 16, who: 'alle', when: 'next'});
    assert.deepEqual(h.submits[1].bots, ['bot1', 'bot2', 'MisaBot']); assert.equal(h.submits[1].args.block, 'coal_ore'); assert.equal(h.submits[1].replace, false);
    assert.equal(flashOf(h.last()), '✔ 3 Bots: Kohleerz abbauen');
  }
  { // Misa cannot order bot1 (and cannot post a preset out of bounds)
    const h = harness();
    await h.click('Midari', {a: 'send', key: 'homebed', who: 'bot1', when: 'next'});
    assert.equal(h.submits.length, 0); assert.match(h.ui.state('Midari').flash.text, /nicht dein Bot/);
    await h.click('Midari', {a: 'send', key: 'homebed', who: 'frei', when: 'next'});
    assert.deepEqual(h.submits[0].bots, ['MisaBot']);
  }
  { // hostile payloads: refused with a flash, loop alive, nothing submitted
    const h = harness();
    const bad = [
      {key: 'mine', block: 'iron_ore', n: NaN}, {key: 'mine', block: 'iron_ore', n: 1e9}, {key: 'mine', block: 'x'.repeat(10240)},
      {key: 'mine', block: 'iron_ore', n: 16, blockx: '../etc'}, {key: 'deposit', x: 1e9, y: 66, z: 0}, {key: 'deposit', x: 1, y: 66, z: NaN},
      {key: 'goto', where: 'a b c'}, {key: 'goto', wheretext: 'x'.repeat(10240)}, {key: 'schematic', file: '../../etc/passwd', where: 'pos'},
      {key: 'treefarm', zone: 'Nope'}, {key: 'excavate'}, {key: 'help', who: {}},
    ];
    for (const b of bad) {
      await h.click('Fancy', {a: 'send', who: 'frei', when: 'next', ...b});
      assert.match(h.ui.state('Fancy').flash.text, /^Geht nicht: /, JSON.stringify(b).slice(0, 80));
      assert.equal(h.ui.state('Fancy').flash.ok, false);
    }
    assert.equal(h.submits.length, 0);
    await h.click('Fancy', {a: 'send', key: 'help', who: 'frei', when: 'next'}); // still alive
    assert.equal(h.submits.length, 1);
  }
  { // API errors: English reasons are explained
    const h = harness({fail: 'no free iron_ore within 96 blocks (collected 0/64)'});
    await h.click('Fancy', {a: 'send', key: 'help', who: 'frei', when: 'next'});
    assert.match(h.ui.state('Fancy').flash.text, /^Geht nicht: nichts zu finden: iron_ore in Reichweite$/);
    const h2 = harness({fail: 'something unmapped'});
    await h2.click('Fancy', {a: 'send', key: 'help', who: 'frei', when: 'next'});
    assert.equal(h2.ui.state('Fancy').flash.text, 'Geht nicht: something unmapped');
    assert.equal(h2.ui.state('Fancy').screen.name, 'auftrag'); // a failed send never leaves a stale screen with a missing key
  }
  { // graves with nothing open: no success line
    const h = harness();
    h.ui.api.submit = () => ({ok: true, unreached: [], skipped: ['bot1']});
    await h.click('Fancy', {a: 'send', key: 'graves', who: 'bot1', when: 'next'});
    assert.equal(flashOf(h.last()), '✖ Keine offenen Gräber');
  }
  { // dimensions
    const h = harness();
    h.snaps[0].dimension = 'the_nether';
    await h.click('Fancy', {a: 'send', key: 'goto', where: 'gaze', who: 'bot1', when: 'next'});
    assert.match(h.ui.state('Fancy').flash.text, /bot1 ist in einer anderen Welt/);
    await h.click('Fancy', {a: 'send', key: 'goto', where: 'gaze', who: 'alle', when: 'next'});
    assert.deepEqual(h.submits[0].bots, ['bot2', 'MisaBot']);
    h.snaps.forEach((s) => { s.dimension = 'the_end'; });
    await h.click('Fancy', {a: 'send', key: 'goto', where: 'gaze', who: 'frei', when: 'next'});
    assert.match(h.ui.state('Fancy').flash.text, /Kein freier Bot in dieser Welt/);
    await h.click('Fancy', {a: 'send', key: 'help', who: 'frei', when: 'next'}); // no location: no such rule
    assert.equal(h.submits.length, 2);
  }
  { // area job sent from the selection clears it and the outline
    const h = harness();
    await h.click('Fancy', {a: 'aream'});
    h.ui.state('Fancy').sel = {a: {x: -271, y: 66, z: -214, dim: 'overworld'}, b: {x: -268, y: 68, z: -212, dim: 'overworld'}, dim: 'overworld'};
    await h.click('Fancy', {a: 'send', key: 'excavate', who: 'frei', when: 'next'});
    assert.deepEqual(h.submits[0].args, {x1: -271, y1: 66, z1: -214, x2: -268, y2: 68, z2: -212});
    assert.equal(h.ui.state('Fancy').sel.a, null);
    assert.deepEqual(h.calls.filter((c) => c.path === '/outline').at(-1).body.box, null);
  }
  { // open with a selection waiting shows step 1; a farm and a build resolve places and the supply chest
    const places = [{name: 'Eichen', kind: 'treefarm', dim: 'overworld', x: 0, y: 64, z: 0, box: {x1: 0, y1: 60, z1: 0, x2: 9, y2: 70, z2: 9}}, {name: 'Lager', kind: 'storage', dim: 'overworld', x: 3, y: 64, z: 4}];
    const h = harness({places});
    await h.click('Fancy', {a: 'send', key: 'treefarm', zone: 'Eichen', who: 'frei', when: 'next'});
    assert.deepEqual(h.submits[0].args, {x1: 0, z1: 0, x2: 9, z2: 9});
    await h.click('Fancy', {a: 'send', key: 'schematic', file: 'house.litematic', where: 'place:Lager', rotation: 90, who: 'frei', when: 'next'});
    assert.deepEqual(h.submits[1].args, {file: 'house.litematic', origin: {x: 3, y: 64, z: 4}, rotation: 90, chests: [{x: 10, y: 65, z: 10}]});
    await h.click('Fancy', {a: 'job', key: 'shift', block: 'iron_ore'});
    assert.deepEqual(h.last().inputs.find((i) => i.key === 'chest').options.map((o) => o.id), ['supply', 'place:Lager', 'gaze']);
    await h.click('Fancy', {a: 'send', key: 'shift', block: 'iron_ore', chest: 'supply', who: 'frei', when: 'next'});
    assert.deepEqual(h.submits[2].args, {block: 'iron_ore', x: 10, y: 65, z: 10});
    assert.equal(screens.REFRESHING.has('auftrag'), false); assert.equal(screens.REFRESHING.has('job'), false);
  }
  { // a guest (a bot list, not '*'): every job and target, but only her own bots (owner 2026-11-05: full control for Misa)
    const places = [{name: 'Heimatbasis', kind: 'base', x: 0, y: 64, z: 0, dim: 'overworld'}, {name: 'Eisenmine', kind: 'storage', x: 5, y: 60, z: 5, dim: 'overworld'}, {name: 'Baumfeld', kind: 'treefarm', x: 9, y: 64, z: 9, box: {x1: 0, z1: 0, x2: 4, z2: 4}}];
    const h = harness({places});
    const base = {who: 'frei', when: 'next', n: 16, block: 'iron_ore', item: 'stick', file: 'house.litematic', zone: 'Baumfeld', where: 'pos', chest: 'supply'};
    for (const key of ['mine', 'chop', 'craft', 'get', 'smelt', 'rearm', 'withdraw', 'schematic', 'treefarm', 'goto']) {
      await h.click('Midari', {...base, a: 'send', key});
      assert.equal(h.submits.at(-1)?.type, JOBS[key].type, `${key}: ${h.ui.state('Midari').flash?.text}`); assert.deepEqual(h.submits.at(-1).bots, ['MisaBot']);
    }
    for (const where of ['supply', 'place:Heimatbasis']) { await h.click('Midari', {...base, a: 'send', key: 'goto', where, wheretext: ''}); assert.equal(h.submits.at(-1).type, 'goto', where); }
    const n = h.submits.length;
    await h.click('Midari', {...base, a: 'send', key: 'mine', who: 'bot1'}); // never someone else's bot
    assert.equal(h.submits.length, n); assert.match(h.ui.state('Midari').flash.text, /nicht dein Bot|nicht/);
    await h.click('Midari', {a: 'new'}); assert.ok(JSON.stringify(h.last()).includes('Bereich wählen'), 'area jobs too');
    await h.click('Midari', {a: 'job', key: 'goto'}); assert.ok(JSON.stringify(h.last()).includes('Vorratskiste'));
    await h.click('Midari', {a: 'stopall'}); assert.match(h.ui.state('Midari').flash.text, /Besitzer/); // server-wide stays the owner's
    // the owner is unchanged: places, supply chest, corners, Bedarf
    await h.ev('click', 'Fancy', {data: {a: 'job', key: 'goto'}});
    const o = JSON.stringify(h.last()); assert.ok(o.includes('Heimatbasis') && o.includes('Vorratskiste'));
    await h.click('Fancy', {a: 'new'}); assert.ok(JSON.stringify(h.last()).includes('Bereich wählen'));
  }
  { // Als Kiste merken: a chest gaze offers it, stone does not; only the viewer's own bots; flash names the spot
    assert.ok(keys(chestG).includes('setchest')); assert.ok(!keys({...chestG, entity: {type: 'cow', x: 1, y: 2, z: 3}}).includes('setchest'), 'entity aimed: no row'); assert.ok(!keys({x: 1, y: 2, z: 3, block: 'stone'}).includes('setchest'));
    assert.deepEqual(contextJobs(chestG, ['MisaBot'], 'Midari').find((r) => r.key === 'setchest').preset, {x: -271, y: 66, z: -214});
    const h = harness();
    await h.click('Midari', {a: 'send', key: 'setchest', x: -271, y: 66, z: -214, who: 'bot2', when: 'next'});
    assert.equal(h.submits.length, 0); assert.match(h.ui.state('Midari').flash.text, /nicht dein Bot/);
    await h.click('Midari', {a: 'send', key: 'setchest', x: -271, y: 66, z: -214, who: 'MisaBot', when: 'next'});
    assert.deepEqual(h.submits[0], {v: 'Midari', bots: ['MisaBot'], type: 'setchest', args: {x: -271, y: 66, z: -214}, replace: false});
    assert.equal(flashOf(h.last()), '✔ MisaBot: Kiste -271 66 -214');
    await h.click('Midari', {a: 'send', key: 'setchest', x: 1, y: 2, z: 3, who: 'MisaBot', when: 'now'}); // forged: not the gazed chest
    assert.equal(h.submits.length, 1); assert.match(h.ui.state('Midari').flash.text, /schau auf diese Kiste/);
    await h.click('Midari', {a: 'send', key: 'setchest', x: -271, y: 66, z: -214, who: 'MisaBot', when: 'now'}); // never replaces the running job
    assert.equal(h.submits[1].replace, false);
    await h.ev('click', 'Midari', {data: {a: 'send', key: 'setchest', x: -271, y: 66, z: -214, who: 'MisaBot'}, gaze: {x: -271, y: 66, z: -214, block: 'stone'}});
    assert.equal(h.submits.length, 2); assert.match(h.ui.state('Midari').flash.text, /schau auf diese Kiste/);
    assert.throws(() => VALIDATE.setchest({x: 1, y: 999, z: 3}));
    assert.deepEqual(VALIDATE.setchest({x: 1, y: 2, z: 3, junk: 1}), {x: 1, y: 2, z: 3});
  }
  console.log('botui-jobs ok');
})().catch((e) => { console.error(e); process.exit(1); });
