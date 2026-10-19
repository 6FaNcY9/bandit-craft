'use strict';
// Stranded bots (lab 2026-10-11: bot4 at the bottom of an unfinished shaft with neither pickaxe nor blocks, bot17
// walled in by its own seal): after STRANDED walks in a row that found no path, or STUCK_MS on one spot while it
// climbs or walks, the hub teleports the bot to the base over a console. The sandbox from the start; the main server
// since the owner allowed it (2026-10-19: bot1, bot2 and bot19 fell into holes under protected zones and climbed in
// place until Claude teleported them). Only this guarded tp reaches the console; every rescue is an event, so the
// causes stay visible (and the fix memory sees the failures).
const {NAME_RE} = require('./admin');

const STRANDED = 3;
const GAP_MS = 10 * 60000; // one rescue per bot per 10 min
const STUCK_MS = 8 * 60000;
const NO_PATH = /No path to the goal|Took to long to decide path/;
const MOVING = /^(climbing|walking|tunnelling)/; // what a bot that gets nowhere keeps saying; waits and digs never do

class Rescue {
  // call(commands[]) -> replies (RCON); target() -> {x, y, z} where a rescued bot lands; label names the server.
  constructor({call, events, target, now = Date.now, label = 'sandbox'}) {
    Object.assign(this, {call, events, target, now, label, fails: new Map(), last: new Map(), still: new Map()});
  }

  event(e) {
    if (e.kind === 'done' || (e.kind === 'fail' && !NO_PATH.test(e.text))) return this.fails.delete(e.bot);
    if (e.kind !== 'fail') return;
    const n = (this.fails.get(e.bot) || 0) + 1;
    this.fails.set(e.bot, n);
    if (n >= STRANDED) this.rescue(e.bot, `no path ${n} times in a row`).catch(() => {});
  }

  // Every minute with the bots' snapshots: one that climbs or walks but stays within 3 blocks for STUCK_MS.
  watch(snaps) {
    for (const s of snaps) {
      if (!s?.online || !s.pos || !s.job || !MOVING.test(s.activity || '')) { this.still.delete(s?.name); continue; }
      const was = this.still.get(s.name);
      if (!was || Math.hypot(s.pos[0] - was.pos[0], s.pos[1] - was.pos[1], s.pos[2] - was.pos[2]) > 3) { this.still.set(s.name, {pos: s.pos, since: this.now()}); continue; }
      if (this.now() - was.since < STUCK_MS) continue;
      this.still.delete(s.name);
      this.rescue(s.name, `stuck ${Math.round((this.now() - was.since) / 60000)} min at ${s.pos.join(' ')} (${s.activity.slice(0, 60)})`).catch(() => {});
    }
  }

  async rescue(bot, why) {
    const t = this.target();
    if (!NAME_RE.test(bot) || !t || this.now() - this.last.get(bot) < GAP_MS) return; // never rescued: NaN, not < GAP
    const before = this.last.get(bot);
    this.last.set(bot, this.now()); // taken before the console answers: three failures in a row are one rescue
    this.fails.delete(bot);
    // A bot on the other server is none of this console's business (bot2 and bot3 "rescued" by the sandbox, 2026-10-15).
    const [who] = await this.call(['minecraft:list']);
    if (!String(who).split(/[:,]\s*/).includes(bot)) return void (before === undefined ? this.last.delete(bot) : this.last.set(bot, before));
    // Only onto ground with room to stand: the old landing beside the supply chest has air under it on the main server.
    const [reply] = await this.call([`execute unless block ${t.x} ${t.y - 1} ${t.z} #minecraft:air if block ${t.x} ${t.y} ${t.z} #minecraft:air if block ${t.x} ${t.y + 1} ${t.z} #minecraft:air run minecraft:tp ${bot} ${t.x + 0.5} ${t.y} ${t.z + 0.5}`]);
    if (/^Teleported /.test(String(reply))) this.events.add(bot, 'info', `rescued: ${why}, teleported to the base (${this.label})`);
    else this.events.add(bot, 'info', `rescue failed (${this.label}): ${String(reply).trim().slice(0, 80) || `no room to land at ${t.x} ${t.y} ${t.z}`}`);
  }
}

module.exports = {Rescue, STRANDED, STUCK_MS};
