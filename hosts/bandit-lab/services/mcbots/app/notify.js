'use strict';

const TEN_MIN = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const WORKER_LOSS = 5 * 60 * 1000;

const FULL_BELOW = 4; // free slots in the supply chest
const FOOD = /^(bread|apple|golden_apple|golden_carrot|carrot|baked_potato|cooked_\w+|melon_slice|sweet_berries|pumpkin_pie|cookie|beetroot_soup|mushroom_stew|rabbit_stew|dried_kelp)$/;

// What the supply chest lacks (items: {name: count} as last counted, free: free slots or null when unknown).
function chestWarnings(items, free) {
  const has = (re) => Object.keys(items).some((n) => re.test(n));
  const w = [];
  if (free != null && free < FULL_BELOW) w.push(`full (${free} free slots)`);
  if (!has(FOOD)) w.push('no food');
  if (!has(/^(torch|coal|charcoal)$/)) w.push('no torches or coal');
  if (!has(/_pickaxe$/)) w.push('no pickaxes');
  if (!has(/_sapling$/)) w.push('no saplings');
  return w;
}

class NtfyNotifier {
  constructor({url = process.env.NTFY_URL, topic = process.env.NTFY_TOPIC || 'mcbots', token = process.env.NTFY_TOKEN, now = Date.now, fetcher = globalThis.fetch} = {}) {
    this.now = now;
    this.fetcher = fetcher;
    let base = null;
    try {
      const parsed = new URL(String(url));
      // http only for the ntfy gateway on the mcbots Docker subnet 10.250.77.0/29 (Codex R7-3); https anywhere
      const gateway = /^10\.250\.77\.[0-7]$/.test(parsed.hostname);
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && gateway)) base = String(url).replace(/\/$/, '');
    } catch {}
    this.url = base && token ? `${base}/${encodeURIComponent(topic)}` : null;
    this.token = token;
    this.sent = new Map();
    this.hour = [];
    this.failures = new Map();
    this.workers = new Map();
  }

  send(bot, kind, message, priority = 'default') {
    if (!this.url || typeof this.fetcher !== 'function') return false;
    const now = this.now();
    this.hour = this.hour.filter((t) => now - t < HOUR);
    const key = `${bot}:${kind}`;
    if (this.sent.get(key) > now - TEN_MIN || this.hour.length >= 30) return false;
    this.sent.set(key, now);
    this.hour.push(now);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    timer.unref?.();
    const body = String(message).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    try {
      Promise.resolve(this.fetcher(this.url, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${this.token}`, 'Content-Type': 'text/plain', 'Priority': priority},
        body,
        signal: controller.signal,
      })).then((response) => response.body?.cancel()).catch(() => {}).finally(() => clearTimeout(timer));
    } catch { clearTimeout(timer); }
    return true;
  }

  event(e) {
    const {bot, kind, text} = e;
    if (kind === 'death') return this.send(bot, 'death', `${bot} ${text}${text.includes(':') ? '' : ': cause unknown'}`, 'high');
    if (kind === 'alert' && /^solver:/.test(text)) return this.send(bot, 'solver', text, 'high'); // the problem solver gave up on an incident (tools/mcagents/solver.js)
    if (kind === 'alert' && /^highway:/.test(text)) return this.send(bot, 'highway', text, 'high'); // a road stopped and waits for the owner
    if (kind === 'fail') {
      const previous = this.failures.get(bot);
      const reason = text.replace(/-?\d+/g, '#');
      const count = (previous?.count || 0) + 1;
      const same = previous?.reason === reason ? previous.same + 1 : 1;
      this.failures.set(bot, {count, same, reason});
      if (count >= 3 || same >= 2 || /^gave up:/.test(text)) {
        this.send(bot, 'stuck', `${bot} is stuck after repeated failures: ${text}`);
      }
      return;
    }
    if (kind === 'done' || kind === 'stop') this.failures.delete(bot);
    if (kind === 'done' && /finished: (shaft|level|treefarm|excavate)\b/i.test(text)) {
      return this.send(bot, 'done', `${bot} finished ${text.replace(/^finished:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '')}`);
    }
    if (kind === 'hub' && /worker .* disconnected/i.test(text)) {
      const key = `${bot}:worker`;
      if (!this.workers.has(key)) this.workers.set(key, this.now());
    } else if (kind === 'hub' && /worker .* connected/i.test(text)) {
      this.workers.delete(`${bot}:worker`);
    }
  }

  chest(stock, warnings) {
    if (!stock) return;
    const active = new Set((warnings || []).filter((w) => /^(full|no food|no torches or coal|no pickaxes)/.test(w)));
    const keys = {'full': 'supply-full', 'no food': 'supply-food', 'no torches or coal': 'supply-torches', 'no pickaxes': 'supply-pickaxes'};
    const current = new Set();
    for (const warning of active) {
      const kind = keys[warning.replace(/\s*\(.*/, '')];
      current.add(kind);
      if (!this.chestState?.has(kind)) this.send('base', kind, `Supply chest: ${warning}`);
    }
    this.chestState = current;
  }

  tick() {
    const now = this.now();
    for (const [key, since] of this.workers) if (now - since >= WORKER_LOSS) {
      this.workers.delete(key);
      this.send(key.replace(/:worker$/, ''), 'worker-loss', `${key.replace(/:worker$/, '')} worker disconnected for over 5 minutes`, 'high');
    }
  }
}

module.exports = {NtfyNotifier, chestWarnings, TEN_MIN, HOUR, WORKER_LOSS};
