'use strict';
// Iron gear a bot should craft next (pure: test.js feeds it plain names). `owned` is every item
// name carried or worn. Pickaxe, sword and axe count as done at iron or better; an armour slot is done
// with any piece in it, so nothing worn is ever replaced or melted down. Cheapest armour first.
// A shield (1 ingot and 6 planks) right after the sword: blocking between swings keeps a bot without armour alive
// (2026-10-17). The iron axe comes last: wood and stone axes were all the bots had (owner 2026-11-15, full iron set).
const COST = {iron_pickaxe: 3, iron_sword: 2, shield: 1, iron_boots: 4, iron_helmet: 5, iron_leggings: 7, iron_chestplate: 8, iron_axe: 3};
const OWNED = (kind) => (kind === 'shield' ? /^shield$/ : /^(pickaxe|sword|axe)$/.test(kind) ? new RegExp(`^(iron|diamond|netherite)_${kind}$`) : new RegExp(`_${kind}$`));

function gearPlan(ingots, owned) {
  const plan = [];
  for (const [item, cost] of Object.entries(COST)) {
    if (owned.some((n) => OWNED(item.replace(/^iron_/, '')).test(n)) || cost > ingots) continue;
    ingots -= cost;
    plan.push(item);
  }
  return plan;
}

// Ingots every missing piece needs together.
const ingotsWanted = (owned) => gearPlan(Infinity, owned).reduce((n, item) => n + COST[item], 0);

// What a bot hands back at the armoury (pure): per kind the best `keep` stay, counting what is worn, the rest goes back;
// wood and stone tools of a kind go too once an iron or better one stays (bot1 carried 3 iron swords and 3 iron
// pickaxes, owner 2026-11-15: "nicht verschwenden"). `items` = carried {name, count}, `worn` = names in armour and off-hand.
const TIER = ['wooden', 'leather', 'golden', 'stone', 'chainmail', 'iron', 'diamond', 'netherite'];
const tier = (n) => TIER.findIndex((t) => n.startsWith(`${t}_`));
const KINDS = [[/_sword$/, 1], [/_axe$/, 1], [/_pickaxe$/, 2], [/^shield$/, 1], [/_helmet$/, 1], [/_chestplate$/, 1], [/_leggings$/, 1], [/_boots$/, 1]];
function handBack(items, worn) {
  const out = new Map();
  for (const [re, keep] of KINDS) {
    const pool = [...worn.filter((n) => re.test(n)).map((name) => ({name, worn: true})),
      ...items.filter((i) => re.test(i.name)).flatMap((i) => Array.from({length: i.count}, () => ({name: i.name})))];
    pool.sort((a, b) => tier(b.name) - tier(a.name) || !!b.worn - !!a.worn);
    const strong = tier(pool[0]?.name || '') >= TIER.indexOf('iron');
    pool.forEach((p, i) => {
      if (p.worn || (i < keep && !(strong && i > 0 && /^(wooden|stone)_/.test(p.name)))) return;
      out.set(p.name, (out.get(p.name) || 0) + 1);
    });
  }
  return [...out].map(([name, count]) => ({name, count}));
}

// A guest bot uses the armoury only this near it (blocks, xz): MisaBot at Misa's base, ~720 away, never walks over for gear.
const GEAR_RANGE = 250;

module.exports = {COST, gearPlan, ingotsWanted, handBack, GEAR_RANGE};