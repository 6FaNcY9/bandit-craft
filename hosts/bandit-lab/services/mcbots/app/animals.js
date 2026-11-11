'use strict';
// Animal pens: the pure decisions of `animalfarm`. census() counts the four kinds inside the box,
// planRound() picks per kind which two to breed, which sheep to shear and which adults to cull. Tested in
// test/animals.js with plain entity objects; the job wires them to a bot.
const {insideAreas} = require('./world');
const {named, baby} = require('./hunt');

const KINDS = {cow: {food: 'wheat', outputs: ['beef', 'leather']}, sheep: {food: 'wheat', outputs: ['mutton', 'wool']}, pig: {food: 'carrot', outputs: ['porkchop']}, chicken: {food: 'wheat_seeds', outputs: ['chicken', 'egg', 'feather']}};
const KEEP = 8; // adults kept per kind
const CULL_MAX = 4; // culled per round
const PEN_MAX = 16; // per kind, babies included: the lag bound
const MEMORY_MS = 300000; // fed and shorn animals are remembered this long

// The adults (by id) and the baby count of each kind inside the box, edges included; never a named animal
// and nothing in a protected area.
function census(entities, box, areas) {
  const out = Object.fromEntries(Object.keys(KINDS).map((k) => [k, {adults: [], babies: 0}]));
  for (const e of entities) {
    if (!KINDS[e.name] || e.type === 'player' || e.isValid === false || !e.position || named(e)) continue;
    const [x, z] = [Math.floor(e.position.x), Math.floor(e.position.z)];
    if (x < box.x1 || x > box.x2 || z < box.z1 || z > box.z2 || insideAreas(areas, x, z)) continue;
    if (baby(e)) out[e.name].babies++;
    else out[e.name].adults.push(e);
  }
  for (const k in out) out[k].adults.sort((a, b) => a.id - b.id);
  return out;
}

// The sheared flag of a sheep is bit 0x10 of metadata 18 (a guess; the job also remembers shorn sheep).
const sheared = (e) => (e.metadata?.[18] & 0x10) !== 0;

// One plan per kind of `counts` (census output): {breed: [a, b] | null, shear, cull, lacks}. lacks lists
// the items missing for a wanted chore: the food when breeding is due, 'shears' when a sheep is due.
function planRound(counts, {now, fed, shorn, have, paused}) {
  const recent = (map, e) => map.has(e.id) && now - map.get(e.id) < MEMORY_MS;
  const plans = {};
  for (const [kind, {adults, babies}] of Object.entries(counts)) {
    const plan = {breed: null, shear: [], cull: [], lacks: []};
    plans[kind] = plan;
    if (paused) continue;
    const ok = adults.filter((e) => !named(e) && !baby(e)).sort((a, b) => a.id - b.id);
    const food = KINDS[kind].food;
    const unfed = ok.filter((e) => !recent(fed, e));
    if (ok.length >= 2 && ok.length + babies < PEN_MAX && unfed.length >= 2) {
      if ((have.food?.[food] ?? 0) >= 2) plan.breed = unfed.slice(0, 2);
      else plan.lacks.push(food);
    }
    if (kind === 'sheep') {
      const woolly = ok.filter((e) => !sheared(e) && !recent(shorn, e));
      if (woolly.length && have.shears) plan.shear = woolly;
      else if (woolly.length) plan.lacks.push('shears');
    }
    // The highest ids above the kept 8 go, never the pair being bred.
    plan.cull = ok.slice(KEEP).reverse().filter((e) => !plan.breed?.includes(e)).slice(0, CULL_MAX);
  }
  return plans;
}

module.exports = {KINDS, census, sheared, planRound};
