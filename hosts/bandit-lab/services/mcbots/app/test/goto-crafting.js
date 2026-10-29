'use strict';
const assert = require('node:assert');
(async () => { // settledGoto: only goal_reached is an arrival (pathfinder 2.4.5 resolves goto on any empty path)
  const {EventEmitter} = require('node:events');
  const {settledGoto, goNear} = require('../bots');
  const mk = () => {
    const bot = new EventEmitter();
    bot.pathfinder = {setGoal: (g) => bot.emit('goal_updated', g, false)};
    return bot;
  };
  const tick = () => new Promise((res) => setTimeout(res, 5));
  const goal = {};
  let bot = mk(), settled = null;
  settledGoto(bot, goal).then(() => (settled = 'ok'), (e) => (settled = e.message));
  bot.emit('path_update', {status: 'partial', path: []}); // still searching: no arrival
  await tick();
  assert.strictEqual(settled, null, 'a partial empty path is no arrival');
  bot.emit('goal_reached', goal);
  await tick();
  assert.strictEqual(settled, 'ok');
  assert.strictEqual(bot.listenerCount('path_update') + bot.listenerCount('goal_reached') + bot.listenerCount('goal_updated') + bot.listenerCount('path_stop'), 0, 'no listener left behind');
  for (const [act, want] of [[(b) => b.emit('path_update', {status: 'noPath', path: []}), /No path/], [(b) => b.emit('path_update', {status: 'timeout', path: [1]}), /Took to long/],
    [(b) => b.pathfinder.setGoal(null), /goal was changed/], [(b) => b.emit('path_stop'), /stopped/]]) {
    bot = mk();
    const p = settledGoto(bot, goal);
    act(bot);
    await assert.rejects(p, want);
  }
  { // on farmland (15/16 high) the search starts one up and finds the goal reached, but the plugin checks the
    // floored position and never says goal_reached: an empty successful path there is an arrival (sandbox wheat field)
    const {Vec3} = require('vec3');
    const onFarmland = {isEnd: (p) => p.y === 68};
    bot = mk();
    let cleared = false;
    bot.entity = {position: new Vec3(3301.3, 67.94, 2980.5)};
    bot.pathfinder.setGoal = (g) => { if (g === null) cleared = true; bot.emit('goal_updated', g, false); };
    settled = null;
    settledGoto(bot, onFarmland).then(() => (settled = 'ok'), (e) => (settled = e.message));
    bot.emit('path_update', {status: 'success', path: []});
    await tick();
    assert.deepStrictEqual([settled, cleared], ['ok', true]);
    bot = mk();
    bot.entity = {position: new Vec3(0.5, 64, 0.5)};
    settled = null;
    settledGoto(bot, onFarmland).then(() => (settled = 'ok'), (e) => (settled = e.message));
    bot.emit('path_update', {status: 'success', path: []});
    await tick();
    assert.strictEqual(settled, null, 'an empty path away from the goal is no arrival');
  }
  { // the pathfinder plugin arrives after createBot: goto is swapped at spawn
    const {useSettledGoto} = require('../bots');
    const b = new EventEmitter();
    useSettledGoto(b);
    const upstream = async () => {};
    b.pathfinder = {goto: upstream}; // what loadPlugin installs later
    b.emit('spawn');
    assert.notStrictEqual(b.pathfinder.goto, upstream);
  }
  // goNear: a walk interrupted by a fight waits for it and is not a failed try
  const {Vec3} = require('vec3');
  let calls = 0, busy = false;
  const b2 = Object.assign(new EventEmitter(), {entity: {position: new Vec3(0, 64, 0)}, game: {dimension: 'overworld'},
    pathfinder: {goto: async () => { calls++; if (calls <= 5) { busy = true; setTimeout(() => (busy = false), 10); throw new Error('The goal was changed before it could be completed!'); } }, stop() {}, setGoal() {}}});
  const r = {bot: b2, world: {hostilesNear: () => []}, emit() {}, protectedAreas: [], combat: {get busy() { return busy; }}};
  await goNear(r, {t: {}, cancelled: false}, 10, 64, 0, 1);
  assert.strictEqual(calls, 6, 'five fight interruptions, then the walk');
  // ... also when the fight's end changed the goal: release() clears it while busy is already false, and bot2's
  // shaft failed 60 times in 6 h with "The goal was changed" (main server, 2026-10-15). A changed combat epoch is
  // no failed try either.
  calls = 0;
  const combat = {busy: false, epoch: 0};
  b2.pathfinder.goto = async () => { calls++; if (calls <= 5) { combat.epoch++; throw new Error('The goal was changed before it could be completed!'); } };
  await goNear({...r, combat}, {t: {}, cancelled: false}, 10, 64, 0, 1);
  assert.strictEqual(calls, 6, 'five fights that ended mid-walk, then the walk');
  // a climb with no way up digging natural ground only digs anything, then the job's limit is back (bot3, wheatfarm,
  // in a sandstone cave under a cobblestone lid, 2026-10-16)
  const seen = [], infos = [];
  const b3 = Object.assign(new EventEmitter(), {entity: {position: new Vec3(0.5, 59, 0.5)}, game: {dimension: 'overworld'}, inventory: {items: () => [{name: 'iron_pickaxe'}]},
    blockAt: (p) => (p.y === 63 ? {boundingBox: 'block', name: 'cobblestone'} : {boundingBox: 'empty', name: 'air'}),
    pathfinder: {searchRadius: -1, stop() {}, setGoal() {}, goto: async () => {
      seen.push(!!r3.digOnly);
      if (b3.entity.position.y >= 64) return;
      if (r3.digOnly) throw new Error('No path to the goal!');
      b3.entity.position = new Vec3(0.5, 68, 0.5);
    }}});
  const {NATURAL} = require('../bots');
  const r3 = {bot: b3, world: {hostilesNear: () => []}, emit: (k, t) => infos.push(t), protectedAreas: [], combat: {busy: false, epoch: 0}, digOnly: NATURAL, digBox: {x1: 50, z1: 50, x2: 60, z2: 60}};
  await goNear(r3, {t: {}, cancelled: false}, 0, 68, 0, 1);
  assert.ok(seen[0] && seen.includes(false) && seen.at(-1), `limited, then out digging anything, then the walk with the limit: ${seen}`);
  assert.ok(r3.digOnly === NATURAL && r3.digBox && infos.some((t) => /climbing out digging anything/.test(t)), infos.join('|'));
  // a job that digs nothing at all (seal, level) keeps that: no way up stays "No path"
  b3.entity.position = new Vec3(0.5, 59, 0.5);
  r3.digOnly = /(?!)/;
  await assert.rejects(goNear(r3, {t: {}, cancelled: false}, 0, 68, 0, 1), /No path/);
})();

{ // smelt takes what goes in, not what comes out nor an ore that drops its item
  const {VALIDATE} = require('../bots');
  assert.deepStrictEqual(VALIDATE.smelt({item: 'raw_iron', count: 8}), {item: 'raw_iron', count: 8});
  assert.throws(() => VALIDATE.smelt({item: 'iron_ingot', count: 9}), /what comes out: smelt raw_iron/);
  assert.throws(() => VALIDATE.smelt({item: 'coal_ore', count: 4}), /mine the ore/);
  assert.doesNotThrow(() => VALIDATE.smelt({item: 'beef', count: 4}));
}

{ // the model's plain words: crafted items are not mined, and craft takes the real item name
  const {VALIDATE} = require('../bots');
  assert.throws(() => VALIDATE.mine({block: 'torches', count: 10}), /crafted, not mined/);
  assert.deepStrictEqual(VALIDATE.mine({block: 'iron_ore', count: 3}), {block: 'iron_ore', count: 3});
  assert.deepStrictEqual(VALIDATE.craft({item: 'planks', count: 4}), {item: 'oak_planks', count: 4});
}

(async () => { // evictBots: bots on the real server are kicked (Velocity moves them to the sandbox), players stay
  const {Admin} = require('../admin');
  const sent = [];
  const a = new Admin({call: async (cmds) => { sent.push(...cmds); return cmds.map((c) => (c === 'minecraft:list' ? 'There are 3 of a max of 12 players online: bot3, MidariBread, bot17' : '')); }, events: {add() {}}});
  assert.deepStrictEqual(await a.evictBots(), ['bot3', 'bot17']);
  assert.deepStrictEqual(sent.slice(1), ['minecraft:kick bot3 bots play in the sandbox', 'minecraft:kick bot17 bots play in the sandbox']);
  const g = new Admin({call: async (cmds) => cmds.map((c) => (c === 'minecraft:list' ? 'There are 2 of a max of 12 players online: MisaBot, bot23' : '')), events: {add() {}}, botNames: ['MisaBot', 'bot23'], guests: ['MisaBot', 'bot23']});
  assert.deepStrictEqual(await g.evictBots(), [], 'guest bots play on the real server');
})();

(async () => { // ensureItem: an ingredient that cannot be crafted comes from the base chest before giving up
  const {makeCrafting} = require('../crafting');
  const items = [{name: 'cobblestone', count: 1}];
  const bot = {registry: {itemsByName: {cobblestone: {id: 1}}}, inventory: {items: () => items}, recipesAll: () => []};
  const asked = [];
  const c = makeCrafting({goNear: async () => {}, guard() {}, fetch: async (r, job, item, n) => { asked.push([item, n]); items[0].count += n; }});
  await c.ensureItem({bot}, {}, 'cobblestone', 3);
  assert.deepStrictEqual(asked, [['cobblestone', 2]]);
  const none = makeCrafting({goNear: async () => {}, guard() {}, fetch: async () => {}});
  await assert.rejects(none.ensureItem({bot}, {}, 'cobblestone', 9), /need 6 more cobblestone/);
})();

(async () => { // ensureItem: with neither stone at hand, a stone pickaxe is planned from cobblestone, not cobbled_deepslate (bot1, 2026-10-16)
  const {makeCrafting} = require('../crafting');
  const items = [{name: 'stick', count: 2}];
  const names = {1: 'cobbled_deepslate', 2: 'cobblestone', 3: 'stick', 4: 'stone_pickaxe'};
  const variant = (stone) => ({requiresTable: false, result: {count: 1}, delta: [{id: stone, count: -3}, {id: 3, count: -2}, {id: 4, count: 1}]});
  const bot = {registry: {itemsByName: {stone_pickaxe: {id: 4}, cobblestone: {id: 2}, cobbled_deepslate: {id: 1}, stick: {id: 3}}, items: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, {name}]))},
    inventory: {items: () => items}, recipesAll: (id) => (id === 4 ? [variant(1), variant(2)] : []),
    recipesFor: () => [{result: {count: 1}}], craft: async () => items.push({name: 'stone_pickaxe', count: 1})};
  const asked = [];
  const c = makeCrafting({goNear: async () => {}, guard() {}, fetch: async (r, job, item, n) => { asked.push(item); items.push({name: item, count: n}); }});
  await c.ensureItem({bot}, {}, 'stone_pickaxe', 1);
  assert.deepStrictEqual(asked, ['cobblestone']);
})();

(async () => { // bookCraft: the server lays out a recipe from the bot's recipe book, the result comes out with a shift-click
  const {EventEmitter} = require('events');
  const {trackRecipeBook, bookCraft} = require('../crafting');
  const client = new EventEmitter(), sent = [], clicks = [];
  const window = new EventEmitter();
  window.id = 3;
  const bot = Object.assign(new EventEmitter(), {_client: client, openBlock: async () => window, closeWindow: (w) => sent.push(['close', w.id]), clickWindow: async (...a) => clicks.push(a)});
  client.write = (name, data) => { sent.push([name, data.recipeId]); if (data.recipeId === 8) setImmediate(() => window.emit('updateSlot:0', null, {name: 'campfire'})); };
  trackRecipeBook(bot);
  bot.emit('inject_allowed');
  const shaped = (id, displayId) => ({recipe: {displayId, display: {type: 'crafting_shaped', data: {result: {type: 'item', data: id}}}}});
  client.emit('recipe_book_add', {replace: true, entries: [shaped(145, 7), shaped(145, 8), {recipe: {displayId: 9, display: {type: 'furnace', data: {result: {type: 'item', data: 145}}}}}]});
  assert.deepStrictEqual([...bot.recipeBook.get(145)], [7, 8]); // a furnace recipe is no craft
  assert.strictEqual(await bookCraft(bot, 145, {}), true); // recipe 7 cannot be laid out (2 s), 8 can
  assert.deepStrictEqual(sent, [['craft_recipe_request', 7], ['craft_recipe_request', 8], ['close', 3]]);
  assert.deepStrictEqual(clicks, [[0, 0, 1]]);
  assert.strictEqual(await bookCraft(bot, 999, {}), false); // not in the book: bot.craft() does it
  client.emit('recipe_book_remove', {recipeIds: [7, 8]});
  assert.strictEqual(await bookCraft(bot, 145, {}), false);
  // a table that does not open is named, with how far it is from the eyes
  const {Vec3} = require('vec3');
  const shut = {entity: {position: new Vec3(0, 64, 0)}, recipeBook: new Map([[5, new Set([1])]]), openBlock: async () => { throw new Error('Event windowOpen did not fire'); }};
  await assert.rejects(bookCraft(shut, 5, {name: 'crafting_table', position: new Vec3(3, 64, 0)}), /did not fire \(the crafting_table at 3 64 0, 3\.7 from the eyes\)/);
})();

(async () => { // ensureItem: bot.craft(recipe, 9) made 1 campfire and threw "missing ingredient"; the rest come in more rounds (sandbox 2026-10-17)
  const {makeCrafting} = require('../crafting');
  const items = [{name: 'campfire', count: 0}];
  const bot = {registry: {itemsByName: {campfire: {id: 1}}, items: {1: {name: 'campfire'}}}, inventory: {items: () => items},
    recipesAll: () => [{requiresTable: false, result: {count: 1}, delta: [{id: 1, count: 1}]}], recipesFor: () => [{result: {count: 1}}],
    craft: async (recipe, n) => { items[0].count++; if (n > 1) throw new Error('missing ingredient'); }};
  await makeCrafting({goNear: async () => {}, guard() {}}).ensureItem({bot}, {}, 'campfire', 9);
  assert.strictEqual(items[0].count, 9);
  bot.craft = async () => { throw new Error('missing ingredient'); }; // no progress at all: the error, after 3 rounds
  await assert.rejects(makeCrafting({goNear: async () => {}, guard() {}}).ensureItem({bot}, {}, 'campfire', 10), /missing ingredient/);
})();

(async () => { // ensureItem: a fetch that walks far is followed by a table near the bot, not the one found first (2026-10-18)
  const {makeCrafting} = require('../crafting');
  const {Vec3} = require('vec3');
  const items = [];
  const at = (n) => items.find((i) => i.name === n);
  const tables = [], craftedAt = [];
  const bot = {
    entity: {position: new Vec3(0.5, 64, 0.5)},
    registry: {itemsByName: {furnace: {id: 1}, cobblestone: {id: 2}}, items: {1: {name: 'furnace'}, 2: {name: 'cobblestone'}}, blocksByName: {crafting_table: {id: 50}}},
    inventory: {items: () => items},
    recipesAll: (id) => (id === 1 ? [{requiresTable: true, result: {count: 1}, delta: [{id: 2, count: -8}, {id: 1, count: 1}]}] : []),
    recipesFor: () => [{result: {count: 1}}],
    findBlock: () => { const p = bot.entity.position.floored().offset(1, 0, 0); tables.push(p.x); return {name: 'crafting_table', position: p}; },
    blockAt: (p) => ({name: 'crafting_table', position: p}),
    craft: async (_recipe, _n, where) => { craftedAt.push(where.position.x); at('cobblestone').count -= 8; items.push({name: 'furnace', count: 1}); },
  };
  const fetch = async (_r, _job, item, n) => { items.push({name: item, count: n}); bot.entity.position = new Vec3(85.5, 64, 0.5); }; // the supply chest
  await makeCrafting({goNear: async () => {}, guard() {}, fetch}).ensureItem({bot}, {}, 'furnace', 1);
  assert.deepStrictEqual([tables, craftedAt], [[1, 86], [86]], 'crafted at the table by the supply chest');
})();

(async () => { // ensurePlanks: no logs in hand come from the base chest (bot3 could not make a hoe beside 87 logs, 2026-10-15)
  const {makeCrafting} = require('../crafting');
  const items = [];
  const bot = {registry: {itemsByName: {oak_planks: {id: 5}}}, inventory: {items: () => items}, recipesFor: () => [{}],
    craft: async (recipe, n) => { items.find((i) => i.name === 'oak_log').count -= n; items.push({name: 'oak_planks', count: 4 * n}); }};
  const asked = [];
  const c = makeCrafting({goNear: async () => {}, guard() {}, fetch: async (r, job, item, n) => { asked.push([item, n]); items.push({name: 'oak_log', count: n}); }});
  await c.ensurePlanks({bot}, {}, 6);
  assert.deepStrictEqual(asked, [['logs', 2]]);
  assert.ok(items.some((i) => i.name === 'oak_planks' && i.count >= 6));
  const none = makeCrafting({goNear: async () => {}, guard() {}, fetch: async () => {}});
  await assert.rejects(none.ensurePlanks({bot: {...bot, inventory: {items: () => []}}}, {}, 2), /no logs/);
})();
