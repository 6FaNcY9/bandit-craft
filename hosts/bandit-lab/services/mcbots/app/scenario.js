'use strict';
// Sandbox scenarios: the console lines that rebuild a test area, the console check that it was dug out,
// and the numbers of a run (time, stalls, deaths) from the hub's status samples. Pure; scenario-run.js
// talks to the sandbox console and the dashboard.

const FILL_MAX = 32768; // the server refuses a larger /fill

const norm = (b) => ({x1: Math.min(b.x1, b.x2), y1: Math.min(b.y1, b.y2), z1: Math.min(b.z1, b.z2), x2: Math.max(b.x1, b.x2), y2: Math.max(b.y1, b.y2), z2: Math.max(b.z1, b.z2)});
const coords = (b) => `${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2}`;

function resetCommands(scn) {
  const b = norm(scn.box);
  const size = (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1);
  if (size > FILL_MAX) throw new Error(`box of ${size} blocks is too big for one fill (max ${FILL_MAX})`);
  // The air row on top clears what a run left above the box, so the next run starts on a free floor.
  return [`fill ${coords(b)} ${scn.fill || 'stone'}`, `fill ${b.x1} ${b.y2 + 1} ${b.z1} ${b.x2} ${b.y2 + 1} ${b.z2} air`];
}

// Compares the box with the same shape at y 300, which is always air.
const emptyCheck = (box) => {
  const b = norm(box);
  return `execute if blocks ${coords(b)} ${b.x1} 300 ${b.z1} all`;
};

// The console touches only loaded chunks ("That position is not loaded" in the spike, once the bots had left).
const loaded = (box, lines) => {
  const b = norm(box);
  return [`forceload add ${b.x1} ${b.z1} ${b.x2} ${b.z2}`, ...lines, `forceload remove ${b.x1} ${b.z1} ${b.x2} ${b.z2}`];
};

// Torches are wanted light, not leftovers: they go before the check (the box is rebuilt for the next run anyway).
const checkCommands = (box) => {
  const b = norm(box);
  return loaded(b, [`fill ${coords(b)} air replace torch`, `fill ${coords(b)} air replace wall_torch`, emptyCheck(b)]);
};

// samples: [{t, bots: [{name, online, dead, job: {done}|null}]}]. A stall is stallMs in which a job ran and
// no bot's job.done grew; one long stall counts once.
function measure(samples, {stallMs = 60000} = {}) {
  let stalls = 0, deaths = 0, lastT = samples[0]?.t ?? 0, stalled = false;
  const prev = new Map();
  for (const {t, bots} of samples) {
    let grew = false;
    for (const s of bots) {
      const p = prev.get(s.name);
      if (p && (s.job?.done ?? 0) > (p.job?.done ?? 0)) grew = true;
      if (p && s.dead && !p.dead) deaths++;
      prev.set(s.name, s);
    }
    if (grew || !bots.some((s) => s.job)) { lastT = t; stalled = false; }
    else if (!stalled && t - lastT >= stallMs) { stalls++; stalled = true; }
  }
  return {ms: samples.length ? samples[samples.length - 1].t - samples[0].t : 0, stalls, deaths};
}

// The spike's box (2026-10-23): open ground in the sandbox, far from every protected zone.
const SPIKE_BOX = {x1: -140, y1: 70, z1: 0, x2: -125, y2: 77, z2: 15};
const SCENARIOS = {
  'excavate-16': {box: SPIKE_BOX, fill: 'stone', job: {kind: 'excavate', box: SPIKE_BOX}},
};

module.exports = {resetCommands, emptyCheck, checkCommands, loaded, measure, SCENARIOS};
