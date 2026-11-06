'use strict';
// Picture menus (chest inventories with item icons) for the in-game bot UI: pure builders from a render view to the
// plugin's /menu body, no I/O. Same rule as botui-screens: the same view must build the same menu, because BotUi
// re-sends a refreshing screen only when its JSON changed.
const {choiceOf} = require('./idle');
const {safe} = require('./botui-screens');

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

// Screens drawn as menus; later tasks add theirs to RENDER.
const RENDER = {ov: overview};
const MENUS = new Set(Object.keys(RENDER));
const menu = (screen, view) => ({menu: RENDER[screen.name](view, screen)});

module.exports = {MENUS, menu, slot, badgeOf, overview};
