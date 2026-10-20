#!/usr/bin/env node
'use strict';
// Sandbox scenario runner for the mcbots bot (bot50 on the local dashboard, SANDBOX server only).
// Usage: node run.js [name-filter]    env: DASHBOARD (default http://127.0.0.1:8099), BOT (bot50), TRACE=1 (position per second)
// 2026-10-20: walking/digging fixes had no repeatable check; this builds each case in a sky lab and scores the bot.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {BOX, SCENARIOS, CLEAR, PLATFORM, BOT: BOT_SETUP} = require('./scenarios');

const DASH = process.env.DASHBOARD || 'http://127.0.0.1:8099';
const BOT = process.env.BOT || 'bot50';
const RESULTS = path.join(os.homedir(), '.cache/bandit-bot-test/scenario-results.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = '(-?\\d+(?:\\.\\d+)?)';
const inBox = (x, y, z) => x >= BOX.x1 && x <= BOX.x2 && z >= BOX.z1 && z <= BOX.z2 && y >= BOX.y1 && y <= BOX.y2;
const blk = 'minecraft:[a-z_]+(?:\\[[a-z_]+=[a-z0-9_]+\\])?'; // optional one block state, e.g. wheat[age=7]

// Every rcon command must be one of these shapes with all coordinates inside the box (throws otherwise).
function checkCommand(cmd) {
  let m;
  if ((m = new RegExp(`^execute if block ${num} ${num} ${num} ${blk}$`).exec(cmd))) return checkPoint(cmd, m[1], m[2], m[3]); // a count probe: prints "Test passed"/"Test failed"
  if ((m = new RegExp(`^item replace block ${num} ${num} ${num} container\\.\\d{1,2} with minecraft:[a-z_]+ \\d{1,2}$`).exec(cmd))) return checkPoint(cmd, m[1], m[2], m[3]); // fill a chest
  let c = cmd.replace(new RegExp(`^execute if block ${num} ${num} ${num} ${blk} run `), (m, x, y, z) => { checkPoint(cmd, x, y, z); return ''; });
  if ((m = new RegExp(`^fill ${num} ${num} ${num} ${num} ${num} ${num} ${blk}$`).exec(c))) { checkPoint(cmd, m[1], m[2], m[3]); return checkPoint(cmd, m[4], m[5], m[6]); }
  if ((m = new RegExp(`^setblock ${num} ${num} ${num} ${blk}$`).exec(c))) return checkPoint(cmd, m[1], m[2], m[3]);
  if ((m = new RegExp(`^tp bot50 ${num} ${num} ${num}$`).exec(c))) return checkPoint(cmd, m[1], m[2], m[3]);
  if ((m = new RegExp(`^forceload add ${num} ${num}$`).exec(c)) || (m = new RegExp(`^forceload add ${num} ${num} ${num} ${num}$`).exec(c))) return checkPoint(cmd, m[1], BOX.y1, m[2]) && checkPoint(cmd, m[3] ?? m[1], BOX.y1, m[4] ?? m[2]);
  if ((m = new RegExp(`^kill @e\\[type=item,x=${num},y=${num},z=${num},dx=${num},dy=${num},dz=${num}\\]$`).exec(c))) return checkPoint(cmd, m[1], m[2], m[3]) && checkPoint(cmd, +m[1] + +m[4], +m[2] + +m[5], +m[3] + +m[6]);
  if ((m = new RegExp(`^data get block ${num} ${num} ${num} Items$`).exec(c))) return checkPoint(cmd, m[1], m[2], m[3]);
  if (/^(gamemode survival bot50|clear bot50|time set (?:noon|midnight)|effect clear bot50|effect give bot50 minecraft:[a-z_]+ \d+ \d+|give bot50 minecraft:[a-z_]+ \d+)$/.test(c)) return true;
  throw new Error(`rcon command not allowed: ${cmd}`);
}
function checkPoint(cmd, x, y, z) {
  if (!inBox(+x, +y, +z)) throw new Error(`rcon command outside the sky-lab box: ${cmd}`);
  return true;
}

function validateScenario(s) {
  if (!/^[a-z0-9-]+$/.test(s.name || '')) throw new Error('scenario needs a name like 1-goto-open');
  if (!s.job || !s.job.type || typeof s.job.args !== 'object') throw new Error(`${s.name}: job needs type and args`);
  if (!(s.timeoutS > 0)) throw new Error(`${s.name}: timeoutS must be positive`);
  if (!Array.isArray(s.success) || !s.success.length) throw new Error(`${s.name}: success needs at least one condition`);
  for (const c of s.success) {
    if (!['near', 'notNear', 'inv', 'alive', 'finished', 'noError', 'error', 'chest', 'cells'].includes(c.kind)) throw new Error(`${s.name}: unknown condition ${c.kind}`);
    if (c.kind === 'chest') checkPoint(s.name, c.x, c.y, c.z);
    if (c.kind === 'cells') cellCommands(c).forEach(checkCommand);
  }
  for (const z of s.zones || []) { if (z.box) { checkPoint(s.name, z.box.x1, z.box.y1, z.box.z1); checkPoint(s.name, z.box.x2, z.box.y2, z.box.z2); } else checkPoint(s.name, z.x, z.y, z.z); if (!/^scn-[a-z0-9-]+$/.test(z.name)) throw new Error(`${s.name}: zone names start with scn-`); }
  for (const cmd of [...(s.setup || []), ...(s.teardown || [])]) checkCommand(cmd);
  return s;
}

const invCount = (inventory, item) => (inventory || []).reduce((n, l) => { const m = /^(\S+) x(\d+)$/.exec(l); return n + (m && m[1] === item ? +m[2] : 0); }, 0);
const dist = (p, c) => Math.hypot(p[0] - c.x, p[2] - c.z) + Math.abs(p[1] - c.y) * 0.5; // y counts half: a block-coordinate position is not exact
// ctx: {bot: bot entry of /api/state, timedOut, elapsedS, chests: {"x,y,z,item": count}}
function evalCondition(c, ctx) {
  const b = ctx.bot;
  const errNow = !!b.lastError && b.lastErrorAgoS != null && b.lastErrorAgoS <= ctx.elapsedS + 1; // an error older than this run (the 3 s settle and rcon came first) is not ours
  switch (c.kind) {
    case 'near': return dist(b.pos, c) <= c.r;
    case 'notNear': return dist(b.pos, c) > c.r;
    case 'inv': return invCount(b.inventory, c.item) >= c.min;
    case 'alive': return b.health > 0 && !b.dead;
    case 'finished': return !ctx.timedOut && !b.job;
    case 'noError': return !errNow;
    case 'error': return errNow && new RegExp(c.re, 'i').test(b.lastError);
    case 'cells': return (ctx.cells?.[cellKey(c)] ?? 0) >= (c.min ?? 0) && (ctx.cells?.[cellKey(c)] ?? 0) <= (c.max ?? Infinity);
    case 'chest': return (ctx.chests?.[`${c.x},${c.y},${c.z},${c.item}`] ?? 0) >= c.min;
  }
  return false;
}
// 'cells': how many cells of the box x1..z2 hold one of the block specs (a cell holds one block, so passes add up).
const cellKey = (c) => JSON.stringify([c.x1, c.y1, c.z1, c.x2, c.y2, c.z2, c.specs]);
function cellCommands(c) {
  const out = [];
  for (let x = c.x1; x <= c.x2; x++) for (let y = c.y1; y <= c.y2; y++) for (let z = c.z1; z <= c.z2; z++) for (const b of c.specs) out.push(`execute if block ${x} ${y} ${z} ${b}`);
  if (out.length > 2500) throw new Error('cells: at most 2500 probes');
  return out;
}
const countPassed = (out) => (out.match(/Test passed/g) || []).length;
const evalSuccess = (s, ctx) => s.success.filter((c) => !evalCondition(c, ctx)).map((c) => JSON.stringify(c)); // the failed conditions

const METRICS = {could_not_reach: /could not reach/i, no_path: /no path/i, no_progress_30s: /no progress for 30 s/i, skipped_a: /skipped a/i, no_free: /no free/i};
function countMetrics(events, sawZeroHealth = false) {
  const m = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]));
  let deaths = 0;
  for (const e of events) {
    for (const [k, re] of Object.entries(METRICS)) if (re.test(e.text || '')) m[k]++;
    if (e.kind === 'death') deaths++;
  }
  m.deaths = Math.max(deaths, sawZeroHealth ? 1 : 0);
  return m;
}
// Longest time (s) the same key (position + job progress) stayed unchanged; samples = [[tSeconds, key], ...].
function maxGap(samples) {
  let gap = 0, since = samples.length ? samples[0][0] : 0, key = samples.length ? samples[0][1] : null;
  for (const [t, k] of samples) { if (k !== key) { key = k; since = t; } gap = Math.max(gap, t - since); }
  return gap;
}
// Items of a chest from `data get block ... Items` output, summed for one item.
// Largest yaw change per tick (deg) outside combat in the bot's look windows since t0 (file written by bots.js when LOOK_STATS_FILE is set).
function lookMax(wins, t0) { return (wins || []).filter((w) => w.t >= t0).reduce((m, w) => Math.max(m, w.out || 0), 0); }
const LOOK_FILE = process.env.LOOK_STATS_FILE || path.join(os.homedir(), '.cache/bandit-bot-test/look-stats.json');
const readLook = () => { try { return JSON.parse(fs.readFileSync(LOOK_FILE, 'utf8')); } catch { return []; } };
function chestItemCount(out, item) {
  let n = 0;
  for (const e of out.match(/\{[^{}]*\}/g) || []) if (new RegExp(`id: ?"minecraft:${item}"`).test(e)) n += Number(/(?:count|Count): ?(\d+)/.exec(e)?.[1] || 0);
  return n;
}

function rcon(cmds) {
  cmds.forEach(checkCommand);
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', 'bandit-lab', 'docker exec -i minecraft-sandbox rcon-cli'], {input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000});
  if (r.status !== 0) throw new Error(`rcon failed: ${r.stderr || r.error}`);
  return r.stdout.replace(/\x1b\[[0-9;]*m/g, '');
}
const api = async (p, body) => (await fetch(DASH + p, body ? {method: 'POST', headers: {'content-type': 'application/json', origin: DASH}, body: JSON.stringify(body)} : undefined)).json();
const botState = async () => (await api('/api/state')).bots.find((b) => b.name === BOT);
const chestKey = (c) => `${c.x},${c.y},${c.z},${c.item}`;

// Places in the bot's own state that a scenario needs (default kind storage: the index only knows chests in a storage zone; kind supply sets the y a wheat field is looked for at); set before, removed after.
const zonesCall = (s, action) => Promise.all((s.zones || []).map((z) => api('/api/places', action === 'set' ? {action, place: {kind: 'storage', ...z}} : {action, name: z.name})));
// Jobs that must finish before the scored one (e.g. a stock job so the bot has indexed a chest).
async function runPre(s, t0) {
  for (const j of s.pre || []) {
    const posted = await api('/api/job', {bots: [BOT], type: j.type, args: j.args, replace: true});
    if (posted.error || posted.ok === false) throw new Error(`pre job refused: ${JSON.stringify(posted).slice(0, 200)}`);
    let saw = false;
    for (let i = 0; ; i++) {
      await sleep(1000);
      const b = await botState();
      if (b.job) saw = true;
      if (!b.job && (saw || i >= 5)) break;
      if (i >= 240) { await api('/api/job', {bots: [BOT], type: 'stop'}); throw new Error(`pre job ${j.type} still running after 240 s`); }
    }
  }
}
async function runScenario(s) {
  rcon([...PLATFORM, ...CLEAR]); // clear the previous scenario before building (also when it was aborted)
  await zonesCall(s, 'set');
  rcon([...BOT_SETUP, ...(s.setup || [])]);
  await sleep(3000); // let the bot settle after the tp
  const startState = await botState();
  const since = (await api('/api/events')).lastId;
  const t0 = Date.now();
  await runPre(s, t0);
  const posted = await api('/api/job', {bots: [BOT], type: s.job.type, args: s.job.args, replace: true});
  let timedOut = false, sawJob = false, sawZero = false, stopped = false, bot = startState, mined = 0;
  const samples = [];
  if (posted.error || posted.ok === false) return {s, reason: `job refused: ${JSON.stringify(posted).slice(0, 200)}`, bot, events: [], sawZero, elapsedS: 0, chests: {}, timedOut};
  for (;;) {
    await sleep(1000);
    bot = await botState();
    const el = (Date.now() - t0) / 1000;
    if (process.env.TRACE) console.log(`  t=${el.toFixed(0)} pos=${bot.pos} ${bot.activity}`);
    if (bot.job) { sawJob = true; mined = Math.max(mined, bot.job.done || 0); samples.push([el, `${bot.pos}|${bot.job.progress}`]); }
    if (bot.health <= 0 || bot.dead) sawZero = true;
    if (s.stopAfterS && el >= s.stopAfterS && !stopped) { stopped = true; await api('/api/job', {bots: [BOT], type: 'stop'}); }
    if (!bot.job && (sawJob || el >= 5) && (!s.stopAfterS || stopped)) break;
    if (el >= s.timeoutS) { timedOut = true; await api('/api/job', {bots: [BOT], type: 'stop'}); break; }
  }
  await sleep(1000);
  bot = await botState();
  const elapsedS = Math.round((Date.now() - t0) / 1000);
  const chests = {};
  for (const c of s.success.filter((x) => x.kind === 'chest')) {
    const out = rcon([`data get block ${c.x} ${c.y} ${c.z} Items`]);
    chests[chestKey(c)] = chestItemCount(out, c.item);
  }
  const cells = {};
  for (const c of s.success.filter((x) => x.kind === 'cells')) cells[cellKey(c)] = countPassed(rcon(cellCommands(c)));
  const events = (await api(`/api/events?since=${since}`)).events.filter((e) => e.bot === BOT);
  if (!process.env.KEEP) rcon(CLEAR.concat(s.teardown || [])); // KEEP=1 leaves the lab standing for a look
  return {s, bot, events, sawZero, elapsedS, chests, cells, timedOut, mined, maxGapS: Math.round(maxGap(samples)), lookMaxDeg: Math.round(lookMax(readLook(), t0)), placed: events.filter((e) => /^placed /.test(e.text || '')).length};
}

// Soak totals: failed walks (could not reach + no path) per mined block, stuck events (no progress 30 s) and deaths per hour.
function soakSummary(rows, hours) {
  const sum = (k) => rows.reduce((n, r) => n + (r.metrics?.[k] || 0), 0);
  const mined = sum('mined'), walks = sum('could_not_reach') + sum('no_path');
  return {runs: rows.length, pass: rows.filter((r) => r.pass).length, hours: +hours.toFixed(2), mined, failed_walks: walks, failed_walks_per_block: mined ? +(walks / mined).toFixed(3) : null,
    stuck: sum('no_progress_30s'), stuck_per_hour: hours ? +(sum('no_progress_30s') / hours).toFixed(2) : null, deaths: sum('deaths'), deaths_per_hour: hours ? +(sum('deaths') / hours).toFixed(2) : null};
}

async function main() {
  const filter = process.argv[2];
  const list = SCENARIOS.filter((s) => !filter || s.name.includes(filter)).map(validateScenario);
  fs.mkdirSync(path.dirname(RESULTS), {recursive: true});
  const rows = [];
  const soakS = Number(process.env.SOAK_MIN || 0) * 60, t0 = Date.now(); // SOAK_MIN=120 repeats the list for 2 h; NIGHT=1 runs it at midnight
  if (process.env.NIGHT) BOT_SETUP.splice(BOT_SETUP.indexOf('time set noon'), 1, 'time set midnight');
  do for (const s of list) {
    if (soakS && Date.now() - t0 >= soakS * 1000) break;
    let row;
    try {
      let r;
      try { r = await runScenario(s); } finally { await zonesCall(s, 'delete').catch(() => {}); }
      const failed = r.reason ? [r.reason] : evalSuccess(s, {bot: r.bot, timedOut: r.timedOut, elapsedS: r.elapsedS, chests: r.chests, cells: r.cells});
      row = {t: new Date().toISOString(), name: s.name, pass: !failed.length, seconds: r.elapsedS, metrics: {...countMetrics(r.events, r.sawZero), mined: r.mined, placed: r.placed, max_gap_s: r.maxGapS, look_max_deg: r.lookMaxDeg}, failed, timedOut: r.timedOut, pos: r.bot?.pos, lastError: r.bot?.lastError, chests: r.chests, cells: r.cells};
    } catch (e) {
      row = {t: new Date().toISOString(), name: s.name, pass: false, seconds: 0, metrics: countMetrics([]), failed: [`runner error: ${e.message}`]};
    }
    fs.appendFileSync(RESULTS, JSON.stringify(row) + '\n');
    rows.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.seconds}s ${JSON.stringify(row.metrics)}${row.pass ? '' : ` -> ${row.failed.join('; ')} err=${row.lastError || "-"} counts=${Object.values(row.cells || {}).join(",")}`}`);
  } while (soakS && Date.now() - t0 < soakS * 1000);
  if (soakS) {
    const summary = {t: new Date().toISOString(), name: `soak${process.env.NIGHT ? '-night' : ''}`, filter: filter || 'all', ...soakSummary(rows, (Date.now() - t0) / 3600000)};
    fs.appendFileSync(RESULTS, JSON.stringify(summary) + '\n');
    console.log(JSON.stringify(summary));
  }
  console.log('\nname\t\t\tresult\tsec\tmetrics');
  for (const r of rows) console.log(`${r.name.padEnd(20)}\t${r.pass ? 'PASS' : 'FAIL'}\t${r.seconds}\t${Object.entries(r.metrics).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  process.exit(rows.some((r) => !r.pass) ? 1 : 0);
}

module.exports = {lookMax, soakSummary, maxGap, checkCommand, validateScenario, evalCondition, evalSuccess, cellCommands, countPassed, countMetrics, invCount, chestItemCount};
if (require.main === module) main();
