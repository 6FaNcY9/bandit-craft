'use strict';
// The enchant job: walk to an existing enchanting table, put the item and lapis in, pick offer `level` (1-3) and always
// take the item back out, whatever happened (too little XP or lapis must never lose it). Bots do not grind XP and never
// craft a table.

const lapisNeeded = (level) => level; // vanilla: offer i costs i + 1 lapis

const within = (p, ms, msg) => {
  let timer;
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(timer));
};

// Resolves when offer `i` is known (level >= 0); vanilla sends 0 for "no offer", which the caller rejects.
const ready = (table, i, ms) => new Promise((resolve, reject) => {
  const done = () => { clearTimeout(timer); table.removeListener('ready', check); resolve(); };
  const check = () => { if (table.enchantments[i]?.level >= 0) done(); };
  const timer = setTimeout(() => { table.removeListener('ready', check); reject(new Error('enchanting table gave no offers')); }, ms);
  table.on('ready', check);
  check();
});

function makeEnchant({nearBlock, goNear, guard, count, getMore, readyMs = 10000, stepMs = 10000}) {
  return async function enchant(r, job) {
    const {bot} = r, {item, level} = job.args;
    guard(job);
    if (count(bot, item) < 1) throw new Error(`need 1 ${item}`);
    const have = count(bot, 'lapis_lazuli');
    if (have < lapisNeeded(level)) await getMore(r, job, 'lapis_lazuli', lapisNeeded(level) - have);
    guard(job);
    if (count(bot, 'lapis_lazuli') < lapisNeeded(level)) throw new Error(`need ${lapisNeeded(level) - count(bot, 'lapis_lazuli')} more lapis_lazuli`);
    const found = nearBlock(bot, 'enchanting_table');
    if (!found) throw new Error('no enchanting_table nearby');
    if (bot.entity.position.distanceTo(found.position.offset(0.5, 0.5, 0.5)) > 4) await goNear(r, job, found.position.x, found.position.y, found.position.z, 3);
    guard(job);
    r.inventoryBusy = (r.inventoryBusy || 0) + 1;
    try {
      const table = await bot.openEnchantmentTable(bot.blockAt(found.position));
      try {
        await table.putTargetItem(bot.inventory.items().find((i) => i.name === item));
        for (let put = 0, s; put < lapisNeeded(level) && (s = bot.inventory.items().find((i) => i.name === 'lapis_lazuli')); put += s.count) await table.putLapis(s);
        await ready(table, level - 1, readyMs);
        const offer = table.enchantments[level - 1];
        if (!offer || offer.level <= 0) throw new Error('no offer at level ' + level);
        if (bot.experience.level < offer.level) throw new Error(`need level ${offer.level}, have ${bot.experience.level}`);
        await within(table.enchant(level - 1), stepMs, 'enchanting did not finish');
      } finally {
        await within(table.takeTargetItem(), stepMs, 'could not take the item back').catch(() => {});
        table.close();
      }
    } finally {
      r.inventoryBusy--;
    }
    job.progress = `${item} enchanted (offer ${level})`;
  };
}

module.exports = {makeEnchant, lapisNeeded};
