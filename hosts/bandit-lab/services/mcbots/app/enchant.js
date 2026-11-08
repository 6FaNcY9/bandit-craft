'use strict';
// The enchant job: walk to an enchanting table, put the item and lapis in, pick offer `level` (1-3) and always
// take the item back out, whatever happened (too little XP or lapis must never lose it). Bots do not grind XP.

const lapisNeeded = (level) => level; // vanilla: offer i costs i + 1 lapis

const ready = (table, ms) => new Promise((resolve, reject) => {
  const done = () => { clearTimeout(timer); table.removeListener('ready', done); resolve(); };
  const timer = setTimeout(() => { table.removeListener('ready', done); reject(new Error('enchanting table gave no offers')); }, ms);
  table.once('ready', done);
  if (table.enchantments.some((e) => e.level >= 0)) done();
});

function makeEnchant({station, guard, count, getMore, readyMs = 10000}) {
  return async function enchant(r, job) {
    const {bot} = r, {item, level} = job.args;
    guard(job);
    if (count(bot, item) < 1) throw new Error(`need 1 ${item}`);
    const have = count(bot, 'lapis_lazuli');
    if (have < lapisNeeded(level)) await getMore(r, job, 'lapis_lazuli', lapisNeeded(level) - have);
    guard(job);
    if (count(bot, 'lapis_lazuli') < lapisNeeded(level)) throw new Error(`need ${lapisNeeded(level) - count(bot, 'lapis_lazuli')} more lapis_lazuli`);
    const block = await station(r, job, 'enchanting_table', 0);
    guard(job);
    const table = await bot.openEnchantmentTable(block);
    try {
      await table.putTargetItem(bot.inventory.items().find((i) => i.name === item));
      await table.putLapis(bot.inventory.items().find((i) => i.name === 'lapis_lazuli'));
      await ready(table, readyMs);
      const offer = table.enchantments[level - 1];
      if (!offer || offer.level < 0) throw new Error(`no offer at level ${level}`);
      if (bot.experience.level < offer.level) throw new Error(`need level ${offer.level}, have ${bot.experience.level}`);
      await table.enchant(level - 1);
    } finally {
      await table.takeTargetItem().catch(() => {});
      table.close();
    }
    job.progress = `${item} enchanted (offer ${level})`;
  };
}

module.exports = {makeEnchant, lapisNeeded};
