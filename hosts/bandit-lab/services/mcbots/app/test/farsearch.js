'use strict';
// Far search: heading choice, compass names, failure text. No Minecraft server.
(() => {
  const assert = require('node:assert/strict');
  const {DIRS, hopTarget, farHeading, farFail, FAR_HOP} = require('../farsearch');
  const {germanReason} = require('../owner');
  const orderOutcome = require('../agentauth').orderOutcome;
  const name = (i) => DIRS[i].en;
  // Minecraft north is -z
  assert.equal(DIRS[0].de, 'Norden'); assert.equal(hopTarget({x: 0, z: 0}, DIRS[0]).z, -FAR_HOP);
  assert.equal(DIRS[4].de, 'Süden'); assert.equal(hopTarget({x: 0, z: 0}, DIRS[4]).z, FAR_HOP);
  assert.deepEqual(DIRS.map((d) => d.de), ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten']);
  // away from the base: the bot at (100, 0), base at the origin -> east
  assert.equal(name(farHeading({x: 100, z: 0}, [], {x: 0, z: 0})), 'east');
  assert.equal(name(farHeading({x: 100, z: 0}, [], {x: 0, z: 0}, [2])), 'northeast'); // east tried: next-best (tie with southeast, lower index)
  // never a heading whose first hop lands in a protected box
  const box = [150, -50, 250, 50]; // 96 east of (100, 0) is inside
  for (const base of [{x: 0, z: 0}, null]) assert.notEqual(name(farHeading({x: 100, z: 0}, [box], base)), 'east');
  // out of the protected area soonest: a huge box to the east (beyond the first hop) beats pure "away"
  assert.equal(name(farHeading({x: 100, z: 0}, [[190, -20, 900, 20]], {x: 0, z: 0})), 'northeast');
  // all headings blocked or tried: -1
  assert.equal(farHeading({x: 0, z: 0}, [[-500, -500, 500, 500]]), -1);
  assert.equal(farHeading({x: 0, z: 0}, [], null, [0, 1, 2, 3, 4, 5, 6, 7]), -1);
  // failure text: German reason, and the fail event reads "gave up" for the order retry (4x wait)
  const text = farFail('spruce_log', {hops: 8, dir: 4});
  assert.equal(text, 'no free spruce_log within 768 blocks of a far search heading south');
  assert.equal(germanReason(text), 'kein spruce_log gefunden, auch nicht 768 Blöcke weiter Richtung Süden');
  assert.doesNotMatch(text, /no way to get|no progress for|No path/);
  assert.equal(orderOutcome({kind: 'fail', text: `gave up: mine spruce_log 2048 - ${text}`}, {type: 'mine', args: {}}).retry, 4 * 5 * 60000);
})();
