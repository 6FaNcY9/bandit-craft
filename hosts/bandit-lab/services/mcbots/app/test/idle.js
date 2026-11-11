'use strict';
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
  const {IdleStore, idleToStart, resolveIdle, choiceOf, trackIdle, CHOICES, firstZone} = require('../idle');
  const orderloop = require('../orderloop');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mcbots-idle-'));
  try {
    assert.deepEqual(CHOICES.map((c) => c.id), ['holz', 'stein', 'wache', 'baumfarm', 'tiere', 'feld', 'keeper']);
    const file = path.join(dir, 'idle.json');
    let store = new IdleStore(file); // missing file
    assert.equal(store.get('MisaBot'), null);
    store.set('MisaBot', 'holz');
    store.set('bot1', 'wache', {x: 1, y: 64, z: -3});
    store = new IdleStore(file);
    assert.deepEqual(store.get('MisaBot'), {id: 'holz'});
    assert.deepEqual(store.get('bot1'), {id: 'wache', mark: {x: 1, y: 64, z: -3}});
    assert.throws(() => store.set('bot1', 'nope'), /unknown/);
    store.set('bot1', null);
    assert.equal(new IdleStore(file).get('bot1'), null);
    fs.writeFileSync(file, '{broken');
    assert.equal(new IdleStore(file).get('MisaBot'), null); // corrupt file: empty store

    const t0 = 1e6, idle = {online: true, job: null, queue: []};
    const snaps = new Map([['MisaBot', idle]]), idleSince = new Map(), retryAt = new Map(), busy = new Set();
    const run = (now) => idleToStart({snaps, store, busy, retryAt, idleSince, now});
    store.set('MisaBot', 'holz');
    trackIdle(snaps, idleSince, t0);
    assert.deepEqual(run(t0 + 59999), []);
    assert.equal(run(t0 + 60000)[0].bot, 'MisaBot');
    assert.equal(run(t0 + 60000)[0].choice.key, 'shiftlogs');
    busy.add('MisaBot'); assert.deepEqual(run(t0 + 90000), []); busy.clear();
    snaps.set('MisaBot', {...idle, job: {type: 'mine'}}); trackIdle(snaps, idleSince, t0 + 70000);
    assert.equal(idleSince.has('MisaBot'), false);
    snaps.set('MisaBot', idle); trackIdle(snaps, idleSince, t0 + 80000);
    assert.deepEqual(run(t0 + 100000), []); // the clock restarted
    store.set('MisaBot', 'keeper');
    assert.deepEqual(run(t0 + 200000), []); // keeper: no job of its own
    // idle: a failing pref waits ORDER_RETRY_MS
    store.set('MisaBot', 'holz');
    assert.equal(run(t0 + 200000).length, 1);
    retryAt.set('MisaBot', t0 + 200000 + orderloop.ORDER_RETRY_MS);
    assert.deepEqual(run(t0 + 200000 + orderloop.ORDER_RETRY_MS - 1), []);
    assert.equal(run(t0 + 200000 + orderloop.ORDER_RETRY_MS).length, 1);
    // offline, queue, held (the server passes held bots as busy)
    snaps.set('MisaBot', {...idle, online: false}); assert.deepEqual(run(t0 + 500000), []);
    snaps.set('MisaBot', {...idle, connected: false}); assert.deepEqual(run(t0 + 500000), []);
    snaps.set('MisaBot', {...idle, queue: [{}]}); assert.deepEqual(run(t0 + 500000), []);
    snaps.set('MisaBot', idle); idleSince.set('MisaBot', t0);
    assert.equal(run(t0 + 500000).length, 1);
    busy.add('MisaBot'); assert.deepEqual(run(t0 + 500000), []); busy.clear();
    // resolveIdle
    const own = choiceOf('holz'), box = {x1: 0, z1: 0, x2: 9, z2: 9}, c1 = {x: 1, y: 2, z: 3}, sup = {x: 7, y: 8, z: 9};
    assert.deepEqual(resolveIdle(own, {chest: c1, guest: true, supplyChest: sup}).chest, c1);
    assert.deepEqual(resolveIdle(own, {guest: false, supplyChest: sup}).chest, sup);
    assert.throws(() => resolveIdle(own, {guest: true, supplyChest: sup}), /^Error: no chest$/);
    assert.throws(() => resolveIdle(own, {chest: c1, away: (c) => c.x === 1}), /^Error: chest unreachable$/);
    assert.deepEqual(resolveIdle(own, {chest: c1, away: () => false}).chest, c1);
    const zones = [{name: 'w', kind: 'wheat', box}, {name: 't', kind: 'treefarm', box}, {name: 'p', kind: 'pen', box}, {name: 'f', kind: 'field', box, crop: 'carrot'}];
    const zoneOf = (kind) => firstZone(zones, kind);
    assert.deepEqual(resolveIdle(choiceOf('baumfarm'), {zoneOf}).zone, box);
    assert.throws(() => resolveIdle(choiceOf('baumfarm'), {zoneOf: () => null}), /^Error: keine Baumfarm-Zone$/);
    assert.deepEqual(resolveIdle(choiceOf('tiere'), {zoneOf}).zone, box);
    assert.throws(() => resolveIdle(choiceOf('tiere'), {zoneOf: () => null}), /^Error: keine Tier-Zone$/);
    assert.deepEqual([resolveIdle(choiceOf('feld'), {zoneOf}).zone, resolveIdle(choiceOf('feld'), {zoneOf}).crop], [box, 'carrot']);
    assert.throws(() => resolveIdle(choiceOf('feld'), {zoneOf: () => null}), /^Error: keine Feld-Zone$/);
    assert.throws(() => resolveIdle(choiceOf('feld'), {zoneOf: () => ({kind: 'field', box})}), /^Error: Feld ohne Frucht$/);
    // a guest's idle farm is only one on its own ground (server.js idleJob)
    const misa = require('../misa'), areas = [[100, 100, 120, 120, null, null, ['MisaBot']]];
    const far = {x1: 0, y1: 60, z1: 0, x2: 4, y2: 64, z2: 4}, mine = {x1: 101, y1: 60, z1: 101, x2: 105, y2: 64, z2: 105};
    const pens = [{name: 'a', kind: 'pen', box: far}, {name: 'b', kind: 'pen', box: mine}];
    const guestOk = (p) => !misa.groundRule(areas, 'MisaBot', 'animalfarm', p.box);
    assert.equal(firstZone(pens, 'pen', guestOk).name, 'b');
    assert.equal(firstZone(pens, 'pen').name, 'a');
    assert.equal(firstZone([pens[0]], 'pen', guestOk), null);
    assert.deepEqual(resolveIdle(choiceOf('wache'), {mark: c1}), {where: 'mark', radius: 16, at: c1});
    assert.throws(() => resolveIdle(choiceOf('wache'), {}), /Wache/);
    console.log('idle: ok');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})().catch((e) => { console.error(e); process.exit(1); });
