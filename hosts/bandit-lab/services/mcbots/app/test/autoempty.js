'use strict';
// Servants empty into their own chest after work (bots.js shouldEmpty), and the bot screen says where the chest is.
const assert = require('node:assert/strict');
const {shouldEmpty} = require('../bots');
const screens = require('../botui-screens');

const job = (type) => ({id: 1, type, args: {}, status: 'done'});
const prefs = {chest: {x: 1, y: 2, z: 3}};
for (const t of ['mine', 'chop', 'get', 'shift', 'shiftlogs', 'excavate', 'clear', 'treefarm', 'wheatfarm', 'hunt', 'produce', 'graves']) {
  assert.equal(shouldEmpty(job(t === 'shiftlogs' ? 'shift' : t), [], prefs, 3), true, t);
}
assert.equal(shouldEmpty(job('mine'), [job('chop')], prefs, 3), false, 'queue still has work');
for (const t of ['deposit', 'withdraw', 'stock', 'trade', 'come', 'follow', 'guard', 'goto', 'setchest']) assert.equal(shouldEmpty(job(t), [], prefs, 3), false, t);
assert.equal(shouldEmpty(job('mine'), [], {}, 3), false, 'no chest');
assert.equal(shouldEmpty(job('mine'), [], prefs, 0), false, 'nothing to empty');
assert.equal(shouldEmpty(Object.create(job('mine')), [], prefs, 3), false, 'child job');
assert.equal(shouldEmpty({...job('get'), status: 'failed'}, [], prefs, 3), true, 'failed get');
assert.equal(shouldEmpty({...job('mine'), status: 'stopped'}, [], prefs, 3), false, 'stopped');
assert.equal(shouldEmpty({...job('mine'), interrupted: true}, [], prefs, 3), false, 'interrupted');

{ // bot screen line
  const text = (s) => JSON.stringify(s);
  const view = (chest) => ({snaps: [{name: 'MisaBot', online: true, health: 20, food: 20, freeSlots: 5, chest}], allowed: ['MisaBot']});
  const withChest = text(screens.bot(view({x: 1, y: 64, z: -3}), 'MisaBot'));
  const without = text(screens.bot(view(null), 'MisaBot'));
  assert.ok(withChest.includes('Kiste: 1 64 -3'), withChest.slice(0, 300));
  assert.ok(without.includes('Kiste: keine – Zauberstab auf eine Kiste'));
}
console.log('autoempty ok');
