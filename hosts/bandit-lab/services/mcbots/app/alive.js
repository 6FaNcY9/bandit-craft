'use strict';
// Idle servants never look frozen: watch the nearest player, bow (a short sneak) to the master, step aside when
// bumped. Pure decision; the runner (bots.js) owns the bot access.
const {uuid: normUuid} = require('./owner');
const LOOK_RANGE = 8, BOW_NEAR = 3, BOW_FAR = 5, BUMP = 0.8, EYE = 1.6;

function aliveStep({me, players, owners = [], now, state}) {
  owners = owners.map(normUuid);
  const st = {bowed: {...(state?.bowed || {})}};
  const d = (p) => Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
  const near = players.map((p) => ({p, d: d(p)})).sort((a, b) => a.d - b.d);
  let look = null, sneak = false, aside = null;
  if (near[0] && near[0].d <= LOOK_RANGE) look = {x: near[0].p.x, y: near[0].p.y + EYE, z: near[0].p.z};
  for (const {p, d: dist} of near) {
    const id = normUuid(p.uuid);
    if (!id || !owners.includes(id)) continue;
    if (dist > BOW_FAR) delete st.bowed[id];
    else if (dist <= BOW_NEAR && !(id in st.bowed)) { st.bowed[id] = now; sneak = true; }
  }
  const bump = near.find((n) => Math.hypot(n.p.x - me.x, n.p.z - me.z) <= BUMP && Math.abs(n.p.y - me.y) < 2);
  if (bump) {
    const ox = me.x - bump.p.x, oz = me.z - bump.p.z;
    aside = Math.abs(ox) >= Math.abs(oz) ? {dx: ox >= 0 ? 1 : -1, dz: 0} : {dx: 0, dz: oz >= 0 ? 1 : -1};
  }
  return {look, sneak, aside, state: st};
}

// Target cell for a sidestep: solid floor, free feet and head, nothing harmful or trigger-happy (the TNT dupers run on pressure plates).
const HARM = /fire|pressure_plate|tripwire|cactus|magma|campfire|sweet_berry|cobweb|powder_snow/;
const safeCell = (floor, feet, head) => floor?.boundingBox === 'block' && feet?.boundingBox === 'empty' && head?.boundingBox === 'empty'
  && ![floor, feet, head].some((b) => /^(water|lava)$/.test(b.name) || HARM.test(b.name));

// Water a bot breathes in: also an ocean floor's seagrass and kelp, a bubble column and a waterlogged block.
const wet = (b) => /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(b?.name || '') || b?.getProperties?.().waterlogged === true;

// The nearest dry cell to stand on (its floor block, or null) for an idle bot left in water.
const shore = (bot, range = 32) => bot.findBlock({matching: (b) => b.boundingBox === 'block', maxDistance: range,
  useExtraInfo: (b) => safeCell(b, bot.blockAt(b.position.offset(0, 1, 0)), bot.blockAt(b.position.offset(0, 2, 0)))});

module.exports = {aliveStep, safeCell, shore, wet};
