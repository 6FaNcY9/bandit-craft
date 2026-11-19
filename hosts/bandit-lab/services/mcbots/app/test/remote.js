'use strict';
// The Discord admin bot's door (remote.js): the token gate, and that it reaches status, stop and resume only.
const assert = require('node:assert/strict');
const {handle} = require('../remote');

(async () => {
  const token = 'r'.repeat(64);
  const world = () => {
    const w = {jobs: [], resumed: [], logs: [], paused: {bot2: {type: 'schematic', paused: true}, bot3: {type: 'excavate', paused: false}}};
    w.deps = {
      token,
      trusted: true,
      readJson: async (req) => req.body,
      snapshots: () => [{name: 'bot1', online: true, job: {label: 'mine iron_ore 64'}, queue: ['chop 32']}, {name: 'bot2', online: true, job: null, queue: []}, {name: 'bot3', online: false, job: null}],
      projects: {get: (n) => w.paused[n] || null},
      submitJob: (j) => { if (j.bots !== 'all' && j.bots[0] === 'nobody') throw new Error('unknown bot'); w.jobs.push(j); return {unreached: ['bot3'], saveErr: w.saveErr}; },
      resumeProject: (n) => w.resumed.push(n),
      log: (m) => w.logs.push(m),
    };
    return w;
  };
  const req = (method, body, headers = {authorization: `Bearer ${token}`}) => ({method, headers, body});

  // the gate: no token configured, a wrong one, none, an untrusted peer, a request that came through Tailscale Serve
  for (const [name, r, over] of [
    ['wrong token', req('GET', null, {authorization: `Bearer ${'x'.repeat(64)}`})],
    ['short token', req('GET', null, {authorization: 'Bearer r'})],
    ['no header', req('GET', null, {})],
    ['dashboard login is not a token', req('GET', null, {'tailscale-user-login': '6FaNcY9@github'})],
    ['through Tailscale Serve', req('GET', null, {authorization: `Bearer ${token}`, 'x-forwarded-for': '100.64.0.1'})],
    ['untrusted peer', req('GET'), {trusted: false}],
    ['door not configured', req('GET'), {token: ''}],
  ]) {
    const w = world();
    assert.deepEqual(await handle(r, '/api/remote/fleet', {...w.deps, ...over}), [403, {error: 'forbidden'}], name);
    assert.equal(w.logs.length, r.headers.authorization ? 1 : 0, `${name}: logged only when a token was tried`);
  }
  {
    const w = world();
    assert.equal((await handle(req('POST', {}, {}), '/api/remote/stop', w.deps))[0], 403);
    assert.deepEqual(w.jobs, [], 'a refused stop reaches no bot');
  }

  // status: what each bot does, nothing else of its snapshot
  {
    const w = world();
    assert.deepEqual(await handle(req('GET'), '/api/remote/fleet', w.deps), [200, {bots: [
      {name: 'bot1', online: true, job: 'mine iron_ore 64', queued: 1, paused: null},
      {name: 'bot2', online: true, job: null, queued: 0, paused: 'schematic'},
      {name: 'bot3', online: false, job: null, queued: 0, paused: null},
    ]}]);
  }

  // stop: one bot, or all
  {
    const w = world();
    assert.deepEqual(await handle(req('POST', {bot: 'bot1'}), '/api/remote/stop', w.deps), [200, {ok: true, unreached: ['bot3']}]);
    assert.deepEqual(await handle(req('POST', {}), '/api/remote/stop', w.deps), [200, {ok: true, unreached: ['bot3']}]);
    assert.deepEqual(w.jobs, [{bots: ['bot1'], type: 'stop'}, {bots: 'all', type: 'stop'}]);
    assert.deepEqual(await handle(req('POST', {bot: 'nobody'}), '/api/remote/stop', w.deps), [400, {error: 'unknown bot'}]);
    for (const bad of [['bot1'], '', 'bot1\n[auth] ok', 'x'.repeat(33)]) assert.deepEqual(await handle(req('POST', {bot: bad}), '/api/remote/stop', w.deps), [400, {error: 'bot must be a name'}]);
    assert.ok(w.logs.every((l) => !l.includes('\n')), 'no caller text with a line break reaches the log');
    assert.equal((await handle(req('POST', {bot: 'bot1', type: 'mine'}), '/api/remote/stop', w.deps))[0], 200);
    assert.equal(w.jobs.at(-1).type, 'stop', 'the caller cannot choose the job');
    w.saveErr = 'disk full';
    const [code, body] = await handle(req('POST', {}), '/api/remote/stop', w.deps);
    assert.equal(code, 500);
    assert.match(body.error, /stopped, but .*disk full/);
  }

  // resume: only projects that are paused, so a second call queues nothing twice
  {
    const w = world();
    assert.deepEqual(await handle(req('POST', {}), '/api/remote/resume', w.deps), [200, {ok: true, resumed: ['bot2']}]);
    assert.deepEqual(await handle(req('POST', {bot: 'bot2'}), '/api/remote/resume', w.deps), [200, {ok: true, resumed: ['bot2']}]);
    assert.deepEqual(w.resumed, ['bot2', 'bot2']);
    assert.deepEqual(await handle(req('POST', {bot: 'bot3'}), '/api/remote/resume', w.deps), [400, {error: 'no paused project'}]);
    assert.deepEqual(await handle(req('POST', {bot: 'nobody'}), '/api/remote/resume', w.deps), [400, {error: 'no paused project'}]);
    assert.equal(w.resumed.length, 2);
  }

  // nothing else is behind the door
  {
    const w = world();
    for (const [m, p] of [['POST', '/api/remote/job'], ['GET', '/api/remote/stop'], ['POST', '/api/remote/fleet'], ['GET', '/api/remote/../state']]) {
      assert.equal((await handle(req(m, {}), p, w.deps))[0], 404, `${m} ${p}`);
    }
    assert.deepEqual(w.jobs, []);
  }
  // config: the token is optional and has the worker token's shape
  {
    const {loadConfig} = require('../config');
    assert.equal(loadConfig({BOT_NAMES: 'bot1'}).remoteToken, '');
    assert.equal(loadConfig({BOT_NAMES: 'bot1', REMOTE_TOKEN: token}).remoteToken, token);
    assert.throws(() => loadConfig({BOT_NAMES: 'bot1', REMOTE_TOKEN: 'short'}), /remote token/);
  }

  // in the hub: the token works without a login, and opens nothing but its own routes
  {
    const {spawn} = require('node:child_process');
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const port = await new Promise((res) => { const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-hub-'));
    const wport = await new Promise((res) => { const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    // HUB-2: a hub restart keeps the keeper's noFar (kept entry shape {type, args, noFar?: true}); only an exact true counts
    fs.writeFileSync(path.join(stateDir, 'jobs.json'), JSON.stringify({bot5: [{type: 'chop', args: {count: 12}, noFar: true}, {type: 'mine', args: {block: 'stone', count: 5}, noFar: 'yes'}]}));
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: {PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '', BOT_NAMES: 'bot1,bot2', STATE_DIR: stateDir, DASHBOARD_PORT: String(port), DASHBOARD_HOST: '127.0.0.1', ALLOWED_TS_LOGINS: 'a@github', REMOTE_TOKEN: token, WORKER_PORT: String(wport), WORKER_TOKEN: token, MC_HOST: '127.0.0.1', MC_PORT: '1', BOT_PASSWORD_SEED: 'test'},
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('server did not start')), 8000);
        child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(to); res(); } });
        child.on('exit', (c) => rej(new Error(`server exited early (${c})`)));
      });
      const call = async (method, p, headers, body) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, {method, headers, body: body && JSON.stringify(body)}); return [r.status, await r.json()]; };
      const T = {authorization: `Bearer ${token}`};
      const msgs = [];
      const wk = await new Promise((res, rej) => { const ws = new (require('ws'))(`ws://127.0.0.1:${wport}/worker`, {headers: T}); ws.on('message', (d) => msgs.push(JSON.parse(String(d)))); ws.on('open', () => res(ws)); ws.on('error', rej); });
      wk.send(JSON.stringify({t: 'hello', v: 1, host: 'laptop', bots: ['bot5']}));
      wk.send(JSON.stringify({t: 'status', bots: [{name: 'bot5', online: true}]}));
      for (let i = 0; i < 100 && msgs.filter((m) => m.t === 'job').length < 2; i++) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(msgs.filter((m) => m.t === 'job').map((m) => [m.type, m.noFar]), [['chop', true], ['mine', undefined]], 'resumed with noFar');
      // HUB-4, worker bot: its status frame already holds the queue onDeath refilled, so the third death's hold stops it
      wk.send(JSON.stringify({t: 'status', bots: [{name: 'bot5', online: true, dead: true, queue: ['rearm', 'grave', 'mine stone 5']}], events: [1, 2, 3].map((i) => ({bot: 'bot5', kind: 'death', text: `died at ${i * 100} 64 0`}))}));
      for (let i = 0; i < 100 && !msgs.some((m) => m.t === 'job' && m.type === 'stop'); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(msgs.some((m) => m.t === 'job' && m.type === 'stop'), 'the death hold stops a worker bot');
      const [code, fleet] = await call('GET', '/api/remote/fleet', T);
      assert.equal(code, 200);
      assert.deepEqual(fleet.bots.map((b) => b.name), ['bot1', 'bot2', 'bot5']);
      assert.deepEqual(Object.keys(fleet.bots[0]), ['name', 'online', 'job', 'queued', 'paused']);
      assert.deepEqual(await call('POST', '/api/remote/stop', T, {}), [200, {ok: true, unreached: []}]);
      assert.deepEqual(await call('POST', '/api/remote/resume', T, {bot: 'bot1'}), [400, {error: 'no paused project'}]);
      assert.equal((await call('GET', '/api/remote/fleet', {}))[0], 403, 'no token');
      assert.equal((await call('GET', '/api/remote/fleet', {'tailscale-user-login': 'a@github'}))[0], 403, 'the dashboard login is not the token');
      for (const p of ['/api/state', '/api/debug', '/api/remote/../state']) assert.equal((await call('GET', p, T))[0], 403, `the token does not open ${p}`);
      assert.equal((await call('POST', '/api/job', {...T, 'content-type': 'application/json'}, {bots: 'all', type: 'stop'}))[0], 403, 'nor the job route');
      // HUB-1: a project's Pause/Beenden also ends the owner order, or the minute sweep starts it again; a non-project order stays
      const L = {'tailscale-user-login': 'a@github', 'content-type': 'application/json'};
      const orders = () => JSON.parse(fs.readFileSync(path.join(stateDir, 'owner-orders.json'), 'utf8'));
      assert.equal((await call('POST', '/api/job', L, {bots: ['bot1'], type: 'shaft', args: {x1: 0, z1: 0, x2: 2, z2: 2}}))[0], 200);
      assert.equal((await call('POST', '/api/job', L, {bots: ['bot2'], type: 'chop', args: {count: 12}}))[0], 200);
      assert.deepEqual(Object.keys(orders()), ['bot1', 'bot2']);
      assert.deepEqual(await call('POST', '/api/project', L, {bot: 'bot1', action: 'pause'}), [200, {ok: true}]);
      assert.deepEqual(await call('POST', '/api/project', L, {bot: 'bot2', action: 'stop'}), [200, {ok: true}]);
      assert.deepEqual(Object.keys(orders()), ['bot2'], 'the paused shaft is no standing order any more');
    } finally {
      child.kill('SIGKILL');
    }
  }
  console.log('remote ok');
})().catch((e) => { console.error(e); process.exit(1); });
