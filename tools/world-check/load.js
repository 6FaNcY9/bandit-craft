#!/usr/bin/env node
'use strict';
// Does the world model cost measurable load? Run it once with the model off (before) and once on (after), compare the files.
// node load.js run [--minutes 30] --out before.json [--hub URL]
// node load.js compare before.json after.json
const fs = require('node:fs');
const {HUB, Exit, sleep, parseArgs, makeApi, parseMspt, compareLoad, run} = require('./lib');

const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null; };
const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Exit(2, `cannot read ${file}: ${e.message}`); }
};

async function sampleOnce(api) {
  const status = await api('/api/admin/status');
  const debug = await api('/api/debug');
  const stats = await api('/api/world/stats').catch(() => null); // 503 when the model is off
  return {mspt: parseMspt(status.mspt), loopP99: debug.loopDelayMs?.p99 ?? null, pluginMainMs: stats?.plugin?.mainMsLastMinute ?? null,
    pluginEncodeMs: stats?.plugin?.encodeMsLastMinute ?? null};
}

async function measure(a) {
  const minutes = Number(a.minutes ?? 30);
  if (!Number.isInteger(minutes) || minutes < 1 || typeof a.out !== 'string') throw new Exit(2, 'usage: load.js run [--minutes 30] --out file.json');
  const api = makeApi(a.hub || HUB), rows = [];
  for (let i = 0; i < minutes; i++) {
    if (i) await sleep(60000);
    try {
      rows.push(await sampleOnce(api));
    } catch (e) { // the first one fails fast (wrong hub); a later one costs one row, not the run
      if (!i) throw e;
      rows.push({error: e.message});
    }
    console.log(`${i + 1}/${minutes}: ${JSON.stringify(rows[i])}`);
  }
  const out = {at: new Date().toISOString(), minutes, failedSamples: rows.filter((r) => r.error).length, mspt: mean(rows.map((r) => r.mspt)),
    loopP99: mean(rows.map((r) => r.loopP99)), pluginMainMs: mean(rows.map((r) => r.pluginMainMs)), pluginEncodeMs: mean(rows.map((r) => r.pluginEncodeMs))};
  fs.writeFileSync(a.out, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${a.out}: ${JSON.stringify(out)}`);
}

function compare([, beforeFile, afterFile]) {
  if (!beforeFile || !afterFile) throw new Exit(2, 'usage: load.js compare before.json after.json');
  const before = read(beforeFile), after = read(afterFile), r = compareLoad(before, after);
  console.log(`mspt (1 min mean)  ${before.mspt} -> ${after.mspt}  delta ${r.msptDelta ?? 'n/a'}  (limit 0.5)`);
  console.log(`loop p99 ms        ${before.loopP99} -> ${after.loopP99}  delta ${r.loopP99Delta ?? 'n/a'}  (limit 2)`);
  console.log(`plugin main ms/min ${before.pluginMainMs} -> ${after.pluginMainMs}  (info only)`);
  console.log(`plugin encode ms/min ${before.pluginEncodeMs} -> ${after.pluginEncodeMs}  (info only, encoder thread)`);
  console.log(r.ok ? 'PASS' : 'FAIL: the model costs more than the limits');
  return r.ok ? 0 : 1;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a._[0] === 'run') return measure(a);
  if (a._[0] === 'compare') return compare(a._);
  throw new Exit(2, 'usage: load.js run [--minutes 30] --out file.json | load.js compare before.json after.json');
}

run(main);
