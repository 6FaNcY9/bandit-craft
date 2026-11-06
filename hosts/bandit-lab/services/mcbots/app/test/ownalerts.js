'use strict';
// Owner alerts and the join digest: classification, rights, rate limit.
const assert = require('node:assert/strict');
const {classify, text, ownersOf, OwnAlerts, digest} = require('../ownalerts');
const ev = (bot, kind, t, text, id = 0) => ({id, t, bot, kind, text});

assert.equal(classify(ev('b', 'death', 0, 'died at 1 2 3: zombie')), 'dead');
assert.equal(classify(ev('b', 'fail', 0, 'no progress for 30 s: x')), 'stuck');
assert.equal(classify(ev('b', 'fail', 0, 'goto: No path')), 'stuck');
assert.equal(classify(ev('b', 'fail', 0, 'no way to get 3 iron_ingot (for pick)')), 'missing');
assert.equal(classify(ev('b', 'done', 0, 'finished: chop (700 s)')), 'done');
assert.equal(classify(ev('b', 'done', 0, 'finished: chop (599 s)')), null);
assert.equal(classify(ev('b', 'info', 0, 'hello')), null);
assert.equal(text('dead', ev('b', 'death', 0, 'died at 1 -2 3: x')), 'tot bei 1 -2 3');
assert.equal(text('stuck', ev('b', 'fail', 0, 'No path'), {pos: [1.2, 64.9, -3]}), 'steckt fest bei 1 65 -3: kein Weg');
assert.equal(text('missing', ev('b', 'fail', 0, 'no way to get 3 iron_ingot (for pick)')), 'fehlt: 3 iron_ingot (for pick)');
assert.equal(text('done', ev('b', 'done', 0, 'finished: chop (700 s)')), 'fertig: chop');
assert.ok(text('missing', ev('b', 'fail', 0, 'no way to get ' + 'x'.repeat(190))).length <= 100);

const vb = {Bandit: '*', Misa: ['MisaBot', 'EM_Trader'], Midari: ['MisaBot', 'EM_Trader']};
assert.deepEqual(ownersOf('bot2', vb), ['Bandit']);
assert.deepEqual(ownersOf('MisaBot', vb), ['Bandit', 'Misa', 'Midari']);

let t = 0; const said = [];
const a = new OwnAlerts({say: (...x) => said.push(x), viewerBots: vb, now: () => t});
a.event(ev('bot2', 'death', 0, 'died at 1 2 3')); // Misa and Midari never hear about bot2
assert.deepEqual(said.map((s) => s[0]), ['Bandit']);
said.length = 0;
a.event(ev('MisaBot', 'fail', 0, 'No path')); a.event(ev('MisaBot', 'fail', 0, 'No path'));
assert.equal(said.filter((s) => s[0] === 'Misa').length, 1);
t = 599999; a.event(ev('MisaBot', 'fail', 0, 'No path')); assert.equal(said.filter((s) => s[0] === 'Misa').length, 1);
t = 600000; a.event(ev('MisaBot', 'fail', 0, 'No path')); assert.equal(said.filter((s) => s[0] === 'Misa').length, 2);

const log = [ev('bot2', 'death', 50, 'died at 1 2 3'), ev('MisaBot', 'death', 60, 'died at 4 5 6'), ev('EM_Trader', 'fail', 70, 'No path'), ev('MisaBot', 'info', 80, 'x'), ev('MisaBot', 'death', 5, 'old')];
assert.deepEqual(digest(log, ['MisaBot', 'EM_Trader'], null, 100), [], 'no last quit = no digest');
const d = digest(log, ['MisaBot', 'EM_Trader'], 10, 100);
assert.deepEqual(d, ['Seit du weg warst:', 'EM_Trader: steckt fest: kein Weg', 'MisaBot: tot bei 4 5 6']);
assert.equal(digest([...Array(20)].map((_, i) => ev('MisaBot', 'death', 20 + i, 'died at 1 2 3')), ['MisaBot'], 10, 100).length, 6);
assert.deepEqual(digest(log, ['MisaBot'], 99, 100), []);
