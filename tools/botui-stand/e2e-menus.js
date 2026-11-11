// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-menus.js
// Every distinct menu the crawler (app/test/botui-crawl.js) reached goes to the real Paper plugin for a joined player:
// the plugin must accept it, the window must have the right size and item in every slot, and a click on each slot
// must come back as a click event carrying exactly that slot's payload.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const items = require('minecraft-data')('26.1').itemsByName;
const {connect} = require('./client');

const URL = 'http://127.0.0.1:8101', AUTH = {authorization: 'Bearer stand-token'};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (p, body) => (await fetch(URL + p, {method: body ? 'POST' : 'GET', headers: {...AUTH, ...(body ? {'content-type': 'application/json'} : {})}, body: body && JSON.stringify(body)})).json();
async function waitFor(fn, what, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) { const v = await fn(); if (v) return v; }
  throw new Error('timeout: ' + what);
}
const SIZE = {chest: (m) => m.rows * 9, hopper: () => 5, furnace: () => 3};

(async () => {
  const out = path.join(fs.mkdtempSync(path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'crawl-')), 'menus.json');
  execFileSync(process.execPath, [path.join(__dirname, '../../hosts/bandit-lab/services/mcbots/app/test/botui-crawl.js')], {env: {...process.env, CRAWL_OUT: out}, stdio: 'inherit'});
  const menus = JSON.parse(fs.readFileSync(out, 'utf8'));
  await call('/viewers', {names: ['Viewer']});
  const c = await connect('Viewer');
  await sleep(1500);
  let since = (await call('/events?since=0&wait=0')).last, clicks = 0;
  const bad = [];
  for (const m of menus) {
    if (c.win.id) { c.closeWindow(c.win.id); c.win.id = 0; await sleep(100); } // an equal open menu is refilled in place, without a new window
    const w = c.windows.length, r = await call('/menu', {...m, player: 'Viewer', refresh: false}); // the crawl recorded its own viewer
    if (!r.ok) { bad.push(`${m.title}: refused ${JSON.stringify(r)}`); continue; }
    await waitFor(() => c.windows.length > w && c.win.items.length >= SIZE[m.type](m), `window for ${m.title}`);
    const size = SIZE[m.type](m);
    for (const s of m.slots) {
      const got = c.win.items[s.slot];
      if (!got || got.itemId !== items[s.item].id) bad.push(`${m.title} slot ${s.slot}: want ${s.item}, got ${got?.itemId}`);
    }
    for (let i = 0; i < size; i++) if (!m.slots.some((s) => s.slot === i) && c.win.items[i]?.itemCount) bad.push(`${m.title} slot ${i}: should be empty`);
    for (const s of m.slots) {
      c.clickWindow(s.slot);
      clicks++;
      const e = await waitFor(async () => (await call(`/events?since=${since}&wait=1`)).events.find((x) => x.type === 'click'), `click ${m.title} ${s.slot}`).catch((err) => bad.push(err.message));
      if (e && typeof e === 'object') {
        since = e.id;
        const {shift, ...data} = e.data;
        try { assert.deepEqual(data, s.payload); } catch { bad.push(`${m.title} slot ${s.slot}: payload ${JSON.stringify(data)} != ${JSON.stringify(s.payload)}`); }
      }
      since = Math.max(since, (await call(`/events?since=${since}&wait=0`)).last); // skip what the click left (none expected)
    }
  }
  for (const b of bad) console.log(b);
  await c.end();
  assert.equal(bad.length, 0, `${bad.length} problems in ${menus.length} menus`);
  console.log(`e2e-menus ok (${menus.length} menus, ${clicks} clicks)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
