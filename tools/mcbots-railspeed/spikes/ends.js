'use strict';
// One-off behind stage 2's Task 1: the road's two ends as the job will build them, in the road's own frame (k is the
// distance from the origin), with a bot in survival. What start.js left open:
//   - a dip only <flat> cells before the rail's end
//   - the origin's curb: does a cart stop at it, can a bot walk over it, does a cart on k 5 start and cross the first dip
//   - boosters powered by a torch in a wall niche, on the road's own slots
//   - a bot that quits in a riding cart, and a rider that meets a cart left on the rail
// usage: NODE_PATH=... node ends.js <flat cells between the last dip and the rail's end> | curb
const {Vec3} = require('vec3');
const {setSpeed, parseSample} = require('../rig');
const {send, lay, consoleCall} = require('../run');
const {connect} = require('./riders');
require('../../../hosts/bandit-lab/services/mcbots/app/physicsfix'); // Paper 26.2 pulls a bot back from a step without it

const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOT = 'bot50', RULE = 200, x0 = 300, y = 200, z = 88, ROOF = y + 4;
const X = (k) => x0 + k;
const isDip = (k) => k % 16 === 8 || k % 16 === 9;
const isSlot = (k) => [0, 4, 12].includes(k % 16);
const cartAny = `@e[type=minecart,x=0,y=150,z=${z},dx=8000,dy=100,dz=1,limit=1]`;
const force = (verb, H) => { const out = []; for (let x = X(-1) - 16; x <= X(H) + 16; x += 4000) out.push(`forceload ${verb} ${x} ${z} ${Math.min(X(H) + 16, x + 3999)} ${z}`); return out; };
const say = (o) => console.log(JSON.stringify(o));

function road(H) {
  const out = [];
  for (let k = -1; k <= H + 3; k += 500) out.push(`fill ${X(k)} ${y - 2} ${z - 1} ${X(Math.min(H + 3, k + 499))} ${ROOF} ${z + 2} stone`);
  out.push(`fill ${X(0)} ${y} ${z - 1} ${X(2)} ${y + 3} ${z + 1} air`); // the chamber
  out.push(`fill ${X(3)} ${y + 1} ${z} ${X(4)} ${y + 2} ${z} air`, `setblock ${X(4)} ${y} ${z} air`); // the curb, k 3, stays; 3 high above it and the landing
  out.push(`fill ${X(5)} ${y} ${z} ${X(H + 1)} ${y + 1} ${z} air`, `fill ${X(5)} ${y} ${z} ${X(H)} ${y} ${z} rail[shape=east_west]`);
  const dips = [];
  for (let k = 5; k <= H; k++) if (isDip(k)) dips.push(`setblock ${X(k)} ${y} ${z} air`, `setblock ${X(k)} ${y - 1} ${z} rail[shape=${k % 16 === 8 ? 'ascending_west' : 'ascending_east'}]`);
  out.push(...dips, ...dips.filter((c) => c.includes('rail'))); // placing a rail can reshape it against its neighbours; a second set leaves it as asked
  const slots = [];
  for (let k = 5; k <= H; k++) if (isSlot(k)) slots.push(k);
  for (const k of new Set([...slots.slice(0, 48), ...slots.slice(-48)])) out.push(`setblock ${X(k)} ${y} ${z} powered_rail[shape=east_west]`, `setblock ${X(k)} ${y} ${z + 1} redstone_torch`);
  return out;
}

async function board(bot, standK, railK) {
  await send(call, [`tp ${BOT} ${X(standK) + 0.5} ${y} ${z + 0.5}`]);
  await sleep(3000);
  for (let i = 0; i < 80 && !bot.blockAt(new Vec3(X(railK), y, z)); i++) await sleep(250);
  const rail = bot.blockAt(new Vec3(X(railK), y, z));
  if (!rail || !/rail/.test(rail.name)) throw new Error(`no rail seen at k ${railK}: ${rail?.name}`);
  const item = bot.inventory.items().find((i) => i.name === 'minecart');
  if (!item) throw new Error('no cart in the inventory');
  await bot.equip(item, 'hand');
  await bot.lookAt(rail.position.offset(0.5, 0.1, 0.5), true);
  await bot.activateBlock(rail);
  let cart = null;
  for (let i = 0; i < 20 && !cart; i++) { cart = bot.nearestEntity((e) => e.name === 'minecart' && e.position.distanceTo(bot.entity.position) < 8); await sleep(100); }
  if (!cart) throw new Error('no cart after placing');
  await bot.lookAt(cart.position, true);
  bot.mount(cart);
  for (let i = 0; i < 50 && !bot.vehicle; i++) await sleep(100);
  if (!bot.vehicle) throw new Error('did not mount');
  return cart;
}

// Follows the rider's own cart over the console, until it has stood for 1.5 s or `until` says so.
async function follow(bot, {sign, startK, until = () => false, ms = 90000}) {
  const out = {};
  const input = setInterval(() => { if (bot.vehicle) bot.moveVehicle(0, 1); }, 100);
  const t0 = Date.now(), speeds = [];
  let prev = null, still = 0, last = null, started = null;
  try {
    while (Date.now() - t0 < ms) {
      const s = parseSample(await call(['time query gametime', `execute as ${BOT} on vehicle run data get entity @s Pos`]));
      if (!s) { out.lost = true; break; }
      last = s;
      if (started === null && Math.abs(s.x - X(startK)) > 3) started = Date.now() - t0;
      if (!prev) prev = s;
      else if (s.tick - prev.tick >= 10) {
        const ms2 = (Math.abs(s.x - prev.x) / (s.tick - prev.tick)) * 20;
        speeds.push([Math.round((s.x - X(startK)) * sign), Math.round(ms2)]);
        still = ms2 < 0.05 ? still + 1 : 0;
        prev = s;
        if (started !== null && still >= 3) break;
      }
      if (until(s)) { out.stoppedEarly = true; break; }
      await sleep(100);
    }
  } finally {
    clearInterval(input);
  }
  Object.assign(out, {startedAfterMs: started, secs: Math.round((Date.now() - t0) / 1000), top: Math.max(0, ...speeds.map((p) => p[1])), speeds});
  if (last) Object.assign(out, {restK: +(last.x - x0).toFixed(1), restY: +last.y.toFixed(2), restZ: +last.z.toFixed(2)});
  return out;
}

async function getOff(bot) {
  bot._client.write('player_input', {inputs: {shift: true}});
  await sleep(1000);
  bot._client.write('player_input', {inputs: {}});
  bot.vehicle = null;
  await sleep(1000);
}

async function takeCart(bot) {
  const near = bot.nearestEntity((e) => e.name === 'minecart');
  const pick = bot.inventory.items().find((i) => i.name === 'iron_pickaxe');
  if (pick) await bot.equip(pick, 'hand');
  let hits = 0;
  for (; hits < 8 && near && bot.entities[near.id]; hits++) { bot.attack(near); await sleep(900); }
  await sleep(1500);
  return {hits, carts: bot.inventory.items().filter((i) => i.name === 'minecart').length};
}

const speedAt = (speeds, k) => speeds.find((p) => p[0] >= k)?.[1] ?? null;
const health = async () => Number(/: ([\d.]+)f/.exec((await call([`data get entity ${BOT} Health`]))[0])?.[1]);
const where = async () => { const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec((await call([`data get entity ${BOT} Pos`]))[0]); return m && [+(+m[1] - x0).toFixed(1), +(+m[2]).toFixed(1), +(+m[3]).toFixed(1)]; };

(async () => {
  const curbOnly = process.argv[2] === 'curb';
  const flat = curbOnly ? 3 : Number(process.argv[2]);
  if (!Number.isInteger(flat)) throw new Error('usage: ends.js <flat cells between the last dip and the rail\'s end> | curb');
  const H = (curbOnly ? 16 : 1984) + 9 + flat;
  let bot = await connect(BOT);
  bot.on('death', () => say({step: 'THE BOT DIED', at: bot.entity.position.floored().toString()}));
  const forced = force('add', H);
  try {
    await send(call, [setSpeed(RULE), `clear ${BOT}`, `gamemode survival ${BOT}`, `give ${BOT} minecart 1`, `give ${BOT} iron_pickaxe 1`]); // no tp before the lane exists: a fall from y 200 kills a bot in survival
    await lay(call, sleep, {x1: X(-1) - 16, x2: X(H) + 16, y, z}, forced);
    await send(call, road(H));
    const [powered, shape] = await call([`execute if block ${X(12)} ${y} ${z} powered_rail[powered=true]`, `execute if block ${X(8)} ${y - 1} ${z} rail[shape=ascending_west]`]);
    say({step: 'laid', H, flat, poweredK12: /passed/.test(powered), dipK8: /passed/.test(shape)});
    await send(call, force('remove', H));
    await sleep(2000);

    if (!curbOnly) await rides(bot, H, flat);
    await overTheCurb(bot);
    if (!curbOnly) bot = await relog(bot);
    if (!curbOnly) await meetACart(bot);
  } finally {
    await send(call, [...forced, `kill @e[type=minecart,x=0,y=150,z=${z},dx=8000,dy=100,dz=1]`]).catch((e) => console.error(e.message));
    await sleep(3000);
    const clear = [];
    for (let k = -1; k <= H + 3; k += 500) clear.push(`fill ${X(k)} ${y - 2} ${z - 1} ${X(Math.min(H + 3, k + 499))} ${ROOF} ${z + 2} air`);
    await send(call, [...clear, `kill @e[type=item,x=0,y=150,z=${z - 2},dx=8000,dy=100,dz=6]`, ...force('remove', H), `forceload remove ${X(1000)} ${z}`, setSpeed(8), `clear ${BOT}`, `gamemode creative ${BOT}`]).catch((e) => console.error(`clean up by hand: ${e.message}`));
    bot.quit();
  }
  process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); setTimeout(() => process.exit(1), 500); });

async function rides(bot, H, flat) {
    // Out: start on k 5, cross the first dip by input alone, stop at the head with a dip <flat> cells behind the rail's end.
    await board(bot, 4, 5);
    let r = await follow(bot, {sign: 1, startK: 5});
    say({step: 'out', flat, startedAfterMs: r.startedAfterMs, secs: r.secs, top: r.top, atRampEnd: speedAt(r.speeds, 261), lost: r.lost, restK: r.restK, restY: r.restY, restZ: r.restZ, railEnd: H, health: await health()});
    await getOff(bot);
    say({step: 'out, cart taken', at: await where(), ...await takeCart(bot)});

    // Back: start on the head, stop at the curb.
    await board(bot, H + 1, H);
    r = await follow(bot, {sign: -1, startK: H});
    say({step: 'back', startedAfterMs: r.startedAfterMs, secs: r.secs, top: r.top, lost: r.lost, restK: r.restK, restY: r.restY, restZ: r.restZ, curbK: 3, landingK: 4, health: await health()});
    await getOff(bot);
    say({step: 'back, cart taken', at: await where(), ...await takeCart(bot)});

}

async function overTheCurb(bot) {
    // Over the curb, the way goNear will.
    const {pathfinder, Movements, goals} = require('mineflayer-pathfinder');
    bot.loadPlugin(pathfinder);
    const mv = new Movements(bot);
    mv.canDig = false;
    mv.allow1by1towers = false;
    mv.allowSprinting = false;
    mv.allowParkour = false;
    mv.getMoveDiagonal = () => {};
    bot.pathfinder.setMovements(mv);
    await send(call, [`tp ${BOT} ${X(4) + 0.5} ${y} ${z + 0.5}`]);
    await sleep(2000);
    const walk = await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(X(1), y, z)).then(() => 'arrived', (e) => `failed: ${e.message}`), sleep(20000).then(() => 'timed out')]);
    bot.pathfinder.setGoal(null);
    say({step: 'over the curb', walk, at: await where()});

}

async function relog(bot) {
    // A rider quits while riding.
    await board(bot, 4, 5);
    r = await follow(bot, {sign: 1, startK: 5, until: (s) => s.x > X(800)});
    say({step: 'quitting at', restK: r.restK, stoppedEarly: r.stoppedEarly});
    bot.quit();
    const after = [];
    for (let i = 0; i < 8; i++) {
      await sleep(1000);
      const s = parseSample(await call(['time query gametime', `data get entity ${cartAny} Pos`]));
      after.push(s ? Math.round(s.x - x0) : null);
    }
    say({step: 'the cart without its rider', kPerSecond: after});
    await sleep(3000);
    bot = await connect(BOT);
    await sleep(2000);
    const [riding] = await call([`execute as ${BOT} on vehicle if entity @s`]);
    const carts = await call([`execute if entity ${cartAny}`, `data get entity ${cartAny} Pos`]);
    say({step: 'logged in again', stillRiding: /passed/.test(riding), botAt: await where(), knowsVehicle: Boolean(bot.vehicle), cartExists: /passed/.test(carts[0]), cart: carts[1].slice(-60)});

    return bot;
}

async function meetACart(bot) {
    // A rider meets a cart left on the rail.
    await send(call, [`kill @e[type=minecart,x=0,y=150,z=${z},dx=8000,dy=100,dz=1]`, `clear ${BOT} minecart`, `give ${BOT} minecart 1`, `forceload add ${X(1000)} ${z}`, `summon minecart ${X(1000) + 0.5} ${y + 0.1} ${z + 0.5} {Tags:["left"]}`]);
    await board(bot, 4, 5);
    r = await follow(bot, {sign: 1, startK: 5});
    const [leftAt] = await call(['data get entity @e[tag=left,limit=1] Pos']);
    const m = /\[(-?[\d.E-]+)d/.exec(leftAt);
    say({step: 'met a cart left at k 1000', top: r.top, lost: r.lost, restK: r.restK, restY: r.restY, speedsNear1000: r.speeds.filter((p) => p[0] > 800 && p[0] < 1300), leftCartNowAtK: m && Math.round(+m[1] - x0), health: await health()});
}
