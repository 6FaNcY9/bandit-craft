#!/usr/bin/env node
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {WebSocketServer} = require('ws');
const {loadConfig} = require('./config');
const {BotRunner, keptOf, VALIDATE, projectMaterials, SCHEMATIC_DIR} = require('./bots');
const buildLib = require('./build');
const schematicLib = require('./schematic');
const {WorldModel, startBlueMap} = require('./world');
const {WINDOW_MS} = require('./debug');
const {Hub, RemoteRunner, createWorkerServer} = require('./hub');
const {EventLog} = require('./events');
const archive = require('./archive');
const gravesLib = require('./graves');
const {NtfyNotifier} = require('./notify');
const {Keeper, idle} = require('./keeper');
const {Board} = require('./board');
const scenarioRun = require('./scenario-run');
const {Plan} = require('./plan');
const planConfig = require('./plan-config');
const {botView} = require('./view');
const {scanAround} = require('./scan');
const {Alerts, chestWarnings} = require('./alerts');
const {Settings} = require('./settings');
const {Places, use: usePlaces, protectedBoxes} = require('./places');
const {BlockLog, Exporter, areaBoxes} = require('./blocklog');
const {Projects, PROJECTS} = require('./projects');
const {Crews} = require('./crews');
const agentauth = require('./agentauth');
const voxels = require('./voxels');
let voxelBusy = false; // one /api/voxels read at a time
const {Slayer} = require('./slayer');
const {Admin, queued} = require('./admin');

const cfg = loadConfig();
const log = (who, msg) => console.log(`${new Date().toISOString()} [${who}] ${msg}`);
const world = new WorldModel();
if (process.env.STATE_DIR) world.persistChests(path.join(process.env.STATE_DIR, 'chests.json')); // the storage index
if (process.env.STATE_DIR) world.persistExperience(path.join(process.env.STATE_DIR, 'experience.json'));
const notifier = new NtfyNotifier();
const rescuers = []; // filled below, once the supply chest is known (rescue.js)
// Every event and, every 30 s, every bot's state go to STATE_DIR/archive for later evaluation and training
// (archive.js); the 200-entry ring alone lost the night's deaths. SESSION tells server runs apart (dataset.js).
const ARCHIVE = process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'archive') : null;
const SESSION = Date.now().toString(36);
// The owner's orders (dashboard, not an agent): the job each bot was last given, {type, args}. Until that job finishes
// (or the owner stops or replaces it) no agent order reaches the bot (agentauth): while it ran was not enough, the agents
// took the bots in the gap after every restart, before their jobs resumed (2026-10-16). A failure starts the job again
// later (agentauth.orderOutcome). Kept across restarts.
const ordersFile = process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'owner-orders.json') : null;
const ownerOrders = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(ordersFile, 'utf8'))).map(([b, o]) => [b, typeof o === 'string' ? {type: o} : o]); } catch { return []; } })());
const saveOrders = () => { if (ordersFile) try { fs.writeFileSync(ordersFile, JSON.stringify(Object.fromEntries(ownerOrders))); } catch {} };
const orderRetryAt = new Map(); // bot -> before then a failed order does not start again
const deathTimes = new Map(); // bot -> its recent deaths (agentauth.deathLoop)
const orderEnded = (e) => {
  const order = ownerOrders.get(e.bot), out = agentauth.orderOutcome(e, order);
  if (out?.end) { ownerOrders.delete(e.bot); saveOrders(); }
  if (out?.retry) orderRetryAt.set(e.bot, Math.max(orderRetryAt.get(e.bot) || 0, Date.now() + out.retry)); // never cuts a death hold short
  if (e.kind === 'death') { // every bot's, not only one with an order: a queue of jobs kills it just as well
    const d = agentauth.deathLoop(deathTimes.get(e.bot) || [], e.t);
    deathTimes.set(e.bot, d.times);
    if (d.hold) {
      const r = runners.get(e.bot), queued = r?.snapshot().queue?.length || 0;
      if (order) orderRetryAt.set(e.bot, e.t + agentauth.DEATH_HOLD_MS);
      if (queued) {
        r.enqueue('stop');
        delete toResume[e.bot];
        projects.pause(e.bot);
      }
      events.add('base', 'alert', agentauth.deathLoopAlert(e.bot, order, queued));
    }
  }
};
// Every minute an owner order whose bot is online and idle starts again (after a failure's wait, also after a restart).
setInterval(() => {
  for (const [name, order] of agentauth.ordersToStart(ownerOrders, (n) => runners.get(n)?.snapshot(), orderRetryAt)) {
    orderRetryAt.delete(name);
    events.add(name, 'info', `the owner's ${order.type} order goes on`);
    try { runners.get(name).enqueue(order.type, order.args); } catch (err) {
      orderRetryAt.set(name, Date.now() + agentauth.ORDER_RETRY_MS);
      events.add(name, 'info', `the owner's ${order.type} order could not go on: ${err.message}`);
    }
  }
  // Idle bots without an owner order help with another bot's need (the needs board, bots.js helpOnce); only when
  // there is one, so an idle crew does not log a help job every minute.
  const open = world.openNeeds();
  for (const [name, runner] of runners) {
    const s = runner.snapshot();
    if (s.online && !s.job && !(s.queue || []).length && !ownerOrders.has(name) && open.some((n) => n.bot !== name)) {
      try { runner.enqueue('help', {}); } catch {}
    }
  }
}, 60000).unref();
const events = new EventLog({onAdd: (e) => { notifier.event(e); for (const r of rescuers) r.event(e); orderEnded(e); if (ARCHIVE) archive.append(path.join(ARCHIVE, 'events.jsonl'), {server_session: SESSION, event: e}); }});
// What the LLM agents said and chose (POST /api/decision from the agent service), kept apart so
// they never push job events out of the 200-entry event log.
const decisions = new EventLog();
const slayer = new Slayer({url: cfg.slayerUrl, cmd: cfg.slayerStatusCmd, decisions});
// Owner-only server administration (RCON); not wired when RCON_HOST is unset.
const mainConsole = cfg.rcon ? queued(cfg.rcon) : null; // one chain for the admin panel and the rescue
const admin = cfg.rcon ? new Admin({call: mainConsole, events, botNames: [...cfg.names, ...cfg.agentBots, ...cfg.planRoster, ...Object.values(cfg.hubWorkers).flat()]}) : null;
const agentStatuses = new Map(); // agent -> its last POST /api/agentstatus (goal, workers, role, t)
const stopBlueMap = startBlueMap(world, cfg.bluemapUrl, log);
const demoLog = require('./owner').makeDemoLog(process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'demonstrations.jsonl') : null);
const runners = new Map(cfg.names.map((n) => [n, new BotRunner(n, {host: cfg.mcHost, port: cfg.mcPort, log, world, protectedAreas: cfg.protectedAreas, supplyChest: cfg.supplyChest, loginSeed: cfg.loginSeed, hostLabel: cfg.hostLabel, ownerUuids: cfg.ownerUuids, demoLog, onEvent: (b, k, t) => events.add(b, k, t)})]));
const settings = new Settings(process.env.STATE_DIR || '');
const projects = new Projects(process.env.STATE_DIR || '');
const crews = new Crews(process.env.STATE_DIR || '', {agentBots: cfg.agentBots, bots: cfg.names});
for (const r of runners.values()) r.getSettings = () => settings.get(r.name);
if (ARCHIVE) setInterval(() => { try { archive.append(path.join(ARCHIVE, 'states.jsonl'), {server_session: SESSION, t: Date.now(), bots: [...runners.values()].map((r) => r.snapshot())}); } catch {} }, 30000).unref();
const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const legacy = fs.readFileSync(path.join(__dirname, 'public', 'legacy.html')); // the old page, under "Mehr"
const three = fs.readFileSync(path.join(__dirname, 'public', 'vendor', 'three.min.js')); // three.js r159 (MIT), the last release with a classic-script build
// The page is one file with inline script and style: allow exactly those two
// bodies by hash, plus this server's own files ('self': the vendored three.js of the 3D map);
// no CDN, no eval, no other origin.
const sha = (html, re) => `'sha256-${require('node:crypto').createHash('sha256').update(String(html).match(re)?.[1] ?? '').digest('base64')}'`;
const csp = (html) => `default-src 'none'; script-src 'self' ${sha(html, /<script>([\s\S]*?)<\/script>/)}; style-src ${sha(html, /<style>([\s\S]*?)<\/style>/)}; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const CSP = csp(page), LEGACY_CSP = csp(legacy); // each page allows its own bodies only
// Remote workers register themselves in `runners` (see hub.js), so the
// dashboard, /api/state and /api/debug list them next to the lab's bots.
const hub = cfg.workerToken ? new Hub({world, runners, token: cfg.workerToken, workers: cfg.hubWorkers, log, protectedAreas: cfg.protectedAreas, supplyChest: cfg.supplyChest, events, settings}) : null;
const workerServer = hub ? createWorkerServer(hub) : null;

// tailscale serve sets Tailscale-User-Login for tailnet users. When
// ALLOWED_TS_LOGINS is set, nothing is served without it.
// Standing orders: only with a supply chest and at least one quota; switched off at every start.
const keeper = cfg.keeperQuotas.length || cfg.planEnable ? new Keeper({runners, world, chest: cfg.supplyChest, quotas: cfg.keeperQuotas, site: cfg.keeperSite, places: () => places, events, log, file: process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'keeper.json') : null, skip: cfg.boardBots}) : null;
// The job board (board.js): owner jobs cut into slices that only BOARD_BOTS dig. A box touching a protected area
// (PROTECTED_AREAS and the dashboard's protected zones, which join that array) is refused when the job is made.
const touches = (b) => cfg.protectedAreas.find(([x1, z1, x2, z2, y1, y2]) => b.x1 <= x2 && b.x2 >= x1 && b.z1 <= z2 && b.z2 >= z1 && (y1 == null || y2 == null || (b.y1 <= y2 && b.y2 >= y1)));
const board = cfg.boardBots.length ? new Board({file: process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'board.json') : null, locked: (b) => { const a = touches(b); return a && `the protected area ${a.slice(0, 4).join(' ')}`; }}) : null;
let scenarioRunning = false;
// Map markers: the first 'supply' place is the supply chest for every bot, the
// hub's workers and the keeper; the first 'site' place is where the keeper works.
const places = new Places(process.env.STATE_DIR || '');
usePlaces(places); // zones: plan-config and the job validators read them from here
places.seed(planConfig.seedZones()); // first start only
// Block log (blocklog.js): who built or destroyed what where, exported for the BlueMap overlay.
const blocklog = new BlockLog({file: process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'blocklog.jsonl') : null, areas: () => areaBoxes(places.list, process.env.BLOCKLOG_AREA)});
world.blocklog = blocklog;
const overlay = process.env.BLOCKLOG_EXPORT_DIR ? new Exporter({log: blocklog, places: () => places.list, dir: process.env.BLOCKLOG_EXPORT_DIR, say: (m) => log('blocklog', m)}) : null;
const blocklogTimer = setInterval(() => (overlay ? overlay.tick() : blocklog.flush()), 15000);
let supplyChest = cfg.supplyChest;
// Stranded bots go back to the base over the console of their server (rescue.js): the sandbox's without more ado,
// the main server's only with RESCUE_SPOT (owner 2026-10-19), and there only the rescue's guarded tp.
// ponytail: in the sandbox they land one block east and two north of the supply chest; a landing place if that ever moves.
const {Rescue} = require('./rescue');
if (cfg.sandboxRcon) rescuers.push(new Rescue({call: queued(cfg.sandboxRcon), events, target: () => supplyChest && {x: supplyChest.x + 1, y: supplyChest.y, z: supplyChest.z - 2}}));
if (mainConsole && cfg.rescueSpot) rescuers.push(new Rescue({call: mainConsole, events, label: 'main server', target: () => cfg.rescueSpot}));
if (rescuers.length) setInterval(() => { const snaps = [...runners.values()].map((r) => r.snapshot()); for (const r of rescuers) r.watch(snaps); }, 60000).unref();
const supplyStock = () => (supplyChest ? world.stockAt(supplyChest) : world.stock); // the supply chest's numbers, not the plan's base chest's
const staticAreas = cfg.protectedAreas.slice();
function applyPlaces() {
  // 'protected' zones join PROTECTED_AREAS in place: runners and the hub hold this very array.
  cfg.protectedAreas.splice(0, cfg.protectedAreas.length, ...staticAreas, ...protectedBoxes(places.list));
  const s = places.first('supply'), site = places.first('site');
  supplyChest = s ? {x: s.x, y: s.y, z: s.z} : cfg.supplyChest;
  const w = places.zone('wheat')?.box;
  const wheatField = w ? {x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2} : null; // hungry bots get bread there (bots.js wheatFood)
  for (const r of runners.values()) if (!(r instanceof RemoteRunner)) Object.assign(r, {supplyChest, wheatField});
  if (hub) { Object.assign(hub, {supplyChest, wheatField}); hub.broadcastPolicy(); }
  if (keeper) {
    keeper.chest = supplyChest;
    keeper.site = site ? {x: site.x, y: site.y, z: site.z} : cfg.keeperSite;
  }
}
applyPlaces();
// The plan (R7): available only with PLAN_ENABLE; whether it is switched on, and what it has done, is kept in plan.json.
const SOLVER_SKIPPABLE = new Set(planConfig.OBJECTIVES.filter((o) => o.onBlocked === 'skip' && !planConfig.OBJECTIVES.some((x) => x.needs.includes(o.id))).map((o) => o.id));
const plan = cfg.planEnable ? new Plan({runners, world, keeper, places, events, objectives: planConfig.OBJECTIVES, roster: cfg.planRoster, chest: planConfig.BASE.chest, file: process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'plan.json') : null, log}) : null;

// Long jobs survive a restart (deploys restart the container): every 5 s the
// running and queued shift/guard/mine/chop jobs go to STATE_DIR/jobs.json and
// are queued again at start; a mine/chop keeps only what is left of its count.
const jobsFile = process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'jobs.json') : null;
// A worker's bots report their own list (hub.js), so bot16-bot18 survive a hub restart too.
const keptJobs = () => {
  const out = {};
  for (const r of runners.values()) {
    const list = r instanceof RemoteRunner ? r.kept : keptOf(r);
    if (list.length) out[r.name] = list;
  }
  return out;
};
// Saved jobs wait until their bot is online (a job started before the login fails at once).
let toResume = {};
if (jobsFile) {
  try {
    toResume = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  } catch {} // none saved
}
const resumeUntil = Date.now() + 300000; // a bot still away after 5 min starts with no job
function resumeJobs() {
  if (Date.now() > resumeUntil) toResume = {};
  for (const [name, list] of Object.entries(toResume)) {
    const r = runners.get(name);
    if (!r) continue; // a remote bot whose worker has not connected yet: the 5 min window decides
    const remote = r instanceof RemoteRunner;
    if (!r.online || (remote ? r.snap.dead : r.dead)) continue;
    delete toResume[name];
    if (remote && (r.snap.job || r.snap.queue.length)) continue; // the worker kept playing through the hub restart
    if (remote) r.kept = list; // keep them in the saved file until the worker's next status reports them
    for (const j of list) {
      try {
        r.enqueue(j.type, j.args);
        events.add(name, 'info', `resumed after restart: ${j.type}`);
      } catch {} // an entry the validator refuses is dropped
    }
  }
}
// What the file holds: running/queued jobs, plus jobs still waiting for their bot to log in.
let jobsSaved = '';
function saveJobs(force = false) {
  if (!jobsFile) return null;
  const now = JSON.stringify({...toResume, ...keptJobs()});
  if (!force && now === jobsSaved) return null;
  try {
    fs.writeFileSync(`${jobsFile}.tmp`, now);
    fs.renameSync(`${jobsFile}.tmp`, jobsFile);
    jobsSaved = now;
    return null;
  } catch (e) {
    log('jobs', `could not save: ${e.message}`);
    return e.message;
  }
}
const jobsTimer = jobsFile ? setInterval(() => {
  resumeJobs();
  saveJobs();
}, 2000) : null;
const peer = (req) => String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
const authorized = (req) => {
  if (!cfg.allowed.length) return true;
  if (cfg.trustedProxies.length && !cfg.trustedProxies.includes(peer(req))) return false;
  return cfg.allowed.includes(req.headers['tailscale-user-login']);
};
const solverLimiter = new agentauth.SolverLimiter();
const agentTokenHash = cfg.agentToken ? agentauth.hash(cfg.agentToken) : null;
// Cross-site guard: browsers send Origin on POST/WS; it must match Host.
const sameOrigin = (req) => {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    return new URL(o).host === req.headers.host;
  } catch {
    return false;
  }
};
const state = () => ({now: Date.now(), lastEventId: events.lastId, keeper: keeper?.state() || null, plan: plan?.state() || null, bots: [...runners.values()].map((r) => ({...r.snapshot(), settings: settings.get(r.name)})), world: world.snapshot(), protectedAreas: cfg.protectedAreas, supplyChest, places: places.list, projects: projects.view(), chest: supplyStock() && {warnings: chestWarnings(supplyStock().items, supplyStock().free)}});

// A schematic upload: the raw .litematic, at most 4 MB.
function readBytes(req, max = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > max) {
        reject(new Error('file too large (4 MB at most)'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
// The schematics in the state volume with their size and block count (parsed once per file version).
const schematicInfo = new Map(); // file -> {mtime, info}
async function listSchematics() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(SCHEMATIC_DIR).filter((f) => buildLib.SCHEMATIC_RE.test(f)); } catch {}
  for (const file of files) {
    const st = fs.statSync(path.join(SCHEMATIC_DIR, file));
    let c = schematicInfo.get(file);
    if (!c || c.mtime !== st.mtimeMs) {
      try {
        const s = await schematicLib.parseLitematic(fs.readFileSync(path.join(SCHEMATIC_DIR, file)));
        const bom = schematicLib.billOfMaterials(s.blocks);
        c = {mtime: st.mtimeMs, info: {file, name: s.name, size: s.size, blocks: s.blocks.length, items: bom.items}};
      } catch (e) {
        c = {mtime: st.mtimeMs, info: {file, error: e.message.slice(0, 120)}};
      }
      schematicInfo.set(file, c);
    }
    out.push(c.info);
  }
  return out;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 8192) { // a 75-block build blueprint is ~3-5 KB
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
  });
}

// BlueMap low-res tiles (top half colour, bottom half height) for the map,
// fetched server-side so the page stays same-origin. Small in-memory cache.
const TILE_RE = /^\/api\/tile\/(world|world_the_nether|world_the_end)\/([1-3])\/x(-?\d{1,5})\/z(-?\d{1,5})\.png$/;
const tiles = new Map(); // path -> {t, body|null}
async function tile(rel) {
  const hit = tiles.get(rel);
  if (hit && Date.now() - hit.t < 300000) return hit.body;
  let body = null;
  try {
    const r = await fetch(`${cfg.bluemapUrl}/maps/${rel}`, {signal: AbortSignal.timeout(5000)});
    if (r.ok) body = Buffer.from(await r.arrayBuffer());
  } catch {}
  tiles.delete(rel);
  tiles.set(rel, {t: Date.now(), body});
  if (tiles.size > 400) tiles.delete(tiles.keys().next().value); // ponytail: FIFO cap, ~400 tiles x ~300 KB worst case
  return body;
}

// A bot in its night shelter or fetching food takes no agent order (agentauth restingOf), or null.
const busyOf = (s) => (!s ? null : s.sheltered ? `${s.name} shelters in the ground until morning; it takes orders again then` : s.gettingFood ? `${s.name} is hungry (food ${s.food}) and fetching food; it takes orders again once it has some` : null);

const server = http.createServer(async (req, res) => {
  const send = (code, type, body, policy = CSP) => {
    res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': policy, 'Referrer-Policy': 'no-referrer'});
    res.end(body);
  };
  const json = (code, obj) => send(code, 'application/json', JSON.stringify(obj));
  const url = new URL(req.url, 'http://x');
  // A request with a bearer is the agent service (H5) and nothing else: a wrong token never falls
  // back to the human path, and the token only reaches state, events and its own bots' jobs.
  const agent = agentauth.bearerMatches(req.headers.authorization, agentTokenHash);
  if (agent === false || (agent && !agentauth.agentEndpoint(req.method, url.pathname))) return json(403, {error: 'forbidden'});
  if (!agent && !authorized(req)) {
    if (req.headers['tailscale-user-login']) log('auth', `refused a Tailscale identity from ${peer(req)} (not a trusted proxy)`);
    return json(403, {error: 'forbidden'});
  }
  if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', page);
  if (req.method === 'GET' && url.pathname === '/mehr') return send(200, 'text/html; charset=utf-8', legacy, LEGACY_CSP);
  if (req.method === 'GET' && url.pathname === '/api/state') return json(200, state());
  if (req.method === 'GET' && url.pathname === '/api/schematics') return json(200, await listSchematics());
  if (req.method === 'POST' && url.pathname === '/api/schematic') {
    if (!sameOrigin(req) || req.headers['content-type'] !== 'application/octet-stream') return json(403, {error: 'bad origin'});
    try {
      const file = String(url.searchParams.get('name') || '').replace(/\.litematic$/i, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) + '.litematic';
      if (!buildLib.SCHEMATIC_RE.test(file) || file === '.litematic') throw new Error('name: letters, digits, - and _');
      const bytes = await readBytes(req);
      const s = await schematicLib.parseLitematic(bytes); // refuse anything that is not a litematic
      fs.mkdirSync(SCHEMATIC_DIR, {recursive: true});
      fs.writeFileSync(path.join(SCHEMATIC_DIR, file), bytes);
      events.add('dashboard', 'info', `schematic ${file} uploaded (${s.blocks.length} blocks)`);
      return json(200, {file, blocks: s.blocks.length, size: s.size});
    } catch (e) {
      return json(400, {error: e.message.slice(0, 200)});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/chests') {
    // Every chest the bots counted: the storage index, the supply chest's last deposit, the projects' chests.
    const now = Date.now(), out = [];
    for (const [k, c] of world.chests) {
      const [x, y, z] = k.split(',').map(Number);
      out.push({kind: 'lager', dim: 'overworld', x, y, z, items: c.items, free: c.free, ageS: Math.round((now - c.t) / 1000)});
    }
    for (const st of world.stocks.values()) if (st.chest) out.push({kind: 'vorrat', dim: 'overworld', ...st.chest, items: st.items, free: st.free, ageS: Math.round((now - st.t) / 1000)});
    for (const c of buildLib.stockList()) out.push({kind: 'projekt', ...c, ageS: Math.round((now - c.t) / 1000)});
    return json(200, out);
  }
  if (req.method === 'GET' && url.pathname === '/api/materials') {
    // The first bot of this process that runs a schematic project and sees its site (workers' bots are not here).
    for (const r of runners.values()) {
      if (r instanceof RemoteRunner) continue;
      const m = await projectMaterials(r).catch(() => null);
      if (!m) continue;
      // What the crew carries is not missing either (workers' bots count too: their snapshots carry the inventory).
      for (const x of runners.values()) {
        const s = x.snapshot();
        if (!['schematic', 'produce'].includes(s.job?.type)) continue;
        for (const it of s.inventory || []) {
          const [, name, n] = /^(\S+) x(\d+)$/.exec(it) || [];
          if (m.lacking[name]) m.lacking[name] = Math.max(0, m.lacking[name] - Number(n));
          if (m.lacking[name] === 0) delete m.lacking[name];
        }
      }
      return json(200, {...m, bot: r.name});
    }
    return json(200, null);
  }
  if (req.method === 'GET' && url.pathname === '/api/needs') {
    const now = Date.now();
    return json(200, world.openNeeds(now).map((n) => ({...n, age: Math.max(0, Math.floor((now - n.t) / 1000))})));
  }
  if (req.method === 'GET' && url.pathname === '/api/experience') {
    const now = Date.now();
    return json(200, [...world.experience].map(([key, r]) => {
      const learned = world.learned(key, now);
      return {key, ok: r.ok, fail: r.fail, streak: r.streak, each: learned.each, pOk: learned.pOk, blockedS: learned.blocked ? Math.ceil((learned.until - now) / 1000) : 0, t: r.t};
    }).sort((a, b) => b.t - a.t).map(({t, ...r}) => r));
  }
  if (req.method === 'GET' && url.pathname === '/vendor/three.min.js') {
    res.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'});
    return res.end(three);
  }
  // The 3D map's presets (the plan's areas) and the bots an order may go to; no secrets.
  if (req.method === 'GET' && url.pathname === '/api/areas') {
    const zones = places.list.filter((p) => p.box);
    return json(200, {areas: Object.fromEntries(zones.map((p) => [p.name, p.box])), zones, agentBots: cfg.agentBots, roster: cfg.planRoster || [], protectedAreas: cfg.protectedAreas});
  }
  // Blocks of a box for the dashboard's 3D map, read from the bot nearest to its centre whose chunks are
  // loaded. Human path only (not an agent endpoint). Only bots of this process are readable: a worker's
  // bots (RemoteRunner) keep their chunks in the worker, and there is no RPC for them.
  if (req.method === 'GET' && url.pathname === '/api/voxels') {
    if (voxelBusy) return json(429, {error: 'another map read is running, try again in a moment'});
    voxelBusy = true;
    try {
      const surf = url.searchParams.get('mode') === 'surface';
      const box = surf ? voxels.parseSurface(Object.fromEntries(url.searchParams)) : voxels.parseBox(Object.fromEntries(url.searchParams));
      const cx = (box.x1 + box.x2) / 2, cz = (box.z1 + box.z2) / 2;
      const near = [...runners.values()].filter((x) => !(x instanceof RemoteRunner) && x.online && x.bot?.entity && /overworld/.test(x.bot.game?.dimension || ''))
        .sort((a, b) => Math.hypot(a.bot.entity.position.x - cx, a.bot.entity.position.z - cz) - Math.hypot(b.bot.entity.position.x - cx, b.bot.entity.position.z - cz))[0];
      if (!near) return json(409, {error: 'no bot of the hub is online in the overworld to read blocks from (worker bots cannot be read)'});
      const {Vec3} = require('vec3'), p = new Vec3(0, 0, 0);
      const at = (x, y, z) => near.bot.blockAt(p.set(x, y, z), false)?.name ?? null;
      const out = await (surf ? voxels.surfaceAsync(box, at) : voxels.collectAsync(box, at)); // yields every 20k reads so bot physics keeps ticking
      return json(200, {box, bot: near.name, ...out});
    } catch (e) {
      return json(400, {error: e.message});
    } finally {
      voxelBusy = false;
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/archive') {
    const names = ARCHIVE ? (await fs.promises.readdir(ARCHIVE).catch(() => [])).filter((n) => archive.ARCHIVE_NAME.test(n)).sort() : [];
    return json(200, await Promise.all(names.map(async (name) => ({name, bytes: (await fs.promises.stat(path.join(ARCHIVE, name))).size}))));
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/archive/')) {
    const name = url.pathname.slice('/api/archive/'.length);
    if (!ARCHIVE || !archive.ARCHIVE_NAME.test(name)) return json(404, {error: 'no such archive file'});
    const file = fs.createReadStream(path.join(ARCHIVE, name));
    file.on('error', () => res.headersSent ? res.destroy() : json(404, {error: 'no such archive file'}));
    file.on('open', () => { res.writeHead(200, {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP}); file.pipe(res); });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/events') return json(200, {lastId: events.lastId, events: events.since(Number(url.searchParams.get('since')) || 0)});
  if (req.method === 'GET' && url.pathname === '/api/decisions') return json(200, {lastId: decisions.lastId, events: decisions.since(Number(url.searchParams.get('since')) || 0)});
  if (req.method === 'GET' && url.pathname === '/api/slayer') return json(200, slayer.view());
  if (req.method === 'POST' && url.pathname === '/api/decision') {
    if (!agent) return json(403, {error: 'forbidden'}); // only the agent service reports decisions
    try {
      const {bot, text, backend = 'lab'} = await readJson(req);
      if (!cfg.agentBots.includes(bot) || typeof text !== 'string') throw new Error('bot must be an agent bot, text a string');
      if (!agentauth.validBackend(backend)) throw new Error('backend must be a name of at most 128 characters');
      decisions.add(bot, 'info', text.replace(/\s+/g, ' ').trim()).backend = backend;
      return json(200, {ok: true});
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/agentstatus') {
    if (!agent) return json(403, {error: 'forbidden'});
    try {
      const st = agentauth.agentStatus(await readJson(req), {agentBots: cfg.agentBots});
      if (st.error) throw new Error(st.error);
      agentStatuses.set(st.agent, {...st, t: Date.now()});
      return json(200, {ok: true});
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/crews') return json(200, crews.data);
  // The problem solver's notes, escalations and plan skips (agentauth.solverAction). Agent token only.
  if (req.method === 'POST' && url.pathname === '/api/solver') {
    if (!agent) return json(403, {error: 'forbidden'});
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      // Only an optional objective may be skipped by the solver: one the plan itself would skip when blocked and
      // that nothing later needs. It skipped the shaft (the main project) over missing torches (2026-10-11).
      const blocked = plan ? [...new Set([...plan.blocked.keys(), ...plan.parked])].filter((id) => SOLVER_SKIPPABLE.has(id)) : [];
      const r = agentauth.solverAction(await readJson(req), {agentBots: cfg.agentBots, roster: cfg.planRoster || [], blocked, limiter: solverLimiter});
      if (r.error) return json(403, {error: r.error});
      if (r.skip) plan.skip(r.skip);
      events.add(r.bot, r.kind, r.text);
      broadcast();
      return json(200, {ok: true});
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/agents') return json(200, [...agentStatuses.values()]);
  if (req.method === 'GET' && url.pathname === '/api/world') return json(200, world.snapshot());
  const vm = req.method === 'GET' && /^\/api\/view\/(\w{1,16})\.png$/.exec(url.pathname);
  if (vm) {
    const r = runners.get(vm[1]);
    if (r instanceof RemoteRunner) {
      r.wantView(); // the worker answers within a second or two; meanwhile its last frame
      if (!r.viewFrame) return send(404, 'text/plain', 'no view yet (asked the worker)');
      res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      return res.end(r.viewFrame.body);
    }
    if (!r || !r.bot?.entity || !r.online) return send(404, 'text/plain', 'no view (offline)');
    // One frame per bot, shared by all viewers, at most every 1 s or 4x its render time
    // (counted from the end of the render), and never more than 150 ms of rendering.
    const now = Date.now();
    const f = r.viewFrame;
    if (!f || now - f.t > Math.max(1000, 4 * f.ms)) {
      const body = botView(r.bot, {w: 256, h: 144, deadline: now + 150});
      r.viewFrame = {t: Date.now(), ms: Date.now() - now, body};
    }
    res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    return res.end(r.viewFrame.body);
  }
  const sm = req.method === 'GET' && /^\/api\/scan\/(\w{1,16})$/.exec(url.pathname);
  if (sm) {
    if (agent && !cfg.agentBots.includes(sm[1]) && !(cfg.planRoster || []).includes(sm[1])) return json(403, {error: 'not an agent or roster bot'}); // the agent token reaches its own bots and the plan roster (the solver reads their surroundings)
    const r = runners.get(sm[1]);
    if (!r || !r.online) return json(404, {error: 'offline or unknown bot'});
    try {
      const scan = r instanceof RemoteRunner ? await r.askScan() : r.bot?.entity ? scanAround(r.bot) : null;
      return scan ? json(200, scan) : json(503, {error: 'no scan (the worker did not answer)'});
    } catch (e) {
      return json(500, {error: e.message});
    }
  }
  const tm = req.method === 'GET' && cfg.bluemapUrl && TILE_RE.exec(url.pathname);
  if (tm) {
    const body = await tile(`${tm[1]}/tiles/${tm[2]}/x${tm[3]}/z${tm[4]}.png`);
    if (!body) return send(404, 'text/plain', 'no tile');
    res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'max-age=300', 'X-Content-Type-Options': 'nosniff'});
    return res.end(body);
  }
  if (req.method === 'GET' && url.pathname === '/api/debug') {
    const bots = [...runners.values()].map((r) => {
      try {
        return r.debug();
      } catch (e) {
        return {name: r.name, error: String(e.message || e)};
      }
    });
    // Reservation counters summed per worker host (remote bots only).
    const workers = {};
    for (const b of bots) {
      if (!b.remote || !b.claims) continue;
      const w = (workers[b.host] ||= {bots: [], granted: 0, refused: 0, timedOut: 0});
      w.bots.push(b.name);
      for (const k of ['granted', 'refused', 'timedOut']) w[k] += b.claims[k];
    }
    return json(200, {generatedAt: new Date().toISOString(), generatedAtMs: Date.now(), windowS: WINDOW_MS / 1000, bots, workers});
  }
  // Server admin: human path only (agentEndpoint never lists these, so a bearer is refused above).
  if (url.pathname.startsWith('/api/admin/')) {
    const post = req.method === 'POST';
    if (!admin) return json(503, {error: 'server admin is not configured (RCON_HOST, RCON_PASSWORD)'});
    if (post && (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json'))) return json(403, {error: 'bad origin'});
    try {
      if (req.method === 'GET' && url.pathname === '/api/admin/status') return json(200, await admin.status());
      if (req.method === 'GET' && url.pathname === '/api/admin/query') return json(200, await admin.query(url.searchParams.get('what')));
      if (req.method === 'GET' && url.pathname === '/api/admin/console') return json(200, admin.consoleSince(Number(url.searchParams.get('since')) || 0));
      if (post && url.pathname === '/api/admin/action') {
        const {action, ...rest} = await readJson(req);
        return json(200, await admin.act(action, rest));
      }
    } catch (e) {
      return json(400, {error: e.message});
    }
    return json(404, {error: 'not found'});
  }
  if (req.method === 'GET' && url.pathname === '/api/keeper') return json(200, keeper ? keeper.state() : {available: false});
  if (req.method === 'POST' && url.pathname === '/api/keeper') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      if (!keeper) throw new Error('standing orders are not configured (needs SUPPLY_CHEST and KEEPER_QUOTAS)');
      const {enabled} = await readJson(req);
      if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false');
      keeper.setEnabled(enabled);
      broadcast();
      return json(200, keeper.state());
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/plan') return json(200, plan ? plan.state() : {available: false});
  if (req.method === 'POST' && url.pathname === '/api/plan') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      if (!plan) throw new Error('the plan is not configured (needs PLAN_ENABLE and PLAN_ROSTER)');
      const {enabled, skip, retry} = await readJson(req);
      if (typeof enabled === 'boolean') plan.setEnabled(enabled);
      else if (typeof skip === 'string') plan.skip(skip);
      else if (typeof retry === 'string') plan.retry(retry);
      else throw new Error('send enabled (true/false), skip (an objective id) or retry (an objective id)');
      broadcast();
      return json(200, plan.state());
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  // Where is it: the storage index (chests the bots opened), by item name part.
  if (req.method === 'GET' && url.pathname === '/api/storage/find') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().replace(/ /g, '_');
    if (!/^[a-z_]{2,48}$/.test(q)) return json(400, {error: 'q: 2-48 letters, e.g. iron'});
    const zoneOf = (w) => places.list.find((p) => p.box && p.kind === 'storage' && w.x >= p.box.x1 && w.x <= p.box.x2 && w.y >= p.box.y1 && w.y <= p.box.y2 && w.z >= p.box.z1 && w.z <= p.box.z2)?.name || (Math.abs(w.x - planConfig.BASE.chest.x) <= 1 && w.y === planConfig.BASE.chest.y && Math.abs(w.z - planConfig.BASE.chest.z) <= 1 ? 'Base chest' : null);
    return json(200, world.findItems(q).slice(0, 20).map((e) => ({...e, where: e.where.slice(0, 10).map((w) => ({...w, zone: zoneOf(w)}))})));
  }
  if (req.method === 'POST' && url.pathname === '/api/places') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      const {action, place, name} = await readJson(req);
      if (action === 'set') { const p = places.set(place); events.add('map', 'info', `${p.box ? 'zone' : 'marker'} ${p.name} (${p.kind}) at ${p.x} ${p.y} ${p.z}`); }
      else if (action === 'delete') { places.remove(name); events.add('map', 'info', `marker ${name} removed`); }
      else throw new Error('action must be set or delete');
      applyPlaces();
      broadcast();
      return json(200, {places: places.list, supplyChest});
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      const {bot, settings: input} = await readJson(req);
      const r = runners.get(bot);
      if (!r) throw new Error('unknown bot');
      const now = settings.set(bot, input);
      // A remote bot's worker gets them now, or with its welcome when it comes back.
      const away = r instanceof RemoteRunner && !r.conn;
      if (r instanceof RemoteRunner) r.pushSettings(now);
      events.add(bot, 'info', `settings: ${Object.entries(input || {}).map(([k, v]) => `${k} ${v}`).join(', ')}${away ? ' (applies when its worker reconnects)' : ''}`);
      broadcast();
      return json(200, now);
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/crews') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      const input = await readJson(req);
      const data = crews.set(input, new Set([...agentStatuses.keys(), ...Object.keys(crews.data.crews)]));
      events.add('crews', 'info', `crews edited: ${Object.keys(input).join(', ')}`);
      return json(200, data);
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  // Pause/Stop end a bot's project (the running one, else the queued ones); Resume queues the last one again.
  if (req.method === 'POST' && url.pathname === '/api/project') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      const {bot, action} = await readJson(req);
      const r = runners.get(bot);
      const p = projects.get(bot);
      if (!r) throw new Error('unknown bot');
      if (action === 'resume') {
        if (!p) throw new Error('no project to resume');
        r.enqueue(p.type, p.args);
        projects.note(bot, p.type, p.args);
      } else if (action === 'pause' || action === 'stop') {
        const s = r.snapshot();
        if (PROJECTS.has(s.job?.type)) {
          r.enqueue('stop'); // clears the queue too
          delete toResume[bot];
        } else {
          s.queue.forEach((label, i) => PROJECTS.has(label.split(' ')[0]) && r.enqueue('remove', {id: s.queueIds[i]}));
          if (toResume[bot]) toResume[bot] = toResume[bot].filter((j) => !PROJECTS.has(j.type));
        }
        if (action === 'stop') projects.forget(bot);
        else projects.pause(bot);
        const saveErr = saveJobs(true);
        if (saveErr) throw new Error(`stopped, but the stopped state could not be saved (${saveErr})`);
      } else throw new Error('action must be pause, resume or stop');
      broadcast();
      return json(200, {ok: true});
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/job') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      const {bots, type, args, replace, solver} = await readJson(req);
      const refused = agent && agentauth.agentJobRefusal({bots, type, args, replace, solver}, {agentBots: cfg.agentBots, supplyChest, roster: cfg.planRoster || [], places: places.list, jobOf: (n) => runners.get(n)?.snapshot().job, restingOf: (n) => agentauth.resting(events.since(0), n) || busyOf(runners.get(n)?.snapshot()), ownerOrderOf: (n) => ownerOrders.get(n)?.type, limiter: solverLimiter});
      if (refused) return json(403, {error: refused});
      // "all" skips remote bots whose worker is away, so a Stop reaches every
      // bot that can still hear it; naming an offline bot is an error.
      const all = bots === 'all';
      const targets = all ? [...runners.values()].filter((r) => !(r instanceof RemoteRunner) || r.conn) : (Array.isArray(bots) ? bots : []).map((n) => runners.get(n));
      if (!targets.length || targets.includes(undefined)) throw new Error('unknown bot');
      const errors = [];
      const stopping = type === 'stop' || replace === true;
      // A field that is one of the dashboard's wheat zones means all of them, tended in turn (wheatfarm.js).
      const wheatZones = places.list.filter((p) => p.kind === 'wheat' && p.box && p.dim === 'overworld').map(({box: b}) => ({x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2}));
      const jobArgs = type === 'wheatfarm' ? require('./wheatfarm').withFields(args || {}, wheatZones) : args || {};
      for (const r of targets) {
        try {
          const pos = r.snapshot().pos;
          const perBotArgs = type === 'graves' ? {spots: gravesLib.openGraves(events.since(0), r.name, {archiveDir: ARCHIVE, chest: cfg.supplyChest, areas: cfg.protectedAreas, from: pos && {x: pos[0], y: pos[1], z: pos[2]}})} : jobArgs;
          if (type === 'graves' && !perBotArgs.spots.length) { events.add(r.name, 'info', 'graves: none open in the last 24 h'); continue; }
          // Graves go ahead of the running job, which goes on afterwards; the owner's standing order stays.
          r.enqueue(type, perBotArgs, {replace: replace === true, ...(type === 'graves' ? {first: true} : {})});
          if (!agent && type !== 'graves') type === 'stop' ? ownerOrders.delete(r.name) : ownerOrders.set(r.name, {type, args: perBotArgs});
          if (stopping) {
            delete toResume[r.name]; // its saved jobs must not come back after a restart or reconnect
            projects.pause(r.name);
          }
          if (PROJECTS.has(type)) projects.note(r.name, type, VALIDATE[type](args || {}));
        } catch (e) {
          errors.push(`${r.name}: ${e.message}`); // one bot failing must not keep the others from getting the job
        }
      }
      if (!agent) saveOrders();
      // Stop all is authoritative here, not in the browser: standing orders off first
      // (they would hand idle bots new work), then every pending recovery dropped.
      let keeperOff = false;
      if (all && type === 'stop') {
        toResume = {};
        if (keeper?.enabled) {
          keeper.setEnabled(false);
          keeperOff = true;
        }
        if (plan?.enabled) plan.setEnabled(false); // it would hand the idle bots new work; this also returns the keeper
        board?.pauseAll(); // the board too: no part goes out again until the owner resumes the job
      }
      broadcast();
      if (errors.length) throw new Error(errors.join('; '));
      // Persist the stopped state before saying so; the bots are stopped either way.
      const saveErr = stopping ? saveJobs(true) : null;
      const unreached = all ? [...runners.values()].filter((r) => r instanceof RemoteRunner && !r.conn).map((r) => r.name) : [];
      if (saveErr) return json(500, {error: `stopped, but the stopped state could not be saved (${saveErr}): saved jobs may come back after a restart`, unreached});
      return json(200, {ok: true, keeperOff, unreached});
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  if (board && req.method === 'GET' && url.pathname === '/api/board') return json(200, board.state());
  if (board && req.method === 'POST' && url.pathname.startsWith('/api/board/jobs')) {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    try {
      const body = await readJson(req);
      const id = url.pathname.slice('/api/board/jobs/'.length);
      if (url.pathname === '/api/board/jobs') {
        const job = board.create({kind: body.kind, box: body.box, by: 'owner'});
        events.add('board', 'info', `job ${job.id}: ${job.kind} ${job.box.x1} ${job.box.y1} ${job.box.z1} .. ${job.box.x2} ${job.box.y2} ${job.box.z2} in ${job.parts.length} parts`);
        broadcast();
        return json(200, job);
      }
      if (!['pause', 'resume', 'cancel'].includes(body.action)) throw new Error('action must be pause, resume or cancel');
      const out = board[body.action](id);
      for (const b of Array.isArray(out) ? out : []) runners.get(b)?.enqueue('stop', {});
      events.add('board', 'info', `job ${id}: ${body.action}`);
      broadcast();
      return json(200, board.job(id));
    } catch (e) {
      return json(400, {error: e.message});
    }
  }
  // A sandbox scenario (scenario.js) runs inside the hub: the dashboard's owner starts it, results go to the event log.
  if (board && req.method === 'POST' && url.pathname === '/api/scenarios') {
    if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return json(403, {error: 'bad origin'});
    if (!cfg.sandboxRcon) return json(400, {error: 'no sandbox console (SANDBOX_RCON_HOST unset)'});
    // The console resets the sandbox, but the board's bots dig wherever they play: never with them on the real server.
    if (!process.env.MC_VHOST) return json(400, {error: 'the bots play on the real server (no MC_VHOST): a scenario would dig there'});
    if (scenarioRunning) return json(409, {error: 'a scenario is already running'});
    const {name, runs = 1} = await readJson(req).catch(() => ({}));
    scenarioRunning = true;
    scenarioRun.main([String(name), '--runs', String(Math.min(5, Number(runs) || 1))], process.env, {call: queued(cfg.sandboxRcon), http: boardHttp, out: (line) => events.add('scenario', 'info', line)})
      .catch((e) => events.add('scenario', 'error', e.message))
      .finally(() => { scenarioRunning = false; });
    return json(202, {started: name});
  }
  return json(404, {error: 'not found'});
});

const wss = new WebSocketServer({noServer: true});
server.on('upgrade', (req, socket, head) => {
  if (!authorized(req) || !sameOrigin(req) || req.url !== '/ws') {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => ws.send(JSON.stringify(state())));
});
function broadcast() {
  if (!wss.clients.size) return;
  const msg = JSON.stringify(state());
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
const tick = setInterval(() => {
  broadcast();
  hub?.broadcastWorld();
}, 1000);
// The board, in-process for the scenarios: same answers as the HTTP routes, without the owner check they need.
async function boardHttp(method, p, body) {
  if (p === '/api/state') return {status: 200, body: state()};
  if (method === 'GET') return {status: 200, body: board.state()};
  try {
    return {status: 200, body: board.create({kind: body.kind, box: body.box, by: 'scenario'})};
  } catch (e) {
    return {status: 400, body: {error: e.message}};
  }
}
function boardTick() {
  const snaps = new Map([...runners.values()].map((r) => [r.name, r.snapshot()]));
  for (const e of board.observe(snaps)) events.add('board', e.what === 'failed' ? 'error' : 'info', `${e.part || e.job} ${e.what}${e.bot ? ` (${e.bot})` : ''}${e.error ? `: ${e.error}` : ''}`);
  const pos = (n) => { const p = snaps.get(n)?.pos; return p ? {x: p[0], z: p[2]} : null; };
  for (const {bot, part} of board.assign(cfg.boardBots.filter((n) => runners.has(n) && idle(snaps.get(n))), pos, (n) => snaps.get(n))) {
    try {
      runners.get(bot).enqueue('part', {part: part.id, ...part.box});
    } catch (e) {
      events.add('board', 'error', `${part.id} could not go to ${bot}: ${e.message}`); // it reopens after START_MS
    }
  }
}
const keeperTick = setInterval(() => {
  try {
    if (board) boardTick(); // before the plan and the keeper, though they never take board bots
  } catch (e) {
    log('board', `error: ${e.message}`);
  }
  try {
    plan?.tick(); // before the keeper: a borrowed keeper starts with the plan's quotas
  } catch (e) {
    log('plan', `error: ${e.message}`);
  }
  try {
    keeper?.tick();
  } catch (e) {
    log('keeper', `error: ${e.message}`);
  }
}, 5000);
// MC_VHOST (the bots play in the sandbox): keep the real server, which the Server panel's RCON reaches, bot-free.
const evictTick = admin && process.env.MC_VHOST ? setInterval(() => {
  admin.evictBots().then((names) => names.length && events.add('admin', 'info', `moved ${names.join(', ')} off the real server to the sandbox`), () => {});
}, 30000) : null;

// Alerts for the lead agent (alerts.js), from what a local bot in the overworld sees.
const alerts = new Alerts({events});
const alertTick = setInterval(() => {
  try {
    alerts.checkChest(supplyStock());
    notifier.chest(supplyStock(), supplyStock() && chestWarnings(supplyStock().items, supplyStock().free));
    notifier.tick();
    const r = [...runners.values()].find((x) => !(x instanceof RemoteRunner) && x.online && x.bot?.entity && /overworld/.test(x.bot.game?.dimension || ''));
    if (!r || !supplyChest) return;
    const {Vec3} = require('vec3');
    alerts.check({
      chestBlock: r.bot.blockAt(new Vec3(supplyChest.x, supplyChest.y, supplyChest.z))?.name ?? null,
      timeOfDay: r.bot.time?.timeOfDay,
      hostiles: world.hostilesNear(supplyChest.x, supplyChest.z, 'overworld', 16),
    }, supplyChest);
  } catch (e) {
    log('alerts', `error: ${e.message}`);
  }
}, 5000);

slayer.start();
server.listen(cfg.port, cfg.host, () => {
  log('dashboard', `listening on ${cfg.host}:${cfg.port} (${cfg.allowed.length ? `tailscale logins: ${cfg.allowed.join(',')}` : 'local only'})`);
  for (const r of runners.values()) r.start();
});
workerServer?.listen(cfg.workerPort, cfg.workerHost, () => log('hub', `workers: ws on ${cfg.workerHost}:${cfg.workerPort}/worker (bearer token required)`));

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(jobsTimer); // first: stopping the bots cancels their jobs, which must not be saved
  clearInterval(tick);
  clearInterval(keeperTick);
  clearInterval(alertTick);
  clearInterval(evictTick);
  slayer.stop();
  clearInterval(blocklogTimer);
  blocklog.flush();
  stopBlueMap();
  hub?.close();
  for (const r of runners.values()) r.shutdown();
  for (const c of wss.clients) c.close();
  server.close();
  workerServer?.close();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
