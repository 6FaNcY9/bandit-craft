#!/usr/bin/env node
'use strict';
// Bots for bot-run.sh: each joins the throwaway server, reads the supply drop's announcement in chat like a
// player would, walks to the place, opens the chest and takes what is in it. Prints one JSON document with
// what each bot measured. NODE_PATH must point at the mcbots node_modules.
//   node bot.js <port> <count> <timeout seconds>
const mineflayer = require('mineflayer');
const {pathfinder, Movements, goals} = require('mineflayer-pathfinder');

const [port, count, timeout] = process.argv.slice(2).map(Number);
const t0 = Date.now();
const secs = () => Math.round((Date.now() - t0) / 100) / 10;
const results = [];
let chestTaken = false;

function run(i) {
  const r = {name: `evbot${i}`, events: []};
  results.push(r);
  const note = (what, extra) => r.events.push({t: secs(), what, ...extra});
  const bot = mineflayer.createBot({host: '127.0.0.1', port, username: r.name, auth: 'offline', version: '26.1', hideErrors: true});
  bot.loadPlugin(pathfinder);
  let going = false;

  async function go(x, z) {
    if (going) return;
    going = true;
    const from = bot.entity.position.clone();
    r.distance = Math.round(Math.hypot(x - from.x, z - from.z));
    note('set off', {from: [Math.round(from.x), Math.round(from.y), Math.round(from.z)], to: [x, z]});
    bot.pathfinder.setMovements(new Movements(bot));
    try {
      await bot.pathfinder.goto(new goals.GoalNearXZ(x, z, 3));
      note('arrived');
      // The chest appears when the lead time is over: wait for it next to the place.
      let chest = null;
      for (let n = 0; n < 600 && !chest; n++) {
        chest = bot.findBlock({matching: bot.registry.blocksByName.chest.id, maxDistance: 12});
        if (!chest) await new Promise((res) => setTimeout(res, 500));
      }
      if (!chest) return note('no chest found');
      note('chest seen', {at: [chest.position.x, chest.position.y, chest.position.z]});
      await bot.pathfinder.goto(new goals.GoalGetToBlock(chest.position.x, chest.position.y, chest.position.z));
      const win = await bot.openContainer(chest);
      const items = win.containerItems();
      r.found = items.map((it) => ({name: it.name, count: it.count, enchanted: !!(it.enchants && it.enchants.length)}));
      note('opened', {stacks: items.length});
      for (const it of items) await win.withdraw(it.type, it.metadata, it.count).catch((e) => note('withdraw failed', {item: it.name, error: e.message}));
      win.close();
      r.took = bot.inventory.items().map((it) => ({name: it.name, count: it.count}));
      r.first = items.length > 0 && !chestTaken;
      if (items.length > 0) chestTaken = true;
      note('done');
    } catch (e) {
      note('failed', {error: e.message});
    } finally {
      r.finished = true;
    }
  }

  bot.once('spawn', () => note('joined'));
  bot.on('death', () => note('died'));
  bot.on('kicked', (reason) => { note('kicked', {reason: String(reason).slice(0, 200)}); r.finished = true; });
  bot.on('error', (e) => note('error', {error: e.message}));
  bot.on('messagestr', (s) => {
    const m = /Supply drop (?:in \d+ min|landed) at X (-?\d+) Z (-?\d+)/.exec(s);
    if (!m) return;
    note(s.includes('landed') ? 'heard: landed' : 'heard: announced');
    go(Number(m[1]), Number(m[2]));
  });
  return bot;
}

const bots = Array.from({length: count}, (_, i) => run(i + 1));
const finish = () => {
  console.log(JSON.stringify({seconds: secs(), bots: results}, null, 2));
  bots.forEach((b) => b.quit());
  setTimeout(() => process.exit(results.some((r) => r.took && r.took.length) ? 0 : 1), 500);
};
const poll = setInterval(() => {
  if (results.every((r) => r.finished) || secs() > timeout) { clearInterval(poll); finish(); }
}, 500);
