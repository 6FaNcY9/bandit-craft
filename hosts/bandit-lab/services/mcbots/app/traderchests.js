'use strict';
// Trader chests set in game (Kommandostand): per bot a list of stick chests and store (emerald) chests that replace the
// ones in TRADE_HALLS. `halls` is cfg.tradeHalls itself; runners, TradeSchedule and the hub hold that very object, so apply()
// edits it in place and calls onChange (the hub re-sends it to the workers).
const fs = require('node:fs');
const KINDS = {sticks: 128, stores: 8}; // the limits of VALIDATE.trade
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const point = (p) => {
  if (![p?.x, p?.y, p?.z].every((n) => Number.isInteger(n) && Math.abs(n) < 3e7)) throw new Error('bad chest position');
  return {x: p.x, y: p.y, z: p.z};
};
const kindOf = (kind) => { if (!Object.hasOwn(KINDS, kind)) throw new Error('kind must be sticks or stores'); return kind; };

class TraderChests {
  constructor({file, halls, log = () => {}, onChange = () => {}}) {
    Object.assign(this, {file, halls, log, onChange});
    this.base = JSON.parse(JSON.stringify(halls)); // as configured; apply() always starts from it
    this.own = {}; // bot key -> {sticks, stores}
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [key, o] of Object.entries(raw)) for (const kind of Object.keys(KINDS)) for (const p of o[kind] || []) this.put(key, kind, p);
    } catch (e) {
      if (e.code !== 'ENOENT') { this.log(`trader chests: ${file} unreadable, starting empty: ${e.message}`); this.own = {}; }
    }
    this.apply();
  }

  // The hall key of a bot, as bots.js picks it for a trade order.
  key(bot) { return String(bot).toLowerCase(); }

  list(bot) { const o = this.own[this.key(bot)]; return {sticks: [...(o?.sticks || [])], stores: [...(o?.stores || [])]}; }

  put(key, kind, xyz) {
    const p = point(xyz), list = ((this.own[key] ||= {sticks: [], stores: []})[kindOf(kind)]);
    if (list.some((q) => same(p, q))) return false;
    if (list.length >= KINDS[kind]) throw new Error(`at most ${KINDS[kind]} ${kind} chests`);
    list.push(p);
    return true;
  }

  save() {
    if (!this.file) return;
    try { fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.own)); fs.renameSync(`${this.file}.tmp`, this.file); } catch (e) { this.log(`trader chests: not saved: ${e.message}`); }
  }

  add(bot, kind, xyz) {
    if (this.put(this.key(bot), kind, xyz)) { this.save(); this.apply(); }
  }

  remove(bot, kind, xyz) {
    const key = this.key(bot), p = point(xyz), o = this.own[key];
    if (!o?.[kindOf(kind)].some((q) => same(p, q))) return;
    o[kind] = o[kind].filter((q) => !same(p, q));
    if (!o.sticks.length && !o.stores.length) delete this.own[key];
    this.save();
    this.apply();
  }

  // Rebuild all halls: the configured ones, then the bots' own chests on top.
  apply() {
    for (const key of Object.keys(this.halls)) delete this.halls[key];
    for (const [key, hall] of Object.entries(this.base)) this.halls[key] = JSON.parse(JSON.stringify(hall));
    for (const [key, o] of Object.entries(this.own)) {
      const hall = JSON.parse(JSON.stringify(this.base[key] || this.base.misa || {}));
      if (o.sticks.length) hall.sticks = o.sticks;
      if (o.stores.length) {
        if (hall.hall) hall.stores = o.stores;
        else Object.assign(hall, o.stores[0]); // the built-in hall takes its emerald chest as x y z (VALIDATE.trade drops `stores` without a hall box)
      }
      this.halls[key] = hall;
    }
    this.onChange();
  }
}

module.exports = {TraderChests};
