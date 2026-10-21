'use strict';
const APP = require('node:path').join(__dirname, '..');
const assert = require('node:assert');
const {BotRunner} = require('../bots');
// ---- a death or disconnect keeps the job; the user's stop does not ----
(async () => {
  const mk = () => new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: null, onEvent: () => {}});
  const r = mk();
  const job = {id: 5, type: 'mine', args: {block: 'stone', count: 40}, collected: 12, status: 'running', t: {area: {x: 1, y: 2, z: 3}}, startPos: {x: 9, y: 9, z: 9}};
  r.resumeLater(job, 'died');
  assert.strictEqual(r.queue.length, 1);
  const back = r.queue[0];
  assert.deepStrictEqual([back.id, back.type, back.collected, back.status, back.cancelled, back.resume, back.interruptions], [5, 'mine', 12, 'queued', false, {x: 1, y: 2, z: 3}, 1]);
  assert.strictEqual(job.interrupted, true);
  r.queue = [];
  r.resumeLater({...job, t: undefined}, 'disconnected'); // no dig yet: back to where the job started
  assert.deepStrictEqual(r.queue[0].resume, {x: 9, y: 9, z: 9});
  r.queue = [];
  r.resumeLater({id: 6, type: 'craft', args: {item: 'torch', count: 4}}, 'died'); // crafting is not resumed
  r.resumeLater({id: 7, type: 'rearm', args: {x: 1, y: 2, z: 3}}, 'died');
  r.resumeLater(null, 'died');
  assert.strictEqual(r.queue.length, 0);
  let j = job;
  for (let i = 0; i < 3; i++) { r.resumeLater(j, 'died'); j = r.queue.shift(); }
  assert.strictEqual(j.interruptions, 3);
  r.resumeLater(j, 'died'); // the fourth time it is given up
  assert.strictEqual(r.queue.length, 0);
  // nothing runs while dead or (for a resumed job) offline
  const q = mk();
  let ran = 0;
  const {JOBS} = require('../bots');
  const goto = JOBS.goto;
  JOBS.goto = () => { ran++; };
  q.online = true; q.dead = true;
  q.queue = [{id: 1, type: 'goto', args: {x: 1, y: 2, z: 3}, status: 'queued'}];
  q.pump();
  assert.strictEqual(ran, 0);
  q.dead = false; q.online = false;
  q.queue[0].resume = true;
  q.pump();
  assert.strictEqual(ran, 0);
  q.online = true;
  q.pump();
  await new Promise((res) => setTimeout(res, 50));
  assert.strictEqual(ran, 1);
  JOBS.goto = goto;
})();
// A job that had nothing to do says so in its finished event; the agent reads it.
(async () => {
  const {JOBS} = require('../bots');
  const seen = [];
  const q = new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: null, onEvent: (b, k, t) => seen.push(`${k}: ${t}`)});
  q.online = true;
  const goto = JOBS.goto;
  JOBS.goto = (r, job) => { job.noop = job.args.x === 1; };
  q.enqueue('goto', {x: 1, y: 2, z: 3});
  for (let i = 0; i < 100 && !seen.some((e) => e.startsWith('done')); i++) await new Promise((res) => setTimeout(res, 20));
  q.enqueue('goto', {x: 2, y: 2, z: 3});
  for (let i = 0; i < 100 && seen.filter((e) => e.startsWith('done')).length < 2; i++) await new Promise((res) => setTimeout(res, 20));
  JOBS.goto = goto;
  const done = seen.filter((e) => e.startsWith('done'));
  assert.match(done[0], /^done: finished: goto 1 2 3 - already complete \(\d+ s\)$/);
  assert.match(done[1], /^done: finished: goto 2 2 3 \(\d+ s\)$/, 'a job that worked has no such note');
})();
// A job queued after "stop" must survive the stopped job winding down.
(async () => {
  const {JOBS} = require('../bots');
  const q = new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: null});
  q.online = true;
  let release;
  const said = [];
  JOBS.say = (r, job) => (said.push(job.args.text), job.args.text === 'slow' ? new Promise((res) => (release = res)) : null);
  q.enqueue('say', {text: 'slow'});
  q.enqueue('stop');
  q.enqueue('say', {text: 'next'});
  release();
  for (let i = 0; i < 150 && said.length < 2; i++) await new Promise((res) => setTimeout(res, 20));
  assert.deepStrictEqual(said, ['slow', 'next']);

  // in-game view: stone floor at y=60, a gold block straight ahead (-z), sky above
  const {render, cast} = require('../view');
  const world = (x, y, z) => (y <= 60 ? 'stone' : x === 0 && z === -5 && y === 61 ? 'gold_block' : 'air');
  assert.strictEqual(cast(world, 0.5, 61.5, 0.5, 0, 0, -1).name, 'gold_block', 'yaw 0 looks to -z');
  assert.strictEqual(cast(world, 0.5, 61.5, 0.5, 0, -1, 0).name, 'stone');
  assert.strictEqual(cast((x, y, z) => (z < -3 ? null : 'air'), 0.5, 61.5, 0.5, 0, 0, -1), null, 'unloaded chunk');
  const img = render({blockAt: world, eye: {x: 0.5, y: 61.6, z: 0.5}, yaw: 0, pitch: 0, w: 16, h: 9});
  assert.deepStrictEqual([...img.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  const raw = require('node:zlib').inflateSync(img.subarray(41, img.length - 12)); // IHDR is 25 bytes after the signature
  const px = (x, y) => [...raw.subarray(y * 49 + 1 + x * 3, y * 49 + 4 + x * 3)];
  assert.deepStrictEqual(px(8, 0), [135, 175, 235], 'sky at the top');
  assert.ok(px(8, 8)[0] < 135 && px(8, 8)[2] < 200, 'floor at the bottom: ' + px(8, 8));
  // a frame never runs past its deadline: past deadline = all sky; a slow world stops early
  const skyOnly = require('node:zlib').inflateSync((() => { const i = render({blockAt: world, eye: {x: 0.5, y: 61.6, z: 0.5}, yaw: 0, pitch: 0, w: 16, h: 9, deadline: 0}); return i.subarray(41, i.length - 12); })());
  assert.deepStrictEqual([...skyOnly.subarray(8 * 49 + 1 + 24, 8 * 49 + 4 + 24)], [135, 175, 235], 'past the deadline the floor is not cast');
  const slow = (x, y, z) => { const end = Date.now() + 1; while (Date.now() < end); return world(x, y, z); };
  let t0 = Date.now();
  render({blockAt: slow, eye: {x: 0.5, y: 61.6, z: 0.5}, yaw: 0, pitch: 0, w: 256, h: 144, deadline: t0 + 50});
  assert.ok(Date.now() - t0 < 400, `a slow frame stops near its deadline (${Date.now() - t0} ms)`);
  // botView reads block state ids (no Block object per step); unloaded columns stay unloaded
  const {botView} = require('../view');
  const vbot = {entity: {position: {x: 0.5, y: 61, z: 0.5, distanceTo: () => 0}, yaw: 0, pitch: -1.2, eyeHeight: 1.62}, entities: {},
    registry: {blocksByStateId: {0: {name: 'air'}, 1: {name: 'stone'}}},
    world: {getColumnAt: (p) => (p.z < -20 ? null : {}), getBlockStateId: (p) => (p.y <= 60 ? 1 : 0)}};
  const vraw = require('node:zlib').inflateSync((() => { const i = botView(vbot, {w: 16, h: 9}); return i.subarray(41, i.length - 12); })());
  assert.ok(vraw[8 * 49 + 1 + 24] < 135, 'looking down at stone');

  // settings: validated, merged over defaults, kept across a restart in STATE_DIR
  const {Settings, DEFAULTS} = require('../settings');
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mcbots-'));
  const st = new Settings(dir);
  assert.deepStrictEqual(st.get('bot1'), DEFAULTS);
  assert.deepStrictEqual(st.set('bot1', {fightRange: 12, defend: false, junk: 1}), {...DEFAULTS, fightRange: 12, defend: false});
  assert.throws(() => st.set('bot1', {fightRange: 99}), /fightRange/);
  assert.throws(() => st.set('bot1', {defend: 'yes'}), /defend/);
  assert.deepStrictEqual(new Settings(dir).get('bot1'), {...DEFAULTS, fightRange: 12, defend: false}, 'survives a restart');
  assert.deepStrictEqual(new Settings('').get('bot1'), DEFAULTS, 'no STATE_DIR: memory only');

  // safe digging: fluids next to the target, or a drop under the bot's feet
  const {unsafeDig} = require('../bots');
  const {Vec3} = require('vec3');
  const fake = (blocks, feet) => ({entity: {position: new Vec3(feet[0] + 0.5, feet[1], feet[2] + 0.5)}, blockAt: (p) => ({name: blocks[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: (blocks[`${p.x},${p.y},${p.z}`] || 'stone') === 'stone' ? 'block' : 'empty'})});
  assert.strictEqual(unsafeDig(fake({}, [0, 10, 0]), new Vec3(3, 10, 0)), null, 'plain stone is fine');
  assert.match(unsafeDig(fake({'4,10,0': 'water'}, [0, 10, 0]), new Vec3(3, 10, 0)), /water next to it/);
  assert.match(unsafeDig(fake({'3,11,0': 'lava'}, [0, 10, 0]), new Vec3(3, 10, 0)), /lava/);
  assert.strictEqual(unsafeDig(fake({'0,8,0': 'air', '0,7,0': 'air'}, [0, 10, 0]), new Vec3(0, 9, 0)), null, 'a drop of 3 is fine');
  assert.match(unsafeDig(fake({'0,8,0': 'air', '0,7,0': 'air', '0,6,0': 'air', '0,5,0': 'air'}, [0, 10, 0]), new Vec3(0, 9, 0)), /drop/);
  assert.match(unsafeDig(fake({'0,8,0': 'air', '0,7,0': 'lava'}, [0, 10, 0]), new Vec3(0, 9, 0)), /lava below/);

  // places: validated, replaced by name, kept across a restart; first supply wins
  const {Places} = require('../places');
  const pdir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mcbots-p-'));
  const pl = new Places(pdir);
  pl.set({name: 'Forest', kind: 'site', x: -258, y: 65, z: -210});
  pl.set({name: 'Main chest', kind: 'supply', x: '-260', y: '65', z: '-213'});
  assert.deepStrictEqual(pl.first('supply'), {name: 'Main chest', kind: 'supply', dim: 'overworld', x: -260, y: 65, z: -213});
  pl.set({name: 'Forest', kind: 'site', x: -250, y: 66, z: -200});
  assert.strictEqual(pl.list.length, 2, 'same name replaces');
  assert.throws(() => pl.set({name: 'x', kind: 'castle', x: 0, y: 0, z: 0}), /kind/);
  assert.throws(() => pl.set({name: '<script>', kind: 'site', x: 0, y: 0, z: 0}), /name/);
  assert.throws(() => pl.set({name: 'deep', kind: 'site', x: 0, y: 999, z: 0}), /y must/);
  assert.deepStrictEqual(new Places(pdir).list.map((p) => [p.name, p.x]), [['Forest', -250], ['Main chest', -260]], 'survives a restart');
  pl.remove('Forest');
  assert.throws(() => pl.remove('Forest'), /no place/);

  // MC-2: sealing never changes a neighbour inside a protected area, and honours a stop
  {
    const {sealFluids, Cancelled} = require('../bots');
    const {Vec3} = require('vec3');
    const make = (blocks, areas, onPlace) => {
      const placed = [];
      const bot = {
        blockAt: (p) => { const name = blocks[`${p.x},${p.y},${p.z}`]; return name ? {name, position: new Vec3(p.x, p.y, p.z)} : null; },
        inventory: {items: () => [{name: 'cobblestone'}]},
        equip: async () => {},
        placeBlock: async (target, face) => { const at = target.position.plus(face); placed.push(`${at.x},${at.y},${at.z}`); blocks[`${at.x},${at.y},${at.z}`] = 'cobblestone'; onPlace?.(); },
      };
      return {r: {bot, protectedAreas: areas, emit() {}}, placed};
    };
    const T = new Vec3(10, 64, 0);
    // ore outside the boundary, water inside it: no sealing, nothing placed, target stays unmined (false)
    let w = make({'10,64,0': 'diamond_ore', '11,64,0': 'water'}, [[11, -5, 20, 5]]);
    assert.strictEqual(await sealFluids(w.r, {cancelled: false}, T), false);
    assert.deepStrictEqual(w.placed, []);
    // one forbidden neighbour among several: still nothing placed, not even on the allowed one
    w = make({'10,64,0': 'diamond_ore', '10,65,0': 'water', '11,64,0': 'lava'}, [[11, -5, 20, 5]]);
    assert.strictEqual(await sealFluids(w.r, {cancelled: false}, T), false);
    assert.deepStrictEqual(w.placed, []);
    // an unprotected neighbour is sealed
    w = make({'10,64,0': 'diamond_ore', '11,64,0': 'water'}, [[100, 100, 110, 110]]);
    assert.strictEqual(await sealFluids(w.r, {cancelled: false}, T), true);
    assert.deepStrictEqual(w.placed, ['11,64,0']);
    // a stop during sealing: the first placement happens, the second never does
    const job = {cancelled: false};
    w = make({'10,64,0': 'diamond_ore', '11,64,0': 'water', '10,65,0': 'water'}, [], () => { job.cancelled = true; });
    await assert.rejects(sealFluids(w.r, job, T), Cancelled);
    assert.strictEqual(w.placed.length, 1, 'no placement after the stop');
  }

  // guard job arguments
  const gq = new BotRunner('bot2', {host: 'x', port: 1, log: () => {}, world: null});
  gq.online = true;
  JOBS.guard = () => new Promise(() => {}); // never ends; we only check the queued args
  gq.enqueue('guard', {x: '1', y: '64', z: '-3'});
  assert.deepStrictEqual(gq.current?.args || gq.queue[0]?.args, {x: 1, y: 64, z: -3, radius: 16});
  assert.throws(() => gq.enqueue('guard', {player: 'Steve', radius: 99}), /radius/);
  assert.throws(() => gq.enqueue('guard', {player: 'bad name!'}), /player/);
  { // level: tunnels and branches off the shaft walls (pure geometry, validation, then the job against a fake world)
    const L = require('../level');
    const {VALIDATE, Cancelled, stairRing, NATURAL} = require('../bots');
    const {Vec3} = require('vec3');
    const shaft = {x1: -291, z1: -222, x2: -276, z2: -207};
    // 16 wide: the middle is z -215 (x -284); the west tunnel leaves the wall at x -291 one block outside it
    const plan = L.armPlan(shaft, 0, 32, 8);
    assert.deepStrictEqual([plan.main[0], plan.main.at(-1), plan.main.length], [{x: -292, z: -215}, {x: -323, z: -215}, 32]);
    assert.strictEqual(plan.branches.length, 20, '10 branch points, 2 sides');
    assert.deepStrictEqual(plan.branches.map((b) => b.k).slice(0, 3), [30, 30, 27], 'farthest first');
    const near = plan.branches.filter((b) => b.k === 3).map((b) => b.cells);
    assert.deepStrictEqual(near.map((c) => [c[0], c.at(-1)]), [[{x: -294, z: -214}, {x: -294, z: -207}], [{x: -294, z: -216}, {x: -294, z: -223}]]);
    assert.ok(plan.branches.every((b) => b.cells.length === 8));
    const [east, north, south] = [1, 2, 3].map((d) => L.armPlan(shaft, d, 32, 8));
    assert.deepStrictEqual([east.main[0], north.main[0], south.main[0]], [{x: -275, z: -215}, {x: -284, z: -223}, {x: -284, z: -206}]);
    assert.deepStrictEqual(L.armPlan(shaft, 0, 8, 0).branches, [], 'branch 0: no branches');
    assert.deepStrictEqual(L.armPlan(shaft, 0, 5, 3).branches.map((b) => b.k), [3, 3]);
    assert.strictEqual(new Set(['bot11', 'bot12', 'bot13', 'bot14'].map((n) => L.armOrder(n)[0])).size, 4, 'four bots start on four different arms');
    assert.deepStrictEqual(L.armOrder('bot11').slice().sort(), [0, 1, 2, 3]);
    // validation: the shaft's box, y inside its depth, defaults 32 / 8
    assert.deepStrictEqual(VALIDATE.level({...shaft, y: 16}), {...shaft, top: 80, y: 16, length: 32, branch: 8});
    assert.strictEqual(VALIDATE.level({...shaft, y: -58, length: 64, branch: 16}).length, 64);
    for (const bad of [{y: -59}, {y: 80}, {y: 'x'}, {y: 16, length: 3}, {y: 16, length: 65}, {y: 16, branch: 17}, {y: 16, x2: -290}]) assert.throws(() => VALIDATE.level({...shaft, ...bad}), /y must|length must|branch must|shaft is/, JSON.stringify(bad));

    // the job: a 3 x 3 shaft at 0..2, tunnels of 4, branches of 2, at y 10, in a world of stone
    const AIR = {name: 'air', boundingBox: 'empty', type: 0};
    const world = (over = {}) => {
      const cells = new Map(Object.entries(over));
      const key = (p) => `${p.x},${p.y},${p.z}`;
      const blockAt = (p) => {
        const c = cells.get(key(p));
        if (c) return {position: p, type: 1, ...c};
        if (Math.abs(p.x) > 30 || Math.abs(p.z) > 30) return null;
        return p.x >= 0 && p.x <= 2 && p.z >= 0 && p.z <= 2 ? {position: p, ...AIR} : {position: p, name: 'stone', boundingBox: 'block', type: 1};
      };
      const dug = [];
      const digAt = async (r, job, p, want) => {
        const b = blockAt(p);
        if (b.boundingBox === 'empty' || !want(b.name)) return false;
        dug.push(key(p));
        cells.set(key(p), AIR);
        if (blockAt(p.offset(0, 1, 0)).name === 'gravel') { cells.set(key(p), {name: 'gravel', boundingBox: 'block', type: 2}); cells.set(key(p.offset(0, 1, 0)), AIR); } // falls into the hole
        job.onDig?.(job);
        return true;
      };
      return {blockAt, dug, digAt};
    };
    const run = async (w, {hub, areas = [], onDig, reserved, name = 'bot11', walkTo = async () => {}, startY = 10, args = {}} = {}) => {
      const infos = [];
      const {level} = L.makeLevel({
        goNear: async (r, job, x, y, z) => walkTo(x, y, z, r),
        waitCalm: async () => {},
        guard: (job) => { if (job.cancelled) throw new Cancelled('stopped'); },
        sleep: async () => {},
        digAt: w.digAt, upkeep: async () => {}, NATURAL, stairRing, at: (c) => `${c.x} ${c.y} ${c.z}`,
      });
      const job = {t: {}, cancelled: false, type: 'level', args: {x1: 0, z1: 0, x2: 2, z2: 2, top: 80, y: 10, length: 4, branch: 2, ...args}, onDig};
      const r = {name, bot: {blockAt: w.blockAt, game: {dimension: 'overworld'}, entity: {position: new Vec3(1.5, startY, 1.5)}}, world: hub, protectedAreas: areas, reserved, emit: (k, t) => infos.push(t)};
      await level(r, job);
      return {job, infos};
    };
    const air = (w, x, y, z) => w.blockAt(new Vec3(x, y, z)).boundingBox === 'empty';

    // four tunnels (4 columns) + branches (2 sides x 2 cells) = 8 columns of 2 blocks each; the ore and its vein too
    let w = world({'-2,10,2': {name: 'iron_ore'}, '-2,10,3': {name: 'iron_ore'}, '-2,9,2': {name: 'cobblestone'}, '5,10,-9': {name: 'diamond_ore'}});
    let out = await run(w);
    assert.strictEqual(out.job.ores, 2, 'the ore next to the tunnel and its vein; the far one stays');
    assert.strictEqual(w.dug.length, 4 * 8 * 2 + 2, w.dug.length);
    for (const [x, z] of [[-1, 1], [-4, 1], [1, -4], [1, 5], [5, 1], [-3, 3], [-3, -1], [3, 5]]) assert.ok(air(w, x, 10, z) && air(w, x, 11, z), `${x},${z}`);
    assert.ok(!air(w, 5, 10, -9) && !air(w, -2, 9, 2) && !air(w, -1, 12, 1), 'the far ore, the floor and the ceiling stay');
    assert.ok(out.infos.some((m) => /level y 10 finished: 2 ores$/.test(m)), out.infos.join('|'));
    assert.strictEqual(out.job.t.total, 32, 'columns of the plan: 4 arms x 8');
    // protected ground ends the arm there; its branches are not started; the other arms are dug
    w = world();
    out = await run(w, {areas: [[-10, -10, -3, 10]]});
    assert.ok(air(w, -2, 10, 1) && !air(w, -3, 10, 1) && !air(w, -4, 10, 1) && !air(w, -3, 10, 2), 'west stops before x -3, no branch');
    assert.ok(air(w, 5, 10, 1) && air(w, 1, 10, -4) && air(w, 1, 10, 5), 'the other arms are dug');
    assert.ok(out.infos.some((m) => /the west tunnel\(s\) ended early/.test(m)), out.infos.join('|'));
    // a block that must stay (a chest), a fluid and a reserved cell each end their arm
    w = world({'-2,10,1': {name: 'chest', boundingBox: 'block'}, '1,11,-2': {name: 'water', boundingBox: 'empty'}});
    out = await run(w, {reserved: (x, y, z) => x === 5 && y === 10 && z === 1});
    assert.ok(air(w, -1, 10, 1) && !air(w, -3, 10, 1) && w.blockAt(new Vec3(-2, 10, 1)).name === 'chest', 'the chest stays, the tunnel ends');
    assert.ok(air(w, 1, 10, -1) && !air(w, 1, 10, -3), 'water ends the north tunnel');
    assert.ok(air(w, 4, 10, 1) && !air(w, 5, 10, 1), 'a reserved cell ends the east tunnel');
    // gravel above falls into the hole: it is dug again
    w = world({'-1,12,1': {name: 'gravel', boundingBox: 'block'}});
    await run(w);
    assert.ok(air(w, -1, 10, 1) && air(w, -1, 11, 1), 'the fallen gravel was dug too');
    // another bot holds a block: that arm waits for the next pass and is dug then (3 passes at most)
    let denied = 0;
    w = world();
    await run(w, {hub: {claim: async (n, k) => !(k === 'overworld:5,10,1' && denied++ < 2), release: () => {}}});
    assert.ok(air(w, 5, 10, 1) && air(w, 6, 11, 1) && denied === 3, `busy block retried, dug on pass 3 (asked ${denied})`);
    w = world();
    await run(w, {hub: {claim: async (n, k) => k !== 'overworld:5,10,1', release: () => {}}});
    assert.ok(!air(w, 5, 10, 1) && air(w, -1, 10, 1), 'a block that stays busy is left, the rest is dug');
    // from the surface the way down is the stair, 8 layers per leg, and no walk may dig on it
    const legs = [];
    w = world();
    await run(w, {walkTo: async (x, y, z, r) => { legs.push([y, String(r.digOnly)]); if (r.digOnly) r.bot.entity.position.y = y; }, startY: 30, args: {y: 10}});
    assert.deepStrictEqual(legs.filter((l) => l[1] === '/$^/').map((l) => l[0]), [22, 14, 10], JSON.stringify(legs));
    assert.ok(legs.filter((l) => l[1] !== '/$^/').every((l) => l[1] === 'undefined') && air(w, -1, 10, 1), 'only the way down is dig-free; the tunnels are dug afterwards');
    // a tunnel mouth that cannot be reached is tried on every pass (4 walks each), then left and reported
    let walks = 0;
    w = world();
    out = await run(w, {walkTo: async (x) => { if (x < 0) { walks++; throw new Error('could not reach: The goal was changed'); } }});
    assert.ok(!air(w, -1, 10, 1) && air(w, 1, 10, -4) && air(w, 5, 10, 1) && walks === 12, `west left (${walks} walks)`);
    assert.ok(out.infos.some((m) => /the west tunnel\(s\) were left/.test(m)), out.infos.join('|'));
    // a Stop ends it between blocks
    w = world();
    await assert.rejects(run(w, {onDig: (job) => { if (w.dug.length === 3) job.cancelled = true; }}), Cancelled);
    assert.strictEqual(w.dug.length, 3, 'nothing is dug after the Stop');
  }
    const {storeFor} = require('../storage');
  const food = (n) => n === 'bread';
  for (const n of ['oak_log', 'oak_planks', 'stick', 'cobblestone', 'coal', 'torch', 'raw_iron', 'iron_ingot', 'iron_pickaxe', 'oak_sapling', 'white_wool', 'red_bed', 'crafting_table', 'furnace', 'chest', 'scaffolding']) assert.strictEqual(storeFor(n, food), 'base', n);
  assert.strictEqual(storeFor('bread', food), 'base');
  for (const n of ['granite', 'dirt', 'sand', 'azure_bluet', 'leaf_litter', 'rotten_flesh', 'string', 'bone', 'egg', 'arrow', 'oak_pressure_plate', 'smooth_basalt']) assert.strictEqual(storeFor(n, food), 'room', n);
  { // surplus above the keeper quota goes to the hall, not the base chest (2026-10-10: 569 cobblestone left no room for torches)
    const {overCap} = require('../storage');
    const full = {cobblestone: 569, oak_log: 400, birch_log: 109, oak_sapling: 200, birch_sapling: 110, torch: 0, coal: 31};
    const over = (n) => overCap(n, full);
    for (const n of ['cobblestone', 'spruce_log', 'jungle_sapling']) assert.strictEqual(storeFor(n, food, over), 'room', n);
    for (const n of ['torch', 'coal', 'stone_bricks', 'oak_planks', 'bread']) assert.strictEqual(storeFor(n, food, over), 'base', n);
    assert.strictEqual(storeFor('stone_bricks', food), 'base');
    assert.ok(overCap('charcoal', {coal: 32}) && !overCap('charcoal', {coal: 31}), 'charcoal counts as coal');
    assert.ok(overCap('cobblestone', {cobblestone: 192}, -64) && !overCap('cobblestone', {cobblestone: 191}, -64), 'carry-out stops at the quota');
    assert.ok(!overCap('granite', {granite: 9999}), 'no quota: the base/room split decides');
    assert.ok(overCap('bread', {bread: 193}, -64) && overCap('iron_pickaxe', {iron_pickaxe: 3}, -1) && !overCap('iron_pickaxe', {iron_pickaxe: 2}, -1), 'bread above 128 and a third pickaxe go to the hall (2026-10-20)');
  }
  { // the Keeper can make stone bricks from the chest's cobblestone
    const {PLANS} = require('../keeper');
    const c = {x: 1, y: 2, z: 3};
    const ok = PLANS.stone_bricks(16, c, {cobblestone: 24, coal: 2, oak_log: 1});
    assert.deepStrictEqual(ok.map((j) => j[0]), ['withdraw', 'withdraw', 'withdraw', 'smelt', 'craft', 'deposit']);
    assert.deepStrictEqual([ok[3][1].item, ok[3][1].count, ok[4][1].item, ok[5][1].only], ['cobblestone', 16, 'stone_bricks', 'stone_bricks']);
    assert.match(PLANS.stone_bricks(16, c, {cobblestone: 23, coal: 2, oak_log: 1}).blocked, /24 cobblestone/);
  }
  const {BASE} = require('../plan-config');
  assert.strictEqual(BASE.roomChests.length, 8);
  console.log('ok');
})();

// MC-1: Stop is decided by the server: standing orders off, saved jobs dropped (also those waiting
// for an offline bot), persistence before the answer, a worker that is away reported, not claimed.
(async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const net = require('node:net');
  const {spawn} = require('node:child_process');
  const WebSocket = require('ws');
  const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const TOKEN = 'c0ffee11'.repeat(5);
  const H = {'tailscale-user-login': 'a@github'};
  const launch = async (dir) => {
    const port = await freePort();
    const wport = await freePort();
    const child = spawn(process.execPath, [path.join(APP, 'server.js')], {
      env: {PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '', BOT_NAMES: 'bot1,bot2', STATE_DIR: dir, SUPPLY_CHEST: '1,64,1', KEEPER_QUOTAS: 'logs:64', PLAN_ENABLE: '1', PLAN_ROSTER: 'bot1', WORKER_PORT: String(wport), WORKER_TOKEN: TOKEN, DASHBOARD_PORT: String(port), DASHBOARD_HOST: '127.0.0.1', ALLOWED_TS_LOGINS: 'a@github', MC_HOST: '127.0.0.1', MC_PORT: '1', BOT_PASSWORD_SEED: 'test'},
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('server did not start')), 8000);
      child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(to); res(); } });
      child.on('exit', (c) => rej(new Error(`server exited early (${c})`)));
    });
    const call = (pth, body) => fetch(`http://127.0.0.1:${port}${pth}`, {method: 'POST', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, ...H}, body: JSON.stringify(body)});
    const get = async (pth) => (await fetch(`http://127.0.0.1:${port}${pth}`, {headers: H})).json();
    const stop = () => new Promise((res) => { child.once('exit', res); child.kill('SIGINT'); });
    return {port, wport, call, get, stop};
  };
  const saved = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8'));
  const jobs = {bot1: [{type: 'shift', args: {block: 'logs', x: 1, y: 64, z: 1}}], bot2: [{type: 'guard', args: {x: 5, y: 64, z: 5, radius: 16}}]};
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-stopA-'));
  fs.writeFileSync(path.join(dirA, 'jobs.json'), JSON.stringify(jobs));

  // A: keeper on, saved jobs waiting for offline bots, a worker that joined and left
  let a = await launch(dirA);
  try {
    // Each page gets a CSP with its own inline script and style; the new one has no style attributes (blocked)
    for (const [pth, file] of [['/', 'index.html'], ['/mehr', 'legacy.html']]) {
      const policy = (await fetch(`http://127.0.0.1:${a.port}${pth}`, {headers: H})).headers.get('content-security-policy');
      const html = fs.readFileSync(path.join(APP, 'public', file), 'utf8');
      for (const re of [/<script>([\s\S]*?)<\/script>/, /<style>([\s\S]*?)<\/style>/]) {
        assert.ok(policy.includes(require('node:crypto').createHash('sha256').update(html.match(re)[1]).digest('base64')), `${pth} allows its own ${re.source.slice(1, 6)}`);
      }
      if (pth === '/') assert.ok(!/<[^>]*\sstyle="/.test(html), 'no style attributes on the new page');
    }
    assert.strictEqual((await (await a.call('/api/keeper', {enabled: true})).json()).enabled, true);
    assert.strictEqual((await a.get('/api/state')).plan.enabled, false, 'the plan is available but off');
    assert.strictEqual((await a.call('/api/plan', {skip: 'nope'})).status, 400);
    assert.strictEqual((await a.call('/api/plan', {})).status, 400);
    assert.strictEqual((await (await a.call('/api/plan', {enabled: true})).json()).enabled, true);
    const wk = await new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${a.wport}/worker`, {headers: {Authorization: `Bearer ${TOKEN}`}}); ws.on('open', () => res(ws)); ws.on('error', rej); });
    wk.send(JSON.stringify({t: 'hello', v: 1, host: 'laptop', bots: ['bot5']}));
    for (let i = 0; i < 100 && !(await a.get('/api/state')).bots.some((b) => b.name === 'bot5'); i++) await new Promise((r) => setTimeout(r, 50));
    wk.close();
    for (let i = 0; i < 100 && (await a.get('/api/state')).bots.find((b) => b.name === 'bot5')?.connected; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(saved(dirA), jobs, 'pending jobs are kept while their bots are away');
    const res = await a.call('/api/job', {bots: 'all', type: 'stop'});
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.keeperOff, true);
    assert.deepStrictEqual(body.unreached, ['bot5'], 'the absent worker is reported, not claimed as stopped');
    assert.deepStrictEqual(saved(dirA), {}, 'persisted before the answer: nothing can come back');
    assert.strictEqual((await a.get('/api/state')).keeper.enabled, false);
    assert.strictEqual((await a.get('/api/plan')).enabled, false, 'Stop all switches the plan off too');
  } finally {
    await a.stop();
  }
  // stop followed by a process restart: nothing resumes, standing orders stay off
  a = await launch(dirA);
  try {
    await new Promise((r) => setTimeout(r, 2500)); // longer than the 2 s resume/save tick
    assert.deepStrictEqual((await a.get('/api/events?since=0')).events.filter((e) => /resumed/.test(e.text)), []);
    assert.strictEqual((await a.get('/api/state')).keeper.enabled, false);
    assert.deepStrictEqual(saved(dirA), {});
  } finally {
    await a.stop();
  }

  // B: per-bot stop drops only that bot's saved jobs; a failed state write is reported, not hidden
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-stopB-'));
  fs.writeFileSync(path.join(dirB, 'jobs.json'), JSON.stringify(jobs));
  const b = await launch(dirB);
  try {
    const one = await b.call('/api/job', {bots: ['bot1'], type: 'stop'});
    assert.strictEqual(one.status, 200);
    assert.deepStrictEqual(saved(dirB), {bot2: jobs.bot2}, "only bot1's saved job is gone");
    fs.rmSync(path.join(dirB, 'jobs.json'));
    fs.mkdirSync(path.join(dirB, 'jobs.json')); // writes now fail
    const bad = await b.call('/api/job', {bots: ['bot2'], type: 'stop'});
    assert.strictEqual(bad.status, 500);
    assert.match((await bad.json()).error, /stopped, but the stopped state could not be saved/);
  } finally {
    await b.stop();
  }

  // C: worker bots - settings are forwarded and kept, kept jobs come back once the worker is connected again
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-workerC-'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, what, ms = 6000) => {
    for (let t = 0; t < ms; t += 50) {
      const v = await f();
      if (v) return v;
      await sleep(50);
    }
    throw new Error(`timed out: ${what}`);
  };
  const worker = (s, status) => new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.wport}/worker`, {headers: {Authorization: `Bearer ${TOKEN}`}});
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => {
      ws.send(JSON.stringify({t: 'hello', v: 1, host: 'laptop', bots: ['bot5']}));
      if (status) ws.send(JSON.stringify({t: 'status', bots: [{name: 'bot5', online: true, ...status}]}));
      res({ws, msgs});
    });
    ws.on('error', rej);
  });
  const shift = {type: 'shift', args: {block: 'logs', x: 1, y: 64, z: 1}};
  let c = await launch(dirC);
  try {
    let w = await worker(c, {kept: [shift]});
    const welcome = await until(() => w.msgs.find((m) => m.t === 'welcome'), 'welcome');
    assert.strictEqual(welcome.settings.bot5.defend, true, 'defaults travel with the welcome');
    await until(async () => (await c.get('/api/state')).bots.find((b) => b.name === 'bot5')?.online, 'bot5 online');
    assert.strictEqual((await c.get('/api/state')).bots.find((b) => b.name === 'bot5').settings.eatBelow, 15, 'the dashboard shows remote settings like local ones');
    assert.strictEqual((await c.call('/api/settings', {bot: 'bot5', settings: {defend: false, eatBelow: 10}})).status, 200);
    const frame = await until(() => w.msgs.find((m) => m.t === 'settings'), 'settings frame');
    assert.deepStrictEqual([frame.bot, frame.settings.defend, frame.settings.eatBelow], ['bot5', false, 10]);
    for (const bad of [{eatBelow: 99}, {defend: 'yes'}]) {
      assert.strictEqual((await c.call('/api/settings', {bot: 'bot5', settings: bad})).status, 400);
    }
    assert.strictEqual((await c.call('/api/settings', {bot: 'bot99', settings: {defend: false}})).status, 400);
    assert.strictEqual(w.msgs.filter((m) => m.t === 'settings').length, 1, 'refused settings never reach the worker');
    await until(() => { try { return saved(dirC).bot5; } catch { return null; } }, 'worker job saved', 5000);
    assert.deepStrictEqual(saved(dirC).bot5, [shift]);
    w.ws.close();
    await until(async () => !(await c.get('/api/state')).bots.find((b) => b.name === 'bot5').connected, 'worker gone');
    assert.strictEqual((await c.call('/api/settings', {bot: 'bot5', settings: {torches: false}})).status, 200, 'accepted while the worker is away');
    await sleep(2200);
    assert.deepStrictEqual(saved(dirC).bot5, [shift], 'its job stays in the file while the worker is away');
  } finally {
    await c.stop();
  }
  // hub restart: the worker connects, the idle bot gets its settings and its shift back
  c = await launch(dirC);
  try {
    const w = await worker(c, {job: null, queue: []});
    const welcome = await until(() => w.msgs.find((m) => m.t === 'welcome'), 'welcome after restart');
    assert.deepStrictEqual([welcome.settings.bot5.defend, welcome.settings.bot5.eatBelow, welcome.settings.bot5.torches], [false, 10, false], 'settings survive a hub restart');
    const job = await until(() => w.msgs.find((m) => m.t === 'job'), 'shift resumed', 5000);
    assert.deepStrictEqual([job.bot, job.type, job.args], ['bot5', 'shift', shift.args]);
    assert.ok((await c.get('/api/events?since=0')).events.some((e) => e.bot === 'bot5' && /resumed after restart: shift/.test(e.text)));
    w.ws.close();
  } finally {
    await c.stop();
  }
  // a worker that kept playing through the hub restart is not given the job twice
  fs.writeFileSync(path.join(dirC, 'jobs.json'), JSON.stringify({bot5: [shift]}));
  c = await launch(dirC);
  try {
    const w = await worker(c, {job: {label: 'shift logs', type: 'shift'}, queue: [], kept: [shift]});
    await until(async () => (await c.get('/api/state')).bots.find((b) => b.name === 'bot5')?.online, 'busy bot online');
    await sleep(2500);
    assert.deepStrictEqual(w.msgs.filter((m) => m.t === 'job'), []);
    assert.deepStrictEqual(saved(dirC).bot5, [shift], 'its reported job stays saved');
    // Stop all reaches it and empties the file at once (the worker's old report is not trusted)
    assert.strictEqual((await c.call('/api/job', {bots: 'all', type: 'stop'})).status, 200);
    assert.deepStrictEqual(saved(dirC), {});
    await until(() => w.msgs.find((m) => m.t === 'job' && m.type === 'stop'), 'stop forwarded');
    w.ws.close();
  } finally {
    await c.stop();
  }
  console.log('ok');
})();
