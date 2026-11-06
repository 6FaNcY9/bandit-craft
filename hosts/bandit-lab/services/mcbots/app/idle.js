'use strict';
// "Wenn frei": the order a servant takes by itself once it has had nothing to do for a minute (owner 2026-11-06).
// The choice is stored per bot in STATE_DIR/idle.json; the hub's minute sweep (server.js) starts it.
const fs = require('node:fs');
const path = require('node:path');

const IDLE_MS = 60000;
// key: the botui-jobs entry that builds the args; data: what the hub fills in (chest 'own' = the bot's chest, zone 'first', where 'mark').
const CHOICES = [
  {id: 'holz', label: 'Holz-Schicht in meine Kiste', key: 'shiftlogs', data: {chest: 'own'}},
  {id: 'stein', label: 'Stein-Schicht', key: 'shift', data: {block: 'stone', chest: 'own'}},
  {id: 'wache', label: 'Bewachen hier', key: 'guard', data: {where: 'mark', radius: 16}},
  {id: 'baumfarm', label: 'Baumfarm', key: 'treefarm', data: {zone: 'first'}},
  {id: 'keeper', label: 'Daueraufträge', key: null, data: {}}, // owner's bots only; no job, the keeper takes them
];
const choiceOf = (id) => CHOICES.find((c) => c.id === id) || null;
const isPos = (m) => m && ['x', 'y', 'z'].every((k) => Number.isInteger(m[k]));

class IdleStore {
  constructor(file) {
    this.file = file || null;
    try { this.all = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.all = {}; }
    if (!this.all || typeof this.all !== 'object' || Array.isArray(this.all)) this.all = {};
  }
  get(bot) {
    const e = this.all[bot];
    if (!e || !choiceOf(e.id)) return null;
    return {id: e.id, ...(isPos(e.mark) ? {mark: {x: e.mark.x, y: e.mark.y, z: e.mark.z}} : {})};
  }
  set(bot, id, mark) {
    if (id === null) delete this.all[bot];
    else if (!choiceOf(id)) throw new Error('unknown idle choice');
    else this.all[bot] = {id, ...(isPos(mark) ? {mark: {x: mark.x, y: mark.y, z: mark.z}} : {})};
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.all), {mode: 0o600});
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}

const NO_CHEST = 'no chest';
// choice -> the values its botui-jobs entry needs; throws a short refusal when a spot is missing.
// ctx: chest (the bot's own pref), guest, supplyChest, treefarmZone (a box), mark.
function resolveIdle(choice, {chest, guest, supplyChest, treefarmZone, mark}) {
  const d = choice.data, v = {...d}, pt = (p) => ({x: p.x, y: p.y, z: p.z});
  if (d.chest === 'own') {
    v.chest = chest || (guest ? null : supplyChest);
    if (!v.chest) throw new Error(NO_CHEST);
    v.chest = pt(v.chest);
  }
  if (d.zone === 'first') {
    if (!treefarmZone) throw new Error('keine Baumfarm-Zone');
    v.zone = treefarmZone;
  }
  if (d.where === 'mark') {
    if (!mark) throw new Error('keine Wache-Position');
    v.at = pt(mark);
  }
  return v;
}

const isIdle = (s) => !!s?.online && s.connected !== false && !s.job && !(s.queue || []).length;
// idleSince: bot -> first time the sweep saw it idle; cleared as soon as it has a job.
function trackIdle(snaps, idleSince, now = Date.now()) {
  for (const [bot, s] of snaps) isIdle(s) ? idleSince.has(bot) || idleSince.set(bot, now) : idleSince.delete(bot);
}
// -> [{bot, choice}] to start now. snaps: Map bot -> snapshot; busy: Set of bots with other work; retryAt: Map bot -> ms.
function idleToStart({snaps, store, busy, retryAt, idleSince, now = Date.now()}) {
  const out = [];
  for (const [bot, s] of snaps) {
    const e = store.get(bot), choice = e && choiceOf(e.id);
    if (!choice?.key || !isIdle(s) || busy.has(bot) || (retryAt.get(bot) || 0) > now) continue;
    if (!idleSince.has(bot) || now - idleSince.get(bot) < IDLE_MS) continue;
    out.push({bot, choice: {...choice, ...(e.mark ? {mark: e.mark} : {})}});
  }
  return out;
}
module.exports = {CHOICES, choiceOf, IdleStore, idleToStart, trackIdle, resolveIdle, NO_CHEST, IDLE_MS};
