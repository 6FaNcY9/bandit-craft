#!/usr/bin/env node
'use strict';
// Checks against a running stand (stand.js); exit 0 and "stand ok", or exit 1 with the failed line.
//   node tools/oneview-stand/check.js [--port 8195] [--out <dir>]
// Part A: the hub's HTTP side. Part B (tasks 10-12): the page in headless Chromium through chrome() and settle(); --out is where
// its screenshots go. Needs no npm module.
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i < 0 ? dflt : process.argv[i + 1]; };
const PORT = Number(arg('--port', 8195));
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', path.join(os.tmpdir(), 'oneview-check'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { const r = await fetch(BASE + p); return {status: r.status, json: r.headers.get('content-type')?.includes('json') ? await r.json() : null}; };
function ok(cond, line) { if (!cond) throw new Error(line); }
async function until(fn, line, ms = 30000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { try { const v = await fn(); if (v) return v; } catch {} }
  throw new Error(line);
}

// Headless Chromium with software WebGL; its own profile, so a Chromium the owner has open is never reused.
// --password-store=basic: without it the GNOME keyring dialog pops up on the owner's screen.
let profile = null;
process.on('exit', () => { if (profile) fs.rmSync(profile, {recursive: true, force: true}); });
function chrome(args) {
  profile ??= fs.mkdtempSync(path.join(os.tmpdir(), 'oneview-chrome-'));
  try {
    return execFileSync('nix', ['shell', 'nixpkgs#chromium', '-c', 'chromium', '--headless=new', '--password-store=basic', '--no-first-run', '--hide-scrollbars',
      '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--virtual-time-budget=15000', `--user-data-dir=${profile}`, ...args],
    // TMPDIR=/tmp: Chromium puts unix sockets there, and a long TMPDIR passes the socket path limit (SIGABRT)
    {encoding: 'utf8', timeout: 120000, maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, TMPDIR: '/tmp'}});
  } catch (e) { throw new Error(`chromium ${args.at(-1)}: ${e.signal || e.status} ${String(e.stderr || '').slice(-1500)}`); }
}

// The page in real time over the DevTools protocol: virtual time (chrome()) runs out while the world still loads in its
// worker. Waits until the page expression `ready` is true or `ms` pass, then returns the DOM; `shot` saves a screenshot.
async function settle(hash, [width, height], ready, shot, ms = 30000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneview-cdp-'));
  const ch = spawn('nix', ['shell', 'nixpkgs#chromium', '-c', 'chromium', '--headless=new', '--password-store=basic', '--no-first-run', '--hide-scrollbars',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--user-data-dir=${dir}`, '--remote-debugging-port=0', 'about:blank'], {stdio: 'ignore', env: {...process.env, TMPDIR: '/tmp'}});
  try {
    const port = await until(() => fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0], 'chromium: no DevToolsActivePort', 60000);
    const tab = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'), 'chromium: no page');
    const ws = new WebSocket(tab.webSocketDebuggerUrl), wait = new Map();
    let id = 0;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); wait.get(m.id)?.(m.result); wait.delete(m.id); };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const send = (method, params = {}) => new Promise((res) => { wait.set(++id, res); ws.send(JSON.stringify({id, method, params})); });
    const ev = async (expression) => (await send('Runtime.evaluate', {expression, returnByValue: true})).result.value;
    await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url: `${BASE}/${hash}`});
    await until(() => ev(ready), '', ms).catch(() => {}); // the caller's checks say what is missing
    if (shot) fs.writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot')).data, 'base64'));
    return await ev('document.documentElement.outerHTML');
  } finally {
    ch.kill();
    // its helper processes outlive the browser for a moment and would write the profile again
    await until(() => { try { execFileSync('pgrep', ['-f', dir]); } catch { return true; } }, '', 10000).catch(() => {});
    fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5});
  }
}

async function partA() {
  const st = await until(async () => { const s = (await get('/api/world/stats')).json; return s?.hub?.sections === 34 * 24 && s; }, '/api/world/stats: hub.sections never reached 34 * 24');
  ok(st.hub.ungenerated === 1, `/api/world/stats: hub.ungenerated is ${st.hub.ungenerated}, want 1`);
  const state = await until(async () => { const s = (await get('/api/state')).json; return s.worldSeq > 0 && Array.isArray(s.bots.find((b) => b.name === 'bot8')?.pos) && s; }, '/api/state: no worldSeq > 0 and bot8 with a pos');
  ok(state.projects.bot1?.file === 'haus.litematic', '/api/state: projects.bot1.file is not haus.litematic');
  const plan = await get('/api/plan/status?bot=bot1');
  ok(plan.status === 200, `/api/plan/status?bot=bot1: HTTP ${plan.status}`);
  const [missing, built, wrong, unknown] = plan.json.counts;
  ok(missing > 0 && built > 0 && wrong === 1 && unknown === 0, `/api/plan/status?bot=bot1: counts ${plan.json.counts}, want missing > 0, built > 0, wrong 1, unknown 0`);
  const none = await get('/api/plan/status?bot=bot2');
  ok(none.status === 404, `/api/plan/status?bot=bot2: HTTP ${none.status}, want 404`);
  const js = await get('/oneview/worker.js');
  ok(js.status === 200, `/oneview/worker.js: HTTP ${js.status}`);
}

// Part B: the page in a phone and a desktop window, one --dump-dom per URL; a shown element has no hidden attribute.
const PHONE = '--window-size=390,844';
const page = (hash, size = PHONE) => chrome([size, '--dump-dom', `${BASE}/${hash}`]);
function shown(dom, attr) {
  const tag = dom.split('<script>')[0].match(new RegExp(`<[a-z]+[^>]*\\s${attr}[^>]*>`))?.[0];
  ok(tag, `no element with ${attr}`);
  return !/\shidden[\s=>]/.test(tag);
}
// every known chunk of the stand (34) is counted and has a mesh
const WORLD = '(v => +v.dataset.chunks >= 34 && +v.dataset.meshes >= 34)(document.getElementById("view"))';
async function partB() {
  fs.mkdirSync(OUT, {recursive: true});
  let d = await settle('', [390, 844], WORLD, path.join(OUT, 'phone.png'));
  ok(!shown(d, 'id="sheet"') && !shown(d, 'id="chatBtn"') && shown(d, 'id="bar"'), '/: want #sheet and #chatBtn hidden, #bar shown');
  // the phone look
  const view = d.match(/<canvas id="view"[^>]*>/)?.[0] || '', num = (k) => Number(new RegExp(`data-${k}="(\\d+)"`).exec(view)?.[1]);
  ok(num('chunks') >= 34 && num('meshes') >= 34, `/: <canvas id="view"> data-chunks ${num('chunks')}, data-meshes ${num('meshes')}, want both >= 34`);
  ok(!shown(d, 'id="worldMsg"'), '/: #worldMsg is shown');
  await settle('#bots', [1280, 800], WORLD, path.join(OUT, 'desktop-bots.png'));
  d = page('#bots');
  ok(shown(d, 'data-page="home"') && !shown(d, 'data-page="orders"'), '/#bots: want home shown, orders hidden');
  ok(shown(page('#bots/orders'), 'data-page="orders"'), '/#bots/orders: orders is hidden');
  ok(shown(page('#plan'), 'data-page="project"'), '/#plan: project is hidden');
  ok(shown(page('#plan/plan'), 'data-page="plan"'), '/#plan/plan: plan („Datei ansehen“) is hidden');
  d = page('#menu/server');
  ok(shown(d, 'data-page="server"') && /<body[^>]*\sdata-sheet="menu"/.test(d), '/#menu/server: want server shown and body data-sheet="menu"');
  const out = path.join(OUT, 'phone-bots.png');
  fs.rmSync(out, {force: true});
  await settle('#bots', [390, 844], WORLD, out);
  ok(fs.existsSync(out), `no screenshot ${out}`);
  // bots, players and plans in the world; the first poll taps the plan's chip, so the camera flies to the house
  const PLAN = `${WORLD} && (v => { const b = document.querySelector("#planChips button"); if (b && !self.flew) { self.flew = 1; b.click(); return false; }`
    + ` return !!b && +v.dataset.bots === 2 && +v.dataset.plans === 1; })(document.getElementById("view"))`;
  for (const [file, size] of [['phone-plan.png', [390, 844]], ['desktop-plan.png', [1280, 800]]]) {
    d = await settle('#plan', size, PLAN, path.join(OUT, file));
    const text = (re) => (d.match(re)?.[1] || '').replace(/<[^>]+>/g, ' ');
    const chips = text(/id="planChips"[^>]*>([\s\S]*?)<\/section>/), p = Number(/(\d+) %/.exec(chips)?.[1]);
    ok(chips.includes('haus') && p >= 1 && p <= 99 && !chips.includes('?'), `/#plan ${file}: #planChips "${chips.trim()}", want haus and a percent 1..99 without "?"`);
    const view = d.match(/<canvas id="view"[^>]*>/)?.[0] || '';
    ok(/data-bots="2"/.test(view) && /data-plans="1"/.test(view), `/#plan ${file}: ${view}, want data-bots="2" and data-plans="1"`);
    const tags = text(/id="tags"[^>]*>([\s\S]*?)<\/div><span/);
    ok(tags.includes('bot8') && tags.includes('bot9'), `/#plan ${file}: #tags "${tags.trim()}", want bot8 and bot9`);
  }
}

module.exports = {chrome, get, ok, until, settle, BASE, OUT};

if (require.main === module) {
  (async () => {
    await partA();
    await partB();
    console.log('stand ok');
  })().catch((e) => { console.error(`FAIL ${e.message}`); process.exit(1); });
}
