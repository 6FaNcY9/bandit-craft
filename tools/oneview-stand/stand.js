#!/usr/bin/env node
'use strict';
// Local stand for the 3D page: the real hub (app/server.js) against a fake Paper plugin, two fake worker bots and
// one schematic plan. Everything is on 127.0.0.1; the temp state dir is removed on exit.
//   NODE_PATH=$(ls -dt /nix/store/*-mcbots-0.1.0/lib/node_modules/mcbots/node_modules | head -1) \
//     node tools/oneview-stand/stand.js [--port 8195] [--live]
// --live adds one block of a pillar at -260,64+n,-12 every 5 s (a world that changes under the viewer).
// Prints http://127.0.0.1:<port>/ and runs until Ctrl-C. Check it with check.js.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const APP = path.join(__dirname, '../../hosts/bandit-lab/services/mcbots/app');
const {encodeBatch, encodeSection, sectionHash, cellIndex} = require(`${APP}/worldsection`);
const {writeLitematic} = require(`${APP}/litematic-write`);

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8195);
const live = argv.includes('--live');
const WORKER_TOKEN = 'c0ffee11'.repeat(5), PLUGIN_TOKEN = 'stand-token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oneview-stand-'));
const stateDir = path.join(dir, 'state'), schematicDir = path.join(stateDir, 'schematics');
let child = null, closing = false;
const cleanup = () => { child?.kill('SIGKILL'); fs.rmSync(dir, {recursive: true, force: true}); };
process.on('exit', cleanup); // a crash in here must not leave the temp dir behind
async function shutdown(code) {
  if (closing) return;
  closing = true;
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.on('exit', r)), sleep(3000)]); }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ---- the fake world: area -270,-20,40 = chunks cx -20..-15, cz -4..1 ----
const groundY = (x, z) => 63 + Math.round(4 * Math.sin(x / 9) * Math.cos(z / 7));
const extra = new Map(); // "x,y,z" -> state: the plan's floor, one wrong block, the live pillar, the loose-dirt blocks
// the cave under bot9: a 5 x 4 x 5 room at y 40-43, a 1-wide tunnel east of it and a shaft from the tunnel up to the open air
const inCave = (x, y, z, h) => (x >= -264 && x <= -260 && z >= -24 && z <= -20 && y >= 40 && y <= 43)
  || (z === -22 && y >= 40 && y <= 41 && x > -260 && x <= -254) || (x === -254 && z === -22 && y >= 40 && y <= h);
function stateAt(x, y, z) {
  const k = extra.get(`${x},${y},${z}`);
  if (k) return k;
  const h = groundY(x, z);
  if (inCave(x, y, z, h)) return x === -263 && z === -23 && y <= 42 ? 'minecraft:water' : 'minecraft:air'; // a water column in the room
  if (y > h) return y <= 62 ? 'minecraft:water' : 'minecraft:air';
  return y === h ? 'minecraft:grass_block' : y <= 59 ? 'minecraft:stone' : 'minecraft:dirt';
}
function section(cx, sy, cz) {
  const palette = [], idx = new Uint16Array(4096);
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const s = stateAt(cx * 16 + x, sy * 16 + y, cz * 16 + z);
    let i = palette.indexOf(s);
    if (i < 0) i = palette.push(s) - 1;
    idx[cellIndex(x, y, z)] = i;
  }
  const blob = encodeSection(palette, palette.length === 1 ? null : idx);
  return {kind: 0, cx, sy, cz, hash: sectionHash(blob), blob};
}
function everything() {
  const records = [];
  for (let cx = -20; cx <= -15; cx++) for (let cz = -4; cz <= 1; cz++) {
    if (cx === -15 && cz === 1) continue; // unknown: the plugin says nothing about it
    if (cx === -20 && cz === -4) records.push({kind: 1, cx, sy: 0, cz}); // ungenerated
    else for (let sy = -4; sy <= 19; sy++) records.push(section(cx, sy, cz));
  }
  return records;
}

// ---- the plan: a hollow 6 x 5 x 6 box at -268,68,-24 ----
const ORIGIN = {x: -268, y: 68, z: -24};
const plan = [];
for (let y = 0; y < 5; y++) for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) {
  if (x && x < 5 && y && y < 4 && z && z < 5) continue;
  const glass = (x === 0 && y === 2 && z === 2) || (x === 5 && y === 2 && z === 3) || (z === 0 && y === 2 && x === 2) || (z === 5 && y === 2 && x === 3);
  plan.push({x, y, z, name: glass ? 'glass' : 'stone_bricks'});
  if (y === 0) extra.set(`${ORIGIN.x + x},${ORIGIN.y},${ORIGIN.z + z}`, 'minecraft:stone_bricks'); // the bottom layer is built
}
plan.push({x: 2, y: 1, z: 2, name: 'oak_stairs', props: {facing: 'east'}});
extra.set(`${ORIGIN.x},${ORIGIN.y + 3},${ORIGIN.z}`, 'minecraft:dirt'); // wrong: a wall block belongs here (also loose dirt: nothing around it)

// loose dirt on flat ground (y 63): a free-standing pillar of 3 (all loose) and one dirt block with two drawn side neighbours (not loose)
for (let y = 64; y <= 66; y++) extra.set(`-256,${y},-11`, 'minecraft:dirt');
extra.set('-252,64,-11', 'minecraft:dirt');
extra.set('-251,64,-11', 'minecraft:cobblestone');
extra.set('-252,64,-10', 'minecraft:cobblestone');

// ---- the fake plugin ----
let batch = 0, waiter = null;
const queue = [];
const reply = (res, records) => res.end(encodeBatch({boot: 1n, batch: ++batch, records}));
function push(record) {
  if (!waiter) return queue.push(record);
  clearTimeout(waiter.timer);
  reply(waiter.res, [record]);
}
const plugin = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.headers.authorization !== `Bearer ${PLUGIN_TOKEN}`) { res.writeHead(401); return res.end(); }
  req.resume();
  if (u.pathname === '/world/pull') {
    res.setHeader('content-type', 'application/octet-stream');
    if (u.searchParams.get('ack') === '0') return reply(res, everything());
    if (queue.length) return reply(res, queue.splice(0));
    const w = waiter = {res, timer: setTimeout(() => { waiter = null; reply(res, []); }, 25000)};
    return res.on('close', () => { clearTimeout(w.timer); if (waiter === w) waiter = null; });
  }
  if (u.pathname === '/world/stats') { res.setHeader('content-type', 'application/json'); return res.end('{"importLeft":0}'); }
  res.writeHead(u.pathname === '/world/dirty' ? 200 : 404);
  res.end();
});

(async () => {
  fs.mkdirSync(schematicDir, {recursive: true});
  fs.writeFileSync(path.join(schematicDir, 'haus.litematic'), writeLitematic({name: 'haus', regions: [{name: 'main', position: {x: 0, y: 0, z: 0}, size: {x: 6, y: 5, z: 6}, blocks: plan}]}));
  fs.writeFileSync(path.join(stateDir, 'projects.json'), JSON.stringify({bot1: {type: 'schematic', args: {file: 'haus.litematic', origin: ORIGIN, rotation: 0, mirror: 'none', chests: []}, t: 1, paused: true}}));
  await new Promise((r) => plugin.listen(0, '127.0.0.1', r));
  const workerPort = await freePort();
  child = spawn(process.execPath, [path.join(APP, 'server.js')], {
    // RCON_PORT and MC_PORT 1: nothing here may reach a real server
    env: {PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '', BOT_NAMES: 'bot1,bot2', WORKER_PORT: String(workerPort), WORKER_TOKEN, DASHBOARD_PORT: String(port), DASHBOARD_HOST: '127.0.0.1',
      MC_HOST: '127.0.0.1', MC_PORT: '1', BOT_PASSWORD_SEED: 'test', STATE_DIR: stateDir, SCHEMATIC_DIR: schematicDir, WORLD_AREA: '-270,-20,40',
      BOTUI_URL: `http://127.0.0.1:${plugin.address().port}`, RCON_HOST: '127.0.0.1', RCON_PORT: '1', RCON_PASSWORD: PLUGIN_TOKEN},
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.on('exit', (c) => { if (!closing) { console.error(`stand: hub exited (${c})`); shutdown(1); } });
  await new Promise((res) => child.stdout.on('data', (b) => { if (String(b).includes('listening')) res(); }));
  child.stdout.pipe(process.stderr); // the hub log stays visible, stdout keeps only the URL

  // two fake worker bots: bot8 walks a circle, bot9 stands in the cave
  const ws = new WebSocket(`ws://127.0.0.1:${workerPort}/worker`, {headers: {Authorization: `Bearer ${WORKER_TOKEN}`}});
  ws.on('error', () => {});
  ws.on('open', () => {
    ws.send(JSON.stringify({t: 'hello', v: 1, host: 'stand', wid: 'a1'.repeat(16), bots: ['bot8', 'bot9']}));
    const tick = () => { const a = Date.now() / 1000 * 0.6; ws.send(JSON.stringify({t: 'status', bots: [
      {name: 'bot8', online: true, health: 20, food: 20, dimension: 'overworld', pos: [-266 + 6 * Math.cos(a), 68, -10 + 6 * Math.sin(a)]},
      {name: 'bot9', online: true, health: 20, food: 20, dimension: 'overworld', pos: [-262, 40, -22]}, // in the cave
    ]})); };
    tick();
    const t = setInterval(tick, 1000);
    ws.on('close', () => clearInterval(t));
  });
  if (live) { // shortcut: the pillar stops at 40 blocks, restart the stand for another run
    let n = 0;
    setInterval(() => { if (n >= 40) return; const y = 64 + n++; extra.set(`-260,${y},-12`, 'minecraft:cobblestone'); push(section(-17, Math.floor(y / 16), -1)); }, 5000);
  }
  console.log(`http://127.0.0.1:${port}/`);
})().catch((e) => { console.error(e); shutdown(1); });
