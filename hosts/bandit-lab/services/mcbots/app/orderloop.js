'use strict';
// What the hub does with the owner's standing orders when a job event arrives (server.js orderEnded / orderTick):
// retry after a failure, start again when the bot is idle, hold a bot that keeps dying.

// What a job event does to the owner's order {type, args}: a finish ends it; a failure or a give-up keeps it and the
// job starts again after `retry` ms. One exploded chest failed bot1's and bot2's iron farm orders, the agents took both
// bots, and bot1 changed jobs 806 times in 17 h, out at night without armour: 17 deaths (main server 2026-10-17).
// null: the event is not about the order. An order saved without its args (before this) ends as it used to.
const ORDER_RETRY_MS = 5 * 60000;
function orderOutcome(e, order) {
  const m = order && (e.kind === 'done' || e.kind === 'fail') && /^(finished|failed|gave up): (\w+)/.exec(e.text || '');
  if (!m || m[2] !== order.type) return null;
  if (m[1] === 'finished' || !order.args) return {end: true};
  return {retry: m[1] === 'gave up' ? 4 * ORDER_RETRY_MS : ORDER_RETRY_MS}; // gave up: it died 4 times, give it longer
}

// Owner orders to start again now: the bot is online and idle, the order has its args, and a failure's wait
// (retryAt) is over. A sweep, not a timer per failure: a restart forgot the timer, and bot2 sat idle with its
// order after the 11:19 deploy (main server 2026-10-17). -> [[bot, order]]
function ordersToStart(orders, snapshotOf, retryAt, now = Date.now()) {
  const out = [];
  for (const [bot, order] of orders) {
    const s = snapshotOf(bot);
    if (!order?.args || !s?.online || s.connected === false || s.job || s.queue?.length || (retryAt.get(bot) || 0) > now) continue;
    out.push([bot, order]);
  }
  return out;
}

// A bot that dies DEATH_LOOP times within DEATH_WINDOW_MS is not sent back at its order for DEATH_HOLD_MS: bot1 died 19 times in
// 3 h on the owner's produce order, as every failure of the resumed job let the order start fresh and reset the interruption
// count (main server 2026-10-19). `times`: its recent deaths; -> {times: to keep, hold: true when the loop is on}.
const DEATH_LOOP = 3;
const DEATH_WINDOW_MS = 30 * 60000;
const DEATH_HOLD_MS = 30 * 60000;
function deathLoop(times, t) {
  const kept = [...times, t].filter((x) => t - x <= DEATH_WINDOW_MS);
  return kept.length >= DEATH_LOOP ? {times: [], hold: true} : {times: kept, hold: false};
}
// The alert for a death loop: its order is held, its queued jobs are dropped (they went on after each respawn, and the
// next grave in the same dark wood killed bot1 five times in 11 min, main server 2026-10-20).
const deathLoopAlert = (bot, order, queued) => `${bot} died ${DEATH_LOOP} times in ${DEATH_WINDOW_MS / 60000} min: ${
  [order && `its ${order.type} order waits ${DEATH_HOLD_MS / 60000} min`, queued && `its ${queued} queued jobs are dropped`].filter(Boolean).join(', ') || 'nothing queued'}`;

module.exports = {deathLoop, deathLoopAlert, DEATH_LOOP, DEATH_WINDOW_MS, DEATH_HOLD_MS, ordersToStart, orderOutcome, ORDER_RETRY_MS};
