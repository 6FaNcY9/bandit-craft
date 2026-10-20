'use strict';
// Outside a fight a bot turns at a bounded rate: one 180 degree snap in a tick is what a hack client looks like to a
// server's movement checks, and the dashboard's walk logs. In a fight the turn stays instant (reaction speed is the point).
// 2026-10-20: written after combat/hunt/fluids called lookAt(.., true) with no limit at all.
const MAX_STEP = (40 * Math.PI) / 180; // per tick
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const step = (cur, want, max) => { const d = wrap(want - cur); return Math.abs(d) <= max ? want : cur + Math.sign(d) * max; };

// shortcut: the latest look wins, an older caller waiting on its turn returns early (aim may be short for it); revisit if a
// placer or digger is seen aiming wrong in the archive.
function install(bot, {fighting = () => false, max = MAX_STEP} = {}) {
  const raw = bot.look.bind(bot);
  let gen = 0;
  bot.look = async (yaw, pitch, force) => {
    if (fighting()) { gen++; return raw(yaw, pitch, force); }
    const mine = ++gen;
    for (;;) {
      const next = step(bot.entity.yaw, yaw, max);
      await raw(next, pitch, force);
      if (next === yaw || gen !== mine) return;
      await bot.waitForTicks(1);
      if (gen !== mine) return;
    }
  };
  return bot;
}

// Largest yaw change in one physics tick, in degrees, per window, split into fights and the rest: the proof that a
// bot turns like a player (sandbox only: bots.js writes the windows to LOOK_STATS_FILE, tools/mcbots-scenarios reads them).
class Sampler {
  constructor(now = Date.now) { this.now = now; this.last = null; this.win = {t: now(), out: 0, fight: 0}; }
  tick(yaw, fighting) {
    if (this.last !== null && Number.isFinite(yaw)) {
      const d = (Math.abs(wrap(yaw - this.last)) * 180) / Math.PI;
      const k = fighting ? 'fight' : 'out';
      this.win[k] = Math.max(this.win[k], Math.round(d * 10) / 10);
    }
    this.last = Number.isFinite(yaw) ? yaw : null;
  }
  flush() { const w = this.win; this.win = {t: this.now(), out: 0, fight: 0}; return w; }
}

module.exports = {install, step, MAX_STEP, Sampler};
