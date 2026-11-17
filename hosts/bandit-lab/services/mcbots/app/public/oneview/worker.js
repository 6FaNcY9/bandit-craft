'use strict';
// The page's one worker: loads sections and changes, keeps the bounded cache, meshes and follows plans; the page only draws.
// Declares no top-level name: worldsection.js leaks several into this scope.
(function () {
  importScripts('/oneview/worldsection.js', '/oneview/blocks.js', '/oneview/mesher.js', '/oneview/worldcache.js', '/oneview/planview.js');
  const OV = self.OV;
  const PLAN_EVERY = 5000, RETRY = 2100; // RETRY is a little over the cache's 2 s first back-off, so its wait is over when we pump
  let cache = null, cut = 319, worldSeq = 0, paused = false, netOk = true;
  let changing = false, blocked = false, epoch = 0, retry = 0, tick = 0;
  const plans = new Map(); // key -> {bot, at, seq, busy, reply, sent, cut}: at/seq of the last fetch, sent/cut of the last message

  const post = (msg, transfer = []) => self.postMessage(msg, transfer);
  const drop = ([cx, cz]) => post({t: 'chunk', cx, cz, state: -1});
  const setNet = (ok) => { if (ok !== netOk) { netOk = ok; post({t: 'net', ok}); } };

  function mesh(cx, sy, cz) {
    const sec = cache.section(cx, sy, cz);
    if (!sec) return;
    const nb = cache.neighbours(cx, sy, cz);
    if (cut < (sy + 1) * 16) nb[3] = null; // the cut layer gets a lid
    const m = OV.mesher.meshSection(sec, nb, Math.max(0, Math.min(16, cut + 1 - sy * 16)));
    if (!m) return post({t: 'mesh', cx, sy, cz, pos: null, col: null, idx: null});
    post({t: 'mesh', cx, sy, cz, pos: m.pos, col: m.col, idx: m.idx}, [m.pos.buffer, m.col.buffer, m.idx.buffer]);
  }

  function apply(out) {
    const gone = cache.evict(); // before meshing: the late reply of a tile the view left then makes no mesh
    for (const [cx, cz, state] of out.chunks) post({t: 'chunk', cx, cz, state});
    for (const [cx, sy, cz] of out.mesh) mesh(cx, sy, cz);
    gone.forEach(drop);
  }

  async function load(q) {
    let records = null;
    try {
      const res = await fetch(`/api/world/sections?cx=${q.cx}&cz=${q.cz}&r=${q.r}`);
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
      const res = await fetch('/api/world/changes?since=' + cache.seq());
      if (res.status === 200) { reply = await res.json(); if (!Array.isArray(reply.sections)) reply = null; }
    } catch (err) { reply = null; }
    changing = false;
    // a reply that lands after a reset belongs to the old world: dropped
    if (e === epoch) { if (reply) cache.changes(reply, seen); else blocked = true; }
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
      const res = await fetch('/api/plan/status?bot=' + encodeURIComponent(p.bot));
      status = res.status;
      if (status === 200) { reply = await res.json(); if (!Array.isArray(reply.blocks)) status = 0; }
    } catch (e) { status = 0; }
    p.busy = false;
    if (plans.get(key) !== p) return; // the key left the list meanwhile
    if (status !== 200 && status !== 404 && status !== 413) { p.seq = null; return; } // retried on the next round
    const sent = status === 404 ? 'gone' : status === 413 ? 'big' : reply.blocks.map((b) => b[4]).join('');
    p.reply = status === 200 ? reply : null;
    if (sent === p.sent && p.cut === cut) return;
    p.sent = sent; p.cut = cut;
    if (p.reply) show(key, p); else post({t: 'plan', key, state: sent});
  }

  function pump() {
    if (cache) {
      cache.evict().forEach(drop);
      if (!paused) {
        if (!changing && !blocked && worldSeq > cache.seq()) pull();
        for (let q; (q = cache.next());) load(q);
      }
      if ((!netOk || blocked) && !retry) retry = setTimeout(() => { retry = 0; blocked = false; pump(); }, RETRY);
    }
    if (!paused) for (const [key, p] of plans) if (!p.busy && p.seq !== worldSeq && Date.now() - p.at >= PLAN_EVERY) follow(key, p);
    if (plans.size && !tick) tick = setTimeout(() => { tick = 0; pump(); }, PLAN_EVERY);
  }

  self.onmessage = ({data: m}) => {
    if (m.t === 'view') {
      if (!cache) { cache = OV.worldcache.makeCache({viewR: m.viewR}); cache.onSeq(worldSeq); }
      cache.setView(m.cx, m.cz);
    } else if (m.t === 'seq') {
      worldSeq = m.seq;
      if (cache && cache.onSeq(m.seq) === 'reset') { epoch++; post({t: 'reset'}); } // 'changes' is picked up by pump()
    } else if (m.t === 'cut') {
      const old = cut;
      cut = m.y;
      if (cache && cut !== old) for (const [cx, sy, cz] of cache.loaded()) if (sy >= Math.min(old, cut) >> 4) mesh(cx, sy, cz);
      for (const [key, p] of plans) { p.cut = cut; if (p.reply) show(key, p); }
    } else if (m.t === 'plans') {
      const keep = new Set(m.list.map((x) => x.key));
      for (const key of plans.keys()) if (!keep.has(key)) { plans.delete(key); post({t: 'plan', key, state: 'gone'}); }
      for (const {key, bot} of m.list) {
        const p = plans.get(key);
        if (p) p.bot = bot; else plans.set(key, {bot, at: -Infinity, seq: null, busy: false, reply: null, sent: null, cut});
      }
    } else if (m.t === 'pause') paused = m.on;
    pump();
  };
})();
