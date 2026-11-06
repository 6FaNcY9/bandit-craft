'use strict';
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
  const {IdleStore, idleToStart, trackIdle, CHOICES} = require('../idle');
  const agentauth = require('../agentauth');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mcbots-idle-'));
  try {
    assert.deepEqual(CHOICES.map((c) => c.id), ['holz', 'stein', 'wache', 'baumfarm', 'keeper']);
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
    retryAt.set('MisaBot', t0 + 200000 + agentauth.ORDER_RETRY_MS);
    assert.deepEqual(run(t0 + 200000 + agentauth.ORDER_RETRY_MS - 1), []);
    assert.equal(run(t0 + 200000 + agentauth.ORDER_RETRY_MS).length, 1);
    console.log('idle: ok');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})().catch((e) => { console.error(e); process.exit(1); });
