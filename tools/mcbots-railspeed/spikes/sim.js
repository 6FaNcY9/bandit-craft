'use strict';
// One-off calculation behind docs/runbooks/minecraft/highway-measurements.md, from Mojang's 26.2 NewMinecartBehavior.
// The cart's movement from 26.2's NewMinecartBehavior: drag 0.997 per tick, clamp to the rule, at most one boost of 0.06 per tick.
function sim({rule, spacing, km, v0 = 1, drag = 0.997, ramp = null}) {
  const cap = rule / 20;
  const powered = (b) => { const d = ramp && b < ramp.until ? ramp.spacing : spacing; return b % d === 0; };
  let x = 1.5, v = v0, t = 0, marks = [], next = 500;
  const end = km * 1000;
  while (x < end && t < 2e6) {
    v = Math.min(v * drag, cap);
    let boosted = false, left = v, first = true;
    while (first || left > 1e-5) {
      const b = Math.floor(x);
      if (!boosted && powered(b)) { v += 0.06; left += 0.06; boosted = true; }
      if (v < 1e-5) { left = 0; break; }
      const step = Math.min(left, b + 1 - x + 1e-5);
      x += step; left -= step; first = false;
    }
    t++;
    if (v < 1e-3) break;
    while (x >= next) { marks.push([next, v * 20, t / 20]); next += 500; }
  }
  return {x, ms: v * 20, secs: t / 20, marks};
}
module.exports = {sim};
if (require.main === module) {
  const f = (n) => n.toFixed(1).padStart(6);
  console.log('Check against the measured rows, 2 km lane (setting spacing: end speed, measured)');
  for (const [r, s, m] of [[8, 2, '8.8'], [20, 2, '21.2'], [40, 2, '41.2'], [72, 2, '73.2'], [200, 2, '201.2'], [8, 4, '8.3'], [8, 38, 'avg 6.8, top 7.9']]) {
    const a = sim({rule: r, spacing: s, km: 2, v0: 1});
    console.log(`  ${r}/${s}: sim ${f(a.ms)} measured ${m}`);
  }
  console.log('\nRule 1000. Speed in m/s at the distance, from 20 m/s. gold/km = one powered rail per spacing.');
  const D = [1, 2, 5, 10, 20, 50];
  console.log('spacing gold/km ' + D.map((d) => `${d}km`.padStart(7)).join(''));
  for (const s of [1, 2, 4, 8, 10, 12, 14, 16, 18, 19, 20, 21, 25, 38]) {
    const row = D.map((d) => { const a = sim({rule: 1000, spacing: s, km: d}); return (a.x < d * 1000 ? 'stop' : a.ms.toFixed(0)).padStart(7); }).join('');
    console.log(String(s).padStart(7) + String(Math.round(1000 / s)).padStart(8) + row);
  }
  console.log('\nHow long does a trip take? (minutes for 10 km / 100 km), one spacing all the way, rule 1000');
  for (const s of [2, 4, 8, 16, 19]) {
    const a = sim({rule: 1000, spacing: s, km: 10}), b = sim({rule: 1000, spacing: s, km: 100});
    console.log(`  S=${s}: ${(a.secs / 60).toFixed(1)} / ${(b.secs / 60).toFixed(1)}`);
  }
  console.log('  blue ice boat at 72.73: ' + (10000 / 72.73 / 60).toFixed(1) + ' / ' + (100000 / 72.73 / 60).toFixed(1));
  console.log('\nA dense start, then sparse: 2 km at spacing 2, then spacing S, speed at 10 and 100 km');
  for (const s of [16, 19, 20, 22, 25, 30, 38]) {
    const a = sim({rule: 1000, spacing: s, km: 10, ramp: {until: 2000, spacing: 2}}), b = sim({rule: 1000, spacing: s, km: 100, ramp: {until: 2000, spacing: 2}});
    console.log(`  then S=${s}: ${a.x < 10000 ? 'stop' : a.ms.toFixed(0)} / ${b.x < 100000 ? 'stop at ' + (b.x / 1000).toFixed(1) + ' km' : b.ms.toFixed(0)}, gold/km ${Math.round(1000 / s)}`);
  }
}
