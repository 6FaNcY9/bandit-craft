'use strict';
// One-off behind the plan for highway stage 2: a builder's whole trip, by a bot in survival, on a dip road laid by the console.
// It puts a cart from its inventory on the rail's end, boards, starts by input, rides the boosters and dips in a 2-high
// tunnel, runs off the rail's end onto a landing, gets off, takes the cart back, and does the same the other way.
// usage: NODE_PATH=... node start.js <boosters at each end> <landing cells> [booster spacing] [km]
const {Vec3} = require('vec3');
const {dipEvery, setSpeed, parseSample} = require('../rig');
const {send, lay, consoleCall} = require('../run');
const {connect} = require('./riders');

const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const y = 200, z = 88, x1 = 300, BOT = 'bot50', RULE = 200, DIP = 16;
const force = (verb, x2) => { const out = []; for (let x = x1 - 16; x <= x2 + 16; x += 4000) out.push(`forceload ${verb} ${x} ${z} ${Math.min(x2 + 16, x + 3999)} ${z}`); return out; };

// Rails from the first cell after one landing to the last before the other, dips every 16, the boosters avoiding the dips.
function road(x2, boosters, landing, spacing) {
  const [ra, rb] = [x1 + landing, x2 - landing];
  const out = [];
  for (let x = x1 - 1; x <= x2 + 1; x += 2000) out.push(`fill ${x} ${y - 2} ${z - 1} ${Math.min(x2 + 1, x + 1999)} ${y + 2} ${z + 1} stone`);
  out.push(`fill ${x1} ${y} ${z} ${x2} ${y + 1} ${z} air`, `fill ${ra} ${y} ${z} ${rb} ${y} ${z} rail[shape=east_west]`);
  const dipAt = (x) => { const m = ((x - (ra + 8)) % DIP + DIP) % DIP; return m === 0 || m === 1; };
  const power = (x) => [`setblock ${x} ${y - 1} ${z} redstone_block`, `setblock ${x} ${y} ${z} powered_rail[shape=east_west,powered=true]`];
  let n = 0;
  for (let k = 0; n < boosters; k += spacing) {
    if (dipAt(ra + k) || dipAt(rb - k)) continue;
    out.push(...power(ra + k), ...power(rb - k));
    n++;
  }
  // dipEvery stops 20 short of its end, which is fine: the first and last rails stay flat.
  return [...out, ...dipEvery({x2: rb, y, z}, DIP, ra + 8)];
}

const cartSel = '@e[type=minecart,x=0,y=150,z=' + z + ',dx=8000,dy=100,dz=1,limit=1]';
const carts = (bot) => bot.inventory.items().filter((i) => i.name === 'minecart').reduce((n, i) => n + i.count, 0);

async function trip(bot, dir, {x2, landing}) {
  const out = {dir};
  const [stand, railX, sign] = dir === 'east' ? [x1, x1 + landing, 1] : [x2, x2 - landing, -1];
  await send(call, [`tp ${BOT} ${stand + 0.5} ${y} ${z + 0.5}`]);
  await sleep(3000);
  for (let i = 0; i < 80 && !bot.blockAt(new Vec3(railX, y, z)); i++) await sleep(250);
  const rail = bot.blockAt(new Vec3(railX, y, z));
  if (!rail || !/rail/.test(rail.name)) {
    const [sp, h] = await call([`data get entity ${BOT} Pos`, `execute if block ${railX} ${y} ${z} #minecraft:rails`]);
    const p = bot.entity.position;
    throw new Error(`no rail seen at ${railX}: ${rail?.name}; bot thinks ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}, server ${sp.replace(/.*data: /, '').slice(0, 40)}, columns ${bot.columns.size}, has rail column ${bot.columns.has(`${railX >> 4},${z >> 4}`)}, server rail: ${h}`);
  }
  const item = bot.inventory.items().find((i) => i.name === 'minecart');
  if (!item) throw new Error('no cart in the inventory');
  await bot.equip(item, 'hand');
  await bot.lookAt(rail.position.offset(0.5, 0.1, 0.5), true);
  await bot.activateBlock(rail);
  for (let i = 0; i < 20 && !bot.nearestEntity((e) => e.name === 'minecart' && e.position.distanceTo(bot.entity.position) < 8); i++) await sleep(100);
  const cart = bot.nearestEntity((e) => e.name === 'minecart' && e.position.distanceTo(bot.entity.position) < 8);
  out.placed = Boolean(cart);
  if (!cart) return out;
  await bot.lookAt(cart.position, true);
  bot.mount(cart);
  for (let i = 0; i < 50 && !bot.vehicle; i++) await sleep(100);
  out.mounted = Boolean(bot.vehicle);
  if (!bot.vehicle) return out;

  let packets = 0, lastPacket = null, gapMax = 0;
  const onMove = (p) => { if (p.entityId !== cart.id || !p.steps.length) return; const t = Date.now(); if (lastPacket) gapMax = Math.max(gapMax, t - lastPacket); lastPacket = t; packets++; };
  bot._client.on('move_minecart', onMove);
  const input = setInterval(() => { if (bot.vehicle) bot.moveVehicle(0, 1); }, 100);
  const t0 = Date.now(), marks = [];
  let prev = null, top = 0, still = 0, moved = false, startedAt = null, last = null;
  while (Date.now() - t0 < 150000) {
    const s = parseSample(await call(['time query gametime', `data get entity ${cartSel} Pos`]));
    if (!s) { out.lost = true; break; }
    last = s;
    if (!moved && Math.abs(s.x - stand) > landing + 10) { moved = true; startedAt = Date.now(); }
    if (!prev) prev = s;
    else if (s.tick - prev.tick >= 10) {
      const ms = (Math.abs(s.x - prev.x) / (s.tick - prev.tick)) * 20;
      top = Math.max(top, ms);
      marks.push([Math.round(Math.abs(s.x - railX)), Math.round(ms)]);
      still = ms < 0.05 ? still + 1 : 0;
      prev = s;
      if (moved && still >= 3) break;
    }
    await sleep(100);
  }
  clearInterval(input);
  bot._client.off('move_minecart', onMove);
  const sinceLast = lastPacket && Date.now() - lastPacket;
  await sleep(5000); // does the server stay quiet about a standing cart?
  Object.assign(out, {secs: startedAt && Math.round((Date.now() - startedAt) / 1000), top: Math.round(top), packets, gapMax, sinceLast, quietAfter: lastPacket && Date.now() - lastPacket});
  out.speedAt = marks.filter((m, i) => i % Math.max(1, Math.floor(marks.length / 16)) === 0).map((m) => m.join(':')).join(' ');
  if (last) Object.assign(out, {restX: +last.x.toFixed(1), restY: +last.y.toFixed(2), pastRail: +((last.x - (dir === 'east' ? x2 - landing : x1 + landing)) * sign).toFixed(1), restZ: +last.z.toFixed(2)});
  bot._client.write('player_input', {inputs: {shift: true}});
  await sleep(1000);
  bot._client.write('player_input', {inputs: {}});
  bot.vehicle = null;
  await sleep(1000);
  const [riding, pos, health] = await call([`execute as ${BOT} on vehicle if entity @s`, `data get entity ${BOT} Pos`, `data get entity ${BOT} Health`]);
  out.stillRiding = /Test passed/.test(riding);
  out.health = Number(/: ([\d.]+)f/.exec(health)?.[1]);
  const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(pos);
  out.botAt = m && [+Number(m[1]).toFixed(1), +Number(m[2]).toFixed(1), +Number(m[3]).toFixed(1)];
  out.botKnows = m ? +(Math.abs(bot.entity.position.x - Number(m[1]))).toFixed(1) : null;

  // Take the cart back: it must not stay on a road. By hand it heals faster than a bot can hit it (10 a hit, 1 a tick, 40 to break).
  const near = bot.nearestEntity((e) => e.name === 'minecart');
  let hits = 0;
  const pick = bot.inventory.items().find((i) => i.name === 'iron_pickaxe');
  if (pick) await bot.equip(pick, 'hand');
  for (; hits < 8 && near && bot.entities[near.id]; hits++) { bot.attack(near); await sleep(900); }
  out.hits = hits;
  await sleep(2000);
  out.cartsAfter = carts(bot);
  if (!out.cartsAfter) { await send(call, [`give ${BOT} minecart 1`]); await sleep(500); }
  return out;
}

(async () => {
  const [boosters, landing, spacing = 4, km = 2] = process.argv.slice(2).map(Number);
  if (!boosters || !Number.isInteger(landing)) throw new Error('usage: start.js <boosters at each end> <landing cells> [booster spacing] [km]');
  const x2 = x1 + km * 1000;
  const bot = await connect(BOT);
  const forced = force('add', x2);
  try {
    await send(call, [setSpeed(RULE), `clear ${BOT}`, `gamemode survival ${BOT}`, `give ${BOT} minecart 1`, `give ${BOT} iron_pickaxe 1`, `tp ${BOT} ${x1 + 0.5} ${y} ${z + 0.5}`]);
    // Chunks first, one small step at a time, then the road; then they are freed so that the bot has to load them as on a real road.
    await lay(call, sleep, {x1: x1 - 16, x2: x2 + 16, y, z}, forced);
    await send(call, road(x2, boosters, landing, spacing));
    await send(call, force('remove', x2));
    await sleep(2000);
    for (const dir of ['east', 'west']) console.log(JSON.stringify({boosters, landing, spacing, km, ...await trip(bot, dir, {x2, landing})}));
  } finally {
    await send(call, [...forced, `kill @e[type=minecart,x=0,y=150,z=${z},dx=8000,dy=100,dz=1]`]).catch((e) => console.error(e.message));
    await sleep(3000);
    const clear = [];
    for (let x = x1 - 1; x <= x2 + 1; x += 2000) clear.push(`fill ${x} ${y - 2} ${z - 1} ${Math.min(x2 + 1, x + 1999)} ${y + 2} ${z + 1} air`);
    await send(call, [...clear, `kill @e[type=item,x=0,y=150,z=${z - 2},dx=8000,dy=100,dz=5]`, ...force('remove', x2), setSpeed(8), `clear ${BOT}`, `gamemode creative ${BOT}`]).catch((e) => console.error(`clean up by hand: ${e.message}`));
    bot.quit();
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); setTimeout(() => process.exit(1), 500); });
