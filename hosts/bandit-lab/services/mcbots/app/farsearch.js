'use strict';
// Far search (Misa 2026-11-06: "travel in some direction to find things, do not say it is out of range"): when the
// local search and explore steps find nothing free, a bot picks one of 8 headings and hops along it.
const {insideAreas} = require('./world');

const FAR_HOP = 96, FAR_HOPS = 8, FAR_HEADINGS = 2, FAR_TOTAL = 16; // FAR_TOTAL: hops per job in all, across searches
const R = Math.SQRT1_2;
// Minecraft north is -z, east +x. en: job error text, de: what the owner hears.
const DIRS = [
  {en: 'north', de: 'Norden', dx: 0, dz: -1}, {en: 'northeast', de: 'Nordosten', dx: R, dz: -R},
  {en: 'east', de: 'Osten', dx: 1, dz: 0}, {en: 'southeast', de: 'Südosten', dx: R, dz: R},
  {en: 'south', de: 'Süden', dx: 0, dz: 1}, {en: 'southwest', de: 'Südwesten', dx: -R, dz: R},
  {en: 'west', de: 'Westen', dx: -1, dz: 0}, {en: 'northwest', de: 'Nordwesten', dx: -R, dz: -R},
];
const dirEn = (en) => DIRS.find((d) => d.en === en);
const hopTarget = (me, d, k = 1) => ({x: Math.floor(me.x + d.dx * FAR_HOP * k), z: Math.floor(me.z + d.dz * FAR_HOP * k)});

const less = (a, b) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] < b[j]; return false; };

// The heading index (into DIRS) to search along, or -1 when every one is tried or starts inside a protected box.
// Fewest protected samples along the whole route first (out of them soonest), then the one leading most away from
// the base centre, then the fewest boxes within 300 blocks on that side. `tried`: indices to skip.
function farHeading(me, areas = [], base = null, tried = []) {
  const away = base ? Math.hypot(me.x - base.x, me.z - base.z) : 0;
  let best = -1, bestKey = null;
  DIRS.forEach((d, i) => {
    const first = hopTarget(me, d);
    if (tried.includes(i) || insideAreas(areas, first.x, first.z)) return;
    let inside = 0;
    for (let k = 1; k <= FAR_HOPS * 6; k++) { // every 16 blocks along the route
      const p = {x: me.x + d.dx * 16 * k, z: me.z + d.dz * 16 * k};
      if (insideAreas(areas, p.x, p.z)) inside++;
    }
    const gain = away ? (d.dx * (me.x - base.x) + d.dz * (me.z - base.z)) / away : 0;
    const boxes = areas.filter(([x1, z1, x2, z2]) => {
      const cx = (x1 + x2) / 2 - me.x, cz = (z1 + z2) / 2 - me.z;
      return Math.hypot(cx, cz) <= 300 && cx * d.dx + cz * d.dz > 0;
    }).length;
    const key = [inside, -Math.round(gain * 1000), boxes];
    if (!bestKey || less(key, bestKey)) { best = i; bestKey = key; }
  });
  return best;
}

// far.last: the heading the text names (far.dir is -1 between two headings)
const farFail = (what, far) => (far.hops ? `no free ${what} within ${far.hops * FAR_HOP} blocks of a far search heading ${DIRS[far.last ?? far.dir].en}` : `no free ${what} within reach and no walkable heading`);
const progress = (far) => `sucht weiter Richtung ${DIRS[far.dir].de} (${far.hops * FAR_HOP} Blöcke)`;

module.exports = {FAR_HOP, FAR_HOPS, FAR_HEADINGS, FAR_TOTAL, DIRS, dirEn, hopTarget, farHeading, farFail, progress};
