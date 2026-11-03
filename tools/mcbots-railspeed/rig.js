'use strict';
// The pure parts of the highway surface measurement: console commands for a test lane, and what a run's samples say.
const SPEEDS = [8, 20, 40, 72, 100, 150, 200, 400, 1000];
const SPACINGS = [2, 4, 8, 16, 38];
const SWEEP_LANE = {x1: 300, x2: 2300, y: 200, z: 10};
const MAX_FORCED = 256; // chunks in one forceload command
const MAX_FILL = 32768; // blocks in one fill command
const MAX_LINE = 1400; // characters in one console command

// One forced row of chunks has to hold the lane's walls too, or a fill there is refused as unloaded.
function row(lane) {
  if ((lane.z - 2) >> 4 !== (lane.z + 2) >> 4) throw new Error(`lane z ${lane.z}: z-2 to z+2 crosses a chunk row`);
  return lane;
}

function forced(verb, {x1, x2, z}) {
  const out = [];
  for (let x = x1; x <= x2;) {
    const end = Math.min(x2, ((x >> 4) + MAX_FORCED) * 16 - 1);
    out.push(`forceload ${verb} ${x} ${z} ${end} ${z}`);
    x = end + 1;
  }
  return out;
}

const railLane = (lane) => {
  const {x1, x2, y, z} = row(lane);
  // A wall at each end: a cart bounces off a wall and rolls back at full speed, and outside the forced chunks no kill can reach it.
  const wall = (x) => `fill ${x} ${y} ${z} ${x} ${y + 1} ${z} stone`;
  return [...forced('add', lane), `fill ${x1} ${y - 1} ${z} ${x2} ${y - 1} ${z} stone`, `fill ${x1} ${y} ${z} ${x2} ${y} ${z} rail[shape=east_west]`, wall(x2 + 1), wall(x1 - 1)];
};

function powerEvery({x1, x2, y, z}, spacing) {
  const out = [];
  for (let x = x1; x <= x2; x += spacing) out.push(`setblock ${x} ${y - 1} ${z} redstone_block`, `setblock ${x} ${y} ${z} powered_rail[shape=east_west,powered=true]`);
  return out;
}

// Both tagged: killing a cart leaves its rider standing in the air otherwise. Occupied, because an empty cart brakes harder.
const launch = ({x1, y, z}, tag = 'rs') => [
  `kill @e[tag=${tag}]`,
  `summon minecart ${x1 + 1.5} ${y + 0.1} ${z + 0.5} {Tags:["${tag}"],Motion:[1.0,0.0,0.0],Passengers:[{id:"minecraft:armor_stand",Tags:["${tag}"]}]}`,
];

function iceLane(lane, width) {
  const {x1, x2, y, z} = row(lane);
  const wall = (at) => `fill ${x1} ${y} ${at} ${x2} ${y + 1} ${at} stone_bricks`;
  const end = (z1, z2) => `fill ${x2 + 1} ${y} ${z1} ${x2 + 1} ${y + 1} ${z2} stone_bricks`;
  if (width === 2) return [...forced('add', lane), `fill ${x1} ${y - 1} ${z} ${x2} ${y - 1} ${z + 1} blue_ice`, wall(z - 1), wall(z + 2), end(z - 2, z + 2)];
  if (width === 1) return [...forced('add', lane), `fill ${x1} ${y - 1} ${z} ${x2} ${y - 1} ${z} blue_ice`, wall(z - 2), wall(z + 2), end(z - 2, z + 2)];
  throw new Error(`ice lane width ${width}: only 1 or 2`);
}

const setSpeed = (n) => `gamerule max_minecart_speed ${n}`;

function clearLane(lane, tag = 'rs') {
  const {x1, x2, y, z} = row(lane);
  const out = [`kill @e[tag=${tag}]`];
  const step = Math.floor(MAX_FILL / (3 * 5)); // y-1 to y+1, z-2 to z+2
  for (let x = x1 - 1; x <= x2 + 1; x += step) out.push(`fill ${x} ${y - 1} ${z - 2} ${Math.min(x2 + 1, x + step - 1)} ${y + 1} ${z + 2} air`);
  return [...out, ...forced('remove', lane)];
}

function batches(commands, max = 64) {
  const out = [];
  for (let i = 0; i < commands.length; i += max) out.push(commands.slice(i, i + max));
  for (const c of commands) if (c.length > MAX_LINE) throw new Error(`console command over ${MAX_LINE} characters: ${c.slice(0, 60)}`);
  return out;
}

function parseSample(replies) {
  const text = replies.join('\n').replace(/§./g, '');
  const time = /The game time is (\d+)/.exec(text);
  const pos = /entity data: \[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(text);
  if (!time || !pos) return null;
  const [x, y, z] = pos.slice(1).map(Number);
  return [x, y, z].every(Number.isFinite) ? {tick: Number(time[1]), x, y, z} : null;
}

const MIN_TICKS = 20; // a tick of jitter between two close samples must not read as a burst of speed

function summarize(samples, lane) {
  const seen = [];
  let derailed = false, reachedEnd = false, lost = samples.length === 0;
  for (const s of samples) {
    if (!s) { lost = true; break; }
    const onLane = Math.abs(s.y - lane.y) <= 1.5 && Math.abs(s.z - (lane.z + 0.5)) <= 1;
    // At the end wall by now, or already bounced off it between two samples: either way this sample is no speed.
    if (s.x >= lane.x2 - 1 || (Number.isFinite(lane.x2) && seen.length && s.x < seen.at(-1).x - 1)) {
      reachedEnd = true;
      break;
    }
    if (!onLane) { derailed = true; break; }
    seen.push(s);
  }
  const speeds = [];
  for (let i = 0; i < seen.length; i++) {
    const later = seen.slice(i + 1).find((s) => s.tick - seen[i].tick >= MIN_TICKS);
    if (later) speeds.push(((later.x - seen[i].x) / (later.tick - seen[i].tick)) * 20);
  }
  const last = speeds.slice(-Math.ceil(speeds.length / 3)).sort((a, b) => a - b);
  const [a, b] = [seen[0], seen.at(-1)];
  return {
    top: speeds.length ? Math.max(...speeds) : null,
    sustained: !speeds.length || derailed || lost ? null : last[Math.floor(last.length / 2)],
    tps: a && b.wall > a.wall ? ((b.tick - a.tick) / (b.wall - a.wall)) * 1000 : null,
    derailed,
    reachedEnd,
    lost,
  };
}

module.exports = {SPEEDS, SPACINGS, SWEEP_LANE, railLane, powerEvery, launch, iceLane, setSpeed, clearLane, batches, parseSample, summarize};
