'use strict';
// The order catalog of the in-game UI: which jobs exist, what each asks for, how a click payload becomes job args.
// Pure apart from VALIDATE (bots.js), which stays the authority on args. Every payload value is untrusted.
const {VALIDATE} = require('./bots');
const sealJob = require('./seal');

const DE = {
  iron_ore: 'Eisenerz', deepslate_iron_ore: 'Tiefen-Eisenerz', coal_ore: 'Kohleerz', deepslate_coal_ore: 'Tiefen-Kohleerz', copper_ore: 'Kupfererz',
  deepslate_copper_ore: 'Tiefen-Kupfererz', gold_ore: 'Golderz', deepslate_gold_ore: 'Tiefen-Golderz', redstone_ore: 'Redstone-Erz', lapis_ore: 'Lapiserz',
  diamond_ore: 'Diamanterz', deepslate_diamond_ore: 'Tiefen-Diamanterz', emerald_ore: 'Smaragderz', nether_gold_ore: 'Nether-Golderz',
  nether_quartz_ore: 'Quarzerz', ancient_debris: 'Antiker Schutt', chest: 'Truhe', trapped_chest: 'Redstone-Truhe', barrel: 'Fass', spawner: 'Spawner',
  oak_log: 'Eichenstamm', birch_log: 'Birkenstamm', spruce_log: 'Fichtenstamm', jungle_log: 'Tropenstamm', acacia_log: 'Akazienstamm',
  dark_oak_log: 'Schwarzeichenstamm', cherry_log: 'Kirschstamm', mangrove_log: 'Mangrovenstamm', logs: 'Baumstämme', stone: 'Stein', cobblestone: 'Bruchstein',
  deepslate: 'Tiefenschiefer', dirt: 'Erde', sand: 'Sand', gravel: 'Kies', wheat: 'Weizen', farmland: 'Ackerboden', coal: 'Kohle', raw_iron: 'Roheisen',
  iron_ingot: 'Eisenbarren', stick: 'Stock', torch: 'Fackel', oak_planks: 'Eichenbretter', bread: 'Brot', iron_pickaxe: 'Eisenspitzhacke',
  stone_pickaxe: 'Steinspitzhacke', iron_sword: 'Eisenschwert', bucket: 'Eimer', crafting_table: 'Werkbank', furnace: 'Ofen',
};
const germanName = (id) => DE[id] || String(id ?? '').replace(/_/g, ' ');
// What the select lists offer; anything else goes in the "Oder Name" text field.
const BLOCKS = ['stone', 'cobblestone', 'deepslate', 'dirt', 'sand', 'gravel', 'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore', 'ancient_debris', 'oak_log', 'birch_log', 'spruce_log'];
const ITEMS = ['stick', 'torch', 'coal', 'raw_iron', 'iron_ingot', 'cobblestone', 'oak_log', 'logs', 'oak_planks', 'bread', 'iron_pickaxe', 'stone_pickaxe', 'iron_sword', 'bucket', 'crafting_table', 'furnace'];
// craft and smelt take only what their VALIDATE accepts (no results like iron_ingot, nothing uncraftable like logs).
const CRAFTS = ['stick', 'torch', 'oak_planks', 'chest', 'crafting_table', 'furnace', 'bucket', 'iron_pickaxe', 'stone_pickaxe', 'iron_sword'];
const SMELTS = ['raw_iron', 'raw_copper', 'raw_gold', 'cobblestone', 'sand', 'oak_log'];

const NAME_RE = /^[a-z_]{1,48}$/;
const TEXT_MAX = 200; // no legitimate payload value is longer; the text fields hold 48
const INT = /^-?\d{1,9}$/;
const dimOf = (d) => String(d || 'overworld').replace(/^minecraft:/, '');

// Input kinds. `where` also takes optional (tidy: default is the supply chest).
const count = (min, max, step, initial) => ({kind: 'count', min, max, step, initial});
const block = {kind: 'block'}, item = {kind: 'item'}, chest = {kind: 'chest'}, where = {kind: 'where'}, radius = (initial, min, max) => ({kind: 'radius', initial, min, max}),
  schematic = {kind: 'schematic'}, rotation = {kind: 'rotation'}, area = {kind: 'area'}, zone = (place) => ({kind: 'zone', place});

const pt = (p) => ({x: p.x, y: p.y, z: p.z});
const R = Math.round;
const bounds = (sel) => {
  const {a, b} = sel;
  return {x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), z1: Math.min(a.z, b.z), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y), z2: Math.max(a.z, b.z)};
};
const supplyAt = (ctx) => { if (!ctx.supply) throw new Error('keine Vorratskiste eingestellt'); return pt(ctx.supply); };

// loc: the job uses a target (v.at) and the context preset carries it. here: the label next to the gazed block.
// general: listed in the screen's general section. say(v): what the result line calls the order.
const JOBS = {
  mine: {label: 'Abbauen', type: 'mine', general: true, needs: [block, count(16, 2048, 16, 64)], args: (v) => ({block: v.block, count: R(v.n)}), say: (v) => `${germanName(v.block)} abbauen`},
  shift: {label: 'Schicht', type: 'shift', general: true, needs: [block, chest], args: (v) => ({block: v.block, ...pt(v.chest)}), say: (v) => `Schicht ${germanName(v.block)}`},
  shiftlogs: {label: 'Holz-Schicht', type: 'shift', needs: [chest], args: (v) => ({block: 'logs', ...pt(v.chest)}), say: () => 'Holz-Schicht'},
  chop: {label: 'Holz', type: 'chop', general: true, needs: [count(16, 2048, 16, 64)], args: (v) => ({count: R(v.n)}), say: () => 'Holz hacken'},
  get: {label: 'Besorgen', type: 'get', general: true, needs: [item, count(1, 256, 1, 16)], args: (v) => ({item: v.item, count: R(v.n)}), say: (v) => `${germanName(v.item)} besorgen`},
  deposit: {label: 'Einlagern', here: 'Hier einlagern', type: 'deposit', general: true, loc: true, needs: [where], args: (v) => pt(v.at), say: () => 'Einlagern'},
  withdraw: {label: 'Entnehmen', here: 'Hier entnehmen', type: 'withdraw', general: true, loc: true, needs: [item, count(1, 1728, 1, 64), where], args: (v) => ({item: v.item, count: R(v.n), ...pt(v.at)}), say: (v) => `${germanName(v.item)} entnehmen`},
  stock: {label: 'Zählen', here: 'Hier zählen', type: 'stock', loc: true, needs: [where], args: (v) => pt(v.at), say: () => 'Kiste zählen'},
  goto: {label: 'Hingehen', here: 'Hierhin gehen', type: 'goto', general: true, loc: true, needs: [where], args: (v) => pt(v.at), say: () => 'Hingehen'},
  guard: {label: 'Bewachen', here: 'Hier bewachen', type: 'guard', general: true, loc: true, needs: [where, radius(16, 4, 48)], args: (v) => ({...pt(v.at), radius: R(v.radius)}), say: () => 'Bewachen'},
  tidy: {label: 'Aufräumen', here: 'Hier aufräumen', type: 'tidy', general: true, loc: true, needs: [{...where, optional: true}, radius(16, 2, 32)], args: (v) => ({...(v.at ? pt(v.at) : {}), radius: R(v.radius)}), say: () => 'Aufräumen'},
  lightspawner: {label: 'Spawner ausleuchten', type: 'light', loc: true, needs: [where], args: (v) => ({spawner: pt(v.at)}), say: () => 'Spawner ausleuchten'},
  craft: {label: 'Herstellen', type: 'craft', general: true, needs: [item, count(1, 64, 1, 8)], args: (v) => ({item: v.item, count: R(v.n)}), say: (v) => `${germanName(v.item)} herstellen`},
  smelt: {label: 'Schmelzen', type: 'smelt', general: true, needs: [item, count(1, 64, 1, 8)], args: (v) => ({item: v.item, count: R(v.n)}), say: (v) => `${germanName(v.item)} schmelzen`},
  schematic: {label: 'Bauen', type: 'schematic', general: true, loc: true, needs: [schematic, where, rotation],
    args: (v, ctx) => ({file: v.file, origin: pt(v.at), rotation: v.rotation, chests: ctx.supply ? [pt(ctx.supply)] : []}), say: (v) => `Bauen ${v.file}`},
  treefarm: {label: 'Baumfarm', type: 'treefarm', general: true, needs: [zone('treefarm')], args: (v) => ({x1: v.zone.x1, z1: v.zone.z1, x2: v.zone.x2, z2: v.zone.z2}), say: () => 'Baumfarm'},
  wheatfarm: {label: 'Weizenfarm', type: 'wheatfarm', general: true, needs: [zone('wheat')], args: (v) => ({x1: v.zone.x1, z1: v.zone.z1, x2: v.zone.x2, z2: v.zone.z2}), say: () => 'Weizenfarm'},
  rearm: {label: 'Ausrüsten', type: 'rearm', general: true, needs: [], args: (v, ctx) => supplyAt(ctx), say: () => 'Ausrüsten'},
  homebed: {label: 'Heim', type: 'homebed', general: true, needs: [], args: () => ({}), say: () => 'Heim'},
  graves: {label: 'Gräber holen', type: 'graves', general: true, needs: [], args: () => ({}), say: () => 'Gräber holen'},
  help: {label: 'Helfen', type: 'help', general: true, needs: [], args: () => ({}), say: () => 'Helfen'},
  // Area jobs: the box comes from the selected corners (ctx.sel).
  excavate: {label: 'Raum graben', type: 'excavate', needs: [area], args: (v, ctx) => bounds(ctx.sel), say: () => 'Raum graben', limit: 'höchstens 9 x 9 x 5'},
  clear: {label: 'Abbauen (Bereich)', type: 'clear', needs: [area], args: (v, ctx) => bounds(ctx.sel), say: () => 'Bereich abbauen', limit: 'höchstens 32 x 32 x 24'},
  shaft: {label: 'Schacht', type: 'shaft', needs: [area], args: (v, ctx) => { const b = bounds(ctx.sel); return {x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2, top: b.y2}; }, say: () => 'Schacht', limit: '3 x 3 bis 16 x 16'},
  light: {label: 'Ausleuchten', type: 'light', needs: [area], args: (v, ctx) => bounds(ctx.sel), say: () => 'Ausleuchten', limit: 'höchstens 64 x 64 x 48'},
  seal: {label: 'Versiegeln', type: 'seal', needs: [area], args: (v, ctx) => bounds(ctx.sel), say: () => 'Versiegeln', limit: `3 x 3 bis ${sealJob.MAX_SIDE} x ${sealJob.MAX_SIDE}, höchstens ${sealJob.MAX_HEIGHT} hoch`},
};
const hasJob = (key) => typeof key === 'string' && Object.hasOwn(JOBS, key);
const AREA = Object.keys(JOBS).filter((k) => JOBS[k].needs.includes(area));

// What a gazed block offers, most useful first. preset: the target (when the job uses one) and the block name.
function contextJobs(gaze) {
  if (!gaze || typeof gaze.block !== 'string') return [];
  const b = gaze.block, keys = [];
  if (/_ore$|ancient_debris/.test(b)) keys.push('mine', 'shift');
  if (/_log$|_wood$/.test(b)) keys.push('chop', 'shiftlogs');
  if (/^(trapped_)?chest$|barrel/.test(b)) keys.push('deposit', 'withdraw', 'stock');
  if (/spawner/.test(b)) keys.push('lightspawner');
  if (/wheat|farmland/.test(b)) keys.push('wheatfarm');
  keys.push('goto', 'guard', 'tidy');
  return keys.map((key) => {
    const job = JOBS[key], preset = {};
    if (job.loc) Object.assign(preset, pt(gaze));
    if (job.needs.includes(block)) preset.block = b;
    return {key, preset};
  });
}

const dims = (sel) => (sel.a && sel.b ? [Math.abs(sel.a.x - sel.b.x) + 1, Math.abs(sel.a.y - sel.b.y) + 1, Math.abs(sel.a.z - sel.b.z) + 1] : null);

// The area jobs once both corners are set; a box over the limit (VALIDATE says so) or across worlds is not ok.
function areaJobs(sel) {
  if (!sel?.a || !sel.b) return [];
  const crossed = dimOf(sel.a.dim) !== dimOf(sel.b.dim);
  return AREA.map((key) => {
    const job = JOBS[key];
    if (crossed) return {key, ok: false, why: 'Ecken in verschiedenen Welten'};
    try { VALIDATE[job.type](job.args({}, {sel})); return {key, ok: true}; } catch { return {key, ok: false, why: `zu groß oder zu klein: ${job.limit}`}; }
  });
}

function point(o) {
  const x = Number(o?.x), y = Number(o?.y), z = Number(o?.z);
  if (![x, y, z].every(Number.isInteger) || Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < -64 || y > 320) throw new Error('Koordinaten außerhalb der Welt');
  return {x, y, z};
}

// A target for an order: `gaze`, `pos`, `supply`, `place:<name>`, else text like "12 64 -30".
function resolveTarget(value, ctx, places = []) {
  const v = String(value ?? '').trim();
  if (v === 'gaze') {
    if (!ctx.gaze) throw new Error('Du schaust auf keinen Block');
    return {...point(ctx.gaze), dim: dimOf(ctx.dim)};
  }
  if (v === 'pos') {
    if (!Array.isArray(ctx.pos)) throw new Error('Deine Position ist unbekannt');
    return {...point({x: Math.floor(ctx.pos[0]), y: Math.floor(ctx.pos[1]), z: Math.floor(ctx.pos[2])}), dim: dimOf(ctx.dim)};
  }
  if (v === 'supply') return {...point(supplyAt(ctx)), dim: 'overworld'};
  if (v.startsWith('place:')) {
    const p = places.find((x) => x.name === v.slice(6) && x.kind !== 'protected');
    if (!p) throw new Error('Ziel nicht gefunden');
    return {...point(p), dim: dimOf(p.dim)};
  }
  const t = v.split(/[\s,]+/);
  if (t.length !== 3 || !t.every((s) => INT.test(s))) throw new Error('Koordinaten wie 12 64 -30 eingeben');
  return {...point({x: t[0], y: t[1], z: t[2]}), dim: dimOf(ctx.dim)};
}

const isFree = (s) => s.online && !s.dead && !s.job && !s.queue?.length;
// `frei` (the first free bot), `alle` (every online bot) or one name. dim: the world of the target, when there is one.
function resolveBots(value, snaps, allowed, dim = null) {
  const mine = snaps.filter((s) => allowed === '*' || allowed.includes(s.name));
  const here = (s) => !dim || !s.dimension || dimOf(s.dimension) === dim;
  if (value === 'frei' || value === 'alle') {
    const pool = mine.filter((s) => s.online && !s.dead && (value === 'alle' || isFree(s)));
    const near = pool.filter(here);
    if (!near.length) throw new Error(pool.length && dim ? 'Kein freier Bot in dieser Welt' : 'Kein freier Bot');
    return value === 'frei' ? [near[0].name] : near.map((s) => s.name);
  }
  if (typeof value !== 'string' || (allowed !== '*' && !allowed.includes(value))) throw new Error('nicht dein Bot');
  const s = snaps.find((x) => x.name === value);
  if (!s) throw new Error('unbekannter Bot');
  if (!here(s)) throw new Error(`${value} ist in einer anderen Welt`);
  return [value];
}

const supplyOf = (keeper) => { try { return keeper?.state().chest || null; } catch { return null; } };

// The preset a job screen carries (target and block), cleaned. Throws on anything out of bounds.
function presetOf(data, job) {
  const out = {};
  if (job.loc && data.x !== undefined) Object.assign(out, point(data));
  if (job.needs.includes(block) && data.block !== undefined) {
    if (typeof data.block !== 'string' || !NAME_RE.test(data.block)) throw new Error('Blockname ungültig');
    out.block = data.block;
  }
  return out;
}

const nameOf = (select, typed, what) => {
  const n = String(typed || select || '').trim().toLowerCase();
  if (!n) throw new Error(`${what} fehlt`);
  if (!NAME_RE.test(n)) throw new Error(`${what} ungültig (nur Buchstaben und _)`);
  return n;
};
const num = (v, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n)) throw new Error(`${what}: ungültige Zahl`); return n; };

// A send payload -> the order. env: {ctx, sel, supply, places, snaps, allowed, schematics}. Throws a reason; VALIDATE has the last word.
function build(key, data, env) {
  if (!hasJob(key)) throw new Error('unbekannter Auftrag');
  const job = JOBS[key];
  for (const x of Object.values(data)) {
    if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('Ungültige Zahl');
    if (typeof x === 'string' && x.length > TEXT_MAX) throw new Error('Eingabe zu lang');
  }
  const ctx = {...env.ctx, supply: env.supply, sel: env.sel}, v = {};
  const has = (k) => job.needs.find((n) => n.kind === k);
  const preset = presetOf(data, job);
  if (preset.x !== undefined) v.at = {...preset, dim: dimOf(ctx.dim)};
  const text = (k) => String(data[k] ?? '').trim();
  if (has('block')) v.block = nameOf(data.block, text('blockx'), 'Block');
  if (has('item')) v.item = nameOf(data.item, text('itemx'), 'Item');
  const c = has('count');
  if (c) v.n = num(data.n ?? c.initial, 'Anzahl');
  const r = has('radius');
  if (r) v.radius = num(data.radius ?? r.initial, 'Radius');
  const w = has('where');
  if (w && !v.at) {
    const pick = text('wheretext') || text('where') || (w.optional ? 'none' : 'gaze');
    if (pick !== 'none') v.at = resolveTarget(pick, ctx, env.places);
  }
  if (has('chest')) v.chest = resolveTarget(text('chesttext') || text('chest') || 'supply', ctx, env.places);
  if (has('schematic')) {
    if (!env.schematics.includes(data.file)) throw new Error('Bauplan nicht gefunden');
    v.file = data.file;
  }
  if (has('rotation')) {
    v.rotation = Number(data.rotation ?? 0);
    if (![0, 90, 180, 270].includes(v.rotation)) throw new Error('Drehung ungültig');
  }
  const z = has('zone');
  let dim = v.at?.dim ?? v.chest?.dim ?? null;
  if (z) {
    const p = env.places.find((x) => x.name === data.zone && x.kind === z.place && x.box);
    if (!p) throw new Error('Zone nicht gefunden');
    v.zone = p.box; dim = dimOf(p.dim);
  }
  if (has('area')) {
    const {a, b} = env.sel || {};
    if (!a || !b) throw new Error('Bereich fehlt: zwei Ecken setzen');
    if (dimOf(a.dim) !== dimOf(b.dim)) throw new Error('Ecken in verschiedenen Welten');
    dim = dimOf(a.dim);
  }
  const bots = resolveBots(text('who') || 'frei', env.snaps, env.allowed, dim);
  const args = job.args(v, ctx);
  VALIDATE[job.type](args);
  return {type: job.type, args, bots, replace: data.when === 'now', say: job.say(v), area: !!has('area')};
}

module.exports = {JOBS, BLOCKS, ITEMS, CRAFTS, SMELTS, germanName, contextJobs, areaJobs, dims, resolveTarget, resolveBots, supplyOf, presetOf, hasJob, build, dimOf};
