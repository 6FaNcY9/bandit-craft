'use strict';
// Pure helpers for the in-game console channel: sidebar lines (one per bot), panel tokens and the order inbox
// parser. The Ingame class that pushes them to the Minecraft console builds on these.
const token = (text) => String(text).trim().replace(/§./g, '').replace(/[^A-Za-z0-9./:+-]+/g, '_').slice(0, 32) || '-';
const statusToken = (snap) => token(snap.activity || (snap.online ? 'frei' : 'offline'));

function sidebarLines(snaps, {guests}) {
  const list = [...snaps.filter((s) => !guests.includes(s.name)), ...snaps.filter((s) => guests.includes(s.name))].slice(0, 15);
  return list.map((s, i) => {
    const act = String(s.activity || ''), text = act.length > 28 ? act.slice(0, 28) + '…' : act;
    const color = s.dead ? 'dark_red' : !s.online || act.startsWith('idle') ? 'gray' : typeof s.lastErrorAgoS === 'number' && s.lastErrorAgoS < 300 ? 'red' : 'white';
    return {entry: s.name, score: 15 - i, component: JSON.stringify(['', {text: s.name + ' ', color: 'aqua'}, {text, color}])};
  });
}

function parseInbox(value) {
  const m = /^(\w{1,16}):([\w.\/-]{1,64})$/.exec(value || '');
  const words = m && m[2].split('_').filter(Boolean);
  return words && words.length ? {bot: m[1], words} : null;
}

const PENDING_MS = 30 * 60000;
const END_WORD = {done: 'fertig', fail: 'Problem', stop: 'gestoppt'};

class Ingame {
  // call(commands[]) -> replies (RCON); order(viewer, bot, words) -> receipt text, throws on refusal.
  constructor({call, viewers, guests, snapshots, order, log, now = Date.now, gapMs = 2000}) {
    Object.assign(this, {call, viewers, guests, snapshots, order, log, now, gapMs,
      lines: new Map(), tokens: new Map(), pending: new Map(), waiting: new Map(), busy: false, warned: false});
  }

  async setup() {
    try {
      await this.call(['team add mcbots', 'team modify mcbots color aqua', ...this.viewers.map((v) => `team join mcbots ${v}`),
        'scoreboard objectives add mcbots dummy', 'scoreboard objectives modify mcbots numberformat blank',
        'scoreboard objectives setdisplay sidebar.team.aqua mcbots', 'pa data clear mcbots']);
    } catch (e) { this.log('ingame setup: ' + e.message); }
  }

  async push() {
    if (this.busy) { if (!this.warned) this.log('ingame push: previous push still in flight'); this.warned = true; return; }
    this.busy = true;
    try {
      const snaps = this.snapshots(), cmds = [], lines = new Map(), tokens = new Map();
      for (const l of sidebarLines(snaps, {guests: this.guests, now: this.now()})) {
        lines.set(l.entry, l.component);
        if (this.lines.get(l.entry) !== l.component) cmds.push(`scoreboard players set ${l.entry} mcbots ${l.score}`, `scoreboard players display name ${l.entry} mcbots ${l.component}`);
      }
      for (const e of this.lines.keys()) if (!lines.has(e)) cmds.push(`scoreboard players reset ${e} mcbots`);
      for (const s of snaps) {
        const t = statusToken(s);
        tokens.set(s.name, t);
        if (this.tokens.get(s.name) !== t) cmds.push(`pa data del mcbots ${s.name}`, `pa data set mcbots ${s.name} ${t}`);
      }
      if (!cmds.length) return;
      await this.call(cmds);
      Object.assign(this, {lines, tokens, warned: false});
    } catch (e) { this.log('ingame push: ' + e.message); } finally { this.busy = false; }
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const replies = await this.call(this.viewers.map((v) => `pa data get ${v} order`));
      for (const [i, v] of this.viewers.entries()) {
        const value = /Value: (\S+)/.exec(replies[i] || '')?.[1];
        if (!value || value === 'null') continue;
        await this.call([`pa data del ${v} order`]);
        const o = parseInbox(value);
        if (!o) { this.say(v, 'bots', 'kenne ich nicht: ' + value); continue; }
        try {
          this.say(v, o.bot, this.order(v, o.bot, o.words));
          this.pending.set(o.bot, {viewer: v, since: this.now()});
        } catch (e) { this.say(v, o.bot, 'geht nicht: ' + e.message); }
      }
    } catch (e) { this.log('ingame poll: ' + e.message); } finally { this.polling = false; }
  }

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
    if (e.kind === 'death') return this.viewers.forEach((v) => this.say(v, e.bot, 'gestorben: ' + e.text));
    const p = this.pending.get(e.bot);
    if (!END_WORD[e.kind] || !p) return;
    this.pending.delete(e.bot);
    if (this.now() - p.since < PENDING_MS) this.say(p.viewer, e.bot, `${END_WORD[e.kind]}: ${e.text}`);
  }

  start() {
    this.setup();
    setInterval(() => this.push(), 5000).unref();
    setInterval(() => this.poll(), 2000).unref();
  }
}

module.exports = {token, sidebarLines, parseInbox, statusToken, Ingame};
