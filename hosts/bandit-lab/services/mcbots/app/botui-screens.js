'use strict';
// Pure builders for the in-game dialogs (Minecraft dialog JSON, multi_action). No I/O and no clock: the same view must
// build the same JSON, because BotUi re-sends a refreshing screen only when its JSON changed.
const {CHOICES, choiceOf} = require('./idle');
const {ago, DIMENSION, failing, botState} = require('./ingame');
const {isChest, mayOrder, JOBS, BLOCKS, ITEMS, CRAFTS, SMELTS, germanName, contextJobs, areaJobs, dims, supplyOf} = require('./botui-jobs');

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
  if (/no progress for \d+ s/.test(e)) return 'kommt nicht voran';
  if (/^kicked: /.test(e)) return /too fast|throttl/i.test(e) ? 'zu schnell angemeldet, neuer Versuch' : `vom Server geworfen${(m = /"text":"([^"]+)"/.exec(e)) ? ': ' + m[1] : ''}`;
  return e;
}

const COLOR = {work: 'green', idle: 'gray', error: 'red', dead: 'red', offline: 'dark_gray', sheltered: 'aqua'};
const STATE_WORD = {work: 'arbeitet', idle: 'frei', error: 'Problem', dead: 'tot', offline: 'offline', sheltered: 'im Unterschlupf'};
const mine = (view) => view.snaps.filter((s) => view.allowed === '*' || view.allowed.includes(s.name));
const ELSEWHERE = 'In der Sandbox, nicht in deiner Welt';
const inWorldFirst = (snaps) => [...snaps.filter((s) => !s.sandbox), ...snaps.filter((s) => s.sandbox)];
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

// A job's raw label is "schematic x.litematic at -190 -12 -108 0 none ...": on a button only its name and what it works on.
const JOB_NAME = {...Object.fromEntries(Object.entries(JOBS).filter(([k, j]) => k === j.type).map(([k, j]) => [k, j.label])), trade: 'Handel', highway: 'Straße'};
const JOB_OBJECT = new Set(['mine', 'shift', 'get', 'withdraw', 'craft', 'smelt', 'schematic']);
function jobName(job) {
  const name = JOB_NAME[job.type];
  if (!name) return safe(job.label);
  const what = JOB_OBJECT.has(job.type) && String(job.label).split(' ')[1];
  return what ? `${name} ${safe(germanName(what.replace(/\.litematic$/, '')))}` : name;
}

// "Baumfarm 5/64 · 12 min" or the plain state word.
function jobText(s, state) {
  if (!s.job) return STATE_WORD[state];
  const mins = typeof s.job.runningS === 'number' && s.job.runningS >= 60 ? ` · ${ago(s.job.runningS)}` : '';
  return jobName(s.job) + (s.job.progress ? ' ' + safe(s.job.progress, 12) : '') + mins;
}

function tooltip(s, state) {
  const out = [[`${STATE_WORD[state]}${s.job ? ': ' + jobText(s, state) : ''}`, COLOR[state]]];
  if (s.sandbox) out.push([ELSEWHERE, 'yellow']);
  if (s.activity) out.push([activityText(s.activity)]);
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
    return line(txt(`${safe(s.name, 16)}${s.sandbox ? ' (Sandbox)' : ''}: ${cause}${s.job ? `, ${safe(jobName(s.job), 20)} steht` : ''}${when}`, 'red'));
  });
}

function flashLine(flash) {
  return flash ? [line(txt(`${flash.ok ? '✔' : '✖'} ${safe(flash.text, 90)}`, flash.ok ? 'green' : 'red'))] : [];
}

function lage(view) {
  const snaps = inWorldFirst(mine(view)), states = snaps.map(botState);
  const here = snaps.filter((s) => !s.sandbox), away = snaps.length - here.length, hereStates = here.map(botState);
  const online = here.find((s) => s.online && typeof s.isDay === 'boolean');
  let need = null;
  try {
    const k = view.owner ? view.keeper?.state() : null; // the stock of the owner's base is the owner's
    if (k?.available) {
      const short = k.quotas.filter((q) => q.have !== null && q.have < q.want);
      const at = away ? ' (Sandbox)' : ''; // the keeper skips guests and MAIN_BOTS, so with helpers in the sandbox its numbers come from there
      need = short.length ? `Bedarf${at}: ` + short.slice(0, 3).map((q) => `${safe(q.item, 24)} ${q.have}/${q.want}`).join(', ') + (short.length > 3 ? ` +${short.length - 3}` : '') : `Alles auf Lager${at}`;
    }
  } catch { /* a keeper that cannot say is no reason to lose the screen */ }
  const body = [
    line(txt(`${here.length} Bots · ${hereStates.filter((x) => x === 'work').length} arbeiten · ${hereStates.filter((x) => x === 'idle').length} frei${away ? ` · ${away} in der Sandbox` : ''}${online ? ' · ' + (online.isDay ? 'Tag' : 'Nacht') : ''}`, 'white')),
    ...problems(snaps),
    ...(need ? [line(txt(need, need.startsWith('Alles') ? 'green' : 'yellow'))] : []),
    ...flashLine(view.flash),
  ];
  const actions = snaps.map((s, i) => {
    const tag = s.sandbox ? 'Sandbox · ' : '';
    const room = Math.max(8, 32 - safe(s.name, 16).length - tag.length);
    const label = ['', txt('● ', COLOR[states[i]]), txt(safe(s.name, 16) + '  '), txt(tag + safe(jobText(s, states[i]), room), 'gray')];
    return button(label, 'bot', {bot: s.name}, tooltip(s, states[i]));
  });
  const g = view.ctx?.gaze;
  actions.push(button(txt(g ? `Auftrag: ${safe(germanName(g.block), 24)} ▸` : 'Neuer Auftrag', 'aqua'), 'new'), button(txt('Ziele'), 'ziele'), button(txt('Karte'), 'karte'));
  if (view.owner) actions.push(button(txt('Alle stopp', 'red'), 'stopall'));
  actions.push(button(txt('Bauplan hochladen'), 'upload'));
  actions.push({label: txt('Zauberstab holen'), width: 200, action: {type: 'minecraft:run_command', command: '/zauberstab'}});
  return dialog('Kommandostand', body, actions, CLOSE);
}

const QUICK = [['deposit', 'Einlagern'], ['rearm', 'Ausrüsten'], ['homebed', 'Heim'], ['graves', 'Gräber holen']];

// The bot's own activity text; a bot parked on a missing resource says what it waits for.
const activityText = (a) => a.replace(/^waiting: /, 'wartet auf: ');

function bot(view, name) {
  const s = mine(view).find((x) => x.name === name);
  if (!s) return dialog(safe(name, 16), [line(txt('Bot nicht gefunden', 'red')), ...flashLine(view.flash)], [], {label: 'Zur Übersicht', a: 'lage'});
  const state = botState(s), n = safe(s.name, 16);
  const body = [line(txt('● ', COLOR[state]), txt(`${STATE_WORD[state]}${s.job ? ': ' + jobText(s, state) : ''}`, 'white'))];
  if (s.sandbox) body.push(line(txt(ELSEWHERE, 'yellow')));
  if (s.activity) body.push(line(txt(safe(activityText(s.activity), 80))));
  if (s.queue?.length) body.push(line(txt('Danach: ', 'gray'), txt(safe(s.queue.slice(0, 3).join(', '), 70) + (s.queue.length > 3 ? ` +${s.queue.length - 3}` : ''))));
  if (s.online) {
    const worn = Array.isArray(s.armour) ? s.armour.filter(Boolean).length : 0;
    body.push(line(txt(`Leben ${Math.round(s.health)} · Essen ${Math.round(s.food)} · Rüstung ${worn}/4 · frei ${s.freeSlots}`)));
    if (s.tool) body.push(line(txt(safe(`${s.tool.name}${s.tool.max ? ` ${s.tool.left}/${s.tool.max}` : ''}`, 60), 'gray')));
    if (s.inventory?.length) body.push(line(txt('Inventar: ', 'gray'), txt(safe(s.inventory.slice(0, 8).join(', '), 150))));
    if (s.pos) body.push(line(txt(`Position ${s.pos.join(' ')} ${DIMENSION[s.dimension] || ''}`.trim(), 'gray')));
  }
  if (s.moves) body.push(line(txt(`Wege/h: ${s.moves.pullbacks} Rücksetzer · ${s.moves.noPath} kein Weg · ${s.moves.stalls} fest`, 'gray')));
  body.push(line(txt(s.chest ? `Kiste: ${s.chest.x} ${s.chest.y} ${s.chest.z}` : 'Kiste: keine – Zauberstab auf eine Kiste', 'gray')));
  if (failing(s) && s.lastError) body.push(line(txt(safe(explain(s.lastError), 80), 'red')));
  body.push(...flashLine(view.flash));
  const cur = view.idle?.get(s.name), curLabel = cur && choiceOf(cur.id)?.label;
  const actions = [button(txt('Stopp', 'red'), 'stop', {bot: s.name}), button(txt('Auftrag für ' + n, 'aqua'), 'new', {bot: s.name}),
    button(txt(`Wenn frei: ${safe(curLabel || 'Nichts', 30)}`, 'yellow'), 'idle_open', {bot: s.name}),
    ...QUICK.filter(([job]) => mayOrder(view.allowed, job)).map(([job, label]) => button(txt(label), 'quick', {bot: s.name, job}))];
  return dialog(n, body, actions, {label: 'Zur Übersicht', a: 'lage'});
}

// "Wenn frei": what the bot does by itself once it has been idle a while. The keeper choice is the owner's own bots only.
function wennfrei(view, sc) {
  const s = mine(view).find((x) => x.name === sc.bot), n = safe(sc.bot, 16);
  if (!s) return dialog(n, [line(txt('Bot nicht gefunden', 'red')), ...flashLine(view.flash)], [], {label: 'Zur Übersicht', a: 'lage'});
  const cur = view.idle?.get(s.name)?.id;
  const mark = (on) => (on ? 'green' : 'white');
  const actions = [...CHOICES.filter((c) => c.id !== 'keeper' || !s.guest).map((c) => button(txt(c.label, mark(c.id === cur)), 'idle_set', {bot: s.name, choice: c.id})),
    button(txt('Nichts', mark(!cur)), 'idle_set', {bot: s.name, choice: 'none'}), button(txt('Zurück'), 'bot', {bot: s.name})];
  return dialog(`${n}: wenn frei`, [line(txt('Was soll der Bot tun, wenn er eine Weile frei ist?', 'white')), ...flashLine(view.flash)], actions, CLOSE);
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
  const bots = inWorldFirst(mine(view)), names = bots.map((s) => s.name);
  inputs.push(select('who', 'Wer', [['frei', 'Erster freier Bot'], ['alle', 'Alle meine Bots'], ...bots.map((s) => [s.name, s.sandbox ? `${s.name} (Sandbox)` : s.name])], sc.bot && names.includes(sc.bot) ? sc.bot : 'frei'),
    select('when', 'Wann', [['next', 'Danach'], ['now', 'Jetzt (ersetzt die Arbeit)']], 'next'));
  return {inputs, notes};
}

// The trader bots this viewer may command.
const traders = (view) => (view.traders || []).filter((t) => view.allowed === '*' || view.allowed.includes(t));

function auftrag(view, sc) {
  const g = view.ctx?.gaze, sel = view.sel || {}, size = dims(sel);
  const body = [line(txt(g ? `Du schaust auf: ${safe(germanName(g.block), 30)} (${g.x} ${g.y} ${g.z})` : 'Du schaust auf nichts', 'white'))];
  if (size) body.push(line(txt(`Bereich: ${size.join(' x ')}`, 'aqua')));
  else if (sel.a) body.push(line(txt(`Ecke A: ${sel.a.x} ${sel.a.y} ${sel.a.z} · Ecke B fehlt noch`, 'aqua')));
  body.push(...flashLine(view.flash));
  const withBot = (extra) => ({...extra, ...(sc.bot ? {bot: sc.bot} : {})});
  const rows = contextJobs(g, view.allowed, view.viewer, mine(view).map((s) => s.name));
  const actions = rows.map(({key, preset}) => key === 'botscreen' ? button(txt(`${safe(preset.bot, 16)} ▸`, 'aqua'), 'botscreen', {bot: preset.bot})
    : button(txt(JOBS[key].here || JOBS[key].label, 'gold'), 'job', withBot({key, ...preset})));
  if (g && isChest(g.block)) for (const t of traders(view)) for (const [kind, label] of [['sticks', 'Sticks'], ['stores', 'Smaragde']]) actions.push(button(txt(`Handelskiste ${label} → ${safe(t, 16)}`, 'gold'), 'trader_add', {bot: t, kind}));
  actions.push(button(txt(sel.a ? (sel.b ? 'Ecke B neu setzen' : 'Ecke B setzen') : 'Ecke A setzen', 'aqua'), 'corner', {which: sel.a ? 'b' : 'a'}));
  if (sel.a) actions.push(button(txt('Auswahl löschen', 'aqua'), 'clearsel'));
  for (const {key, ok, why} of areaJobs(sel)) {
    actions.push(ok ? button(txt(JOBS[key].label, 'aqua'), 'job', withBot({key}))
      : {label: txt(JOBS[key].label, 'dark_gray'), width: 200, tooltip: lines([[why, 'red']])}); // no action: the client shows it disabled
  }
  for (const [key, job] of Object.entries(JOBS)) if (job.general && mayOrder(view.allowed, key) && !rows.some((r) => r.key === key)) actions.push(button(txt(job.label, 'white'), 'job', withBot({key})));
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

// --- Ziele: owner-only keeper, plan and quota sliders; the sidebar and the trader chests of the viewer's bots
function ziele(view) {
  const body = [], actions = [], inputs = [];
  let k = null;
  if (view.owner) {
    try { k = view.keeper?.state(); } catch { /* shown as not configured */ }
    const toggle = (label, enabled, a) => button(txt(`${label}: ${enabled ? 'an' : 'aus'}`, enabled ? 'green' : 'gray'), a, {on: enabled ? 0 : 1}, lines([[enabled ? 'Klick schaltet aus' : 'Klick schaltet ein']]));
    if (k?.available) actions.push(toggle('Daueraufträge', k.enabled, 'keeper'));
    if (view.plan) actions.push(toggle('Plan', !!view.plan.enabled, 'plan'));
    // Always the configured quotas: while the plan borrows the keeper, state().quotas are the plan's.
    for (const q of k?.configured || k?.quotas || []) {
      const end = Math.min(4096, Math.max(64, q.want * 4));
      inputs.push(slider('want_' + q.item, `${safe(q.item, 24)}${q.have !== null ? ' (da: ' + q.have + ')' : ''}`, 0, end, 1, Math.min(end, q.want)));
    }
    if (inputs.length) body.push(line(txt('Ziele pro Rohstoff in der Vorratskiste', 'white')));
    if (k?.borrowed) body.push(line(txt('Der Plan nutzt die Daueraufträge gerade; neue Zahlen gelten danach.', 'yellow')));
    if (k?.available && view.snaps.some((s) => s.sandbox)) body.push(line(txt('Daueraufträge laufen in der Sandbox, nicht in deiner Welt', 'yellow')));
  }
  actions.push(button(txt('Seitenleiste an'), 'sidebar', {on: 1}), button(txt('Seitenleiste aus'), 'sidebar', {on: 0}));
  for (const t of traders(view)) {
    const own = view.traderChests?.list(t) || {};
    for (const [kind, label] of [['sticks', 'Sticks'], ['stores', 'Smaragde']]) {
      for (const c of own[kind] || []) actions.push(button(txt(`✖ ${safe(t, 16)} ${label} ${c.x} ${c.y} ${c.z}`, 'red'), 'trader_del', {bot: t, kind, x: c.x, y: c.y, z: c.z}, lines([['Handelskiste entfernen']])));
    }
  }
  body.push(...flashLine(view.flash));
  if (inputs.length) actions.push({label: txt('Speichern', 'green'), width: 200, action: {type: 'minecraft:dynamic/custom', id: 'botui:do', additions: {a: 'saveziele'}}});
  actions.push(button(txt('Zurück'), 'lage'));
  return dialog('Ziele', body, actions, CLOSE, 2, inputs);
}

// --- Karte: zoom and centre of the map item. An input screen (never refreshes), so the buttons stay where the player aims.
const ZOOMS = [1, 2, 5, 10, 25, 50];
function karte(view) {
  const ms = view.mapState || {zoom: 5, center: null};
  const body = [line(txt(`${ms.zoom} ${ms.zoom === 1 ? 'Block' : 'Blöcke'} pro Pixel · Mitte: ${ms.center ? safe(ms.center, 16) : 'du'}`, 'white')), ...flashLine(view.flash)];
  const mark = (on) => (on ? 'green' : 'white');
  const actions = [...ZOOMS.map((z) => button(txt(`${z} ${z === 1 ? 'Block' : 'Blöcke'} pro Pixel`, mark(z === ms.zoom)), 'zoom', {z})),
    button(txt('Mitte: ich', mark(!ms.center)), 'center', {me: 1}),
    ...mine(view).filter((s) => !s.sandbox).map((s) => button(txt(`Mitte: ${safe(s.name, 16)}`, mark(ms.center === s.name)), 'center', {bot: s.name})),
    button(txt('Zurück'), 'lage')];
  return dialog('Bot-Karte', body, actions, CLOSE);
}

// A screen is {name, ...}; unknown names fall back to the Lagebild so a stale state never breaks a viewer.
// The one-time upload link as a browser button; the URL carries the token, so it is shown nowhere else.
function upload(view, sc) {
  const body = [line(txt('Öffne die Seite, wähle deine .litematic-Datei aus Litematica (config/litematica/schematics) und lade sie hoch.', 'white')), line(txt('Der Link gilt 10 Minuten und nur für dich.', 'gray')), ...flashLine(view.flash)];
  return dialog('Bauplan hochladen', body, [{label: txt('Seite öffnen', 'aqua'), width: 200, action: {type: 'minecraft:open_url', url: String(sc.url)}}], {label: 'Zurück', a: 'lage'});
}

const SCREENS = {lage, upload, bot: (v, sc) => bot(v, sc.bot), wennfrei, stopall: confirmStop, auftrag, job: jobScreen, ziele, karte};
const REFRESHING = new Set(['lage', 'bot', 'ov']);
const render = (screen, view) => (SCREENS[screen.name] || lage)(view, screen);

module.exports = {safe, explain, ziele, lage, bot, confirmStop, render, REFRESHING, QUICK, ZOOMS};
