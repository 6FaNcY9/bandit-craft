'use strict';
// Mitmachen (joins.js): join copies the build's args, leave gives back the old order, a limited viewer gains no rights.
const assert = require('node:assert/strict');
const {makeJoins, planName} = require('../joins');
const {Projects} = require('../projects');

const viewerBots = {fancy8869: '*', MidariBread: ['MisaBot', 'EM_Trader']}, viewers = Object.keys(viewerBots);
const projects = new Projects(''), orders = new Map(), submits = [], released = [];
const sorter = {file: 'sorter.litematic', origin: {x: -308, y: 111, z: 11}, rotation: 0, mirror: 'none', chests: []};
const own = {file: 'fancy8869-kirche.litematic', origin: {x: -108, y: 24, z: 180}, rotation: 0, mirror: 'none', chests: []}; // the owner's upload: not Midari's to see
const far = {file: 'turm.litematic', origin: {x: 5000, y: 70, z: 5000}, rotation: 0, mirror: 'none', chests: []};
projects.note('bot1', 'schematic', sorter); projects.note('bot2', 'schematic', sorter); projects.note('bot3', 'schematic', own);
projects.note('bot4', 'schematic', far); projects.note('bot5', 'shaft', {x1: 0, z1: 0, x2: 3, z2: 3}); projects.note('bot6', 'schematic', {...sorter, file: 'alt.litematic'}); projects.pause('bot6');
// ground() as server.js: a guest's bot only where her areas allow (here: not far out)
const ground = (viewer, bot, type, args) => { if (viewerBots[viewer] !== '*' && bot === 'MisaBot' && args.origin?.x > 1000) throw new Error('Fremdes Gelände'); };
// submit as server.js: rights first, then the order replaces the project and becomes the owner order
const submit = (viewer, {bots, type, args, replace}) => {
  for (const b of bots) { if (viewerBots[viewer] !== '*' && !viewerBots[viewer].includes(b)) throw new Error('nicht dein Bot'); ground(viewer, b, type, args); }
  submits.push({viewer, bots, type, args, replace});
  for (const b of bots) {
    if (type === 'stop' || replace) projects.pause(b);
    if (type === 'stop') orders.delete(b); else orders.set(b, {type, args});
    if (type === 'schematic' || type === 'produce') projects.note(b, type, args);
  }
  return {ok: true, unreached: []};
};
const j = makeJoins({projects, orders, viewerBots, viewers, ground, submit, release: (b) => released.push(b)});

assert.equal(planName('sorter.litematic'), 'Sorter');
// the owner sees every running build of the others, grouped, paused and non-build projects left out
assert.deepEqual(j.joinable('fancy8869', 'MisaBot'), [{name: 'Sorter', bots: ['bot1', 'bot2'], at: {x: -308, y: 111, z: 11}}, {name: 'Fancy8869-kirche', bots: ['bot3'], at: {x: -108, y: 24, z: 180}}, {name: 'Turm', bots: ['bot4'], at: {x: 5000, y: 70, z: 5000}}]);
// the limited viewer: never for a bot she may not control, and never into the owner's builds
assert.throws(() => j.joinable('MidariBread', 'bot7'), /nicht dein Bot/);
assert.throws(() => j.join('MidariBread', 'bot7', 'bot1'), /nicht dein Bot/);
assert.deepEqual(j.joinable('MidariBread', 'MisaBot'), []);
assert.throws(() => j.join('MidariBread', 'MisaBot', 'bot2'), /Gerade läuft kein Bau/);
assert.throws(() => j.join('MidariBread', 'MisaBot', 'bot3'), /Gerade läuft kein Bau/);
assert.throws(() => j.join('MidariBread', 'MisaBot', 'bot4'), /Gerade läuft kein Bau/);
assert.equal(submits.length, 0);

// join copies the args with replace; leave stops and gives back the old order
orders.set('MisaBot', {type: 'chop', args: {count: 64, near: true}});
assert.equal(j.join('fancy8869', 'MisaBot', 'bot2'), 'Sorter');
assert.deepEqual(submits.at(-1), {viewer: 'fancy8869', bots: ['MisaBot'], type: 'schematic', args: sorter, replace: true});
assert.deepEqual(j.joined(), {MisaBot: 'Sorter'});
assert.deepEqual(j.joinable('fancy8869', 'bot9')[0].bots, ['bot1', 'bot2', 'MisaBot'], 'the joined bot counts as one of the crew');
assert.equal(j.join('fancy8869', 'MisaBot', 'bot3'), 'Fancy8869-kirche'); // a second join keeps the first order
assert.equal(j.leave('fancy8869', 'MisaBot'), 'Fancy8869-kirche');
assert.deepEqual(submits.slice(-2).map((s) => [s.type, s.args]), [['stop', {}], ['chop', {count: 64, near: true}]]);
assert.deepEqual(j.joined(), {}); assert.deepEqual(released, []);
assert.throws(() => j.leave('fancy8869', 'MisaBot'), /macht bei nichts mit/);
// without an old order "Wenn frei" takes over; a join ends when the bot's project is stopped elsewhere
j.join('fancy8869', 'EM_Trader', 'bot1'); j.leave('MidariBread', 'EM_Trader');
assert.deepEqual(released, ['EM_Trader']); assert.equal(submits.at(-1).type, 'stop');
j.join('fancy8869', 'EM_Trader', 'bot1');
// a build her own bot is in is hers to join with her other bot; the owner's bots stay unnamed
assert.deepEqual(j.joinable('MidariBread', 'MisaBot').map((g) => [g.name, g.bots]), [['Sorter', ['EM_Trader']]]);
projects.pause('EM_Trader');
assert.deepEqual(j.joined(), {});
console.log('joins ok');
