'use strict';
// Pure builders for the in-game dialogs (Minecraft dialog JSON, multi_action). No I/O and no clock: the same view must
// build the same JSON, because BotUi re-sends a refreshing screen only when its JSON changed.
const {ago, DIMENSION, failing, botState} = require('./ingame');
const {JOBS, BLOCKS, ITEMS, CRAFTS, SMELTS, germanName, contextJobs, areaJobs, dims, supplyOf} = require('./botui-jobs');

// Anything from a snapshot or an error goes through here: no colour codes or control characters, bounded length.
const safe = (text, max = 60) => {
  const s = String(text ?? '').replace(/§./g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

// Bot error text -> the cause in plain German. Real texts carry a job prefix ("shift: no free stone ..."), so nothing
// is anchored; unknown text stays as it is (the caller shortens it).
function explain(error) {
  const e = String(error ?? '');
  let m;
  if (/inventory still full/.test(e)) return 'Kiste voll';
  if ((m = /no free (\w+) within \d+ blocks/.exec(e))) return `nichts zu finden: ${m[1]} in Reichweite`;
  if (/could not reach/.test(e)) return 'kein Weg dorthin';
  if ((m = /unsafe: (water|lava)/.exec(e))) return m[1] === 'water' ? 'Wasser daneben, zu gefährlich' : 'Lava daneben, zu gefährlich';
  if ((m = /need (\d+) more (\w+)/.exec(e))) return `${m[1]} ${m[2]} fehlen`;
  if ((m = /need (\d+) (\w+), have (\d+)/.exec(e))) return `${m[1]} ${m[2]} nötig, nur ${m[3]} da`;
  if (/is not visible and not on the map/.test(e)) return 'nicht sichtbar (offline oder keine Karte)';
  if (/the stick chests are empty/.test(e)) return 'Stick-Kisten leer, wartet';
  return e;
}

const COLOR = {work: 'green', idle: 'gray', error: 'red', dead: 'red', offline: 'dark_gray', sheltered: 'aqua'};
const STATE_WORD = {work: 'arbeitet', idle: 'frei', error: 'Problem', dead: 'tot', offline: 'offline', sheltered: 'im Unterschlupf'};
const mine = (view) => view.snaps.filter((s) => view.allowed === '*' || view.allowed.includes(s.name));
const act = (a, extra = {}) => ({type: 'minecraft:custom', id: 'botui:do', payload: {a, ...extra}});
const txt = (text, color) => ({text, ...(color ? {color} : {})});
const line = (...pieces) => ({type: 'minecraft:plain_message', width: 400, contents: ['', ...pieces]});
const button = (label, a, extra, tooltip) => ({label, width: 200, ...(tooltip ? {tooltip} : {}), action: act(a, extra)});
const lines = (list) => ['', ...list.flatMap(([text, color], i) => [...(i ? [{text: '\n'}] : []), txt(safe(text, 80), color || 'gray')])];

function dialog(title, body, actions, exit, columns = 2, inputs = []) {
  return {type: 'minecraft:multi_action', title: txt(title, 'gold'), body, columns, actions, ...(inputs.length ? {inputs} : {}),
    exit_action: {label: txt(exit.label), action: act(exit.a)}, after_action: 'none', pause: false, can_close_with_escape: true};
}
const CLOSE = {label: 'Schließen', a: 'close'};

// "Baumfarm 5/64 · 12 min" or the plain state word.
function jobText(s, state) {
  if (!s.job) return STATE_WORD[state];
  const mins = typeof s.job.runningS === 'number' && s.job.runningS >= 60 ? ` · ${ago(s.job.runningS)}` : '';
  return safe(s.job.label) + (s.job.progress ? ' ' + safe(s.job.progress, 12) : '') + mins;
}

function tooltip(s, state) {
  const out = [[`${STATE_WORD[state]}${s.job ? ': ' + jobText(s, state) : ''}`, COLOR[state]]];
  if (s.activity) out.push([s.activity]);
  if (s.queue?.length) out.push([`danach: ${s.queue.slice(0, 3).join(', ')}${s.queue.length > 3 ? ` +${s.queue.length - 3}` : ''}`]);
  if (s.online) {
    out.push([`Leben ${Math.round(s.health)} · Essen ${Math.round(s.food)} · frei ${s.freeSlots}`]);
    if (s.tool) out.push([`${s.tool.name}${s.tool.max ? ` ${s.tool.left}/${s.tool.max}` : ''}`]);
    if (s.pos) out.push([`${s.pos.join(' ')} ${DIMENSION[s.dimension] || ''}`.trim()]);
  }
  return lines(out);
}

function problems(snaps) {
  return snaps.filter((s) => ['error', 'dead'].includes(botState(s))).slice(0, 3).map((s) => {
    const cause = s.dead ? 'tot' : safe(explain(s.lastError), 40);
    const when = s.dead || s.lastErrorAgoS < 60 ? '' : ` (vor ${ago(s.lastErrorAgoS)})`;
    return line(txt(`${safe(s.name, 16)}: ${cause}${s.job ? `, ${safe(s.job.label, 20)} steht` : ''}${when}`, 'red'));
  });
}

function flashLine(flash) {
  return flash ? [line(txt(`${flash.ok ? '✔' : '✖'} ${safe(flash.text, 90)}`, flash.ok ? 'green' : 'red'))] : [];
}

function lage(view) {
  const snaps = mine(view), states = snaps.map(botState);
  const online = snaps.find((s) => s.online && typeof s.isDay === 'boolean');
  let need = null;
  try {
    const k = view.keeper?.state();
    if (k?.available) {
      const short = k.quotas.filter((q) => q.have !== null && q.have < q.want);
      need = short.length ? 'Bedarf: ' + short.slice(0, 3).map((q) => `${safe(q.item, 24)} ${q.have}/${q.want}`).join(', ') + (short.length > 3 ? ` +${short.length - 3}` : '') : 'Alles auf Lager';
    }
  } catch { /* a keeper that cannot say is no reason to lose the screen */ }
  const body = [
    line(txt(`${snaps.length} Bots · ${states.filter((x) => x === 'work').length} arbeiten · ${states.filter((x) => x === 'idle').length} frei${online ? ' · ' + (online.isDay ? 'Tag' : 'Nacht') : ''}`, 'white')),
    ...problems(snaps),
    ...(need ? [line(txt(need, need === 'Alles auf Lager' ? 'green' : 'yellow'))] : []),
    ...flashLine(view.flash),
  ];
  const actions = snaps.map((s, i) => {
    const room = Math.max(8, 28 - safe(s.name, 16).length);
    const label = ['', txt('● ', COLOR[states[i]]), txt(safe(s.name, 16) + '  '), txt(safe(jobText(s, states[i]), room), 'gray')];
    return button(label, 'bot', {bot: s.name}, tooltip(s, states[i]));
  });
  const g = view.ctx?.gaze;
  actions.push(button(txt(g ? `Auftrag: ${safe(germanName(g.block), 24)} ▸` : 'Neuer Auftrag', 'aqua'), 'new'), button(txt('Ziele'), 'ziele'), button(txt('Karte'), 'karte'));
  if (view.owner) actions.push(button(txt('Alle stopp', 'red'), 'stopall'));
  return dialog('Kommandostand', body, actions, CLOSE);
}

const QUICK = [['deposit', 'Einlagern'], ['rearm', 'Ausrüsten'], ['homebed', 'Heim'], ['graves', 'Gräber holen']];

function bot(view, name) {
  const s = mine(view).find((x) => x.name === name);
  if (!s) return dialog(safe(name, 16), [line(txt('Bot nicht gefunden', 'red')), ...flashLine(view.flash)], [], {label: 'Zur Übersicht', a: 'lage'});
  const state = botState(s), n = safe(s.name, 16);
  const body = [line(txt('● ', COLOR[state]), txt(`${STATE_WORD[state]}${s.job ? ': ' + jobText(s, state) : ''}`, 'white'))];
  if (s.activity) body.push(line(txt(safe(s.activity, 80))));
  if (s.queue?.length) body.push(line(txt('Danach: ', 'gray'), txt(safe(s.queue.slice(0, 3).join(', '), 70) + (s.queue.length > 3 ? ` +${s.queue.length - 3}` : ''))));
  if (s.online) {
    const worn = Array.isArray(s.armour) ? s.armour.filter(Boolean).length : 0;
    body.push(line(txt(`Leben ${Math.round(s.health)} · Essen ${Math.round(s.food)} · Rüstung ${worn}/4 · frei ${s.freeSlots}`)));
    if (s.tool) body.push(line(txt(safe(`${s.tool.name}${s.tool.max ? ` ${s.tool.left}/${s.tool.max}` : ''}`, 60), 'gray')));
    if (s.inventory?.length) body.push(line(txt('Inventar: ', 'gray'), txt(safe(s.inventory.slice(0, 8).join(', '), 150))));
    if (s.pos) body.push(line(txt(`Position ${s.pos.join(' ')} ${DIMENSION[s.dimension] || ''}`.trim(), 'gray')));
  }
  if (failing(s) && s.lastError) body.push(line(txt(safe(explain(s.lastError), 80), 'red')));
  body.push(...flashLine(view.flash));
  const actions = [button(txt('Stopp', 'red'), 'stop', {bot: s.name}), button(txt('Auftrag für ' + n, 'aqua'), 'new', {bot: s.name}),
    ...QUICK.map(([job, label]) => button(txt(label), 'quick', {bot: s.name, job}))];
  return dialog(n, body, actions, {label: 'Zur Übersicht', a: 'lage'});
}

function confirmStop() {
  return dialog('Alle stoppen?', [line(txt('Alle Bots anhalten und die Daueraufträge ausschalten?', 'white'))],
    [button(txt('Ja, alle stoppen', 'red'), 'stopall_ok')], {label: 'Abbrechen', a: 'lage'}, 1);
}

// --- Auftrag: step 1 (what the player looks at, area corners, general jobs), step 2 (the job's inputs)
const field = (type, key, label, extra) => ({type: 'minecraft:' + type, key, label: txt(label), width: 200, ...extra});
const select = (key, label, opts, initial) => field('single_option', key, label, {options: opts.map(([id, display]) => ({id, display: txt(safe(display, 40)), ...(id === initial ? {initial: true} : {})}))});
const typed = (key, label) => field('text', key, label, {max_length: 48, initial: ''});
const slider = (key, label, min, max, step, initial) => field('number_range', key, label, {start: min, end: max, step, initial});
const spot = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const placesOf = (view, ok) => (view.places || []).filter((p) => spot(p) && p.name && ok(p)).slice(0, 12);
const supplyOpt = (view) => (supplyOf(view.keeper) ? [['supply', 'Vorratskiste']] : []);

function targetSelect(view, w) { // where
  const g = view.ctx?.gaze;
  const opts = [...(w.optional ? [['none', 'Vorratskiste (Standard)']] : []), ...(g ? [['gaze', `Worauf du schaust (${g.x} ${g.y} ${g.z})`]] : []), ['pos', 'Wo du stehst'],
    ...(w.optional ? [] : supplyOpt(view)), ...placesOf(view, (p) => p.kind !== 'protected').map((p) => [`place:${p.name}`, p.name])];
  return [select('where', 'Wohin', opts, opts[0][0]), typed('wheretext', 'Oder Koordinaten (x y z)')];
}
function chestSelect(view) {
  const g = view.ctx?.gaze;
  const opts = [...supplyOpt(view), ...placesOf(view, (p) => ['supply', 'storage', 'base'].includes(p.kind)).map((p) => [`place:${p.name}`, p.name]), ...(g ? [['gaze', 'Worauf du schaust']] : [])];
  return [...(opts.length ? [select('chest', 'Kiste', opts, opts[0][0])] : []), typed('chesttext', 'Oder Koordinaten (x y z)')];
}
function nameSelect(key, label, list, gazed) {
  const ids = gazed && !list.includes(gazed) ? [gazed, ...list] : list;
  return [select(key, label, ids.map((id) => [id, germanName(id)]), gazed && ids.includes(gazed) ? gazed : ids[0]), typed(key + 'x', 'Oder Name (z. B. ' + (key === 'block' ? 'coal_ore' : 'iron_axe') + ')')];
}

// The inputs one job needs. A preset (target or block from the gaze) is not asked again. notes: what could not be offered.
function inputsOf(job, view, sc) {
  const preset = sc.preset || {}, inputs = [], notes = [];
  const gazed = view.ctx?.gaze?.block;
  for (const n of job.needs) {
    if (n.kind === 'count') inputs.push(slider('n', 'Anzahl', n.min, n.max, n.step, n.initial));
    else if (n.kind === 'radius') inputs.push(slider('radius', 'Radius', n.min, n.max, 1, n.initial));
    else if (n.kind === 'block' && preset.block === undefined) inputs.push(...nameSelect('block', 'Block', BLOCKS, gazed && /^[a-z_]{1,48}$/.test(gazed) ? gazed : null));
    else if (n.kind === 'item') inputs.push(...nameSelect('item', 'Item', job.type === 'craft' ? CRAFTS : job.type === 'smelt' ? SMELTS : ITEMS, null));
    else if (n.kind === 'where' && preset.x === undefined) inputs.push(...targetSelect(view, n));
    else if (n.kind === 'chest') inputs.push(...chestSelect(view));
    else if (n.kind === 'rotation') inputs.push(select('rotation', 'Drehung', [0, 90, 180, 270].map((r) => [String(r), r + '°']), '0'));
    else if (n.kind === 'schematic') {
      if (view.schematics?.length) inputs.push(select('file', 'Bauplan', view.schematics.slice(0, 40).map((f) => [f, f]), view.schematics[0]));
      else notes.push('Keine Baupläne gefunden');
    } else if (n.kind === 'zone') {
      const zs = placesOf(view, (p) => p.kind === n.place && p.box);
      if (zs.length) inputs.push(select('zone', n.place === 'wheat' ? 'Feld' : 'Fläche', zs.map((p) => [p.name, p.name]), zs[0].name));
      else notes.push('Dafür ist im Dashboard noch keine Zone eingetragen');
    }
  }
  const names = mine(view).map((s) => s.name);
  inputs.push(select('who', 'Wer', [['frei', 'Erster freier Bot'], ['alle', 'Alle meine Bots'], ...names.map((x) => [x, x])], sc.bot && names.includes(sc.bot) ? sc.bot : 'frei'),
    select('when', 'Wann', [['next', 'Danach'], ['now', 'Jetzt (ersetzt die Arbeit)']], 'next'));
  return {inputs, notes};
}

function auftrag(view, sc) {
  const g = view.ctx?.gaze, sel = view.sel || {}, size = dims(sel);
  const body = [line(txt(g ? `Du schaust auf: ${safe(germanName(g.block), 30)} (${g.x} ${g.y} ${g.z})` : 'Du schaust auf nichts', 'white'))];
  if (size) body.push(line(txt(`Bereich: ${size.join(' x ')}`, 'aqua')));
  else if (sel.a) body.push(line(txt(`Ecke A: ${sel.a.x} ${sel.a.y} ${sel.a.z} · Ecke B fehlt noch`, 'aqua')));
  body.push(...flashLine(view.flash));
  const withBot = (extra) => ({...extra, ...(sc.bot ? {bot: sc.bot} : {})});
  const actions = contextJobs(g).map(({key, preset}) => button(txt(JOBS[key].here || JOBS[key].label, 'gold'), 'job', withBot({key, ...preset})));
  actions.push(button(txt(sel.a ? (sel.b ? 'Ecke B neu setzen' : 'Ecke B setzen') : 'Ecke A setzen', 'aqua'), 'corner', {which: sel.a ? 'b' : 'a'}));
  if (sel.a) actions.push(button(txt('Auswahl löschen', 'aqua'), 'clearsel'));
  for (const {key, ok, why} of areaJobs(sel)) {
    actions.push(ok ? button(txt(JOBS[key].label, 'aqua'), 'job', withBot({key}))
      : {label: txt(JOBS[key].label, 'dark_gray'), width: 200, tooltip: lines([[why, 'red']])}); // no action: the client shows it disabled
  }
  for (const [key, job] of Object.entries(JOBS)) if (job.general) actions.push(button(txt(job.label, 'white'), 'job', withBot({key})));
  actions.push(button(txt('Zurück'), 'lage'));
  return dialog('Neuer Auftrag', body, actions, CLOSE);
}

function jobScreen(view, sc) {
  const job = JOBS[sc.key];
  if (!job) return auftrag(view, sc);
  const preset = sc.preset || {}, {inputs, notes} = inputsOf(job, view, sc);
  const body = [line(txt(job.label, 'white'))];
  if (preset.block !== undefined) body.push(line(txt('Block: ', 'gray'), txt(safe(germanName(preset.block), 30))));
  if (preset.x !== undefined) body.push(line(txt('Ziel: ', 'gray'), txt(`${preset.x} ${preset.y} ${preset.z}`)));
  body.push(...notes.map((n) => line(txt(n, 'red'))), ...flashLine(view.flash));
  const send = {label: txt('Senden', 'green'), width: 200, action: {type: 'minecraft:dynamic/custom', id: 'botui:do', additions: {a: 'send', key: sc.key, ...preset, ...(sc.bot ? {bot: sc.bot} : {})}}};
  return dialog(job.label, body, [send, button(txt('Zurück'), 'new', sc.bot ? {bot: sc.bot} : {})], CLOSE, 2, inputs);
}

// A screen is {name, ...}; unknown names fall back to the Lagebild so a stale state never breaks a viewer.
const SCREENS = {lage, bot: (v, sc) => bot(v, sc.bot), stopall: confirmStop, auftrag, job: jobScreen};
const REFRESHING = new Set(['lage', 'bot']);
const render = (screen, view) => (SCREENS[screen.name] || lage)(view, screen);

module.exports = {safe, explain, lage, bot, confirmStop, render, REFRESHING, QUICK};
