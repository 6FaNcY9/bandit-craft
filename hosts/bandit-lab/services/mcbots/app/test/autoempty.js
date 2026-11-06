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
{ // setchest applies at once: queue and running job stay untouched; unseen chunk accepted, a seen non-chest refused
  const {BotRunner} = require('../bots');
  const saved = [];
  const r = Object.create(BotRunner.prototype);
  Object.assign(r, {online: true, name: 'MisaBot', prefs: {}, prefsFile: null, bot: {blockAt: () => null}, queue: [job('chop')], current: job('mine'), emit: (k, t) => saved.push(t)});
  r.enqueue('setchest', {x: 5, y: 64, z: 7});
  assert.deepEqual(r.prefs.chest, {x: 5, y: 64, z: 7}); assert.equal(r.queue.length, 1); assert.equal(r.current.type, 'mine'); assert.deepEqual(saved, ['Kiste: 5 64 7']);
  r.bot.blockAt = () => ({name: 'stone'});
  assert.throws(() => r.enqueue('setchest', {x: 9, y: 64, z: 9}), /keine Kiste bei 9 64 9/); assert.deepEqual(r.prefs.chest, {x: 5, y: 64, z: 7});
  r.bot.blockAt = () => ({name: 'barrel'}); r.enqueue('setchest', {x: 9, y: 64, z: 9}); assert.equal(r.prefs.chest.x, 9);
  r.online = false; assert.throws(() => r.enqueue('setchest', {x: 1, y: 2, z: 3}), /offline/);
}
console.log('autoempty ok');
