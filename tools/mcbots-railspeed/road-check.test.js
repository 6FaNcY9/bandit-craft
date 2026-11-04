'use strict';
const assert = require('node:assert');
const {allStops, changes, reader} = require('./road-check');
const road = {dir: 'east', origin: {x: 0, y: 0, z: 0}};
const rock = () => { const c = {}; for (let k = 0; k <= 60; k++) for (let s = -3; s <= 3; s++) for (let h = -3; h <= 4; h++) c[`${k},${h},${s}`] = 'deepslate||'; return c; };
assert.deepStrictEqual(allStops(reader(rock()), road, 8, 50), []);
{ // all of them, not only the first
  const c = rock();
  c['20,0,3'] = 'oak_stairs||';
  c['40,1,0'] = 'chest||';
  const list = allStops(reader(c), road, 8, 50);
  assert.deepStrictEqual(list.map((s) => [s.k, s.why, s.name]), [[20, 'player', 'oak_stairs'], [40, 'keep', 'chest']]);
}
{ // a chunk missing ends the list: nothing past it is known
  const c = rock();
  delete c['30,0,0'];
  assert.deepStrictEqual(allStops(reader(c), road, 8, 50).map((s) => [s.k, s.why]), [[30, 'unloaded']]);
}
{ // the road's own cells may change; a player's block, or a cell off the road, may not
  const was = rock(), ok = {...was, '10,0,0': 'rail||east_west', '10,1,0': 'air|e|', '12,0,1': 'redstone_torch|e|'};
  assert.deepStrictEqual(changes(was, ok, road, 50), {changed: 3, bad: []});
  const off = {...was, '10,1,3': 'air|e|'};
  assert.match(changes(was, off, road, 50).bad[0], /10,1,3: deepslate -> air, not the road's cell/);
  assert.deepStrictEqual(changes({'2,1,-3': 'deepslate'}, {'2,1,-3': 'air'}, road, 50), {changed: 1, bad: []}, 'the room at the origin is the road\'s too');
  const gone = {...was, '10,1,0': 'air|e|'}, built = {...was, '10,1,0': 'oak_stairs||'};
  assert.match(changes(built, gone, road, 50).bad[0], /a oak_stairs is gone/);
}
console.log('ok');
