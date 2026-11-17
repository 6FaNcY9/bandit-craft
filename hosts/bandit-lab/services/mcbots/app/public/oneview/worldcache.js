'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.OV = root.OV || {}).worldcache = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Neighbour offsets in the mesher's order: -x +x -y +y -z +z.
  const NB = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  const FLIGHT = 2, WAIT_MAX = 30000;
  // A request is one chunk (r 0, also the column's key) or the 3 x 3 tile around its centre chunk (r 1: centre 3t + 1).
  const req = (r, cx, cz) => ({key: r + ':' + cx + ',' + cz, r, cx, cz});
  const hex = (h) => Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  const span = (v, r) => [Math.floor((v - r) / 3), Math.floor((v + r) / 3)]; // tiles touching chunks v - r .. v + r

  function makeCache({viewR, now = Date.now}) {
    const cols = new Map();   // column key -> {cx, cz, state, secs: Map(sy -> {sec, hash})}
    const tiles = new Map();  // loaded tiles: request key -> request
    const stale = new Map();  // request key -> {...request, gen}: fetch again
    const wait = new Map();   // request key -> {fails, until}
    const flying = new Map(); // id -> request in flight
    let view = null, seq = 0, gen = 0, ids = 0;

    const mark = (r, cx, cz) => { const q = req(r, cx, cz); stale.set(q.key, {...q, gen}); };
    const section = (cx, sy, cz) => cols.get(req(0, cx, cz).key)?.secs.get(sy)?.sec ?? null;

    return {
      setView(cx, cz) { view = {cx, cz}; },

      next() {
        if (flying.size >= FLIGHT) return null;
        const busy = new Set([...flying.values()].map((q) => q.key));
        const ok = (q) => !busy.has(q.key) && (wait.get(q.key)?.until ?? 0) <= now();
        const send = (s) => { const q = {...req(s.r, s.cx, s.cz), id: ++ids, gen}; flying.set(q.id, q); return {id: q.id, cx: q.cx, cz: q.cz, r: q.r}; };
        for (const r of [0, 1]) for (const s of stale.values()) if (s.r === r && ok(s)) return send(s);
        if (!view) return null;
        const [x0, x1] = span(view.cx, viewR), [z0, z1] = span(view.cz, viewR), want = [];
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const t = req(1, 3 * x + 1, 3 * z + 1); if (!tiles.has(t.key) && ok(t)) want.push(t); }
        const d = (t) => (t.cx - view.cx) ** 2 + (t.cz - view.cz) ** 2;
        return want.length ? send(want.sort((a, b) => d(a) - d(b))[0]) : null;
      },

      done(id, records) {
        const q = flying.get(id), out = {mesh: [], chunks: []};
        if (!q) return out; // after a reset
        flying.delete(id); wait.delete(q.key);
        // A change that came in while the request flew may be missing from the reply: only older marks are cleared.
        const fresh = (k) => { if (stale.get(k)?.gen <= q.gen) stale.delete(k); };
        fresh(q.key);
        if (q.r === 1) tiles.set(q.key, q);
        const got = new Map(), changed = [];
        for (const r of records) {
          const k = req(0, r.cx, r.cz).key;
          if (!got.has(k)) got.set(k, {cx: r.cx, cz: r.cz, state: r.kind, secs: new Map()});
          if (r.kind === 0) got.get(k).secs.set(r.sy, {sec: r.sec, hash: hex(r.hash)});
        }
        for (const [k, g] of got) {
          const old = cols.get(k);
          if (q.r === 0 && !old) continue; // evicted while in flight
          for (const [sy, s] of g.secs) if (old?.secs.get(sy)?.hash !== s.hash) changed.push([g.cx, sy, g.cz]);
          if (old?.state !== g.state) out.chunks.push([g.cx, g.cz, g.state]);
          cols.set(k, g); fresh(k);
        }
        const todo = new Map();
        for (const [x, y, z] of changed) for (const [a, b, c] of [[0, 0, 0], ...NB]) if (section(x + a, y + b, z + c)) todo.set([x + a, y + b, z + c].join(), [x + a, y + b, z + c]);
        out.mesh = [...todo.values()];
        return out;
      },

      fail(id) {
        const q = flying.get(id);
        if (!q) return;
        flying.delete(id);
        const fails = (wait.get(q.key)?.fails ?? 0) + 1;
        wait.set(q.key, {fails, until: now() + Math.min(WAIT_MAX, 1000 * 2 ** fails)});
      },

      evict() {
        const out = [];
        if (!view) return out;
        for (const [k, t] of tiles) {
          // Centre-chunk distance minus 1 is the distance of the tile's nearest chunk: keep it up to viewR + 1.
          if (Math.max(Math.abs(t.cx - view.cx), Math.abs(t.cz - view.cz)) <= viewR + 2) continue;
          tiles.delete(k); stale.delete(k);
          for (let x = t.cx - 1; x <= t.cx + 1; x++) for (let z = t.cz - 1; z <= t.cz + 1; z++) {
            const c = req(0, x, z).key;
            stale.delete(c);
            if (cols.delete(c)) out.push([x, z]);
          }
        }
        return out;
      },

      section,
      neighbours: (cx, sy, cz) => NB.map(([a, b, c]) => section(cx + a, sy + b, cz + c)),
      loaded() {
        const out = [];
        for (const c of cols.values()) for (const sy of c.secs.keys()) out.push([c.cx, sy, c.cz]);
        return out;
      },

      onSeq(n) {
        if (!(n > 0)) return null;
        if (seq === 0) { seq = n; return null; }
        if (n > seq) return 'changes';
        if (n === seq) return null;
        cols.clear(); tiles.clear(); stale.clear(); wait.clear(); flying.clear(); seq = n;
        return 'reset';
      },

      changes(reply, seen) {
        gen++;
        if (reply.more) {
          stale.clear();
          for (const t of [...tiles.values(), ...flying.values()]) if (t.r === 1) mark(1, t.cx, t.cz);
          seq = seen;
          return;
        }
        for (const [cx, , cz] of reply.sections) {
          if (cols.has(req(0, cx, cz).key)) mark(0, cx, cz);
          // a request in flight may have read the hub before this change
          for (const q of flying.values()) if (Math.abs(q.cx - cx) <= q.r && Math.abs(q.cz - cz) <= q.r) mark(q.r, q.cx, q.cz);
        }
        seq = reply.seq;
      },

      seq: () => seq,
      size: () => cols.size,
    };
  }

  return {makeCache};
});
