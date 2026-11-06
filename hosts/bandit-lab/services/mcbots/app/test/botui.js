'use strict';
// BotUi hub side: polling, per-viewer state, refresh and close rules against a loopback fake of the Paper plugin.
const assert = require('node:assert/strict');
const http = require('node:http');
const {BotUi, allowedBots, stopTargets} = require('../botui');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, what) {
  for (const end = Date.now() + 8000; Date.now() < end; await sleep(10)) if (f()) return; // wall clock: the suite blocks the loop while other parts run
  throw new Error('timeout: ' + what);
}

async function fake() {
  const f = {calls: [], events: [], boot: 'b1', down: false, menu: null, show: {ok: true, feedback: 'Displayed dialog to x'}};
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
      if (u.pathname === '/show' && f.showDelay) await sleep(f.showDelay);
      res.end(JSON.stringify(u.pathname === '/menu' ? (f.menu || {ok: true}) : u.pathname === '/map/give' ? (f.give || {ok: true}) : u.pathname === '/show' ? (f.refuseRefresh && f.calls.at(-1).body.refresh ? {ok: false, feedback: 'closed'} : f.show) : {ok: true}));
    });
  });
  await new Promise((r) => f.server.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${f.server.address().port}`;
  f.of = (p) => f.calls.filter((c) => c.path === p);
  f.add = (type, player, extra = {}) => f.events.push({id: (f.events.at(-1)?.id || 0) + 1, type, player, pos: [0, 64, 0], dim: 'overworld', yaw: 0, gaze: null, ...extra});
  return f;
}

(async () => {
  const AIM = {x: 0, y: 0, z: 0, block: 'air', entity: {type: 'zombie'}}; // aimed at something: the stub's order screen (a bare open now goes to the overview menu)
  const stub = {body: 'one', REFRESHING: new Set(['lage', 'auftrag', 'bot']), seen: [], render(screen, view) { this.seen.push(view); return {type: 'notice', title: screen.name + ':' + this.body}; }};
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
    f.add('open', 'Fancy', {gaze: AIM}); f.add('open', 'Stranger', {gaze: AIM});
    await until(() => f.of('/show').length, 'show');
    await sleep(80);
    assert.deepEqual(f.of('/viewers')[0].body, {names: ['Fancy', 'Midari']});
    assert.equal(dialogs(f).length, 1, 'a non-viewer event is ignored, nothing is re-sent');
    assert.deepEqual(dialogs(f)[0], {player: 'Fancy', dialog: JSON.stringify({type: 'notice', title: 'auftrag:one'})});
    assert.equal(f.of('/show')[0].auth, 'Bearer tok');
    assert.equal(ui.state('Fancy').open, true);
    assert.equal(ui.state('Stranger'), undefined);
    end();
  }
  { // first poll after a hub start does not replay old events
    const {f, ui, end} = await mk();
    f.add('open', 'Fancy', {gaze: AIM});
    ui.start();
    await sleep(150);
    assert.equal(f.of('/show').length, 0);
    end();
  }
  { // the viewer name matches case-insensitively, the view holds only the viewer's bots
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'midari', pos: [1, 2, 3], dim: 'nether', yaw: 9, gaze: AIM});
    const v = stub.seen.at(-1);
    assert.equal(v.viewer, 'Midari');
    assert.deepEqual(v.snaps.map((s) => s.name), ['MisaBot']);
    assert.deepEqual(v.ctx, {pos: [1, 2, 3], dim: 'nether', yaw: 9, gaze: AIM});
    assert.equal(dialogs(f)[0].player, 'Midari');
    end();
  }
  { // tick re-sends only a changed REFRESHING screen
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
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
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
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
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'lage'}});
    assert.equal(f.of('/show').length, 2);
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'nope'}});
    assert.equal(f.of('/show').length, 3);
    assert.equal(stub.seen.at(-1).flash.text, 'Unbekannte Aktion');
    end();
  }
  { // join and quit reach api.presence (the join digest), quit before the early return; a join opens nothing
    const seen = [], {f, ui, end} = await mk({api: {presence: (v, t) => seen.push([v, t]), snapshots: () => [], places: () => [], schematics: async () => []}});
    await ui.handle({type: 'join', player: 'Fancy'}); await ui.handle({type: 'quit', player: 'Fancy'});
    assert.deepEqual(seen, [['Fancy', 'join'], ['Fancy', 'quit']]); assert.equal(f.of('/show').length, 0);
    end();
  }
  { // closed stops refresh; quit forgets the viewer
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
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
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
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
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
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
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
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
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    assert.equal(ui.state('Fancy').open, false);
    assert.ok(logs.some((l) => l.includes('boom')));
    end();
  }
  { // boot id change resets since and pushes viewers again
    const {f, ui, end} = await mk();
    ui.start();
    await until(() => f.of('/viewers').length === 1, 'viewers');
    f.add('open', 'Fancy', {gaze: AIM}); f.add('open', 'Fancy', {gaze: AIM}); f.add('open', 'Fancy', {gaze: AIM});
    await until(() => f.of('/events').some((c) => c.query.includes('since=3')), 'caught up');
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    assert.equal(ui.state('Fancy').open, true);
    f.boot = 'b2'; f.events = [];
    await until(() => f.of('/viewers').length === 2, 'viewers again');
    assert.equal(ui.state('Fancy').open, false, 'the plugin lost its tracking, no refresh until a new open');
    const after = f.of('/events').length;
    await until(() => f.of('/events').slice(after - 1).some((c) => c.query.startsWith('?since=0&')), 'since reset to 0');
    const shows = f.of('/show').length;
    f.add('open', 'Fancy', {gaze: AIM});
    await until(() => f.of('/show').length === shows + 1 && ui.state('Fancy').open, 'new open re-shows');
    end();
  }
  { // a plugin restart ends a live pick: the next staff click routes normally
    const api = {snapshots: () => [{name: 'bot1', online: true}], places: () => [], schematics: async () => [], idle: {get: () => null}};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    ui.start();
    await until(() => f.of('/viewers').length === 1, 'viewers');
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'shiftm'}});
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'pick', kind: 'chest'}});
    assert.ok(ui.state('Fancy').pick);
    f.boot = 'b2';
    await until(() => f.of('/viewers').length === 2, 'viewers again');
    assert.equal(ui.state('Fancy').pick, null);
    const chest = ui.state('Fancy').form.chest;
    await ui.handle({type: 'open', player: 'Fancy', gaze: {x: 4, y: 5, z: 6, block: 'chest'}});
    assert.equal(ui.state('Fancy').screen.name, 'chestm'); assert.deepEqual(ui.state('Fancy').form.chest, chest);
    end();
  }
  { // connection refused: one log line per outage, resumes by itself
    logs.length = 0;
    const {f, ui, end} = await mk({screens: require('../botui-screens')});
    ui.start();
    await until(() => ui.boot, 'up'); // first contact done: an earlier outage would skip the open event as backlog
    f.down = true;
    await until(() => logs.some((l) => /plugin unreachable/.test(l)), 'outage logged');
    await sleep(150); // more retries must not add lines
    assert.equal(logs.filter((l) => /plugin unreachable/.test(l)).length, 1, logs.join('|')); // the previous block's stop can still log its aborted show
    f.down = false;
    f.add('open', 'Fancy');
    await until(() => f.of('/menu').length, 'resumed');
    end();
  }
  { // a throwing handler sets a flash and keeps polling
    const {f, ui, end} = await mk({api: {snapshots: () => { throw new Error('kaputt'); }, places: () => [], schematics: async () => []}});
    ui.start();
    await until(() => f.of('/events').length, 'poll');
    f.add('open', 'Fancy', {gaze: AIM});
    await until(() => ui.state('Fancy'), 'state');
    f.add('click', 'Fancy', {data: {a: 'lage'}});
    await sleep(100);
    const n = f.of('/events').length;
    await sleep(100);
    assert.ok(f.of('/events').length > n, 'still polling');
    assert.match(ui.state('Fancy').flash.text, /kaputt/);
    end();
  }
  { // refresh shows carry refresh:true, open and click shows do not; a "closed" answer closes quietly
    logs.length = 0;
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'lage'}});
    stub.body = 'nine'; await ui.tick();
    assert.deepEqual(f.of('/show').map((c) => c.body.refresh), [undefined, undefined, true]);
    f.refuseRefresh = true; stub.body = 'ten'; await ui.tick();
    assert.equal(ui.state('Fancy').open, false);
    assert.equal(logs.length, 0, logs.join('|'));
    stub.body = 'one';
    end();
  }
  { // closed arriving while the refresh /show is on the wire: the answer must not re-arm refresh
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    f.showDelay = 80; stub.body = 'eleven';
    const tick = ui.tick();
    await sleep(30);
    await ui.handle({type: 'closed', player: 'Fancy'});
    await tick;
    assert.equal(ui.state('Fancy').open, false);
    f.showDelay = 0; stub.body = 'twelve';
    await ui.tick();
    assert.equal(f.of('/show').length, 2);
    stub.body = 'one';
    end();
  }
  { // quit while a tick renders: nothing is posted for the orphan
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    stub.body = 'thirteen';
    const slow = stub.render;
    stub.render = function (...a) { const r = slow.apply(this, a); ui.handle({type: 'quit', player: 'Fancy'}); return r; };
    await ui.tick();
    stub.render = slow; stub.body = 'one';
    assert.equal(f.of('/show').length, 1);
    end();
  }
  { // a failing refresh logs once per outage and does not stop the other viewers
    logs.length = 0;
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    await ui.handle({type: 'open', player: 'Midari', gaze: AIM});
    f.down = true; stub.body = 'fourteen';
    await ui.tick(); await ui.tick();
    assert.equal(logs.length, 1, logs.join('|'));
    stub.body = 'one';
    end();
  }
  { // rights: only the viewer's own bots; an empty stop list is not an error
    const vb = {Fancy: '*', Midari: ['MisaBot']};
    assert.deepEqual(allowedBots(vb, 'Fancy', ['bot1', 'x']), ['bot1', 'x']);
    assert.deepEqual(allowedBots(vb, 'Midari', ['MisaBot']), ['MisaBot']);
    for (const [v, b] of [['Midari', ['bot1']], ['Midari', ['MisaBot', 'bot1']], ['Midari', 'all'], ['Stranger', ['bot1']], ['Fancy', 'all']]) assert.throws(() => allowedBots(vb, v, b), /nicht dein Bot/);
    assert.equal(stopTargets(vb, 'Fancy', ['bot1']), 'all');
    assert.deepEqual(stopTargets(vb, 'Midari', ['bot1', 'MisaBot']), ['MisaBot']);
    assert.deepEqual(stopTargets(vb, 'Midari', ['bot1']), []);
    assert.throws(() => stopTargets(vb, 'Stranger', []), /nicht dein Bot/);
  }
  { // Schließen really clears the dialog on the plugin; a failing /close only logs
    const {f, ui, end} = await mk();
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'close'}});
    assert.deepEqual(f.of('/close').map((c) => c.body), [{player: 'Fancy'}]);
    assert.equal(ui.state('Fancy').open, false); assert.equal(f.of('/show').length, 1);
    f.down = true; logs.length = 0;
    await ui.handle({type: 'click', player: 'Fancy', data: {a: 'close'}});
    assert.ok(logs.some((m) => /Fancy: close:/.test(m))); assert.equal(ui.state('Fancy').open, false);
    end();
  }
  { // the real Lagebild and Bot screens: navigation, rights, stop, quick jobs, Alle stopp for the owner only
    const submits = [], stops = [];
    const snaps = [{name: 'bot1', online: true, activity: 'idle', job: null}, {name: 'MisaBot', online: true, activity: 'idle', job: null}];
    const api = {snapshots: () => snaps, places: () => [], schematics: async () => [], keeper: {state: () => ({available: true, quotas: [], chest: {x: 1, y: 2, z: 3}})},
      submit: (v, j) => { submits.push([v, j]); return {ok: true, unreached: []}; }, stopAll: (v) => { stops.push(v); return {ok: true, keeperOff: true}; }};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    const click = (player, data) => ui.handle({type: 'click', player, data});
    const last = () => JSON.parse(f.of('/show').at(-1).body.dialog);
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM}); await click('Fancy', {a: 'lage'}); // the old text Lagebild is only reachable by this click now
    assert.equal(last().actions.filter((a) => a.action.payload?.a === 'bot').length, 2);
    await click('Fancy', {a: 'bot', bot: 'bot1'});
    assert.deepEqual(ui.state('Fancy').screen, {name: 'bot', bot: 'bot1'});
    await click('Fancy', {a: 'stop', bot: 'bot1'});
    assert.deepEqual(submits.at(-1), ['Fancy', {bots: ['bot1'], type: 'stop', args: {}}]);
    assert.match(JSON.stringify(last().body), /✔|bot1: gestoppt/);
    await click('Fancy', {a: 'quick', bot: 'bot1', job: 'deposit'});
    assert.deepEqual(submits.at(-1), ['Fancy', {bots: ['bot1'], type: 'deposit', args: {x: 1, y: 2, z: 3}}]);
    await click('Fancy', {a: 'quick', bot: 'bot1', job: 'homebed'});
    assert.deepEqual(submits.at(-1)[1].args, {});
    const n = submits.length;
    await click('Fancy', {a: 'quick', bot: 'bot1', job: 'rm -rf'});
    assert.equal(submits.length, n); assert.match(ui.state('Fancy').flash.text, /unbekannter Auftrag/);
    await click('Fancy', {a: 'stopall'});
    assert.equal(ui.state('Fancy').screen.name, 'stopall'); assert.equal(stops.length, 0); // asks first
    await click('Fancy', {a: 'stopall_ok'});
    assert.deepEqual(stops, ['Fancy']); assert.equal(ui.state('Fancy').screen.name, 'lage'); assert.match(ui.state('Fancy').flash.text, /Alle gestoppt, Daueraufträge aus/);
    // a restricted viewer: own bot only, no Alle stopp, forged clicks refused
    await ui.handle({type: 'open', player: 'Midari', gaze: AIM}); await click('Midari', {a: 'lage'});
    assert.ok(!JSON.stringify(last()).includes('stopall'));
    await click('Midari', {a: 'bot', bot: 'bot1'});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/); assert.equal(ui.state('Midari').screen.name, 'lage');
    await click('Midari', {a: 'stop', bot: 'bot1'}); await click('Midari', {a: 'stopall'}); await click('Midari', {a: 'stopall_ok'});
    assert.equal(submits.filter(([v]) => v === 'Midari').length, 0); assert.equal(stops.length, 1);
    assert.match(ui.state('Midari').flash.text, /Besitzer/);
    await click('Midari', {a: 'stop', bot: 'MisaBot'});
    assert.deepEqual(submits.at(-1), ['Midari', {bots: ['MisaBot'], type: 'stop', args: {}}]);
    // Bauplan hochladen: the link is issued for the clicking viewer, a forged payload url is ignored, the button opens the URL
    api.uploadLink = (v) => `https://x.test/upload?t=tok-${v}`;
    await click('Midari', {a: 'upload', url: 'https://evil.test', viewer: 'Fancy'});
    assert.equal(ui.state('Midari').screen.name, 'upload');
    assert.deepEqual(last().actions[0].action, {type: 'minecraft:open_url', url: 'https://x.test/upload?t=tok-Midari'});
    await click('Midari', {a: 'lage'});
    // the flash is gone from the next render once it has expired
    t += 31000;
    await click('Fancy', {a: 'lage'});
    assert.doesNotMatch(JSON.stringify(last().body), /gestoppt/);
    end();
  }
  { // overview menu: /menu not /show, click re-posts, closed stops refresh, a refused refresh is quiet, guest stopmine
    const submits = [], snaps = [{name: 'bot1', online: true, health: 20, activity: 'idle', job: null}, {name: 'MisaBot', online: true, health: 10, activity: 'idle', job: null, guest: true}];
    const api = {snapshots: () => snaps, places: () => [], schematics: async () => [], submit: (v, j) => { submits.push([v, j]); return {ok: true, unreached: []}; }};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    const click = (player, data) => ui.handle({type: 'click', player, data});
    await ui.handle({type: 'lage', player: 'Fancy'});
    assert.equal(f.of('/menu').length, 1); assert.equal(f.of('/show').length, 0); assert.match(f.of('/menu')[0].body.title, /Bots/);
    await click('Fancy', {a: 'botm', bot: 'bot1'});
    assert.equal(f.of('/menu').length, 2);
    await click('Midari', {a: 'botm', bot: 'bot1'});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/);
    await click('Midari', {a: 'stopmine'});
    assert.deepEqual(submits.at(-1), ['Midari', {bots: ['MisaBot'], type: 'stop', args: {}}]);
    await ui.handle({type: 'click', player: 'Midari', pos: [1, 64, 2], data: {a: 'comeall'}});
    assert.deepEqual(submits.at(-1)[1].bots, ['MisaBot']); assert.equal(submits.at(-1)[1].type, 'goto');
    await ui.handle({type: 'closed', player: 'Fancy'});
    const n = f.of('/menu').length;
    await ui.tick();
    assert.equal(f.of('/menu').length, n);
    await click('Fancy', {a: 'ov'});
    f.menu = {ok: false, feedback: 'closed'};
    const before = logs.length;
    snaps[0].health = 5;
    await ui.tick();
    assert.equal(ui.state('Fancy').open, false); assert.equal(logs.length, before);
    end();
  }
  { // bot page: go jobs, rights, flash on the action bar, chest for a bot, idle_set back to the page, staff routing
    const submits = [], snaps = [{name: 'bot1', online: true, health: 20, activity: 'idle', job: null, chest: {x: 9, y: 9, z: 9}}, {name: 'MisaBot', online: true, health: 10, activity: 'idle', job: null, guest: true}];
    const api = {snapshots: () => snaps, places: () => [], schematics: async () => [], submit: (v, j) => { submits.push([v, j]); return {ok: true, unreached: []}; },
      idle: {get: () => null, set: () => ({ok: true, label: 'Holz-Schicht'})}};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    const ev = (player, data, extra = {}) => ui.handle({type: 'click', player, data, ...extra});
    const bars = () => f.of('/actionbar').map((c) => c.body);
    await ev('Fancy', {a: 'go', bot: 'bot1', job: 'followme'});
    assert.deepEqual(submits.at(-1), ['Fancy', {bots: ['bot1'], type: 'follow', args: {player: 'Fancy'}, replace: false}]);
    await ev('Fancy', {a: 'go', bot: 'bot1', job: 'deposit'});
    assert.deepEqual(submits.at(-1)[1].args, {x: 9, y: 9, z: 9});
    await ev('Midari', {a: 'go', bot: 'MisaBot', job: 'deposit'}); // no bot chest, no supply chest
    const n = submits.length;
    assert.equal(submits.at(-1)[0], 'Fancy');
    assert.deepEqual(bars().at(-1), {player: 'Midari', text: 'Erst eine Kiste merken'});
    await ev('Midari', {a: 'go', bot: 'bot1', job: 'followme'});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/);
    await ev('Midari', {a: 'go', bot: 'MisaBot', job: 'treefarm'});
    assert.deepEqual(bars().at(-1), {player: 'Midari', text: 'Keine Baumfarm eingerichtet'});
    assert.equal(submits.length, n);
    await ev('Midari', {a: 'go', bot: 'MisaBot', job: 'guardhere'}, {pos: [5.5, 64, 6.5]});
    assert.deepEqual(submits.at(-1)[1], {bots: ['MisaBot'], type: 'guard', args: {x: 5, y: 64, z: 6, radius: 16}, replace: false});
    await ev('Midari', {a: 'go', bot: 'MisaBot', job: 'rm'}); assert.equal(submits.length, n + 1);
    await ev('Midari', {a: 'stopmine'});
    assert.ok(bars().some((b) => /gestoppt/.test(b.text)));
    await ev('Midari', {a: 'idlem', bot: 'MisaBot'});
    assert.equal(ui.state('Midari').screen.name, 'idlem');
    await ev('Midari', {a: 'idle_set', bot: 'MisaBot', choice: 'holz', m: 1});
    assert.deepEqual(ui.state('Midari').screen, {name: 'botm', bot: 'MisaBot'});
    await ev('Midari', {a: 'invm', bot: 'MisaBot'});
    assert.equal(ui.state('Midari').screen.name, 'invm');
    const gaze = {x: 7, y: 8, z: 9, block: 'chest'};
    await ui.handle({type: 'open', player: 'Midari', gaze});
    assert.equal(ui.state('Midari').screen.name, 'chestm');
    assert.deepEqual(f.of('/menu').at(-1).body.slots.filter((s) => s.head).map((s) => s.head), ['MisaBot']);
    await ev('Midari', {a: 'chestfor', bot: 'MisaBot'}, {gaze});
    assert.deepEqual(submits.at(-1), ['Midari', {bots: ['MisaBot'], type: 'setchest', args: {x: 7, y: 8, z: 9}, replace: false}]);
    await ev('Midari', {a: 'chestfor', bot: 'bot1'}, {gaze});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/);
    end();
  }
  { // Abbauen hopper: form defaults, amount cycle, the four shiftgo orders, point-to-pick, expiry, staff on a block
    const submits = [], snaps = [{name: 'bot1', online: true, health: 20, activity: 'idle', job: null, chest: {x: 9, y: 9, z: 9}}, {name: 'MisaBot', online: true, health: 10, activity: 'idle', job: null, guest: true}];
    const api = {snapshots: () => snaps, places: () => [], schematics: async () => [], submit: (v, j) => { submits.push(j); return {ok: true, unreached: []}; }, idle: {get: () => null, set: () => ({})}};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    const ev = (player, data, extra = {}) => ui.handle({type: 'click', player, data, ...extra});
    const open = (player, gaze) => ui.handle({type: 'open', player, gaze});
    const bars = () => f.of('/actionbar').map((c) => c.body.text);
    await ev('Fancy', {a: 'shiftm'});
    assert.deepEqual(ui.state('Fancy').form, {bot: 'bot1', block: null, amount: 'inf', chest: {x: 9, y: 9, z: 9}});
    assert.equal(f.of('/menu').at(-1).body.type, 'hopper');
    await ev('Midari', {a: 'shiftm', bot: 'MisaBot'});
    assert.equal(ui.state('Midari').form.chest, null);
    const amounts = []; for (let i = 0; i < 4; i++) { await ev('Fancy', {a: 'amount'}); amounts.push(ui.state('Fancy').form.amount); }
    assert.deepEqual(amounts, [16, 64, 256, 'inf']);
    await ev('Fancy', {a: 'pickblock', block: 'bedrock'});
    assert.match(ui.state('Fancy').flash.text, /unbekannter Block/);
    await ev('Midari', {a: 'setbot', bot: 'bot1'});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/); assert.equal(ui.state('Midari').form.bot, 'MisaBot');
    await ev('Fancy', {a: 'shiftgo'});
    assert.equal(bars().at(-1), 'Erst einen Block wählen'); assert.equal(submits.length, 0);
    await ev('Midari', {a: 'pickblock', block: 'iron_ore'}); await ev('Midari', {a: 'shiftgo'});
    assert.equal(bars().at(-1), 'Erst eine Kiste wählen'); assert.equal(submits.length, 0);
    const run = async (block, amount) => { await ev('Fancy', {a: 'pickblock', block}); ui.state('Fancy').form.amount = amount; await ev('Fancy', {a: 'shiftgo'}); return submits.at(-1); };
    assert.deepEqual(await run('oak_log', 'inf'), {bots: ['bot1'], type: 'shift', args: {block: 'logs', x: 9, y: 9, z: 9}, replace: false});
    assert.deepEqual(await run('oak_log', 64), {bots: ['bot1'], type: 'chop', args: {count: 64}, replace: false});
    assert.deepEqual(await run('iron_ore', 'inf'), {bots: ['bot1'], type: 'shift', args: {block: 'iron_ore', x: 9, y: 9, z: 9}, replace: false});
    assert.deepEqual(await run('iron_ore', 16), {bots: ['bot1'], type: 'mine', args: {block: 'iron_ore', count: 16}, replace: false});
    assert.deepEqual(ui.state('Fancy').screen, {name: 'botm', bot: 'bot1'}); assert.match(bars().at(-1), /^bot1: /);
    assert.deepEqual(ui.state('Fancy').recent, ['iron_ore', 'oak_log']);
    // point-to-pick: a chest sets form.chest and shows the hopper again; a wrong target posts nothing; the pick survives
    await ev('Fancy', {a: 'shiftm'});
    await ev('Fancy', {a: 'pick', kind: 'chest'});
    assert.equal(bars().at(-1), 'Schleich und zeig mit dem Stab auf eine Kiste'); assert.equal(f.of('/close').length, 1); assert.equal(ui.state('Fancy').open, false);
    let menus = f.of('/menu').length;
    await open('Fancy', {x: 1, y: 2, z: 3, block: 'stone'});
    await until(() => bars().at(-1) === 'Das ist keine Kiste', 'Das ist keine Kiste'); assert.equal(f.of('/menu').length, menus); assert.ok(ui.state('Fancy').pick);
    await open('Fancy', {x: 4, y: 5, z: 6, block: 'chest'});
    assert.deepEqual(ui.state('Fancy').form.chest, {x: 4, y: 5, z: 6}); assert.equal(ui.state('Fancy').pick, null);
    assert.equal(f.of('/menu').at(-1).body.type, 'hopper'); assert.equal(f.of('/menu').at(-1).body.slots[3].name, 'Wohin: 4 5 6');
    // block pick
    await ev('Fancy', {a: 'pick', kind: 'block'});
    await open('Fancy', {x: 1, y: 2, z: 3, block: 'bedrock'});
    await until(() => bars().at(-1) === 'Das ist kein passender Block', 'Das ist kein passender Block');
    await open('Fancy', {x: 1, y: 2, z: 3, block: 'gravel'});
    assert.equal(ui.state('Fancy').form.block, 'gravel'); assert.equal(f.of('/menu').at(-1).body.slots[1].item, 'gravel');
    // an old pick is dropped silently, the chest stays and the open routes normally
    await ev('Fancy', {a: 'pick', kind: 'chest'});
    t += 61000;
    menus = f.of('/menu').length;
    await open('Fancy', {x: 7, y: 8, z: 9, block: 'chest'});
    assert.deepEqual(ui.state('Fancy').form.chest, {x: 4, y: 5, z: 6}); assert.equal(ui.state('Fancy').screen.name, 'chestm'); assert.equal(ui.state('Fancy').pick, null);
    // Kiste merken from the bot page submits setchest for that bot and shows its page
    await ev('Fancy', {a: 'pick', kind: 'chest', bot: 'bot1'});
    await open('Fancy', {x: 7, y: 8, z: 9, block: 'chest'});
    assert.deepEqual(submits.at(-1), {bots: ['bot1'], type: 'setchest', args: {x: 7, y: 8, z: 9}, replace: false});
    assert.deepEqual(ui.state('Fancy').screen, {name: 'botm', bot: 'bot1'});
    await ev('Midari', {a: 'pick', kind: 'chest', bot: 'bot1'});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/); assert.equal(ui.state('Midari').pick, undefined);
    // staff on an ore (not a chest) opens the hopper with it
    await open('Fancy', {x: 1, y: 2, z: 3, block: 'iron_ore'});
    assert.equal(ui.state('Fancy').screen.name, 'shiftm'); assert.equal(f.of('/menu').at(-1).body.slots[1].item, 'iron_ore');
    end();
  }
  { // Kommandostand: lage event, aimed-at bot, Wenn frei picker, rights
    const set = [], store = {MisaBot: null};
    const snaps = [{name: 'bot1', online: true, activity: 'idle', job: null}, {name: 'MisaBot', online: true, activity: 'idle', job: null, guest: true}];
    const api = {snapshots: () => snaps, places: () => [], schematics: async () => [],
      idle: {get: (b) => store[b] ? {id: store[b]} : null, set: (b, id) => { if (id === 'keeper') throw new Error('Daueraufträge nur für Bandits Diener'); set.push([b, id]); store[b] = id; return {ok: true, label: id ? 'Holz-Schicht' : 'Nichts'}; }}};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    const click = (player, data) => ui.handle({type: 'click', player, data});
    const last = () => JSON.parse(f.of('/show').at(-1).body.dialog);
    const labels = () => last().actions.map((a) => JSON.stringify(a.label));
    await ui.handle({type: 'lage', player: 'Fancy'});
    assert.equal(ui.state('Fancy').screen.name, 'ov'); assert.equal(f.of('/show').length, 0); assert.match(f.of('/menu')[0].body.title, /Bots/);
    await click('Fancy', {a: 'oldmenu'});
    assert.equal(ui.state('Fancy').screen.name, 'lage'); assert.equal(f.of('/show').length, 1);
    assert.ok(last().actions.some((a) => a.action.command === '/zauberstab' && a.action.type === 'minecraft:run_command'));
    const bot = {x: 1, y: 2, z: 3, block: 'air', entity: {type: 'player', name: 'MisaBot', x: 1, y: 2, z: 3}};
    await ui.handle({type: 'open', player: 'Fancy', gaze: bot}); await ui.handle({type: 'click', player: 'Fancy', gaze: bot, data: {a: 'new'}});
    assert.equal(last().actions.filter((a) => a.action.payload?.a === 'botscreen').length, 1);
    assert.equal(labels().filter((l) => /Hierher rufen/.test(l)).length, 1);
    await ui.handle({type: 'open', player: 'Midari', gaze: {...bot, entity: {...bot.entity, name: 'bot1'}}}); await ui.handle({type: 'click', player: 'Midari', gaze: {...bot, entity: {...bot.entity, name: 'bot1'}}, data: {a: 'new'}});
    assert.ok(!last().actions.some((a) => a.action.payload?.a === 'botscreen')); // a foreign bot: no row
    { // open routing: aimed bot of yours -> its screen; anything else aimed at -> auftrag; nothing -> the overview
      const open = async (player, gaze) => { await ui.handle({type: 'open', player, gaze}); return ui.state(player).screen; };
      assert.equal((await open('Fancy', {x: 1, y: 2, z: 3, block: 'bedrock'})).name, 'auftrag');
      assert.equal((await open('Fancy', null)).name, 'ov');
      assert.deepEqual(await open('Midari', bot), {name: 'botm', bot: 'MisaBot'});
      assert.equal((await open('Midari', {...bot, entity: {...bot.entity, name: 'bot1'}})).name, 'auftrag');
    }
    await click('Midari', {a: 'botscreen', bot: 'bot1'});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/);
    await click('Fancy', {a: 'botscreen', bot: 'MisaBot'});
    assert.deepEqual(ui.state('Fancy').screen, {name: 'bot', bot: 'MisaBot'});
    assert.ok(labels().some((l) => l.includes('Wenn frei: Nichts')));
    await click('Fancy', {a: 'idle_open', bot: 'MisaBot'});
    assert.deepEqual(ui.state('Fancy').screen, {name: 'wennfrei', bot: 'MisaBot'});
    assert.ok(labels().some((l) => l.includes('Stein-Schicht')) && labels().some((l) => l.includes('"Nichts"')) && !labels().some((l) => l.includes('Daueraufträge'))); // keeper hidden for a guest bot
    await click('Midari', {a: 'idle_set', bot: 'bot1', choice: 'holz'});
    assert.match(ui.state('Midari').flash.text, /nicht dein Bot/); assert.equal(set.length, 0);
    await click('Midari', {a: 'idle_set', bot: 'MisaBot', choice: 'holz'});
    assert.deepEqual(set, [['MisaBot', 'holz']]); assert.match(ui.state('Midari').flash.text, /MisaBot: wenn frei → Holz-Schicht/);
    assert.ok(labels().some((l) => l.includes('Wenn frei: Holz-Schicht in meine Kiste')));
    await click('Midari', {a: 'idle_set', bot: 'MisaBot', choice: 'keeper'});
    assert.match(ui.state('Midari').flash.text, /Daueraufträge nur für Bandits Diener/);
    end();
  }
  { // Ziele: owner toggles and saves quotas, a restricted viewer is refused; trader chests come from the gaze, not the click
    const calls = [], chests = [];
    const keeper = {enabled: false, state() { return {available: true, enabled: this.enabled, quotas: [{item: 'logs', want: 64, have: 1}]}; }, setEnabled(on) { this.enabled = on; calls.push(['enabled', on]); },
      setWant(item, n) { if (item !== 'logs') throw new Error('unknown quota item: ' + item); calls.push(['want', item, n]); }};
    const traderChests = {add: (...a) => chests.push(['add', ...a]), remove: (...a) => chests.push(['remove', ...a]), list: () => ({sticks: [], stores: []})};
    const api = {snapshots: () => [{name: 'bot1', online: true}, {name: 'MisaBot', online: true}], places: () => [], schematics: async () => [], keeper, plan: {enabled: false, setEnabled: (on) => calls.push(['plan', on])},
      traderChests, ground: (v, bot, type, a) => { if (v === 'Midari' && a.x === 99) throw new Error('nicht ganz in deinem Bereich'); }, traders: () => ['MisaBot'], sidebar: (v, on) => calls.push(['sidebar', v, on])};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    const click = (player, data, extra = {}) => ui.handle({type: 'click', player, data, ...extra});
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    await click('Fancy', {a: 'ziele'});
    assert.equal(ui.state('Fancy').screen.name, 'ziele');
    await click('Fancy', {a: 'keeper', on: 1}); await click('Fancy', {a: 'plan', on: 1}); await click('Fancy', {a: 'sidebar', on: 0});
    assert.deepEqual(calls, [['enabled', true], ['plan', true], ['sidebar', 'Fancy', false]]);
    calls.length = 0;
    await click('Fancy', {a: 'saveziele', want_logs: 99.6});
    assert.deepEqual(calls, [['want', 'logs', 100]]); assert.match(ui.state('Fancy').flash.text, /gespeichert/);
    await click('Fancy', {a: 'saveziele', want_gold: 5}); assert.match(ui.state('Fancy').flash.text, /ungültiges Ziel: gold/);
    calls.length = 0;
    for (const a of ['keeper', 'plan', 'saveziele']) { await click('Midari', {a, on: 1, want_logs: 5}); assert.match(ui.state('Midari').flash.text, /Besitzer/); }
    await click('Midari', {a: 'sidebar', on: 1}); assert.deepEqual(calls, [['sidebar', 'Midari', true]]);
    // trader chests: the position is the gazed chest
    const gaze = {x: 7, y: 8, z: 9, block: 'chest'};
    await click('Midari', {a: 'trader_add', bot: 'MisaBot', kind: 'sticks', x: 1, y: 1, z: 1}, {gaze});
    assert.deepEqual(chests, [['add', 'MisaBot', 'sticks', {x: 7, y: 8, z: 9}]]);
    await click('Midari', {a: 'trader_add', bot: 'bot1', kind: 'sticks'}, {gaze}); assert.match(ui.state('Midari').flash.text, /nicht dein Bot/);
    await click('Fancy', {a: 'trader_add', bot: 'bot1', kind: 'sticks'}, {gaze}); assert.match(ui.state('Fancy').flash.text, /kein Händler/);
    await click('Midari', {a: 'trader_add', bot: 'MisaBot', kind: 'bogus'}, {gaze}); assert.match(ui.state('Midari').flash.text, /unbekannte Kiste/);
    await click('Midari', {a: 'trader_add', bot: 'MisaBot', kind: 'stores'}, {gaze: {...gaze, block: 'stone'}}); assert.match(ui.state('Midari').flash.text, /keine Kiste/);
    await click('Midari', {a: 'trader_add', bot: 'MisaBot', kind: 'stores'}); assert.match(ui.state('Midari').flash.text, /keine Kiste/);
    await click('Midari', {a: 'trader_add', bot: 'MisaBot', kind: 'sticks'}, {gaze: {...gaze, x: 99}}); assert.match(ui.state('Midari').flash.text, /nicht ganz in deinem Bereich/);
    assert.equal(chests.length, 1);
    await click('Midari', {a: 'trader_del', bot: 'MisaBot', kind: 'sticks', x: 7, y: 8, z: 9});
    assert.deepEqual(chests.at(-1), ['remove', 'MisaBot', 'sticks', {x: 7, y: 8, z: 9}]); assert.equal(ui.state('Midari').screen.name, 'ziele');
    await click('Midari', {a: 'trader_del', bot: 'bot1', kind: 'sticks', x: 1, y: 1, z: 1}); assert.equal(chests.length, 2);
    // saveziele is all or nothing, refuses out-of-range numbers, and says so without a keeper
    calls.length = 0;
    await click('Fancy', {a: 'saveziele', want_logs: 5, want_planonly: 5}); assert.match(ui.state('Fancy').flash.text, /ungültiges Ziel: planonly/); assert.deepEqual(calls, []);
    await click('Fancy', {a: 'saveziele', want_logs: 5000}); assert.match(ui.state('Fancy').flash.text, /ungültiges Ziel: logs/); assert.deepEqual(calls, []);
    const keep = api.keeper; api.keeper = null;
    await click('Fancy', {a: 'saveziele', want_logs: 5}); assert.match(ui.state('Fancy').flash.text, /Keine Daueraufträge/);
    api.keeper = keep;
    // the Nether is not the overworld: refused, nothing saved
    await click('Midari', {a: 'trader_add', bot: 'MisaBot', kind: 'sticks'}, {gaze, dim: 'the_nether'}); assert.match(ui.state('Midari').flash.text, /Nur in der Oberwelt/);
    assert.equal(chests.length, 2);
    // a Ziele screen is never refreshed under the player's hand
    const shown = f.of('/show').length;
    t += 10; await ui.tick();
    assert.equal(f.of('/show').length, shown);
    end();
  }
  { // Karte: give, zoom, centre and the markers pushed every tick, all within the viewer's rights
    const snaps = [{name: 'bot1', online: true, pos: [5, 64, 6], dimension: 'overworld', activity: 'idle'}, {name: 'MisaBot', online: true, pos: [100, 64, -40], dimension: 'the_nether', activity: 'mining'}];
    const give = {ok: true};
    const api = {snapshots: () => snaps, places: () => [], schematics: async () => [], markers: (v) => require('../botui').markersOf(snaps, v === 'Fancy' ? '*' : ['MisaBot'])};
    const {f, ui, end} = await mk({screens: require('../botui-screens'), api});
    f.give = give;
    const click = (player, data, extra = {}) => ui.handle({type: 'click', player, data, ...extra});
    const maps = (p) => f.of('/map').filter((c) => c.body.player === p).map((c) => c.body);
    await ui.handle({type: 'open', player: 'Fancy', gaze: AIM});
    await click('Fancy', {a: 'karte'});
    assert.deepEqual(f.of('/map/give').map((c) => c.body), [{player: 'Fancy'}]);
    assert.equal(ui.state('Fancy').screen.name, 'karte');
    assert.deepEqual(maps('Fancy').at(-1), {player: 'Fancy', zoom: 5, center: null, markers: [{x: 5, z: 6, dim: 'overworld', kind: 'idle', label: 'bot1'}, {x: 100, z: -40, dim: 'the_nether', kind: 'work', label: 'MisaBot'}]});
    await click('Fancy', {a: 'zoom', z: 25}); assert.equal(maps('Fancy').at(-1).zoom, 25);
    const n = f.of('/map').length;
    for (const z of [3, '1e9', 'x', undefined]) { await click('Fancy', {a: 'zoom', z}); assert.match(ui.state('Fancy').flash.text, /ungültiger Zoom/); }
    assert.equal(ui.state('Fancy').mapState.zoom, 25); assert.equal(f.of('/map').length, n);
    await click('Fancy', {a: 'center', bot: 'MisaBot'});
    assert.deepEqual(maps('Fancy').at(-1).center, {x: 100, z: -40, dim: 'the_nether'});
    await click('Fancy', {a: 'center', me: 1}); assert.equal(maps('Fancy').at(-1).center, null);
    // a restricted viewer: own bots only, in markers and as centre
    await ui.handle({type: 'open', player: 'Midari', gaze: AIM});
    await click('Midari', {a: 'center', bot: 'bot1'}); assert.match(ui.state('Midari').flash.text, /nicht dein Bot/);
    await click('Midari', {a: 'karte'});
    assert.deepEqual(maps('Midari').at(-1).markers.map((m) => m.label), ['MisaBot']);
    // every tick posts /map for every viewer, also those without a state; the markers follow the bots
    f.calls.length = 0; snaps[0].pos = [9, 64, 9]; t += 10; await ui.tick();
    assert.deepEqual(f.of('/map').map((c) => c.body.player), ['Fancy', 'Midari']);
    assert.deepEqual(f.of('/map')[0].body.markers[0], {x: 9, z: 9, dim: 'overworld', kind: 'idle', label: 'bot1'});
    // a full inventory is told, not hidden, and the dialog stays on the Lagebild
    f.give = {ok: false, error: 'Inventar voll'};
    await click('Fancy', {a: 'lage'}); await click('Fancy', {a: 'karte'});
    assert.equal(ui.state('Fancy').screen.name, 'lage'); assert.match(ui.state('Fancy').flash.text, /Keine Karte: Inventar voll/);
    // right click on the map opens the Karte, and the Karte is not refreshed
    await ui.handle({type: 'mapclick', player: 'Fancy'});
    assert.equal(ui.state('Fancy').screen.name, 'karte'); assert.equal(ui.state('Fancy').open, true);
    const shown = f.of('/show').length; t += 10; await ui.tick(); assert.equal(f.of('/show').length, shown);
    await ui.handle({type: 'mapclick', player: 'Stranger'}); assert.equal(ui.state('Stranger'), undefined);
    end();
  }
  console.log('botui ok');
})().catch((e) => { console.error(e); process.exit(1); });
