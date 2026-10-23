'use strict';
// The job board (docs/specs/2026-10-23-bots-redesign.md): an owner's job is cut into slices ("parts") that idle
// bots claim. Heartbeat, progress and outcome come from the status snapshots the hub already has; a part whose
// bot goes quiet reopens with its progress kept, so another bot takes over. Pure apart from its JSON file.
const fs = require('node:fs');
const {strip, failedSince, stoppedSince} = require('./plan');

const SLICE = 4; // a slice is at most this wide: one bot keeps one place, claims stay few
const CLAIM_MS = 45000; // a claim without a heartbeat this long goes back to open
const START_MS = 10000; // a handed-out part that never showed up as the bot's job is open again after this
const MAX_TRIES = 3;
const MAX = {x: 64, y: 32, z: 64};
const OWN_ERROR = /^(part:|died$)/; // the spike's keeper "light: no torches available" failed a dug piece

const norm = (b) => ({x1: Math.min(b.x1, b.x2), y1: Math.min(b.y1, b.y2), z1: Math.min(b.z1, b.z2), x2: Math.max(b.x1, b.x2), y2: Math.max(b.y1, b.y2), z2: Math.max(b.z1, b.z2)});
const size = (b, a) => b[`${a}2`] - b[`${a}1`] + 1;
const volume = (b) => size(b, 'x') * size(b, 'y') * size(b, 'z');

class Board {
  constructor({file = null, now = Date.now, locked = () => null} = {}) {
    Object.assign(this, {file, now, locked});
    this.data = {seq: 0, jobs: []};
    if (file && fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      // The restart stopped every bot: their parts are free again.
      for (const p of this.parts()) if (p.state === 'claimed') Object.assign(p, {state: 'open', claim: null});
    }
  }

  parts() {
    return this.data.jobs.flatMap((j) => j.parts);
  }

  save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  job(id) {
    const j = this.data.jobs.find((x) => x.id === id);
    if (!j) throw new Error(`no job ${id}`);
    return j;
  }

  create({kind, box, by = 'owner'}) {
    if (kind !== 'excavate') throw new Error(`unknown job kind ${kind}`);
    if (!box || !['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((k) => Number.isInteger(box[k]))) throw new Error('box needs whole numbers x1 y1 z1 x2 y2 z2');
    const b = norm(box);
    for (const a of ['x', 'y', 'z']) if (size(b, a) > MAX[a]) throw new Error(`box too big: ${size(b, 'x')} x ${size(b, 'y')} x ${size(b, 'z')}, at most ${MAX.x} x ${MAX.y} x ${MAX.z}`);
    const why = this.locked(b);
    if (why) throw new Error(`box touches ${why}`);
    const id = `j${++this.data.seq}`;
    const axis = size(b, 'x') >= size(b, 'z') ? 'x' : 'z';
    const n = Math.ceil(size(b, axis) / SLICE);
    const parts = Array.from({length: n}, (_, i) => {
      const pb = strip(b, axis, i, n);
      return {id: `${id}.${i + 1}`, box: pb, state: 'open', tries: 0, progress: {done: 0, total: volume(pb)}, claim: null, lastError: null};
    });
    const job = {id, kind, by, box: b, created: this.now(), state: 'running', problem: null, parts};
    this.data.jobs.push(job);
    this.save();
    return job;
  }

  // Each idle bot gets the nearest open part of the oldest running job. posOf(bot) -> {x, z} | null.
  assign(idle, posOf) {
    const out = [];
    const holding = new Set(this.parts().filter((p) => p.state === 'claimed').map((p) => p.claim.bot));
    for (const bot of idle) {
      if (holding.has(bot)) continue;
      const pos = posOf(bot);
      const dist = (p) => (pos ? Math.hypot(pos.x - (p.box.x1 + p.box.x2) / 2, pos.z - (p.box.z1 + p.box.z2) / 2) : 0);
      const job = this.data.jobs.find((j) => j.state === 'running' && j.parts.some((p) => p.state === 'open'));
      if (!job) break;
      const part = job.parts.filter((p) => p.state === 'open').sort((a, b) => dist(a) - dist(b))[0];
      Object.assign(part, {state: 'claimed', claim: {bot, since: this.now(), heartbeat: this.now(), seen: false}});
      holding.add(bot);
      out.push({bot, part});
    }
    if (out.length) this.save();
    return out;
  }

  // snaps: Map bot -> status snapshot. Returns what changed, for the hub's event log.
  observe(snaps) {
    const t = this.now(), ev = [];
    const open = (p, what, extra = {}) => {
      ev.push({what, job: p.id.split('.')[0], part: p.id, bot: p.claim.bot, ...extra});
      Object.assign(p, {state: 'open', claim: null});
    };
    for (const job of this.data.jobs) {
      for (const p of job.parts.filter((x) => x.state === 'claimed')) {
        const c = p.claim, s = snaps.get(c.bot);
        if (!s?.online) {
          if (t - c.heartbeat > CLAIM_MS) open(p, 'timeout');
          continue;
        }
        c.heartbeat = t;
        if (s.job?.type === 'part' && s.job.label?.includes(p.id)) {
          c.seen = true;
          p.progress.done = s.job.done || 0;
          continue;
        }
        if (s.job || s.queue?.length) {
          if (c.seen) open(p, 'taken', {by: s.job?.type || 'queue'}); // an owner order replaced the part
          continue;
        }
        if (failedSince(s, c.since, t) && OWN_ERROR.test(s.lastError)) {
          p.tries++;
          p.lastError = s.lastError;
          if (p.tries < MAX_TRIES) { open(p, 'retry', {error: s.lastError}); continue; }
          ev.push({what: 'failed', job: job.id, part: p.id, bot: c.bot, error: s.lastError});
          Object.assign(p, {state: 'failed', claim: null});
          job.problem = {reason: s.lastError, part: p.id, since: t};
        } else if (failedSince(s, c.since, t)) open(p, 'foreign', {error: s.lastError});
        else if (stoppedSince(s, c.since, t)) open(p, 'stopped');
        else if (c.seen) {
          ev.push({what: 'done', job: job.id, part: p.id, bot: c.bot});
          Object.assign(p, {state: 'done', claim: null, progress: {...p.progress, done: p.progress.total}});
        } else if (t - c.since >= START_MS) open(p, 'not started');
      }
      if (job.state === 'running' && !job.parts.some((p) => p.state === 'open' || p.state === 'claimed')) {
        job.state = job.parts.every((p) => p.state === 'done') ? 'done' : 'failed';
        ev.push({what: job.state, job: job.id});
      }
    }
    if (ev.length) this.save();
    return ev;
  }

  // Pause and cancel free the job's parts and return the bots that held them, for the caller to stop.
  release(job, state) {
    const bots = job.parts.filter((p) => p.state === 'claimed').map((p) => p.claim.bot);
    for (const p of job.parts) if (p.state === 'claimed') Object.assign(p, {state: 'open', claim: null});
    job.state = state;
    this.save();
    return bots;
  }

  pause(id) {
    return this.release(this.job(id), 'paused');
  }

  resume(id) {
    const job = this.job(id);
    if (job.state === 'paused') job.state = 'running';
    this.save();
    return job;
  }

  cancel(id) {
    return this.release(this.job(id), 'cancelled');
  }

  pauseAll() {
    return this.data.jobs.filter((j) => j.state === 'running').flatMap((j) => this.release(j, 'paused'));
  }

  state() {
    return {jobs: this.data.jobs};
  }
}

module.exports = {Board, SLICE, CLAIM_MS, START_MS, MAX_TRIES};
