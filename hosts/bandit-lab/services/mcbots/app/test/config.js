'use strict';
const APP = require('node:path').join(__dirname, '..');
// Minimal self-check: config validation + job argument validation.
const assert = require('node:assert');
const {loadConfig} = require('../config');
const {VALIDATE} = require('../bots');
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BOT_AUTH: 'x'}), /BOT_AUTH/);
loadConfig({BOT_NAMES: 'bot1', BOT_AUTH: 'none'});
assert.throws(() => require('../config').loadWorkerConfig({HUB_URL: 'ws://127.0.0.1:1/worker', HUB_TOKEN: 't'.repeat(40), MC_HOST: 'h', BOT_AUTH: 'x'}, ['bot2']), /BOT_AUTH/);
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', MC_VHOST: 'bad host'}), /MC_VHOST/);
{ // sandbox console: same host as the main one only on another port (rehearsal forwarders on one gateway address)
  const rc = {BOT_NAMES: 'bot1', RCON_HOST: 'minecraft', RCON_PASSWORD: 'pw', SANDBOX_RCON_HOST: 'minecraft-sandbox', SANDBOX_RCON_PASSWORD: 'pw'};
  assert.strictEqual(loadConfig(rc).sandboxRcon.port, 25575, 'default port');
  assert.strictEqual(loadConfig({...rc, SANDBOX_RCON_PORT: '25580'}).sandboxRcon.port, 25580);
  assert.throws(() => loadConfig({...rc, SANDBOX_RCON_HOST: 'minecraft'}), /must differ/);
  assert.strictEqual(loadConfig({...rc, SANDBOX_RCON_HOST: 'minecraft', SANDBOX_RCON_PORT: '25580'}).sandboxRcon.host, 'minecraft');
  for (const bad of ['0', '65536', 'x', '1.5']) assert.throws(() => loadConfig({...rc, SANDBOX_RCON_PORT: bad}), /SANDBOX_RCON_PORT/, bad);
}
loadConfig({BOT_NAMES: 'bot1', MC_VHOST: 'sandbox.bots'});
assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1, bot22'}).names, ['bot1', 'bot22']);
for (const bad of ['bot', 'bot100', 'Bot1', 'steve', 'bot1,x']) assert.throws(() => loadConfig({BOT_NAMES: bad}), bad);
{ // config: proxies, the job board's, guest and main bots, in-game viewers; the owner's order loop
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', TRUSTED_PROXIES: '10.250.77.1, 172.22.0.1'}).trustedProxies, ['10.250.77.1', '172.22.0.1']);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', TRUSTED_PROXIES: 'evil.example'}), /IP addresses/);
  // the job board's bots: names, and never the plan's
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', BOARD_BOTS: 'bot2, bot19'}).boardBots, ['bot2', 'bot19']);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1'}).boardBots, [], 'no BOARD_BOTS: no board');
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BOARD_BOTS: 'steve'}), /BOARD_BOTS must be bot names/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PLAN_ENABLE: '1', PLAN_ROSTER: 'bot2', BOARD_BOTS: 'bot2'}), /plan bots: bot2/);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', GUEST_BOTS: 'MisaBot,bot23'}).guestBots, ['MisaBot', 'bot23']);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BOARD_BOTS: 'bot2', GUEST_BOTS: 'bot2'}), /GUEST_BOTS must be bot names outside/);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1'}).mainBots, []);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', MAIN_BOTS: 'bot19'}).mainBots, ['bot19']);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BOARD_BOTS: 'bot2', MAIN_BOTS: 'bot2'}), /MAIN_BOTS must be bot names outside/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', GUEST_BOTS: 'MisaBot', MAIN_BOTS: 'MisaBot'}), /MAIN_BOTS must be bot names outside/);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', INGAME_VIEWERS: 'a,b'}).ingameViewers, ['a', 'b']);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1'}).ingameViewers, ['fancy8869', 'MidariBread']);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1'}).viewerBots.MidariBread, ['MisaBot', 'EM_Trader']); // the default must not make the guest an owner
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', INGAME_VIEWERS: 'bad name!'}), /INGAME_VIEWERS/);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', INGAME_VIEWERS: 'a,b'}).viewerBots, {a: '*', b: '*'});
  {
    const c = loadConfig({BOT_NAMES: 'bot1', INGAME_VIEWERS: 'fancy8869=*;MidariBread=MisaBot,EM_Trader'});
    assert.deepStrictEqual(c.viewerBots, {fancy8869: '*', MidariBread: ['MisaBot', 'EM_Trader']});
    assert.deepStrictEqual(c.ingameViewers, ['fancy8869', 'MidariBread']);
  }
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', INGAME_VIEWERS: 'a=bad bot'}), /INGAME_VIEWERS/);
  assert.strictEqual(loadConfig({BOT_NAMES: 'bot1'}).botuiUrl, '');
  assert.strictEqual(loadConfig({BOT_NAMES: 'bot1', BOTUI_URL: 'http://minecraft:8099/', RCON_HOST: 'm', RCON_PASSWORD: 'p'}).botuiUrl, 'http://minecraft:8099');
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BOTUI_URL: 'http://minecraft:8099'}), /BOTUI_URL/);
  const A = require('../orderloop');
  // ... and a failure does not end it: the job starts again later (one exploded chest, 806 agent jobs, 2026-10-17)
  const order = {type: 'produce', args: {file: 'f'}}, at = (kind, text) => A.orderOutcome({kind, text}, order);
  assert.deepStrictEqual(at('done', 'finished: produce f (30 s)'), {end: true});
  assert.deepStrictEqual(at('fail', 'failed: produce f - no chest at -356 67 -191'), {retry: A.ORDER_RETRY_MS});
  assert.deepStrictEqual(at('fail', 'gave up: produce f (died 4 times)'), {retry: 4 * A.ORDER_RETRY_MS});
  assert.strictEqual(at('fail', 'failed: rearm -271 66 -214 - chest full'), null, 'a helper job is not the order');
  assert.strictEqual(at('info', 'failed: produce f'), null);
  assert.deepStrictEqual(A.orderOutcome({kind: 'fail', text: 'failed: produce f - x'}, {type: 'produce'}), {end: true}, 'saved without args (older file): ends');
  // a sweep starts idle bots' orders again, also after a restart forgot the failure (bot2 after the 11:19 deploy)
  const orders = new Map([['bot1', order], ['bot2', order], ['bot3', order], ['bot4', {type: 'produce'}], ['bot5', order], ['bot6', order]]);
  const snaps = {bot1: {online: true, job: null, queue: []}, bot2: {online: true, job: {type: 'produce'}, queue: []}, bot3: {online: false},
    bot4: {online: true, job: null, queue: []}, bot5: {online: true, job: null, queue: []}, bot6: {online: true, remote: true, connected: false, job: null, queue: []}};
  const waits = new Map([['bot5', 2000]]);
  assert.deepStrictEqual(A.ordersToStart(orders, (b) => snaps[b], waits, 1000).map(([b]) => b), ['bot1'], 'idle and online only, with args, after the wait');
  assert.deepStrictEqual(A.ordersToStart(orders, (b) => snaps[b], waits, 3000).map(([b]) => b), ['bot1', 'bot5'], 'the wait is over');
  // Three deaths within 30 min hold the order for 30 min (bot1 died 19 times in 3 h, main server 2026-10-19).
  const MIN = 60000;
  let d = A.deathLoop([], 0);
  assert.deepStrictEqual(d, {times: [0], hold: false});
  d = A.deathLoop(d.times, 10 * MIN);
  assert.strictEqual(d.hold, false);
  assert.strictEqual(A.deathLoop(d.times, 29 * MIN).hold, true, 'the third within 30 min');
  assert.deepStrictEqual(A.deathLoop(d.times, 29 * MIN).times, [], 'counting starts over after a hold');
  assert.strictEqual(A.deathLoop(d.times, 31 * MIN).hold, false, 'the first death is 31 min old: out of the window');
  assert.strictEqual(A.deathLoopAlert('bot1', {type: 'produce'}, 0), 'bot1 died 3 times in 30 min: its produce order waits 30 min');
  assert.strictEqual(A.deathLoopAlert('bot1', undefined, 9), 'bot1 died 3 times in 30 min: its 9 queued jobs are dropped', 'graves queued one by one (2026-10-20)');
  assert.match(A.deathLoopAlert('bot1', undefined, 0), /: nothing queued$/);
}
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', DASHBOARD_HOST: '0.0.0.0'}));
assert.ok(loadConfig({BOT_NAMES: 'bot1', DASHBOARD_HOST: '0.0.0.0', ALLOWED_TS_LOGINS: 'a@github'}).allowed.length);
assert.deepStrictEqual(VALIDATE.goto({x: '1', y: 64, z: -3}), {x: 1, y: 64, z: -3});
assert.throws(() => VALIDATE.goto({x: 'a', y: 1, z: 1}));
assert.deepStrictEqual(VALIDATE.goto({x: 5, z: -7}), {x: 5, z: -7}, 'a spot tapped on the map has no height');
assert.throws(() => VALIDATE.say({text: '/op me'}));
// A site given free by the owner (clearAll) is a plain true, else not set at all (2026-10-14).
{
  const base = {file: 'sorter.litematic', origin: {x: 1, y: 2, z: 3}, chests: [{x: 1, y: 2, z: 4}]};
  assert.strictEqual(VALIDATE.schematic({...base, clearAll: true}).clearAll, true);
  assert.ok(!('clearAll' in VALIDATE.schematic(base)) && !('clearAll' in VALIDATE.schematic({...base, clearAll: 'yes'})));
  assert.strictEqual(VALIDATE.produce({...base, clearAll: true, store: {x: 1, y: 2, z: 4}}).clearAll, true);
  // substitute: cheaper blocks of the same shape (the iron farm's smooth stone, 2026-10-15)
  assert.deepStrictEqual(VALIDATE.schematic({...base, substitute: {smooth_stone: 'cobblestone'}}).substitute, {smooth_stone: 'cobblestone'});
  assert.ok(!('substitute' in VALIDATE.schematic(base)) && !('substitute' in VALIDATE.schematic({...base, substitute: {}})));
  for (const bad of [{a: 'B'}, {'../x': 'stone'}, ['stone'], 'stone', Object.fromEntries(Array.from({length: 17}, (_, i) => [`b${'x'.repeat(i)}`, 'stone']))]) assert.throws(() => VALIDATE.schematic({...base, substitute: bad}), JSON.stringify(bad));
}
assert.throws(() => VALIDATE.mine({block: 'Iron Ore'}));
assert.throws(() => VALIDATE.mine({block: 'torch'}), /placed block/);
assert.throws(() => VALIDATE.mine({block: 'white_bed'}), /placed block/);
assert.deepStrictEqual(VALIDATE.mine({block: 'coal_ore', count: 3}), {block: 'coal_ore', count: 3});
assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', PROTECTED_AREAS: '10,5,-10,-5; 1,2,3,4'}).protectedAreas, [[-10, -5, 10, 5], [1, 2, 3, 4]]);
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PROTECTED_AREAS: '1,2,3'}));

// notify.js: real event shapes, safe formatting, delayed loss, and rolling rate limits.
{
  const {NtfyNotifier, TEN_MIN, HOUR, WORKER_LOSS} = require('../notify');
  const {EventLog} = require('../events');
  let now = 0;
  const sent = [];
  const options = {url: 'https://ntfy.example/', topic: 'mcbots', token: 'fixture', now: () => now,
    fetcher: (url, opts) => { sent.push({url, ...opts}); return Promise.resolve({body: {cancel: () => Promise.resolve()}}); }};
  const n = new NtfyNotifier(options);
  const event = (bot, kind, text) => n.event({bot, kind, text});
  event('bot1', 'death', 'died at 1 64 2: fell from a high place');
  assert.deepStrictEqual([sent[0].url, sent[0].headers.Authorization, sent[0].headers.Priority, sent[0].body],
    ['https://ntfy.example/mcbots', 'Bearer fixture', 'high', 'bot1 died at 1 64 2: fell from a high place']);
  event('bot1', 'death', 'died: lava');
  now = TEN_MIN - 1;
  event('bot1', 'death', 'died: lava');
  assert.strictEqual(sent.length, 1);
  now = TEN_MIN;
  event('bot1', 'death', 'died');
  assert.strictEqual(sent.length, 2, 'ten-minute boundary allows another message');
  assert.match(sent[1].body, /cause unknown/);
  event('bot2', 'fail', 'failed: mine stone 10 - no path at 1 2 3');
  event('bot2', 'job', 'started: mine stone 5');
  event('bot2', 'info', 'trying again');
  event('bot2', 'fail', 'failed: mine stone 5 - no path at 4 5 6');
  assert.match(sent.at(-1).body, /stuck after repeated failures/);
  event('bot3', 'fail', 'failed: mine - a');
  event('bot3', 'done', 'finished: goto 1 2 3 (2 s)');
  event('bot3', 'fail', 'failed: mine - a');
  assert.strictEqual(n.failures.get('bot3').count, 1, 'successful jobs clear the failure streak');
  event('bot4', 'fail', 'gave up: shaft 1 2 (died 4 times)');
  assert.match(sent.at(-1).body, /bot4 is stuck/);
  for (const type of ['shaft', 'excavate', 'level', 'treefarm']) {
    event(`bot-${type}`, 'done', `finished: ${type} 1 2 3 (20 s)`);
    assert.strictEqual(sent.at(-1).body, `bot-${type} finished ${type} 1 2 3`);
    assert.strictEqual(sent.at(-1).headers.Priority, 'default');
  }
  const beforeChest = sent.length;
  n.chest({}, ['full (0 free slots)', 'no food', 'no torches or coal', 'no pickaxes', 'no saplings']);
  assert.strictEqual(sent.length - beforeChest, 4, 'each requested chest warning has its own kind');
  n.chest({}, ['full (1 free slots)', 'no food', 'no torches or coal', 'no pickaxes']);
  assert.strictEqual(sent.length - beforeChest, 4, 'full slot-count changes do not trigger new alerts');
  event('bot5', 'disconnect', 'left the game');
  event('bot6', 'hub', 'worker laptop disconnected');
  now += WORKER_LOSS - 1;
  event('bot6', 'hub', 'worker laptop disconnected');
  n.tick();
  const beforeLoss = sent.length;
  now += 1;
  n.tick();
  assert.strictEqual(sent.length, beforeLoss + 1, 'duplicate disconnect preserves the first loss time');
  assert.deepStrictEqual([sent.at(-1).body, sent.at(-1).headers.Priority], ['bot6 worker disconnected for over 5 minutes', 'high']);
  event('bot7', 'hub', 'worker laptop disconnected');
  event('bot7', 'hub', 'worker laptop connected');
  now += WORKER_LOSS;
  n.tick();
  assert.strictEqual(sent.length, beforeLoss + 1, 'reconnect cancels pending worker loss; game disconnect is ignored');
  const cap = new NtfyNotifier(options);
  const beforeCap = sent.length;
  for (let i = 0; i < 31; i++) cap.send(`bot${i}`, 'death', 'x');
  assert.strictEqual(sent.length - beforeCap, 30);
  now += HOUR - 1;
  assert.strictEqual(cap.send('extra', 'death', 'x'), false);
  now += 1;
  assert.strictEqual(cap.send('extra', 'death', 'x'), true, 'rolling hour expires at its boundary');
  n.send('format', 'info', 'hello\n\u0000\rworld ' + 'x'.repeat(400));
  assert.ok(sent.at(-1).body.startsWith('hello world '));
  assert.strictEqual(sent.at(-1).body.length, 300);
  for (const overrides of [{url: ''}, {token: ''}, {url: 'http://ntfy.example'}]) {
    assert.strictEqual(new NtfyNotifier({...options, ...overrides}).send('bot1', 'x', 'off'), false);
  }
  { // the configured gateway (ntfy/default.nix) is plain http inside the Docker subnet (Codex R7-3)
    const sent = [];
    const g = new NtfyNotifier({...options, url: 'http://10.250.77.1:2586', fetcher: (u) => { sent.push(u); return Promise.resolve({}); }});
    assert.strictEqual(g.send('bot1', 'x', 'hi'), true);
    assert.strictEqual(sent[0], 'http://10.250.77.1:2586/' + encodeURIComponent(options.topic || 'mcbots'));
    for (const url of ['http://10.250.77.9:2586', 'http://10.250.78.1:2586', 'http://10.250.77.1.evil.example']) assert.strictEqual(new NtfyNotifier({...options, url}).send('bot1', 'x', 'off'), false, url);
  }
  assert.doesNotThrow(() => new NtfyNotifier({...options, fetcher: () => { throw Error('offline'); }}).send('bot1', 'x', 'x'));
  { // a road that stopped waits for the owner, so it reaches the phone; other alerts do not
    const h = new NtfyNotifier(options), before = sent.length;
    h.event({bot: 'bot2', kind: 'alert', text: 'highway: east stopped at 40 m: chest at 40 0 0'});
    assert.deepStrictEqual([sent.length, sent.at(-1).headers.Priority, sent.at(-1).body], [before + 1, 'high', 'highway: east stopped at 40 m: chest at 40 0 0']);
    h.event({bot: 'bot2', kind: 'alert', text: 'something else'});
    assert.strictEqual(sent.length, before + 1);
  }
  assert.doesNotThrow(() => new NtfyNotifier({...options, fetcher: () => Promise.reject(Error('offline'))}).send('bot1', 'x', 'x'));
  // Both local and sanitized remote events share this callback; notification errors cannot stop logging.
  const hooked = new EventLog({onAdd: (e) => n.event(e)});
  hooked.add('bot99', 'death', 'died: drowned');
  assert.match(sent.at(-1).body, /bot99 died: drowned/);
  assert.strictEqual(new EventLog({onAdd: () => { throw Error('offline'); }}).add('bot1', 'death', 'died').id, 1);
}
