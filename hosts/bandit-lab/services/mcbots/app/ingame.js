'use strict';
// Pure helpers for the in-game console channel: sidebar lines (one per bot), the values of the /bots panel and the
// order inbox parser. The Ingame class that pushes them to the Minecraft console builds on these.
// A panel value is one console word (pa data keeps only the first): NBSP for spaces, and nothing the panel would read as
// a colour, a tag or a placeholder. Empty is a blank lore line.
const word = (text, max = 56) => String(text ?? '').replace(/§./g, '').replace(/[&%<>\u0000-\u001f]/g, ' ').trim().replace(/\s+/g, '\u00a0').slice(0, max) || '\u00a0';
const ago = (s) => (s < 60 ? 'unter 1 min' : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min`);
const DIMENSION = {overworld: 'Oberwelt', the_nether: 'Nether', the_end: 'End'};
const failing = (s) => typeof s.lastErrorAgoS === 'number' && s.lastErrorAgoS < 300;

// Which icon the panel shows (minecraft/bots-panel.nix).
const botState = (s) => (!s.online ? 'offline' : s.dead ? 'dead' : failing(s) ? 'error' : s.sheltered ? 'sheltered' : String(s.activity || '').startsWith('idle') ? 'idle' : 'work');

function botFields(s) {
  const tool = s.tool ? ` · ${s.tool.name}${s.tool.max ? ` ${s.tool.left}/${s.tool.max}` : ''}` : '';
  return {
    state: botState(s),
    role: s.role || 'keine',
    job: s.job ? s.job.label.trim() + (s.job.progress ? `: ${s.job.progress}` : '') : 'frei',
    doing: (typeof s.job?.runningS === 'number' ? `seit ${ago(s.job.runningS)} · ` : '') + (s.activity || ''),
    error: failing(s) && s.lastError ? `Fehler vor ${ago(s.lastErrorAgoS)}: ${s.lastError}` : '',
    vitals: s.online ? `Leben ${Math.round(s.health)} · Essen ${s.food} · frei ${s.freeSlots}${tool}` : '',
    where: s.pos ? `${s.pos.join(' ')} ${DIMENSION[s.dimension] || s.dimension || ''}` : 'unbekannt',
  };
}

// The top row of /bots. Guests play on the main server, so one of them tells the time of the world the viewer is in.
function summary(snaps, {guests, quotas}) {
  const states = snaps.map(botState), online = snaps.filter((s) => s.online);
  const bad = snaps.filter((_, i) => states[i] === 'error' || states[i] === 'dead');
  const short = quotas.find((q) => q.have !== null && q.have < q.want);
  const clock = online.find((s) => guests.includes(s.name)) || online[0];
  return {
    sum_bots: `${online.length}/${snaps.length} online · ${states.filter((x) => x === 'work').length} arbeiten`,
    sum_problems: bad.length ? `${bad.length}: ${bad.map((s) => s.name).join(', ')}` : 'keine',
    sum_need: short ? `${short.item} ${short.have}/${short.want}` : 'alles da',
    sum_day: clock ? (clock.isDay ? 'Tag' : 'Nacht') : 'unbekannt',
  };
}

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
  // call(commands[]) -> replies (RCON); order(viewer, bot, words) -> receipt text, throws on refusal; quotas() -> the keeper's.
  constructor({call, viewers, guests, snapshots, order, log, quotas = () => [], now = Date.now, gapMs = 2000}) {
    Object.assign(this, {call, viewers, guests, snapshots, order, log, quotas, now, gapMs,
      lines: new Map(), values: new Map(), pending: new Map(), waiting: new Map(), busy: false, warned: false});
  }

  async setup() {
    try {
      await this.call(['team add mcbots', 'team modify mcbots color aqua', // viewers join via the /bots sidebar button (opt-in, owner 2026-11-03)
        'scoreboard objectives add mcbots dummy', 'scoreboard objectives modify mcbots numberformat blank',
        'scoreboard objectives setdisplay sidebar.team.aqua mcbots', 'pa data clear mcbots']);
    } catch (e) { this.log('ingame setup: ' + e.message); }
  }

  async push() {
    if (this.busy) { if (!this.warned) this.log('ingame push: previous push still in flight'); this.warned = true; return; }
    this.busy = true;
    try {
      // Every value is a write to the panel plugin's data file: none while no viewer is online.
      const [list] = await this.call(['minecraft:list']);
      if (!this.viewers.some((v) => String(list).includes(v))) return;
      const snaps = this.snapshots(), cmds = [], lines = new Map(), values = new Map();
      for (const l of sidebarLines(snaps, {guests: this.guests, now: this.now()})) {
        lines.set(l.entry, l.component);
        if (this.lines.get(l.entry) !== l.component) cmds.push(`scoreboard players set ${l.entry} mcbots ${l.score}`, `scoreboard players display name ${l.entry} mcbots ${l.component}`);
      }
      for (const e of this.lines.keys()) if (!lines.has(e)) cmds.push(`scoreboard players reset ${e} mcbots`);
      const set = (key, value) => {
        const w = word(value);
        values.set(key, w);
        if (this.values.get(key) !== w) cmds.push(`pa data del mcbots ${key}`, `pa data set mcbots ${key} ${w}`);
      };
      for (const s of snaps) for (const [field, value] of Object.entries(botFields(s))) set(`${s.name}_${field}`, value);
      for (const [key, value] of Object.entries(summary(snaps, {guests: this.guests, quotas: this.quotas()}))) set(key, value);
      if (!cmds.length) return;
      await this.call(cmds);
      Object.assign(this, {lines, values, warned: false});
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

module.exports = {word, ago, DIMENSION, failing, botState, botFields, summary, sidebarLines, parseInbox, Ingame};
