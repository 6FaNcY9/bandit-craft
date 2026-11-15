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
{ // owner: three heads sorted by name in the top row, each bot's status right under its head, panes, then the buttons
  const m = menu({name: 'ov'}, view()).menu, s = m.slots;
  assert.equal(m.type, 'chest'); assert.equal(m.rows, 4); assert.match(m.title, /Bots/);
  const heads = s.filter((x) => x.head);
  assert.deepEqual(heads.map((x) => x.head), ['bot2', 'MisaBot', 'zed']);
  const bot2 = heads.find((x) => x.head === 'bot2');
  assert.equal(bot2.damage, 6); assert.equal(bot2.maxDamage, 20);
  assert.deepEqual(heads.map((x) => x.slot), [0, 1, 2]);
  assert.deepEqual([9, 10, 11].map((i) => s.find((x) => x.slot === i).item), ['diamond_pickaxe', 'barrier', 'lime_dye']); // working, offline, free
  assert.deepEqual([9, 10, 11].map((i) => s.find((x) => x.slot === i).name), ['mining stone', 'offline', 'frei']);
  assert.deepEqual(s.find((x) => x.slot === 9).payload, {a: 'botm', bot: 'bot2'}); assert.deepEqual(s.find((x) => x.slot === 9).lore, ['bot2']);
  assert.deepEqual(s.filter((x) => x.item === 'black_stained_glass_pane').map((x) => x.slot), [18, 19, 20, 21, 22, 23, 24, 25, 26]);
  assert.deepEqual(s.find((x) => x.slot === 27).payload, {a: 'stopall'}); assert.equal(s.find((x) => x.slot === 35).item, 'comparator');
  assert.deepEqual(heads[0].payload, {a: 'botm', bot: 'bot2'});
}
{ // guest: only own bots, stop only mine
  const v = view({viewer: 'Midari', allowed: ['MisaBot'], owner: false, snaps: snaps.filter((x) => x.name === 'MisaBot')});
  assert.deepEqual(slots(v).filter((x) => x.head).map((x) => x.head), ['MisaBot']);
  assert.deepEqual(slots(v).find((x) => x.slot === 27).payload, {a: 'stopmine'});
}
{ // 10 to 18 bots: two head rows, each with its status row; numbers sort as numbers; the buttons go back to 45-53
  const many = Array.from({length: 18}, (_, i) => ({name: `bot${i + 1}`, online: true, health: 20, job: null}));
  const m = menu({name: 'ov'}, view({snaps: many})).menu, heads = m.slots.filter((x) => x.head);
  assert.equal(m.rows, 6);
  assert.deepEqual(heads.slice(0, 3).map((x) => x.head), ['bot1', 'bot2', 'bot3']); assert.equal(heads[8].head, 'bot9');
  assert.deepEqual(heads.map((x) => x.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  assert.equal(m.slots.find((x) => x.slot === 27).item, 'lime_dye'); assert.deepEqual(m.slots.find((x) => x.slot === 45).payload, {a: 'stopall'});
  assert.equal(menu({name: 'ov'}, view({snaps: [...many, {name: 'bot19', online: true}]})).menu.slots.filter((x) => x.head).length, 18); // shortcut: the 19th bot is not shown
}
{ // lore carries activity, hearts and the idle choice; every payload is a real action
  const s = slots(view({idle: {get: (b) => (b === 'zed' ? {id: 'keeper'} : null)}}));
  assert.match(s.find((x) => x.head === 'zed').lore.join('|'), /♥ 20\/20/);
  assert.match(s.find((x) => x.head === 'zed').lore.join('|'), /Wenn frei/);
  for (const x of s) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.equal(new Set(s.map((x) => x.slot)).size, s.length);
}
{ // badges for the order types the bot page starts; Weiter only for a paused project
  const b = (type) => slots(view({snaps: [{name: 'zed', online: true, health: 20, job: {type}}]})).filter((x) => x.slot === 9).map((x) => x.item);
  for (const [t, i] of [['craft', 'crafting_table'], ['smelt', 'furnace'], ['get', 'chest_minecart'], ['schematic', 'bricks'], ['goto', 'ender_pearl']]) assert.deepEqual(b(t), [i], t);
  const page = (projects) => menu({name: 'botm', bot: 'zed'}, view({projects})).menu.slots;
  assert.ok(!page({}).some((x) => x.name === 'Weiter')); assert.ok(!page({zed: {paused: false}}).some((x) => x.name === 'Weiter'));
  const w = page({zed: {paused: true}}).find((x) => x.name === 'Weiter');
  assert.deepEqual(w.payload, {a: 'resume', bot: 'zed'}); assert.ok(Object.hasOwn(ACTIONS, 'resume'));
}
{ // bot page: head lore, glint on the running job, the everyday orders with their lore, every payload a real action
  const bv = (s, o = {}) => view({snaps: [s], ...o});
  const page = (s, o) => menu({name: 'botm', bot: s.name}, bv(s, o)).menu;
  const chopper = {name: 'zed', online: true, health: 18, food: 15, activity: 'chopping', job: {type: 'chop'}, chest: {x: 1, y: 2, z: 3}};
  const m = page(chopper), s = m.slots, at = (i) => s.find((x) => x.slot === i);
  assert.equal(m.rows, 3);
  assert.match(s.find((x) => x.head === 'zed').lore.join('|'), /♥ 18\/20 · Essen 15\/20.*Kiste: 1 2 3/);
  assert.deepEqual(s.filter((x) => x.glint).map((x) => x.item), ['iron_axe']);
  assert.match(page({name: 'zed', online: true, job: null}).slots[0].lore.join('|'), /Kiste: keine/);
  assert.deepEqual(s.map((x) => [x.slot, x.name]), [[0, 'zed'], [2, 'Komm her'], [3, 'Folg mir'], [8, 'Stopp'], [10, 'Holz holen'], [11, 'Abbauen…'], [12, 'Bereich…'], [14, 'Bauen…'], [15, 'Einlagern'], [16, 'Mitmachen…'], [22, 'Mehr…'], [26, 'Zurück']]);
  assert.deepEqual([at(2), at(3), at(8), at(10), at(11), at(12), at(14), at(15), at(16), at(22)].map((x) => x.lore[0]), ['Der Bot kommt zu dir', 'Der Bot läuft dir nach', 'Hört sofort auf', '64 Stämme, nur in der Nähe', 'Erz, Stein, Erde: du wählst', 'Zwei Ecken zeigen, Arbeit wählen', 'Einen Bauplan bauen', 'Legt alles in seine Kiste', 'Hilft bei einem Bau der anderen', 'Farmen, Herstellen, Bewachen, Kiste']);
  assert.deepEqual(at(16).payload, {a: 'joinm', bot: 'zed'});
  const out = page(chopper, {joined: {zed: 'Sorter'}}).slots.find((x) => x.slot === 16);
  assert.deepEqual([out.name, out.lore, out.payload], ['Wieder raus', ['Hört bei Sorter auf'], {a: 'leave', bot: 'zed'}]);
  // Mitmachen: one entry per build, the payload names a bot of it (the args stay on the hub)
  const jm = menu({name: 'joinm', bot: 'zed'}, bv(chopper, {joinable: [{name: 'Sorter', bots: ['bot1', 'bot2'], at: {x: -308, y: 111, z: 11}}]})).menu;
  assert.deepEqual(jm.slots.map((x) => [x.slot, x.name, x.payload, x.lore?.[0]]), [[0, 'Mitbauen: Sorter', {a: 'join', bot: 'zed', from: 'bot1'}, 'bot1, bot2 · bei -308 111 11'], [8, 'Zurück', {a: 'botm', bot: 'zed'}, undefined]]);
  assert.equal(jm.rows, 1); for (const x of jm.slots) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.deepEqual(at(11).payload, {a: 'shiftm', bot: 'zed'}); assert.ok(!at(11).glint);
  assert.equal(page({...chopper, job: {type: 'shift'}}).slots.find((x) => x.slot === 11).glint, true);
  assert.deepEqual(at(10).payload, {a: 'go', bot: 'zed', job: 'chop'}); assert.equal(at(14).item, 'bricks'); assert.deepEqual(at(12).payload, {a: 'aream', bot: 'zed'});
  for (const x of s) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.equal(new Set(s.map((x) => x.slot)).size, s.length);
  assert.deepEqual(s.find((x) => x.item === 'ender_pearl').payload, {a: 'go', bot: 'zed', job: 'summon'});
  // Mehr: the moved slots keep their payloads and glints
  const more = (j) => menu({name: 'morem', bot: 'zed'}, bv({...chopper, job: j && {type: j}})).menu.slots, mo = more(null), ma = (i) => mo.find((x) => x.slot === i);
  assert.deepEqual(ma(18).payload, {a: 'pick', kind: 'chest', bot: 'zed'}); assert.equal(ma(18).item, 'hopper');
  assert.deepEqual([ma(2).payload, ma(3).payload, ma(4).payload], [{a: 'craftm', bot: 'zed'}, {a: 'smeltm', bot: 'zed'}, {a: 'enchm', bot: 'zed'}]);
  assert.deepEqual(ma(5).payload, {a: 'gridm', mode: 'get', tab: 'werkzeug', page: 0, back: 'botm', bot: 'zed'}); assert.equal(ma(0).item, 'oak_sapling');
  for (const [type, slot] of [['craft', 2], ['smelt', 3], ['get', 5], ['treefarm', 0], ['guard', [10, 11]]]) assert.deepEqual(more(type).filter((x) => x.glint).map((x) => x.slot), [slot].flat(), type);
  assert.ok(!mo.some((x) => x.name === 'Helfen' || x.name === 'Bereich…'));
  for (const x of mo) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
}
{ // Bereich: without corners only the header slots; with a 3x3x3 box the five jobs; a huge box greys excavate; a marked area adds slot 3
  const ar = (o = {}) => menu({name: 'aream'}, view({area: {bot: 'zed', when: 'next'}, sel: {}, ...o})).menu;
  const m0 = ar(), at = (m, i) => m.slots.find((x) => x.slot === i);
  assert.equal(m0.title, 'Bereich wählen'); assert.equal(m0.rows, 3);
  assert.deepEqual(m0.slots.map((x) => x.slot), [0, 2, 5, 6, 8, 26, 22]); assert.deepEqual([at(m0, 2).name, at(m0, 8).name, at(m0, 22).name, at(m0, 22).item], ['Zwei Ecken zeigen', 'Auswahl löschen', 'Erst Arbeit wählen', 'gray_stained_glass_pane']);
  assert.deepEqual(at(m0, 0).payload, {a: 'botpick', back: 'aream'}); assert.deepEqual(at(m0, 2).payload, {a: 'pick', kind: 'area'}); assert.equal(at(m0, 5).glint, true); assert.ok(!at(m0, 6).glint);
  assert.deepEqual(at(m0, 6).payload, {a: 'setwhen', when: 'now', screen: 'aream'}); assert.deepEqual(at(m0, 8).payload, {a: 'areaclear'}); assert.deepEqual(at(m0, 26).payload, {a: 'botm', bot: 'zed'});
  const p = (x, y, z) => ({x, y, z, dim: 'overworld'});
  const m1 = ar({sel: {a: p(0, 64, 0), b: p(2, 66, 2)}, mark: {area: {a: p(0, 0, 0), b: p(1, 1, 1)}}});
  assert.equal(m1.title, 'Bereich: 3 × 3 × 3'); assert.deepEqual(at(m1, 3).payload, {a: 'areafrom', from: 'mark'});
  assert.deepEqual(m1.slots.filter((x) => x.slot >= 9 && x.slot < 22).map((x) => x.payload.a), ['areapick', 'areapick', 'areapick', 'areapick', 'areapick']); assert.equal(at(m1, 2).name, 'Neu wählen');
  assert.deepEqual(m1.slots.filter((x) => x.slot >= 9 && x.slot < 22).map((x) => x.lore[0]), ['Gräbt einen Raum aus', 'Baut alle Blöcke ab', 'Gräbt ein Loch nach unten', 'Stellt Fackeln auf', 'Mauert Höhlen-Löcher an den Seiten zu']);
  const m3 = ar({area: {bot: 'zed', when: 'now', key: 'light'}, sel: {a: p(0, 64, 0), b: p(2, 66, 2)}});
  assert.deepEqual(m3.slots.filter((x) => x.glint).map((x) => x.slot), [6, 12]); assert.deepEqual([at(m3, 22).name, at(m3, 22).payload], ['Los!', {a: 'areago'}]);
  assert.deepEqual(m1.slots.filter((x) => x.slot >= 9 && x.slot < 22).map((x) => x.item), ['diamond_shovel', 'diamond_pickaxe', 'ladder', 'torch', 'stone_bricks']);
  const m2 = ar({sel: {a: p(0, 64, 0), b: p(39, 93, 39)}});
  assert.equal(at(m2, 9).item, 'red_stained_glass_pane'); assert.equal(at(m2, 9).name, 'Raum graben: geht hier nicht'); assert.match(at(m2, 9).lore[0], /^zu groß/);
  assert.equal(at(m2, 10).item, 'diamond_pickaxe'); assert.equal(at(m2, 10).lore.at(-1), 'Großer Bereich: in 8 Teilen'); assert.deepEqual(at(m2, 9).payload, {a: 'aream'});
  assert.equal(at(ar({area: {bot: 'zed', when: 'now', key: 'excavate'}, sel: {a: p(0, 64, 0), b: p(39, 93, 39)}}), 22).name, 'Erst Arbeit wählen', 'a greyed job gives no Los!');
  for (const x of [...m1.slots, ...m2.slots, ...m0.slots, ...m3.slots]) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.deepEqual(ar().slots, ar().slots);
}
{ // Tiere & Felder: corners or mark first, then the pictures; saved pens and fields start in one click; slot 21 of the bot page opens it
  const items = require('minecraft-data')('26.1').itemsByName, p = (x, y, z) => ({x, y, z, dim: 'overworld'});
  const places = [{name: 'Tiere 5 5', kind: 'pen', box: {x1: 5, y1: 60, z1: 5, x2: 9, y2: 66, z2: 9}}, {name: 'Feld 1 1', kind: 'field', crop: 'beetroot', box: {x1: 1, y1: 60, z1: 1, x2: 4, y2: 66, z2: 4}},
    {name: 'Leer', kind: 'field', box: {x1: 1, y1: 60, z1: 1, x2: 4, y2: 66, z2: 4}}, {name: 'Farm', kind: 'treefarm', box: {x1: 1, y1: 60, z1: 1, x2: 4, y2: 66, z2: 4}}];
  const fm = (o = {}) => menu({name: 'farmm'}, view({farm: {bot: 'zed'}, sel: {}, places, ...o})).menu, at = (m, i) => m.slots.find((x) => x.slot === i);
  const m0 = fm(), m1 = fm({sel: {a: p(0, 64, 0), b: p(2, 66, 3)}, mark: {area: {a: p(0, 0, 0), b: p(1, 1, 1)}}});
  assert.equal(m0.title, 'Tiere & Felder'); assert.equal(m0.rows, 3); assert.equal(m1.title, 'Tiere & Felder: 3 × 4');
  assert.deepEqual(m0.slots.map((x) => x.slot).sort((x, y) => x - y), [2, 18, 19, 26]); // no corners: no pictures; a field without crop is not offered
  assert.deepEqual(at(m0, 2).payload, {a: 'pick', kind: 'area'}); assert.equal(at(m0, 2).item, 'blaze_rod'); assert.deepEqual(at(m0, 26).payload, {a: 'botm', bot: 'zed'});
  assert.deepEqual(at(m1, 3).payload, {a: 'areafrom', from: 'mark'}); assert.equal(at(m1, 3).item, 'red_banner');
  assert.deepEqual([9, 10, 11, 12, 13].map((i) => [at(m1, i).item, at(m1, i).name, at(m1, i).payload]), [['wheat', 'Tiere', {a: 'farmgo', job: 'animalfarm'}],
    ['carrot', 'Karotten', {a: 'farmgo', job: 'cropfarm', crop: 'carrot'}], ['potato', 'Kartoffeln', {a: 'farmgo', job: 'cropfarm', crop: 'potato'}],
    ['beetroot', 'Rote Bete', {a: 'farmgo', job: 'cropfarm', crop: 'beetroot'}], ['sugar_cane', 'Zuckerrohr', {a: 'farmgo', job: 'cropfarm', crop: 'sugar_cane'}]]);
  assert.deepEqual([18, 19].map((i) => [at(m1, i).item, at(m1, i).payload]), [['wheat', {a: 'go', bot: 'zed', job: 'animalfarm', zone: 'Tiere 5 5'}], ['beetroot', {a: 'go', bot: 'zed', job: 'cropfarm', zone: 'Feld 1 1'}]]);
  for (const m of [m0, m1]) {
    assert.equal(new Set(m.slots.map((x) => x.slot)).size, m.slots.length);
    for (const x of m.slots) { assert.ok(x.slot >= 0 && x.slot < 27); assert.ok(items[x.item], x.item); assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a); }
  }
  assert.deepEqual(fm().slots, fm().slots);
  const b = menu({name: 'morem', bot: 'zed'}, view()).menu.slots.find((x) => x.slot === 1);
  assert.deepEqual(b.payload, {a: 'farmm', bot: 'zed'}); assert.equal(b.item, 'carrot');
}
{ // Wenn frei: Tiere and Feld fit the one row with Nichts and back, for the owner's bot and a guest's
  for (const b of [{name: 'zed', online: true}, {name: 'MisaBot', online: true, guest: true}]) {
    const s = menu({name: 'idlem', bot: b.name}, view({snaps: [b]})).menu.slots;
    assert.equal(new Set(s.map((x) => x.slot)).size, s.length); assert.ok(s.every((x) => x.slot >= 0 && x.slot < 9));
    assert.deepEqual(['tiere', 'feld'].map((c) => s.find((x) => x.payload.choice === c)?.item), ['wheat', 'carrot']);
  }
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
  assert.deepEqual(s.filter((x) => x.head).map((x) => [x.head, x.payload]), [['MisaBot', {a: 'chestjobs', bot: 'MisaBot'}]]);
}
{ // chest jobs page: five jobs, trader slots only for a trader, withdraw grid lore
  const page = (o) => menu({name: 'chestjobs', bot: 'zed', at: {x: 3, y: 4, z: 5}}, view(o)).menu;
  let m = page(); assert.equal(m.rows, 1); assert.equal(m.title, 'zed: diese Kiste');
  assert.deepEqual(m.slots.map((x) => [x.slot, x.item, x.payload]), [[0, 'hopper', {a: 'chestfor', bot: 'zed'}], [1, 'chest', {a: 'chestjob', bot: 'zed', job: 'deposit'}],
    [2, 'chest_minecart', {a: 'gridm', mode: 'withdraw', tab: 'werkzeug', page: 0, back: 'chestjobs', bot: 'zed'}], [3, 'spyglass', {a: 'chestjob', bot: 'zed', job: 'stock'}],
    [4, 'brush', {a: 'chestjob', bot: 'zed', job: 'tidy'}], [8, 'arrow', {a: 'chestm'}]]);
  m = page({traders: ['zed']}); assert.deepEqual(m.slots.filter((x) => x.slot === 6 || x.slot === 7).map((x) => x.payload), [{a: 'trader_add', bot: 'zed', kind: 'sticks'}, {a: 'trader_add', bot: 'zed', kind: 'stores'}]);
  for (const x of m.slots) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  const g = menu({name: 'gridm', mode: 'withdraw', tab: 'essen', back: 'chestjobs', bot: 'zed'}, view()).menu.slots;
  assert.equal(g.find((x) => x.slot === 9).lore[0], 'Klick: 16 · Shift: 64');
  assert.deepEqual(g.find((x) => x.slot === 53).payload, {a: 'chestjobs', bot: 'zed'});
  assert.equal(menu({name: 'chestm', at: {x: 3, y: 4, z: 5}}, view()).menu.title, 'Kiste bei 3 4 5: wer?');
}
{ // shift hopper: 5 slots, empty form shows the stick and the barrier, a full one the block, amount and chest
  const hop = (form, recent) => menu({name: 'shiftm'}, view({form, recent})).menu;
  let m = hop({bot: 'zed', block: null, amount: 'inf', chest: null});
  assert.equal(m.type, 'hopper'); assert.deepEqual(m.slots.map((x) => x.slot), [0, 1, 2, 3, 4]);
  assert.deepEqual([m.slots[1].item, m.slots[3].item, m.slots[4].item], ['stick', 'barrier', 'lime_dye']);
  assert.equal(m.slots[2].name, '∞ immer weiter'); assert.equal(m.slots[2].count, 1);
  m = hop({bot: 'zed', block: 'iron_ore', amount: 64, chest: {x: 1, y: 2, z: 3}});
  assert.deepEqual([m.slots[1].item, m.slots[2].item, m.slots[2].count, m.slots[3].name, m.slots[3].payload.a], ['iron_ore', 'iron_ore', 64, 'Nur in der Nähe', 'setfar']);
  assert.deepEqual(hop({bot: 'zed', block: 'iron_ore', amount: 64, far: true}).slots[3].lore, ['kann weit weglaufen · Klick: ändern']);
  assert.equal(hop({bot: 'zed', block: 'iron_ore', amount: 'inf', chest: {x: 1, y: 2, z: 3}}).slots[3].name, 'Wohin: 1 2 3', 'a shift (∞) shows its chest');
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
  assert.ok(m.slots.some((x) => x.item === 'blaze_rod' && x.payload.kind === 'block') && m.slots.some((x) => x.payload.a === 'shiftm'));
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
  assert.deepEqual([at(b, 22).item, at(b, 22).payload], ['book', {a: 'morem', bot: 'zed'}]);
  const more = pg('morem');
  assert.equal(more.rows, 3); assert.match(more.title, /zed: mehr/);
  assert.deepEqual([at(more, 11).item, at(more, 11).payload], ['shield', {a: 'guardm', bot: 'zed'}]);
  assert.deepEqual(more.slots.filter((x) => x.slot >= 9 && x.slot < 15).map((x) => x.payload.a), ['placem', 'go', 'guardm', 'go', 'go', 'go']);
  assert.deepEqual(at(more, 9).payload, {a: 'placem', mode: 'goto', bot: 'zed'}); assert.deepEqual(at(more, 14).lore, ['aus der Vorratskiste']);
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
{ // Verzaubern window and its item grid
  const page = (inv, item) => menu({name: 'enchm'}, view({snaps: [{name: 'zed', online: true, inventory: inv}], make: {kind: 'enchant', bot: 'zed', item}})).menu;
  const at = (m, i) => m.slots.find((x) => x.slot === i);
  let m = page(['iron_pickaxe x1', 'lapis_lazuli x3'], null);
  assert.equal(m.rows, 3); assert.equal(m.title, 'Verzaubern: zed');
  assert.equal(at(m, 10).item, 'iron_pickaxe'); assert.deepEqual(at(m, 10).payload, {a: 'gridm', mode: 'enchant', tab: 'dabei', page: 0, back: 'enchm'});
  assert.equal(at(m, 11).item, 'lapis_lazuli'); assert.equal(at(m, 11).count, 3);
  for (const n of [1, 2, 3]) { assert.equal(at(m, 13 + n).item, 'enchanted_book'); assert.deepEqual(at(m, 13 + n).payload, {a: 'enchgo', level: n}); }
  assert.deepEqual(at(m, 26).payload, {a: 'botm', bot: 'zed'});
  m = page(['iron_pickaxe x1', 'diamond_sword x1'], 'iron_pickaxe'); assert.equal(at(m, 10).item, 'iron_pickaxe');
  m = page(['iron_pickaxe x1'], null); assert.equal(at(m, 11).item, 'gray_stained_glass_pane');
  m = page(['lapis_lazuli x3', 'cobblestone x9'], null); assert.equal(at(m, 10).item, 'barrier'); assert.ok(!m.slots.some((x) => x.item === 'enchanted_book'));
  const g = (inv) => menu({name: 'gridm', mode: 'enchant', tab: 'dabei', page: 0, back: 'enchm'}, view({snaps: [{name: 'zed', online: true, inventory: inv}], make: {kind: 'enchant', bot: 'zed', item: null}})).menu;
  assert.deepEqual(g(['iron_pickaxe x1', 'cobblestone x9', 'bow x1', 'book x1']).slots.filter((x) => x.slot >= 9 && x.slot < 52).map((x) => x.item).sort(), ['bow', 'iron_pickaxe']);
  assert.equal(g(['cobblestone x9']).slots.find((x) => x.slot === 22).item, 'barrier');
  assert.ok(!JSON.stringify(menu({name: 'enchm'}, view({make: undefined})).menu).includes('undefined'));
}
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

{ // Jagen counts and Spawner/Weizenfarm heads; every payload a real action
  const h = menu({name: 'huntm'}, view({hunt: {animal: 'cow', bot: 'zed'}})).menu;
  assert.match(h.title, /Kühe jagen: zed/); assert.equal(h.slots.find((x) => x.slot === 0).item, 'cow_spawn_egg');
  assert.deepEqual([2, 3, 4, 5].map((i) => h.slots.find((x) => x.slot === i).count), [1, 4, 8, 16]);
  assert.deepEqual(h.slots.find((x) => x.slot === 7).payload, {a: 'botpick', back: 'huntm'});
  const w = menu({name: 'whom', job: 'lightspawner', at: {x: 1, y: 2, z: 3}}, view()).menu;
  assert.match(w.title, /Spawner ausleuchten/);
  assert.deepEqual(w.slots.find((x) => x.head === 'zed').payload, {a: 'go', bot: 'zed', job: 'lightspawner', x: 1, y: 2, z: 3});
  assert.match(menu({name: 'whom', job: 'wheatfarm'}, view()).menu.title, /Weizenfarm/);
  for (const x of [...h.slots, ...w.slots]) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
}
{ // schemm: newest first, own plans labelled, recent first, empty -> upload; buildm glints rotation and when
  const infos = [{file: 'a.litematic', size: {x: 1, y: 1, z: 1}, blocks: 1, top: 'stone', mtime: 1, owner: null},
    {file: 'fancy-b.litematic', size: {x: 4, y: 3, z: 4}, blocks: 20, top: 'stone_bricks', mtime: 2, owner: 'fancy'}];
  const m = menu({name: 'schemm', bot: 'zed', page: 0}, view({schematics: infos})).menu;
  assert.equal(m.title, 'Bauplan für zed'); assert.equal(m.rows, 6);
  assert.deepEqual(m.slots.filter((x) => x.slot < 45).map((x) => x.name), ['fancy-b', 'a']);
  assert.equal(m.slots[0].item, 'stone_bricks'); assert.deepEqual(m.slots[0].lore, ['4 × 3 × 4 · 20 Blöcke', 'eigener Plan']);
  assert.deepEqual(m.slots[0].payload, {a: 'pickplan', file: 'fancy-b.litematic'}); assert.equal(m.slots[1].lore[1], 'geteilt');
  assert.deepEqual(menu({name: 'schemm', bot: 'zed'}, view({schematics: infos, recentPlans: ['a.litematic']})).menu.slots[0].name, 'a');
  const e = menu({name: 'schemm', bot: 'zed'}, view({schematics: []})).menu.slots.find((x) => x.slot === 22);
  assert.equal(e.item, 'barrier'); assert.deepEqual(e.payload, {a: 'upload'});
  const b = menu({name: 'buildm'}, view({schematics: infos, build: {file: 'a.litematic', bot: 'zed', rotation: 90, at: null, when: 'now', mode: 'schematic'}})).menu;
  assert.equal(b.title, 'Bauen: a');
  assert.deepEqual(b.slots.filter((x) => x.glint).map((x) => x.slot), [4, 19]);
  for (const x of [...m.slots, ...b.slots]) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
}
{ // Einstellungen: the owner's keeper and Ziele, everyone's sidebar, the viewer's trader chests; Karte: zoom and centre
  const ks = (configured) => ({state: () => ({available: true, enabled: false, configured})});
  const z = (v) => menu({name: 'zielm'}, v).menu;
  const o = z(view({keeper: ks([['coal', 64]])}));
  assert.equal(o.title, 'Einstellungen'); assert.equal(o.rows, 2);
  assert.deepEqual(o.slots.find((x) => x.slot === 0), {slot: 0, item: 'clock', name: 'Daueraufträge: aus', payload: {a: 'keeper', on: true}, glint: false, lore: ['Klick schaltet ein']});
  assert.deepEqual(o.slots.find((x) => x.slot === 2).payload, {a: 'ziele'}); assert.equal(o.slots.find((x) => x.slot === 2).item, 'writable_book');
  assert.ok(!o.slots.some((x) => x.payload.a === 'plan'));
  assert.deepEqual(o.slots.filter((x) => x.item === 'oak_sign').map((x) => x.payload), [{a: 'sidebar', on: 1}, {a: 'sidebar', on: 0}]);
  assert.deepEqual(z(view({keeper: ks([])})).slots.map((x) => x.slot), [0, 4, 5, 17]);
  assert.match(z(view({keeper: ks([]), snaps: [{name: 'zed', sandbox: true}]})).slots[0].lore.join(), /Sandbox/);
  const g = z(view({viewer: 'Midari', allowed: ['MisaBot'], owner: false, keeper: ks([['coal', 64]])}));
  assert.deepEqual(g.slots.map((x) => x.slot), [4, 5, 17]);
  const tc = {list: (b) => (b === 'MisaBot' ? {sticks: [{x: 1, y: 2, z: 3}], stores: []} : {sticks: [], stores: [{x: 4, y: 5, z: 6}]})};
  const t = z(view({traders: ['MisaBot', 'EM_Trader'], traderChests: tc})).slots.filter((x) => x.slot >= 9 && x.slot < 17);
  assert.deepEqual(t.map((x) => [x.slot, x.item, x.name, x.payload]), [[9, 'stick', 'MisaBot Sticks 1 2 3', {a: 'trader_del', bot: 'MisaBot', kind: 'sticks', x: 1, y: 2, z: 3}], [10, 'emerald', 'EM_Trader Smaragde 4 5 6', {a: 'trader_del', bot: 'EM_Trader', kind: 'stores', x: 4, y: 5, z: 6}]]);
  assert.deepEqual(z(view({allowed: ['MisaBot'], owner: false, traders: ['MisaBot', 'EM_Trader'], traderChests: tc})).slots.filter((x) => x.slot >= 9 && x.slot < 17).map((x) => x.payload.bot), ['MisaBot']);
  assert.equal(slots(view()).find((x) => x.slot === 35).item, 'comparator'); assert.deepEqual(slots(view()).find((x) => x.slot === 35).payload, {a: 'zielm'});
  const k = menu({name: 'kartem'}, view({mapState: {zoom: 5, center: null}, snaps: [...snaps, {name: 'sbx', online: true, sandbox: true}]})).menu;
  assert.equal(k.title, 'Bot-Karte');
  assert.deepEqual(k.slots.filter((x) => x.item === 'map').map((x) => x.count), [1, 2, 5, 10, 25, 50]);
  assert.deepEqual(k.slots.filter((x) => x.glint).map((x) => x.slot), [2, 9]);
  assert.equal(k.slots.find((x) => x.slot === 0).name, '1 Block pro Pixel');
  assert.deepEqual(k.slots.filter((x) => x.slot >= 9 && x.slot < 17).map((x) => x.payload), [{a: 'center', me: 1}, {a: 'center', bot: 'bot2'}, {a: 'center', bot: 'MisaBot'}, {a: 'center', bot: 'zed'}]);
  assert.deepEqual(menu({name: 'kartem'}, view({mapState: {zoom: 5, center: 'bot2'}})).menu.slots.filter((x) => x.glint).map((x) => x.slot), [2, 10]);
  for (const x of [...o.slots, ...t, ...k.slots]) assert.ok(Object.hasOwn(ACTIONS, x.payload.a), x.payload.a);
  assert.equal(JSON.stringify(menu({name: 'kartem'}, view())), JSON.stringify(menu({name: 'kartem'}, view())));
}
(async () => { // Tiere & Felder through the handler: corners, farmgo submits and saves the place; too big refuses; idle_set tiere/feld
  const {BotUi} = require('../botui');
  const submits = [], saved = [], sets = [], snaps = [{name: 'zed', online: true, health: 20, job: null}];
  const api = {snapshots: () => snaps, places: () => [{name: 'Feld 1 1', kind: 'field', dim: 'overworld', crop: 'potato', box: {x1: 1, y1: 60, z1: 1, x2: 4, y2: 66, z2: 4}}], schematics: async () => [],
    submit: (v, j) => { require('../bots').VALIDATE[j.type](j.args); submits.push(j); return {ok: true, unreached: []}; }, savePlace: (v, place) => saved.push([v, place]),
    idle: {get: () => null, set: (b, c) => { sets.push([b, c]); return {ok: true, label: c}; }}};
  const ui = new BotUi({url: 'http://plugin.test', token: 't', viewerBots: {Fancy: '*'}, api, fetch: async () => ({ok: true, json: async () => ({ok: true})}), log: () => {}, now: () => 1e6});
  const ev = (type, extra) => ui.handle({type, player: 'Fancy', pos: [0, 64, 0], dim: 'overworld', yaw: 0, ...extra}), click = (data) => ev('click', {data});
  const corners = async (b) => { await click({a: 'pick', kind: 'area'}); await ev('open', {gaze: {x: 0, y: 64, z: 0, block: 'stone'}}); await ev('open', {gaze: {...b, block: 'stone'}}); };
  await click({a: 'farmm', bot: 'zed'}); assert.equal(ui.state('Fancy').screen.name, 'farmm');
  await corners({x: 16, y: 64, z: 16}); assert.equal(ui.state('Fancy').screen.name, 'farmm'); // the pick comes back to this page, not to Bereich
  await click({a: 'farmgo', job: 'animalfarm'});
  assert.equal(ui.state('Fancy').flash.text, 'Fehler: zu groß: höchstens 16 x 16'); assert.equal(submits.length, 0); assert.equal(saved.length, 0); assert.ok(ui.state('Fancy').sel.b);
  await corners({x: 3, y: 65, z: 4});
  await click({a: 'farmgo', job: 'animalfarm'});
  assert.deepEqual(submits.at(-1), {bots: ['zed'], type: 'animalfarm', args: {x1: 0, z1: 0, x2: 3, z2: 4, y: 64}, replace: false});
  assert.deepEqual(saved.at(-1), ['Fancy', {name: 'Tiere 0 0', kind: 'pen', dim: 'overworld', box: {x1: 0, y1: 64, z1: 0, x2: 3, y2: 65, z2: 4}}]);
  assert.deepEqual(ui.state('Fancy').screen, {name: 'botm', bot: 'zed'}); assert.equal(ui.state('Fancy').sel.a, null);
  await click({a: 'farmm', bot: 'zed'}); await corners({x: 3, y: 65, z: 4}); await click({a: 'farmgo', job: 'cropfarm', crop: 'sugar_cane'});
  assert.equal(submits.at(-1).args.crop, 'sugar_cane'); assert.deepEqual(saved.at(-1)[1], {name: 'Feld 0 0', kind: 'field', dim: 'overworld', box: {x1: 0, y1: 64, z1: 0, x2: 3, y2: 65, z2: 4}, crop: 'sugar_cane'});
  await click({a: 'go', bot: 'zed', job: 'cropfarm', zone: 'Feld 1 1'}); assert.deepEqual(submits.at(-1).args, {x1: 1, z1: 1, x2: 4, z2: 4, crop: 'potato', y: 60});
  for (const c of ['tiere', 'feld']) { await click({a: 'idle_set', bot: 'zed', choice: c, m: 1}); assert.deepEqual(sets.at(-1), ['zed', c]); assert.deepEqual(ui.state('Fancy').screen, {name: 'botm', bot: 'zed'}); }
  ui.stop?.();
  console.log('botui-menus farm ok');
})().catch((e) => { console.error(e); process.exit(1); });
