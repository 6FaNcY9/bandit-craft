#!/usr/bin/env node
'use strict';
// Live proof for the highway job: does a bot board, ride and leave a cart on the SANDBOX? Prints one JSON line.
// A throwaway check against the real server, so no unit test can stand in for it.
// Usage (laptop, tailnet): NODE_PATH=<mcbots node_modules> node ride.js <setting> <spacing>
// Bot: RIDE_BOT (default bot50), password from ~/.local/state/mcbots/seed like every laptop bot.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mineflayer = require('mineflayer');
const {railLane, powerEvery, setSpeed, clearLane, parseSample, summarize} = require('./rig');
const {send, lay, free, isForce, consoleCall} = require('./run');

const BOT = process.env.RIDE_BOT || 'bot50';
const LANE = {x1: 300, x2: 2300, y: 200, z: 20};
const TAG = 'rsride';
const CART = `@e[type=minecart,tag=${TAG},limit=1]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445'); // the dashboard: its console is the SANDBOX server's

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

const cartAt = async () => parseSample(await call(['time query gametime', `data get entity ${CART} Pos`]));

// A bot beside a standing cart: does it get on?
async function board(bot, x) {
  const {y, z} = LANE;
  await send(call, [`kill @e[tag=${TAG}]`, `tp ${BOT} ${x + 2} ${y + 0.2} ${z + 0.5}`, `summon minecart ${x} ${y + 0.1} ${z + 0.5} {Tags:["${TAG}"]}`]);
  await sleep(1500);
  const cart = bot.nearestEntity((e) => e.name === 'minecart');
  if (!cart) return false;
  await bot.lookAt(cart.position);
  bot.mount(cart);
  for (let i = 0; i < 50 && !bot.vehicle; i++) await sleep(100);
  return Boolean(bot.vehicle);
}

// Does this start move the cart at all, without any Motion given by the console?
async function starts(bot) {
  const before = await cartAt();
  const input = setInterval(() => bot.vehicle && bot.moveVehicle(0, 1), 200);
  await sleep(5000);
  clearInterval(input);
  const after = await cartAt();
  return Boolean(before && after && after.x - before.x >= 3);
}

async function ride(bot, state) {
  const samples = [];
  const started = Date.now();
  let lag = 0;
  const input = setInterval(() => bot.vehicle && bot.moveVehicle(0, 1), 200);
  try {
    for (;;) {
      const s = await cartAt();
      samples.push(s && {...s, wall: Date.now()});
      if (s) lag = Math.max(lag, Math.abs(bot.entity.position.x - s.x));
      const sum = summarize(samples, LANE);
      if (sum.lost || sum.derailed || sum.reachedEnd || state.kicked || Date.now() - started > 150000) return {...sum, lag};
      await sleep(500);
    }
  } finally {
    clearInterval(input);
  }
}

async function main([setting, spacing]) {
  const lane = [...railLane(LANE), ...powerEvery(LANE, Number(spacing))];
  const out = {setting: Number(setting), spacing: Number(spacing), mounted: false, stationaryStart: false, boosterStart: false, kicked: null};
  const state = {kicked: false};
  const bot = await connect();
  bot.on('kicked', (r) => { state.kicked = true; out.kicked = JSON.stringify(r).slice(0, 200); });
  try {
    await send(call, [setSpeed(out.setting)]);
    await lay(call, sleep, LANE, lane);
    await send(call, [`gamemode creative ${BOT}`]);
    // Chunks freed: the bot has to load the lane as it goes, as on a real road, but the start must be there first.
    await send(call, [`tp ${BOT} ${LANE.x1 + 3.5} ${LANE.y + 0.2} ${LANE.z + 0.5}`]);
    await sleep(2000);
    await send(call, free(LANE));

    // By the rider's own input, from a plain rail.
    out.mounted = await board(bot, LANE.x1 + 1.5);
    if (out.mounted) out.stationaryStart = await starts(bot);
    // Otherwise from a powered rail with a block behind it, which needs no input at all.
    if (out.mounted && !out.stationaryStart) {
      bot.dismount();
      await sleep(1000);
      out.mounted = await board(bot, LANE.x1 + 0.5);
      if (out.mounted) out.boosterStart = await starts(bot);
    }
    if (out.mounted && !out.stationaryStart && !out.boosterStart) await send(call, [`data merge entity ${CART} {Motion:[1.0,0.0,0.0]}`]);

    if (out.mounted) {
      Object.assign(out, await ride(bot, state));
      out.moved = out.top !== null && out.top > 1;
      out.followed = out.lag < 5;
      if (bot.vehicle) bot.dismount();
      for (let i = 0; i < 30 && bot.vehicle; i++) await sleep(100);
      out.dismounted = !bot.vehicle;
      await sleep(2000);
      const [pos] = await send(call, [`data get entity ${BOT} Pos`]);
      const m = /\[(-?[\d.E-]+)d/.exec(pos);
      out.resynced = Boolean(m) && Math.abs(Number(m[1]) - bot.entity.position.x) < 2;
    }
  } finally {
    // Forced again for the cleanup, because fill refuses unloaded chunks; clearLane frees them at its end.
    await lay(call, sleep, LANE, railLane(LANE).filter(isForce));
    await send(call, [...clearLane(LANE, TAG), setSpeed(8)]).catch((e) => console.error(`clean up by hand: ${e.message}`));
    bot.quit();
  }
  console.log(JSON.stringify(out));
}

main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
