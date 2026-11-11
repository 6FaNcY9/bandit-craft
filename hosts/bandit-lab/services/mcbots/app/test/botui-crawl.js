'use strict';
// Menu crawler: from every way into the picture menus, click every slot (plain and Shift) a few clicks deep with the
// real BotUi, screens and menus against a fake plugin and api. Every menu must be well-formed (slots in range and
// unique, real item ids, known actions) and no offered click may end in an error flash, a dead end or a log line.
const assert = require('node:assert/strict');
const {BotUi, ACTIONS} = require('../botui');
const {VALIDATE} = require('../bots');
const items = require('minecraft-data')('26.1').itemsByName;

const inv = ['oak_log x20', 'coal x10', 'raw_iron x16', 'iron_ingot x5', 'cobblestone x64', 'diamond_pickaxe x1', 'lapis_lazuli x9', 'stick x8', 'oak_planks x12'];
const at = (x, z) => ({pos: [x, 64, z], dimension: 'overworld'});
const SNAPS = [
  {name: 'bot1', online: true, health: 20, food: 20, activity: 'mining', job: {type: 'mine'}, inventory: inv, chest: {x: 1, y: 64, z: 1}, ...at(0, 0)},
  {name: 'bot2', online: true, health: 9, food: 3, activity: 'frei', job: null, inventory: [], ...at(5, 5)},
  {name: 'bot3', online: false, job: null},
  {name: 'MisaBot', online: true, health: 20, job: {type: 'chop'}, inventory: ['oak_log x3', 'iron_sword x1'], ...at(9, 9)},
  {name: 'EM_Trader', online: true, health: 20, job: {type: 'trade'}, inventory: [], ...at(9, 9)},
];
const PLACES = [{name: 'Vorrat', kind: 'supply', x: -271, y: 66, z: -214}, {name: 'Farm', kind: 'treefarm', x: 20, y: 64, z: 20, box: {x1: 20, y1: 60, z1: 20, x2: 30, y2: 70, z2: 30}},
  {name: 'Feld', kind: 'wheat', x: 40, y: 64, z: 40, box: {x1: 40, y1: 60, z1: 40, x2: 45, y2: 66, z2: 45}}, {name: 'Spawn', kind: 'protected', x: 0, y: 64, z: 0}];
const PLANS = [{file: 'haus.litematic', top: 'oak_planks', size: {x: 5, y: 4, z: 5}, offset: {x: 0, y: 0, z: 0}, blocks: 100, mtime: 2, owner: true}];
const SIZE = {chest: (m) => m.rows * 9, hopper: () => 5, furnace: () => 3};

const block = (b, x = 3, y = 64, z = 3) => ({x, y, z, block: b});
const ENTRIES = [ // the ways a viewer gets into the menus: open (right click / Shift+F) aimed at things, and the Lagebild
  ['open', null], ['mark', null], ['open', {...block('stone'), entity: {type: 'player', name: 'bot1', x: 0, y: 64, z: 0}}], ['open', {...block('stone'), entity: {type: 'player', name: 'MisaBot', x: 9, y: 64, z: 9}}],
  ['open', block('crafting_table')], ['open', block('furnace')], ['open', block('enchanting_table')], ['open', block('chest')],
  ['open', {...block('grass_block'), entity: {type: 'cow', name: null, x: 4, y: 64, z: 4}}], ['open', block('wheat')], ['open', block('spawner')], ['open', block('iron_ore')],
  ['lage', null], ['mapclick', null],
];
// What a viewer aims at to answer a pick (st.pick): the area takes two clicks on different blocks.
const ANSWER = {chest: [block('chest', 7, 64, 7)], block: [block('iron_ore')], place: [block('stone', 10, 63, 10)], area: [block('stone', 10, 63, 10), block('stone', 12, 65, 12)]};

function mk(viewer) {
  const sent = [], logs = [];
  let id = 0, t = 1e6;
  const fetch = async (url, o) => {
    const path = new URL(url).pathname, body = o.body ? JSON.parse(o.body) : null;
    sent.push({path, body});
    return {ok: true, json: async () => ({ok: true})};
  };
  const api = {snapshots: () => SNAPS, places: () => PLACES, schematics: async () => PLANS, projects: () => ({bot1: {paused: true}}),
    idle: {get: (b) => (b === 'bot1' ? {id: 'holz'} : null), set: (b, c) => ({label: c})},
    keeper: {state: () => ({available: true, enabled: true, quotas: [{item: 'logs', want: 100}], chest: {x: -271, y: 66, z: -214}}), setEnabled() {}, setWant() {}},
    traders: () => ['EM_Trader'], traderChests: {list: () => ({sticks: [{x: 3, y: 64, z: 3}], stores: []}), add() {}, remove() {}},
    submit: (v, {type, args}) => { // the job's own validator, as BotRunner.enqueue runs it (server.js submitJob adds the wheat fields first)
      if (type === 'wheatfarm') args = require('../wheatfarm').withFields(args || {}, [{x1: 40, z1: 40, x2: 45, z2: 45}]);
      if (type !== 'stop') { if (!VALIDATE[type]) throw new Error(`unknown job type: ${type}`); VALIDATE[type](args || {}); }
      return {ok: true, unreached: []};
    }, stopAll: () => ({keeperOff: true}), resume() {}, sidebar() {},
    uploadLink: (v) => `https://x.test/u?t=${v}`, groundOk: () => true, markers: () => [], presence() {}};
  const ui = new BotUi({url: 'http://plugin.test', token: 't', viewerBots: {Fancy: '*', Midari: ['MisaBot', 'EM_Trader'], Leer: ['gone']}, api, fetch, log: (m) => logs.push(m), now: () => (t += 1000)});
  const ev = (type, gaze, extra = {}) => ui.handle({id: ++id, type, player: viewer, pos: [2, 64, 2], dim: 'overworld', yaw: 0, gaze, ...extra});
  return {ui, sent, logs, ev, st: () => ui.state(viewer)};
}

// A menu as the plugin would get it: shape checks; returns the problems.
function check(m) {
  const bad = [], size = SIZE[m.type]?.(m), seen = new Set();
  if (!size) return [`type ${m.type}`];
  if (typeof m.title !== 'string' || !m.title.length || m.title.length > 128) bad.push(`title ${m.title}`);
  for (const s of m.slots) {
    if (!Number.isInteger(s.slot) || s.slot < 0 || s.slot >= size) bad.push(`slot ${s.slot} of ${size} (${s.name})`);
    if (seen.has(s.slot)) bad.push(`slot ${s.slot} twice`);
    seen.add(s.slot);
    if (!items[s.item]) bad.push(`item ${s.item} (${s.name})`);
    if (typeof s.name !== 'string' || !s.name.length) bad.push(`name at ${s.slot}`);
    if (!s.payload || !Object.hasOwn(ACTIONS, s.payload.a)) bad.push(`action ${s.payload?.a} at ${s.slot}`);
    if (s.count !== undefined && !(Number.isInteger(s.count) && s.count >= 1 && s.count <= 64)) bad.push(`count ${s.count} at ${s.slot}`);
  }
  return bad;
}

// Replays one path (entry, then clicks; a pick is answered with its gaze) on a fresh hub and reports what it saw.
async function run(viewer, [entry, ...clicks]) {
  const h = mk(viewer), gaze = entry[1];
  if (entry[0] === 'mark') { // Shift + staff on two blocks: a marked spot and area, then the overview
    await h.ev('open', block('stone', 30, 63, 30), {sneak: true});
    await h.ev('open', block('stone', 33, 65, 33), {sneak: true});
  }
  await h.ev(entry[0] === 'mark' ? 'open' : entry[0], gaze);
  for (const c of clicks) {
    h.sent.length = 0;
    await h.ev('click', gaze, {data: {...c.payload, shift: c.shift}});
    const pick = h.st()?.pick;
    if (pick) for (const g of ANSWER[pick.kind]) await h.ev('open', g, {sneak: false});
  }
  const st = h.st(), menu = h.sent.filter((c) => c.path === '/menu').at(-1)?.body;
  return {st, menu, sent: h.sent, logs: h.logs, flash: st?.flash?.text || ''};
}

(async () => {
  const problems = new Map(), note = (k, path) => { if (!problems.has(k)) problems.set(k, path); };
  const say = (path) => path.map((p, i) => (i ? `${p.payload.a}${p.shift ? '+shift' : ''}@${p.slot}` : `${p[0]}:${p[1]?.entity?.type || p[1]?.block || '-'}`)).join(' > ');
  let runs = 0;
  const menus = [];
  for (const viewer of ['Fancy', 'Midari', 'Leer']) {
    const seen = new Set();
    let frontier = ENTRIES.map((e) => [e]);
    for (let depth = 0; depth <= 5 && frontier.length; depth++) {
      const next = [];
      for (const path of frontier) {
        const r = await run(viewer, path);
        runs++;
        const where = `${viewer}: ${say(path)}`;
        // Shift = "where you look" while looking at the sky; a viewer whose bots are all gone
        const honest = (!path[0][1] && /keinen Block/.test(r.flash)) || (viewer === 'Leer' && /^Fehler: (kein Bot|Kein freier Bot)$/.test(r.flash));
        if (/^Fehler|Unbekannte/.test(r.flash) && !honest) note(`${viewer} flash "${r.flash}"`, where);
        for (const l of r.logs) if (!(honest && l.endsWith(r.flash.replace(/^Fehler: /, '')))) note(`${viewer} log "${l}"`, where); // the hub logs every error flash too
        if (!r.menu) continue; // a dialog, a pick or a close: nothing to click here
        for (const b of check(r.menu)) note(`${viewer} menu "${r.menu.title}": ${b}`, where);
        const key = `${r.st.screen.name}|${r.menu.title}|${JSON.stringify(r.menu.slots.map((s) => [s.slot, s.name, s.payload]))}`;
        if (seen.has(key)) continue;
        seen.add(key);
        menus.push(r.menu);
        for (const s of r.menu.slots) for (const shift of [false, true]) next.push([...path, {payload: s.payload, shift, slot: s.slot}]);
      }
      frontier = next;
    }
  }
  for (const [k, where] of problems) console.log(`${k}\n    at ${where}`);
  if (process.env.CRAWL_OUT) require('node:fs').writeFileSync(process.env.CRAWL_OUT, JSON.stringify(menus)); // tools/botui-stand/e2e-menus.js shows them on Paper
  assert.equal(problems.size, 0, `${problems.size} menu problems in ${runs} runs`);
  console.log(`botui-crawl ok (${runs} runs)`);
})().catch((e) => { console.error(e); process.exit(1); });
