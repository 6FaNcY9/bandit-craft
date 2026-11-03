#!/usr/bin/env node
'use strict';
// Measures the highway surface on the SANDBOX server, over the dashboard's console, which can never reach the real one.
// Usage (laptop, tailnet):
//   node run.js sweep [--speed n --spacing n]   rail at each setting, results in ~/.local/state/mcbots/railspeed.jsonl
//   node run.js rig rail <speed> <spacing>      5 km ride lane at z 40 from x 300, rule set to <speed>
//   node run.js rig ice2 | rig ice1             5 km blue ice lane at z 50 | z 60
//   node run.js track <player> [seconds]        a player's speed, results in railspeed-track.jsonl
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {SPEEDS, SPACINGS, SWEEP_LANE, railLane, powerEvery, launch, iceLane, setSpeed, clearLane, batches, parseSample, summarize} = require('./rig');

const RUN_MS = 150000; // at 8 m/s a cart covers 1200 m of the lane in this time, which is enough for a speed
const SAMPLE_MS = 500;
const WORLD_SPEED = 8;
const RIDE_LANES = {rail: {x1: 300, x2: 5300, y: 200, z: 40}, ice2: {x1: 300, x2: 5300, y: 200, z: 50}, ice1: {x1: 300, x2: 5300, y: 200, z: 60}};
// What the console answers when a command did nothing. A lane with a gap would read as a derail at that speed.
const REFUSED = /not loaded|Incorrect argument|Unknown|Too many|Expected|Invalid|Can't/i;
const isForce = (c) => c.startsWith('forceload');

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
  if (!lane) throw new Error(`rig kind ${kind}: only rail, ice2 or ice1`);
  const {x2, y, z} = lane;
  const free = railLane(lane).filter(isForce).map((c) => c.replace('forceload add', 'forceload remove'));
  try {
    if (kind === 'rail') {
      await send(call, [setSpeed(speed)]);
      await lay(call, sleep, lane, [...railLane(lane), ...powerEvery(lane, spacing)]);
    } else {
      await lay(call, sleep, lane, iceLane(lane, kind === 'ice2' ? 2 : 1));
    }
    const check = kind === 'rail' ? `execute if block ${x2} ${y} ${z} #minecraft:rails` : `execute if block ${x2} ${y - 1} ${z} blue_ice`;
    const [reply] = await send(call, [check]);
    if (!/Test passed/.test(reply)) throw new Error(`far end did not come out: ${check}: ${reply}`);
  } finally {
    await send(call, free);
  }
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
  process.once('SIGINT', () => { interrupted = true; stop(new Error('interrupted')); });
  const sleep = (ms) => new Promise((res, rej) => { if (interrupted) return rej(new Error('interrupted')); stop = rej; setTimeout(res, ms); });
  const now = () => Date.now();
  if (verb === 'sweep') {
    const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : Number(args[i + 1]); };
    const {file, write} = appender('railspeed.jsonl');
    const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const [speed, spacing] = [flag('--speed'), flag('--spacing')];
    await sweep({call, out: write, now, sleep, done: new Set(rows.map((r) => `${r.speed}/${r.spacing}`)), speeds: speed ? [speed] : SPEEDS, spacings: spacing ? [spacing] : SPACINGS});
  } else if (verb === 'rig') {
    await rig({call, sleep, kind: args[0], speed: Number(args[1]), spacing: Number(args[2])});
    console.log(`lane ${args[0]} ready`);
  } else if (verb === 'track') {
    const {write} = appender('railspeed-track.jsonl');
    const player = args[0];
    console.log(JSON.stringify({player, ...await track({call, player, ms: Number(args[1] || 300) * 1000, out: (s) => write({player, ...s}), now, sleep})}));
  } else {
    throw new Error('usage: run.js sweep [--speed n --spacing n] | rig rail <speed> <spacing> | rig ice2 | rig ice1 | track <player> [seconds]');
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });

module.exports = {sweep, track, rig};
