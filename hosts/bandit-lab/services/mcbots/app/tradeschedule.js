'use strict';
// When a bot works a trading hall (spec 2026-10-29-misa-bots, part D). TRADE_HALLS is JSON {"misa": {hall, stores,
// sticks?}} (the arguments of the trade job, checked by its validator); TRADE_SCHEDULE is "bot23=misa@mon,wed,sat/18:00+60"
// (";" between entries): that bot trades in that hall on those days from 18:00 Vienna time for 60 minutes. The state is
// derived from the clock alone, so a restart inside a window simply starts the job again.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const RETRY_MS = 2 * 60000; // a trade job that ended early (three failed tries) is restarted after this
const VIENNA = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Vienna', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

function parseHalls(text) {
  if (!text || !text.trim()) return {};
  const {VALIDATE} = require('./bots');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('TRADE_HALLS must be JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('TRADE_HALLS must be an object of hall name to hall');
  return Object.fromEntries(Object.entries(raw).map(([name, h]) => {
    if (!/^[\w-]{1,24}$/.test(name)) throw new Error(`bad TRADE_HALLS name: ${name}`);
    if (!h?.hall) throw new Error(`TRADE_HALLS ${name} needs a hall box`);
    return [name, VALIDATE.trade(h)];
  }));
}

function parseSchedule(text) {
  const {NAME_RE} = require('./bots');
  return (text || '').split(';').map((s) => s.trim()).filter(Boolean).map((part) => {
    const m = /^(\w+)=([\w-]{1,24})@([a-z,]+)\/(\d{1,2}):(\d{2})\+(\d{1,3})$/.exec(part);
    const days = m && m[3].split(',').map((d) => DAYS.indexOf(d));
    if (!m || !NAME_RE.test(m[1]) || days.includes(-1) || +m[4] > 23 || +m[5] > 59 || +m[6] < 1 || +m[6] > 240) throw new Error(`bad TRADE_SCHEDULE entry "${part}": want bot23=hall@mon,wed/18:00+60`);
    return {bot: m[1], hall: m[2], days, start: +m[4] * 60 + +m[5], minutes: +m[6]};
  });
}

// Whether `now` (ms) lies in a window of the entry; a window may run past midnight into the next day.
function inWindow(e, now) {
  const p = Object.fromEntries(VIENNA.formatToParts(now).map((x) => [x.type, x.value]));
  const today = DAYS.indexOf(p.weekday.toLowerCase()), minute = +p.hour * 60 + +p.minute;
  return [0, 1].some((back) => e.days.includes((today - back + 7) % 7) && minute + back * 1440 >= e.start && minute + back * 1440 < e.start + e.minutes);
}

class TradeSchedule {
  constructor({runners, halls, entries, log = () => {}, now = Date.now}) {
    Object.assign(this, {runners, halls, entries, log, now});
    this.last = new Map(); // bot -> when its trade job was last given
  }

  // Called every few seconds: start the trade job of an idle bot inside its window, stop it outside.
  tick() {
    const t = this.now();
    for (const e of this.entries) {
      const args = this.halls[e.hall], r = this.runners.get(e.bot);
      if (!args || !r) continue; // an unconfigured hall: nothing runs
      const s = r.snapshot();
      if (inWindow(e, t)) {
        if (s.online && !s.dead && !s.job && !s.queue.length && t - (this.last.get(e.bot) ?? -Infinity) >= RETRY_MS) {
          this.last.set(e.bot, t);
          r.enqueue('trade', args);
          this.log('trade', `${e.bot}: ${e.hall} hall, trading`);
        }
      } else if (s.job?.type === 'trade' || s.queue.some((q) => /^trade /.test(q))) {
        r.enqueue('stop');
        this.log('trade', `${e.bot}: window over, stopped`);
      }
    }
  }
}

module.exports = {parseHalls, parseSchedule, inWindow, TradeSchedule};
