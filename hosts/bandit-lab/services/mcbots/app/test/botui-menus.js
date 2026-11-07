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
{ // twelve bots: both pickers grow to two rows, every bot a head, the back arrow in the last slot
  const many = Array.from({length: 12}, (_, i) => ({name: `b${String(i).padStart(2, '0')}`, online: true, job: null}));
  for (const name of ['botpick', 'chestm']) {
    const m = menu({name}, view({snaps: many})).menu;
    assert.equal(m.rows, 2); assert.equal(m.slots.filter((x) => x.head).length, 12);
    assert.ok(m.slots.find((x) => x.slot === 17).payload.a);
    assert.ok(m.slots.every((x) => x.slot < 18));
  }
}
{ // recipe helper
  const {recipeGrid} = require('../recipes');
  assert.deepEqual(recipeGrid('stone_pickaxe').cells, ['cobblestone', 'cobblestone', 'cobblestone', null, 'stick', null, null, 'stick', null]);
  assert.equal(recipeGrid('stone_pickaxe').per, 1); assert.equal(recipeGrid('oak_planks').per, 4); assert.equal(recipeGrid('bedrock'), null);
}
{ // crafting look-alike: grey pane for a missing ingredient, result count and lore from the snapshot inventory
  const page = (item, inv) => menu({name: 'craftm'}, view({snaps: [{name: 'zed', online: true, inventory: inv}], make: {kind: 'craft', bot: 'zed', item}})).menu;
  const at = (m, i) => m.slots.find((x) => x.slot === i);
  let m = page('stone_pickaxe', ['cobblestone x5', 'stick x1']);
  assert.equal(m.rows, 3); assert.match(m.title, /Herstellen: zed/);
  assert.equal(at(m, 1).item, 'cobblestone'); assert.equal(at(m, 1).count, 1); assert.ok(!at(m, 1).lore);
  assert.equal(at(m, 20).item, 'gray_stained_glass_pane'); assert.equal(at(m, 20).name, 'Stock'); assert.match(at(m, 20).lore[0], /^Fehlt: 1\/2/);
  assert.equal(at(m, 15).item, 'stone_pickaxe'); assert.equal(at(m, 15).count, 1); assert.deepEqual(at(m, 15).lore, ['Zutaten fehlen · der Bot besorgt sie']);
  assert.deepEqual(at(m, 15).payload, {a: 'craftgo'});
  m = page('stone_pickaxe', ['cobblestone x5', 'stick x8']);
  assert.equal(at(m, 15).count, 1); assert.deepEqual(at(m, 15).lore, ['1× möglich · Klick: 1 · Shift: alle']);
  m = page('oak_planks', ['oak_log x3']);
  assert.equal(at(m, 15).count, 12); assert.match(at(m, 15).lore[0], /^3× möglich/);
  m = page(null, []);
  assert.equal(at(m, 15).item, 'crafting_table'); assert.deepEqual(at(m, 15).payload, {a: 'gridm', mode: 'craft', tab: 'werkzeug', page: 0, back: 'craftm'});
  assert.ok(!m.slots.some((x) => [1, 2, 3, 10, 11, 12, 19, 20, 21].includes(x.slot)));
  assert.ok(!menu({name: 'craftm'}, view({make: undefined})).menu.slots.some((x) => x.head === undefined && x.item === 'player_head' || String(x.name) === 'undefined'));
  for (const x of page('stone_pickaxe', ['stick x1']).slots) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
}
{ // item grid modes
  const jobs = require('../botui-jobs');
  const g = (mode) => menu({name: 'gridm', mode, tab: undefined, page: 0, back: 'craftm'}, view()).menu;
  const items = (m) => m.slots.filter((x) => x.payload.a === 'pickitem').map((x) => x.item);
  const c = g('craft');
  assert.ok(!items(c).includes('bread')); assert.ok(!c.slots.some((x) => x.payload.tab === 'essen'));
  for (const i of items(c)) assert.ok(jobs.CRAFTS.includes(i));
  const gt = menu({name: 'gridm', mode: 'get', tab: 'essen', page: 0, back: 'botm'}, view()).menu;
  assert.deepEqual(items(gt), ['bread']); assert.deepEqual(gt.slots.find((x) => x.payload.a === 'pickitem').lore, ['Klick: 16 holen · Shift: 64']);
  assert.ok(items(menu({name: 'gridm', mode: 'get', tab: 'rohstoffe', page: 0}, view()).menu).includes('coal'));
  assert.deepEqual(items(menu({name: 'gridm', mode: 'smelt', tab: 'schmelzgut', page: 0}, view()).menu), jobs.SMELTS);
  assert.ok(!c.slots.some((x) => x.payload.kind === 'block'));
  assert.equal(c.slots.find((x) => x.item === 'arrow').payload.a, 'craftm');
  for (const m of [c, gt, g('smelt')]) for (const x of m.slots) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
}
console.log('botui-menus ok');
