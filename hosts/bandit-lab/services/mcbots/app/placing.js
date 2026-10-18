'use strict';

const YAW = {north: 0, west: Math.PI / 2, south: Math.PI, east: 3 * Math.PI / 2};
const DIRS = {north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0]};
const OPP = {north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up'};
const CW = {north: 'east', east: 'south', south: 'west', west: 'north'};
const CCW = {north: 'west', west: 'south', south: 'east', east: 'north'};
const FACES = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
const PLAYER = new Set(['furnace', 'smoker', 'blast_furnace', 'chest', 'trapped_chest', 'ender_chest',
  'carved_pumpkin', 'jack_o_lantern', 'loom', 'stonecutter', 'lectern', 'beehive', 'bee_nest',
  'chiseled_bookshelf', 'end_portal_frame']);
const UNSUPPORTED = new Set(['crafter', 'sea_pickle', 'vine', 'scaffolding']);
// Six-way blocks: facing = opposite of where the player looks (pistons, droppers) or the look itself (observer).
const SIX = {piston: 'opp', sticky_piston: 'opp', dropper: 'opp', dispenser: 'opp', observer: 'same'};
// States set by right-clicks after placing: each click steps to the next value.
const CYCLE = {repeater: ['delay', ['1', '2', '3', '4']], comparator: ['mode', ['compare', 'subtract']],
  note_block: ['note', Array.from({length: 25}, (_, i) => String(i))]};
const strip = (name) => name.replace(/^minecraft:/, '');
const neg = (v) => v.map((n) => n ? -n : 0);

// A bed of any colour does: the owner let the iron farm take other colours when 18 white beds wanted 54 white wool
// and the crew found 21 white sheep (2026-10-18). Beds count as one material, white_bed, and any bed fills a bed cell.
const BED = /_bed$/;
function itemOf(name) {
  if (BED.test(strip(name))) return 'white_bed';
  const item = strip(name).replace(/_wall_(torch|sign|hanging_sign|banner|head|skull)$/, '_$1').replace(/^wall_torch$/, 'torch');
  return item === 'redstone_wire' ? 'redstone' : item === 'tripwire' ? 'string' : item;
}

function skip(name, props = {}) {
  return props.half === 'upper' || /_bed$/.test(strip(name)) && props.part === 'head' || /^(piston_head|moving_piston)$/.test(strip(name));
}

function way(against, look = null, height = null) {
  const face = neg(against);
  let cursor = null;
  if (height != null) {
    cursor = [0.5, height, 0.5];
    for (const i of [0, 2]) if (face[i]) cursor[i] = face[i] > 0 ? 1 : 0;
  }
  return {against: [...against], face, cursor, look};
}

function halfWays(half, look = null) {
  const top = half === 'top';
  return FACES.filter(([, y]) => y !== (top ? -1 : 1)).map((v) => way(v, look, v[1] ? null : top ? 0.75 : 0.25));
}

function placement(name, props = {}) {
  name = strip(name);
  if (skip(name, props) || ['rotation', 'attachment', 'candles', 'pickles'].some((p) => Object.hasOwn(props, p)) ||
    UNSUPPORTED.has(name) || /(?<!_wall)_sign$|hanging_sign|banner|candle|(?:^|_)anvil$/.test(name)) return null;
  // final: props that settle only once the neighbours stand (rail shapes, double chests), checked after the build.
  const result = (check, ways, final) => ({item: itemOf(name), check, ways, ...(final ? {final} : {}),
    ...(CYCLE[name] ? {cycle: {prop: CYCLE[name][0], values: CYCLE[name][1]}} : {})});
  const f = props.facing, horizontal = Object.hasOwn(YAW, f), six = Object.hasOwn(DIRS, f);
  if (CYCLE[name] && !CYCLE[name][1].includes(props[CYCLE[name][0]] ?? CYCLE[name][1][0])) return null;
  if (name === 'repeater' || name === 'comparator') return horizontal ? result(['facing', CYCLE[name][0]], [way(FACES[0], OPP[f])]) : null;
  if (name === 'note_block') return result(['note'], FACES.map((v) => way(v)));
  if (SIX[name]) return six ? result(['facing'], FACES.map((v) => way(v, SIX[name] === 'opp' ? OPP[f] : f))) : null;
  // A hopper points away from the face clicked: into the block it feeds, or down when clicked from above or below.
  if (name === 'hopper') return f === 'down' ? result(['facing'], [way(FACES[0]), way(FACES[5])]) :
    horizontal ? result(['facing'], [way(DIRS[f])]) : null;
  if (/_shulker_box$|^shulker_box$/.test(name)) return six ? result(['facing'], [way(neg(DIRS[f]))]) : null;
  if (/rail$/.test(name)) {
    const sh = String(props.shape || '');
    const look = /north|south/.test(sh) && !/east|west/.test(sh) ? 'north' : /east|west/.test(sh) && !/north|south/.test(sh) ? 'east' : null;
    return sh ? result([], [way(FACES[0], look)], ['shape']) : null;
  }
  if (Object.hasOwn(props, 'face')) { // buttons, levers, grindstone
    if (!horizontal) return null;
    if (props.face === 'wall') return result(['face', 'facing'], [way(neg(DIRS[f]))]);
    return ['floor', 'ceiling'].includes(props.face) ? result(['face', 'facing'], [way(FACES[props.face === 'floor' ? 0 : 5], f)]) : null;
  }
  if (name === 'chest' || name === 'trapped_chest') { // the second half of a double chest is clicked onto the first
    if (!horizontal) return null;
    const partner = {left: CW[f], right: CCW[f]}[props.type];
    const ways = FACES.map((v) => way(v, OPP[f]));
    if (partner) ways.sort((a, b) => (String(b.against) === String(DIRS[partner])) - (String(a.against) === String(DIRS[partner])));
    return result(['facing'], ways, props.type ? ['type'] : undefined);
  }
  if (name === 'redstone_wire') return result([], [way(FACES[0])]);
  if (Object.hasOwn(props, 'axis')) {
    const i = {x: 0, y: 1, z: 2}[props.axis];
    return i == null ? null : result(['axis'], FACES.filter((v) => v[i]).map((v) => way(v)));
  }
  if (/_slab$/.test(name)) {
    if (!['bottom', 'top', 'double'].includes(props.type)) return null;
    const out = result(['type'], halfWays(props.type));
    if (props.type === 'double') out.again = {against: [0, 0, 0], face: [0, 1, 0], cursor: null, look: null};
    return out;
  }
  if (/_stairs$/.test(name)) return horizontal && ['bottom', 'top'].includes(props.half) ?
    result(['facing', 'half'], halfWays(props.half, f)) : null;
  if (/_door$/.test(name)) {
    if (!horizontal || props.half !== 'lower') return null;
    const w = way(FACES[0], f);
    const left = {north: 0.25, south: 0.75, east: 0.25, west: 0.75}[f];
    const h = props.hinge === 'right' ? 1 - left : left;
    // Neighbours can override this hinge; only facing and half are checked.
    w.cursor = f === 'north' || f === 'south' ? [h, 1, 0.5] : [0.5, 1, h];
    return result(['facing', 'half'], [w]);
  }
  if (/_trapdoor$/.test(name)) {
    if (!horizontal || !['bottom', 'top'].includes(props.half)) return null;
    const top = props.half === 'top', behind = neg(DIRS[f]);
    return result(['facing', 'half'], FACES.filter((v) => v[1] === (top ? 1 : -1) ||
      v.every((n, i) => n === behind[i])).map((v) => way(v, v[1] ? OPP[f] : null, v[1] ? null : top ? 0.75 : 0.25)));
  }
  if (PLAYER.has(name) || /_glazed_terracotta$/.test(name) || name === 'barrel') return (horizontal ||
    name === 'barrel' && Object.hasOwn(DIRS, f)) ? result(['facing'], FACES.map((v) => way(v, OPP[f]))) : null;
  if (/_fence_gate$/.test(name) || name === 'campfire' || name === 'soul_campfire' || /_bed$/.test(name)) return horizontal ?
    result(['facing'], (/_bed$/.test(name) ? FACES.slice(0, 1) : FACES).map((v) => way(v, f))) : null;
  // A wall sign hangs on the block behind it like a wall torch (the iron farm's 9 hold its water, 2026-10-15); its text stays blank.
  if (['wall_torch', 'soul_wall_torch', 'redstone_wall_torch', 'ladder'].includes(name) || /_wall_sign$/.test(name)) return horizontal ?
    result(['facing'], [way(neg(DIRS[f]))]) : null;
  if (name === 'lantern' || name === 'soul_lantern') return result(['hanging'], [way(FACES[props.hanging === 'true' ? 5 : 0])]);
  if (['torch', 'soul_torch', 'redstone_torch', 'flower_pot'].includes(name) || /_(carpet|pressure_plate)$/.test(name)) return result([], [way(FACES[0])]);
  if (['facing', 'hinge', 'part', 'type', 'half'].some((p) => Object.hasOwn(props, p))) return null;
  return result([], FACES.map((v) => way(v)));
}

// final: also the props that settle once the neighbours stand.
function matches(want, have, {final = false} = {}) {
  const p = placement(want.name, want.props);
  const kind = (n) => (BED.test(n) ? 'bed' : n);
  return p !== null && kind(strip(want.name)) === kind(strip(have.name)) &&
    [...p.check, ...(final ? p.final || [] : [])].every((key) => String(want.props?.[key] ?? CYCLE[strip(want.name)]?.[1][0]) === String(have.props?.[key]));
}

module.exports = {placement, skip, matches, itemOf, YAW, DIRS};
