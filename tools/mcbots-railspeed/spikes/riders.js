'use strict';
// One-off measurement behind docs/runbooks/minecraft/highway-measurements.md: bots as the test riders.
// Four bots on the four ride lanes of `run.js rig` at once, chunks not forced. Those lanes share their chunks. Also measures
// how far the world has arrived ahead of the rider, which is what a person would judge by eye.
// usage: NODE_PATH=... node riders.js <setting>
// Raw rows go to ~/.local/state/mcbots/railspeed-riders.jsonl.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const {setSpeed, parseSample} = require('../rig');
const {send, consoleCall} = require('../run');

const TAG = 'rsbot'; // the boats' own, not rslane: the vehicles left at the lanes' starts for a person stay there
const OWNER_LANES = {dip: {x1: 300, x2: 5300, y: 200, z: 70}, rail: {x1: 300, x2: 5300, y: 200, z: 40}};
const OWNER_RULE = 200; // what the owner's ride lanes were left at
const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'mcbots');
const record = (row) => { fs.appendFileSync(path.join(state, 'railspeed-riders.jsonl'), JSON.stringify({at: new Date().toISOString(), ...row}) + '\n'); console.log(JSON.stringify(row)); };
const median = (a) => (a.length ? [...a].sort((p, q) => p - q)[a.length >> 1] : null);

// How far along the rider's own chunk row the world is there, and how much of the nearest 81 chunks.
function reach(columns, x, z) {
  const [cx, cz] = [Math.floor(x / 16), Math.floor(z / 16)];
  let ahead = 0, near = 0;
  while (columns.has(`${cx + ahead},${cz}`)) ahead++;
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (columns.has(`${cx + dx},${cz + dz}`)) near++;
  return {lead: (cx + ahead) * 16 - x, near: near / 81};
}
assert.deepStrictEqual(reach(new Set(['0,0', '1,0']), 8, 8), {lead: 24, near: 2 / 81});
assert.strictEqual(reach(new Set(), 8, 8).lead, -8); // negative: the rider is on a chunk that has not arrived

function connect(name) {
  const mineflayer = require('mineflayer');
  const seed = fs.readFileSync(path.join(state, 'seed'), 'utf8').trim();
  const password = crypto.createHash('sha256').update(`${seed}:${name}`).digest('hex').slice(0, 32);
  const bot = mineflayer.createBot({host: process.env.MC_HOST || '100.125.161.81', port: 25565, username: name, auth: 'offline', version: '26.1', hideErrors: true, fakeHost: 'sandbox.bots'});
  bot.columns = new Set();
  bot.on('chunkColumnLoad', (p) => bot.columns.add(`${p.x >> 4},${p.z >> 4}`));
  bot.on('chunkColumnUnload', (p) => bot.columns.delete(`${p.x >> 4},${p.z >> 4}`));
  bot.kickedFor = null;
  bot.on('kicked', (r) => { bot.kickedFor = JSON.stringify(r).slice(0, 200); });
  return new Promise((res, rej) => {
    let authed = false;
    bot.on('messagestr', (msg) => {
      if (authed) return;
      if (/not registered|use \/register/i.test(msg)) bot.chat(`/register ${password} ${password}`);
      else if (/use \/login|already registered/i.test(msg)) bot.chat(`/login ${password}`);
      else if (/incorrect password/i.test(msg)) { bot.quit(); rej(new Error('wrong password')); }
      else if (/logged in successfully|registered successfully|already logged in/i.test(msg)) { authed = true; setTimeout(() => { bot.chat('/server sandbox'); setTimeout(() => res(bot), 6000); }, 2000); }
    });
    bot.once('kicked', (r) => { if (!authed) rej(new Error(`${name} kicked at login: ${JSON.stringify(r).slice(0, 200)}`)); });
    bot.once('error', rej);
    setTimeout(() => { if (!authed) rej(new Error(`${name}: no login after 60 s`)); }, 60000);
  });
}

// One rider from a standing start to the end wall. Times the middle 4 km too: the 10 s start by input says nothing about the road.
async function follow(bot, {x2, y, z}) {
  const sel = `@e[type=minecart,tag=rslane,x=0,y=150,z=${z},dx=6000,dy=100,dz=1,limit=1]`;
  const out = {bot: bot.username, z, end: 'timeout', top: 0, slow: 0, cruise: null, minLead: Infinity, voidSamples: 0, samples: 0};
  const started = Date.now(), input = setInterval(() => { if (bot.vehicle) bot.moveVehicle(0, 1); }, 200);
  const leads = [], nears = [];
  let prev = null, at1k = null, at5k = null;
  while (Date.now() - started < 170000) {
    const s = parseSample(await call(['time query gametime', `data get entity ${sel} Pos`]));
    if (!s) { out.end = 'cart gone'; break; }
    s.wall = Date.now();
    if (s.x >= 1000 && !at1k) at1k = s.wall;
    if (s.x >= 5000 && !at5k) at5k = s.wall;
    const {lead, near} = reach(bot.columns, s.x, z + 0.5);
    if (s.x > 1000) { leads.push(lead); nears.push(near); out.minLead = Math.min(out.minLead, lead); out.samples++; if (lead <= 0) out.voidSamples++; }
    if (bot.kickedFor) { out.end = 'kicked'; out.kick = bot.kickedFor; break; }
    if (Math.abs(s.z - z - 0.5) > 1 || Math.abs(s.y - y) > 2.5) { out.end = 'derailed'; out.derailAt = Math.round(s.x); break; }
    if (s.x >= x2 - 1 || (prev && s.x < prev.x - 1)) { out.end = 'reached the end'; break; }
    if (!prev) prev = s;
    else if (s.tick - prev.tick >= 6) {
      const ms = ((s.x - prev.x) / (s.tick - prev.tick)) * 20;
      out.top = Math.max(out.top, Math.round(ms));
      if (out.top > 50 && ms < out.top * 0.5) out.slow++;
      prev = s;
    }
    await sleep(100);
  }
  clearInterval(input);
  out.secs = Math.round((Date.now() - started) / 1000);
  if (at1k && at5k) out.cruise = Math.round(4000 / ((at5k - at1k) / 1000));
  out.medLead = Math.round(median(leads));
  out.medNear = +median(nears)?.toFixed(2);
  out.minNear = nears.length ? +Math.min(...nears).toFixed(2) : null;
  return out;
}

async function rideAll(setting, lanes, bots) {
  const count = lanes.length;
  const inLane = (l) => `@e[type=minecart,tag=rslane,x=0,y=150,z=${l.z},dx=6000,dy=100,dz=1]`;
  const summon = (l) => `summon minecart ${l.x1 + 2.5} ${l.y + 0.1} ${l.z + 0.5} {Tags:["rslane"]}`;
  let tpsDone = false;
  try {
    const home = (i) => `tp ${bots[i].username} ${lanes[i].x1 + 2.5} ${lanes[i].y + 0.2} ${lanes[i].z + 1.5}`;
    await send(call, [setSpeed(setting), ...bots.flatMap((b, i) => [`gamemode creative ${b.username}`, home(i)])]);
    await sleep(6000);
    await send(call, lanes.flatMap((l) => [`kill ${inLane(l)}`, summon(l)]));
    await sleep(1500);
    await Promise.all(bots.map(async (b, i) => {
      const cart = b.nearestEntity((e) => e.name === 'minecart' && Math.abs(e.position.z - (lanes[i].z + 0.5)) < 1);
      if (!cart) throw new Error(`${b.username}: no cart near`);
      await b.lookAt(cart.position);
      b.mount(cart);
      for (let t = 0; t < 50 && !b.vehicle; t++) await sleep(100);
      if (!b.vehicle) throw new Error(`${b.username}: did not get on`);
    }));
    const clock = [];
    const ticking = (async () => {
      while (!tpsDone) {
        const m = /The game time is (\d+)/.exec((await call(['time query gametime'])).join(' ').replace(/§./g, ''));
        if (m) clock.push({tick: Number(m[1]), wall: Date.now()});
        await sleep(1000);
      }
    })();
    const rows = await Promise.all(bots.map((b, i) => follow(b, lanes[i])));
    tpsDone = true;
    await ticking;
    const windows = clock.slice(2).map((c, i) => ((c.tick - clock[i].tick) / (c.wall - clock[i].wall)) * 1000);
    const round = {setting, riders: count, tpsMin: +Math.min(...windows).toFixed(1), tpsAvg: +(((clock.at(-1).tick - clock[0].tick) / (clock.at(-1).wall - clock[0].wall)) * 1000).toFixed(1)};
    for (const row of rows) record({...round, ...row});
    // Killed while the rider's chunks are still there: a cart left in an unloaded chunk would be out of every kill's reach.
    await send(call, lanes.map((l) => `kill ${inLane(l)}`));
    await sleep(500);
    await send(call, bots.map((_, i) => home(i)));
    await sleep(2000);
    await send(call, lanes.map(summon)); // the lanes keep a cart to board
  } finally {
    tpsDone = true;
    await call([setSpeed(OWNER_RULE)]).catch((e) => console.error(`set the rule by hand: ${e.message}`));
  }
}

// mineflayer has no boat physics. Tries its input first, then does what a real client does: works the boat out itself and tells the server.
async function boat(z, b) {
  const {x1, x2, y} = {x1: 300, x2: 5300, y: 200};
  const mid = z === 50 ? z + 1 : z + 0.5; // the two-wide lane is z 50 and 51
  const hulls = `@e[type=oak_boat,tag=${TAG},x=0,y=150,z=${z},dx=6000,dy=100,dz=2]`; // this lane's only: another rider may be out on the next one
  const sel = hulls.replace(']', ',limit=1]');
  {
    await send(call, [`gamemode creative ${b.username}`, `tp ${b.username} ${x1 + 3.5} ${y + 0.2} ${mid}`]);
    await sleep(5000);
    await send(call, [`kill ${hulls}`, `summon oak_boat ${x1 + 6.5} ${y} ${mid} {Tags:["${TAG}"],Rotation:[-90.0f,0.0f]}`]);
    await sleep(1500);
    const hull = b.nearestEntity((e) => /boat/.test(e.name) && e.position.x > x1 + 5 && Math.abs(e.position.z - mid) < 1.5);
    if (!hull) throw new Error('no boat near');
    await b.lookAt(hull.position);
    b.mount(hull);
    for (let t = 0; t < 50 && !b.vehicle; t++) await sleep(100);
    if (!b.vehicle) throw new Error('did not get on');
    const before = parseSample(await call(['time query gametime', `data get entity ${sel} Pos`]));
    const input = setInterval(() => b.moveVehicle(0, 1), 200);
    await sleep(5000);
    clearInterval(input);
    const after = parseSample(await call(['time query gametime', `data get entity ${sel} Pos`]));
    const byInput = +(after.x - before.x).toFixed(2);

    // Thrust 0.04 and friction 0.989 from the 26.2 code: this speed is what the bot was told to do, so only whether the server takes it is measured.
    let x = after.x, v = 0, sent = 0;
    const started = Date.now();
    const drive = setInterval(() => {
      v = v * 0.989 + 0.04;
      x += v;
      b._client.write('vehicle_move', {x, y, z: mid, yaw: -90, pitch: 0, onGround: false});
      sent++;
    }, 50);
    const out = {kind: 'boat', z, byInput, end: 'timeout', maxGap: 0, minLead: Infinity, voidSamples: 0, samples: 0};
    const leads = [], nears = [];
    let first = null, last = null;
    while (Date.now() - started < 170000) {
      const s = parseSample(await call(['time query gametime', `data get entity ${sel} Pos`]));
      if (!s) { out.end = 'boat gone'; break; }
      s.wall = Date.now();
      out.maxGap = Math.max(out.maxGap, Math.round(Math.abs(x - s.x)));
      if (s.x > 1000) {
        if (!first) first = s;
        last = s;
        const {lead, near} = reach(b.columns, s.x, mid);
        leads.push(lead); nears.push(near); out.minLead = Math.min(out.minLead, lead); out.samples++; if (lead <= 0) out.voidSamples++;
      }
      if (b.kickedFor) { out.end = 'kicked'; out.kick = b.kickedFor; break; }
      if (s.x >= x2 - 8) { out.end = 'reached the end'; break; }
      if (x - s.x > 200) { out.end = 'server refused the moves'; break; }
      await sleep(250);
    }
    clearInterval(drive);
    out.secs = Math.round((Date.now() - started) / 1000);
    out.sent = sent;
    if (first && last && last.wall > first.wall) out.cruise = +(((last.x - first.x) / (last.wall - first.wall)) * 1000).toFixed(1);
    out.medLead = Math.round(median(leads));
    out.medNear = +median(nears)?.toFixed(2);
    record(out);
    await send(call, [`kill ${hulls}`]);
    await sleep(500);
    await send(call, [`tp ${b.username} ${x1 - 2.5} ${y + 0.2} ${mid}`]);
    await sleep(2000);
  }
}

async function withBots(names, run) {
  const bots = [];
  try {
    for (const name of names) { bots.push(await connect(name)); await sleep(3500); } // Velocity's login limit
    await run(bots);
  } finally {
    for (const b of bots) b.quit();
  }
}

(async () => {
  const setting = Number(process.argv[2]);
  if (!setting) throw new Error('usage: riders.js <setting>');
  await withBots(['bot50', 'bot51', 'bot52', 'bot53'], ([p, q, r, s]) => Promise.all([rideAll(setting, [OWNER_LANES.dip, OWNER_LANES.rail], [p, q]), boat(50, r), boat(60, s)]));
  process.exit(0); // mineflayer's sockets would hold the process open
})().catch((e) => { console.error(e.message); setTimeout(() => process.exit(1), 500); });
