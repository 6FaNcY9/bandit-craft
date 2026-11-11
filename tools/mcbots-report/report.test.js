'use strict';
// node tools/mcbots-report/report.test.js
const assert = require('node:assert/strict');
const {summarize} = require('./report');

const DAY = 86400000, now = Date.UTC(2026, 10, 11, 12);
const ev = (t, bot, kind, text) => JSON.stringify({server_session: 'a', event: {id: 1, t, bot, kind, text}});
const lines = [
  ev(now - 3600000, 'bot19', 'fail', 'failed: goto -12 64 33 - No path to the goal!'),
  ev(now - 7200000, 'bot19', 'fail', 'failed: goto 140 70 -2 - No path to the goal!'),
  ev(now - 1000, 'bot1', 'death', 'died at -300 60 -830: drowned'),
  ev(now - 2000, 'bot1', 'death', 'died at -310 61 -830: was slain by Guardian'),
  '{"broken',
  ev(now - 5 * DAY, 'bot2', 'fail', 'failed: old'),
  ev(now - 500, 'bot1', 'done', 'finished: stock -271 66 -214 (25 s)'),
  '',
];
const s = summarize(lines, {days: 4, now});
assert.equal(s.bad, 1, 'a malformed line is counted, not fatal; blank lines are not lines');
assert.deepEqual(s.fails, [{bot: 'bot19', text: 'failed: goto # # # - No path to the goal!', n: 2}], 'digits masked, the same fail collapses');
assert.deepEqual(s.deaths, [{bot: 'bot1', cell: '-320,-832', n: 2}], 'deaths 10 blocks apart share a 32-block cell');
assert.deepEqual(s.perBotDay, {bot19: {'2026-11-11': {done: 0, fail: 2, death: 0}}, bot1: {'2026-11-11': {done: 1, fail: 0, death: 2}}}, 'older than 4 days is ignored');
console.log('mcbots-report ok');
