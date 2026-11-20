'use strict';
// Bookkeeping for the pillars a bot builds to climb to the logs of a tall tree (the pathfinder places dirt or
// cobblestone under its feet; the tree farm was full of the leftovers, 2026-10-10). The placement wrapper in
// bots.js records each such block (cells: Map "x,y,z" -> {x, y, z, name}); once the bot is done with the tree
// it digs them back down. The pathfinder's bridges out in the open are recorded the same way (2026-10-20).
// Pure and tested in test.js with plain objects.
const key = (x, y, z) => `${x},${y},${z}`;

// A block placed straight up onto the block under the bot's own column is a pillar step; bridges and walls are not.
const isPillarStep = (face, ref, feet) => !!face && face.x === 0 && face.y === 1 && face.z === 0 && !!ref && ref.x === Math.floor(feet.x) && ref.z === Math.floor(feet.z) && ref.y < feet.y;

const MAX_CELLS = 512;
const record = (cells, x, y, z, name, tries = 0) => {
  cells.delete(key(x, y, z)); // re-insert as the newest
  cells.set(key(x, y, z), tries ? {x, y, z, name, tries} : {x, y, z, name});
  if (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value); // oldest goes
};

// A dig of cell c failed: keep it for a later job end, given up after the third failure (2026-11-17: 179 failed digs at
// the castle had been forgotten at once). `add` 0 keeps it as it was (a Stop is no failed try). Given up, it stays
// recorded at the cap, untried (due): the block still stands, and the owner plans its removal from the record (K24).
const MAX_TRIES = 3;
const retry = (cells, c, add = 1) => record(cells, c.x, c.y, c.z, c.name, Math.min(MAX_TRIES, (c.tries || 0) + add));

// Cells read back from the saved file (bots.js saveScaffold) after a restart; anything else in it is skipped.
function restore(cells, list) {
  for (const c of Array.isArray(list) ? list : []) {
    if (c && [c.x, c.y, c.z].every(Number.isInteger) && /^[a-z_]{1,48}$/.test(c.name)) record(cells, c.x, c.y, c.z, c.name, Number.isInteger(c.tries) ? c.tries : 0);
  }
}

// The cells still recorded, emptied: what a respawn or a disconnect leaves standing.
function take(cells) {
  const out = [...cells.values()];
  cells.clear();
  return out;
}

// A block update at a recorded cell that changes it away from what we recorded ends our claim (a player's
// same-type replacement after a removal is then not ours). Our own placement (air -> recorded name) keeps it.
function changed(cells, x, y, z, oldName, newName) {
  const c = cells.get(key(x, y, z));
  if (c && oldName !== newName && (oldName === c.name || newName !== c.name)) cells.delete(key(x, y, z)); // same block again (a resend) is no change
}

// The cells to dig now, tallest first. Only a cell this bot placed and that is still the same block (a player's
// replacement stays), never in a protected area; stale entries are forgotten. With `target` ({x, z}: the next log),
// a pillar within `near` blocks of it is kept: the bot may still need it for the rest of the tree. With `feet` (the
// bot's position) the cells under its own column stay, still recorded: a walk that ended on its bridge or pillar must
// not dig the ground from under the bot (sandbox goto onto a 5 high plateau dropped back into the pit, 2026-10-20).
// With `within` as well, only cells that close to `feet` are due.
function due(cells, {blockAt, protectedAt = () => false, target = null, near = 4, feet = null, within = null, open = null}) {
  const out = [];
  for (const [k, c] of cells) {
    const b = blockAt(c.x, c.y, c.z);
    if (!b) continue; // unloaded: not dug now, but still ours (kept for the report on respawn/end)
    if (b.name !== c.name) { cells.delete(k); continue; }
    if (protectedAt(c.x, c.z, c.y)) { cells.delete(k); continue; }
    if ((c.tries || 0) >= MAX_TRIES) continue; // given up: recorded, not tried
    if (target && Math.hypot(c.x - target.x, c.z - target.z) <= near) continue;
    if (feet && within && Math.hypot(c.x + 0.5 - feet.x, c.y - feet.y, c.z + 0.5 - feet.z) > within) continue;
    if (feet && c.x === Math.floor(feet.x) && c.z === Math.floor(feet.z) && c.y < feet.y) continue;
    if (open && !open(c.x, c.y, c.z)) continue; // stray cleanup: dig only a cell open to the sky, a roofed one stays (the way back up)
    out.push(c);
  }
  return out.sort((a, b) => b.y - a.y);
}

// Open to the sky above x,y,z, or only leaves over it (a tree's canopy): a pillar there is in the way. Under a roof
// of stone it is the way back up and stays. Unloaded blocks count as a roof.
function openAbove(blockAt, x, y, z, up = 24) {
  for (let dy = 1; dy <= up; dy++) {
    const b = blockAt(x, y + dy, z);
    if (!b || (b.boundingBox === 'block' && !/leaves$/.test(b.name))) return false;
  }
  return true;
}

module.exports = {take, record, retry, restore, changed, due, isPillarStep, openAbove, key};
