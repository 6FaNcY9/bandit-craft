'use strict';
// Unit test for the sweep and the tracker, against a fake console: node tools/mcbots-railspeed/run.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {sweep, track, rig, unrig} = require('./run');

// A console with a cart that runs 40 m/s, and a clock that moves when the code sleeps.
function fake({failAfter = Infinity, gone = false} = {}) {
  const calls = [], sent = [], rows = [];
  let t = 0, ms = 0, n = 0;
  const reply = (c) => {
    if (c.startsWith('time query')) return `The game time is ${t} tick(s)`;
    if (c.startsWith('data get entity')) return gone ? 'No entity was found' : `Minecart has the following entity data: [${300 + t * 2}.5d, 200.0d, 10.5d]`;
    if (c.startsWith('execute if')) return 'Test passed';
    return 'ok';
  };
  const call = async (cmds) => {
    calls.push(cmds);
    sent.push(...cmds);
    if (++n > failAfter) throw new Error('network');
    return cmds.map(reply);
  };
  const sleep = async (d) => { ms += d; t += Math.round(d / 50); };
  return {calls, sent, rows, deps: {call, out: (r) => rows.push(r), now: () => ms, sleep}};
}

(async () => {
  // A row already in the results file is skipped, so a cut-off sweep resumes
  const a = fake();
  await sweep({...a.deps, done: new Set(['8/38']), speeds: [8], spacings: [38]});
  assert.equal(a.rows.length, 0);

  // Each row is one JSON line with its setting and analysis
  const b = fake();
  await sweep({...b.deps, speeds: [8], spacings: [38]});
  assert.equal(b.rows.length, 1);
  assert.deepEqual(Object.keys(b.rows[0]).slice(0, 2), ['speed', 'spacing']);
  assert.equal(b.rows[0].speed, 8);
  assert.equal(b.rows[0].spacing, 38);
  assert.equal(b.rows[0].sustained, 40);
  assert.equal(b.rows[0].reachedEnd, true);
  assert.equal(b.rows[0].derailed, false);

  // Every console call stays inside the limits, also at the densest spacing
  const dense = fake();
  await sweep({...dense.deps, speeds: [8], spacings: [2]});
  assert.ok(dense.calls.every((cmds) => cmds.length <= 64 && cmds.every((s) => s.length <= 1400)));

  // Rail is only laid again when the spacing changes
  const twice = fake();
  await sweep({...twice.deps, speeds: [8, 20], spacings: [38]});
  assert.equal(twice.sent.filter((s) => s.startsWith('fill 300 200 10')).length, 1, 'laid once');
  assert.equal(twice.rows.length, 2);

  // The chunks must be loaded before the first fill
  const order = b.sent.findIndex((s) => s.startsWith('execute if loaded'));
  assert.ok(order > -1 && order < b.sent.findIndex((s) => s.startsWith('fill')));
  assert.ok(b.sent.includes('execute if loaded 2300 200 10'));

  // Only the cart is sampled, its rider shares the tag
  assert.ok(b.sent.includes('data get entity @e[type=minecart,tag=rs,limit=1] Pos'));

  // However it ends, the rule goes back and the chunks are freed
  const c = fake({failAfter: 3});
  await assert.rejects(sweep({...c.deps, speeds: [100], spacings: [2], warn: () => {}}), /network/);
  assert.ok(c.sent.includes('gamerule max_minecart_speed 8'));
  assert.ok(c.sent.some((s) => s.startsWith('forceload remove 300 10 2300 10')));
  assert.equal(b.sent.at(-1), 'gamerule max_minecart_speed 8', 'a finished sweep too');

  // A restore that fails too does not hide the first error, and says what is left to do by hand
  const left = [];
  const c2 = fake({failAfter: 3});
  await assert.rejects(sweep({...c2.deps, speeds: [100], spacings: [2], warn: (s) => left.push(s)}), /network/);
  assert.ok(left.join('\n').includes('gamerule max_minecart_speed 8'));

  // A run that never ends gives up after 150 s and is still a row
  const stuck = fake();
  const stand = async (cmds) => cmds.map((s) => (s.startsWith('data get') ? 'Minecart has the following entity data: [400.5d, 200.0d, 10.5d]' : s.startsWith('execute') ? 'Test passed' : `The game time is ${stuck.deps.now() / 50} tick(s)`));
  await sweep({...stuck.deps, call: stand, speeds: [8], spacings: [38]});
  assert.equal(stuck.rows.length, 1);
  assert.equal(stuck.rows[0].reachedEnd, false);
  assert.equal(stuck.rows[0].lost, false);
  assert.equal(stuck.rows[0].sustained, 0);
  assert.ok(stuck.deps.now() >= 150000 && stuck.deps.now() < 160000);

  // A command the server refuses stops the sweep: a lane with a gap would read as a derail at that speed
  const refused = fake();
  const noFill = async (cmds) => cmds.map((s) => (s.startsWith('fill') ? 'That position is not loaded' : s.startsWith('execute') ? 'Test passed' : 'ok'));
  await assert.rejects(sweep({...refused.deps, call: noFill, speeds: [8], spacings: [38], warn: () => {}}), /not loaded/);
  assert.equal(refused.rows.length, 0);

  // Chunks that never load are an error, not an endless wait
  const never = fake();
  const noLoad = async (cmds) => cmds.map((s) => (s.startsWith('execute') ? 'Test failed' : 'ok'));
  await assert.rejects(sweep({...never.deps, call: noLoad, speeds: [8], spacings: [38], warn: () => {}}), /not loaded/);

  // A cart that vanished is a lost row, and the sweep goes on
  const e = fake({gone: true});
  await sweep({...e.deps, speeds: [8, 20], spacings: [38]});
  assert.equal(e.rows.length, 2);
  assert.equal(e.rows[0].lost, true);
  assert.equal(e.rows[0].sustained, null);

  // track reads the player's position until the time is up
  const f = fake();
  const s = await track({...f.deps, player: 'owner', ms: 2000});
  assert.ok(f.sent.includes('data get entity owner Pos'));
  assert.equal(typeof s.top, 'number');
  assert.equal(f.rows.length > 2, true, 'each sample goes out as it comes');

  // A player who left is reported, not a NaN
  const g = fake({gone: true});
  const none = await track({...g.deps, player: 'owner', ms: 2000});
  assert.equal(none.lost, true);
  assert.equal(none.top, null);

  // A ride lane is laid and checked with its chunks forced, and then they are freed: the rider loads them as on a real road
  const h = fake();
  await rig({...h.deps, kind: 'rail', speed: 100, spacing: 8});
  assert.ok(h.sent.includes('gamerule max_minecart_speed 100'));
  assert.ok(h.sent.includes('fill 300 200 40 5300 200 40 rail[shape=east_west]'));
  assert.ok(h.sent.includes('execute if block 5300 200 40 #minecraft:rails'));
  assert.ok(h.sent.at(-1).startsWith('forceload remove'));
  assert.ok(h.sent.findIndex((s) => s.startsWith('execute if block')) < h.sent.findIndex((s) => s.startsWith('forceload remove')));
  const ice2 = fake();
  await rig({...ice2.deps, kind: 'ice2'});
  assert.ok(ice2.sent.includes('execute if block 5300 199 50 blue_ice'));
  assert.ok(!ice2.sent.some((s) => s.startsWith('gamerule')), 'the rule is for rails');
  const ice1 = fake();
  await rig({...ice1.deps, kind: 'ice1'});
  assert.ok(ice1.sent.includes('execute if block 5300 199 60 blue_ice'));
  await assert.rejects(rig({...fake().deps, kind: 'gravel'}), /kind/);

  // The dip lane: a short start of boosters, then no gold, and something to board at each start
  const dip = fake();
  await rig({...dip.deps, kind: 'dip', speed: 200});
  assert.ok(dip.sent.includes('gamerule max_minecart_speed 200'));
  assert.ok(dip.sent.includes('setblock 596 200 70 powered_rail[shape=east_west,powered=true]'));
  assert.ok(!dip.sent.includes('setblock 604 200 70 powered_rail[shape=east_west,powered=true]'), 'boosters only for the first 300 blocks');
  assert.ok(dip.sent.includes('setblock 610 199 70 rail[shape=ascending_west]'));
  assert.ok(dip.sent.includes('execute if block 5300 200 70 #minecraft:rails'));
  assert.ok(dip.sent.includes('execute if block 610 199 70 rail[shape=ascending_west]'));
  assert.ok(dip.sent.some((s) => s.startsWith('summon minecart 302.5 200.1 70.5')));
  // What the owner boards has its own tag: a sweep's kill and its sampling must never reach it
  assert.ok(dip.sent.filter((s) => s.startsWith('summon')).every((s) => s.includes('Tags:["rslane"]')));
  assert.ok(ice2.sent.filter((s) => s.startsWith('summon')).every((s) => s.includes('Tags:["rslane"]')));
  assert.ok(h.sent.some((s) => s.startsWith('summon minecart 302.5 200.1 40.5')));
  assert.ok(ice2.sent.some((s) => s.startsWith('summon oak_boat 301 200 51')));
  assert.ok(ice1.sent.some((s) => s.startsWith('summon oak_boat 301 200 60.5')));

  // Taking all ride lanes away: loaded first because fill refuses unloaded chunks, with the floor under the dips and the platforms, and the rule back
  const gone2 = fake();
  await unrig({...gone2.deps});
  for (const z of [40, 50, 60, 70]) assert.ok(gone2.sent.includes(`fill 299 199 ${z - 2} 2482 201 ${z + 2} air`), `lane at z ${z}`);
  assert.ok(gone2.sent.includes('fill 299 198 70 5301 198 70 air'));
  assert.ok(gone2.sent.includes('fill 296 199 48 299 199 52 air'), 'the platform before the ice');
  assert.ok(gone2.sent.findIndex((s) => s.startsWith('forceload add')) < gone2.sent.findIndex((s) => s.startsWith('fill')));
  assert.equal(gone2.sent.at(-1), 'gamerule max_minecart_speed 8');
  assert.ok(gone2.sent.includes('kill @e[tag=rslane]'));
  assert.ok(!gone2.sent.includes('kill @e[tag=rs]'), 'a sweep may be at work with its own tag');

  // A far end that did not come out is an error, and the chunks are still freed
  const broken = fake();
  const noEnd = async (cmds) => { broken.sent.push(...cmds); return cmds.map((s) => (s.startsWith('execute if block') ? 'Test failed' : s.startsWith('execute') ? 'Test passed' : 'ok')); };
  await assert.rejects(rig({...broken.deps, call: noEnd, kind: 'ice1'}), /far end/);
  assert.ok(broken.sent.at(-1).startsWith('forceload remove'));

  // Ctrl-C twice: the second must not skip the restore. Against a local console, because the signal handling lives in the CLI.
  const seen = [];
  let child, pressed = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      const {commands} = JSON.parse(body);
      seen.push(...commands);
      if (!pressed && commands.some((c) => c.startsWith('fill'))) {
        pressed = true;
        child.kill('SIGINT');
        await new Promise((r) => setTimeout(r, 100));
        child.kill('SIGINT');
        await new Promise((r) => setTimeout(r, 200));
      }
      const reply = (c) => (c.startsWith('execute') ? 'Test passed' : c.startsWith('time') ? 'The game time is 1 tick(s)' : c.startsWith('data') ? 'Minecart has the following entity data: [301.5d, 200.0d, 10.5d]' : 'ok');
      res.end(JSON.stringify({replies: commands.map(reply)}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'railspeed-'));
  child = spawn(process.execPath, [path.join(__dirname, 'run.js'), 'sweep', '--speed', '8', '--spacing', '38'], {env: {...process.env, MCBOTS_URL: `http://127.0.0.1:${server.address().port}`, XDG_STATE_HOME: state}, stdio: 'ignore'});
  await new Promise((r) => child.once('exit', r));
  server.close();
  server.closeAllConnections();
  fs.rmSync(state, {recursive: true});
  assert.ok(pressed);
  assert.ok(seen.includes('gamerule max_minecart_speed 8'), 'the rule goes back');
  assert.ok(seen.some((s) => s.startsWith('forceload remove 300 10 2300 10')), 'the chunks are freed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
