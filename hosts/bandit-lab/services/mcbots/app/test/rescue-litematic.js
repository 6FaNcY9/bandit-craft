'use strict';
const assert = require('node:assert');
(async () => { // rescue: three no-path failures in a row, or 8 min climbing on one spot, teleport the bot to the base
  const {Rescue, STUCK_MS} = require('../rescue');
  const sent = [], said = [];
  let t = 0, online = ['bot4', 'bot2'];
  let reply = 'Teleported bot4 to -269.500000, 66.000000, -215.500000';
  const call = async (c) => (c[0] === 'minecraft:list' ? [`There are ${online.length} of a max of 12 players online: ${online.join(', ')}`] : (sent.push(...c), [reply]));
  const r = new Rescue({call, events: {add: (b, k, x) => said.push(x)}, target: () => ({x: -270, y: 66, z: -216}), now: () => t});
  const settle = () => new Promise((res) => setImmediate(() => setImmediate(res)));
  const fail = (bot, why = 'could not reach 1 2 3: No path to the goal!') => r.event({bot, kind: 'fail', text: `failed: goto 1 2 3 - ${why}`});
  fail('bot4'); fail('bot4');
  r.event({bot: 'bot4', kind: 'done', text: 'finished: mine stone 2'}); // a success in between resets
  fail('bot4'); fail('bot4');
  fail('bot4', 'chest full'); // another failure too
  fail('bot4'); fail('bot4'); fail('bot4');
  await settle();
  // only onto ground with room to stand (the old landing on the main server had air under it, 2026-10-19)
  assert.deepStrictEqual(sent, ['execute unless block -270 65 -216 #minecraft:air if block -270 66 -216 #minecraft:air if block -270 67 -216 #minecraft:air run minecraft:tp bot4 -269.5 66 -215.5']);
  assert.match(said[0], /rescued: no path 3 times in a row, teleported to the base \(sandbox\)/);
  fail('bot4'); fail('bot4'); fail('bot4'); // within 10 min: not again
  await settle();
  assert.strictEqual(sent.length, 1);
  t += 600000; fail('bot4'); fail('bot4'); fail('bot4');
  await settle();
  assert.strictEqual(sent.length, 2);
  r.event({bot: 'bad name;op x', kind: 'fail', text: 'No path to the goal'}); r.event({bot: 'bad name;op x', kind: 'fail', text: 'No path to the goal'}); r.event({bot: 'bad name;op x', kind: 'fail', text: 'No path to the goal'});
  await settle();
  assert.strictEqual(sent.length, 2, 'only bot names reach the console');
  // a bot on the other server is left alone: no tp, nothing claimed (bot2 and bot3 "rescued" by the sandbox, 2026-10-15)
  online = ['bot4']; said.length = 0;
  fail('bot2'); fail('bot2'); fail('bot2');
  await settle();
  assert.deepStrictEqual([sent.length, said], [2, []]);
  // no room to land: said, not claimed
  online = ['bot2']; reply = '';
  fail('bot2'); fail('bot2'); fail('bot2');
  await settle();
  assert.match(said.at(-1), /rescue failed \(sandbox\): no room to land at -270 66 -216/);

  // stuck: climbing on one spot for 8 min (bot2 in the shaft under the plaza, 2026-10-19); waiting or a move resets it
  const m = new Rescue({call, events: {add: (b, k, x) => said.push(x)}, target: () => ({x: -273, y: 66, z: -211}), now: () => t, label: 'main server'});
  online = ['bot2', 'bot3']; reply = 'Teleported bot2 to -272.5, 66, -210.5'; sent.length = 0; said.length = 0;
  const snap = (name, pos, activity = 'climbing to Y 58 towards -252 58 -197') => ({name, online: true, job: {type: 'light'}, pos, activity});
  m.watch([snap('bot2', [-276, 47, -213]), snap('bot3', [-254, 66, -241], 'waiting for the wheat to grow')]);
  t += STUCK_MS - 60000; m.watch([snap('bot2', [-276, 48, -213]), snap('bot3', [-254, 66, -241], 'waiting for the wheat to grow')]);
  await settle();
  assert.strictEqual(sent.length, 0, 'not yet');
  t += 60000; m.watch([snap('bot2', [-276, 47, -213]), snap('bot3', [-254, 66, -241], 'waiting for the wheat to grow')]);
  await settle();
  assert.deepStrictEqual([sent.length, /tp bot2 -272.5 66 -210.5$/.test(sent[0])], [1, true], 'bot2 out, the waiting bot3 left alone');
  assert.match(said[0], /rescued: stuck 8 min at -276 47 -213 \(climbing to Y 58/);
  m.watch([snap('bot3', [0, 64, 0], 'walking to 1 2 3')]);
  t += STUCK_MS; m.watch([snap('bot3', [8, 64, 0], 'walking to 1 2 3')]);
  await settle();
  assert.strictEqual(sent.length, 1, 'a bot that moves is not stuck');
})();

(async () => { // litematic: packed states cross longs; signed sizes locate the min corner
  const nbt = require('prismarine-nbt');
  const {gzipSync} = require('node:zlib');
  const {parseLitematic, billOfMaterials} = require('../schematic');
  const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, {type: 'int', value}]))});
  const palette = Array.from({length: 32}, () => ({Name: {type: 'string', value: 'minecraft:stone'}}));
  for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
  palette[17] = {Name: {type: 'string', value: 'minecraft:oak_log'}, Properties: {type: 'compound', value: {axis: {type: 'string', value: 'z'}}}};
  const region = (position, size, states) => {
    // Pack as one integer, then slice longs independently of the reader's two-word extraction.
    const packed = states.reduce((n, state, i) => n | (BigInt(state) << BigInt(i * 5)), 0n);
    const longs = Array.from({length: Math.ceil(states.length * 5 / 64)}, (_, i) => {
      const word = packed >> BigInt(i * 64);
      return [Number(BigInt.asIntN(32, word >> 32n)), Number(BigInt.asIntN(32, word))];
    });
    return {type: 'compound', value: {Position: xyz(position), Size: xyz(size),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: longs}}};
  };
  const states = Array(32).fill(0);
  states[1] = 1; states[2] = 2; states[3] = 3;
  states[12] = 31; states[25] = 17; states[31] = 31;
  const neg = Array(12).fill(0); neg[0] = 17; neg[11] = 31;
  const regions = {
    positive: region({x: 10, y: 9, z: -5}, {x: 4, y: 2, z: 4}, states),
    negative: region({x: -4, y: 8, z: 3}, {x: -3, y: -2, z: -2}, neg),
  };
  const encode = (value) => gzipSync(nbt.writeUncompressed({type: 'compound', name: '', value}));
  const root = {Metadata: {type: 'compound', value: {Name: {type: 'string', value: 'packed test'}}}, Regions: {type: 'compound', value: regions}};
  const noAir = ({air, ...rest}) => rest; // explicit air cells (for tight builds) are checked with the highways
  assert.deepStrictEqual(noAir(await parseLitematic(encode(root))), {name: 'packed test', size: {x: 20, y: 4, z: 7}, offset: {x: -6, y: 7, z: -3}, blocks: [
    {x: 16, y: 2, z: 1, name: 'stone', props: {}},
    {x: 17, y: 3, z: 0, name: 'oak_log', props: {axis: 'z'}},
    {x: 19, y: 3, z: 1, name: 'stone', props: {}},
    {x: 0, y: 0, z: 5, name: 'oak_log', props: {axis: 'z'}},
    {x: 2, y: 1, z: 6, name: 'stone', props: {}},
  ]});
  { // schematicPlan applies a substitution: stone -> cobblestone, the oak log and its state stay (iron farm, 2026-10-15)
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbots-subst-'));
    fs.writeFileSync(path.join(dir, 'packed.litematic'), encode(root));
    const plan = await require('../build').schematicPlan(dir, {file: 'packed.litematic', origin: {x: 0, y: 64, z: 0}, substitute: {stone: 'cobblestone'}});
    const names = new Set(plan.targets.map((t) => t.name));
    assert.ok(names.has('cobblestone') && !names.has('stone') && names.has('oak_log'), [...names].join());
    assert.strictEqual(plan.targets.find((t) => t.name === 'oak_log').props.axis, 'z');
    // fluids are no build targets (the builders waited on "water"); the sources are kept for a bucket step
    const str = (value) => ({type: 'string', value});
    palette[5] = {Name: str('minecraft:water'), Properties: {type: 'compound', value: {level: str('0')}}};
    palette[6] = {Name: str('minecraft:water'), Properties: {type: 'compound', value: {level: str('3')}}};
    palette[7] = {Name: str('minecraft:bubble_column'), Properties: {type: 'compound', value: {drag: str('false')}}};
    palette[8] = {Name: str('minecraft:lava'), Properties: {type: 'compound', value: {level: str('0')}}};
    const st = [31, 5, 6, 7, 8, 0, 0, 0]; // stone, water source, flowing water, bubble column, lava source
    fs.writeFileSync(path.join(dir, 'fluids.litematic'), encode({Metadata: root.Metadata, Regions: {type: 'compound', value: {r: region({x: 0, y: 0, z: 0}, {x: 2, y: 2, z: 2}, st)}}}));
    const wet = await require('../build').schematicPlan(dir, {file: 'fluids.litematic', origin: {x: 0, y: 64, z: 0}});
    assert.deepStrictEqual(wet.targets.map((t) => t.name), ['stone']);
    assert.deepStrictEqual(wet.fluids.map((f) => f.name).sort(), ['lava', 'water', 'water'], 'the source, the bubble column and the lava; not the flowing water');
    fs.rmSync(dir, {recursive: true});
  }
  await assert.rejects(parseLitematic(encode({})), /missing Regions/);
  const bad = region({x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1}, [0]);
  bad.value.BlockStatePalette.value.value = [];
  await assert.rejects(parseLitematic(encode({Regions: {type: 'compound', value: {bad}}})), /bad palette/);
  const short = region({x: 0, y: 0, z: 0}, {x: 4, y: 2, z: 4}, states);
  short.value.BlockStates.value.pop();
  await assert.rejects(parseLitematic(encode({Regions: {type: 'compound', value: {short}}})), /truncated BlockStates/);
  const index = region({x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1}, [31]);
  index.value.BlockStatePalette.value.value = palette.slice(0, 2);
  await assert.rejects(parseLitematic(encode({Regions: {type: 'compound', value: {index}}})), /bad palette index/);
  const empty = region({x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1}, [0]);
  assert.deepStrictEqual(noAir(await parseLitematic(encode({Regions: {type: 'compound', value: {empty}}}))), {name: '', size: {x: 0, y: 0, z: 0}, offset: {x: 0, y: 0, z: 0}, blocks: []});

  const b = (name, props = {}) => ({name, props});
  const bom = billOfMaterials([
    b('oak_door', {half: 'lower'}), b('oak_door', {half: 'upper'}),
    b('red_bed', {part: 'foot'}), b('red_bed', {part: 'head'}), b('stone_slab', {type: 'double'}),
    b('wall_torch'), b('potted_poppy'), b('candle', {candles: '4'}), b('not_a_block'), b('not_a_block'),
    b('sunflower', {half: 'upper'}),
  ]);
  assert.deepStrictEqual(bom, {items: {candle: 4, stone_slab: 2, flower_pot: 1, oak_door: 1, poppy: 1, red_bed: 1, torch: 1}, unknown: ['not_a_block']});
  assert.deepStrictEqual(Object.values(bom.items), [4, 2, 1, 1, 1, 1, 1]);
  assert.deepStrictEqual(billOfMaterials([
    b('soul_wall_torch'), b('redstone_wall_torch'), b('oak_wall_sign'), b('oak_wall_hanging_sign'),
    b('white_wall_banner'), b('player_wall_head'), b('skeleton_wall_skull'), b('redstone_wire'), b('tripwire'),
    b('sea_pickle', {pickles: '3'}), b('turtle_egg', {eggs: '2'}), b('snow', {layers: '8'}),
    ...['water', 'lava', 'fire', 'soul_fire', 'bubble_column', 'piston_head', 'moving_piston', 'frosted_ice', 'light'].map((name) => b(name)),
  ]), {items: {snow: 8, sea_pickle: 3, turtle_egg: 2, oak_hanging_sign: 1, oak_sign: 1, player_head: 1, redstone: 1,
    redstone_torch: 1, skeleton_skull: 1, soul_torch: 1, string: 1, white_banner: 1}, unknown: []});
  assert.deepStrictEqual(billOfMaterials([b('zzz'), b('aaa'), b('zzz')]).unknown, ['zzz', 'aaa']);
  console.log('schematic: packed regions and bill of materials ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
