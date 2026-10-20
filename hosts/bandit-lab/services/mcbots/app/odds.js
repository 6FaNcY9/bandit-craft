'use strict';

const MOBS = Object.freeze({
  zombie: {health: 20, dmg: 3, every: 1}, husk: {health: 20, dmg: 3, every: 1}, drowned: {health: 20, dmg: 3, every: 1}, zombie_villager: {health: 20, dmg: 3, every: 1},
  spider: {health: 16, dmg: 2, every: 1}, cave_spider: {health: 12, dmg: 2, every: 1},
  skeleton: {health: 20, dmg: 3, every: 2, ranged: true}, stray: {health: 20, dmg: 3, every: 2, ranged: true}, bogged: {health: 20, dmg: 3, every: 2, ranged: true},
  pillager: {health: 24, dmg: 4, every: 2, ranged: true}, witch: {health: 26, dmg: 6, every: 3, ranged: true}, vindicator: {health: 24, dmg: 13, every: 1},
  // Provoked neutrals (combat.js provoked): an enderman hits 7 and has 40 health; unknown, it was weighed at nothing,
  // and bot19 fought four (main server 2026-10-20).
  enderman: {health: 40, dmg: 7, every: 1}, piglin: {health: 16, dmg: 5, every: 1}, zombified_piglin: {health: 20, dmg: 5, every: 1},
  silverfish: {health: 8, dmg: 1, every: 1}, endermite: {health: 8, dmg: 2, every: 1}, phantom: {health: 20, dmg: 2, every: 2}, slime: {health: 16, dmg: 4, every: 1}, magma_cube: {health: 16, dmg: 4, every: 1},
});
const KEEP = 6;
// Half the hits a mob could land: with these the verdicts matched the sandbox arena (iron sword; 3 zombies cost 13
// health unarmoured, 2 in iron; 2 skeletons 7 and 2), the estimates a little above the losses there (it healed at
// full saturation meanwhile).
const MELEE_HITS = 0.5, RANGED_HITS = 0.5;

const NIGHT = [{name: 'zombie', dist: 8}, {name: 'zombie', dist: 12}, {name: 'skeleton', dist: 16}];
function weapon(name) {
  const m = /^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe)$/.exec(name || '');
  if (!m) return {dmg: 1, speed: 4};
  const dmg = m[2] === 'sword' ? {wooden: 4, golden: 4, stone: 5, iron: 6, diamond: 7, netherite: 8}[m[1]] : {wooden: 7, golden: 7, stone: 9, iron: 9, diamond: 9, netherite: 10}[m[1]];
  const speed = m[2] === 'sword' ? 1.6 : ({wooden: 0.8, golden: 1, stone: 0.8, iron: 0.9, diamond: 1, netherite: 1}[m[1]]);
  return {dmg, speed};
}
function armour(names) {
  const values = {leather_helmet: [1, 0], leather_chestplate: [3, 0], leather_leggings: [2, 0], leather_boots: [1, 0], golden_helmet: [2, 0], golden_chestplate: [5, 0], golden_leggings: [3, 0], golden_boots: [1, 0], chainmail_helmet: [2, 0], chainmail_chestplate: [5, 0], chainmail_leggings: [4, 0], chainmail_boots: [1, 0], iron_helmet: [2, 0], iron_chestplate: [6, 0], iron_leggings: [5, 0], iron_boots: [2, 0], diamond_helmet: [3, 2], diamond_chestplate: [8, 2], diamond_leggings: [6, 2], diamond_boots: [3, 2], netherite_helmet: [3, 3], netherite_chestplate: [8, 3], netherite_leggings: [6, 3], netherite_boots: [3, 3], turtle_helmet: [2, 0]};
  return names.reduce((a, n) => { const v = values[n]; if (v) { a.points += v[0]; a.toughness += v[1]; } return a; }, {points: 0, toughness: 0});
}
function taken(dmg, {points, toughness}) { return dmg * (1 - Math.min(20, Math.max(points / 5, points - 4 * dmg / (toughness + 8))) / 25); }
// Nearest first, one after another. A melee mob walks up (3 blocks a second) and the bot waits for it; the bot walks up
// to an archer (4 a second) while it shoots. Every threat hits from its arrival (an archer from the start) until it
// dies, a share of its possible hits: the bot strikes from 5 blocks and its knockback keeps a zombie off (sandbox arena
// 2026-10-18, MELEE_HITS and RANGED_HITS fitted there).
function odds({health, weapon: w, armour: a, threats}) {
  const ordered = threats.map((t) => ({...t, mob: MOBS[t.name]})).filter((t) => t.mob).sort((x, y) => x.dist - y.dist);
  if (!ordered.length) return {secs: 0, loss: 0, fight: true};
  const dps = w.dmg * w.speed;
  let time = 0, loss = 0;
  for (const t of ordered) {
    time = (t.mob.ranged ? time + t.dist / 4 : Math.max(time, t.dist / 3)) + t.mob.health / dps;
    const from = t.mob.ranged ? 0 : t.dist / 3;
    loss += Math.max(0, time - from) * taken(t.mob.dmg, a) / t.mob.every * (t.mob.ranged ? RANGED_HITS : MELEE_HITS);
  }
  return {secs: time, loss, fight: loss < health - KEEP};
}
module.exports = {MOBS, weapon, armour, taken, odds, NIGHT, KEEP, MELEE_HITS, RANGED_HITS};
