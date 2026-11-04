#!/usr/bin/env node
'use strict';
// Measures the highway surface on the SANDBOX server, over the dashboard's console, which can never reach the real one.
// Usage (laptop, tailnet):
//   node run.js sweep [--speed a,b --spacing c,d]   rail at each setting, results in ~/.local/state/mcbots/railspeed.jsonl
//   node run.js rig rail <speed> <spacing>      5 km ride lane at z 40 from x 300, rule set to <speed>
//   node run.js rig ice2 | rig ice1             5 km blue ice lane at z 50 | z 60
//   node run.js rig dip <speed>                 5 km lane with dips at z 70, rule set to <speed>
//   node run.js unrig                           takes all ride lanes away, rule back to 8
//   node run.js track <player> [seconds]        a player's speed, results in railspeed-track.jsonl
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {SPEEDS, SPACINGS, SWEEP_LANE, railLane, powerEvery, dipEvery, launch, iceLane, setSpeed, clearLane, batches, parseSample, summarize} = require('./rig');

const RUN_MS = 150000; // at 8 m/s a cart covers 1200 m of the lane in this time, which is enough for a speed
const SAMPLE_MS = 500;
const DIP_RAMP = 300, DIP_BOOST = 4, DIP_EVERY = 16; // measured: 75 boosters are enough for the dips to take over
const WORLD_SPEED = 8;
const RIDE_LANES = {rail: {x1: 300, x2: 5300, y: 200, z: 40}, ice2: {x1: 300, x2: 5300, y: 200, z: 50}, ice1: {x1: 300, x2: 5300, y: 200, z: 60}, dip: {x1: 300, x2: 5300, y: 200, z: 70}};
// What the console answers when a command did nothing. A lane with a gap would read as a derail at that speed.
const REFUSED = /not loaded|Incorrect argument|Unknown|Too many|Expected|Invalid|Can't/i;
// Something to stand on and something to board at a ride lane's start. Tagged, so that taking the lane away takes these too.
function boarding({x1, y, z}, kind) {
  if (kind === 'rail' || kind === 'dip') return [`fill ${x1} ${y - 1} ${z + 1} ${x1 + 4} ${y - 1} ${z + 2} stone`, `summon minecart ${x1 + 2.5} ${y + 0.1} ${z + 0.5} {Tags:["rslane"]}`];
  const wide = kind === 'ice2';
  return [`fill ${x1 - 4} ${y - 1} ${z} ${x1 - 1} ${y - 1} ${wide ? z + 1 : z} stone`, `summon oak_boat ${x1 + 1} ${y} ${wide ? z + 1 : z + 0.5} {Tags:["rslane"],Rotation:[-90.0f,0.0f]}`];
}
const isForce = (c) => c.startsWith('forceload');
const free = (lane) => railLane(lane).filter(isForce).map((c) => c.replace('forceload add', 'forceload remove'));

async function send(call, commands) {
  const replies = [];
  for (const batch of batches(commands)) {
    const got = await call(batch);
    got.forEach((r, i) => { if (REFUSED.test(r)) throw new Error(`refused: ${batch[i].slice(0, 80)}: ${r.slice(0, 200)}`); });
    replies.push(...got);
  }
  return replies;
}

async function waitLoaded(call, sleep, {x1, x2, y, z}) {
  const probes = [];
  for (let x = x1; x < x2; x += 160) probes.push(`execute if loaded ${x} ${y} ${z}`);
  probes.push(`execute if loaded ${x2} ${y} ${z}`);
  for (let i = 0; i < 120; i++) {
    if ((await send(call, probes)).every((r) => /Test passed/.test(r))) return;
    await sleep(1000);
  }
  throw new Error(`lane chunks not loaded after 120 s: ${x1}..${x2} at z ${z}`);
}

async function lay(call, sleep, lane, commands) {
  await send(call, commands.filter(isForce));
  await waitLoaded(call, sleep, lane);
  await send(call, commands.filter((c) => !isForce(c)));
}

async function follow({call, selector, lane, ms, now, sleep, each = () => {}}) {
  const samples = [], start = now();
  for (;;) {
    const s = parseSample(await call(['time query gametime', `data get entity ${selector} Pos`]));
    samples.push(s && {...s, wall: now()});
    if (s) each(samples.at(-1));
    const sum = summarize(samples, lane);
    if (sum.lost || sum.derailed || sum.reachedEnd || now() - start >= ms) return sum;
    await sleep(SAMPLE_MS);
  }
}

async function sweep({call, out, now, sleep, done = new Set(), speeds = SPEEDS, spacings = SPACINGS, warn = console.error}) {
  const lane = SWEEP_LANE;
  let laid = false;
  try {
    for (const spacing of spacings) {
      const todo = speeds.filter((speed) => !done.has(`${speed}/${spacing}`));
      if (!todo.length) continue;
      laid = true;
      await lay(call, sleep, lane, [...railLane(lane), ...powerEvery(lane, spacing)]);
      for (const speed of todo) {
        await send(call, [setSpeed(speed), ...launch(lane)]);
        const sum = await follow({call, selector: '@e[type=minecart,tag=rs,limit=1]', lane, ms: RUN_MS, now, sleep});
        out({speed, spacing, ...sum});
      }
    }
  } finally {
    // Separately, and never throwing: a failed restore must not hide why the sweep stopped.
    for (const commands of [laid ? clearLane(lane) : [], [setSpeed(WORLD_SPEED)]]) {
      if (commands.length) await send(call, commands).catch(() => warn(`run by hand on the sandbox console:\n${commands.join('\n')}`));
    }
  }
}

async function track({call, player, ms, out, now, sleep}) {
  // A player may leave the lane and come back, so only the speed along it counts here, not the height or the side.
  const flat = {x2: Infinity, y: 0, z: 0};
  const flatCall = async (cmds) => {
    const [time, pos] = await call(cmds);
    return [time, pos.replace(/\[(-?[\d.E-]+d), -?[\d.E-]+d, -?[\d.E-]+d\]/, '[$1, 0.0d, 0.5d]')];
  };
  return follow({call: flatCall, selector: player, lane: flat, ms, now, sleep, each: out});
}

async function rig({call, sleep, kind, speed, spacing}) {
  const lane = RIDE_LANES[kind];
  if (!lane) throw new Error(`rig kind ${kind}: only rail, ice2, ice1 or dip`);
  const {x1, x2, y, z} = lane;
  try {
    if (kind === 'rail' || kind === 'dip') await send(call, [setSpeed(speed)]);
    if (kind === 'rail') await lay(call, sleep, lane, [...railLane(lane), ...powerEvery(lane, spacing)]);
    else if (kind === 'dip') await lay(call, sleep, lane, [...railLane(lane), ...powerEvery({...lane, x2: x1 + DIP_RAMP}, DIP_BOOST), ...dipEvery(lane, DIP_EVERY, x1 + DIP_RAMP + 10)]);
    else await lay(call, sleep, lane, iceLane(lane, kind === 'ice2' ? 2 : 1));
    await send(call, boarding(lane, kind));
    const checks = kind === 'rail' || kind === 'dip' ? [`execute if block ${x2} ${y} ${z} #minecraft:rails`] : [`execute if block ${x2} ${y - 1} ${z} blue_ice`];
    if (kind === 'dip') checks.push(`execute if block ${x1 + DIP_RAMP + 10} ${y - 1} ${z} rail[shape=ascending_west]`);
    (await send(call, checks)).forEach((reply, i) => { if (!/Test passed/.test(reply)) throw new Error(`far end did not come out: ${checks[i]}: ${reply}`); });
  } finally {
    await send(call, free(lane));
  }
}

async function unrig({call, sleep}) {
  for (const lane of Object.values(RIDE_LANES)) {
    const {x1, y, z} = lane;
    await lay(call, sleep, lane, railLane(lane).filter(isForce));
    await send(call, [`fill ${x1 - 4} ${y - 1} ${z - 2} ${x1 - 1} ${y - 1} ${z + 2} air`, ...clearLane(lane, 'rslane', 2)]);
  }
  await send(call, [setSpeed(WORLD_SPEED)]);
}

function consoleCall(base) {
  return async (commands) => {
    const r = await fetch(base + '/api/sandbox/console', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: base}, body: JSON.stringify({commands}), signal: AbortSignal.timeout(120000)});
    const body = await r.json().catch(() => ({}));
    if (r.status !== 200) throw new Error(`console: ${body.error || r.status}`);
    return body.replies;
  };
}

function appender(name) {
  const file = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'mcbots', name);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  return {file, write: (row) => { fs.appendFileSync(file, JSON.stringify(row) + '\n'); console.log(JSON.stringify(row)); }};
}

async function main([verb, ...args]) {
  const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445'); // the dashboard: its console is the SANDBOX server's
  let interrupted = false, stop = () => {};
  process.on('SIGINT', () => { if (interrupted) return; interrupted = true; console.error('stopping, cleaning up the sandbox'); stop(new Error('interrupted')); }); // a second press must not skip the restore
  const sleep = (ms) => new Promise((res, rej) => { if (interrupted) return rej(new Error('interrupted')); stop = rej; setTimeout(res, ms); });
  const now = () => Date.now();
  if (verb === 'sweep') {
    const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1].split(',').map(Number); };
    const {file, write} = appender('railspeed.jsonl');
    const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const [speed, spacing] = [flag('--speed'), flag('--spacing')];
    await sweep({call, out: write, now, sleep, done: new Set(rows.map((r) => `${r.speed}/${r.spacing}`)), speeds: speed || SPEEDS, spacings: spacing || SPACINGS});
  } else if (verb === 'rig') {
    await rig({call, sleep, kind: args[0], speed: Number(args[1]), spacing: Number(args[2])});
    console.log(`lane ${args[0]} ready`);
  } else if (verb === 'unrig') {
    await unrig({call, sleep});
    console.log('ride lanes gone, rule back to 8');
  } else if (verb === 'track') {
    const {write} = appender('railspeed-track.jsonl');
    const player = args[0];
    console.log(JSON.stringify({player, ...await track({call, player, ms: Number(args[1] || 300) * 1000, out: (s) => write({player, ...s}), now, sleep})}));
  } else {
    throw new Error('usage: run.js sweep [--speed n --spacing n] | rig rail <speed> <spacing> | rig ice2 | rig ice1 | rig dip <speed> | unrig | track <player> [seconds]');
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });

module.exports = {sweep, track, rig, unrig, send, lay, free, isForce, consoleCall};
