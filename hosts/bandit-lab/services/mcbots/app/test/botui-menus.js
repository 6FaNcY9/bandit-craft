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
{ // badges for the order types the bot page starts; Weiter only for a paused project
  const b = (type) => slots(view({snaps: [{name: 'zed', online: true, health: 20, job: {type}}]})).filter((x) => !x.head && x.slot < 45).map((x) => x.item);
  for (const [t, i] of [['craft', 'crafting_table'], ['smelt', 'furnace'], ['get', 'chest_minecart'], ['schematic', 'bricks'], ['goto', 'ender_pearl']]) assert.deepEqual(b(t), [i], t);
  const page = (projects) => menu({name: 'botm', bot: 'zed'}, view({projects})).menu.slots;
  assert.ok(!page({}).some((x) => x.name === 'Weiter')); assert.ok(!page({zed: {paused: false}}).some((x) => x.name === 'Weiter'));
  const w = page({zed: {paused: true}}).find((x) => x.name === 'Weiter');
  assert.deepEqual(w.payload, {a: 'resume', bot: 'zed'}); assert.ok(Object.hasOwn(ACTIONS, 'resume'));
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
  assert.deepEqual(s.find((x) => x.slot === 12).payload, {a: 'craftm', bot: 'zed'}); assert.equal(s.find((x) => x.slot === 12).item, 'crafting_table');
  assert.deepEqual(s.find((x) => x.slot === 13).payload, {a: 'smeltm', bot: 'zed'}); assert.equal(s.find((x) => x.slot === 13).item, 'furnace');
  assert.deepEqual(s.find((x) => x.slot === 15).payload, {a: 'gridm', mode: 'get', tab: 'werkzeug', page: 0, back: 'botm', bot: 'zed'}); assert.equal(s.find((x) => x.slot === 15).item, 'chest_minecart');
  assert.deepEqual(s.find((x) => x.slot === 11).payload, {a: 'go', bot: 'zed', job: 'chop'}); assert.equal(s.find((x) => x.slot === 14).item, 'bricks'); assert.equal(s.find((x) => x.slot === 16).item, 'oak_sapling');
  for (const [type, slot] of [['craft', 12], ['smelt', 13], ['get', 15]]) assert.deepEqual(page({...chopper, job: {type}}).slots.filter((x) => x.glint).map((x) => x.slot), [slot]);
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
  // oak planks and coal, not the cherry planks and charcoal minecraft-data lists first
  assert.equal(recipeGrid('stick').cells.find(Boolean), 'oak_planks'); assert.ok(recipeGrid('torch').cells.includes('coal'));
  assert.deepEqual(require('../botui').craftOrder({item: 'stick'}, {inventory: ['oak_planks x64']}, true).key, 'craft');
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
{ // part 2b task 1: Mehr, Bewachen, Hingehen, Wie viel, generic bot picker
  const pg = (name, o = {}, extra = {}) => menu({name, bot: 'zed', ...extra}, view(o)).menu;
  const at = (m, i) => m.slots.find((x) => x.slot === i);
  const b = pg('botm');
  assert.deepEqual([at(b, 6).item, at(b, 6).payload, at(b, 25).item, at(b, 25).payload], ['shield', {a: 'guardm', bot: 'zed'}, 'book', {a: 'morem', bot: 'zed'}]);
  const more = pg('morem');
  assert.equal(more.rows, 1); assert.match(more.title, /zed: mehr/);
  assert.deepEqual(more.slots.filter((x) => x.slot < 5).map((x) => x.payload.a), ['placem', 'go', 'go', 'go', 'go']);
  assert.deepEqual(at(more, 0).payload, {a: 'placem', mode: 'goto', bot: 'zed'}); assert.deepEqual(at(more, 1).lore, ['aus der Vorratskiste']);
  assert.deepEqual(at(more, 8).payload, {a: 'botm', bot: 'zed'});
  const guard = pg('guardm');
  assert.deepEqual([0, 1, 2, 3].map((i) => at(guard, i).count), [8, 16, 32, 48]); assert.deepEqual(at(guard, 2).payload, {a: 'guardgo', bot: 'zed', radius: 32});
  assert.ok(!at(guard, 5));
  const gm = at(pg('guardm', {mark: {spot: {x: 1, y: 2, z: 3}}}), 5);
  assert.deepEqual(gm.payload, {a: 'guardgo', bot: 'zed', radius: 16, mark: 1}); assert.equal(gm.item, 'red_banner');
  const places = [{name: 'Basis', kind: 'base', x: 1, y: 64, z: 2}, {name: 'geheim', kind: 'protected', x: 9, y: 9, z: 9}, {name: 'Apfel', kind: 'weird', x: 0, y: 1, z: 2}];
  const pl = pg('placem', {places, ctx: {gaze: {x: 1, y: 1, z: 1}}}, {mode: 'goto'});
  assert.equal(pl.rows, 6); assert.equal(pl.title, 'Wohin?');
  assert.deepEqual(pl.slots.filter((x) => x.slot >= 9 && x.slot < 53).map((x) => [x.name, x.item, x.payload.where]), [['Apfel', 'oak_sign', 'place:Apfel'], ['Basis', 'white_banner', 'place:Basis']]);
  assert.deepEqual(at(pl, 9).lore, ['0 1 2']); assert.deepEqual(at(pl, 0).payload, {a: 'placego', mode: 'goto', bot: 'zed', where: 'gaze'});
  assert.ok(!at(pl, 2)); assert.deepEqual(at(pl, 53).payload, {a: 'botm', bot: 'zed'});
  assert.ok(!at(pg('placem', {places}, {mode: 'goto'}), 0));
  assert.equal(at(pg('placem', {places, mark: {spot: {x: 1, y: 2, z: 3}}}, {mode: 'goto'}), 2).name, 'Markierte Stelle 1 2 3');
  const am = pg('amountm', {form: {bot: 'zed', amount: 'inf'}});
  assert.deepEqual(am.slots.slice(0, 4).map((x) => [x.name, x.count, !!x.glint]), [['16', 16, false], ['64', 64, false], ['256', 1, false], ['∞ immer weiter', 1, true]]);
  assert.deepEqual(at(am, 2).payload, {a: 'setamount', amount: 256}); assert.deepEqual(at(am, 8).payload, {a: 'shiftm'});
  assert.deepEqual(menu({name: 'shiftm'}, view({form: {bot: 'zed', block: null, amount: 16}})).menu.slots[2].payload, {a: 'amountm'});
  const bp = menu({name: 'botpick', back: 'botm', bot: 'zed'}, view()).menu;
  assert.deepEqual(bp.slots.find((x) => x.head === 'zed').payload, {a: 'setbot', bot: 'zed', back: 'botm'}); assert.deepEqual(bp.slots.at(-1).payload, {a: 'botm', bot: 'zed'});
  for (const m of [more, guard, pg('guardm', {mark: {spot: {x: 1, y: 2, z: 3}}}), pl, am, bp, b]) for (const x of m.slots) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  // a guest sees only her bot's pages
  const gv = view({viewer: 'Midari', allowed: ['MisaBot'], owner: false, snaps: snaps.filter((x) => x.name === 'MisaBot')});
  assert.deepEqual(menu({name: 'botpick', back: 'botm', bot: 'MisaBot'}, gv).menu.slots.filter((x) => x.head).map((x) => x.head), ['MisaBot']);
  assert.equal(JSON.stringify(menu({name: 'botm', bot: 'MisaBot'}, gv)), JSON.stringify(menu({name: 'botm', bot: 'MisaBot'}, gv)));
}
console.log('botui-menus ok');
{ // furnace window: input, fuel, output preview
  const page = (item, inv) => menu({name: 'smeltm'}, view({snaps: [{name: 'zed', online: true, inventory: inv}], make: {kind: 'smelt', bot: 'zed', item}})).menu;
  const at = (m, i) => m.slots.find((x) => x.slot === i);
  let m = page('raw_iron', ['raw_iron x20', 'coal x3']);
  assert.equal(m.type, 'furnace'); assert.match(m.title, /Schmelzen: zed/);
  assert.equal(at(m, 0).item, 'raw_iron'); assert.equal(at(m, 0).count, 20); assert.equal(at(m, 1).item, 'coal');
  assert.equal(at(m, 2).item, 'iron_ingot'); assert.equal(at(m, 2).count, 20); assert.deepEqual(at(m, 2).payload, {a: 'smeltgo'});
  m = page('raw_iron', ['raw_iron x20']); assert.equal(at(m, 1).item, 'gray_stained_glass_pane');
  m = page(null, ['coal x3']); assert.ok(!at(m, 2)); assert.equal(at(m, 0).item, 'stick');
  m = page('bedrock', []); assert.ok(!at(m, 2)); assert.ok(!JSON.stringify(m).includes('undefined'));
  assert.ok(!JSON.stringify(menu({name: 'smeltm'}, view({make: undefined})).menu).includes('undefined'));
}
