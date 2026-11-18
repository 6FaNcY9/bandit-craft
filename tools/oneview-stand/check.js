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
// `after(ev, grab)` runs once `ready` is over, in the same page: ev(expression) evaluates, grab(file) saves a screenshot.
async function settle(hash, [width, height], ready, shot, ms = 30000, after = null) {
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
    const grab = async (file) => fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot')).data, 'base64'));
    await until(() => ev(ready), '', ms).catch(() => {}); // the caller's checks say what is missing
    await after?.(ev, grab);
    if (shot) await grab(shot);
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

// Underground view and loose dirt. The stand holds 4 loose dirt cells: the free-standing pillar (3) and the wrong block in the air at
// the plan's corner; the dirt block with two drawn neighbours is not loose, and a scan of the stand world found no natural loose dirt.
// bot9 stands in a cave under 6 rock cells (y 40), so a tap on its row must cut at 41. Real-time waits: the page counts once a second.
const LOOSE = 4, DATA = 'document.getElementById("view").dataset';
const CUT = 'JSON.stringify({hidden: cutY.hidden, value: cutY.value, label: cutLbl.textContent, cut: ' + DATA + '.cut})';
// red vertices (the loose colour at any light) in the meshes that hold loose dirt
const RED = '(() => { let n = 0; view.scene.traverse((o) => { const c = o.geometry?.attributes.color; if (c && o.userData.loose) for (let i = 0; i < c.array.length; i += 3) if (c.array[i] >= 120 && c.array[i + 1] <= 45 && c.array[i + 2] <= 45) n++; }); return n; })()';
async function partUnder() {
  const shots = ['phone-loose.png', 'phone-under.png'].map((f) => path.join(OUT, f));
  await settle('', [390, 844], `${WORLD} && +${DATA}.loose === ${LOOSE}`, null, 60000, async (ev, grab) => {
    const wait = (expr, line) => until(() => ev(expr), line);
    const chip = () => ev('(c => c.hidden ? "hidden" : c.textContent)(document.getElementById("looseChip"))');
    await sleep(1500); // one counter refresh: the number must hold
    ok(+await ev(`${DATA}.loose`) === LOOSE, `/: data-loose is ${await ev(`${DATA}.loose`)}, want ${LOOSE}`);
    ok(await chip() === `🟥 ${LOOSE} lose Erde`, `/: #looseChip "${await chip()}", want "🟥 ${LOOSE} lose Erde"`);
    // the pillar and the block with two neighbours in view; the loose switch must change colours only: same triangles with the red off and on
    await ev('view.flyTo(-254, 65, -10.5, 22)');
    await sleep(1500);
    await grab(shots[0]);
    const tris = await ev(`${DATA}.tris`);
    ok(await ev(RED) > 0, '/: no red vertices with the loose switch on');
    for (const on of [false, true]) {
      await ev('document.getElementById("looseChip").click()');
      await wait(on ? `${RED} > 0` : `${RED} === 0`, `/: the red does not go ${on ? 'on' : 'off'} after a tap on #looseChip`);
      await sleep(1500);
      ok(await ev(`${DATA}.tris`) === tris && await chip() === `🟥 ${LOOSE} lose Erde`, `/: after the red goes ${on ? 'on' : 'off'}: data-tris ${await ev(`${DATA}.tris`)} (want ${tris}), #looseChip "${await chip()}"`);
    }
    // a tap on bot9's row in the 🤖 sheet: the roof is rock, so the cut goes to Höhe 41 by itself
    await ev('document.querySelector("#bar [data-sheet=bots]").click()');
    await wait('[...document.querySelectorAll(".botrow")].some((r) => r.textContent.includes("bot9"))', '/: no bot9 row in the 🤖 sheet');
    await ev('[...document.querySelectorAll(".botrow")].find((r) => r.textContent.includes("bot9")).click()');
    let s = '';
    await until(async () => { s = JSON.parse(await ev(CUT)); return !s.hidden && s.value === '41' && s.label === 'Höhe 41' && s.cut === '41'; }, '')
      .catch(() => { throw new Error(`bot9 row: ${JSON.stringify(s)}, want #cutY shown at 41, #cutLbl "Höhe 41", data-cut "41"`); });
    await wait(`+${DATA}.loose === 0 && document.getElementById("looseChip").hidden`, 'bot9 row: the loose dirt above the cut is still counted');
    await sleep(1500); // the camera follows the ack
    await grab(shots[1]);
    ok((await ev('document.getElementById("tags").textContent')).includes('bot9 · Höhe 40'), `bot9 row: #tags has no "bot9 · Höhe 40"`);
  });
  for (const f of shots) ok(fs.existsSync(f), `no screenshot ${f}`);
}

module.exports = {chrome, get, ok, until, settle, BASE, OUT};

if (require.main === module) {
  (async () => {
    await partA();
    await partB();
    await partUnder();
    console.log('stand ok');
  })().catch((e) => { console.error(`FAIL ${e.message}`); process.exit(1); });
}
