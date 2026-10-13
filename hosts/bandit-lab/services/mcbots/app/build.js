'use strict';
// Build job (BOTS.md "Schematic building"): place the blocks of a small
// blueprint, bottom layer first, through the same claim table as digging, so
// a dig and a placement never meet on one block and several bots can share
// one build. Pure parts (validate, step, materials) are tested in test.js with
// a fake world; makeBuild() wires them to a bot like crafting.js does.
const {Vec3} = require('vec3');
const {insideAreas, normDim} = require('./world');

const MAX_BLOCKS = 75;
const MAX_SIZE = {x: 5, y: 3, z: 5}; // height 3: every target is in reach from the ground, no scaffolding
const NAME_RE = /^[a-z_]{1,48}$/;
// Plain full blocks only: no containers, gravity blocks, fluids, doors, or
// blocks whose facing/state matters (stairs, slabs, redstone, ...).
const REFUSED = /chest|barrel|shulker|furnace|hopper|dispenser|dropper|door|gate|bed$|sign|banner|(^|_)sand$|gravel|concrete_powder|anvil|water|lava|torch|lantern|stairs|slab|wall$|fence|pane|rail|button|lever|pressure_plate|redstone|piston|observer|repeater|comparator|scaffolding|carpet|^air$/;
const REPLACEABLE = new Set(['air', 'cave_air', 'short_grass', 'tall_grass', 'grass', 'fern', 'large_fern',
  'dandelion', 'poppy', 'snow', 'dead_bush']);
// Plants a build may break to free a target cell (an explicit list: torches and redstone wire
// also have hardness 0 and no collision box, and they are a player's, MC-3 review 2026-10-10).
const PLANTS = new Set(['short_grass', 'tall_grass', 'grass', 'fern', 'large_fern', 'dead_bush', 'bush',
  'short_dry_grass', 'tall_dry_grass', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
  'wildflowers', 'pink_petals', 'leaf_litter', 'firefly_bush', 'sunflower', 'lilac', 'rose_bush', 'peony']);
// Faces to place against, preferred first: the block below, then the sides, then above.
const FACES = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];

const int = (v, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || Math.abs(n) > 3e7) throw new Error(`${what} must be a whole number`);
  return n;
};

// Blueprint {origin: {x,y,z}, blocks: [{x,y,z,block}], remove?} with block
// positions relative to the origin -> {origin, blocks (absolute, build order), remove}.
function validate(bp, areas = []) {
  if (!bp || typeof bp !== 'object') throw new Error('blueprint must be an object');
  const o = {x: int(bp.origin?.x, 'origin x'), y: int(bp.origin?.y, 'origin y'), z: int(bp.origin?.z, 'origin z')};
  if (o.y < -64 || o.y > 316) throw new Error('origin y must be within -64..316');
  if (!Array.isArray(bp.blocks) || !bp.blocks.length) throw new Error('blueprint has no blocks');
  if (bp.blocks.length > MAX_BLOCKS) throw new Error(`at most ${MAX_BLOCKS} blocks`);
  const seen = new Set();
  const blocks = bp.blocks.map((b, i) => {
    const block = String(b?.block ?? '');
    if (!NAME_RE.test(block) || REFUSED.test(block)) throw new Error(`block ${i}: ${block || '?'} cannot be built (plain full blocks only)`);
    const p = {x: o.x + int(b.x, `block ${i} x`), y: o.y + int(b.y, `block ${i} y`), z: o.z + int(b.z, `block ${i} z`), block};
    const k = `${p.x},${p.y},${p.z}`;
    if (seen.has(k)) throw new Error(`block ${i}: two blocks at ${k}`);
    seen.add(k);
    if (insideAreas(areas, p.x, p.z)) throw new Error(`block ${i}: ${p.x} ${p.z} is inside a protected area`);
    return p;
  });
  for (const ax of ['x', 'y', 'z']) {
    const vs = blocks.map((b) => b[ax]);
    if (Math.max(...vs) - Math.min(...vs) + 1 > MAX_SIZE[ax]) throw new Error(`blueprint is larger than ${MAX_SIZE.x}x${MAX_SIZE.y}x${MAX_SIZE.z} (x by height by z)`);
  }
  // Bottom layer first, then z, then x: each block has a neighbour placed before it.
  blocks.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  return {origin: o, blocks, remove: bp.remove === true};
}

const keyOf = (p) => `${p.x},${p.y},${p.z}`;
const solid = (name) => name != null && !REPLACEABLE.has(name) && !/water|lava/.test(name);

// What to do next, given nameAt(x,y,z) -> block name (null = not loaded) and
// keys to leave alone (claimed by another bot, failed lately):
// {done} | {next, face, clear?} (face: offset from the target to the block placed
// against; clear: a plant there must be broken first, soft(name) says which) | {wait} | {stuck}.
function step(plan, nameAt, skip = new Set(), soft = () => false) {
  let open = 0;
  const stuck = [];
  for (const b of plan.blocks) {
    const here = nameAt(b.x, b.y, b.z);
    if (here === b.block) continue;
    open++;
    if (here == null || skip.has(keyOf(b))) continue;
    const clear = !REPLACEABLE.has(here) && soft(here);
    if (!REPLACEABLE.has(here) && !clear) {
      stuck.push(`${here} is in the way at ${b.x} ${b.y} ${b.z}`);
      continue;
    }
    const face = FACES.find(([dx, dy, dz]) => solid(nameAt(b.x + dx, b.y + dy, b.z + dz)));
    if (face) return {next: b, face, ...(clear ? {clear} : {})};
  }
  if (!open) return {done: true};
  return stuck.length ? {stuck: stuck[0]} : {wait: open};
}

// Remove mode: blocks this build placed (`placed`, keys "x,y,z"), top layer first. A matching
// block that was there before the build is never in `placed`, so it stays.
function removeStep(plan, nameAt, skip = new Set(), placed = new Set()) {
  const left = [...plan.blocks].reverse().filter((b) => placed.has(keyOf(b)) && nameAt(b.x, b.y, b.z) === b.block);
  if (!left.length) return {done: true};
  const next = left.find((b) => !skip.has(keyOf(b)));
  return next ? {next} : {wait: left.length};
}

// Blocks still to place, {name: count}.
function materials(plan, nameAt = () => null) {
  const need = {};
  for (const b of plan.blocks) if (nameAt(b.x, b.y, b.z) !== b.block) need[b.block] = (need[b.block] || 0) + 1;
  return need;
}

// What is missing, {name: count}: need minus have, only where have is short.
function shortfall(need, have) {
  const out = {};
  for (const [n, c] of Object.entries(need)) if ((have[n] || 0) < c) out[n] = c - (have[n] || 0);
  return out;
}

const formatShortfall = (missing) => Object.entries(missing).map(([n, c]) => `${c} ${n}`);

// {name: count} of an inventory item list.
function countHave(items) {
  const have = {};
  for (const it of items) have[it.name] = (have[it.name] || 0) + it.count;
  return have;
}

// What a bot can gather for itself: item -> (n, ctx) -> [[jobType, args]]. ctx (what the bot has
// and what stands nearby): {furnace, wood, hasFuel(n)}. Logs and planks are left out on purpose:
// `chop` takes any log type, so plank types would not match the blueprint.
const GATHER = {
  cobblestone: (n) => [['mine', {block: 'stone', count: n}]],
  dirt: (n) => [['mine', {block: 'dirt', count: n}]],
  // Stone is smelted cobblestone; the furnace (8 cobblestone, and a table from 1 log) and the
  // fuel (coal from coal ore) are fetched only when the bot has neither.
  stone: (n, ctx) => {
    const jobs = [['mine', {block: 'stone', count: n + (ctx.furnace ? 0 : 8)}]];
    if (!ctx.furnace && !ctx.wood) jobs.push(['chop', {count: 2}]);
    if (!ctx.hasFuel?.(n)) jobs.push(['mine', {block: 'coal_ore', count: Math.ceil(n / 8)}]);
    for (let left = n; left > 0; left -= 64) jobs.push(['smelt', {item: 'cobblestone', count: Math.min(left, 64)}]); // one furnace load
    return jobs;
  },
};

// {jobs: [[type, args]] in run order, unknown: ['2 oak_planks'], total: items asked for}.
// Mining jobs for the same block are merged (cobblestone and stone both mine stone).
function gatherPlan(missing, ctx = {}) {
  const jobs = [];
  const unknown = [];
  let total = 0;
  for (const [item, n] of Object.entries(missing)) {
    if (!GATHER[item]) {
      unknown.push(`${n} ${item}`);
      continue;
    }
    total += n;
    for (const [type, args] of GATHER[item](n, ctx)) {
      const same = type === 'mine' && jobs.find((j) => j[0] === 'mine' && j[1].block === args.block);
      if (same) same[1].count += args.count;
      else jobs.push([type, {...args}]);
    }
  }
  return {jobs, unknown, total};
}

const WAIT_MS = 60000; // no progress (blocks held by other bots, unreachable) for this long: give up
const DIG_TRIES = 3; // remove mode: a block that will not come out is given up after this many digs

// What builds placed, per dimension + blueprint (absolute blocks): a Set of "x,y,z". Shared by
// the bots of this process; lost when the process restarts (then remove refuses).
const RECORDS = new Map();
const recordOf = (dim, plan) => {
  const k = `${dim}|${JSON.stringify(plan.blocks)}`;
  if (!RECORDS.has(k)) RECORDS.set(k, new Set());
  return RECORDS.get(k);
};

function makeBuild({goNear, guard, sleep, goals, digAt, withdraw, runJob, gatherContext = () => ({}), waitMs = WAIT_MS}) {
  return async function build(r, job) {
    const {bot} = r;
    const plan = validate(job.args, r.protectedAreas);
    const dim = normDim(bot.game?.dimension); // same claim keys as digging (collect in bots.js)
    const ckey = (p) => `${dim}:${p.x},${p.y},${p.z}`;
    const nameAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null;
    const xs = plan.blocks.map((b) => b.x);
    const zs = plan.blocks.map((b) => b.z);
    const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    // The pathfinder must neither dig through nor scaffold into the build.
    const veto = (blk) => (insideAreas([box], blk.position.x, blk.position.z) ? 100 : 0);
    const mv = bot.pathfinder.movements;
    const scaffold = mv.scafoldingBlocks; // sic: mineflayer-pathfinder 2.4.5 spells it so
    const soft = (n) => PLANTS.has(n); // flowers and grass are cleared, anything else is refused
    const placed = recordOf(dim, plan);
    if (plan.remove && !placed.size) throw new Error('no record of this build being placed (only blocks a build placed are removed; records are lost when the bot process restarts)');
    const skip = new Map(); // key -> until
    const digFails = new Map(); // key -> failed digs (remove mode)
    const total = plan.blocks.length;
    let lastProgress = Date.now();
    const stalled = (what) => {
      if (Date.now() - lastProgress > waitMs) throw new Error(`no progress for ${Math.round(waitMs / 1000)} s: ${what}`);
    };
    try {
      mv.exclusionAreasBreak.push(veto);
      mv.exclusionAreasPlace.push(veto);
      // Nor spend the build's material on scaffolding (it ate 6 cobblestone on one walk, 2026-10-10).
      const names = new Set(plan.blocks.map((b) => b.block));
      if (names.has('stone')) names.add('cobblestone'); // stone is smelted from it
      const wanted = new Set([...names].map((n) => bot.registry.itemsByName[n]?.id));
      mv.scafoldingBlocks = scaffold.filter((id) => !wanted.has(id));
      if (!plan.remove) {
        const need = materials(plan, nameAt);
        const lack = () => shortfall(need, countHave(bot.inventory.items()));
        let missing = lack();
        const hasMissing = () => Object.keys(missing).length > 0;
        if (hasMissing() && r.supplyChest) {
          // Take exactly what is missing from the supply chest, item by item; an item the
          // chest does not hold is not an error yet, the recount decides.
          for (const [item, count] of Object.entries(missing)) {
            guard(job);
            try {
              await withdraw(r, job, item, count);
            } catch (e) {
              guard(job);
              if (!/^no .+ in the chest$/.test(e.message)) throw e;
            }
          }
          guard(job);
          missing = lack();
        }
        // Then gather the rest. A second round happens only if something got lost on the way
        // (scaffolding, a drop nobody picked up); never gather more than twice the blueprint's size.
        let gathered = 0;
        while (hasMissing()) {
          const g = gatherPlan(missing, gatherContext(r));
          if (g.unknown.length) throw new Error(`cannot gather ${g.unknown.join(', ')} yet`);
          if (!runJob || gathered + g.total > 2 * total) {
            const why = gathered ? ` (gathered ${gathered}, the limit is ${2 * total})` : r.supplyChest ? ' (not in the supply chest either)' : '';
            throw new Error(`missing material: ${formatShortfall(missing).join(', ')}${why}`);
          }
          gathered += g.total;
          for (const [type, args] of g.jobs) {
            guard(job);
            const what = `${type} ${args.block || args.item || ''} x${args.count}`.replace('  ', ' ');
            job.t.doing = `gathering for the build: ${what}`;
            r.emit?.('info', `build gathers: ${what}`);
            await runJob(r, job, type, args);
          }
          guard(job);
          missing = lack();
        }
      }
      let first = true;
      for (;;) {
        guard(job);
        const now = Date.now();
        for (const [k, until] of skip) if (until < now) skip.delete(k);
        const s = plan.remove ? removeStep(plan, nameAt, new Set(skip.keys()), placed) : step(plan, nameAt, new Set(skip.keys()), soft);
        const left = plan.remove ? (s.done ? 0 : plan.blocks.filter((b) => placed.has(keyOf(b)) && nameAt(b.x, b.y, b.z) === b.block).length) : Object.values(materials(plan, nameAt)).reduce((a, c) => a + c, 0);
        job.t.total = total;
        job.t.done = total - left;
        job.progress = `${plan.remove ? 'removed' : 'placed'} ${total - left}/${total}`;
        if (s.done) {
          job.noop = first; // done before this run did anything: the event says "already complete"
          return;
        }
        first = false;
        if (s.stuck) throw new Error(s.stuck);
        if (s.wait) {
          stalled(`${s.wait} blocks left that this bot cannot place or reach`);
          job.t.doing = 'waiting for blocks other bots hold';
          await sleep(1000);
          continue;
        }
        const b = s.next;
        const k = ckey(b);
        if (r.world && !(await r.world.claim(r.name, k))) {
          r.conflict?.();
          skip.set(keyOf(b), now + 5000);
          stalled(`${b.block} at ${b.x} ${b.y} ${b.z} is held by another bot`);
          continue;
        }
        try {
          if (plan.remove) {
            guard(job);
            if (await digAt(r, job, new Vec3(b.x, b.y, b.z), (n) => n === b.block)) {
              placed.delete(keyOf(b));
              lastProgress = Date.now();
              continue;
            }
            // Not dug (no answer, or gone): skip it for a while, give up after DIG_TRIES.
            const n = (digFails.get(keyOf(b)) || 0) + 1;
            digFails.set(keyOf(b), n);
            if (n >= DIG_TRIES && nameAt(b.x, b.y, b.z) === b.block) throw new Error(`could not dig ${b.block} at ${b.x} ${b.y} ${b.z} (${n} tries)`);
            skip.set(keyOf(b), Date.now() + 30000);
            continue;
          }
          const at = new Vec3(b.x, b.y, b.z);
          if (s.clear) {
            guard(job);
            await digAt(r, job, at, soft); // GoalPlaceBlock wants the cell empty; only a plant is cleared
          }
          await goNear(r, job, b.x, b.y, b.z, 3, {goal: new goals.GoalPlaceBlock(at, bot.world, {range: 4}), doing: `walking to place ${b.block} at ${b.x} ${b.y} ${b.z}`});
          guard(job);
          const item = bot.inventory.items().find((i) => i.name === b.block);
          if (!item) throw new Error(`ran out of ${b.block}`);
          job.t.doing = `placing ${b.block} at ${b.x} ${b.y} ${b.z}`;
          await bot.equip(item, 'hand');
          guard(job); // a Stop during the walk or the equip must not place anything
          if (nameAt(b.x, b.y, b.z) === b.block) continue; // someone placed it meanwhile
          const [dx, dy, dz] = s.face;
          const against = bot.blockAt(at.offset(dx, dy, dz));
          await bot.placeBlock(against, new Vec3(-dx, -dy, -dz)).catch(() => {}); // 26.x may not echo the update in time
          for (let i = 0; i < 20 && nameAt(b.x, b.y, b.z) !== b.block; i++) await sleep(100);
          if (nameAt(b.x, b.y, b.z) === b.block) {
            placed.add(keyOf(b));
            lastProgress = Date.now();
          } else skip.set(keyOf(b), Date.now() + 30000); // try the others, then again
        } catch (e) {
          guard(job);
          if (!/could not reach/.test(e.message)) throw e;
          skip.set(keyOf(b), Date.now() + 30000);
          stalled(`could not reach ${b.x} ${b.y} ${b.z}`);
        } finally {
          r.world?.release(r.name, k);
        }
      }
    } finally {
      for (const list of [mv.exclusionAreasBreak, mv.exclusionAreasPlace]) {
        const i = list.indexOf(veto);
        if (i >= 0) list.splice(i, 1);
      }
      mv.scafoldingBlocks = scaffold;
    }
  };
}


// ---- Schematic builds (the owner's Litematica files, BOTS.md "Schematic builds"): any size, block
// states and redstone, materials from chests. The world is the progress: a restart resumes where it is.
const fs = require('node:fs');
const path = require('node:path');
const schematicLib = require('./schematic');
const placing = require('./placing');

const SCHEMATIC_RE = /^[\w.-]{1,64}\.litematic$/;
const VEGETATION = /_(log|leaves|wood)$|^(vine|snow|sweet_berry_bush|bamboo|sugar_cane|cactus)$/; // cleared from the site like ground
const RESERVE_SLOTS = 4; // inventory slots a restock leaves free (drops, a tool)
// Floating parts (most of the owner's sorter hangs in the air, 1522 of 1770 cells had no neighbour to
// click) get a pillar of this under them, in cells that are air in the schematic; dirt, so the clear pass
// takes it out again at the end, and after a restart, when the record of the pillars is gone.
const SCAFFOLD = 'dirt';
// A support whose drop would land in a hopper is glass, which drops nothing: dirt and rails fell into the sorter's
// hoppers and went round it into 30 of its containers (sandbox 2026-10-13).
const GLASS = 'glass';
// What a dropped item falls through (no collision box): it comes to rest on the first block below with one.
const FALL_THROUGH = /(^|_)(rail|redstone_wire|torch|button|lever|pressure_plate|sapling|tripwire)$|^(air|cave_air|light|short_grass|tall_grass|fern)$/;
const SCAFFOLD_MAX = 32; // the highest pillar the build puts up (the sorter needs 14 for a hopper at its edge)
const BELOW = {against: [0, -1, 0], face: [0, 1, 0], cursor: null, look: null};
// What does not keep a chest below it shut (vanilla: only a full solid block on top does, isRedstoneConductor).
const OPEN_LID = /hopper|glass|slab|chest|stairs|trapdoor|fence|wall|pane|leaves|composter|lantern|torch|rail|redstone_wire|repeater|comparator|carpet|button|lever|shulker_box/;
// Blocks that pop off when the block they stand on or hang from goes: never propped by a temporary block
// in a schematic cell (taking it out would drop them; a comparator stood on dirt in an observer's cell).
const ATTACHED = /(^|_)(redstone_wire|repeater|comparator|rail|torch|button|lever|carpet|pressure_plate|door|ladder|lantern|bed)$/;

// One parse per file and placement, shared by the bots of this process; so is what they saw in the chests.
const SCHEMATIC_PLANS = new Map();
const CHEST_STOCK = new Map(); // "dim:x,y,z" -> {items: Map(name -> count), t}
function schematicPlan(dir, {file, origin, rotation = 0, mirror = 'none'}) {
  const k = JSON.stringify([file, origin, rotation, mirror]);
  if (!SCHEMATIC_PLANS.has(k)) {
    SCHEMATIC_PLANS.set(k, (async () => {
      const parsed = await schematicLib.parseLitematic(await fs.promises.readFile(path.join(dir, file)));
      const cells = schematicLib.placeSchematic(parsed, {origin, rotation, mirror});
      const {order, deferred, unsupported} = schematicLib.buildOrder(cells);
      const lo = {x: Infinity, y: Infinity, z: Infinity}, hi = {x: -Infinity, y: -Infinity, z: -Infinity};
      for (const c of cells) for (const ax of ['x', 'y', 'z']) { lo[ax] = Math.min(lo[ax], c[ax]); hi[ax] = Math.max(hi[ax], c[ax]); }
      const targets = order.map((t) => ({...t, p: placing.placement(t.name, t.props), late: deferred.has(keyOf(t))}));
      // Containers filled: kept in the state directory, merged with what other processes wrote (the lab runs
      // bot1 and bot2-3 in two), so a restart does not send the crew to every chest again.
      const filledFile = path.join(dir, `.filled-${file}-${origin.x},${origin.y},${origin.z}-${rotation}-${mirror}.json`);
      const readFilled = () => { try { return JSON.parse(fs.readFileSync(filledFile, 'utf8')); } catch { return []; } };
      const filled = new Set(readFilled());
      const saveFilled = () => { try { fs.writeFileSync(filledFile, JSON.stringify([...new Set([...readFilled(), ...filled])])); } catch {} };
      // leave: cells to clear that failed three times, later: chests to fill no bot reached three times;
      // both for the whole crew, until the end
      return {targets, byKey: new Map(targets.map((t) => [keyOf(t), t])), cells: new Set(cells.map(keyOf)), unsupported, lo, hi, leave: new Set(), later: new Set(), filled, saveFilled};
    })().catch((e) => {
      SCHEMATIC_PLANS.delete(k);
      throw e;
    }));
  }
  return SCHEMATIC_PLANS.get(k);
}

const chestKey = (dim, c) => `${dim}:${c.x},${c.y},${c.z}`;
function noteChest(dim, c, win) {
  const items = new Map();
  for (const it of win.containerItems()) items.set(it.name, (items.get(it.name) || 0) + it.count);
  CHEST_STOCK.set(chestKey(dim, c), {items, t: Date.now()});
}

// What a schematic build still needs, {item: count}: the block of every cell not yet as in the schematic
// (two for a double slab) and the contents of a container not yet placed.
function stillNeeded(bot, plan) {
  const need = {};
  const add = (item, n) => { need[item] = (need[item] || 0) + n; };
  for (const t of plan.targets) {
    const b = bot.blockAt(new Vec3(t.x, t.y, t.z));
    if (b && placing.matches(t, {name: b.name, props: b.getProperties()})) continue;
    add(t.p.item, t.p.again ? 2 : 1);
    for (const it of t.items || []) add(it.name, it.count);
  }
  return need;
}

// The summed contents of chests, from what bots saw in the last 10 minutes; a chest not seen is opened.
async function readStock(r, job, chests, {goNear, guard}) {
  const dim = normDim(r.bot.game?.dimension);
  const total = {};
  for (const c of chests) {
    let s = CHEST_STOCK.get(chestKey(dim, c));
    if (!s || Date.now() - s.t > 600000) {
      await goNear(r, job, c.x, c.y, c.z, 3, {doing: `counting the chest at ${c.x} ${c.y} ${c.z}`});
      guard(job);
      const block = r.bot.blockAt(new Vec3(c.x, c.y, c.z));
      if (!block || !/chest|barrel/.test(block.name)) throw new Error(`no chest at ${c.x} ${c.y} ${c.z}`);
      const win = await r.bot.openContainer(block);
      try { noteChest(dim, c, win); } finally { win.close(); }
      s = CHEST_STOCK.get(chestKey(dim, c));
    }
    for (const [n, k] of s.items) total[n] = (total[n] || 0) + k;
  }
  return total;
}
const forgetChest = (dim, c) => CHEST_STOCK.delete(chestKey(dim, c));

// Turn to `look` and click `way` (placing.js) on the cell `t` while sneaking, so a chest or hopper clicked
// is placed against instead of opened. mineflayer 4.39: look(force=true) never sends the turn, and look()
// resolves on the yaw while the pitch follows at 0.15 rad per tick (tools/mcbots-placetest found both).
async function clickFace(bot, t, w, sleep) {
  const ref = bot.blockAt(t.offset(...w.against));
  if (!ref) throw new Error('the block to place against is not loaded');
  const pitch = w.look === 'up' ? Math.PI / 2 : w.look === 'down' ? -Math.PI / 2 : 0;
  const dp = Math.abs(pitch - bot.entity.pitch);
  await bot.look(w.look ? placing.YAW[w.look] ?? bot.entity.yaw : bot.entity.yaw, pitch);
  await bot.waitForTicks(Math.ceil(dp / 0.15) + 2);
  bot.setControlState('sneak', true);
  try {
    await sleep(150);
    await bot._genericPlace(ref, new Vec3(...w.face), {delta: w.cursor ? new Vec3(...w.cursor) : undefined, forceLook: 'ignore'});
    await sleep(150);
  } finally {
    bot.setControlState('sneak', false);
  }
}

function makeSchematic({goNear, guard, sleep, goals, digAt, deposit, natural, dir, waitMs = 5 * WAIT_MS}) {
  // Near enough to click the cell, never standing in it or under it.
  class GoalBeside extends goals.GoalNear {
    constructor(t, range) {
      super(t.x, t.y, t.z, range);
      this.t = t;
    }
    isEnd(node) {
      return super.isEnd(node) && !(node.x === this.t.x && node.z === this.t.z && (node.y === this.t.y || node.y === this.t.y - 1));
    }
  }
  return async function schematic(r, job) {
    const {bot} = r;
    const plan = await schematicPlan(dir, job.args);
    if (plan.unsupported.length) throw new Error(`cannot place ${plan.unsupported.length} blocks yet: ${[...new Set(plan.unsupported.map((u) => u.name))].join(', ')}`);
    for (const t of plan.targets) if (insideAreas(r.protectedAreas, t.x, t.z)) throw new Error(`${t.x} ${t.z} is inside a protected area`);
    const {lo, hi} = plan;
    const chests = job.args.chests || [];
    const dim = normDim(bot.game?.dimension);
    const ckey = (p) => `${dim}:${p.x},${p.y},${p.z}`;
    const v = (p) => new Vec3(p.x, p.y, p.z);
    const stateAt = (x, y, z) => {
      const b = bot.blockAt(new Vec3(x, y, z));
      return b ? {name: b.name, props: b.getProperties()} : null;
    };
    const free = (name) => REPLACEABLE.has(name) || /water|lava/.test(name);
    const placed = recordOf(dim, {blocks: plan.targets.map(keyOf)}); // ours: may be dug again to repair
    const ours = (k, name) => placed.has(k) && plan.byKey.get(k)?.p.item === placing.itemOf(name);
    const clearable = (k, name) => natural.test(name) || VEGETATION.test(name) || ours(k, name) || pillars.has(k);
    // Whether a drop at x,y,z comes to rest in a hopper: in the world now, or (`final`) in the finished build,
    // where a support decides its material.
    const landsInHopper = (x, y, z, final) => {
      for (let b = y - 1; b >= lo.y - 2; b--) {
        const name = final && b >= lo.y ? (plan.byKey.get(`${x},${b},${z}`)?.name ?? 'air') : stateAt(x, b, z)?.name;
        if (name === 'hopper') return true;
        if (!name || !FALL_THROUGH.test(name)) return false;
      }
      return false;
    };
    // The pathfinder may neither break nor place in a cell of the schematic, nor dig under the site or through
    // a support; in the site's air cells it may climb on dirt (19 high: the bots could not get up, 2026-10-13).
    const inSite = (p) => p.x >= lo.x && p.x <= hi.x && p.z >= lo.z && p.z <= hi.z;
    // A bot that found no path twice (walled in by the build, sandbox 2026-10-13) may dig out through plain
    // blocks of the build; the repair puts them back. Never containers, redstone parts or what hangs on them.
    let noPath = 0;
    const PLAIN = /^(stone|cobblestone|glass|target|redstone_lamp|note_block|dirt|stone_slab|smooth_stone_slab|stone_bricks)$/;
    const vetoBreak = (blk) => {
      const k = keyOf(blk.position);
      if (!inSite(blk.position)) return 0;
      if (blk.position.y < lo.y || pillars.has(k)) return 100;
      if (!plan.cells.has(k)) return 0;
      return noPath >= 2 && PLAIN.test(blk.name) ? 0 : 100;
    };
    // Nor on a material chest (it then stays shut: "did not open"), nor where dirt would later fall into a hopper.
    const lidCells = new Set(chests.flatMap((c) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => `${c.x + dx},${c.y + 1},${c.z + dz}`)));
    const vetoPlace = (blk) => {
      const p = blk.position, k = keyOf(p);
      if (lidCells.has(k)) return 100;
      return inSite(p) && (plan.cells.has(k) || landsInHopper(p.x, p.y, p.z, true)) ? 100 : 0;
    };
    // Standing on a low block inside its own cell (a comparator): the pathfinder plans from that cell, finds
    // no move and "moves" until its deadline (two bots stood on one for minutes). After a failed walk the
    // bot takes that block out (picking it up) and the build places it again.
    const unstick = async () => {
      const f = bot.entity.position.floored();
      const b = bot.blockAt(f);
      if (!b || b.boundingBox === 'empty' || !plan.byKey.has(keyOf(f))) return;
      r.emit?.('info', `standing on ${b.name} at ${keyOf(f)}: taking it out to get moving`);
      await digAt(r, job, f, (n) => n === b.name).catch(() => guard(job));
    };
    const mv = bot.pathfinder.movements;
    const scaffold = mv.scafoldingBlocks;
    const skip = new Map(); // key -> until
    const tries = new Map(); // key -> repairs done
    const asIs = new Set(); // rails over a hopper in another shape: not dug (the drop would go into the machine)
    const lacking = new Map(); // item -> until: not in any chest, looked again after 5 min
    const stuck = new Map(); // key -> what is in the way that the bot may not dig
    const pillars = recordOf(dim, {blocks: ['scaffold', ...plan.targets.map(keyOf)]}); // cells holding a support pillar
    const tempFor = new Map(); // a support in a cell of the schematic (a hopper loop) -> the cell that needed it
    let allPlaced = false; // last loop found every cell placed: the pillars come out
    let idle = false; // last loop found nothing to place: the cells left to clear are tried again
    const total = plan.targets.length;
    let lastProgress = Date.now(), lastDone = -1, first = true, final = false;
    const stalled = (what) => {
      if (Date.now() - lastProgress > waitMs) throw new Error(`no progress for ${Math.round(waitMs / 1000)} s: ${what}`);
    };
    const count = () => {
      const have = {};
      for (const it of bot.inventory.items()) have[it.name] = (have[it.name] || 0) + it.count;
      return have;
    };

    // Take up to n of an item from the material chests. Every chest opened is read whole, so the bot goes
    // to chests known to hold the item first, then to ones not seen for 10 minutes (a crew restocks), and
    // never to one seen without it (three bots walked all 57 filler chests for one item, sandbox 2026-10-13).
    const stock = CHEST_STOCK;
    const ckOf = (c) => chestKey(dim, c);
    const forgetChestHere = (c) => CHEST_STOCK.delete(ckOf(c));
    const note = (c, win) => noteChest(dim, c, win);
    const holds = (c, item) => {
      const s = stock.get(ckOf(c));
      return !s || Date.now() - s.t > 600000 ? 0.5 : (s.items.get(item) || 0) > 0 ? 1 : 0;
    };
    async function take(item, n, doing) {
      for (const c of chests.filter((c) => holds(c, item) > 0).sort((a, b) => holds(b, item) - holds(a, item))) {
        if (n - (count()[item] || 0) <= 0) return;
        job.t.doing = doing(n - (count()[item] || 0));
        const block = bot.blockAt(new Vec3(c.x, c.y, c.z));
        if (!block) continue;
        if (!/chest|barrel/.test(block.name)) throw new Error(`no chest at ${c.x} ${c.y} ${c.z} (found ${block.name})`);
        try {
          if (bot.entity.position.offset(0, 1.62, 0).distanceTo(new Vec3(c.x + 0.5, c.y + 0.5, c.z + 0.5)) > 4.5) {
            await goNear(r, job, c.x, c.y, c.z, 3, {doing: `walking to the material chest at ${c.x} ${c.y} ${c.z} for ${item}`});
          }
        } catch (e) {
          guard(job);
          // A chest the bot finds no way to (high up in the build) is tried again later, from elsewhere.
          if (/could not reach/.test(e.message)) {
            noPath++;
            r.emit?.('info', `${e.message.slice(0, 100)}: building on with what it has`);
            await unstick();
            return;
          }
          throw e;
        }
        noPath = 0;
        guard(job);
        let win;
        try {
          win = await bot.openContainer(block);
        } catch (e) {
          guard(job);
          if (!/did not open/.test(e.message)) throw e;
          r.emit?.('info', `the chest at ${c.x} ${c.y} ${c.z} did not open: trying the next one`);
          continue;
        }
        let full = false;
        try {
          note(c, win);
          for (const it of win.containerItems().filter((i) => i.name === item)) {
            guard(job);
            const k = Math.min(n - (count()[item] || 0), it.count);
            if (k <= 0) break;
            try {
              await win.withdraw(it.type, it.metadata, k);
            } catch (e) {
              if (!/full/i.test(e.message)) throw e;
              full = true; // build with what it has, without walking every other chest for nothing
              break;
            }
          }
          note(c, win);
        } finally {
          win.close();
        }
        if (full) return;
      }
    }

    // Room in the inventory: first the container contents, then the rest. Shears
    // count as a tool, so a plain deposit kept them: three bots each held 32 (one a slot) for chests they
    // could not reach and had no slot left for blocks or dirt (sandbox 2026-10-13).
    const FILLS = new Set(plan.targets.flatMap((t) => (t.items || []).map((it) => it.name)));
    const freeSlots = () => 36 - bot.inventory.items().length - RESERVE_SLOTS;
    // Into the first chest with room: the material chest filled up and took 18 of 96 shears (one a slot).
    const fullUntil = new Map(); // chest key -> until: a deposit found it full or out of reach
    async function makeRoom() {
      const spare = new Set(bot.inventory.items().map((it) => it.name).filter((n) => FILLS.has(n)));
      for (const only of [...spare, null]) {
        if (only === null && freeSlots() >= 8) break; // the build blocks it carries stay when that made room
        for (const c of chests.filter((q) => (fullUntil.get(ckOf(q)) || 0) < Date.now()).slice(0, 8)) {
          try {
            await deposit(r, job, c, only);
            break;
          } catch (e) {
            guard(job);
            fullUntil.set(ckOf(c), Date.now() + 600000);
            r.emit?.('info', `could not make room at ${c.x} ${c.y} ${c.z}: ${e.message.slice(0, 80)}`);
          } finally {
            forgetChestHere(c);
          }
        }
      }
    }

    // Fill the inventory with what the next open cells take, from the material chests in order.
    async function restock(want) {
      let slots = freeSlots();
      if (slots < 2 && chests.length) {
        await makeRoom();
        slots = freeSlots();
      }
      const need = new Map();
      let stacks = 0;
      for (const t of plan.targets) {
        const h = stateAt(t.x, t.y, t.z);
        if (!h || placing.matches(t, h) || (lacking.get(t.p.item) || 0) > Date.now()) continue;
        const stack = bot.registry.itemsByName[t.p.item]?.stackSize || 64;
        // At most two stacks of a kind: a crew shares the chests (one bot took 268 of 334 chests, the
        // others then walked all 57 filler chests for one).
        const was = need.get(t.p.item) || 0, n = Math.min(was + (t.p.again ? 2 : 1), 2 * stack);
        const more = Math.ceil(n / stack) - Math.ceil(was / stack);
        if (stacks + more > slots) break;
        stacks += more;
        need.set(t.p.item, n);
      }
      if (!need.has(want)) need.set(want, want === GLASS ? 16 : 1);
      if ((count()[SCAFFOLD] || 0) < 32) need.set(SCAFFOLD, Math.max(need.get(SCAFFOLD) || 0, 64)); // to climb and to prop
      for (const [item, n] of need) {
        await take(item, n, (left) => `taking ${left} ${item} for the build`);
        if (!count()[item]) lacking.set(item, Date.now() + 300000);
      }
    }

    // Put a container's schematic contents in (a sorter's filter items), what is missing by item. Chests and
    // shulker boxes right after they are placed (a solid block on top keeps a chest shut), hoppers, droppers
    // and the rest at the end, once the redstone that locks them stands (else they pass the items on).
    // A double chest is filled for both halves: the window shows both.
    const CW = {north: 'east', east: 'south', south: 'west', west: 'north'}, CCW = {north: 'west', west: 'south', south: 'east', east: 'north'};
    const {filled} = plan;
    const seen = new Map(); // container key -> {item: count} when a bot of this process last had it open
    const contents = (win) => {
      const c = {};
      for (const it of win.containerItems()) c[it.name] = (c[it.name] || 0) + it.count;
      return c;
    };
    const reach = async (t, k) => {
      const eye = bot.entity.position.offset(0, 1.62, 0);
      if (eye.distanceTo(v(t).offset(0.5, 0.5, 0.5)) > 4.5) await goNear(r, job, t.x, t.y, t.z, 4, {goal: new GoalBeside(t, 4), doing: `walking to fill ${t.name} at ${k}`});
      guard(job);
    };
    async function fill(t) {
      const k = keyOf(t);
      const want = new Map();
      const add = (items) => { for (const it of items || []) want.set(it.name, (want.get(it.name) || 0) + it.count); };
      add(t.items);
      const side = {left: CW, right: CCW}[t.props.type]?.[t.props.facing];
      const partner = side && plan.byKey.get(keyOf(v(t).offset(...placing.DIRS[side])));
      if (partner && stateAt(partner.x, partner.y, partner.z)?.props?.type === t.props.type) add(partner.items);
      // A container this process did not place may be full already (filled before a restart, or by a bot of the
      // other process): a look first, instead of fetching 27 shears for it.
      if (!seen.has(k) && !placed.has(k)) {
        await reach(t, k);
        job.t.doing = `looking into ${t.name} at ${k}`;
        const win = await bot.openContainer(bot.blockAt(v(t)));
        try { seen.set(k, contents(win)); } finally { win.close(); }
      }
      for (const [item, n] of want) want.set(item, Math.max(0, n - (seen.get(k)?.[item] || 0)));
      for (const [item, n] of want) if (!n) want.delete(item);
      if (!want.size) {
        filled.add(k);
        plan.saveFilled();
        return;
      }
      // Room first: 27 shears are 27 slots, and a bot full of build blocks carried 9 a trip.
      const stackOf = (item) => bot.registry.itemsByName[item]?.stackSize || 64;
      const slots = [...want].reduce((sum, [item, n]) => sum + Math.ceil(Math.max(0, n - (count()[item] || 0)) / stackOf(item)), 0);
      // All of them, the wanted ones too: 32 shears for a chest of 27 left no slot for the dirt.
      if (freeSlots() < slots + 1 && chests.length) {
        job.t.doing = `making room to fill ${t.name} at ${k}`;
        await makeRoom();
      }
      // Dirt first: the chest may stand high in the build, and without it the walk cannot climb there
      // (six chests 11 up "No path" for every bot). Then the contents, as many as fit beside the reserve.
      if ((count()[SCAFFOLD] || 0) < 16) await take(SCAFFOLD, 32, (left) => `taking ${left} ${SCAFFOLD} to climb to ${t.name} at ${k}`);
      for (const [item, n] of want) {
        const fits = Math.min(n, (count()[item] || 0) + Math.max(0, freeSlots()) * stackOf(item));
        if (fits > 0) await take(item, fits, (left) => `taking ${left} ${item} to fill ${t.name} at ${k}`);
      }
      await reach(t, k);
      job.t.doing = `filling ${t.name} at ${k}`;
      const win = await bot.openContainer(bot.blockAt(v(t)));
      const missing = [];
      try {
        // `want` is net of what was in it at the last look; the window counts again (another bot may have filled).
        const had = seen.get(k) || {};
        for (const [item, n] of want) {
          const have = (contents(win)[item] || 0) - (had[item] || 0);
          const give = Math.min(n - have, count()[item] || 0);
          if (give > 0) await win.deposit(bot.registry.itemsByName[item].id, null, give);
          if (n - have - give > 0) missing.push(`${n - have - give} ${item}`);
        }
        seen.set(k, contents(win));
      } finally {
        win.close();
      }
      if (missing.length) {
        lacking.set(missing[0].split(' ')[1], Date.now() + 300000);
        throw new Error(`missing material to fill ${t.name} at ${k}: ${missing.join(', ')}`);
      }
      filled.add(k);
      plan.saveFilled();
      lastProgress = Date.now();
    }
    const fillsNow = (t) => /(^|_)chest$|shulker_box$/.test(t.name);

    // A rail takes its shape from the rails beside it when it is placed, and keeps it when they go (vanilla
    // RailState, checked with setblock in the sandbox 2026-10-13); a rail placed later beside it bends it, if it
    // has a free end. The sorter's curves stand in straight lines with air on their curved side, so a plain
    // repair placed them straight again. Here: the rails on its other sides come out, a temporary rail stands on
    // each wanted side without one, the rail goes in, the others go back while the temporaries still stand,
    // then the temporaries come out. One bot does it all, holding the cells.
    const SIDES = {north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0]};
    const railAt = (p) => /rail$/.test(stateAt(p.x, p.y, p.z)?.name || '');
    async function put(c) {
      const w = c.p.ways.find((q) => solid(stateAt(c.x + q.against[0], c.y + q.against[1], c.z + q.against[2])?.name));
      if (!w) throw new Error(`nothing to click for ${c.name} at ${keyOf(c)}`);
      if (!count()[c.p.item]) await take(c.p.item, 2, (left) => `taking ${left} ${c.p.item} to reshape a rail`);
      const item = bot.inventory.items().find((i) => i.name === c.p.item);
      if (!item) throw new Error(`missing material to reshape a rail: ${c.p.item}`);
      const eye = bot.entity.position.offset(0, 1.62, 0);
      if (eye.distanceTo(v(c).offset(w.against[0] + 0.5, w.against[1] + 0.5, w.against[2] + 0.5)) > 4.5) {
        await goNear(r, job, c.x, c.y, c.z, 4, {goal: new GoalBeside(c, 4), doing: `walking to place ${c.name} at ${keyOf(c)}`});
      }
      guard(job);
      await bot.equip(item, 'hand');
      guard(job);
      await clickFace(bot, v(c), w, sleep);
      for (let i = 0; i < 10 && stateAt(c.x, c.y, c.z)?.name !== c.name; i++) await sleep(100);
      if (stateAt(c.x, c.y, c.z)?.name !== c.name) throw new Error(`placing ${c.name} at ${keyOf(c)} did not take`);
    }
    // -> true reshaped, null not now (cells held, a step failed: tried again later), false not this way.
    async function reshapeRail(t) {
      const want = String(t.props.shape || '').split('_');
      if (want.length !== 2 || !want.every((d) => SIDES[d])) return false; // ascending: the plain repair
      const side = (d) => v(t).offset(...SIDES[d]);
      const others = Object.keys(SIDES).filter((d) => !want.includes(d) && railAt(side(d))).map((d) => plan.byKey.get(keyOf(side(d))));
      if (others.some((o) => !o)) return false; // a rail that is not the build's
      if ([t, ...others].some((c) => landsInHopper(c.x, c.y, c.z, false))) return false;
      const temps = [], lift = []; // lift: build blocks standing where a temporary rail must go, placed again later
      for (const d of want.filter((d) => !railAt(side(d)))) {
        const p = side(d), h = stateAt(p.x, p.y, p.z);
        if (bot.blockAt(p.offset(0, -1, 0))?.boundingBox !== 'block' || landsInHopper(p.x, p.y, p.z, false)) return false; // a full block under it, not a hopper
        if (h && !free(h.name)) {
          if (!ours(keyOf(p), h.name) || landsInHopper(p.x, p.y, p.z, false)) return false;
          lift.push(p);
        }
        temps.push({x: p.x, y: p.y, z: p.z, name: 'rail', props: {}, p: placing.placement('rail', {shape: 'north_south'})});
      }
      const cells = [t, ...others, ...temps];
      const keys = cells.map(ckey);
      const held = [];
      try {
        for (const k of keys) {
          if (r.world && !(await r.world.claim(r.name, k))) return null;
          held.push(k);
        }
        job.t.doing = `reshaping ${t.name} at ${keyOf(t)} to ${t.props.shape}`;
        for (const c of [...others, t]) await digAt(r, job, v(c), (n) => n === c.name);
        for (const p of lift) await digAt(r, job, p, null);
        for (const c of [...temps, t, ...others]) await put(c);
        return placing.matches(t, stateAt(t.x, t.y, t.z) || {name: '?'}, {final: true}) || null;
      } finally {
        for (const c of temps) if (railAt(c)) await digAt(r, job, v(c), (n) => n === 'rail').catch(() => guard(job));
        for (const k of held) r.world?.release(r.name, k);
      }
    }

    try {
      mv.exclusionAreasBreak.push(vetoBreak);
      mv.exclusionAreasPlace.push(vetoPlace);
      const wanted = new Set(plan.targets.map((t) => bot.registry.itemsByName[t.p.item]?.id));
      // Climb and bridge with dirt only, never the build's material: dirt in an air cell comes out at the end, while
      // the cobblestone the pathfinder also uses stayed in the sorter's air cells as the owner's (sandbox 2026-10-13).
      mv.scafoldingBlocks = [bot.registry.itemsByName[SCAFFOLD].id].filter((id) => !wanted.has(id));
      for (;;) {
        guard(job);
        const now = Date.now();
        for (const [k, until] of skip) if (until < now) skip.delete(k);
        // Far away (after a respawn at world spawn): walk to the site first, it is not even loaded.
        const cx = Math.floor((lo.x + hi.x) / 2), cz = Math.floor((lo.z + hi.z) / 2);
        if (!bot.blockAt(new Vec3(cx, lo.y, cz))) {
          await goNear(r, job, cx, lo.y, cz, 8, {doing: `walking to the build site at ${cx} ${lo.y} ${cz}`}).catch((e) => {
            guard(job);
            if (!/could not reach/.test(e.message)) throw e; // a long way goes in legs: the next loop walks on
          });
          continue;
        }
        // 1. The site, top down: ground, trees and wrong blocks of ours come out of cells that are air
        // in the schematic or hold another block there. Anything else is the owner's: reported, never dug.
        // Each bot takes the cell of the top layer nearest to it, so a crew spreads out (in scan order all
        // three queued for the same block and cleared 2-3 a minute, sandbox 2026-10-13).
        let clear = null;
        stuck.clear();
        const me = bot.entity.position;
        for (let y = hi.y; y >= lo.y - 1 && !clear; y--) {
          let best = Infinity;
          for (let z = lo.z - 1; z <= hi.z + 1; z++) {
            for (let x = lo.x - 1; x <= hi.x + 1; x++) {
              const k = `${x},${y},${z}`;
              // Next to the site and under it only the build's own supports come out, at the end.
              if ((!inSite({x, z}) || y < lo.y) && !(allPlaced && pillars.has(k))) continue;
              const h = stateAt(x, y, z);
              if (!h || free(h.name) || skip.has(k) || (plan.leave.has(k) && !allPlaced && !idle)) continue;
              const t = plan.byKey.get(k);
              if (t ? h.name === t.name : plan.cells.has(k)) continue; // the right block (its state is the build's job), a piston head
              // A pillar stays until all is placed; a support in a cell of the schematic only until the cell that
              // needed it stands (then the real block goes there).
              const req = tempFor.get(k), reqT = req && plan.byKey.get(req);
              if (pillars.has(k) && !allPlaced && !(reqT && placing.matches(reqT, stateAt(reqT.x, reqT.y, reqT.z) || {name: '?'}))) continue;
              if (!t && h.name === SCAFFOLD && !allPlaced) continue; // dirt in an air cell: a support or a climb, out at the end
              if (!clearable(k, h.name)) { stuck.set(k, h.name); continue; }
              if (h.name !== GLASS && landsInHopper(x, y, z, false)) { stuck.set(k, `${h.name} over a hopper`); continue; }
              // A cell with a free side first: an inner cell shows only its top, which the walk cannot reach
              // from below and ran into its timeout for every block. The rest opens up from the edges.
              const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => free(stateAt(x + dx, y, z + dz)?.name ?? 'stone'));
              const d = (x + 0.5 - me.x) ** 2 + (y + 0.5 - me.y) ** 2 + (z + 0.5 - me.z) ** 2 + (side ? 0 : 1e6);
              if (d < best) { best = d; clear = {x, y, z, name: h.name, k}; }
            }
          }
        }
        if (clear) {
          const k = ckey(clear);
          if (r.world && !(await r.world.claim(r.name, k))) { skip.set(clear.k, now + 5000); continue; }
          try {
            job.t.doing = `clearing ${clear.name} at ${clear.x} ${clear.y} ${clear.z} from the build site`;
            // A support taken out of a schematic cell may drop what it held: those drops are picked up.
            if (await digAt(r, job, v(clear), (n) => n === clear.name, {pickup: plan.byKey.has(clear.k)})) { placed.delete(clear.k); pillars.delete(clear.k); tempFor.delete(clear.k); lastProgress = Date.now(); }
            else skip.set(clear.k, Date.now() + 30000);
          } catch (e) {
            guard(job);
            if (!/^unsafe: |could not reach|Digging aborted|needs a tool/.test(e.message)) throw e;
            // Three failed tries: left until the end (walled in by the build, it searched for minutes).
            const n = (tries.get(clear.k) || 0) + 1;
            tries.set(clear.k, n);
            skip.set(clear.k, Date.now() + 30000);
            if (n >= 3) plan.leave.add(clear.k);
            stalled(`could not clear ${clear.name} at ${clear.x} ${clear.y} ${clear.z}: ${e.message.slice(0, 80)}`);
          } finally {
            r.world?.release(r.name, k);
          }
          continue;
        }
        // 2a. A placed chest still to fill comes first, over several trips when the bot cannot carry it all
        // (27 shears take 27 slots); nothing goes on top of it meanwhile (it would keep the chest shut).
        const lids = new Set();
        let pending = null;
        for (const t of plan.targets) {
          if (!t.items || !fillsNow(t) || filled.has(keyOf(t))) continue;
          const h = stateAt(t.x, t.y, t.z);
          if (!h || !placing.matches(t, h)) continue;
          lids.add(`${t.x},${t.y + 1},${t.z}`);
          if (!pending && !skip.has(keyOf(t)) && (!plan.later.has(keyOf(t)) || idle)) pending = t;
        }
        if (pending) {
          const fk = `fill:${keyOf(pending)}`; // one bot per chest (two would both put in what is missing); the hub's key format
          if (r.world && !(await r.world.claim(r.name, fk))) {
            skip.set(keyOf(pending), Date.now() + 5000);
            continue;
          }
          try {
            await fill(pending);
          } catch (e) {
            guard(job);
            if (!/^missing material|could not reach|did not open/.test(e.message)) throw e;
            if (/could not reach/.test(e.message)) {
              noPath++;
              await unstick();
              // Three times out of reach: left until the end, when the crew has nothing else to do.
              const n = (tries.get(fk) || 0) + 1;
              tries.set(fk, n);
              if (n >= 3) plan.later.add(keyOf(pending));
            }
            skip.set(keyOf(pending), Date.now() + 60000);
            r.emit?.('info', e.message.slice(0, 160));
          } finally {
            r.world?.release(r.name, fk);
          }
          continue;
        }
        // 2. The next cell to place: in build order, with something to click and the item at hand or in a
        // chest. The deferred ones (power, observers, pistons) wait while an earlier cell is merely held.
        let open = 0, held = 0, next = null, above = null, late = null, repair = null, nextScore = Infinity;
        const me2 = bot.entity.position;
        const carried = count();
        const waiting = new Set();
        // Layer by layer: only the lowest open layer and the two above it, with supports for them before
        // anything higher, so the crew grows up with the build (it built a dropper tower to y 17 first and
        // then searched minutes for a way up from the chests, sandbox 2026-10-13).
        let low = Infinity;
        for (const t of plan.targets) {
          if (t.y >= low || t.late || skip.has(keyOf(t)) || stuck.has(keyOf(t)) || (lacking.get(t.p.item) || 0) > Date.now()) continue;
          const h = stateAt(t.x, t.y, t.z);
          if (h && !placing.matches(t, h, {final})) low = t.y;
        }
        const band = (t) => t.y <= low + 2;
        for (const t of plan.targets) {
          const k = keyOf(t);
          const h = stateAt(t.x, t.y, t.z);
          if (h && (placing.matches(t, h, {final}) || (asIs.has(k) && h.name === t.name))) continue;
          open++;
          if (!h || stuck.has(k)) continue;
          if (skip.has(k)) { held++; continue; }
          if (h.name === t.name) { // the right block in a wrong state (facing, rail shape): dig it, then place it again
            if (!repair && (tries.get(k) || 0) < 3) repair = t;
            continue;
          }
          if (!free(h.name) || (lids.has(k) && !OPEN_LID.test(t.name))) continue;
          if (t.late && held) continue; // power last: not while an ordinary cell is only held by another bot
          if ((lacking.get(t.p.item) || 0) > Date.now()) { waiting.add(t.p.item); continue; }
          const w = t.p.ways.find((w) => solid(stateAt(t.x + w.against[0], t.y + w.against[1], t.z + w.against[2])?.name));
          // The lowest layer first, in it a cell whose block the bot carries, the nearest (less walking and
          // fetching, and a crew spreads out).
          const score = t.y * 1e5 + (carried[t.p.item] ? 0 : 5e4) + (t.x - me2.x) ** 2 + (t.y - me2.y) ** 2 + (t.z - me2.z) ** 2;
          if (w && t.late) late ??= {t, w};
          else if (w && band(t) && score < nextScore) { next = {t, w}; nextScore = score; }
          else if (w && !band(t)) above ??= {t, w};
        }
        // 3. No ordinary cell to click: a pillar under the open cell that needs the shortest one (only cells
        // that can be placed on the block below, only through air cells of the schematic, down to a solid
        // block). Power sources, observers and pistons come after that, and get pillars last.
        // How to make an air cell of the schematic solid with dirt: one block against a solid neighbour, else
        // a pillar from the solid block below it. {x, y, z, w, height} of the first dirt block, or null.
        const airCell = (x, y, z) => !plan.cells.has(`${x},${y},${z}`) && free(stateAt(x, y, z)?.name ?? 'stone');
        // In a cell of the schematic not yet placed only one block against a neighbour, and only when nothing
        // else helps (a closed hopper loop: each hopper needs the next one standing).
        const supportAt = (x, y, z) => {
          const inPlan = plan.byKey.has(`${x},${y},${z}`) && free(stateAt(x, y, z)?.name ?? 'stone');
          if (!airCell(x, y, z) && !inPlan) return null;
          for (const f of FACES) {
            if (solid(stateAt(x + f[0], y + f[1], z + f[2])?.name)) return {x, y, z, w: {against: f, face: f.map((n) => -n), cursor: null, look: null}, height: inPlan ? 50 : 1};
          }
          if (inPlan) return null;
          let b = y - 1;
          while (b > y - SCAFFOLD_MAX && airCell(x, b, z)) b--;
          return solid(stateAt(x, b, z)?.name) ? {x, y: b + 1, z, w: BELOW, height: y - b} : null;
        };
        const pillarFor = (lateOnes, inBand = true) => {
          let best = null;
          for (const t of plan.targets) {
            const k = keyOf(t);
            if (t.late !== lateOnes || stuck.has(k) || skip.has(k) || (inBand && !band(t))) continue;
            const h = stateAt(t.x, t.y, t.z);
            if (!h || placing.matches(t, h, {final}) || !free(h.name)) continue;
            for (const w of t.p.ways) {
              const c = {x: t.x + w.against[0], y: t.y + w.against[1], z: t.z + w.against[2]};
              // The block to click is a deferred cell (an observer under a comparator): place it now instead.
              const ct = plan.byKey.get(keyOf(c));
              if (ct?.late && !skip.has(keyOf(c)) && free(stateAt(c.x, c.y, c.z)?.name ?? 'stone')) {
                const cw = ct.p.ways.find((u) => solid(stateAt(c.x + u.against[0], c.y + u.against[1], c.z + u.against[2])?.name));
                if (cw && (!best || best.height > 0)) best = {real: {t: ct, w: cw}, height: 0};
                continue;
              }
              if (ct && ATTACHED.test(t.name)) continue;
              const sup = supportAt(c.x, c.y, c.z);
              if (sup && !skip.has(`${sup.x},${sup.y},${sup.z}`) && (!best || sup.height < best.height)) best = {...sup, for: k};
            }
          }
          if (best?.real) return best.real;
          const item = best && landsInHopper(best.x, best.y, best.z, true) ? GLASS : SCAFFOLD;
          return best && {t: {x: best.x, y: best.y, z: best.z, name: item, props: {}, p: {item, check: [], ways: [best.w]}, pillar: true, for: best.for}, w: best.w};
        };
        next ??= pillarFor(false) || above || pillarFor(false, false) || late || pillarFor(true, false);
        if (next?.t.pillar && !count()[next.t.p.item]) {
          await restock(next.t.p.item);
          if (!count()[next.t.p.item]) { waiting.add(next.t.p.item); next = null; }
        }
        allPlaced = !open;
        idle = !next && !repair;
        if (total - open !== lastDone) { lastDone = total - open; lastProgress = Date.now(); } // the crew's progress counts, not just this bot's
        job.t.total = total;
        job.t.done = total - open;
        job.progress = `placed ${total - open}/${total}${final ? ' (final check)' : ''}`;
        if (!open) {
          if (!final) { final = true; continue; } // all placed: check rail shapes and double chests once more
          const unfilled = plan.targets.filter((t) => t.items && !filled.has(keyOf(t)) && !skip.has(keyOf(t)));
          if (unfilled.length) {
            const t = unfilled.find((u) => !fillsNow(u)) || unfilled[0];
            try {
              await fill(t);
            } catch (e) {
              guard(job);
              skip.set(keyOf(t), Date.now() + 60000);
              r.emit?.('info', e.message.slice(0, 160));
              stalled(e.message); // a chest no bot reaches ends the job too, not only missing material
            }
            continue;
          }
          job.noop = first;
          if (asIs.size) r.emit?.('info', `schematic done; ${asIs.size} rails over hoppers keep another shape (no cart runs there): ${[...asIs].slice(0, 4).join(' ')}`);
          if (stuck.size) r.emit?.('info', `schematic done; ${stuck.size} cells in the way were left (not ours): ${[...stuck].slice(0, 3).map(([k, n]) => `${n} at ${k}`).join(', ')}`);
          return;
        }
        first = false;
        if (!next && repair) {
          const k = keyOf(repair);
          if (landsInHopper(repair.x, repair.y, repair.z, false)) { // its drop (and contents) would go round the machine
            // A rail there carries no cart (the sorter's covers on its hoppers): left in its shape and reported, so the
            // build goes on to its end fills. Anything else stays wrong for the final check to name.
            if (/rail$/.test(repair.name)) asIs.add(k);
            else tries.set(k, 3);
            r.emit?.('info', `not repairing ${repair.name} at ${k}: it stands over a hopper, its drop would go into the machine`);
            continue;
          }
          tries.set(k, (tries.get(k) || 0) + 1);
          if (/rail$/.test(repair.name)) {
            const ok = await reshapeRail(repair).catch((e) => {
              guard(job);
              if (!/could not reach|unsafe|aborted|needs a tool|missing material|did not take|nothing to click/.test(e.message)) throw e;
              r.emit?.('info', `reshaping ${repair.name} at ${k}: ${e.message.slice(0, 120)}`);
              return null;
            });
            if (ok) lastProgress = Date.now();
            else if (ok === null) skip.set(k, Date.now() + 30000);
            if (ok !== false) continue;
          }
          job.t.doing = `taking out ${repair.name} at ${k} to place it again`;
          if (await digAt(r, job, v(repair)).catch((e) => { guard(job); if (!/could not reach|unsafe|aborted|needs a tool/.test(e.message)) throw e; return false; })) lastProgress = Date.now();
          else skip.set(k, Date.now() + 30000);
          continue;
        }
        if (!next) {
          if (final && !held) {
            const left = plan.targets.filter((t) => !asIs.has(keyOf(t)) && !placing.matches(t, stateAt(t.x, t.y, t.z) || {name: '?'}, {final: true}));
            throw new Error(`${left.length} cells are still not as in the schematic, e.g. ${left.slice(0, 3).map((t) => `${t.name} ${JSON.stringify(t.props)} at ${keyOf(t)}`).join('; ')}`);
          }
          const why = waiting.size ? `waiting for material: ${[...waiting].join(', ')}` : stuck.size ? `in the way: ${[...stuck].slice(0, 3).map(([k, n]) => `${n} at ${k}`).join(', ')}` : `${open} cells left that this bot cannot place or reach`;
          job.t.doing = why;
          stalled(why);
          await sleep(1000);
          continue;
        }
        const {t, w} = next;
        const k = keyOf(t);
        if (!bot.inventory.items().some((i) => i.name === t.p.item)) {
          await restock(t.p.item);
          continue; // what is open may have changed during the walk
        }
        const ck = ckey(t);
        if (r.world && !(await r.world.claim(r.name, ck))) {
          r.conflict?.();
          skip.set(k, now + 5000);
          continue;
        }
        try {
          // The server takes a click up to its reach (4.5) plus a margin from the eyes: no walk when the block to
          // click is that near (the walk into a dense site searched for minutes, sandbox 2026-10-13).
          const feet = bot.entity.position.floored();
          const inCell = feet.x === t.x && feet.z === t.z && (feet.y === t.y || feet.y === t.y - 1);
          const eye = bot.entity.position.offset(0, 1.62, 0);
          if (inCell || eye.distanceTo(v(t).offset(w.against[0] + 0.5, w.against[1] + 0.5, w.against[2] + 0.5)) > 4.5) {
            await goNear(r, job, t.x, t.y, t.z, 4, {goal: new GoalBeside(t, 4), doing: `walking to place ${t.name} at ${k}`});
            noPath = 0;
          }
          guard(job);
          const item = bot.inventory.items().find((i) => i.name === t.p.item);
          if (!item) continue;
          await bot.equip(item, 'hand');
          guard(job); // a Stop during the walk or the equip must not place anything
          if (!free(stateAt(t.x, t.y, t.z)?.name ?? 'stone')) continue; // someone placed something meanwhile
          job.t.doing = `placing ${t.name} at ${k}`;
          await clickFace(bot, v(t), w, sleep);
          if (t.p.again) {
            for (let i = 0; i < 10 && stateAt(t.x, t.y, t.z)?.name !== t.name; i++) await sleep(100);
            await clickFace(bot, v(t), t.p.again, sleep);
          }
          for (let i = 0; i < 10 && stateAt(t.x, t.y, t.z)?.name !== t.name; i++) await sleep(100);
          if (t.p.cycle && stateAt(t.x, t.y, t.z)?.name === t.name) {
            const {prop, values} = t.p.cycle;
            const goal = values.indexOf(String(t.props[prop] ?? values[0]));
            for (let i = 0; i < values.length; i++) {
              const cur = values.indexOf(String(stateAt(t.x, t.y, t.z)?.props?.[prop]));
              if (cur < 0 || cur === goal) break;
              guard(job);
              await bot.activateBlock(bot.blockAt(v(t)));
              await sleep(250);
            }
          }
          const h = stateAt(t.x, t.y, t.z);
          if (t.pillar) {
            if (h?.name === t.name) {
              pillars.add(k);
              if (plan.byKey.has(k)) tempFor.set(k, t.for);
              lastProgress = Date.now();
            } else skip.set(k, Date.now() + 30000);
            continue;
          }
          if (h?.name === t.name) placed.add(k);
          if (h && placing.matches(t, h)) {
            lastProgress = Date.now();
            // a chest with contents is filled by the next loop (2a), before anything goes on top
          }
          else skip.set(k, Date.now() + 30000); // try the others, then again (or dig it out: the repair)
        } catch (e) {
          guard(job);
          if (!/could not reach/.test(e.message)) throw e;
          noPath++;
          await unstick();
          skip.set(k, Date.now() + 30000);
          stalled(`could not reach ${k}`);
        } finally {
          r.world?.release(r.name, ck);
        }
      }
    } finally {
      for (const [list, veto] of [[mv.exclusionAreasBreak, vetoBreak], [mv.exclusionAreasPlace, vetoPlace]]) {
        const i = list.indexOf(veto);
        if (i >= 0) list.splice(i, 1);
      }
      mv.scafoldingBlocks = scaffold;
      bot.setControlState('sneak', false);
    }
  };
}

module.exports = {validate, step, removeStep, materials, shortfall, formatShortfall, countHave, gatherPlan, GATHER, makeBuild, MAX_BLOCKS, PLANTS, RECORDS,
  makeSchematic, schematicPlan, clickFace, SCHEMATIC_RE, stillNeeded, readStock, forgetChest};
