#!/usr/bin/env node
'use strict';
// Checks against a running stand (stand.js); exit 0 and "stand ok", or exit 1 with the failed line.
//   node tools/oneview-stand/check.js [--port 8195] [--out <dir>]
// Part A: the hub's HTTP side. Part B (tasks 10-12): the page in headless Chromium through chrome(); --out is where
// its screenshots go. Needs no npm module.
const {execFileSync} = require('node:child_process');
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
const PHONE = '--window-size=390,844', DESKTOP = '--window-size=1280,800';
const page = (hash, size = PHONE) => chrome([size, '--dump-dom', `${BASE}/${hash}`]);
function shown(dom, attr) {
  const tag = dom.split('<script>')[0].match(new RegExp(`<[a-z]+[^>]*\\s${attr}[^>]*>`))?.[0];
  ok(tag, `no element with ${attr}`);
  return !/\shidden[\s=>]/.test(tag);
}
async function partB() {
  let d = page('');
  ok(!shown(d, 'id="sheet"') && !shown(d, 'id="chatBtn"') && shown(d, 'id="bar"'), '/: want #sheet and #chatBtn hidden, #bar shown');
  d = page('#bots');
  ok(shown(d, 'data-page="home"') && !shown(d, 'data-page="orders"'), '/#bots: want home shown, orders hidden');
  ok(shown(page('#bots/orders'), 'data-page="orders"'), '/#bots/orders: orders is hidden');
  ok(shown(page('#plan'), 'data-page="project"'), '/#plan: project is hidden');
  ok(shown(page('#plan/plan'), 'data-page="plan"'), '/#plan/plan: plan („Datei ansehen“) is hidden');
  d = page('#menu/server');
  ok(shown(d, 'data-page="server"') && /<body[^>]*\sdata-sheet="menu"/.test(d), '/#menu/server: want server shown and body data-sheet="menu"');
  fs.mkdirSync(OUT, {recursive: true});
  for (const [file, size, hash] of [['phone.png', PHONE, ''], ['phone-bots.png', PHONE, '#bots'], ['desktop-bots.png', DESKTOP, '#bots']]) {
    const out = path.join(OUT, file);
    fs.rmSync(out, {force: true});
    chrome([size, `--screenshot=${out}`, `${BASE}/${hash}`]);
    ok(fs.existsSync(out), `no screenshot ${out}`);
  }
}

module.exports = {chrome, get, ok, until, BASE, OUT};

if (require.main === module) {
  (async () => {
    await partA();
    await partB();
    console.log('stand ok');
  })().catch((e) => { console.error(`FAIL ${e.message}`); process.exit(1); });
}
