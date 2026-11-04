'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {TraderChests} = require('../traderchests');
const {VALIDATE} = require('../bots');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')), file = path.join(dir, 'trader-chests.json');
  const box = {x1: 0, y1: 60, z1: 0, x2: 20, y2: 70, z2: 20};
  const halls = {misa: {hall: box, stores: [{x: 1, y: 61, z: 1}], sticks: [{x: 2, y: 61, z: 2}]}};
  const shared = halls, log = [];
  let changes = 0;
  const t = new TraderChests({file, halls, log: (m) => log.push(m), onChange: () => { changes++; }});
  assert.deepEqual(t.list('MisaBot'), {sticks: [], stores: []});
  assert.equal(halls.misa.stores.length, 1, 'nothing set: configured chests stay');
  t.add('misa', 'sticks', {x: 5, y: 62, z: 5}); t.add('misa', 'sticks', {x: 5, y: 62, z: 5}); t.add('misa', 'sticks', {x: 6, y: 62, z: 5});
  assert.deepEqual(t.list('Misa').sticks, [{x: 5, y: 62, z: 5}, {x: 6, y: 62, z: 5}]);
  assert.strictEqual(halls, shared); assert.equal(halls.misa.sticks.length, 2, 'the override shows in the shared object');
  assert.deepEqual(halls.misa.stores, [{x: 1, y: 61, z: 1}], 'the other kind keeps the configured chests');
  assert.ok(changes >= 2);
  // another bot without a hall of its own starts from Misa's hall, Misa's stays
  t.add('EM_Trader', 'stores', {x: 9, y: 62, z: 9});
  assert.deepEqual(halls.em_trader.stores, [{x: 9, y: 62, z: 9}]); assert.deepEqual(halls.em_trader.hall, box); assert.equal(halls.misa.sticks.length, 2);
  assert.doesNotThrow(() => VALIDATE.trade(halls.em_trader));
  // survives a reload
  const halls2 = JSON.parse(JSON.stringify({misa: halls.misa && {hall: box, stores: [{x: 1, y: 61, z: 1}], sticks: [{x: 2, y: 61, z: 2}]}}));
  const t2 = new TraderChests({file, halls: halls2});
  assert.deepEqual(halls2.misa.sticks, [{x: 5, y: 62, z: 5}, {x: 6, y: 62, z: 5}]); assert.deepEqual(t2.list('em_trader').stores, [{x: 9, y: 62, z: 9}]);
  // removing the last one restores the configured chests, and an entry made for the bot goes away
  t.remove('misa', 'sticks', {x: 5, y: 62, z: 5}); t.remove('misa', 'sticks', {x: 6, y: 62, z: 5}); t.remove('em_trader', 'stores', {x: 9, y: 62, z: 9});
  assert.deepEqual(halls, {misa: {hall: box, stores: [{x: 1, y: 61, z: 1}], sticks: [{x: 2, y: 61, z: 2}]}});
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
  t.remove('misa', 'sticks', {x: 99, y: 1, z: 1}); // unknown: no-op
  // hostile input
  for (const bad of [{x: 1, y: 2}, {x: 'a', y: 1, z: 1}, {x: 1.5, y: 1, z: 1}, null]) assert.throws(() => t.add('misa', 'sticks', bad));
  assert.throws(() => t.add('misa', 'chests', {x: 1, y: 1, z: 1}), /kind/);
  assert.throws(() => t.add('misa', '__proto__', {x: 1, y: 1, z: 1}), /kind/);
  for (let i = 0; i < 8; i++) t.add('misa', 'stores', {x: i, y: 1, z: 1});
  assert.throws(() => t.add('misa', 'stores', {x: 50, y: 1, z: 1}), /at most 8/);
  // a hall without a box (the built-in one) takes the first store as x y z
  const h3 = {}, t3 = new TraderChests({file: null, halls: h3});
  t3.add('EM_Trader', 'stores', {x: 3, y: 4, z: 5});
  assert.deepEqual(h3.em_trader, {x: 3, y: 4, z: 5}); assert.doesNotThrow(() => VALIDATE.trade(h3.em_trader));
  // sticks on the built-in hall survive validation (the live config is {"misa":{}})
  const h5 = {misa: {}}, t5 = new TraderChests({file: null, halls: h5});
  t5.add('EM_Trader', 'sticks', {x: 3, y: 4, z: 5});
  assert.deepEqual(VALIDATE.trade(h5.em_trader).sticks, [{x: 3, y: 4, z: 5}]);
  assert.throws(() => VALIDATE.trade({sticks: 'no'}), /sticks/);
  // a corrupt file logs and starts empty
  fs.writeFileSync(file, '{nope');
  const msgs = [], h4 = {misa: {}}, t4 = new TraderChests({file, halls: h4, log: (m) => msgs.push(m)});
  assert.equal(msgs.length, 1); assert.deepEqual(t4.list('misa'), {sticks: [], stores: []}); assert.deepEqual(h4, {misa: {}});
  fs.rmSync(dir, {recursive: true});
}
console.log('traderchests ok');
