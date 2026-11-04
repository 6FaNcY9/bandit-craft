'use strict';
// BotUi hub side: polling, per-viewer state, refresh and close rules against a loopback fake of the Paper plugin.
const assert = require('node:assert/strict');
const http = require('node:http');
const {BotUi} = require('../botui');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, what) {
  for (let i = 0; i < 300; i++) { if (f()) return; await sleep(10); }
  throw new Error('timeout: ' + what);
}

async function fake() {
  const f = {calls: [], events: [], boot: 'b1', down: false, show: {ok: true, feedback: 'Displayed dialog to x'}};
  f.server = http.createServer((req, res) => {
    if (f.down) return req.destroy();
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const u = new URL(req.url, 'http://x');
      f.calls.push({path: u.pathname, auth: req.headers.authorization, query: u.search, body: body ? JSON.parse(body) : null});
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/events') {
        const since = Number(u.searchParams.get('since'));
        const evs = () => f.events.filter((e) => e.id > since);
        if (!evs().length && u.searchParams.get('wait') !== '0') await sleep(30);
        const last = f.events.length ? f.events[f.events.length - 1].id : 0;
        return res.end(JSON.stringify({boot: f.boot, last, events: evs()}));
      }
      res.end(JSON.stringify(u.pathname === '/show' ? f.show : {ok: true}));
    });
  });
  await new Promise((r) => f.server.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${f.server.address().port}`;
  f.of = (p) => f.calls.filter((c) => c.path === p);
  f.add = (type, player, extra = {}) => f.events.push({id: (f.events.at(-1)?.id || 0) + 1, type, player, pos: [0, 64, 0], dim: 'overworld', yaw: 0, gaze: null, ...extra});
  return f;
}

(async () => {
  const stub = {body: 'one', REFRESHING: new Set(['lage', 'bot']), seen: [], render(screen, view) { this.seen.push(view); return {type: 'notice', title: screen.name + ':' + this.body}; }};
  let t = 1000;
  const logs = [];
  const mk = async (over = {}) => {
    const f = await fake();
    const stopped = [];
    const ui = new BotUi({url: f.url, token: 'tok', viewerBots: {Fancy: '*', Midari: ['MisaBot']}, log: (m) => { logs.push(m); if (process.env.DBG) console.log(m); }, now: () => t, refreshMs: 20, retryMs: 20,
      screens: stub, api: {snapshots: () => [{name: 'bot1'}, {name: 'MisaBot'}], places: () => [], schematics: async () => [], stopAll: (v) => stopped.push(v)}, ...over});
    return {f, ui, stopped, end: () => { ui.stop(); f.server.close(); }};
  };
  const dialogs = (f) => f.of('/show').map((c) => c.body);

  { // poll loop: the first open shows the Lagebild once, pushes the viewer list, filters bots per viewer
    const {f, ui, end} = await mk();
    ui.start();
    await until(() => f.of('/events').length, 'first poll');
    f.add('open', 'Fancy'); f.add('open', 'Stranger');
    await until(() => f.of('/show').length, 'show');
    await sleep(80);
    assert.deepEqual(f.of('/viewers')[0].body, {names: ['Fancy', 'Midari']});
    assert.equal(dialogs(f).length, 1, 'a non-viewer event is ignored, nothing is re-sent');
    assert.deepEqual(dialogs(f)[0], {player: 'Fancy', dialog: JSON.stringify({type: 'notice', title: 'lage:one'})});
    assert.equal(f.of('/show')[0].auth, 'Bearer tok');
    assert.equal(ui.state('Fancy').open, true);
    assert.equal(ui.state('Stranger'), undefined);
    end();
  }
  { // first poll after a hub start does not replay old events
    const {f, ui, end} = await mk();
    f.add('open', 'Fancy');
    ui.start();
    await sleep(150);
    assert.equal(f.of('/show').length, 0);
    end();
  }
  { // the viewer name matches case-insensitively, the view holds only the viewer's bots
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'midari', pos: [1, 2, 3], dim: 'nether', yaw: 9, gaze: null});
    const v = stub.seen.at(-1);
    assert.equal(v.viewer, 'Midari');
    assert.deepEqual(v.snaps.map((s) => s.name), ['MisaBot']);
    assert.deepEqual(v.ctx, {pos: [1, 2, 3], dim: 'nether', yaw: 9, gaze: null});
    assert.equal(dialogs(f)[0].player, 'Midari');
    end();
  }
  { // tick re-sends only a changed REFRESHING screen
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy'});
    await ui.tick();
    assert.equal(f.of('/show').length, 1);
    stub.body = 'two';
    await ui.tick(); await ui.tick();
    assert.equal(f.of('/show').length, 2);
    stub.body = 'one';
    end();
  }
  { // close click stops refresh, and a later change does not reopen it
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy'});
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'close'}});
    stub.body = 'three';
    await ui.tick();
    assert.equal(f.of('/show').length, 1);
    assert.equal(ui.state('Fancy').open, false);
    stub.body = 'one';
    end();
  }
  { // a click re-shows even when nothing changed; an unknown action flashes; lage goes home
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy'});
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'lage'}});
    assert.equal(f.of('/show').length, 2);
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'nope'}});
    assert.equal(f.of('/show').length, 3);
    assert.equal(stub.seen.at(-1).flash.text, 'Unbekannte Aktion');
    end();
  }
  { // closed stops refresh; quit forgets the viewer
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy'});
    await ui.handle({type: 'closed', player: 'Fancy'});
    stub.body = 'four';
    await ui.tick();
    assert.equal(f.of('/show').length, 1);
    await ui.handle({type: 'quit', player: 'Fancy'});
    assert.equal(ui.state('Fancy'), undefined);
    stub.body = 'one';
    end();
  }
  { // closed arriving while a refresh renders: nothing is posted afterwards
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy'});
    stub.body = 'five';
    const slow = stub.render;
    stub.render = function (...a) { const r = slow.apply(this, a); ui.handle({type: 'closed', player: 'Fancy'}); return r; };
    await ui.tick();
    stub.render = slow; stub.body = 'one';
    assert.equal(f.of('/show').length, 1);
    end();
  }
  { // 10 minutes without a click stops refresh
    const {f, ui, end} = await mk();
    t = 1000;
    await ui.handle({type: 'open', player: 'Fancy'});
    t += 599000; stub.body = 'six';
    await ui.tick();
    assert.equal(f.of('/show').length, 2);
    t += 2000; stub.body = 'seven';
    await ui.tick();
    assert.equal(f.of('/show').length, 2);
    assert.equal(ui.state('Fancy').open, false);
    stub.body = 'one';
    end();
  }
  { // input screens never refresh
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy'});
    ui.state('Fancy').screen = {name: 'eingabe'};
    stub.body = 'eight';
    await ui.tick();
    assert.equal(f.of('/show').length, 1);
    stub.body = 'one';
    end();
  }
  { // a refused /show leaves the dialog marked closed and logs the feedback
    const {f, ui, end} = await mk();
    f.show = {ok: false, feedback: 'boom'};
    await ui.handle({type: 'open', player: 'Fancy'});
    assert.equal(ui.state('Fancy').open, false);
    assert.ok(logs.some((l) => l.includes('boom')));
    end();
  }
  { // boot id change resets since and pushes viewers again
    const {f, ui, end} = await mk();
    ui.start();
    await until(() => f.of('/viewers').length === 1, 'viewers');
    f.add('open', 'Fancy'); f.add('open', 'Fancy'); f.add('open', 'Fancy');
    await until(() => f.of('/events').some((c) => c.query.includes('since=3')), 'caught up');
    f.boot = 'b2'; f.events = [];
    await until(() => f.of('/viewers').length === 2, 'viewers again');
    f.add('open', 'Fancy');
    await until(() => f.of('/events').some((c) => c.query.includes('since=0') || c.query.includes('since=1')), 'since reset');
    end();
  }
  { // connection refused: one log line per outage, resumes by itself
    logs.length = 0;
    const {f, ui, end} = await mk();
    ui.start();
    await until(() => f.of('/viewers').length, 'up');
    f.down = true;
    await sleep(200);
    assert.equal(logs.filter((l) => /botui/i.test(l)).length, 1, logs.join('|'));
    f.down = false;
    f.add('open', 'Fancy');
    await until(() => f.of('/show').length, 'resumed');
    end();
  }
  { // a throwing handler sets a flash and keeps polling
    const {f, ui, end} = await mk({api: {snapshots: () => { throw new Error('kaputt'); }, places: () => [], schematics: async () => []}});
    ui.start();
    await until(() => f.of('/events').length, 'poll');
    f.add('open', 'Fancy');
    await until(() => ui.state('Fancy'), 'state');
    f.add('click', 'Fancy', {data: {a: 'lage'}});
    await sleep(100);
    const n = f.of('/events').length;
    await sleep(100);
    assert.ok(f.of('/events').length > n, 'still polling');
    assert.match(ui.state('Fancy').flash.text, /kaputt/);
    end();
  }
  console.log('botui ok');
})().catch((e) => { console.error(e); process.exit(1); });
