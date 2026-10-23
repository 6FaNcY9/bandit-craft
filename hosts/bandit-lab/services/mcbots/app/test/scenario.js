'use strict';
const assert = require('node:assert');
// ---- scenario: sandbox reset lines, the "box empty" check, run measurement ----
{
  const {resetCommands, emptyCheck, measure, SCENARIOS} = require('../scenario');
  const box = {x1: 0, y1: 60, z1: 0, x2: 15, y2: 67, z2: 15};
  assert.deepStrictEqual(resetCommands({box}), ['fill 0 60 0 15 67 15 stone', 'fill 0 68 0 15 68 15 air']);
  assert.deepStrictEqual(resetCommands({box: {x1: 15, y1: 67, z1: 15, x2: 0, y2: 60, z2: 0}, fill: 'dirt'}), ['fill 0 60 0 15 67 15 dirt', 'fill 0 68 0 15 68 15 air']);
  assert.throws(() => resetCommands({box: {x1: 0, y1: 0, z1: 0, x2: 63, y2: 15, z2: 63}}), /too big for one fill/);
  assert.strictEqual(emptyCheck(box), 'execute if blocks 0 60 0 15 67 15 0 300 0 all');

  const bot = (done, extra = {}) => ({name: 'bot5', online: true, dead: false, job: {type: 'part', done}, ...extra});
  const flat = [0, 20, 40, 61].map((s) => ({t: s * 1000, bots: [bot(120)]}));
  assert.deepStrictEqual(measure(flat), {ms: 61000, stalls: 1, deaths: 0});
  const steady = [0, 20, 40, 61, 80].map((s, i) => ({t: s * 1000, bots: [bot(i * 10)]}));
  assert.deepStrictEqual(measure(steady), {ms: 80000, stalls: 0, deaths: 0});
  // Idle bots are no stall (the job is over or waits for a bot); one long stall counts once.
  const idle = [0, 30, 70].map((s) => ({t: s * 1000, bots: [{name: 'bot5', online: true, dead: false, job: null}]}));
  assert.strictEqual(measure(idle).stalls, 0);
  assert.strictEqual(measure([0, 61, 122, 200].map((s) => ({t: s * 1000, bots: [bot(5)]}))).stalls, 1);
  // A death counts when the bot turns dead, not for every sample it stays dead.
  const dying = [false, true, true, false, true].map((dead, i) => ({t: i * 1000, bots: [bot(i, {dead})]}));
  assert.strictEqual(measure(dying).deaths, 2);

  for (const [name, scn] of Object.entries(SCENARIOS)) assert.ok(resetCommands(scn).length === 2 && scn.job.box, name);
}
console.log('ok');
