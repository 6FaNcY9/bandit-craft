'use strict';
// Keep caps: what a deposit files above the per-bot keep caps (bot19 carried 448 sticks, 7 iron pickaxes and 3 tables, 2026-11-11).
const assert = require('node:assert/strict');
const {beyondKeep} = require('../bots');

const it = (name, count) => ({name, count, type: 1, metadata: 0});
assert.deepStrictEqual(beyondKeep([it('stick', 64), it('stick', 64), it('stick', 20)]).map((i) => [i.name, i.count]), [['stick', 64], ['stick', 20]], 'one stack of sticks stays');
assert.deepStrictEqual(beyondKeep([it('iron_pickaxe', 1), it('iron_pickaxe', 1), it('iron_pickaxe', 1)]).map((i) => i.name), ['iron_pickaxe'], 'two of each tool stay');
assert.deepStrictEqual(beyondKeep([it('crafting_table', 3)]).map((i) => i.count), [2], 'one table stays, a partial count leaves');
assert.deepStrictEqual(beyondKeep([it('coal', 40), it('charcoal', 40)]).map((i) => [i.name, i.count]), [['charcoal', 16]], 'coal and charcoal share one cap');
assert.deepStrictEqual(beyondKeep([it('oak_planks', 64), it('birch_planks', 64), it('oak_planks', 10)]).map((i) => [i.name, i.count]), [['oak_planks', 10]], 'every planks kind has its own cap');
assert.deepStrictEqual(beyondKeep([it('oak_log', 64), it('bread', 64), it('torch', 64)]), [], 'logs and food are not keep items; torches at the cap stay');
