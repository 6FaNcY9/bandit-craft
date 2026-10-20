'use strict';
// Out from under sand: the pathfinder never digs a block with sand or gravel on top (dontMineUnderFallingBlock),
// so in a cave under a desert or a beach every way up is shut. bot1 sat 10 min at -181 58 -218 under one
// sandstone and two sand and every walk ran out its 90 s (main server, 2026-10-15; teleported). Digging that roof
// from below would drop the sand onto the bot (buried). `unroof` steps beside the column over its feet and digs
// the column from there: the sand falls into the column, not onto the bot, and is dug again from the side, until
// no sand or gravel is left in the roof. The climb then walks up the open column (a pillar of its own blocks).
// The decisions are pure and tested in test.js; makeUnroof() wires them to a bot.
const {Vec3} = require('vec3');

const GRAVITY = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|\w+_concrete_powder)$/;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const UP = 12; // how far above the feet a roof is looked for
const REACH = 5; // the highest cell over the feet dug from beside: eyes at +1.6, one block across (server: 5.5)

const solid = (b) => b?.boundingBox === 'block';
const open = (b) => !!b && b.boundingBox === 'empty' && !/water|lava|bubble_column/.test(b.name);

// The roof over feet p: the solid cells above the first open ones, up to the next open cell. true when sand or
// gravel is part of it (from p on: sand that already fell into the column counts too).
function sandRoof(blockAt, p) {
  let y = p.y;
  while (y <= p.y + UP && !solid(blockAt(p.x, y, p.z))) y++;
  for (; y <= p.y + UP && solid(blockAt(p.x, y, p.z)); y++) if (GRAVITY.test(blockAt(p.x, y, p.z).name)) return true;
  return false;
}

// The lowest solid cell of the column within reach, or null (the roof is higher, or there is none).
function nextDig(blockAt, p) {
  for (let y = p.y; y <= p.y + REACH; y++) if (solid(blockAt(p.x, y, p.z))) return {x: p.x, y, z: p.z};
  return null;
}

// A cell beside p to stand in: open at the feet and the head, a floor below. `dig` lists what has to go first
// when no side is open (no sand or gravel in it or on it, so nothing falls into the bot's own cell).
function side(blockAt, p) {
  const cells = SIDES.map(([dx, dz]) => ({x: p.x + dx, y: p.y, z: p.z + dz}));
  const free = cells.find((c) => open(blockAt(c.x, c.y, c.z)) && open(blockAt(c.x, c.y + 1, c.z)) && solid(blockAt(c.x, c.y - 1, c.z)));
  if (free) return {...free, dig: []};
  for (const c of cells) {
    const [feet, head, top] = [0, 1, 2].map((dy) => blockAt(c.x, c.y + dy, c.z));
    if (!solid(blockAt(c.x, c.y - 1, c.z)) || [feet, head, top].some((b) => !b || GRAVITY.test(b.name) || /water|lava|bubble_column/.test(b.name))) continue;
    return {...c, dig: [[feet, 0], [head, 1]].filter(([b]) => solid(b)).map(([, dy]) => ({x: c.x, y: c.y + dy, z: c.z}))};
  }
  return null;
}

function makeUnroof({goBlock, guard, sleep, unsafe, at, seal = null}) {
  const blockAtOf = (bot) => (x, y, z) => bot.blockAt(new Vec3(x, y, z));

  // One block dug from where the bot stands, with its best tool; a dig the server never answers ends after 25 s.
  async function digHere(r, job, c) {
    const {bot} = r;
    const block = bot.blockAt(new Vec3(c.x, c.y, c.z));
    if (!solid(block)) return;
    let danger = unsafe(bot, block.position);
    // Water beside the roof gets plugged first, as a mine target's (bot20 under a lake at -414 56 -413 failed every job, 2026-10-20).
    if (danger && seal && / next to it$/.test(danger) && (await seal(r, job, block.position))) danger = unsafe(bot, block.position);
    if (danger) throw new Error(`unsafe: ${danger}`);
    await bot.tool?.equipForBlock(block, {}).catch(() => {});
    guard(job);
    let timer;
    try {
      await Promise.race([bot.dig(bot.blockAt(block.position), true), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('the server never answered the dig')), 25000)))]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Falling sand is an entity until it lands: the column looks open meanwhile. Wait until it is the same for 0.6 s.
  async function settle(r, p) {
    const B = blockAtOf(r.bot);
    const look = () => Array.from({length: REACH + 3}, (_, i) => B(p.x, p.y + i, p.z)?.name).join();
    await sleep(300);
    let last = look(), since = 0;
    for (let t = 0; t < 3000 && since < 600; t += 100) {
      await sleep(100);
      const now = look();
      since = now === last ? since + 100 : 0;
      last = now;
    }
  }

  // true when the column over the bot's feet was opened (no sand or gravel left in its roof), so a climb can go on.
  async function unroof(r, job) {
    const {bot} = r;
    const p = bot.entity.position.floored();
    const B = blockAtOf(bot);
    if (!sandRoof(B, p)) return false;
    const s = side(B, p);
    if (!s) return false;
    if (job.t) job.t.doing = `digging out from under sand at ${at(p)}`;
    for (const c of s.dig) await digHere(r, job, c);
    guard(job);
    await goBlock(r, job, s);
    for (let i = 0; i < 24 && sandRoof(B, p); i++) {
      guard(job);
      const c = nextDig(B, p);
      if (!c) break; // the roof is out of reach from beside
      await digHere(r, job, c);
      await settle(r, p);
    }
    const done = !sandRoof(B, p);
    r.emit('info', done ? `dug the sand out of the roof over ${at(p)} from beside it` : `could not open the sand roof over ${at(p)}`);
    return done;
  }

  return {unroof};
}

module.exports = {sandRoof, nextDig, side, makeUnroof, GRAVITY, REACH};
