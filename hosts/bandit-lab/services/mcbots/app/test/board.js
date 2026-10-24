'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// ---- board: slices, claims with heartbeat, takeover, failures, locks, restart, pause ----
{
  const {Board, CLAIM_MS} = require('../board');
  let t = 1000000;
  const now = () => t;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'board-')), 'board.json');
  const locked = (b) => (b.x1 <= 105 && b.x2 >= 100 ? 'base' : null);
  const board = new Board({file, now, locked});
  const box = {x1: 0, y1: 60, z1: 0, x2: 15, y2: 67, z2: 15};

  // 16 x 8 x 16 -> 4 slices of 4 wide covering the box exactly
  const job = board.create({kind: 'excavate', box, by: 'owner'});
  assert.strictEqual(job.parts.length, 4);
  const cells = new Set();
  for (const p of job.parts) {
    assert.ok(p.box.x2 - p.box.x1 + 1 <= 4 || p.box.z2 - p.box.z1 + 1 <= 4, 'a slice is at most 4 wide');
    for (let x = p.box.x1; x <= p.box.x2; x++) for (let y = p.box.y1; y <= p.box.y2; y++) for (let z = p.box.z1; z <= p.box.z2; z++) {
      const k = `${x},${y},${z}`;
      assert.ok(!cells.has(k), `overlap at ${k}`);
      cells.add(k);
    }
    assert.deepStrictEqual([p.state, p.tries, p.progress], ['open', 0, {done: 0, total: 512}]);
  }
  assert.strictEqual(cells.size, 16 * 8 * 16);
  assert.throws(() => board.create({kind: 'excavate', box: {x1: 98, y1: 60, z1: 0, x2: 110, y2: 62, z2: 3}}), /base/);
  assert.throws(() => board.create({kind: 'excavate', box: {x1: 0, y1: 0, z1: 0, x2: 64, y2: 3, z2: 3}}), /too big/);
  assert.throws(() => board.create({kind: 'excavate', box: {x1: 0, y1: 0, z1: 0, x2: 'a', y2: 3, z2: 3}}), /box/);
  assert.throws(() => board.create({kind: 'build', box}), /kind/);

  // three idle bots get three different parts, nearest first
  const pos = {bot2: {x: 1, z: 1}, bot3: {x: 14, z: 14}, bot19: null};
  const got = board.assign(['bot2', 'bot3', 'bot19'], (b) => pos[b]);
  assert.strictEqual(new Set(got.map((g) => g.part.id)).size, 3);
  const of = (bot) => got.find((g) => g.bot === bot).part;
  assert.ok(of('bot2').box.x1 === 0 || of('bot2').box.z1 === 0, 'bot2 gets the part at its corner');
  assert.deepStrictEqual(board.assign(['bot2'], () => null), [], 'a bot holding a part gets no second one');

  const snap = (part, extra = {}) => ({online: true, dead: false, queue: [], job: part && {type: 'part', label: `part ${part.id} 0 60 0`, done: 100, total: 512}, ...extra});
  const fin = (part, extra = {}) => ({online: true, dead: false, queue: [], job: null, lastDone: {label: `part ${part.id} 0 60 0`, agoS: 0}, ...extra});
  // all three start their parts: heartbeat and progress
  t += 2000;
  board.observe(new Map([['bot2', snap(of('bot2'))], ['bot3', snap(of('bot3'))], ['bot19', snap(of('bot19'))]]));
  assert.strictEqual(of('bot2').progress.done, 100);

  // bot3 finishes: idle, no error -> done; it gets the last part
  t += 60000;
  let ev = board.observe(new Map([['bot2', snap(of('bot2'))], ['bot3', fin(of('bot3'))], ['bot19', snap(of('bot19'))]]));
  assert.strictEqual(of('bot3').state, 'done');
  assert.ok(ev.some((e) => e.what === 'done' && e.bot === 'bot3'));
  const last = board.assign(['bot3'], () => pos.bot3);
  assert.strictEqual(last.length, 1);
  assert.strictEqual(last[0].part.state, 'claimed');

  // bot19 goes offline for 46 s: its part opens with its progress kept, bot3 takes it after its own
  t += 1000;
  board.observe(new Map([['bot2', snap(of('bot2'))], ['bot3', snap(last[0].part)], ['bot19', {online: false}]]));
  t += CLAIM_MS + 1000;
  ev = board.observe(new Map([['bot2', snap(of('bot2'))], ['bot3', snap(last[0].part)]]));
  assert.strictEqual(of('bot19').state, 'open');
  assert.strictEqual(of('bot19').progress.done, 100);
  assert.ok(ev.some((e) => e.what === 'timeout' && e.bot === 'bot19'));

  // a foreign error (the keeper's light job in the spike) reopens without a try
  const lp = last[0].part;
  board.observe(new Map([['bot3', snap(null, {lastError: 'light: no torches available', lastErrorAgoS: 0})]]));
  assert.deepStrictEqual([lp.state, lp.tries], ['open', 0]);

  // three own failures -> failed, problem shown, other parts keep their claims
  const fp = of('bot19');
  for (let i = 0; i < 3; i++) {
    assert.deepStrictEqual(board.assign(['bot19'], () => ({x: fp.box.x1, z: fp.box.z1})).map((g) => g.part.id), [fp.id]);
    t += 2000;
    board.observe(new Map([['bot19', snap(fp)]]));
    t += 2000;
    board.observe(new Map([['bot19', snap(null, {lastError: 'part: unsafe: lava at 3 61 2', lastErrorAgoS: 1})]]));
  }
  assert.strictEqual(fp.state, 'failed');
  assert.match(job.problem.reason, /lava/);
  assert.strictEqual(job.problem.part, fp.id);
  assert.strictEqual(of('bot2').state, 'claimed');

  // a stopped part opens without a try
  t += 2000;
  board.observe(new Map([['bot2', snap(null, {stoppedAgoS: 1})]]));
  assert.deepStrictEqual([of('bot2').state, of('bot2').tries], ['open', 0]);

  // restart: a claimed part comes back open
  board.assign(['bot2'], () => pos.bot2);
  assert.strictEqual(of('bot2').state, 'claimed');
  const again = new Board({file, now, locked});
  const j2 = again.state().jobs[0];
  assert.ok(j2.parts.every((p) => p.state !== 'claimed'));
  assert.strictEqual(j2.parts.find((p) => p.id === fp.id).state, 'failed');

  // pause all: the holding bots come back, nothing is handed out until resume
  again.assign(['bot2'], () => pos.bot2);
  assert.deepStrictEqual(again.pauseAll(), ['bot2']);
  assert.strictEqual(again.state().jobs[0].state, 'paused');
  assert.deepStrictEqual(again.assign(['bot2', 'bot3'], () => null), []);
  again.resume(j2.id);
  assert.strictEqual(again.assign(['bot2'], () => pos.bot2).length, 1);
  assert.deepStrictEqual(again.cancel(j2.id), ['bot2']);
  assert.strictEqual(again.state().jobs[0].state, 'cancelled');
  assert.deepStrictEqual(again.assign(['bot2'], () => null), []);
  assert.throws(() => again.pause('nope'), /no job nope/);

  // the last open parts done -> the job is done; a failed part leaves it failed
  const b3 = new Board({now});
  const small = b3.create({kind: 'excavate', box: {x1: 0, y1: 0, z1: 0, x2: 3, y2: 1, z2: 3}});
  b3.assign(['bot2'], () => null);
  t += 2000;
  b3.observe(new Map([['bot2', snap(small.parts[0])]]));
  t += 2000;
  b3.observe(new Map([['bot2', fin(small.parts[0])]]));
  assert.strictEqual(small.state, 'done');

  // a part that never shows up as the bot's job opens after START_MS; one an owner order replaced opens at once
  const b4 = new Board({now});
  const two = b4.create({kind: 'excavate', box: {x1: 0, y1: 0, z1: 0, x2: 7, y2: 0, z2: 0}});
  b4.assign(['bot2', 'bot3'], () => null);
  const [p2, p3] = two.parts;
  t += 2000;
  b4.observe(new Map([['bot2', snap(null)], ['bot3', snap(p3)]]));
  assert.deepStrictEqual([p2.state, p3.state], ['claimed', 'claimed'], 'a fresh claim waits for its job');
  t += 9000;
  const evs = b4.observe(new Map([['bot2', snap(null)], ['bot3', {...snap(null), job: {type: 'goto', label: 'goto 1 2 3'}}]]));
  assert.deepStrictEqual([p2.state, p2.tries, p3.state, p3.tries], ['open', 0, 'open', 0]);
  assert.deepStrictEqual(evs.map((e) => e.what).sort(), ['not started', 'taken']);

  // review 2026-10-23: a part done between two ticks (never seen running), or done with the bot already on its next job
  const b5 = new Board({now});
  const four = b5.create({kind: 'excavate', box: {x1: 0, y1: 0, z1: 0, x2: 15, y2: 0, z2: 0}});
  b5.assign(['bot2', 'bot3'], () => null);
  const [q1, q2] = four.parts;
  t += 5000;
  b5.observe(new Map([['bot2', fin(q1)], ['bot3', fin(q2, {job: {type: 'goto', label: 'goto 1 2 3'}, queue: ['mine stone 64']})]]));
  assert.deepStrictEqual([q1.state, q2.state], ['done', 'done']);
  // the part id is matched whole: "j5.1" is not "j5.10"
  b5.assign(['bot2'], () => null);
  const q3 = four.parts.find((p) => p.state === 'claimed');
  t += 2000;
  b5.observe(new Map([['bot2', fin({id: `${q3.id}0`})]]));
  assert.strictEqual(q3.state, 'claimed');
  // an error the bot had before it got the part never counts, though its rounded age puts it after the claim
  const b6 = new Board({now});
  const one = b6.create({kind: 'excavate', box: {x1: 0, y1: 0, z1: 0, x2: 3, y2: 0, z2: 0}});
  const stale = {online: true, dead: false, queue: [], job: null, lastError: 'part: 3 blocks left in the slice', lastErrorAgoS: 0};
  b6.assign(['bot2'], () => null, () => stale);
  t += 5000;
  b6.observe(new Map([['bot2', {...stale, lastErrorAgoS: 5}]]));
  t += 6000;
  b6.observe(new Map([['bot2', {...stale, lastErrorAgoS: 11}]]));
  assert.deepStrictEqual([one.parts[0].state, one.parts[0].tries], ['open', 0], 'not started, no try');
  // ... while a new one does
  b6.assign(['bot2'], () => null, () => ({...stale, lastErrorAgoS: 11}));
  t += 4000;
  b6.observe(new Map([['bot2', {...stale, lastErrorAgoS: 1}]]));
  assert.strictEqual(one.parts[0].tries, 1);
}
// ---- board in the hub: routes, protected areas, stop-all pauses ----
(async () => {
  const {spawn} = require('node:child_process');
  const net = require('node:net');
  const port = await new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-hub-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '', BOT_NAMES: 'bot1,bot2', BOARD_BOTS: 'bot2', PROTECTED_AREAS: '100,100,120,120', STATE_DIR: stateDir, DASHBOARD_PORT: String(port), DASHBOARD_HOST: '127.0.0.1', ALLOWED_TS_LOGINS: 'a@github', MC_HOST: '127.0.0.1', MC_PORT: '1', BOT_PASSWORD_SEED: 'test'},
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('server did not start')), 8000);
      child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(to); res(); } });
      child.on('exit', (c) => rej(new Error(`server exited early (${c})`)));
    });
    const H = {'content-type': 'application/json', 'tailscale-user-login': 'a@github'};
    const post = async (p, body) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, {method: 'POST', headers: H, body: JSON.stringify(body)}); return {status: r.status, body: await r.json()}; };
    const board = async () => (await fetch(`http://127.0.0.1:${port}/api/board`, {headers: H})).json();
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/api/board`)).status, 403, 'owner only');
    const bad = await post('/api/board/jobs', {kind: 'excavate', box: {x1: 95, y1: 60, z1: 95, x2: 105, y2: 62, z2: 105}});
    assert.deepStrictEqual([bad.status, bad.body.error], [400, 'box touches the protected area 100 100 120 120']);
    const made = await post('/api/board/jobs', {kind: 'excavate', box: {x1: 0, y1: 60, z1: 0, x2: 15, y2: 67, z2: 15}});
    assert.strictEqual(made.status, 200);
    let b = await board();
    assert.deepStrictEqual(b.jobs[0].parts.map((p) => p.state), ['open', 'open', 'open', 'open']);
    assert.strictEqual((await post('/api/board/jobs/j1', {action: 'jump'})).status, 400);
    assert.strictEqual((await post('/api/job', {bots: 'all', type: 'stop'})).status, 200);
    b = await board();
    assert.strictEqual(b.jobs[0].state, 'paused', 'stop all pauses the board');
    assert.strictEqual((await post('/api/board/jobs/j1', {action: 'resume'})).body.state, 'running');
    assert.strictEqual((await post('/api/scenarios', {name: 'excavate-16'})).status, 400, 'no sandbox console here');
    assert.ok(fs.existsSync(path.join(stateDir, 'board.json')));
    console.log('ok');
  } finally {
    child.kill('SIGKILL');
  }
})().catch((e) => { console.error(e); process.exit(1); });
