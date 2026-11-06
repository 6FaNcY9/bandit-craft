'use strict';
// What a bot's owner hears in chat about their servant (dies, sticks, lacks material, long job done) and the digest
// when they join. Base alerts for the owner's phone are alerts.js; this is the in-game side.
const {germanReason} = require('./owner');
const RATE_MS = 600000;
const MAX_LINES = 6;

function classify(e) {
  if (e.kind === 'death') return 'dead';
  if (e.kind === 'fail' && /no way to get|no free \S+ within .*(far search heading \w+|no walkable heading)$/.test(e.text)) return 'missing';
  if (e.kind === 'fail' && /no progress for|No path/.test(e.text)) return 'stuck';
  const took = e.kind === 'done' && /(\d+) s\)/.exec(e.text);
  return took && Number(took[1]) >= 600 ? 'done' : null;
}

const at = (p) => (Array.isArray(p) ? ` bei ${p.slice(0, 3).map(Math.round).join(' ')}` : '');

function text(kind, e, snap) {
  const t = {
    dead: () => `tot${/ at (-?\d+ -?\d+ -?\d+)/.test(e.text) ? ' bei ' + / at (-?\d+ -?\d+ -?\d+)/.exec(e.text)[1] : at(snap?.pos)}`,
    stuck: () => `steckt fest${at(snap?.pos)}: kein Weg`,
    missing: () => `fehlt: ${/no way to get/.test(e.text) ? e.text.replace(/^.*no way to get /, '') : germanReason(e.text.replace(/^.* - (?=no free )/, ''))}`, // fail events read 'gave up: <job> - <why>'
    done: () => `fertig: ${e.text.replace(/^finished: /, '').replace(/ \(\d+ s\)$/, '')}`,
  }[kind]();
  return t.slice(0, 100);
}

const ownersOf = (bot, viewerBots) => Object.keys(viewerBots).filter((v) => viewerBots[v] === '*' || viewerBots[v].includes(bot));

class OwnAlerts {
  constructor({say, viewerBots, now = Date.now}) { Object.assign(this, {say, viewerBots, now, last: new Map()}); }

  event(e, snap) {
    const kind = classify(e);
    if (!kind) return;
    for (const v of ownersOf(e.bot, this.viewerBots)) {
      const key = `${v}|${e.bot}|${kind}`, t = this.now();
      if (t - (this.last.get(key) ?? -Infinity) < RATE_MS) continue;
      this.last.set(key, t);
      this.say(v, e.bot, text(kind, e, snap));
    }
  }
}

// events: the hub's event log; bots: the viewer's bots. Newest first, header included in the line cap.
function digest(events, bots, since, now) {
  if (since == null) return [];
  const lines = [];
  for (const e of [...events].reverse()) {
    const kind = e.t > since && e.t <= now && bots.includes(e.bot) && classify(e);
    if (kind && lines.length < MAX_LINES - 1) lines.push(`${e.bot}: ${text(kind, e)}`.slice(0, 100));
  }
  return lines.length ? ['Seit du weg warst:', ...lines] : [];
}

module.exports = {classify, text, ownersOf, OwnAlerts, digest};
