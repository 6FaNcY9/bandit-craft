'use strict';
// The base geometry (chest, storage room and hall, shaft, farms) and the first-start zones. Data only.
const {zoneBox} = require('./places');

// The shipped geometry; BASE.shaft/farm/wheat read the zone of that kind first (zoneBox), so moving a
// zone on the dashboard moves the work. Getters (not copies) because zones change at runtime.
const DEFAULTS = {
  shaft: {x1: -291, z1: -222, x2: -276, z2: -207},
  farm: {x1: -262, z1: -238, x2: -248, z2: -224},
  wheat: {x1: -262, z1: -250, x2: -254, z2: -242},
};
const xz = (kind, fb) => {
  const b = zoneBox(kind, fb);
  return {x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2};
};
const BASE = {
  box: {x1: -272, z1: -219, x2: -266, z2: -213},
  chest: {x: -271, y: 66, z: -214}, // the base chest: every base withdraw/deposit uses it, not SUPPLY_CHEST
  get shaft() { return xz('shaft', DEFAULTS.shaft); },
  get farm() { return xz('treefarm', DEFAULTS.farm); },
  // levelled to y 64 by console 2026-10-10, water source under a slab at -258 64 -246
  get wheat() { return xz('wheat', DEFAULTS.wheat); },
  room: {x1: -272, y1: 58, z1: -219, x2: -266, y2: 60, z2: -213}, // under the base box; floor y 57
  // the wall of single chests on the room's south side (live 2026-10-10): x -272..-266, y 58 and 59, nearest the door first
  // The chest wall: 8 double chests (x -272..-265, y 58 and 59, z -219); one cell each, a double opens from either half.
  // The storage hall next to it (built by console 2026-10-10): 56 double chests, see storage-layout.js.
  hall: {x1: -263, y1: 58, z1: -219, x2: -250, y2: 60, z2: -214},
  hallShell: {x1: -265, y1: 57, z1: -221, x2: -248, y2: 61, z2: -212},
  roomChests: [58, 59].flatMap((y) => [-272, -270, -268, -266].map((x) => ({x, y, z: -219}))),
};
// First-start zones (Places.seed): the base areas as dashboard markers, one kind per zone.
const seedZones = () => {
  const b = (o) => ({x1: o.x1, y1: o.y1, z1: o.z1, x2: o.x2, y2: o.y2, z2: o.z2});
  return [
    {name: 'Shaft', kind: 'shaft', box: {...DEFAULTS.shaft, y1: -59, y2: 80}},
    {name: 'Tree farm', kind: 'treefarm', box: {...DEFAULTS.farm, y1: 55, y2: 80}},
    {name: 'Wheat field', kind: 'wheat', box: {...DEFAULTS.wheat, y1: 58, y2: 72}},
    {name: 'Storage room', kind: 'storage', box: b(BASE.room)},
    {name: 'Storage hall', kind: 'storage', box: b(BASE.hall)},
    {name: 'Base', kind: 'base', box: {...BASE.box, y1: 55, y2: 75}},
    {name: 'Storage hall walls', kind: 'protected', box: b(BASE.hallShell)},
  ];
};

module.exports = {BASE, seedZones};
