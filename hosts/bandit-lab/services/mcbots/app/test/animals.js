'use strict';
// Animal pens: census of the box and the plan of one round (breed, shear, cull), on plain entity objects.
{
  const assert = require('node:assert/strict');
  const {named, baby} = require('../hunt');
  const {KINDS, census, sheared, planRound} = require('../animals');
  const box = {x1: 0, z1: 0, x2: 9, z2: 9};
  const mob = (id, name, x = 5, z = 5, metadata = {}) => ({id, name, type: 'animal', position: {x, y: 64, z}, metadata});
  const ids = (es) => es.map((e) => e.id);
  const have = {food: {wheat: 16, carrot: 16, wheat_seeds: 16}, shears: true};
  const opts = (o = {}) => ({now: 1e6, fed: new Map(), shorn: new Map(), have, paused: false, ...o});
  const herd = (name, n, from = 1) => Array.from({length: n}, (_, i) => mob(from + i, name));

  assert.deepStrictEqual(Object.keys(KINDS), ['cow', 'sheep', 'pig', 'chicken']);
  assert.equal(KINDS.pig.food, 'carrot');
  assert.equal(named(mob(1, 'cow', 5, 5, {2: 'Berta'})), true);
  assert.equal(named(mob(1, 'cow')), false);
  assert.equal(baby(mob(1, 'cow', 5, 5, {16: true})), true);

  // Named, baby, horse, outside the box, invalid or in a protected area: not counted as adults; the edge counts.
  const c = census([
    mob(1, 'cow'), mob(2, 'cow', 9.9, 0), mob(3, 'cow', 5, 5, {2: 'Berta'}), mob(4, 'cow', 5, 5, {16: true}),
    mob(5, 'horse'), mob(6, 'wolf'), mob(7, 'cow', 10.1, 5), mob(8, 'cow', -0.5, 5), {...mob(9, 'cow'), isValid: false},
    mob(10, 'pig', 1, 1), mob(11, 'sheep', 8, 8)], box, [[0, 0, 2, 2]]);
  assert.deepStrictEqual(ids(c.cow.adults), [1, 2]);
  assert.equal(c.cow.babies, 1);
  assert.deepStrictEqual(Object.keys(c), ['cow', 'sheep', 'pig', 'chicken']);
  assert.deepStrictEqual(ids(c.pig.adults), []); // protected area
  assert.deepStrictEqual(ids(c.sheep.adults), [11]);

  // Breeding: the two lowest unfed ids; fed within 5 minutes are skipped, older feeds count as unfed.
  const two = {cow: {adults: [mob(9, 'cow'), mob(3, 'cow')], babies: 0}};
  assert.deepStrictEqual(ids(planRound(two, opts()).cow.breed), [3, 9]);
  const five = {cow: {adults: herd('cow', 5).reverse(), babies: 0}};
  const fed = new Map([[1, 1e6 - 1000], [2, 1e6 - 300000]]);
  assert.deepStrictEqual(ids(planRound(five, opts({fed})).cow.breed), [2, 3]);
  assert.equal(planRound({cow: {adults: herd('cow', 2), babies: 0}}, opts({fed: new Map([[1, 1e6 - 1]])})).cow.breed, null);

  // No breed: 1 adult, 16 in the pen (babies too), or no food; lacks names the food only in the last case.
  const one = planRound({cow: {adults: herd('cow', 1), babies: 0}}, opts()).cow;
  assert.deepStrictEqual([one.breed, one.lacks], [null, []]);
  assert.equal(planRound({cow: {adults: herd('cow', 10), babies: 6}}, opts()).cow.breed, null);
  const hungry = planRound({pig: {adults: herd('pig', 2), babies: 0}}, opts({have: {food: {wheat: 16}, shears: true}})).pig;
  assert.deepStrictEqual([hungry.breed, hungry.lacks], [null, ['carrot']]);

  // Cull above 8 adults, at most 4 a round, from the highest ids; named and baby animals never.
  const cull = (n) => ids(planRound({cow: {adults: herd('cow', n), babies: 0}}, opts()).cow.cull);
  assert.deepStrictEqual(cull(12), [12, 11, 10, 9]);
  assert.deepStrictEqual(cull(9), [9]);
  assert.deepStrictEqual(cull(8), []);
  const pets = [...herd('cow', 9), mob(20, 'cow', 5, 5, {2: 'Berta'}), mob(21, 'cow', 5, 5, {16: true})];
  const p = planRound({cow: {adults: pets, babies: 0}}, opts()).cow;
  assert.deepStrictEqual(ids(p.cull), [9]);
  assert.ok(!(p.breed ?? []).some((e) => e.id >= 20) && !p.shear.length);
  const raw = census(pets, box, []);
  const q = planRound(raw, opts()).cow;
  assert.ok(![...(q.breed ?? []), ...q.cull].some((e) => named(e) || baby(e)));

  // Shearing: woolly adults only; a sheared one or one shorn within 5 minutes (flag misread) is skipped.
  assert.equal(sheared(mob(1, 'sheep', 5, 5, {18: 0x10})), true);
  assert.equal(sheared(mob(1, 'sheep', 5, 5, {18: 0x03})), false);
  assert.equal(sheared(mob(1, 'sheep')), false);
  const flock = {sheep: {adults: [mob(1, 'sheep', 5, 5, {18: 0x10}), mob(2, 'sheep'), mob(3, 'sheep'), mob(4, 'sheep', 5, 5, {2: 'Dolly'})], babies: 0}};
  const shorn = new Map([[2, 1e6 - 60000]]);
  assert.deepStrictEqual(ids(planRound(flock, opts({shorn})).sheep.shear), [3]);
  assert.deepStrictEqual(ids(planRound(flock, opts({shorn: new Map([[2, 1e6 - 300000]])})).sheep.shear), [2, 3]);
  const bare = planRound(flock, opts({have: {...have, shears: false}})).sheep;
  assert.deepStrictEqual([bare.shear, bare.lacks], [[], ['shears']]);
  assert.deepStrictEqual(planRound({sheep: {adults: [mob(1, 'sheep', 5, 5, {18: 0x10})], babies: 0}}, opts({have: {...have, shears: false}})).sheep.lacks, []);

  // Paused: an empty plan for every kind.
  const empty = {breed: null, shear: [], cull: [], lacks: []};
  const all = {cow: {adults: herd('cow', 12), babies: 0}, sheep: {adults: herd('sheep', 3, 50), babies: 0}, pig: {adults: [], babies: 0}, chicken: {adults: herd('chicken', 2, 80), babies: 0}};
  assert.deepStrictEqual(planRound(all, opts({paused: true, have: {food: {}, shears: false}})), {cow: empty, sheep: empty, pig: empty, chicken: empty});
  // a pen cull never holds a sword (no sweep onto a named animal or a calf); the hunt job takes the best of all
  const {pickWeapon} = require('../hunt');
  const bag = [{name: 'iron_sword'}, {name: 'stone_axe'}, {name: 'dirt'}];
  assert.equal(pickWeapon(bag, true).name, 'stone_axe');
  assert.equal(pickWeapon([{name: 'iron_sword'}, {name: 'dirt'}], true), undefined);
  assert.equal(pickWeapon(bag, false).name, 'iron_sword');
  console.log('animals ok');
}
