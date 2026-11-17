#!/usr/bin/env node
'use strict';
// Does the hub's block model equal the real world? Static (random cells of the whole area), scripted (--spot: WRITES
// blocks and summons TNT in the REAL world, only with the owner's OK) and bot (--bot, --bot-spot). See README.md.
// node equality.js [--hub URL] [--spot x,y,z] [--bot name --bot-spot x,y,z]
const {HUB, Exit, sleep, parseArgs, parseTriple, makeApi, blocksPath, checkBox, diffSamples, isAir, showDiffs, run} = require('./lib');

const R = 6, PRE = 10, BOX_N = 2000, WAIT_MS = 5000; // BOX_N: the plugin's maximum; 500 of the 2197 cells would miss a 4-cell piston change most of the time
const BAD_REPLY = /not loaded|out of this world|Unknown or incomplete|Incorrect argument/i;

// 500 random cells of the area against the model, section by section; the first 20 differences are printed.
async function staticCheck(api, seed) {
  const {samples, skipped} = await api(`/api/world/sample?n=500&seed=${seed}`);
  if (!samples.length) throw new Exit(2, '0 cells compared (the plugin sampled nothing: chunks not generated?)');
  const bySection = new Map();
  for (const s of samples) {
    const k = s.slice(0, 3).map((v) => Math.floor(v / 16)).join(',');
    bySection.set(k, [...(bySection.get(k) || []), s]);
  }
  const diffs = [];
  for (const [k, list] of bySection) {
    const [cx, sy, cz] = k.split(',').map((v) => Number(v) * 16);
    diffs.push(...diffSamples(list, await api(blocksPath([cx, sy, cz, cx + 15, sy + 15, cz + 15]))));
  }
  return {n: samples.length, skipped, sections: bySection.size, diffs};
}

async function scripted(api, [x, y, z], area) {
  const box = [x - R, y - R, z - R, x + R, y + R, z + R], pre = [x - PRE, y - PRE, z - PRE, x + PRE, y + PRE, z + PRE];
  const [cx1, cz1, cx2, cz2] = area || [];
  if (!area || [pre[0], pre[3]].some((v) => Math.floor(v / 16) < cx1 || Math.floor(v / 16) > cx2) || [pre[2], pre[5]].some((v) => Math.floor(v / 16) < cz1 || Math.floor(v / 16) > cz2))
    throw new Exit(2, `--spot ${x},${y},${z} +-${PRE} is not inside the model's area (chunks ${area})`);
  // The model alone must not be the guard of a write: the real world is sampled too, and nothing is written unless both say air.
  const m = await api(blocksPath(pre));
  if (m.blocks.length || m.unknown.length || m.ungenerated.length)
    throw new Exit(2, `--spot ${x},${y},${z} +-${PRE} is not all air in the model (${m.blocks.length} blocks, ${m.unknown.length + m.ungenerated.length} chunks unknown): pick another spot`);
  const {samples} = await api(`/api/world/sample?n=${BOX_N}&seed=${Date.now()}&box=${pre.join(',')}`);
  const solid = samples.filter((c) => !isAir(c[3]));
  if (!samples.length || solid.length)
    throw new Exit(2, `--spot ${x},${y},${z} +-${PRE}: the real world sample has ${solid.length} non-air of ${samples.length} cells${solid[0] ? ` (e.g. ${solid[0].join(' ')})` : ''}: pick another spot`);

  const at = (dx, dy, dz) => `${x + dx} ${y + dy} ${z + dz}`;
  const steps = [
    ['basin', [`fill ${at(-4, 0, -4)} ${at(4, 1, 4)} minecraft:stone`, `fill ${at(-3, 1, -3)} ${at(3, 1, 3)} minecraft:air`]],
    ['piston', [`setblock ${at(0, 1, 0)} minecraft:sticky_piston[facing=east]`, `setblock ${at(1, 1, 0)} minecraft:glass`, `setblock ${at(0, 2, 0)} minecraft:redstone_block`]],
    ['water', [`setblock ${at(-2, 1, -2)} minecraft:water`]],
    ['water away', [`fill ${at(-3, 1, -3)} ${at(3, 1, 3)} minecraft:air`]],
    ['tnt', [`summon minecraft:tnt ${at(2, 2, 2)} {fuse:1}`]],
  ];
  const cleanup = [`fill ${at(-6, -6, -6)} ${at(6, 6, 6)} minecraft:air`, `execute positioned ${at(0, 0, 0)} run kill @e[type=minecraft:item,distance=..16]`];
  let cleaned = false, cleanFailed = false, aborted = false;
  const cmd = async (c, isCleanup) => {
    if (aborted && !isCleanup) throw new Exit(1, 'interrupted');
    const {reply} = await api('/api/admin/action', {action: 'command', cmd: c});
    console.log(`  > ${c}${reply ? ` -> ${reply}` : ''}`);
    if (BAD_REPLY.test(reply || '')) throw new Exit(2, `the server refused "${c}": ${reply}`);
  };
  const compare = async (name) => {
    await sleep(WAIT_MS);
    const {n, diffs} = await checkBox(api, box, BOX_N);
    if (!n) throw new Exit(1, `${name}: the plugin sampled no cell (chunk not generated?)`);
    if (diffs.length) { showDiffs(diffs); throw new Exit(1, `${name}: ${diffs.length} of ${n} sampled cells differ`); }
    console.log(`OK ${name} (${n} cells)`);
  };

  // Never throws: it runs after a failed step and on a signal. Once only.
  const cleanNow = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const c of cleanup) await cmd(c, true).catch((e) => { cleanFailed = true; console.error(`CLEAN-UP FAILED, run by hand: ${c} (${e.message})`); });
  };
  const onSignal = (sig) => {
    aborted = true;
    console.error(`${sig}: cleaning up`);
    cleanNow().finally(() => process.exit(1));
  };
  console.log(`Writing starts now. If this is killed (kill -9) or the hub dies, clean up by hand:\n${cleanup.map((c) => `  ${c}`).join('\n')}`);
  const signals = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) process.once(sig, onSignal);
  try {
    for (const [name, cmds] of steps) { for (const c of cmds) await cmd(c); await compare(name); }
    await cleanNow();
    if (cleanFailed) throw new Exit(2, 'the clean-up failed: run the commands above by hand');
    await compare('clean-up');
  } finally { // whatever went wrong, the spot must not stay built
    await cleanNow();
    for (const sig of signals) process.removeListener(sig, onSignal);
  }
}

async function bot(api, name, [x, y, z]) {
  const cell = [x, y, z, x, y, z], at = {x, y, z};
  const before = await api(blocksPath(cell));
  if (before.blocks.length || before.unknown.length || before.ungenerated.length) throw new Exit(2, `--bot-spot ${x},${y},${z} is not air in the model`);
  for (const remove of [false, true]) {
    const want = remove ? 'minecraft:air' : 'minecraft:cobblestone', what = remove ? 'bot removes' : 'bot places';
    await api('/api/job', {bots: [name], type: 'build', args: {origin: at, blocks: [{x: 0, y: 0, z: 0, block: 'cobblestone'}], ...(remove && {remove: true})}});
    const deadline = Date.now() + 120000;
    for (;;) {
      const d = diffSamples([[x, y, z, want]], await api(blocksPath(cell)));
      if (!d.length) break;
      if (Date.now() > deadline) throw new Exit(1, `${what}: after 120 s the model still shows ${d[0].got} at ${x} ${y} ${z}, wanted ${want}`);
      await sleep(1000);
    }
    const {n, diffs} = await checkBox(api, cell, 1);
    if (n !== 1 || diffs.length) { showDiffs(diffs); throw new Exit(1, `${what}: the model says ${want}, the world does not agree (${n} cell sampled)`); }
    console.log(`OK ${what} ${x} ${y} ${z}`);
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2)), api = makeApi(a.hub || HUB);
  const spot = a.spot === undefined ? null : parseTriple(a.spot, '--spot');
  const botSpot = a.bot === undefined || a['bot-spot'] === undefined ? null : parseTriple(a['bot-spot'], '--bot-spot');
  const {plugin} = await api('/api/world/stats');
  if (plugin?.importLeft !== 0) throw new Exit(2, `the first import is not done (importLeft ${plugin?.importLeft}); run again when it is 0`);
  console.log(`model area (chunks x1,z1,x2,z2): ${plugin.area}`);

  const seed = Date.now();
  let r = await staticCheck(api, seed);
  if (r.diffs.length) {
    console.log(`static: ${r.diffs.length} differences, reading both again in 5 s (same seed)`);
    await sleep(WAIT_MS);
    r = await staticCheck(api, seed);
  }
  if (r.diffs.length) { showDiffs(r.diffs); throw new Exit(1, `static: ${r.diffs.length} of ${r.n} sampled cells differ`); }
  console.log(`OK static (${r.n} cells in ${r.sections} sections, ${r.skipped} skipped)`);

  let skipped = 0;
  if (!spot) { console.log("SKIP scripted (writes blocks and summons TNT: needs --spot x,y,z and the owner's OK)"); skipped++; }
  else await scripted(api, spot, plugin.area);

  if (!botSpot) { console.log('SKIP bot (needs --bot name --bot-spot x,y,z)'); skipped++; }
  else await bot(api, String(a.bot), botSpot);

  console.log(skipped ? `PASS, ${skipped} step(s) skipped` : 'PASS');
  return skipped ? 3 : 0;
}

run(main);
