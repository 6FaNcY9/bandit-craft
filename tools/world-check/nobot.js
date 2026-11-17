#!/usr/bin/env node
'use strict';
// Can the architect see an area no bot has been near? Picks a 32 x 32 rect at least 300 blocks from every bot and
// player, reads its height map and a 32 x 32 x 32 box from the model, and compares random cells with the real world.
// node nobot.js [--hub URL]
const {HUB, Exit, parseArgs, makeApi, farSpot, checkBox, showDiffs, run} = require('./lib');

const AREA = {x1: -590, z1: -340, x2: 50, z2: 300}; // blocks

async function main() {
  const a = parseArgs(process.argv.slice(2)), api = makeApi(a.hub || HUB);
  const state = await api('/api/state');
  const points = [...(state.bots || []).filter((b) => b.pos).map((b) => [b.pos[0], b.pos[2]]), ...(state.world?.players || []).map((p) => [p.x, p.z])];
  const spot = farSpot(AREA, points);
  if (!spot) throw new Exit(2, `no 32 x 32 rect in the area is 300 blocks from all of ${points.length} bots and players`);
  const {x1, z1, x2, z2} = spot;
  console.log(`rect x ${x1}..${x2}, z ${z1}..${z2} (${points.length} bots and players checked)`);

  const h = await api(`/api/world/height?x1=${x1}&z1=${z1}&x2=${x2}&z2=${z2}`);
  const known = h.heights.filter((v) => v !== null).sort((p, q) => p - q);
  if (h.unknown.length || !known.length) throw new Exit(1, `height map: ${h.unknown.length} unknown chunks ${JSON.stringify(h.unknown)}, ${known.length} known columns`);
  const median = known[known.length >> 1], y1 = median - 16, y2 = y1 + 31;

  const {n, reply, diffs} = await checkBox(api, [x1, y1, z1, x2, y2, z2], 500);
  if (reply.unknown.length) throw new Exit(1, `blocks: ${reply.unknown.length} unknown chunks ${JSON.stringify(reply.unknown)}`);
  if (!n) throw new Exit(1, 'the plugin sampled no cell (chunks not generated?)');
  if (diffs.length) { showDiffs(diffs); throw new Exit(1, `${diffs.length} of ${n} sampled cells differ`); }

  console.log(`OK ${n} cells of y ${y1}..${y2} equal the world, ${h.ungenerated.length} ungenerated chunks in the rect`);
  console.log(`ground height at the centre (${x1 + 16}, ${z1 + 16}): ${h.heights[16 * (x2 - x1 + 1) + 16]}   (median ${median})`);
  console.log('PASS');
}

run(main);
