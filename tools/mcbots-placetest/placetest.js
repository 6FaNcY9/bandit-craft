#!/usr/bin/env node
'use strict';
// Live check of app/placing.js: a creative test bot places each block state the way placing.js says, in
// the SANDBOX server, and the server's own `execute if block` says whether the state came out right.
// Usage (laptop, tailnet, `ssh bandit-lab` with docker): NODE_PATH=<mcbots node_modules> node placetest.js [filter]
// Bot: PLACETEST_BOT (default bot50), password from ~/.local/state/mcbots/seed like every laptop bot.
const {execFile} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mineflayer = require('mineflayer');
const {Vec3} = require('vec3');
const {placement, YAW} = require('../../hosts/bandit-lab/services/mcbots/app/placing');

const BOT = process.env.PLACETEST_BOT || 'bot50';
const CONTAINER = 'minecraft-sandbox'; // never anything else: `minecraft` is the real server
const X0 = 3100, Z0 = 3000, FLOOR = 120; // in the air: case i at x X0 + 4 i, its ways at z Z0 + 4 w, cells at y FLOOR + 2
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(os.tmpdir(), 'mcpt-%C')}`, '-o', 'ControlPersist=300'];

function rcon(cmd) {
  if (cmd.includes("'")) throw new Error(`no single quotes in rcon commands: ${cmd}`);
  return new Promise((res, rej) => execFile('ssh', [...SSH, 'bandit-lab', `docker exec ${CONTAINER} rcon-cli '${cmd}'`], {timeout: 60000},
    (e, out, err) => (e ? rej(new Error(`rcon failed (${cmd}): ${e.message} ${err}`)) : res(out.replace(/\x1b\[[0-9;]*m/g, '').trim()))));
}
const state = (name, props) => `minecraft:${name}${Object.keys(props).length ? `[${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')}]` : ''}`;
const isBlock = async (p, name, props) => /Test passed/.test(await rcon(`execute if block ${p.x} ${p.y} ${p.z} ${state(name, props)}`));

// [name, props, {support: block for the clicked neighbour, pre: [[dx,dy,dz,block]] set first, sneak}]
const H = ['north', 'south', 'east', 'west'], SIXD = [...H, 'up', 'down'];
const CASES = [
  ...['down', ...H].map((f) => ['hopper', {facing: f}, {support: 'chest'}]),
  ...H.map((f) => ['chest', {facing: f, type: 'single'}]),
  ...H.map((f) => ['comparator', {facing: f, mode: 'compare'}]),
  ['comparator', {facing: 'north', mode: 'subtract'}],
  ...['1', '2', '3', '4'].map((d) => ['repeater', {facing: 'east', delay: d}]),
  ...H.map((f) => ['repeater', {facing: f, delay: '1'}]),
  ...SIXD.map((f) => ['observer', {facing: f}]),
  ...SIXD.map((f) => ['dropper', {facing: f}]),
  ...SIXD.map((f) => ['sticky_piston', {facing: f}]),
  ['piston', {facing: 'up'}], ['dispenser', {facing: 'west'}],
  ...SIXD.map((f) => ['barrel', {facing: f}]),
  ...SIXD.map((f) => ['shulker_box', {facing: f}]),
  ...H.map((f) => ['redstone_wall_torch', {facing: f}]),
  ...H.map((f) => ['oak_wall_sign', {facing: f}]), // the iron farm's water holders (2026-10-15)
  ['redstone_torch', {}], ['torch', {}], ['redstone_wire', {}], ['target', {}], ['redstone_lamp', {}],
  ['redstone_block', {}], ['composter', {}], ['glass', {}], ['stone', {}], ['note_block', {note: '5'}],
  ...['bottom', 'top', 'double'].map((t) => ['stone_slab', {type: t}]), ['smooth_stone_slab', {type: 'bottom'}],
  ...H.map((f) => ['stone_button', {face: 'wall', facing: f}]), ['stone_button', {face: 'floor', facing: 'east'}],
  ...H.flatMap((f) => ['bottom', 'top'].map((h) => ['iron_trapdoor', {facing: f, half: h}])),
  ...H.flatMap((f) => ['bottom', 'top'].map((h) => ['oak_stairs', {facing: f, half: h}])),
  ...['x', 'y', 'z'].map((a) => ['oak_log', {axis: a}]),
  ['powered_rail', {shape: 'north_south'}], ['powered_rail', {shape: 'east_west'}], ['activator_rail', {shape: 'east_west'}],
  ['rail', {shape: 'north_south'}],
];

function connect() {
  const seed = fs.readFileSync(path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'mcbots/seed'), 'utf8').trim();
  const password = crypto.createHash('sha256').update(`${seed}:${BOT}`).digest('hex').slice(0, 32);
  const bot = mineflayer.createBot({host: process.env.MC_HOST || '100.125.161.81', port: 25565, username: BOT, auth: 'offline', version: '26.1', hideErrors: true, fakeHost: 'sandbox.bots'});
  return new Promise((res, rej) => {
    let authed = false;
    bot.on('messagestr', (msg) => {
      if (authed) return;
      if (/not registered|use \/register/i.test(msg)) bot.chat(`/register ${password} ${password}`);
      else if (/use \/login|already registered/i.test(msg)) bot.chat(`/login ${password}`);
      else if (/incorrect password/i.test(msg)) { bot.quit(); rej(new Error('VeloAuth: wrong password, stopped (retries would block the address)')); }
      else if (/logged in successfully|registered successfully|already logged in/i.test(msg)) {
        authed = true;
        setTimeout(() => { bot.chat('/server sandbox'); setTimeout(() => res(bot), 6000); }, 2000);
      }
    });
    bot.once('kicked', (r) => rej(new Error(`kicked: ${JSON.stringify(r)}`)));
    bot.once('error', rej);
  });
}

async function hold(bot, item) {
  const Item = require('prismarine-item')(bot.registry);
  const id = bot.registry.itemsByName[item]?.id;
  if (id == null) throw new Error(`no item ${item}`);
  await bot.creative.setInventorySlot(36, new Item(id, 1));
  bot.setQuickBarSlot(0);
  await sleep(150);
}

async function click(bot, t, w, sneak = true) {
  const ref = bot.blockAt(t.offset(...w.against));
  if (!ref) throw new Error('reference block not loaded');
  const pitch = w.look === 'up' ? Math.PI / 2 : w.look === 'down' ? -Math.PI / 2 : 0;
  // Not force=true: mineflayer 4.39 then marks the look as sent without sending it (stairs kept the old facing).
  // look() waits for the yaw only; the sent pitch follows at 0.15 rad per tick (physics.pitchSpeed), so wait it out.
  const dp = Math.abs(pitch - bot.entity.pitch);
  await bot.look(w.look && YAW[w.look] != null ? YAW[w.look] : bot.entity.yaw, pitch);
  await bot.waitForTicks(Math.ceil(dp / 0.15) + 2);
  if (sneak) bot.setControlState('sneak', true);
  await sleep(200); // rotation and sneak reach the server before the click
  await bot._genericPlace(ref, new Vec3(...w.face), {delta: w.cursor ? new Vec3(...w.cursor) : undefined, forceLook: 'ignore'});
  await sleep(150);
  bot.setControlState('sneak', false);
  await sleep(250);
}

async function run(bot, i, [name, props, opt = {}], w, wi) {
  const t = new Vec3(X0 + 4 * i, FLOOR + 2, Z0 + 4 * wi);
  await rcon(`fill ${t.x - 1} ${t.y - 1} ${t.z - 1} ${t.x + 1} ${t.y + 1} ${t.z + 1} minecraft:air`);
  const a = t.offset(...w.against);
  if (!(w.against[0] === 0 && w.against[1] === 0 && w.against[2] === 0)) await rcon(`setblock ${a.x} ${a.y} ${a.z} minecraft:${opt.support || 'stone'}`);
  if (/rail|redstone_wire|repeater|comparator|torch$|button/.test(name) && w.against[1] !== -1) await rcon(`setblock ${t.x} ${t.y - 1} ${t.z} minecraft:stone`);
  await rcon(`setblock ${t.x} ${t.y - 2} ${t.z - 2} minecraft:stone`); // the bot stands two blocks north of the cell
  await rcon(`tp ${BOT} ${t.x + 0.5} ${t.y - 1} ${t.z - 2 + 0.5}`);
  await sleep(400);
  const p = placement(name, props);
  await hold(bot, p.item);
  await click(bot, t, w);
  if (p.again) await click(bot, t, p.again);
  if (p.cycle) {
    const n = p.cycle.values.indexOf(String(props[p.cycle.prop] ?? p.cycle.values[0]));
    for (let k = 0; k < n; k++) { await bot.activateBlock(bot.blockAt(t)); await sleep(250); }
  }
  const want = Object.fromEntries([...p.check, ...(p.final || [])].filter((k) => props[k] != null).map((k) => [k, props[k]]));
  const ok = await isBlock(t, name, want);
  const seen = bot.blockAt(t);
  return {ok, name, want, way: w, seen: seen ? `${seen.name} ${JSON.stringify(seen.getProperties())}` : '?'};
}

(async () => {
  const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
  const cases = CASES.filter(([n, pr]) => !filter || filter.test(`${n} ${JSON.stringify(pr)}`));
  await rcon(`forceload add ${X0 - 8} ${Z0 - 8} ${X0 + 4 * cases.length + 8} ${Z0 + 30}`);
  for (let i = 0; i < cases.length; i++) await rcon(`fill ${X0 + 4 * i - 2} ${FLOOR - 1} ${Z0 - 4} ${X0 + 4 * i + 1} ${FLOOR + 6} ${Z0 + 26} minecraft:air`);
  const bot = await connect();
  await rcon(`gamemode creative ${BOT}`);
  await rcon(`effect give ${BOT} minecraft:resistance infinite 4 true`);
  const results = [];
  try {
    for (const [i, c] of cases.entries()) {
      const ways = placement(c[0], c[1])?.ways;
      if (!ways) { results.push({ok: false, name: c[0], want: c[1], way: null, seen: 'placement() returned null'}); continue; }
      for (const [wi, w] of ways.entries()) {
        const r = await run(bot, i, c, w, wi).catch((e) => ({ok: false, name: c[0], want: c[1], way: w, seen: `error: ${e.message}`}));
        results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} ${JSON.stringify(c[1])} against ${w.against} look ${w.look}${r.ok ? '' : `  -> ${r.seen}`}`);
      }
    }
  } finally {
    bot.quit();
    await rcon(`forceload remove ${X0 - 8} ${Z0 - 8} ${X0 + 4 * cases.length + 8} ${Z0 + 30}`).catch(() => {});
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} placements right`);
  process.exitCode = bad.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 2; });
