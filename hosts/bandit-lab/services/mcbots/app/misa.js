'use strict';
// Misa's bots (spec 2026-10-29-misa-bots): the "@bot" exemption of protected areas and the building orders' corners.
// A protected area is [x1, z1, x2, z2, y1, y2, bots]; bots (optional, y1/y2 null for a plain box) are the bots that
// may work inside it. A runner holds only the areas that do not name it (forBot), so the existing consumers
// (insideAreas, pathfinder) need no change; the full list stays in runner.allAreas for the order rules below.

const forBot = (areas, name) => (areas.some((a) => a[6]) ? areas.filter((a) => !a[6]?.includes(name)) : areas);
const overlaps = (a, b) => b.x1 <= a[2] && b.x2 >= a[0] && b.z1 <= a[3] && b.z2 >= a[1] && (a[4] == null || a[5] == null || (b.y1 <= a[5] && b.y2 >= a[4]));

// Why `box` {x1,y1,z1,x2,y2,z2} is not this bot's to change, or null: it must lie inside one area that names the bot
// and touch no area that does not.
function boxRule(areas, name, box) {
  const own = areas.filter((a) => a[6]?.includes(name));
  if (!own.some((a) => box.x1 >= a[0] && box.x2 <= a[2] && box.z1 >= a[1] && box.z2 <= a[3])) return 'das liegt nicht ganz in deinem Bereich';
  if (forBot(areas, name).some((a) => overlaps(a, box))) return 'dort ist gesperrtes Gebiet';
  return null;
}

// "ecke": the block a player stands on is corner 1, the next one corner 2, then 1 again.
class Corners {
  constructor() { this.by = new Map(); }
  set(player, p) {
    const c = this.by.get(player) || {pts: [], next: 0};
    c.pts[c.next] = {x: p.x, y: p.y, z: p.z};
    const n = c.next + 1;
    c.next = 1 - c.next;
    this.by.set(player, c);
    return n;
  }
  box(player) {
    const [p, q] = this.by.get(player)?.pts || [];
    if (!p || !q) throw new Error('erst zweimal ecke sagen');
    return {x1: Math.min(p.x, q.x), y1: Math.min(p.y, q.y), z1: Math.min(p.z, q.z), x2: Math.max(p.x, q.x), y2: Math.max(p.y, q.y), z2: Math.max(p.z, q.z)};
  }
}

module.exports = {forBot, boxRule, Corners};
