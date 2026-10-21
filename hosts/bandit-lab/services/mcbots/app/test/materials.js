'use strict';
// Material plans merge needs before rounding shared intermediates.
{
  const assert = require('node:assert/strict');
  const {planMaterials: plan} = require('../recipes');
  const gathered = (p) => Object.fromEntries(p.gather.map(({item, count}) => [item, count]));
  const c = (item, count, crafts, ingredients, table = false) => ({item, count, crafts, ingredients, table});
  const s = (item, count, from) => ({item, count, from, per: 1});
  const emptyFuel = {item: 'coal', count: 0};

  const torch = plan({torch: 8});
  assert.deepStrictEqual(gathered(torch), {oak_log: 1, coal: 2});
  assert.deepStrictEqual(torch.craft, [c('oak_planks', 2, 1, {oak_log: 1}),
    c('stick', 2, 1, {oak_planks: 2}), c('torch', 8, 2, {coal: 2, stick: 2})]);
  assert.deepStrictEqual(torch.smelt, []);
  assert.deepStrictEqual(torch.fuel, emptyFuel);
  assert.deepStrictEqual(torch.unknown, []);
  assert.deepStrictEqual(torch.gather.map(({how}) => how), ['chop oak_log', 'mine coal_ore']);

  for (const items of [{oak_stairs: 8, oak_planks: 5}, {oak_planks: 5, oak_stairs: 8}]) {
    const p = plan(items);
    assert.deepStrictEqual(gathered(p), {oak_log: 5});
    assert.deepStrictEqual(p.craft, [c('oak_planks', 17, 5, {oak_log: 5}), c('oak_stairs', 8, 2, {oak_planks: 12}, true)]);
  }
  const glass = plan({glass: 12});
  assert.deepStrictEqual(gathered(glass), {sand: 12, coal: 2});
  assert.deepStrictEqual(glass.smelt, [s('glass', 12, 'sand')]);
  assert.deepStrictEqual(glass.craft, []);
  assert.deepStrictEqual(glass.fuel, {item: 'coal', count: 2});

  const bricks = plan({stone_bricks: 8});
  assert.deepStrictEqual(gathered(bricks), {cobblestone: 8, coal: 1});
  assert.deepStrictEqual(bricks.smelt, [s('stone', 8, 'cobblestone')]);
  assert.deepStrictEqual(bricks.craft, [c('stone_bricks', 8, 2, {stone: 8})]);
  assert.deepStrictEqual(bricks.fuel, {item: 'coal', count: 1});

  const iron = plan({iron_block: 1});
  assert.deepStrictEqual(gathered(iron), {raw_iron: 9, coal: 2});
  assert.deepStrictEqual(iron.smelt, [s('iron_ingot', 9, 'raw_iron')]);
  assert.deepStrictEqual(iron.craft, [c('iron_block', 1, 1, {iron_ingot: 9}, true)]);
  const chest = plan({chest: 2});
  assert.deepStrictEqual(gathered(chest), {oak_log: 4});
  assert.deepStrictEqual(chest.craft, [c('oak_planks', 16, 4, {oak_log: 4}), c('chest', 2, 2, {oak_planks: 16}, true)]);
  assert.deepStrictEqual(plan({white_wool: 1}), {gather: [], smelt: [], craft: [], fuel: emptyFuel, unknown: ['white_wool']});

  const stocked = plan({oak_stairs: 8, oak_planks: 5}, {have: {oak_planks: 5, oak_log: 1}});
  assert.deepStrictEqual(gathered(stocked), {oak_log: 2});
  assert.deepStrictEqual(stocked.craft, [c('oak_planks', 12, 3, {oak_log: 3}), c('oak_stairs', 8, 2, {oak_planks: 12}, true)]);
  assert.deepStrictEqual(gathered(plan({glass: 12}, {have: {glass: 4, sand: 3, coal: 1}})), {sand: 5});
  assert.deepStrictEqual(plan({white_wool: 1}, {have: {string: 4}}).craft, [c('white_wool', 1, 1, {string: 4})]);
  const shared = plan({oak_stairs: 8, torch: 8});
  assert.deepStrictEqual(gathered(shared), {oak_log: 4, coal: 2});
  assert.strictEqual(shared.craft.filter(({item}) => item === 'oak_planks').length, 1);
  assert.deepStrictEqual(shared.craft[0], c('oak_planks', 14, 4, {oak_log: 4}));

  for (const items of [{iron_ingot: 9, iron_block: 1}, {iron_block: 1, iron_ingot: 9}]) {
    const p = plan(items);
    assert.deepStrictEqual(gathered(p), {raw_iron: 18, coal: 3});
    assert.deepStrictEqual(p.smelt, [s('iron_ingot', 18, 'raw_iron')]);
    assert.deepStrictEqual(p.craft, [c('iron_block', 1, 1, {iron_ingot: 9}, true)]);
    assert.deepStrictEqual(p.unknown, []);
  }
  const smooth = plan({smooth_stone: 8});
  assert.deepStrictEqual(gathered(smooth), {cobblestone: 8, coal: 2});
  assert.deepStrictEqual(smooth.smelt, [s('stone', 8, 'cobblestone'), s('smooth_stone', 8, 'stone')]);
  assert.deepStrictEqual(plan({spruce_log: 2}).gather, [{item: 'spruce_log', count: 2, how: 'chop spruce_log'}]);
  // Mined deepslate drops cobbled_deepslate; stripped logs come from an axe, not a tree.
  assert.deepStrictEqual(plan({deepslate: 2}).gather, [{item: 'cobbled_deepslate', count: 2, how: 'mine deepslate'}, {item: 'coal', count: 1, how: 'mine coal_ore'}]);
  assert.deepStrictEqual(plan({stripped_oak_log: 1}).unknown, ['stripped_oak_log']);
  assert.deepStrictEqual(plan({}), {gather: [], smelt: [], craft: [], fuel: emptyFuel, unknown: []});
  // Unpacking only when nothing else makes the item: nuggets from ingots, but never ingots from blocks.
  assert.deepStrictEqual(gathered(plan({iron_nugget: 25})), {raw_iron: 3, coal: 1});
  assert.deepStrictEqual(plan({iron_nugget: 25}).craft, [c('iron_nugget', 27, 3, {iron_ingot: 3})].map((x) => ({...x, count: 25})));
  assert.throws(() => plan({}, {version: 'not-a-version'}), /unsupported Minecraft version/);
  console.log('recipes: material plans ok');
}

{
  const assert = require('node:assert/strict');
  const placing = require('../placing');
  const {placement, skip, matches, itemOf, YAW, DIRS} = placing;
  assert.deepStrictEqual(Object.keys(placing).sort(), ['DIRS', 'YAW', 'itemOf', 'matches', 'placement', 'skip']);
  assert.deepStrictEqual(YAW, {north: 0, west: Math.PI / 2, south: Math.PI, east: 3 * Math.PI / 2});
  assert.deepStrictEqual(DIRS, {north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0]});
  const all = [
    {against: [0, -1, 0], face: [0, 1, 0], cursor: null, look: null},
    {against: [1, 0, 0], face: [-1, 0, 0], cursor: null, look: null},
    {against: [-1, 0, 0], face: [1, 0, 0], cursor: null, look: null},
    {against: [0, 0, 1], face: [0, 0, -1], cursor: null, look: null},
    {against: [0, 0, -1], face: [0, 0, 1], cursor: null, look: null},
    {against: [0, 1, 0], face: [0, -1, 0], cursor: null, look: null},
  ];
  const bottom = [all[0],
    {...all[1], cursor: [0, 0.25, 0.5]}, {...all[2], cursor: [1, 0.25, 0.5]},
    {...all[3], cursor: [0.5, 0.25, 0]}, {...all[4], cursor: [0.5, 0.25, 1]},
  ];
  const top = [
    {...all[1], cursor: [0, 0.75, 0.5]}, {...all[2], cursor: [1, 0.75, 0.5]},
    {...all[3], cursor: [0.5, 0.75, 0]}, {...all[4], cursor: [0.5, 0.75, 1]}, all[5],
  ];
  const looking = (ways, look) => ways.map((w) => ({...w, look}));
  const again = {against: [0, 0, 0], face: [0, 1, 0], cursor: null, look: null};
  const cases = [
    ['oak_log', {axis: 'x'}, ['axis'], [all[1], all[2]]],
    ['oak_log', {axis: 'y'}, ['axis'], [all[0], all[5]]],
    ['oak_log', {axis: 'z'}, ['axis'], [all[3], all[4]]],
    ['oak_slab', {type: 'bottom'}, ['type'], bottom],
    ['oak_slab', {type: 'top'}, ['type'], top],
    ['oak_slab', {type: 'double'}, ['type'], bottom, again],
    ['oak_trapdoor', {facing: 'north', half: 'top'}, ['facing', 'half'],
      [{...all[3], cursor: [0.5, 0.75, 0]}, {...all[5], look: 'south'}]],
    ['oak_trapdoor', {facing: 'east', half: 'bottom'}, ['facing', 'half'],
      [{...all[0], look: 'west'}, {...all[2], cursor: [1, 0.25, 0.5]}]],
    ['furnace', {facing: 'east', lit: 'true'}, ['facing'], looking(all, 'west')],
    ['barrel', {facing: 'up'}, ['facing'], looking(all, 'down')],
    ['barrel', {facing: 'down'}, ['facing'], looking(all, 'up')],
    ['oak_fence_gate', {facing: 'south'}, ['facing'], looking(all, 'south')],
    ['campfire', {facing: 'west'}, ['facing'], looking(all, 'west')],
    ['soul_campfire', {facing: 'east'}, ['facing'], looking(all, 'east')],
    ['red_bed', {part: 'foot', facing: 'north'}, ['facing'], looking([all[0]], 'north')],
    ['wall_torch', {facing: 'west'}, ['facing'], [all[1]]],
    ['soul_wall_torch', {facing: 'north'}, ['facing'], [all[3]]],
    ['redstone_wall_torch', {facing: 'east', lit: 'false'}, ['facing'], [all[2]]],
    ['torch', {}, [], [all[0]]], ['soul_torch', {}, [], [all[0]]], ['redstone_torch', {lit: 'true'}, [], [all[0]]],
    ['lantern', {hanging: 'true'}, ['hanging'], [all[5]]],
    ['lantern', {hanging: 'false'}, ['hanging'], [all[0]]],
    ['soul_lantern', {hanging: 'true'}, ['hanging'], [all[5]]],
    ['ladder', {facing: 'south'}, ['facing'], [all[4]]],
    ['white_carpet', {}, [], [all[0]]], ['oak_pressure_plate', {powered: 'true'}, [], [all[0]]],
    ['flower_pot', {}, [], [all[0]]], ['glass', {}, [], all],
    ['oak_fence', {north: 'true', south: 'false', east: 'false', west: 'true', waterlogged: 'false'}, [], all],
    ['oak_leaves', {persistent: 'true', distance: '1'}, [], all],
  ];
  for (const facing of ['north', 'south', 'east', 'west']) for (const half of ['bottom', 'top']) {
    cases.push(['oak_stairs', {facing, half, shape: 'straight', waterlogged: 'false'}, ['facing', 'half'], looking(half === 'top' ? top : bottom, facing)]);
  }
  for (const [facing, left, right] of [
    ['north', [0.25, 1, 0.5], [0.75, 1, 0.5]], ['south', [0.75, 1, 0.5], [0.25, 1, 0.5]],
    ['east', [0.5, 1, 0.25], [0.5, 1, 0.75]], ['west', [0.5, 1, 0.75], [0.5, 1, 0.25]],
  ]) for (const [hinge, cursor] of [['left', left], ['right', right]]) {
    cases.push(['oak_door', {facing, half: 'lower', hinge}, ['facing', 'half'], [{...all[0], cursor, look: facing}]]);
  }
  for (const name of ['smoker', 'blast_furnace', 'chest', 'trapped_chest', 'ender_chest', 'carved_pumpkin',
    'jack_o_lantern', 'loom', 'stonecutter', 'lectern', 'beehive', 'bee_nest', 'chiseled_bookshelf',
    'end_portal_frame', 'blue_glazed_terracotta']) cases.push([name, {facing: 'north'}, ['facing'], looking(all, 'south')]);
  for (const [name, props, check, ways, second] of cases) {
    const expected = {item: itemOf(name), check, ways, ...(second ? {again: second} : {})};
    assert.deepStrictEqual(placement(name, props), expected, `${name} ${JSON.stringify(props)}`);
    assert.deepStrictEqual(placement(`minecraft:${name}`, props), expected);
    for (const w of ways) {
      assert.ok(w.cursor === null || w.cursor.every((v) => v >= 0 && v <= 1));
      assert.deepStrictEqual(w.face, w.against.map((v) => v ? -v : 0));
    }
  }
  for (const [name, props] of [
    ['oak_sign', {rotation: '0'}], ['stone_button', {face: 'wall', facing: 'up'}],
    ['repeater', {facing: 'north', delay: '5'}], ['rail', {}], ['hopper', {facing: 'up'}],
    ['white_shulker_box', {}], ['note_block', {note: '25'}], ['candle', {}], ['sea_pickle', {}], ['stone', {candles: '2'}],
    ['stone', {pickles: '2'}], ['stone', {rotation: '0'}], ['bell', {attachment: 'floor'}],
    ['comparator', {}], ['piston', {}], ['sticky_piston', {}], ['observer', {}],
    ['dispenser', {}], ['dropper', {}], ['crafter', {}], ['powered_rail', {}], ['oak_wall_sign', {}],
    ['white_banner', {}], ['vine', {}], ['scaffolding', {}], ['anvil', {}], ['chipped_anvil', {}],
    ['damaged_anvil', {}], ['stone', {facing: 'north'}], ['stone', {half: 'bottom'}],
    ['stone', {type: 'left'}], ['stone', {hinge: 'left'}], ['stone', {part: 'foot'}],
    ['oak_log', {axis: 'bad'}], ['oak_stairs', {facing: 'up', half: 'bottom'}],
  ]) assert.strictEqual(placement(name, props), null, name);
  // Redstone parts, rails, buttons, shulker boxes, double chests (vanilla rules; tools/mcbots-placetest checks them live).
  const w = (against, look = null, cursor = null) => ({against, face: against.map((v) => v ? -v : 0), cursor, look});
  const six = (look) => [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].map((a) => w(a, look));
  const cyc = (prop, values) => ({cycle: {prop, values}});
  assert.deepStrictEqual(placement('hopper', {facing: 'east', enabled: 'true'}), {item: 'hopper', check: ['facing'], ways: [w([1, 0, 0])]});
  assert.deepStrictEqual(placement('hopper', {facing: 'down'}).ways, [w([0, -1, 0]), w([0, 1, 0])]);
  assert.deepStrictEqual(placement('repeater', {facing: 'north', delay: '3'}), {item: 'repeater', check: ['facing', 'delay'], ways: [w([0, -1, 0], 'south')], ...cyc('delay', ['1', '2', '3', '4'])});
  assert.deepStrictEqual(placement('comparator', {facing: 'west', mode: 'subtract'}).ways, [w([0, -1, 0], 'east')]);
  assert.deepStrictEqual(placement('dropper', {facing: 'up'}).ways, six('down'));
  assert.deepStrictEqual(placement('sticky_piston', {facing: 'north', extended: 'true'}).ways, six('south'));
  assert.deepStrictEqual(placement('observer', {facing: 'down'}).ways, six('down'));
  assert.deepStrictEqual(placement('note_block', {note: '7', instrument: 'harp'}).cycle.values.length, 25);
  assert.deepStrictEqual(placement('white_shulker_box', {facing: 'west'}).ways, [w([1, 0, 0])]);
  assert.deepStrictEqual(placement('powered_rail', {shape: 'ascending_south', powered: 'false'}), {item: 'powered_rail', check: [], ways: [w([0, -1, 0], 'north')], final: ['shape']});
  assert.strictEqual(placement('rail', {shape: 'north_east'}).ways[0].look, null);
  assert.deepStrictEqual(placement('redstone_wire', {north: 'side', power: '0'}).ways, [w([0, -1, 0])]);
  assert.deepStrictEqual(placement('stone_button', {face: 'wall', facing: 'north'}).ways, [w([0, 0, 1])]);
  assert.deepStrictEqual(placement('oak_wall_sign', {facing: 'north', waterlogged: 'false'}), {item: 'oak_sign', check: ['facing'], ways: [w([0, 0, 1])]});
  assert.strictEqual(placement('oak_wall_hanging_sign', {facing: 'north'}), null, 'a hanging sign stays out');
  assert.deepStrictEqual(placement('lever', {face: 'ceiling', facing: 'east'}).ways, [w([0, 1, 0], 'east')]);
  const chest = placement('chest', {facing: 'north', type: 'left'});
  assert.deepStrictEqual([chest.check, chest.final, chest.ways[0]], [['facing'], ['type'], w([1, 0, 0], 'south')]); // partner east of a north chest
  assert.deepStrictEqual(placement('chest', {facing: 'south', type: 'right'}).ways[0], w([1, 0, 0], 'north'));
  assert.deepStrictEqual(placement('chest', {facing: 'east', type: 'single'}).ways, six('west'));
  assert.ok(matches({name: 'repeater', props: {facing: 'north', delay: '1'}}, {name: 'repeater', props: {facing: 'north', delay: 1, powered: true}}));
  assert.ok(!matches({name: 'repeater', props: {facing: 'north', delay: '2'}}, {name: 'repeater', props: {facing: 'north', delay: 1}}));
  assert.ok(matches({name: 'repeater', props: {facing: 'north'}}, {name: 'repeater', props: {facing: 'north', delay: 1}}));
  assert.ok(matches({name: 'rail', props: {shape: 'north_east'}}, {name: 'rail', props: {shape: 'east_west'}}));
  assert.ok(!matches({name: 'rail', props: {shape: 'north_east'}}, {name: 'rail', props: {shape: 'east_west'}}, {final: true}));
  assert.ok(matches({name: 'chest', props: {facing: 'north', type: 'left'}}, {name: 'chest', props: {facing: 'north', type: 'left'}}, {final: true}));
  for (const name of ['piston_head', 'moving_piston']) assert.ok(skip(name, {}));
  for (const [name, props] of [['oak_door', {half: 'upper'}], ['red_bed', {part: 'head'}], ['tall_grass', {half: 'upper'}]]) {
    assert.strictEqual(skip(name, props), true);
    assert.strictEqual(skip(`minecraft:${name}`, props), true);
    assert.strictEqual(placement(name, props), null);
  }
  for (const [name, props] of [['oak_door', {half: 'lower'}], ['red_bed', {part: 'foot'}], ['glass', {}]]) assert.strictEqual(skip(name, props), false);
  assert.strictEqual(skip('stone'), false);
  assert.deepStrictEqual(placement('glass'), {item: 'glass', check: [], ways: all});
  const b = (name, props = {}) => ({name, props});
  for (const [want, have] of [
    [b('oak_stairs', {facing: 'north', half: 'bottom', shape: 'straight'}), b('oak_stairs', {facing: 'north', half: 'bottom', shape: 'inner_left', waterlogged: 'true'})],
    [b('oak_fence', {north: 'true'}), b('minecraft:oak_fence', {north: 'false'})],
    [b('minecraft:glass', {waterlogged: 'false'}), b('glass', {waterlogged: 'true'})],
    [b('lantern', {hanging: 'true'}), b('lantern', {hanging: true})],
    [b('oak_door', {facing: 'east', half: 'lower', hinge: 'left'}), b('oak_door', {facing: 'east', half: 'lower', hinge: 'right'})],
  ]) assert.strictEqual(matches(want, have), true);
  for (const [want, have] of [
    [b('oak_log', {axis: 'x'}), b('oak_log', {axis: 'z'})],
    [b('oak_slab', {type: 'double'}), b('oak_slab', {type: 'bottom'})],
    [b('oak_stairs', {facing: 'north', half: 'bottom'}), b('oak_stairs', {facing: 'south', half: 'bottom'})],
    [b('oak_stairs', {facing: 'north', half: 'bottom'}), b('oak_stairs', {facing: 'north', half: 'top'})],
    [b('lantern', {hanging: 'true'}), b('lantern', {hanging: 'false'})],
    [b('glass'), b('stone')], [b('oak_sign', {rotation: '0'}), b('oak_sign', {rotation: '0'})],
  ]) assert.strictEqual(matches(want, have), false);
  for (const [name, item] of [['wall_torch', 'torch'], ['soul_wall_torch', 'soul_torch'], ['oak_wall_sign', 'oak_sign'],
    ['oak_wall_hanging_sign', 'oak_hanging_sign'], ['white_wall_banner', 'white_banner'],
    ['player_wall_head', 'player_head'], ['skeleton_wall_skull', 'skeleton_skull'],
    ['redstone_wire', 'redstone'], ['tripwire', 'string'], ['stone', 'stone']]) {
    assert.strictEqual(itemOf(name), item);
    assert.strictEqual(itemOf(`minecraft:${name}`), item);
  }
  // a bed of any colour does (owner, 2026-10-18): one material, and a gray bed fills a white bed's cell, facing kept
  assert.deepStrictEqual(['gray_bed', 'red_bed', 'white_bed'].map(itemOf), ['white_bed', 'white_bed', 'white_bed']);
  const bedCell = {name: 'white_bed', props: {part: 'foot', facing: 'north'}};
  assert.ok(matches(bedCell, {name: 'gray_bed', props: {part: 'foot', facing: 'north'}}));
  assert.ok(!matches(bedCell, {name: 'gray_bed', props: {part: 'foot', facing: 'east'}}), 'the facing still counts');
  assert.ok(!matches({name: 'torch', props: {}}, {name: 'wall_torch', props: {facing: 'north'}}), 'other blocks stay apart');
  console.log('placing: block states ok');
}

(async () => {
  const assert = require('node:assert/strict');
  const {placeSchematic, buildOrder, parseLitematic} = require('../schematic');
  const b = (x, y, z, name, props = {}) => ({x, y, z, name, props});
  const parsed = {offset: {x: -2, y: 3, z: 1}, blocks: [
    b(0, 0, 0, 'oak_stairs', {facing: 'north', half: 'bottom', shape: 'inner_left'}),
    b(2, 0, 1, 'oak_log', {axis: 'x'}), b(1, 1, 2, 'rail', {shape: 'north_east'}),
    b(3, 1, 0, 'observer', {facing: 'up'}),
  ]};
  const snapshot = JSON.stringify(parsed), origin = {x: 10, y: 20, z: 30};
  const positions = [
    ['none', 0, [[8, 23, 31], [10, 23, 32], [11, 24, 31], [9, 24, 33]]],
    ['none', 90, [[8, 23, 30], [9, 23, 28], [7, 24, 29], [9, 24, 31]]],
    ['none', 180, [[10, 23, 28], [12, 23, 29], [11, 24, 27], [9, 24, 29]]],
    ['none', 270, [[11, 23, 32], [12, 23, 30], [11, 24, 29], [13, 24, 31]]],
    ['left_right', 0, [[10, 23, 28], [8, 23, 29], [9, 24, 27], [11, 24, 29]]],
    ['left_right', 90, [[11, 23, 28], [12, 23, 30], [13, 24, 29], [11, 24, 31]]],
    ['left_right', 180, [[12, 23, 31], [10, 23, 32], [9, 24, 31], [11, 24, 33]]],
    ['left_right', 270, [[8, 23, 30], [9, 23, 32], [9, 24, 29], [7, 24, 31]]],
    ['front_back', 0, [[12, 23, 31], [10, 23, 32], [9, 24, 31], [11, 24, 33]]],
    ['front_back', 90, [[8, 23, 30], [9, 23, 32], [9, 24, 29], [7, 24, 31]]],
    ['front_back', 180, [[10, 23, 28], [8, 23, 29], [9, 24, 27], [11, 24, 29]]],
    ['front_back', 270, [[11, 23, 28], [12, 23, 30], [13, 24, 29], [11, 24, 31]]],
  ];
  for (const [mirror, rotation, expected] of positions) {
    const placed = placeSchematic(parsed, {origin, mirror, rotation});
    assert.deepStrictEqual(placed.map(({x, y, z}) => [x, y, z]), expected.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]), `${mirror} ${rotation}`);
    assert.deepStrictEqual(placed.map(({name}) => name).sort(), parsed.blocks.map(({name}) => name).sort());
    assert.strictEqual(placed.find(({name}) => name === 'observer').props.facing, 'up');
  }
  assert.deepStrictEqual(placeSchematic(parsed, {origin}), placeSchematic(parsed, {origin, rotation: 0, mirror: 'none'}));
  const state = (name, props, rotation = 0, mirror = 'none') => placeSchematic({offset: {x: 0, y: 0, z: 0}, blocks: [b(0, 0, 0, name, props)]}, {origin, rotation, mirror})[0].props;
  assert.strictEqual(state('oak_stairs', {facing: 'north'}, 90).facing, 'east');
  assert.strictEqual(state('oak_log', {axis: 'x'}, 90).axis, 'z');
  assert.strictEqual(state('oak_log', {axis: 'y'}, 270).axis, 'y');
  assert.strictEqual(state('rail', {shape: 'north_east'}, 90).shape, 'south_east');
  assert.strictEqual(state('rail', {shape: 'north_east'}, 0, 'left_right').shape, 'south_east');
  assert.strictEqual(state('rail', {shape: 'ascending_north'}, 180).shape, 'ascending_south');
  assert.strictEqual(state('rail', {shape: 'north_south'}, 270).shape, 'east_west');
  assert.strictEqual(state('rail', {shape: 'east_west'}, 90).shape, 'north_south');
  assert.deepStrictEqual(state('chest', {facing: 'east', type: 'left'}, 0, 'front_back'), {facing: 'west', type: 'right'});
  assert.strictEqual(state('chest', {type: 'left'}, 90).type, 'left');
  assert.strictEqual(state('oak_door', {hinge: 'left'}, 0, 'left_right').hinge, 'right');
  assert.strictEqual(state('oak_door', {hinge: 'right'}, 90, 'front_back').hinge, 'left');
  assert.strictEqual(state('oak_door', {hinge: 'left'}, 90).hinge, 'left');
  for (const shape of ['inner_left', 'outer_right']) for (const mirror of ['left_right', 'front_back']) {
    assert.strictEqual(state('oak_stairs', {shape}, 90, mirror).shape, shape === 'inner_left' ? 'inner_right' : 'outer_left');
  }
  const sides = {north: 'side', east: 'up', south: 'none', west: 'side', power: '0'};
  assert.deepStrictEqual(state('redstone_wire', sides, 90), {east: 'side', south: 'up', west: 'none', north: 'side', power: '0'});
  assert.deepStrictEqual(state('redstone_wire', sides, 90, 'left_right'), {west: 'side', south: 'up', east: 'none', north: 'side', power: '0'});
  assert.deepStrictEqual(state('oak_fence', {north: 'true', west: 'false'}, 0, 'front_back'), {north: 'true', east: 'false'});
  assert.strictEqual(state('oak_sign', {rotation: '3'}, 90).rotation, '7');
  assert.strictEqual(state('oak_sign', {rotation: '3'}, 0, 'left_right').rotation, '13');
  assert.strictEqual(state('oak_sign', {rotation: '3'}, 90, 'left_right').rotation, '1');
  assert.strictEqual(state('oak_sign', {rotation: '3'}, 270, 'front_back').rotation, '1');
  for (const rotation of [45, -90, 360, '90', null]) assert.throws(() => placeSchematic(parsed, {origin, rotation}), /invalid rotation/);
  assert.throws(() => placeSchematic(parsed, {origin, mirror: 'bad'}), /invalid mirror/);
  assert.strictEqual(JSON.stringify(parsed), snapshot);

  const targets = [b(0, 1, 0, 'redstone_torch'), b(0, 1, 1, 'redstone_wire'),
    b(1, 0, 0, 'observer', {facing: 'up'}), b(1, 1, 0, 'repeater', {facing: 'north'}),
    b(2, 1, 0, 'oak_door', {half: 'upper'}), b(2, 0, 0, 'oak_door', {half: 'lower', facing: 'north', hinge: 'left'}),
    b(3, 0, 0, 'oak_sign', {rotation: '3'}), b(0, 0, 1, 'hopper', {facing: 'down'}), b(0, 0, 0, 'stone')];
  const before = JSON.stringify(targets);
  assert.deepStrictEqual(buildOrder(targets), {order: [targets[8], targets[5], targets[7], targets[3], targets[1], targets[2], targets[0]],
    deferred: new Set(['1,0,0', '0,1,0']), unsupported: [{x: 3, y: 0, z: 0, name: 'oak_sign'}], skipped: 1});
  assert.strictEqual(JSON.stringify(targets), before);
  assert.deepStrictEqual(buildOrder([]), {order: [], deferred: new Set(), unsupported: [], skipped: 0});
  const extras = [b(1, 0, 0, 'minecraft:oak_pressure_plate'), b(0, 0, 0, 'redstone_block'),
    b(0, 1, 0, 'oak_sign'), b(0, 0, 1, 'crafter'), b(2, 0, 0, 'red_bed', {part: 'head'}), b(3, 0, 0, 'piston_head')];
  assert.deepStrictEqual(buildOrder(extras), {order: [extras[1], extras[0]], deferred: new Set(['0,0,0', '1,0,0']),
    unsupported: [{x: 0, y: 0, z: 1, name: 'crafter'}, {x: 0, y: 1, z: 0, name: 'oak_sign'}], skipped: 2});
  const attached = [b(0, 0, 0, 'rail', {shape: 'north_south'}), b(1, 0, 0, 'stone_button', {face: 'floor', facing: 'north'}),
    b(2, 0, 0, 'white_carpet'), b(3, 0, 0, 'oak_trapdoor', {facing: 'north', half: 'bottom'}), b(4, 0, 0, 'stone')];
  assert.deepStrictEqual(buildOrder(attached).order, [attached[4], ...attached.slice(0, 4)]);

  // Rebuild the packed-region fixture above, whose helpers are scoped to its test block.
  const nbt = require('prismarine-nbt'), {gzipSync} = require('node:zlib');
  const xyz = (p) => ({type: 'compound', value: Object.fromEntries(Object.entries(p).map(([k, value]) => [k, {type: 'int', value}]))});
  const palette = Array.from({length: 32}, () => ({Name: {type: 'string', value: 'minecraft:stone'}}));
  for (const [i, name] of ['air', 'cave_air', 'void_air', 'structure_void'].entries()) palette[i].Name.value = `minecraft:${name}`;
  palette[17] = {Name: {type: 'string', value: 'minecraft:oak_log'}, Properties: {type: 'compound', value: {axis: {type: 'string', value: 'z'}}}};
  const region = (position, size, states) => {
    const packed = states.reduce((n, state, i) => n | (BigInt(state) << BigInt(i * 5)), 0n);
    const longs = Array.from({length: Math.ceil(states.length * 5 / 64)}, (_, i) => {
      const word = packed >> BigInt(i * 64);
      return [Number(BigInt.asIntN(32, word >> 32n)), Number(BigInt.asIntN(32, word))];
    });
    return {type: 'compound', value: {Position: xyz(position), Size: xyz(size),
      BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: longs}}};
  };
  const states = Array(32).fill(0); states[1] = 1; states[2] = 2; states[3] = 3; states[12] = 31; states[25] = 17; states[31] = 31;
  const neg = Array(12).fill(0); neg[0] = 17; neg[11] = 31;
  const fixture = await parseLitematic(gzipSync(nbt.writeUncompressed({type: 'compound', name: '', value: {
    Metadata: {type: 'compound', value: {Name: {type: 'string', value: 'packed test'}}},
    Regions: {type: 'compound', value: {
      positive: region({x: 10, y: 9, z: -5}, {x: 4, y: 2, z: 4}, states),
      negative: region({x: -4, y: 8, z: 3}, {x: -3, y: -2, z: -2}, neg),
    }},
  }})));
  assert.deepStrictEqual(buildOrder(fixture.blocks), {order: [fixture.blocks[3], fixture.blocks[4], fixture.blocks[0], fixture.blocks[1], fixture.blocks[2]],
    deferred: new Set(), unsupported: [], skipped: 0});
  console.log('schematic: placement and build order ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// Container contents ride on their block, sorted by slot, and count in the bill of materials.
(async () => {
  const assert = require('node:assert/strict');
  const nbt = require('prismarine-nbt');
  const {gzipSync} = require('node:zlib');
  const {parseLitematic, billOfMaterials, placeSchematic} = require('../schematic');
  const c = (value) => ({type: 'compound', value});
  const item = (slot, id, count) => ({Slot: {type: 'byte', value: slot}, id: {type: 'string', value: id}, Count: {type: 'byte', value: count}});
  const region = c({
    Position: c({x: {type: 'int', value: 0}, y: {type: 'int', value: 0}, z: {type: 'int', value: 0}}),
    Size: c({x: {type: 'int', value: 2}, y: {type: 'int', value: 1}, z: {type: 'int', value: 1}}),
    BlockStatePalette: {type: 'list', value: {type: 'compound', value: [{Name: {type: 'string', value: 'minecraft:air'}}, {Name: {type: 'string', value: 'minecraft:hopper'}}]}},
    BlockStates: {type: 'longArray', value: [[0, 4]]}, // cell 0 air, cell 1 hopper (2 bits each)
    TileEntities: {type: 'list', value: {type: 'compound', value: [
      {x: {type: 'int', value: 1}, y: {type: 'int', value: 0}, z: {type: 'int', value: 0}, Items: {type: 'list', value: {type: 'compound', value: [item(1, 'minecraft:shears', 1), item(0, 'minecraft:snowball', 2)]}}},
      {x: {type: 'int', value: 0}, y: {type: 'int', value: 0}, z: {type: 'int', value: 0}, Items: {type: 'list', value: {type: 'compound', value: []}}},
    ]}},
  });
  const buf = gzipSync(nbt.writeUncompressed({type: 'compound', name: '', value: {Regions: c({r: region})}}));
  const s = await parseLitematic(buf);
  const want = [{slot: 0, name: 'snowball', count: 2}, {slot: 1, name: 'shears', count: 1}];
  assert.deepStrictEqual(s.blocks, [{x: 0, y: 0, z: 0, name: 'hopper', props: {}, items: want}]);
  assert.deepStrictEqual(billOfMaterials(s.blocks).items, {snowball: 2, hopper: 1, shears: 1});
  assert.deepStrictEqual(placeSchematic(s, {origin: {x: 5, y: 6, z: 7}})[0].items, want);
  console.log('schematic: container contents ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });

// guardDigs: mineflayer's openContainer calls activateBlock without awaiting it; a refusal for a stopped
// job must not be an unhandled rejection (it ended the whole process, sandbox 2026-10-13).
(async () => {
  const assert = require('node:assert/strict');
  const {guardDigs} = require('../bots');
  const {Vec3} = require('vec3');
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const bot = {dig: async () => {}, equip: async () => {}, placeBlock: async () => {}, entity: {position: new Vec3(0, 62, 0)},
    blockAt: () => null, activateBlock: async () => 'clicked', openContainer: async () => 'window'};
  const runner = {current: {cancelled: false}, protectedAreas: []};
  guardDigs(runner, bot);
  assert.strictEqual(await bot.activateBlock({}), 'clicked');
  assert.strictEqual(await bot.openContainer({}), 'window');
  runner.current.cancelled = true;
  bot.activateBlock({}); // not awaited, as mineflayer's openBlock does
  await assert.rejects(bot.activateBlock({}), /Activating aborted/); // an awaiting caller still sees it
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', onUnhandled);
  assert.deepStrictEqual(unhandled, []);
  console.log('guardDigs: refused activations are handled');
})().catch((e) => { console.error(e); process.exitCode = 1; });
