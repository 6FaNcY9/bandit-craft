'use strict';
// One-off behind the plan for highway stage 2: can a bot in survival build a dip and a booster with its own hands?
// Rails get their shape from their neighbours, so the order of placing decides. usage: NODE_PATH=... node place.js <east|north>
const {Vec3} = require('vec3');
const {consoleCall, send} = require('../run');
const {connect} = require('./riders');
const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOT = 'bot51', O = {x: 420, y: 200, z: 140}, DIP = [4, 5], LEN = 10, BOOST = 8;
const AXES = {east: {dx: 1, dz: 0, flat: 'east_west', back: 'ascending_west', on: 'ascending_east'}, north: {dx: 0, dz: -1, flat: 'north_south', back: 'ascending_south', on: 'ascending_north'}};

(async () => {
  const dir = process.argv[2], a = AXES[dir];
  if (!a) throw new Error('usage: place.js <east|north>');
  const cell = (k, h = 0, side = 0) => new Vec3(O.x + a.dx * k + a.dz * side, O.y + h, O.z + a.dz * k + a.dx * side);
  const box = (p, q, what) => `fill ${Math.min(p.x, q.x)} ${Math.min(p.y, q.y)} ${Math.min(p.z, q.z)} ${Math.max(p.x, q.x)} ${Math.max(p.y, q.y)} ${Math.max(p.z, q.z)} ${what}`;
  const area = `${O.x - 20} ${O.z - 20} ${O.x + 20} ${O.z + 20}`;
  const bot = await connect(BOT);
  const out = {dir, shapes: {}, want: {}};
  try {
    await send(call, [`forceload add ${area}`]);
    await sleep(3000);
    await send(call, [`clear ${BOT}`, `gamemode survival ${BOT}`, `give ${BOT} rail 16`, `give ${BOT} powered_rail 2`, `give ${BOT} redstone_torch 2`, `give ${BOT} iron_pickaxe 1`,
      box(cell(-3, -2, -2), cell(LEN + 2, 2, 2), 'stone'), box(cell(-2, 0), cell(LEN + 1, 1), 'air'), box(cell(DIP[0], -1), cell(DIP[1], -1), 'air')]);
    await sleep(1000);
    const placeOn = async (k) => {
      const h = DIP.includes(k) ? -1 : 0;
      const standH = DIP.includes(k - 1) ? -1 : 0;
      const stand = cell(k - 1, standH);
      await send(call, [`tp ${BOT} ${stand.x + 0.5} ${stand.y} ${stand.z + 0.5}`]);
      await sleep(600);
      const item = bot.inventory.items().find((i) => i.name === 'rail');
      await bot.equip(item, 'hand');
      await bot.placeBlock(bot.blockAt(cell(k, h - 1)), new Vec3(0, 1, 0));
      await sleep(200);
    };
    for (let k = 0; k < LEN; k++) await placeOn(k);
    for (let k = 0; k < LEN; k++) {
      const h = DIP.includes(k) ? -1 : 0;
      out.shapes[k] = bot.blockAt(cell(k, h))?.getProperties().shape ?? bot.blockAt(cell(k, h))?.name;
      out.want[k] = k === DIP[0] ? a.back : k === DIP[1] ? a.on : a.flat;
    }
    out.shapesRight = Object.keys(out.want).every((k) => out.want[k] === out.shapes[k]);

    // A booster: swap one rail for a powered one, with a redstone torch in a niche dug into the wall beside it.
    const stand = cell(BOOST - 1);
    await send(call, [`tp ${BOT} ${stand.x + 0.5} ${stand.y} ${stand.z + 0.5}`]);
    await sleep(600);
    const pick = bot.inventory.items().find((i) => i.name === 'iron_pickaxe');
    await bot.equip(pick, 'hand');
    await bot.dig(bot.blockAt(cell(BOOST)));
    await sleep(300);
    await bot.dig(bot.blockAt(cell(BOOST, 0, 1)));
    await sleep(300);
    await bot.equip(bot.inventory.items().find((i) => i.name === 'powered_rail'), 'hand');
    await bot.placeBlock(bot.blockAt(cell(BOOST, -1)), new Vec3(0, 1, 0));
    await sleep(300);
    await bot.equip(bot.inventory.items().find((i) => i.name === 'redstone_torch'), 'hand');
    await bot.placeBlock(bot.blockAt(cell(BOOST, -1, 1)), new Vec3(0, 1, 0));
    await sleep(800);
    const b = bot.blockAt(cell(BOOST));
    out.booster = {name: b?.name, ...b?.getProperties()};
    const t = bot.blockAt(cell(BOOST, 0, 1));
    out.torch = t?.name;
    out.railsLeft = bot.inventory.items().filter((i) => /rail/.test(i.name)).map((i) => `${i.name}:${i.count}`).join(' ');
  } catch (e) {
    out.error = e.message;
  } finally {
    console.log(JSON.stringify(out));
    await send(call, [box(cell(-3, -2, -2), cell(LEN + 2, 2, 2), 'air'), `kill @e[type=item,x=${O.x - 25},y=190,z=${O.z - 25},dx=50,dy=20,dz=50]`, `forceload remove ${area}`, `clear ${BOT}`, `gamemode creative ${BOT}`]).catch((e) => console.error(`clean up by hand: ${e.message}`));
    bot.quit();
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); setTimeout(() => process.exit(1), 500); });
