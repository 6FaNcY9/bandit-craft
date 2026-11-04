'use strict';
// One-off measurement behind docs/runbooks/minecraft/highway-measurements.md; only the settings there were run.
// Spike: do V dips in the rail speed up a fast cart without gold?
// usage: node dip.js <setting> <boost spacing> <boost until, blocks from the start> <dip spacing, 0 for none> [km]
const R = '../';
const {railLane, powerEvery, launch, setSpeed, clearLane, parseSample} = require(R + 'rig');
const {send, lay, consoleCall} = require(R + 'run');
const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const [setting, boost, until, dipEvery, km = 2] = process.argv.slice(2).map(Number);
  const lane = {x1: 300, x2: 300 + km * 1000, y: 200, z: 10};
  const {x1, x2, y, z} = lane;
  const dips = [], check = [];
  if (dipEvery) for (let x = x1 + until + 10; x + 2 < x2 - 20; x += dipEvery) {
    // Rails at y - 1: down going east at x, up going east at x + 1, on a floor one lower.
    dips.push(`setblock ${x} ${y - 2} ${z} stone`, `setblock ${x + 1} ${y - 2} ${z} stone`, `setblock ${x} ${y} ${z} air`, `setblock ${x + 1} ${y} ${z} air`,
      `setblock ${x} ${y - 1} ${z} rail[shape=ascending_west]`, `setblock ${x + 1} ${y - 1} ${z} rail[shape=ascending_east]`);
  }
  await lay(call, sleep, lane, [...railLane(lane), ...powerEvery({...lane, x2: x1 + until}, boost)]);
  await send(call, dips);
  // Placing can reshape a rail against its neighbours; a second set of the same block leaves it as asked.
  await send(call, dips.filter((c) => c.includes('rail[')));
  if (dipEvery) {
    const x = x1 + until + 10 + dipEvery;
    const q = [`execute if block ${x} ${y - 1} ${z} rail[shape=ascending_west]`, `execute if block ${x + 1} ${y - 1} ${z} rail[shape=ascending_east]`, `execute if block ${x - 1} ${y} ${z} rail[shape=east_west]`, `execute if block ${x + 2} ${y} ${z} rail[shape=east_west]`];
    console.log('shapes:', (await call(q)).join(' / '));
  }
  await send(call, [setSpeed(setting), ...launch(lane)]);
  const sel = '@e[type=minecart,tag=rs,limit=1]';
  let prev = null, top = 0, rows = 0;
  const t0 = Date.now();
  for (;;) {
    const s = parseSample(await call(['time query gametime', `data get entity ${sel} Pos`]));
    if (!s) { console.log('cart gone', prev); break; }
    if (prev && s.tick - prev.tick >= 10) {
      const ms = ((s.x - prev.x) / (s.tick - prev.tick)) * 20;
      if (ms > top) top = ms;
      if (rows++ % 2 === 0) console.log(`x ${s.x.toFixed(0).padStart(6)} y ${s.y.toFixed(2)} z ${s.z.toFixed(2)} ${ms.toFixed(1).padStart(7)} m/s`);
      if (s.x < prev.x - 1 || s.x >= x2 - 1) { console.log('reached the end'); break; }
      if (Math.abs(s.z - z - 0.5) > 1 || Math.abs(s.y - y) > 2.5) { console.log('DERAILED', s); break; }
      if (Math.abs(s.x - prev.x) < 0.01) { console.log('STOPPED', s); break; }
      prev = s;
    } else if (!prev) prev = s;
    if (Date.now() - t0 > 150000) { console.log('timeout'); break; }
    await sleep(200);
  }
  console.log(JSON.stringify({setting, boost, until, dipEvery, km, top: +top.toFixed(1)}));
  // The floor under the dips first: clearLane frees the chunks at its end, and fill refuses unloaded ones.
  for (let x = x1; x <= x2; x += 2185) await send(call, [`fill ${x} ${y - 2} ${z} ${Math.min(x2, x + 2184)} ${y - 2} ${z} air`]);
  await send(call, [...clearLane(lane), setSpeed(8)]);
})().catch((e) => { console.error(e); process.exitCode = 1; });
