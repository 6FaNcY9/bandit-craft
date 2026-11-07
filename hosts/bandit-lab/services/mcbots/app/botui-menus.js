'use strict';
// Picture menus (chest inventories with item icons) for the in-game bot UI: pure builders from a render view to the
// plugin's /menu body, no I/O. Same rule as botui-screens: the same view must build the same menu, because BotUi
// re-sends a refreshing screen only when its JSON changed.
const {choiceOf, CHOICES} = require('./idle');
const {safe} = require('./botui-screens');
const {germanName, BLOCKS, CRAFTS, SMELTS} = require('./botui-jobs');
const {recipeGrid, SMELT} = require('./recipes');
const {FUELS} = require('./crafting');

// One slot: `payload` comes back as the click's data, `extra` carries count/damage/head/glint/lore.
const slot = (i, item, name, payload, extra = {}) => ({slot: i, item, name: safe(name, 40), payload, ...extra});

// One badge item per activity (a slot holds one item); idle bots get none and show it in the tooltip only.
const BADGE = {mine: 'diamond_pickaxe', shift: 'diamond_pickaxe', chop: 'iron_axe', shiftlogs: 'iron_axe', treefarm: 'iron_axe', guard: 'iron_sword', follow: 'lead', trade: 'emerald', keeper: 'clock'};
const badgeOf = (s) => (s.job && BADGE[s.job.type]) || null;

// Rows 1-4: head at slot 2n, its badge to the right (18 bots at most). Bottom row: the all-bot buttons.
function overview(view) {
  const snaps = [...view.snaps].sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 18);
  const slots = [];
  snaps.forEach((s, n) => {
    const hp = s.online ? Math.max(0, Math.min(20, Math.round(s.health) || 0)) : 0, payload = {a: 'botm', bot: s.name};
    const idle = view.idle?.get(s.name), label = idle && choiceOf(idle.id)?.label;
    const lore = [safe(s.online ? s.activity || 'frei' : 'offline', 40), `♥ ${hp}/20`, ...(label ? [`Wenn frei: ${safe(label, 30)}`] : [])];
    slots.push(slot(2 * n, 'player_head', s.name, payload, {head: s.name, maxDamage: 20, damage: 20 - hp, lore}));
    const badge = badgeOf(s);
    if (badge) slots.push(slot(2 * n + 1, badge, s.name, payload, {lore: lore.slice(0, 1)}));
  });
  slots.push(slot(45, 'barrier', 'Alle: Stopp', {a: view.owner ? 'stopall' : 'stopmine'}),
    slot(46, 'ender_pearl', 'Alle: Komm zu mir', {a: 'comeall'}),
    slot(49, 'map', 'Karte', {a: 'karte'}),
    slot(51, 'writable_book', 'Bauplan hochladen', {a: 'upload'}),
    slot(53, 'book', 'Alle Befehle (alt)', {a: 'oldmenu'}));
  return {type: 'chest', title: 'Bots', rows: 6, slots};
}

const snapOf = (view, name) => view.snaps.find((s) => s.name === name) || {name, online: false};
const back = (i, a, bot) => slot(i, 'arrow', 'Zurück', {a, ...(bot ? {bot} : {})});

// The running job type -> the slot that started it (Abbauen and Bauen have no badge slot to light up here).
const GLINT = {follow: 'lead', goto: 'ender_pearl', guard: 'iron_sword', deposit: 'chest', chop: 'iron_axe', treefarm: 'oak_sapling', craft: 'crafting_table', smelt: 'furnace', get: 'chest_minecart'};

// One bot, 3 rows: head with its state, orders, then Wenn frei / Inventar / Zurück.
function botPage(view, screen) {
  const s = snapOf(view, screen.bot), bot = s.name, hp = s.online ? Math.max(0, Math.min(20, Math.round(s.health) || 0)) : 0;
  const food = s.online ? Math.max(0, Math.min(20, Math.round(s.food) || 0)) : 0;
  const idle = view.idle?.get(bot), label = (idle && choiceOf(idle.id)?.label) || 'Nichts';
  const lore = [safe(s.online ? s.activity || 'frei' : 'offline', 40), `♥ ${hp}/20 · Essen ${food}/20`, s.chest ? `Kiste: ${s.chest.x} ${s.chest.y} ${s.chest.z}` : 'Kiste: keine'];
  const go = (i, item, name, job) => slot(i, item, name, {a: 'go', bot, job}, {glint: GLINT[s.job?.type] === item});
  return {type: 'chest', title: safe(bot, 30), rows: 3, slots: [
    slot(0, 'player_head', bot, {a: 'botm', bot}, {head: bot, maxDamage: 20, damage: 20 - hp, lore}),
    go(2, 'lead', 'Folg mir', 'followme'), go(3, 'ender_pearl', 'Komm her', 'summon'), go(4, 'iron_sword', 'Bewach diesen Ort', 'guardhere'),
    go(5, 'chest', 'Einlagern', 'deposit'), slot(8, 'barrier', 'Stopp', {a: 'stop', bot}),
    slot(10, 'diamond_pickaxe', 'Abbauen…', {a: 'shiftm', bot}, {glint: ['mine', 'shift'].includes(s.job?.type)}), go(11, 'iron_axe', 'Holz holen', 'chop'),
    slot(12, 'crafting_table', 'Herstellen…', {a: 'craftm', bot}, {glint: s.job?.type === 'craft'}), slot(13, 'furnace', 'Schmelzen…', {a: 'smeltm', bot}, {glint: s.job?.type === 'smelt'}),
    slot(14, 'bricks', 'Bauen…', {a: 'job', key: 'schematic', bot}), slot(15, 'chest_minecart', 'Holen…', {a: 'gridm', mode: 'get', tab: 'werkzeug', page: 0, back: 'botm', bot}, {glint: s.job?.type === 'get'}),
    go(16, 'oak_sapling', 'Baumfarm', 'treefarm'),
    slot(19, 'clock', 'Wenn frei…', {a: 'idlem', bot}, {lore: [safe(label, 40)]}), slot(21, 'hopper', 'Kiste merken', {a: 'pick', kind: 'chest', bot}), slot(23, 'barrel', 'Inventar', {a: 'invm', bot}), back(26, 'ov')]};
}

// "Wenn frei": one slot per choice the viewer may pick; the keeper only for the owner's own bots.
const IDLE_ITEM = {holz: ['spruce_log', 'fällt Bäume und füllt seine Kiste'], stein: ['cobblestone', 'baut Stein ab und füllt seine Kiste'],
  baumfarm: ['oak_sapling', 'pflegt die Baumfarm'], wache: ['iron_sword', 'bewacht den Ort, an dem du ihn gesetzt hast'], keeper: ['clock', 'übernimmt die Daueraufträge']};
function idlePage(view, screen) {
  const s = snapOf(view, screen.bot), cur = view.idle?.get(s.name)?.id;
  const slots = CHOICES.filter((c) => IDLE_ITEM[c.id] && (c.id !== 'keeper' || !s.guest)).map((c, i) =>
    slot(i, IDLE_ITEM[c.id][0], c.label, {a: 'idle_set', bot: s.name, choice: c.id, m: 1}, {glint: cur === c.id, lore: [IDLE_ITEM[c.id][1]]}));
  slots.push(slot(7, 'barrier', 'Nichts', {a: 'idle_set', bot: s.name, choice: 'none', m: 1}, {glint: !cur}), back(8, 'botm', s.name));
  return {type: 'chest', title: `${safe(s.name, 20)}: wenn frei`, rows: 1, slots};
}

// The snapshot's inventory lines "<name> xN" as [name, count] pairs.
const invLines = (snap) => (snap.inventory || []).map((l) => /^([a-z0-9_]+) x(\d+)$/.exec(String(l))).filter(Boolean).map((m) => [m[1], Number(m[2])]);
const haveOf = (snap) => { const o = {}; for (const [n, c] of invLines(snap)) o[n] = (o[n] || 0) + c; return o; };

// The bot's inventory as picture slots, read-only (a click re-opens the same page).
function inventoryPage(view, screen) {
  const s = snapOf(view, screen.bot), slots = [];
  for (const [n, c] of invLines(s)) {
    if (slots.length < 53) slots.push(slot(slots.length, n, `${germanName(n)} ×${c}`, {a: 'invm', bot: s.name}, {count: Math.max(1, Math.min(64, c))}));
  }
  slots.push(back(53, 'botm', s.name));
  return {type: 'chest', title: `${safe(s.name, 20)}: Inventar`, rows: 6, slots};
}

// Staff aimed at a chest: pick which of the viewer's bots remembers it.
function chestPage(view) {
  const rows = Math.min(6, Math.ceil((view.snaps.length + 1) / 9)), last = rows * 9 - 1;
  const slots = [...view.snaps].sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, last)
    .map((s, i) => slot(i, 'player_head', s.name, {a: 'chestfor', bot: s.name}, {head: s.name, lore: ['Diese Kiste merken']}));
  slots.push(back(last, 'ov'));
  return {type: 'chest', title: 'Kiste merken für…', rows, slots};
}

// Abbauen: the amount cycle and the block grid's tabs (icon, label, ids; every id is in BLOCKS).
const AMOUNTS = [16, 64, 256, 'inf'];
const TABS = {erze: BLOCKS.filter((b) => /_ore$|^ancient_debris$/.test(b)), holz: BLOCKS.filter((b) => /_log$/.test(b)), stein: ['stone', 'cobblestone', 'deepslate'], erde: ['dirt', 'sand', 'gravel']};
const TAB_ICON = {erze: ['iron_ore', 'Erze'], holz: ['oak_log', 'Holz'], stein: ['stone', 'Stein'], erde: ['sand', 'Erde']};

// The 5-slot hopper: who, what, how much, where to, go. `view.form` is the viewer's {bot, block, amount, chest}.
function shiftPage(view) {
  const f = view.form, amount = f.amount;
  return {type: 'hopper', title: 'Abbauen', slots: [
    slot(0, 'player_head', f.bot, {a: 'botpick'}, {head: f.bot, lore: ['Klick: anderer Bot']}),
    f.block ? slot(1, f.block, germanName(f.block), {a: 'gridm', tab: 'erze', page: 0}, {lore: ['Klick: aussuchen']}) : slot(1, 'stick', 'Was? Klick: aussuchen', {a: 'gridm', tab: 'erze', page: 0}),
    slot(2, amount === 16 || amount === 64 ? f.block || 'paper' : 'paper', amount === 'inf' ? '∞ immer weiter' : String(amount), {a: 'amount'}, {count: amount === 16 || amount === 64 ? amount : 1, lore: ['Klick: Menge ändern']}),
    f.chest ? slot(3, 'barrel', `Wohin: ${f.chest.x} ${f.chest.y} ${f.chest.z}`, {a: 'pick', kind: 'chest'}, {lore: ['Klick: andere Kiste zeigen']}) : slot(3, 'barrier', 'Keine Kiste – klick und zeig auf eine', {a: 'pick', kind: 'chest'}),
    slot(4, 'lime_dye', 'Los!', {a: 'shiftgo'})]};
}

// Item grids: Herstellen (what jobs.CRAFTS can make), Schmelzen (jobs.SMELTS) and Holen (every known item).
const ITEM_TABS = {werkzeug: ['stone_pickaxe', 'iron_pickaxe', 'iron_sword', 'bucket'], bau: ['oak_planks', 'stick', 'torch', 'chest', 'crafting_table', 'furnace'], essen: ['bread'], rohstoffe: ['coal', 'raw_iron', 'iron_ingot', 'cobblestone', 'oak_log']};
const ITEM_TAB_ICON = {werkzeug: ['iron_pickaxe', 'Werkzeug'], bau: ['bricks', 'Bau'], essen: ['bread', 'Essen'], rohstoffe: ['iron_ingot', 'Rohstoffe'], schmelzgut: ['furnace', 'Schmelzgut']};
const craftTabs = Object.fromEntries(Object.entries(ITEM_TABS).map(([t, l]) => [t, l.filter((i) => CRAFTS.includes(i))]).filter(([, l]) => l.length));
const GRID_MODES = {block: {tabs: TABS, icons: TAB_ICON, pick: 'pickblock', key: 'block'},
  craft: {tabs: craftTabs, icons: ITEM_TAB_ICON, pick: 'pickitem', key: 'item'},
  smelt: {tabs: {schmelzgut: SMELTS}, icons: ITEM_TAB_ICON, pick: 'pickitem', key: 'item'},
  get: {tabs: ITEM_TABS, icons: ITEM_TAB_ICON, pick: 'pickitem', key: 'item'}};

// Grid: tab icons on top, (block mode: the viewer's last picks, then) the tab's entries (13 at most, so one page); bottom row: point at one (block mode), back.
// shortcut: `page` is carried but ignored, no tab has more than 36 entries; add paging when one does.
function gridPage(view, screen) {
  const mode = Object.hasOwn(GRID_MODES, screen.mode) ? screen.mode : 'block', g = GRID_MODES[mode];
  const tab = Object.hasOwn(g.tabs, screen.tab) ? screen.tab : Object.keys(g.tabs)[0];
  const slots = Object.keys(g.tabs).map((t, i) => slot(i, g.icons[t][0], g.icons[t][1], {a: 'gridm', mode, tab: t, page: 0, ...(screen.back ? {back: screen.back} : {}), ...(screen.bot ? {bot: screen.bot} : {})}, {glint: t === tab}));
  [...(mode === 'block' ? view.recent || [] : []), ...g.tabs[tab]].forEach((b, i) => slots.push(slot(9 + i, b, germanName(b), {a: g.pick, [g.key]: b}, mode === 'get' ? {lore: ['Klick: 16 holen · Shift: 64']} : {})));
  if (mode === 'block') slots.push(slot(52, 'stick', 'Zeig drauf', {a: 'pick', kind: 'block'}));
  const to = screen.back || 'shiftm';
  slots.push(back(53, to, to === 'botm' ? screen.bot : undefined));
  return {type: 'chest', title: mode === 'block' ? 'Welcher Block?' : 'Welches Item?', rows: 6, slots};
}

// Herstellen as a chest that looks like a crafting table: 3x3 at slots 1-3/10-12/19-21, result at 15. A missing ingredient is a grey pane.
const CELL_SLOT = [1, 2, 3, 10, 11, 12, 19, 20, 21];
const maxBatches = (grid, have) => {
  const need = {}; for (const n of grid.cells) if (n) need[n] = (need[n] || 0) + 1;
  return Math.min(...Object.entries(need).map(([n, c]) => Math.floor((have[n] || 0) / c)));
};
function craftPage(view) {
  const mk = view.make || {}, s = snapOf(view, mk.bot), bot = s.name, grid = mk.item && recipeGrid(mk.item);
  const slots = [...(bot ? [slot(8, 'player_head', bot, {a: 'craftm', bot}, {head: bot})] : []), slot(14, 'arrow', 'ergibt', {a: 'craftm', bot}),
    slot(17, 'crafting_table', 'Anderes Item…', {a: 'gridm', mode: 'craft', tab: 'werkzeug', page: 0, back: 'craftm'}), slot(26, 'arrow', 'Zurück', {a: 'botm', bot})];
  if (!grid) slots.push(slot(15, 'crafting_table', 'Was herstellen? Klick', {a: 'gridm', mode: 'craft', tab: 'werkzeug', page: 0, back: 'craftm'}));
  else {
    const have = haveOf(s), need = {};
    for (const n of grid.cells) if (n) need[n] = (need[n] || 0) + 1;
    grid.cells.forEach((n, i) => {
      if (!n) return;
      const ok = (have[n] || 0) >= need[n];
      slots.push(ok ? slot(CELL_SLOT[i], n, germanName(n), {a: 'craftm', bot}, {count: 1}) : slot(CELL_SLOT[i], 'gray_stained_glass_pane', germanName(n), {a: 'craftm', bot}, {lore: [`Fehlt: ${have[n] || 0}/${need[n]} · der Bot holt oder macht es selbst`]}));
    });
    const b = maxBatches(grid, have);
    slots.push(slot(15, mk.item, germanName(mk.item), {a: 'craftgo'}, {count: Math.max(1, Math.min(64, b * grid.per)), lore: [b ? `${b}× möglich · Klick: 1 · Shift: alle` : 'Zutaten fehlen · der Bot besorgt sie']}));
  }
  return {type: 'chest', title: bot ? `Herstellen: ${safe(bot, 20)}` : "Herstellen", rows: 3, slots};
}

// Schmelzen as the real furnace window: input, fuel and an output preview. The flame is not animated.
const SMELT_RESULT = Object.fromEntries(Object.entries(SMELT).map(([out, inp]) => [inp, out]));
const fuelOf = (have) => FUELS.find((f) => have[f] > 0) || null;
function smeltPage(view) {
  const mk = view.make || {}, s = snapOf(view, mk.bot), bot = s.name, have = haveOf(s), input = SMELT_RESULT[mk.item] && mk.item, fuel = fuelOf(have);
  const pick = {a: 'gridm', mode: 'smelt', tab: 'schmelzgut', page: 0, back: 'smeltm'}, n = input && Math.min(64, have[input]);
  const slots = [input ? slot(0, input, germanName(input), pick, {count: n || 1, lore: ['Klick: anderes Schmelzgut']}) : slot(0, 'stick', 'Was schmelzen? Klick', pick),
    fuel ? slot(1, fuel, germanName(fuel), {a: 'smeltm', bot}, {lore: [`Brennstoff: ${germanName(fuel)}`]}) : slot(1, 'gray_stained_glass_pane', 'Kein Brennstoff dabei · der Bot besorgt ihn', {a: 'smeltm', bot})];
  if (input) slots.push(slot(2, SMELT_RESULT[input], germanName(SMELT_RESULT[input]), {a: 'smeltgo'}, {count: n || 8, lore: ['Klick: 8 · Shift: alles was er hat']}));
  return {type: 'furnace', title: bot ? `Schmelzen: ${safe(bot, 20)}` : 'Schmelzen', slots};
}

// Which bot does it: the viewer's own bots as heads.
function botPickPage(view) {
  const rows = Math.min(6, Math.ceil((view.snaps.length + 1) / 9)), last = rows * 9 - 1;
  const slots = [...view.snaps].sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, last)
    .map((s, i) => slot(i, 'player_head', s.name, {a: 'setbot', bot: s.name}, {head: s.name, glint: view.form?.bot === s.name}));
  slots.push(back(last, 'shiftm'));
  return {type: 'chest', title: 'Welcher Bot?', rows, slots};
}

// Screens drawn as menus; later tasks add theirs to RENDER.
const RENDER = {ov: overview, botm: botPage, idlem: idlePage, invm: inventoryPage, chestm: chestPage, shiftm: shiftPage, gridm: gridPage, craftm: craftPage, smeltm: smeltPage, botpick: botPickPage};
const MENUS = new Set(Object.keys(RENDER));
const menu = (screen, view) => ({menu: RENDER[screen.name](view, screen)});

module.exports = {MENUS, menu, slot, badgeOf, overview, AMOUNTS, TABS, haveOf, ITEM_TABS, GRID_MODES, maxBatches, SMELT_RESULT, fuelOf};
