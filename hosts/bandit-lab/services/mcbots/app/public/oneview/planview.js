'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.OV = root.OV || {}).planview = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // 'a.litematic@-1,64,3': one key per plan, whatever form the origin came in.
  function planKey(file, origin) {
    const [x, y, z] = Array.isArray(origin) ? origin : [origin.x, origin.y, origin.z];
    return `${file}@${x},${y},${z}`;
  }

  // One plan per key; the first bot in name order carries it. Projects without an integer origin have no plan yet.
  function plansOf(projects) {
    const byKey = new Map();
    for (const bot of Object.keys(projects || {}).sort()) {
      const p = projects[bot];
      if (p.type !== 'schematic' || !p.file || !Array.isArray(p.origin) || p.origin.length !== 3 || !p.origin.every(Number.isInteger)) continue;
      const key = planKey(p.file, p.origin);
      if (!byKey.has(key)) byKey.set(key, {key, bot, file: p.file});
    }
    return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  // Draw groups for y <= cutY; counts, percent and box cover the whole plan.
  function planGroups(reply, cutY = 319) {
    const {palette, blocks} = reply;
    const names = ['missing', 'built', 'wrong', 'unknown'];
    const counts = {missing: 0, built: 0, wrong: 0, unknown: 0, total: blocks.length};
    const box = blocks.length ? {x1: Infinity, y1: Infinity, z1: Infinity, x2: -Infinity, y2: -Infinity, z2: -Infinity} : null;
    const buckets = new Map();
    for (const [x, y, z, i, s] of blocks) {
      counts[names[s]]++;
      box.x1 = Math.min(box.x1, x); box.y1 = Math.min(box.y1, y); box.z1 = Math.min(box.z1, z);
      box.x2 = Math.max(box.x2, x); box.y2 = Math.max(box.y2, y); box.z2 = Math.max(box.z2, z);
      if (y > cutY) continue;
      // Wrong and unknown cells are one group each; missing and built split by palette name.
      const pi = s < 2 ? i : -1;
      const k = `${s},${pi}`;
      if (!buckets.has(k)) buckets.set(k, {s, pi, xyz: []});
      buckets.get(k).xyz.push(x, y, z);
    }
    const groups = [...buckets.values()].sort((a, b) => a.s - b.s || a.pi - b.pi)
      .map((b) => ({name: b.pi < 0 ? null : palette[b.pi], s: b.s, xyz: new Int32Array(b.xyz)}));
    return {groups, counts, percent: counts.total ? Math.floor((100 * counts.built) / counts.total) : 0, box};
  }

  return {planKey, plansOf, planGroups};
});
