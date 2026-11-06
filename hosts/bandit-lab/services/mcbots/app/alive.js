'use strict';
// Idle servants never look frozen: watch the nearest player, bow (a short sneak) to the master, step aside when
// bumped. Pure decision; the runner (bots.js) owns the bot access.
const LOOK_RANGE = 8, BOW_NEAR = 3, BOW_FAR = 5, BUMP = 0.8, EYE = 1.6;

function aliveStep({me, players, owners = [], now, state}) {
  const st = {bowed: {...(state?.bowed || {})}};
  const d = (p) => Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
  const near = players.map((p) => ({p, d: d(p)})).sort((a, b) => a.d - b.d);
  let look = null, sneak = false, aside = null;
  if (near[0] && near[0].d <= LOOK_RANGE) look = {x: near[0].p.x, y: near[0].p.y + EYE, z: near[0].p.z};
  for (const {p, d: dist} of near) {
    if (!owners.includes(p.uuid)) continue;
    if (dist > BOW_FAR) delete st.bowed[p.uuid];
    else if (dist <= BOW_NEAR && !(p.uuid in st.bowed)) { st.bowed[p.uuid] = now; sneak = true; }
  }
  const bump = near.find((n) => Math.hypot(n.p.x - me.x, n.p.z - me.z) <= BUMP && Math.abs(n.p.y - me.y) < 2);
  if (bump) {
    const ox = me.x - bump.p.x, oz = me.z - bump.p.z;
    aside = Math.abs(ox) >= Math.abs(oz) ? {dx: ox >= 0 ? 1 : -1, dz: 0} : {dx: 0, dz: oz >= 0 ? 1 : -1};
  }
  return {look, sneak, aside, state: st};
}

module.exports = {aliveStep};
