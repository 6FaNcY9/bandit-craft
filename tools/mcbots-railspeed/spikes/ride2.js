'use strict';
// One-off measurement behind docs/runbooks/minecraft/highway-measurements.md; only the settings there were run.
// A bot rides a built ride lane, chunks not forced: does the cart stall where a player has to load the chunks?
// usage: NODE_PATH=... node ride2.js <z> <setting>
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const mineflayer = require('mineflayer');
const R = '../';
const {setSpeed, parseSample} = require(R + 'rig');
const {send, consoleCall} = require(R + 'run');
const BOT = 'bot50';
const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
      else if (/incorrect password/i.test(msg)) { bot.quit(); rej(new Error('wrong password')); }
      else if (/logged in successfully|registered successfully|already logged in/i.test(msg)) { authed = true; setTimeout(() => { bot.chat('/server sandbox'); setTimeout(() => res(bot), 6000); }, 2000); }
    });
    bot.once('kicked', (r) => rej(new Error('kicked: ' + JSON.stringify(r))));
    bot.once('error', rej);
  });
}
(async () => {
  const [z, setting] = process.argv.slice(2).map(Number);
  const x1 = 300, x2 = 5300, y = 200;
  const sel = `@e[type=minecart,tag=rslane,x=0,y=150,z=${z},dx=6000,dy=100,dz=1,limit=1]`;
  let kicked = null;
  const bot = await connect();
  bot.on('kicked', (r) => { kicked = JSON.stringify(r).slice(0, 200); });
  await send(call, [setSpeed(setting), `gamemode creative ${BOT}`, `tp ${BOT} ${x1 + 2.5} ${y + 0.2} ${z + 1.5}`]);
  await sleep(4000);
  // Whatever an earlier ride left: a fresh cart at the start.
  await call([`kill @e[type=minecart,tag=rslane,x=0,y=150,z=${z},dx=6000,dy=100,dz=1]`, `summon minecart ${x1 + 2.5} ${y + 0.1} ${z + 0.5} {Tags:["rslane"]}`]);
  await sleep(1500);
  const cart = bot.nearestEntity((e) => e.name === 'minecart' && Math.abs(e.position.z - (z + 0.5)) < 1);
  if (!cart) throw new Error('no cart near the bot');
  await bot.lookAt(cart.position);
  bot.mount(cart);
  for (let i = 0; i < 50 && !bot.vehicle; i++) await sleep(100);
  if (!bot.vehicle) throw new Error('did not get on');
  const input = setInterval(() => { if (bot.vehicle) bot.moveVehicle(0, 1); }, 200);
  const t0 = Date.now();
  let prev = null, top = 0, gaps = 0, minTps = 99, slowAfter = [], rows = [], end = 'timeout';
  while (Date.now() - t0 < 170000) {
    const s = parseSample(await call(['time query gametime', `data get entity ${sel} Pos`]));
    if (!s) { end = 'cart gone'; break; }
    s.wall = Date.now();
    if (prev && s.tick - prev.tick >= 6) {
      const ms = ((s.x - prev.x) / (s.tick - prev.tick)) * 20, tps = ((s.tick - prev.tick) / (s.wall - prev.wall)) * 1000;
      top = Math.max(top, ms); minTps = Math.min(minTps, tps);
      rows.push([Math.round(s.x), Math.round(ms), +tps.toFixed(1)]);
      if (top > 50 && ms < top * 0.5 && s.x < x2 - 5) slowAfter.push([Math.round(s.x), Math.round(ms)]);
      if (s.x >= x2 - 1 || s.x < prev.x - 1) { end = 'reached the end'; break; }
      if (Math.abs(s.z - z - 0.5) > 1 || Math.abs(s.y - y) > 2.5) { end = 'derailed'; break; }
      prev = s;
    } else if (!prev) prev = s;
    if (kicked) { end = 'kicked'; break; }
    await sleep(150);
  }
  clearInterval(input);
  console.log(rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 14)) === 0).map((r) => `x${r[0]}:${r[1]}`).join(' '));
  console.log(JSON.stringify({z, setting, end, top: Math.round(top), secs: Math.round((Date.now() - t0) / 1000), minTps: +minTps.toFixed(1), slowSpots: slowAfter.slice(0, 12), kicked}));
  bot._client.write('player_input', {inputs: {shift: true}});
  await sleep(1500);
  bot._client.write('player_input', {inputs: {}});
  // Leave a fresh cart at the start for the owner, and the rule at 200.
  await send(call, [`kill @e[type=minecart,tag=rslane,x=0,y=150,z=${z},dx=6000,dy=100,dz=1]`, `tp ${BOT} ${x1 + 2.5} ${y + 0.2} ${z + 1.5}`]);
  await sleep(4000);
  await call([`kill @e[type=minecart,tag=rslane,x=0,y=150,z=${z},dx=6000,dy=100,dz=1]`, `summon minecart ${x1 + 2.5} ${y + 0.1} ${z + 0.5} {Tags:["rslane"]}`, setSpeed(200)]);
  bot.quit();
})().catch((e) => { console.error(e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 500); });
