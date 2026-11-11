#!/usr/bin/env node
'use strict';
// The repeatable stress test: what the bots failed at, where they died, and what they finished, from the
// mcbots event archive (/api/archive/events.jsonl). Run it before and after a deploy. No dependencies
// (the lab has no python3). Usage: node report.js <events.jsonl>... [--days N]
const fs = require('node:fs');

const DAY = 86400000;
const mask = (text) => String(text || '').replace(/-?\d+(\.\d+)?/g, '#').slice(0, 160);

function summarize(lines, {days = 4, now = Date.now()} = {}) {
  let bad = 0;
  const perBotDay = {}, fails = new Map(), deaths = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line).event; } catch { bad++; continue; }
    if (!e || typeof e.t !== 'number' || typeof e.bot !== 'string' || now - e.t > days * DAY) continue;
    if (!['done', 'fail', 'death'].includes(e.kind)) continue;
    const day = new Date(e.t).toISOString().slice(0, 10);
    const d = ((perBotDay[e.bot] ||= {})[day] ||= {done: 0, fail: 0, death: 0});
    d[e.kind]++;
    if (e.kind === 'fail') {
      const k = `${e.bot}\t${mask(e.text)}`;
      fails.set(k, (fails.get(k) || 0) + 1);
    }
    const at = e.kind === 'death' && /died at (-?\d+) -?\d+ (-?\d+)/.exec(e.text || '');
    if (at) {
      const k = `${e.bot}\t${Math.floor(at[1] / 32) * 32},${Math.floor(at[2] / 32) * 32}`;
      deaths.set(k, (deaths.get(k) || 0) + 1);
    }
  }
  const top = (m, field) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => { const [bot, v] = k.split('\t'); return {bot, [field]: v, n}; });
  return {bad, perBotDay, fails: top(fails, 'text'), deaths: top(deaths, 'cell')};
}

function print(s, days) {
  const out = [`last ${days} days${s.bad ? `, ${s.bad} bad lines skipped` : ''}`, '', 'per bot and day: done / fail / death'];
  for (const [bot, byDay] of Object.entries(s.perBotDay).sort()) {
    out.push(`  ${bot.padEnd(12)} ${Object.entries(byDay).sort().map(([d, c]) => `${d.slice(5)} ${c.done}/${c.fail}/${c.death}`).join('  ')}`);
  }
  out.push('', 'top fails (digits as #)');
  for (const f of s.fails) out.push(`  ${String(f.n).padStart(5)}  ${f.bot.padEnd(12)} ${f.text}`);
  out.push('', 'deaths by 32-block cell (x,z)');
  for (const d of s.deaths) out.push(`  ${String(d.n).padStart(5)}  ${d.bot.padEnd(12)} ${d.cell}`);
  return out.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--days');
  const days = i >= 0 ? Number(args.splice(i, 2)[1]) : 4;
  if (!args.length || !(days > 0)) {
    console.error('usage: node report.js <events.jsonl>... [--days N]');
    process.exit(2);
  }
  const lines = args.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n'));
  console.log(print(summarize(lines, {days}), days));
}

module.exports = {summarize, print};
