'use strict';
const assert = require('node:assert');
{ // pillars: the steps a bot climbed to a log come down again, only its own and only if unchanged (2026-10-10)
  const P = require('../pillars');
  const feet = {x: 10.5, y: 66, z: 20.5};
  assert.ok(P.isPillarStep({x: 0, y: 1, z: 0}, {x: 10, y: 65, z: 20}, feet), 'up from the block under the bot');
  assert.ok(!P.isPillarStep({x: 1, y: 0, z: 0}, {x: 9, y: 66, z: 20}, feet), 'a wall or bridge is no pillar');
  assert.ok(!P.isPillarStep({x: 0, y: 1, z: 0}, {x: 12, y: 65, z: 20}, feet), 'a block beside the bot is no pillar');
  const world = new Map([['10,66,20', 'cobblestone'], ['10,67,20', 'cobblestone'], ['10,68,20', 'dirt'], ['30,66,20', 'cobblestone'], ['10,69,20', 'cobblestone']]);
  const cells = new Map();
  for (const k of world.keys()) { const [x, y, z] = k.split(',').map(Number); P.record(cells, x, y, z, k === '10,68,20' ? 'cobblestone' : world.get(k)); }
  world.set('10,69,20', 'oak_planks'); // a player swapped it
  const blockAt = (x, y, z) => (world.has(`${x},${y},${z}`) ? {name: world.get(`${x},${y},${z}`)} : null);
  const due = (o) => P.due(cells, {blockAt, ...o}).map((c) => `${c.x},${c.y},${c.z}`);
  assert.deepStrictEqual(due({target: {x: 11, z: 20}}), ['30,66,20'], 'the ones near the next log stay');
  assert.strictEqual(cells.size, 3, 'a changed block is forgotten, not dug (10,68 was dirt, 10,69 is planks)');
  assert.deepStrictEqual(due({}), ['10,67,20', '10,66,20', '30,66,20'].sort((a, b) => b.split(',')[1] - a.split(',')[1]), 'tallest first');
  assert.deepStrictEqual(due({feet: {x: 10.5, y: 68, z: 20.5}}), ['30,66,20'], 'the cells under the bot stay (a walk ended on its pillar)');
  assert.strictEqual(cells.size, 3, 'and stay recorded');
  assert.deepStrictEqual(due({feet: {x: 20.5, y: 66, z: 20.5}, within: 5}), [], 'a walk digs back only what is within reach (30,66 is 10 away, 10,6x under 10 away)');
  assert.deepStrictEqual(due({feet: {x: 29.5, y: 66, z: 20.5}, within: 5}), ['30,66,20'], 'close ones still go');
  { // removal followed by a same-type replacement (Codex R7-4)
    const w2 = new Map([['5,60,5', 'cobblestone']]), c2 = new Map();
    P.record(c2, 5, 60, 5, 'cobblestone');
    P.changed(c2, 5, 60, 5, 'air', 'cobblestone'); // the bot's own placement arriving
    assert.strictEqual(c2.size, 1, 'own placement keeps the record');
    P.changed(c2, 5, 60, 5, 'cobblestone', 'cobblestone'); // the server sends the same block again (sandbox hut build left its bridge block standing)
    assert.strictEqual(c2.size, 1, 'a repeated update keeps the record');
    P.changed(c2, 5, 60, 5, 'cobblestone', 'air'); // a player removes it ...
    P.changed(c2, 5, 60, 5, 'air', 'cobblestone'); // ... and places their own
    assert.strictEqual(c2.size, 0);
    assert.deepStrictEqual(P.due(c2, {blockAt: (x, y, z) => ({name: w2.get(`${x},${y},${z}`)})}), [], 'the replacement is not dug');
  }
  { // the runner reports what stays standing, once
    const say = [], fake = {pillars: new Map(), emit: (k, x) => say.push(x)};
    P.record(fake.pillars, 3, 64, 4, 'dirt');
    require('../bots').BotRunner.prototype.reportScaffold.call(fake);
    require('../bots').BotRunner.prototype.reportScaffold.call(fake);
    assert.deepStrictEqual(say, ['scaffold left standing: 1 blocks: 3 64 4 dirt']);
  }
  { // unloaded cells are kept, take() hands them over and empties the map, the map is capped
    const c3 = new Map();
    P.record(c3, 1, 60, 1, 'dirt'); P.record(c3, 2, 60, 1, 'dirt');
    assert.deepStrictEqual(P.due(c3, {blockAt: (x) => (x === 1 ? null : {name: 'stone'})}), [], 'unloaded: not due, not forgotten');
    assert.deepStrictEqual([...c3.keys()], ['1,60,1'], 'a loaded, different block is forgotten');
    assert.deepStrictEqual(P.take(c3).map((c) => c.x), [1]);
    assert.strictEqual(c3.size, 0);
    for (let i = 0; i < 600; i++) P.record(c3, i, 60, 0, 'dirt');
    assert.ok(c3.size === 512 && !c3.has('0,60,0') && c3.has('599,60,0'), 'oldest dropped at 512');
  }
  const {insideAreas} = require('../world');
  assert.strictEqual(due({protectedAt: (x, z, y) => insideAreas([[0, 0, 40, 40, 70, 80]], x, z, y)}).length, 3, 'under a zone with a height: still dug back');
  assert.deepStrictEqual(due({protectedAt: (x) => x === 10}), ['30,66,20'], 'never in a protected area');
  assert.strictEqual(cells.size, 1);
  // open above: sky or a tree's leaves yes; a stone roof or unloaded blocks no
  const sky = (roof) => (x, y, z) => (roof && y === roof.y ? {name: roof.name, boundingBox: 'block'} : {name: 'air', boundingBox: 'empty'});
  assert.ok(P.openAbove(sky(null), 0, 66, 0));
  assert.ok(P.openAbove(sky({y: 72, name: 'oak_leaves'}), 0, 66, 0));
  assert.ok(!P.openAbove(sky({y: 80, name: 'stone'}), 0, 66, 0));
  assert.ok(!P.openAbove(() => null, 0, 66, 0));
}
{ // server admin (admin.js): RCON packets, validation, restart, no agent access (2026-10-10)
  const AD = require('../admin');
  const net = require('node:net');
  const p = AD.encode(7, 2, 'list');
  assert.strictEqual(p.readInt32LE(0), 14); assert.strictEqual(p.length, 18);
  const dec = AD.decode(Buffer.concat([p, AD.encode(8, 0, 'hi'), Buffer.from([1, 2])]));
  assert.deepStrictEqual(dec.packets, [{id: 7, type: 2, body: 'list'}, {id: 8, type: 0, body: 'hi'}]);
  assert.strictEqual(dec.rest.length, 2, 'a partial packet stays buffered');
  assert.throws(() => AD.decode(Buffer.from([0xff, 0xff, 0xff, 0x7f, 0, 0, 0, 0])), /length/);
  for (const n of ['Steve_1', 'a'.repeat(16)]) assert.strictEqual(AD.build('kick', {name: n}), `minecraft:kick ${n}`);
  for (const n of ['', 'a'.repeat(17), 'a b', 'a\nop', 'x;y', 5, undefined]) assert.throws(() => AD.build('op', {name: n}), /name/);
  assert.strictEqual(AD.build('ban', {name: 'Bob', reason: 'griefing'}), 'minecraft:ban Bob griefing');
  assert.throws(() => AD.build('ban', {name: 'Bob', reason: 'a\nb'}), /reason/);
  assert.throws(() => AD.build('command', {cmd: 'say hi\nstop'}), /command/);
  assert.throws(() => AD.build('command', {cmd: 'x'.repeat(201)}), /command/);
  assert.strictEqual(AD.build('command', {cmd: '/list'}), 'list');
  assert.throws(() => AD.build('time', {value: 'noon'}), /day or night/);
  assert.throws(() => AD.build('rm', {}), /unknown/);
  assert.deepStrictEqual(AD.parse.players('There are 3 of a max of 12 players online: bot1, Steve, bot2'), ['bot1', 'Steve', 'bot2']);
  assert.deepStrictEqual(AD.parse.players('There are 0 of a max of 12 players online: '), []);
  assert.deepStrictEqual(AD.parse.bans('Bob was banned by Console: x\nAl was banned by Console: y'), ['Bob', 'Al']);
  const t = AD.parse.tps('§6TPS from last 1m, 5m, 15m: §a19.98, §a20.0, §a*20.0\nCurrent Memory Usage: 3,459/8,192 mb (Max: 8192 mb)');
  assert.deepStrictEqual([t.tps, t.memUsedMb, t.memTotalMb], [[19.98, 20, 20], 3459, 8192]);
  // the client against a fake server that behaves like Minecraft's: it drops a client whose read holds
  // more than one packet, and splits a long reply into 4096-byte pieces
  const piece = 'x'.repeat(4096);
  const srv = net.createServer((s) => {
    s.on('data', (d) => {
      const r = AD.decode(d);
      if (r.packets.length !== 1 || r.rest.length) return s.destroy();
      const q = r.packets[0];
      if (q.type === 3) s.write(AD.encode(q.body === 'pw' ? q.id : -1, 2, ''));
      else if (q.type === 2 && q.body === 'exact') s.write(AD.encode(q.id, 0, piece)); // exactly one full piece
      else if (q.type === 2) { s.write(AD.encode(q.id, 0, piece)); s.write(AD.encode(q.id, 0, `echo ${q.body}`)); }
      else s.write(AD.encode(q.id, 0, 'Unknown request 64'));
    });
  });
  srv.listen(0, '127.0.0.1', async () => {
    const o = {host: '127.0.0.1', port: srv.address().port, password: 'pw'};
    const call = AD.queued(o);
    assert.deepStrictEqual(await call(['a', 'b']), [`${piece}echo a`, `${piece}echo b`]);
    assert.deepStrictEqual(await call(['exact', 'b']), [piece, `${piece}echo b`], 'a reply of exactly 4096 bytes ends too (R7-7)');
    await assert.rejects(AD.rcon({...o, password: 'bad'}, ['a']), /refused the password/);
    // the Admin actions: events log, restart countdown and cancel
    const sent = [], timers = [];
    const events = new (require('../events').EventLog)();
    const ad = new AD.Admin({call: async (c) => { sent.push(...c); return c.map(() => 'ok'); }, events, botNames: ['bot1'], setTimer: (f, ms) => timers.push({f, ms}) && timers.length, clearTimer: () => {}});
    assert.ok(ad.isBot('bot1') && ad.isBot('bot17') && !ad.isBot('Steve'));
    await ad.act('kick', {name: 'Steve', reason: 'afk'});
    assert.ok(events.since(0).some((e) => e.bot === 'admin' && /admin: kick Steve/.test(e.text)));
    await assert.rejects(ad.act('kick', {name: 'a b'}), /name/);
    await ad.act('restart');
    assert.deepStrictEqual(timers.map((x) => x.ms), [0, 30000, 50000, 60000]);
    await assert.rejects(ad.act('restart'), /already/);
    await ad.act('restart-cancel');
    await ad.act('restart');
    srv.close();
  });
  const A2 = require('../agentauth');
  for (const [m, u] of [['GET', '/api/admin/status'], ['GET', '/api/admin/query'], ['GET', '/api/admin/console'], ['POST', '/api/admin/action']]) assert.ok(!A2.agentEndpoint(m, u), `agent token must not reach ${u}`);
  const cfgAdmin = require('../config').loadConfig;
  assert.throws(() => cfgAdmin({BOT_NAMES: 'bot1', RCON_HOST: 'minecraft'}), /RCON_HOST and RCON_PASSWORD/);
  assert.deepStrictEqual(cfgAdmin({BOT_NAMES: 'bot1', RCON_HOST: 'minecraft', RCON_PASSWORD: 'x', BOT_PASSWORD_SEED: 's'}).rcon, {host: 'minecraft', port: 25575, password: 'x'});
}
{ // block log: what counts, dedupe, aggregation, export, persistence, bot hook
  const B = require('../blocklog');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {EventEmitter} = require('node:events');
  assert.strictEqual(B.classify('stone', 'air'), 'removed');
  assert.strictEqual(B.classify('air', 'oak_planks'), 'built');
  assert.strictEqual(B.classify('stone', 'oak_planks'), 'built');
  assert.strictEqual(B.classify('stone', 'water'), 'removed');
  for (const [a, b] of [['wheat', 'wheat'], ['air', 'water'], ['water', 'lava'], ['lava', 'air'], ['cave_air', 'air'], [null, 'stone'], ['stone', undefined]]) assert.strictEqual(B.classify(a, b), null, `${a}>${b}`);
  assert.deepStrictEqual(B.areaBoxes([], ''), [B.DEFAULT_AREA]);
  assert.deepStrictEqual(B.areaBoxes([{dim: 'overworld', box: {x1: 0, z1: 0, x2: 4, z2: 4}}, {dim: 'the_nether', box: {x1: 99, z1: 99, x2: 99, z2: 99}}], ''), [{x1: -16, z1: -16, x2: 20, z2: 20}]);
  assert.deepStrictEqual(B.areaBoxes([], '5,6,1,2'), [{x1: 1, z1: 2, x2: 5, z2: 6}]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocklog-'));
  let clock = 1e12;
  const file = path.join(dir, 'log.jsonl');
  const mk = () => new B.BlockLog({file, now: () => clock, areas: () => [{x1: 0, z1: 0, x2: 10, z2: 10}], max: 5});
  const log = mk();
  assert.ok(log.record({x: 1, y: 60, z: 1, from: 'air', to: 'stone', by: 'world'}));
  assert.ok(!log.record({x: 1, y: 60, z: 1, from: 'air', to: 'stone', by: 'bot3'}), 'same change seen by a second bot');
  assert.strictEqual(log.list[0].by, 'bot3', 'the named bot wins over "world"');
  assert.ok(!log.record({x: 50, y: 60, z: 1, from: 'air', to: 'stone'}), 'outside the area');
  assert.ok(!log.record({x: 2, y: 60, z: 2, from: 'water', to: 'air'}), 'flow');
  clock += 2500;
  assert.ok(log.record({x: 1, y: 60, z: 1, from: 'stone', to: 'air'}));
  assert.ok(log.record({x: 1, y: 60, z: 1, from: 'air', to: 'stone'}), 'the same change again after 2 s is a new one');
  for (let i = 0; i < 20; i++) log.record({x: 3, y: i, z: 3, from: 'air', to: 'dirt'});
  assert.ok(log.list.length <= 5 * 1.1 + 1, 'ring is capped');
  log.flush();
  assert.strictEqual(mk().list.length, 5, 'reloaded from the file, capped');
  fs.appendFileSync(file, '{"torn');
  assert.strictEqual(mk().list.length, 5, 'a torn last line is skipped');
  const big = new B.BlockLog({file: path.join(dir, 'rot.jsonl'), rotateBytes: 50, areas: () => [{x1: 0, z1: 0, x2: 10, z2: 10}]});
  big.record({x: 1, y: 1, z: 1, from: 'air', to: 'stone'}); big.record({x: 2, y: 1, z: 1, from: 'air', to: 'stone'}); big.flush();
  assert.ok(fs.existsSync(path.join(dir, 'rot.jsonl.1')) && !fs.existsSync(path.join(dir, 'rot.jsonl')), 'rotated');
  { // aggregation: last change per block, window, cap, newest first
    const t0 = 1e12, c = (x, t, from, to) => ({t, x, y: 1, z: 1, from, to, by: 'world'});
    const out = B.aggregate([c(1, t0 - 90000000, 'air', 'stone'), c(2, t0 - 5000, 'air', 'stone'), c(2, t0 - 1000, 'stone', 'air'), c(3, t0 - 3000, 'air', 'dirt')], {now: t0, windowMs: 86400000});
    assert.deepStrictEqual(out.map((e) => [e.x, e.k]), [[2, 'removed'], [3, 'built']], 'old dropped, block 2 ends removed');
    assert.strictEqual(B.aggregate([c(1, t0, 'air', 'stone'), c(2, t0 - 1, 'air', 'stone')], {now: t0, cap: 1}).length, 1);
  }
  { // export: written once, rewritten only on change, zones overworld boxes only
    const out = path.join(dir, 'web'); fs.mkdirSync(out);
    const places = [{name: 'Shaft', kind: 'shaft', dim: 'overworld', box: {x1: 0, y1: -40, z1: 0, x2: 3, y2: 60, z2: 3}}, {name: 'Home', kind: 'home', dim: 'overworld'}, {name: 'N', kind: 'base', dim: 'the_nether', box: {x1: 0, y1: 0, z1: 0, x2: 1, y2: 1, z2: 1}}];
    const ex = new B.Exporter({log: mk(), places: () => places, dir: out, now: () => clock});
    ex.tick();
    const ch = JSON.parse(fs.readFileSync(path.join(out, 'changes.json'), 'utf8')), zs = JSON.parse(fs.readFileSync(path.join(out, 'zones.json'), 'utf8'));
    assert.ok(ch.changes.length && ch.changes[0].k && 'x' in ch.changes[0] && ch.generated === clock);
    assert.deepStrictEqual(zs.zones.map((z) => z.name), ['Shaft']);
    const before = fs.statSync(path.join(out, 'zones.json')).mtimeMs;
    clock += 15000; ex.tick();
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'changes.json'), 'utf8')).generated, ch.generated, 'unchanged: not rewritten');
    assert.strictEqual(fs.statSync(path.join(out, 'zones.json')).mtimeMs, before);
  }
  { // the bot hook: own digs/places are attributed, other changes are "world", other dimensions are ignored
    const bot = new EventEmitter();
    bot.game = {dimension: 'minecraft:overworld'};
    bot.dig = async () => {}; bot.placeBlock = async () => {};
    const seen = [];
    B.watchBlocks(bot, 'bot7', (c) => seen.push(c), () => clock);
    const blk = (name, x, y, z) => ({name, position: {x, y, z}});
    bot.dig(blk('stone', 1, 2, 3));
    bot.emit('blockUpdate', blk('stone', 1, 2, 3), blk('air', 1, 2, 3));
    bot.placeBlock(blk('stone', 5, 5, 5), {x: 0, y: 1, z: 0});
    bot.emit('blockUpdate', blk('air', 5, 6, 5), blk('cobblestone', 5, 6, 5));
    bot.emit('blockUpdate', blk('air', 9, 9, 9), blk('stone', 9, 9, 9));
    bot.emit('blockUpdate', blk('water', 9, 9, 9), blk('air', 9, 9, 9));
    clock += 20000;
    bot.emit('blockUpdate', blk('stone', 1, 2, 3), blk('air', 1, 2, 3));
    bot.game.dimension = 'minecraft:the_nether';
    bot.emit('blockUpdate', blk('stone', 1, 2, 3), blk('air', 1, 2, 3));
    assert.deepStrictEqual(seen.map((c) => c.by), ['bot7', 'bot7', 'world', 'world']);
  }
  { // mineflayer installs dig/placeBlock after createBot: wrapping must still attribute (the log said "world" for every bot)
    const bot = new EventEmitter();
    bot.game = {dimension: 'minecraft:overworld'};
    const seen = [];
    B.watchBlocks(bot, 'bot8', (c) => seen.push(c), () => clock);
    bot.dig = async () => {}; bot.placeBlock = async () => {}; // the plugin, after the hook
    bot.emit('spawn');
    const blk = (name, x, y, z) => ({name, position: {x, y, z}});
    bot.dig(blk('stone', 1, 2, 3));
    bot.emit('blockUpdate', blk('stone', 1, 2, 3), blk('air', 1, 2, 3));
    assert.deepStrictEqual(seen.map((c) => c.by), ['bot8']);
  }
  fs.rmSync(dir, {recursive: true});
}
{ // worker block changes reach the hub's log through the observe frame, validated
  const {Hub} = require('../hub');
  const seen = [];
  const fake = {world: {noteChange: (c) => seen.push(c), noteMob() {}, noteBlock() {}, forgetMob() {}, noteStock() {}}};
  Hub.prototype.observe.call(fake, {bots: new Set(['bot3'])}, {changes: [
    {x: 1, y: 2, z: 3, from: 'air', to: 'stone', by: 'bot3'}, {x: 1, y: 2, z: 3, from: 'air', to: 'stone', by: 'bot99'},
    {x: 1.5, y: 2, z: 3, from: 'air', to: 'stone'}, {x: 1, y: 2, z: 3, from: 'a b', to: 'stone'}, 'junk']});
  assert.deepStrictEqual(seen.map((c) => c.by), ['bot3', 'world'], 'bad frames dropped, foreign bot names become "world"');
}
