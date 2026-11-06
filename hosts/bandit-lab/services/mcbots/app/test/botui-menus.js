'use strict';
// Picture menus: the overview builder is pure, so these check the slots it builds for a view.
const assert = require('node:assert/strict');
const {menu, MENUS} = require('../botui-menus');
const {ACTIONS} = require('../botui');

const snaps = [
  {name: 'zed', online: true, health: 20, activity: 'idle', job: null},
  {name: 'bot2', online: true, health: 14, activity: 'mining stone', job: {type: 'mine'}},
  {name: 'MisaBot', online: false, job: null},
];
const view = (over = {}) => ({viewer: 'Fancy', snaps, allowed: '*', owner: true, idle: new Map(), ctx: {}, ...over});
const slots = (v) => menu({name: 'ov'}, v).menu.slots;

assert.ok(MENUS.has('ov'));
{ // owner: three heads sorted by name, the mining bot's badge and damage, stop all asks first
  const m = menu({name: 'ov'}, view()).menu, s = m.slots;
  assert.equal(m.type, 'chest'); assert.equal(m.rows, 6); assert.match(m.title, /Bots/);
  const heads = s.filter((x) => x.head);
  assert.deepEqual(heads.map((x) => x.head), ['bot2', 'MisaBot', 'zed']);
  const bot2 = heads.find((x) => x.head === 'bot2');
  assert.equal(bot2.damage, 6); assert.equal(bot2.maxDamage, 20);
  assert.equal(s.find((x) => x.slot === bot2.slot + 1).item, 'diamond_pickaxe');
  assert.equal(s.filter((x) => x.item === 'diamond_pickaxe').length, 1); // idle and offline bots: no badge
  assert.deepEqual(s.find((x) => x.slot === 45).payload, {a: 'stopall'});
  assert.deepEqual(heads[0].payload, {a: 'botm', bot: 'bot2'});
}
{ // guest: only own bots, stop only mine
  const v = view({viewer: 'Midari', allowed: ['MisaBot'], owner: false, snaps: snaps.filter((x) => x.name === 'MisaBot')});
  assert.deepEqual(slots(v).filter((x) => x.head).map((x) => x.head), ['MisaBot']);
  assert.deepEqual(slots(v).find((x) => x.slot === 45).payload, {a: 'stopmine'});
}
{ // lore carries activity, hearts and the idle choice; every payload is a real action
  const s = slots(view({idle: {get: (b) => (b === 'zed' ? {id: 'keeper'} : null)}}));
  assert.match(s.find((x) => x.head === 'zed').lore.join('|'), /♥ 20\/20/);
  assert.match(s.find((x) => x.head === 'zed').lore.join('|'), /Wenn frei/);
  for (const x of s) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.equal(new Set(s.map((x) => x.slot)).size, s.length);
}
{ // bot page: head lore, glint on the running job, Abbauen and Kiste merken slots, every payload a real action
  const bv = (s, o = {}) => view({snaps: [s], ...o});
  const page = (s, o) => menu({name: 'botm', bot: s.name}, bv(s, o)).menu;
  const chopper = {name: 'zed', online: true, health: 18, food: 15, activity: 'chopping', job: {type: 'chop'}, chest: {x: 1, y: 2, z: 3}};
  const m = page(chopper), s = m.slots;
  assert.equal(m.rows, 3);
  assert.match(s.find((x) => x.head === 'zed').lore.join('|'), /♥ 18\/20 · Essen 15\/20.*Kiste: 1 2 3/);
  assert.deepEqual(s.filter((x) => x.glint).map((x) => x.item), ['iron_axe']);
  assert.match(page({name: 'zed', online: true, job: null}).slots[0].lore.join('|'), /Kiste: keine/);
  assert.deepEqual(s.find((x) => x.slot === 10).payload, {a: 'shiftm', bot: 'zed'}); assert.ok(!s.find((x) => x.slot === 10).glint);
  assert.deepEqual(s.find((x) => x.slot === 21).payload, {a: 'pick', kind: 'chest', bot: 'zed'}); assert.equal(s.find((x) => x.slot === 21).item, 'hopper');
  assert.equal(page({...chopper, job: {type: 'shift'}}).slots.find((x) => x.slot === 10).glint, true);
  for (const x of s) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.equal(new Set(s.map((x) => x.slot)).size, s.length);
  assert.deepEqual(s.find((x) => x.item === 'ender_pearl').payload, {a: 'go', bot: 'zed', job: 'summon'});
}
{ // Wenn frei: guest bots get no keeper; the active choice glints; Nichts always
  const guest = {name: 'MisaBot', online: true, guest: true}, own = {name: 'zed', online: true};
  const items = (b, idle) => menu({name: 'idlem', bot: b.name}, view({snaps: [b], idle: {get: () => idle}})).menu.slots;
  assert.ok(!items(guest).some((x) => x.item === 'clock'));
  assert.ok(items(own).some((x) => x.item === 'clock'));
  assert.deepEqual(items(own, {id: 'stein'}).filter((x) => x.glint).map((x) => x.item), ['cobblestone']);
  assert.ok(items(own).some((x) => x.item === 'barrier' && x.payload.choice === 'none' && x.payload.m === 1));
  for (const x of items(own)) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
}
{ // inventory: counts capped at 64 per slot, name keeps the real count, read-only payload
  const b = {name: 'zed', online: true, inventory: ['iron_ingot x70', 'bread x3']};
  const m = menu({name: 'invm', bot: 'zed'}, view({snaps: [b]})).menu, s = m.slots;
  assert.equal(m.rows, 6);
  const ing = s.find((x) => x.item === 'iron_ingot');
  assert.equal(ing.count, 64); assert.equal(ing.name, 'Eisenbarren ×70'); assert.deepEqual(ing.payload, {a: 'invm', bot: 'zed'});
  assert.equal(s.find((x) => x.item === 'bread').count, 3);
  assert.ok(s.some((x) => x.payload.a === 'botm'));
}
{ // chest picker: only the viewer's own bots
  const v = view({viewer: 'Midari', allowed: ['MisaBot'], owner: false, snaps: snaps.filter((x) => x.name === 'MisaBot')});
  const s = menu({name: 'chestm'}, v).menu.slots;
  assert.deepEqual(s.filter((x) => x.head).map((x) => [x.head, x.payload]), [['MisaBot', {a: 'chestfor', bot: 'MisaBot'}]]);
}
{ // shift hopper: 5 slots, empty form shows the stick and the barrier, a full one the block, amount and chest
  const hop = (form, recent) => menu({name: 'shiftm'}, view({form, recent})).menu;
  let m = hop({bot: 'zed', block: null, amount: 'inf', chest: null});
  assert.equal(m.type, 'hopper'); assert.deepEqual(m.slots.map((x) => x.slot), [0, 1, 2, 3, 4]);
  assert.deepEqual([m.slots[1].item, m.slots[3].item, m.slots[4].item], ['stick', 'barrier', 'lime_dye']);
  assert.equal(m.slots[2].name, '∞ immer weiter'); assert.equal(m.slots[2].count, 1);
  m = hop({bot: 'zed', block: 'iron_ore', amount: 64, chest: {x: 1, y: 2, z: 3}});
  assert.deepEqual([m.slots[1].item, m.slots[2].item, m.slots[2].count, m.slots[3].name], ['iron_ore', 'iron_ore', 64, 'Wohin: 1 2 3']);
  assert.equal(hop({bot: 'zed', block: 'iron_ore', amount: 256}).slots[2].name, '256');
  for (const x of m.slots) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
}
{ // grid: holz lists only logs, all ids are real blocks, active tab glints, recents come first
  const BLOCKS = require('../botui-jobs').BLOCKS;
  const g = (tab, recent) => menu({name: 'gridm', tab, page: 0}, view({recent})).menu;
  const m = g('holz', ['iron_ore']);
  const blocks = m.slots.filter((x) => x.payload.a === 'pickblock');
  assert.deepEqual(blocks.map((x) => x.item), ['iron_ore', 'oak_log', 'birch_log', 'spruce_log']);
  for (const x of blocks) assert.ok(BLOCKS.includes(x.payload.block));
  assert.deepEqual(m.slots.filter((x) => x.glint).map((x) => x.item), ['oak_log']);
  assert.equal(m.slots.filter((x) => x.slot < 4).length, 4);
  assert.ok(m.slots.some((x) => x.item === 'stick' && x.payload.kind === 'block') && m.slots.some((x) => x.payload.a === 'shiftm'));
  assert.ok(g('erze').slots.some((x) => x.item === 'ancient_debris'));
  for (const x of m.slots) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.equal(new Set(m.slots.map((x) => x.slot)).size, m.slots.length);
}
{ // bot picker: own bots only
  const v = view({viewer: 'Midari', allowed: ['MisaBot'], owner: false, snaps: snaps.filter((x) => x.name === 'MisaBot'), form: {bot: 'MisaBot'}});
  assert.deepEqual(menu({name: 'botpick'}, v).menu.slots.filter((x) => x.head).map((x) => [x.head, x.payload]), [['MisaBot', {a: 'setbot', bot: 'MisaBot'}]]);
}
console.log('botui-menus ok');
