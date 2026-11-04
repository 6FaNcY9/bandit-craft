'use strict';
// One-off calculation behind docs/runbooks/minecraft/highway-measurements.md, from Mojang's 26.2 NewMinecartBehavior.
// Prediction for dips from 26.2's code: only the first slope rail in a tick counts, +-max(0.0078125, 2 % of the speed).
function sim({rule, boost, until, dip, km, v0 = 1}) {
  const cap = rule / 20, end = km * 1000;
  const kind = (b) => {
    if (b < until) return b % boost === 0 ? 'P' : '-';
    if (!dip) return '-';
    const r = (b - until - 10) % dip;
    return b >= until + 10 && r === 0 ? 'D' : b >= until + 10 && r === 1 ? 'U' : '-';
  };
  let x = 1.5, v = v0, t = 0, out = [], next = 500;
  while (x < end && t < 2e6) {
    v = Math.min(v * 0.997, cap);
    let boosted = false, sloped = false, left = v, first = true;
    while (first || left > 1e-5) {
      const b = Math.floor(x), k = kind(b);
      const before = v;
      if (!sloped && (k === 'D' || k === 'U')) { const d = Math.max(0.0078125, v * 0.02); v += k === 'D' ? d : -d; sloped = true; }
      if (v <= 0) { v = 0; left = 0; break; }
      if (!boosted && k === 'P') { v += 0.06; boosted = true; }
      left += v - before;
      if (first) { left = v; }
      const step = Math.min(left, b + 1 - x + 1e-5);
      x += step; left -= step; first = false;
    }
    t++;
    if (v < 1e-3) break;
    while (x >= next) { out.push(`${next / 1000}km ${(v * 20).toFixed(0)}`); next += 500; }
  }
  return {reached: x >= end, ms: v * 20, x, secs: t / 20, out};
}
for (const a of [[2, 300, 0, 2], [2, 300, 16, 2], [2, 300, 8, 2], [2, 300, 32, 2], [2, 300, 64, 2], [2, 1000, 32, 5], [2, 300, 16, 5], [2, 150, 16, 5], [2, 100, 16, 5], [2, 50, 16, 5]]) {
  const [boost, until, dip, km] = a;
  const r = sim({rule: 1000, boost, until, dip, km});
  console.log(`boost/${boost} first ${until}, dip every ${dip}, ${km} km: ${r.reached ? r.ms.toFixed(0) + ' m/s at the end, ' + r.secs.toFixed(0) + ' s' : 'stops at ' + r.x.toFixed(0)} | ${r.out.join(', ')}`);
}
