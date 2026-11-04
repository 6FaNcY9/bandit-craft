'use strict';
// Pure helpers for the in-game console channel (sidebar lines, bot state) and the Ingame class: the opt-in sidebar and
// the chat replies. The dialogs themselves are botui.js.
const ago = (s) => (s < 60 ? 'unter 1 min' : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min`);
const DIMENSION = {overworld: 'Oberwelt', the_nether: 'Nether', the_end: 'End'};
const failing = (s) => typeof s.lastErrorAgoS === 'number' && s.lastErrorAgoS < 300;

// The state of a bot as the Kommandostand's icons and map markers read it.
const botState = (s) => (!s.online ? 'offline' : s.dead ? 'dead' : failing(s) ? 'error' : s.sheltered ? 'sheltered' : String(s.activity || '').startsWith('idle') ? 'idle' : 'work');

function sidebarLines(snaps, {guests}) {
  const list = [...snaps.filter((s) => !guests.includes(s.name)), ...snaps.filter((s) => guests.includes(s.name))].slice(0, 15);
  return list.map((s, i) => {
    const act = String(s.activity || ''), text = act.length > 28 ? act.slice(0, 28) + '…' : act;
    const color = s.dead ? 'dark_red' : !s.online || act.startsWith('idle') ? 'gray' : typeof s.lastErrorAgoS === 'number' && s.lastErrorAgoS < 300 ? 'red' : 'white';
    return {entry: s.name, score: 15 - i, component: JSON.stringify(['', {text: s.name + ' ', color: 'aqua'}, {text, color}])};
  });
}

const PENDING_MS = 30 * 60000;
const END_WORD = {done: 'fertig', fail: 'Problem', stop: 'gestoppt'};

class Ingame {
  // call(commands[]) -> replies (RCON).
  constructor({call, viewers, guests, snapshots, log, now = Date.now, gapMs = 2000}) {
    Object.assign(this, {call, viewers, guests, snapshots, log, now, gapMs,
      lines: new Map(), pending: new Map(), waiting: new Map(), busy: false, warned: false});
  }

  async setup() {
    try {
      await this.call(['team add mcbots', 'team modify mcbots color aqua', // viewers join via the Ziele sidebar button (opt-in, owner 2026-11-03)
        'scoreboard objectives add mcbots dummy', 'scoreboard objectives modify mcbots numberformat blank',
        'scoreboard objectives setdisplay sidebar.team.aqua mcbots']);
    } catch (e) { this.log('ingame setup: ' + e.message); }
  }

  async push() {
    if (this.busy) { if (!this.warned) this.log('ingame push: previous push still in flight'); this.warned = true; return; }
    this.busy = true;
    try {
      // Every line is a console write: none while no viewer is online.
      const [list] = await this.call(['minecraft:list']);
      if (!this.viewers.some((v) => String(list).includes(v))) return;
      const cmds = [], lines = new Map();
      for (const l of sidebarLines(this.snapshots(), {guests: this.guests})) {
        lines.set(l.entry, l.component);
        if (this.lines.get(l.entry) !== l.component) cmds.push(`scoreboard players set ${l.entry} mcbots ${l.score}`, `scoreboard players display name ${l.entry} mcbots ${l.component}`);
      }
      for (const e of this.lines.keys()) if (!lines.has(e)) cmds.push(`scoreboard players reset ${e} mcbots`);
      if (!cmds.length) return;
      await this.call(cmds);
      Object.assign(this, {lines, warned: false});
    } catch (e) { this.log('ingame push: ' + e.message); } finally { this.busy = false; }
  }

  // A job the viewer ordered in the Kommandostand: its end gets the short "fertig" line.
  expect(bot, viewer) { this.pending.set(bot, {viewer, since: this.now()}); }

  // One tellraw per viewer and bot per gap: the newest text of a burst wins (an `alle` order gets one line per bot).
  say(viewer, bot, text) {
    const msg = `tellraw ${viewer} ` + JSON.stringify(['', {text: `[${bot}] `, color: 'aqua'}, {text: String(text).slice(0, 100)}]);
    const key = viewer + '\0' + bot, had = this.waiting.has(key);
    this.waiting.set(key, msg);
    if (had) return;
    setTimeout(() => {
      const m = this.waiting.get(key);
      this.waiting.delete(key);
      this.call([m]).catch((e) => this.log('ingame tellraw: ' + e.message));
    }, this.gapMs).unref();
  }

  event(e) {
    const m = e.kind === 'say' && /^(\w{1,16}): (.*)$/.exec(e.text);
    if (m) return this.viewers.includes(m[1]) ? this.say(m[1], e.bot, m[2]) : undefined;
    const p = this.pending.get(e.bot);
    if (!END_WORD[e.kind] || !p) return;
    this.pending.delete(e.bot);
    if (this.now() - p.since < PENDING_MS) this.say(p.viewer, e.bot, `${END_WORD[e.kind]}: ${e.text}`);
  }

  start() {
    this.setup();
    setInterval(() => this.push(), 5000).unref();
  }
}

module.exports = {ago, DIMENSION, failing, botState, sidebarLines, Ingame};
