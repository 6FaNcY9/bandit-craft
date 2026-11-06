#!/usr/bin/env node
'use strict';
// Movement check: bot50 walks one lane per obstacle (gap, door, gate, ladder, vines, scaffolding, water) in the SANDBOX
// with the project's safeMovements. Run: see run.sh. CLEAN=1 only removes the courses. Sandbox and bot50 only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const mineflayer = require('mineflayer');
const {pathfinder, goals} = require('mineflayer-pathfinder');
const APP = process.env.MCBOTS_APP || path.join(os.homedir(), 'src/bandit-craft-fleet/hosts/bandit-lab/services/mcbots/app');
const {safeMovements} = require(path.join(APP, 'bots.js'));

const BOT = 'bot50';
const B = 'https://bandit-lab.tail7facc9.ts.net:8445';
const X0 = 3600, Z0 = 3400, Y = 119, LANE = 8; // floor blocks at y=119 (stand y=120); one lane (3 wide) per course
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Only the hub's sandbox console: RCON never reaches the main server from here.
async function rcon(cmd) {
  const r = await fetch(B + '/api/sandbox/console', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: B}, body: JSON.stringify({commands: [cmd]})});
  const body = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(`rcon failed (${cmd}): ${body.error || r.status}`);
  return body.replies[0].replace(/§./g, '').trim();
}
const blk = (zc, x1, x2, y1, y2, block) => rcon(`fill ${X0 + x1} ${y1} ${zc - 1} ${X0 + x2} ${y2} ${zc + 1} minecraft:${block}`);
const one = (zc, x, y, block) => rcon(`setblock ${X0 + x} ${y} ${zc} minecraft:${block}`);
// Wall across the lane at x=6 (stone, y120-122), centre cell opened for the obstacle; floor x0-12.
async function wall(zc, centre) {
  await blk(zc, 0, 12, Y, Y, 'stone');
  await blk(zc, 6, 6, 120, 122, 'stone');
  await one(zc, 6, 121, 'air'); await one(zc, 6, 120, 'air');
  await centre();
}
// Climb: floor x0-4, solid column x=5 (y120-125), platform floor y=125 x5-9, climbable at x=4 from y120 to 126.
async function climb(zc, place) {
  await blk(zc, 0, 4, Y, Y, 'stone');
  await blk(zc, 5, 5, 120, 125, 'stone'); await blk(zc, 5, 9, 125, 125, 'stone');
  await place();
}
const column = (zc, block) => async () => { for (let y = 120; y <= 126; y++) await one(zc, 4, y, block); };
// course: build(zc), start x/y, goal x/y (all relative to X0), time limit in ms
const COURSES = [
  {name: 'gap course', start: [1, 120], goal: [34, 124], ms: 45000, build: async (zc) => {
    for (const [a, b] of [[0, 4], [6, 9], [12, 15], [19, 22]]) await blk(zc, a, b, Y, Y, 'stone');
    await blk(zc, 24, 27, Y + 1, Y + 1, 'stone');
    for (const [dx, y] of [[28, 121], [29, 122], [30, 123]]) {
      await blk(zc, dx, dx, 120, y - 1, 'stone');
      await blk(zc, dx, dx, y, y, 'oak_stairs[facing=east,half=bottom]');
    }
    await blk(zc, 31, 34, 123, 123, 'stone');
  }},
  {name: 'closed oak door', start: [1, 120], goal: [11, 120], ms: 20000, build: (zc) => wall(zc, async () => {
    await one(zc, 6, 120, 'oak_door[facing=east,half=lower,open=false]'); await one(zc, 6, 121, 'oak_door[facing=east,half=upper,open=false]');
  })},
  {name: 'fence gate', start: [1, 120], goal: [11, 120], ms: 20000, build: (zc) => wall(zc, () => one(zc, 6, 120, 'oak_fence_gate[facing=east,open=false]'))},
  {name: '6-high ladder', start: [1, 120], goal: [8, 126], ms: 30000, build: (zc) => climb(zc, column(zc, 'ladder[facing=west]'))},
  {name: 'vines 6 high', start: [1, 120], goal: [8, 126], ms: 30000, build: (zc) => climb(zc, column(zc, 'vine[east=true]'))},
  {name: 'scaffolding 6 high', start: [1, 120], goal: [8, 126], ms: 30000, build: (zc) => climb(zc, column(zc, 'scaffolding'))},
  {name: '3-wide water', start: [1, 120], goal: [11, 120], ms: 30000, build: async (zc) => {
    await blk(zc, 0, 4, Y, Y, 'stone'); await blk(zc, 8, 12, Y, Y, 'stone');
    await blk(zc, 5, 7, Y - 1, Y - 1, 'stone'); await blk(zc, 5, 7, Y, Y, 'water');
  }},
].map((c, i) => ({...c, zc: Z0 + i * LANE}));
const ZMAX = Z0 + (COURSES.length - 1) * LANE;
async function build() {
  await rcon(`forceload add ${X0 - 4} ${Z0 - 6} ${X0 + 40} ${ZMAX + 6}`);
  await rcon(`fill ${X0 - 3} 99 ${Z0 - 5} ${X0 + 40} 100 ${ZMAX + 5} minecraft:stone`); // net, 20 blocks down: pathfinder never drops there
  for (const c of COURSES) await c.build(c.zc);
}
async function clean() {
  await rcon(`fill ${X0 - 3} 99 ${Z0 - 5} ${X0 + 40} 100 ${ZMAX + 5} minecraft:air replace minecraft:stone`);
  await rcon(`fill ${X0 - 3} 118 ${Z0 - 2} ${X0 + 40} 128 ${ZMAX + 2} minecraft:air`); // our own volume, nothing else lives out here
  await rcon(`forceload remove ${X0 - 4} ${Z0 - 6} ${X0 + 40} ${ZMAX + 6}`);
}
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
      else if (/incorrect password/i.test(msg)) { bot.quit(); rej(new Error('VeloAuth: wrong password, stopped')); }
      else if (/logged in successfully|registered successfully|already logged in/i.test(msg)) {
        authed = true;
        setTimeout(() => { bot.chat('/server sandbox'); setTimeout(() => res(bot), 6000); }, 2000);
      }
    });
    bot.once('kicked', (r) => rej(new Error(`kicked: ${JSON.stringify(r)}`)));
    bot.once('error', rej);
  });
}
async function tpTo(bot, zc, x, y) {
  await rcon(`tp ${BOT} ${X0 + x + 0.5} ${y} ${zc + 0.5}`);
  bot.pathfinder.setGoal(null); bot.clearControlStates();
  await sleep(1500);
}
async function attempt(bot, c) {
  let corr = 0; const on = () => corr++;
  bot.on('forcedMove', on);
  const [gx, gy] = c.goal, t0 = Date.now();
  let err = '';
  try {
    await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(X0 + gx, gy, c.zc)), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), c.ms))]);
  } catch (e) { err = e.message; bot.pathfinder.setGoal(null); }
  const secs = (Date.now() - t0) / 1000;
  await sleep(1000); bot.removeListener('forcedMove', on);
  const p = bot.entity.position;
  const dist = Math.hypot(p.x - (X0 + gx + 0.5), p.y - gy, p.z - (c.zc + 0.5));
  const ok = !err && dist < 2;
  return {course: c.name, ok, secs: +secs.toFixed(1), corrections: corr, reason: ok ? '' : `${err || 'reported arrival, not at goal'}; ended ${(p.x - X0).toFixed(1)},${p.y.toFixed(1)} (goal ${gx},${gy}), ${dist.toFixed(1)} away`};
}
(async () => {
  if (process.env.CLEAN) { await clean(); console.log('cleaned'); return; }
  const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
  await build();
  const out = [];
  let bot;
  try {
    bot = await connect();
    await rcon(`gamemode survival ${BOT}`);
    await rcon(`effect give ${BOT} minecraft:resistance infinite 4 true`);
    await rcon('clear ' + BOT);
    bot.loadPlugin(pathfinder);
    await sleep(1500);
    const mv = safeMovements(bot, [], null); // project default: sprint + parkour on, diagonals off
    mv.canDig = false; // no digging shortcuts: only walk/jump/climb/open
    bot.pathfinder.setMovements(mv);
    bot.pathfinder.thinkTimeout = 4000; bot.pathfinder.searchRadius = 80;
    for (const c of COURSES) {
      if (only && !only.test(c.name)) continue;
      await tpTo(bot, c.zc, ...c.start);
      out.push(await attempt(bot, c));
      console.log(JSON.stringify(out.at(-1)));
    }
  } finally {
    fs.writeFileSync(process.env.OUT || path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
    if (out.length) {
      console.log('\ncourse                 ok   secs  corr  reason');
      for (const r of out) console.log(`${r.course.padEnd(22)} ${(r.ok ? 'y' : 'n').padEnd(4)} ${String(r.secs).padEnd(5)} ${String(r.corrections).padEnd(5)} ${r.reason}`);
    }
    try { bot?.quit(); } catch {}
    await sleep(500);
    await clean();
  }
})().catch((e) => { console.error(e.message); process.exitCode = 2; });
