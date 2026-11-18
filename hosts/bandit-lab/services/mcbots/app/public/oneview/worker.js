'use strict';
// The page's one worker: loads sections and changes, keeps the bounded cache, meshes and follows plans; the page only draws.
// Declares no top-level name: worldsection.js leaks several into this scope.
(function () {
  importScripts('/oneview/worldsection.js', '/oneview/blocks.js', '/oneview/mesher.js', '/oneview/worldcache.js', '/oneview/planview.js');
  const OV = self.OV;
  const PLAN_EVERY = 5000, RETRY = 2100; // RETRY is a little over the cache's 2 s first back-off, so its wait is over when we pump
  let cache = null, cut = 319, worldSeq = 0, paused = false, netOk = true, looseOn = true, want = null; // want: the probe that waits for its column
  let changing = false, blocked = false, changeFails = 0, epoch = 0, retry = 0, unblock = 0, tick = 0;
  const plans = new Map(); // key -> {bot, at, every, seq, busy, reply, sent, cut}: at/seq of the last fetch, every its wait, sent/cut of the last message
  const states = new Map(); // 'cx,cz' -> the chunk state last posted: the probe needs it and the cache keeps it to itself
  const looseKeys = new Set(); // 'cx,sy,cz' of the sections whose last mesh had loose dirt: the loose switch re-meshes only these

  const post = (msg, transfer = []) => self.postMessage(msg, transfer);
  const drop = ([cx, cz]) => {
    states.delete(cx + ',' + cz);
    for (let sy = OV.section.SY_MIN; sy <= OV.section.SY_MAX; sy++) looseKeys.delete(cx + ',' + sy + ',' + cz);
    post({t: 'chunk', cx, cz, state: -1});
  };
  const setNet = (ok) => { if (ok !== netOk) { netOk = ok; post({t: 'net', ok}); } };
  // a stalled request must fail into the retry paths; the hub answers within 35 s; no AbortSignal.timeout (Safari < 16) means no timeout
  const sig = () => ({signal: self.AbortSignal?.timeout?.(40000)});

  function mesh(cx, sy, cz) {
    const sec = cache.section(cx, sy, cz);
    if (!sec) return;
    const nb = cache.neighbours(cx, sy, cz);
    // the cut layer gets a lid, dark where the real block above it is drawn (lid only matters when the cut is this section's top layer)
    const m = OV.mesher.meshSection(sec, nb, Math.max(0, Math.min(16, cut + 1 - sy * 16)), {lid: cut < (sy + 1) * 16, loose: looseOn});
    const key = cx + ',' + sy + ',' + cz;
    if (m?.loose) looseKeys.add(key); else looseKeys.delete(key);
    if (!m) return post({t: 'mesh', cx, sy, cz, pos: null, col: null, idx: null, loose: 0});
    post({t: 'mesh', cx, sy, cz, pos: m.pos, col: m.col, idx: m.idx, loose: m.loose}, [m.pos.buffer, m.col.buffer, m.idx.buffer]);
  }

  function apply(out) {
    const gone = cache.evict(); // before meshing: the late reply of a tile the view left then makes no mesh
    for (const [cx, cz, state] of out.chunks) { states.set(cx + ',' + cz, state); post({t: 'chunk', cx, cz, state}); }
    for (const [cx, sy, cz] of out.mesh) mesh(cx, sy, cz);
    gone.forEach(drop);
  }

  async function load(q) {
    let records = null;
    try {
      const res = await fetch(`/api/world/sections?cx=${q.cx}&cz=${q.cz}&r=${q.r}`, sig());
      if (res.status === 200) {
        records = OV.section.decodeBatch(new Uint8Array(await res.arrayBuffer())).records;
        for (const r of records) if (r.kind === 0) r.sec = OV.section.decodeSection(r.blob);
      }
    } catch (e) { records = null; }
    if (records) { setNet(true); apply(cache.done(q.id, records)); } else { cache.fail(q.id); setNet(false); }
    pump();
  }

  async function pull() {
    changing = true;
    const e = epoch, seen = worldSeq;
    let reply = null;
    try {
      const res = await fetch('/api/world/changes?since=' + cache.seq(), sig());
      if (res.status === 200) { reply = await res.json(); if (!Array.isArray(reply.sections)) reply = null; }
    } catch (err) { reply = null; }
    changing = false;
    // a reply that lands after a reset belongs to the old world: dropped
    if (e === epoch) { if (reply) { changeFails = 0; cache.changes(reply, seen); } else { changeFails++; blocked = true; } }
    pump();
  }

  function show(key, p) {
    const g = OV.planview.planGroups(p.reply, cut);
    post({t: 'plan', key, file: p.reply.file, counts: g.counts, percent: g.percent, box: g.box, groups: g.groups}, g.groups.map((x) => x.xyz.buffer));
  }

  async function follow(key, p) {
    p.busy = true; p.seq = worldSeq; p.at = Date.now();
    let status = 0, reply = null;
    try {
      const res = await fetch('/api/plan/status?bot=' + encodeURIComponent(p.bot), sig());
      status = res.status;
      if (status === 200) { reply = await res.json(); if (!Array.isArray(reply.blocks)) status = 0; }
    } catch (e) { status = 0; }
    p.busy = false;
    if (plans.get(key) !== p) return; // the key left the list meanwhile
    if (status !== 200 && status !== 404 && status !== 413) { p.seq = null; return; } // retried on the next round
    const sent = status === 404 ? 'gone' : status === 413 ? 'big' : reply.blocks.map((b) => b[4]).join('');
    p.reply = status === 200 ? reply : null;
    p.every = sent === p.sent ? Math.min(30000, p.every * 2) : PLAN_EVERY; // a full reply each time: ask a plan that stands still less often
    if (sent === p.sent && p.cut === cut) return;
    p.sent = sent; p.cut = cut;
    if (p.reply) show(key, p); else post({t: 'plan', key, state: sent});
  }

  // Rock above a bot, from the cache only: drawn cells other than leaves 2..9 blocks above its feet, once its column is loaded.
  function probe() {
    const {x, y, z} = want, bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), state = states.get((bx >> 4) + ',' + (bz >> 4));
    if (state === undefined) return;
    let roof = 0;
    for (let v = by + 2; state === 0 && v <= by + 9; v++) { // an unknown or ungenerated chunk has no roof; a missing section is air
      const s = cache.section(bx >> 4, v >> 4, bz >> 4);
      const name = s && OV.blocks.nameOf(s.palette[s.idx ? s.idx[OV.section.cellIndex(bx & 15, v & 15, bz & 15)] : 0]);
      if (name && OV.blocks.drawn(name) && !name.endsWith('leaves')) roof++;
    }
    want = null;
    post({t: 'probe', x, y, z, roof});
  }

  function pump() {
    if (cache) {
      cache.evict().forEach(drop);
      if (want) probe();
      if (!paused) {
        if (!changing && !blocked && worldSeq > cache.seq()) pull();
        for (let q; (q = cache.next());) load(q);
      }
      if (!netOk && !retry) retry = setTimeout(() => { retry = 0; pump(); }, RETRY);
      // a failing changes call waits 2 s, 4 s ... 30 s like the cache's requests
      if (blocked && !unblock) unblock = setTimeout(() => { unblock = 0; blocked = false; pump(); }, Math.min(30000, 1000 * 2 ** changeFails));
    }
    if (!paused) for (const [key, p] of plans) if (!p.busy && p.seq !== worldSeq && Date.now() - p.at >= p.every) follow(key, p);
    if (plans.size && !tick) tick = setTimeout(() => { tick = 0; pump(); }, PLAN_EVERY);
  }

  self.onmessage = ({data: m}) => {
    if (m.t === 'view') {
      if (!cache) { cache = OV.worldcache.makeCache({viewR: m.viewR}); cache.onSeq(worldSeq); }
      cache.setView(m.cx, m.cz);
    } else if (m.t === 'seq') {
      worldSeq = m.seq;
      if (cache && cache.onSeq(m.seq) === 'reset') { epoch++; changeFails = 0; states.clear(); looseKeys.clear(); post({t: 'reset'}); } // 'changes' is picked up by pump()
    } else if (m.t === 'cut') {
      const old = cut;
      cut = m.y;
      if (cache && cut !== old) for (const [cx, sy, cz] of cache.loaded()) if (sy >= Math.min(old, cut) >> 4) mesh(cx, sy, cz);
      post({t: 'cut', y: cut}); // the page moves its camera on this ack, so the new meshes are already there
      for (const [key, p] of plans) { p.cut = cut; p.every = PLAN_EVERY; if (p.reply) show(key, p); }
    } else if (m.t === 'plans') {
      const keep = new Set(m.list.map((x) => x.key));
      for (const key of plans.keys()) if (!keep.has(key)) { plans.delete(key); post({t: 'plan', key, state: 'gone'}); }
      for (const {key, bot} of m.list) {
        const p = plans.get(key);
        if (p) { p.bot = bot; p.every = PLAN_EVERY; } else plans.set(key, {bot, at: -Infinity, every: PLAN_EVERY, seq: null, busy: false, reply: null, sent: null, cut});
      }
    } else if (m.t === 'loose') {
      looseOn = m.on;
      for (const k of [...looseKeys]) mesh(...k.split(',').map(Number));
    } else if (m.t === 'probe') want = m;
    else if (m.t === 'pause') paused = m.on;
    pump();
  };
})();
