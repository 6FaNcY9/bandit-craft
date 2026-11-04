'use strict';
// Pure builders for the in-game dialogs (Minecraft dialog JSON, multi_action). No I/O and no clock: the same view must
// build the same JSON, because BotUi re-sends a refreshing screen only when its JSON changed.
const {ago, DIMENSION, botState} = require('./ingame');

// Anything from a snapshot or an error goes through here: no colour codes or control characters, bounded length.
const safe = (text, max = 60) => {
  const s = String(text ?? '').replace(/§./g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

// Bot error text -> the cause in plain German; unknown text stays as it is (the caller shortens it).
function explain(error) {
  const e = String(error ?? '');
  let m;
  if (/inventory still full/.test(e)) return 'Kiste voll';
  if ((m = /^no free (\w+) within \d+ blocks/.exec(e))) return `nichts zu finden: ${m[1]} in Reichweite`;
  if (/^could not reach/.test(e)) return 'kein Weg dorthin';
  if ((m = /^unsafe: (.*)/.exec(e))) return /water/.test(m[1]) ? 'Wasser daneben, zu gefährlich' : /lava/.test(m[1]) ? 'Lava daneben, zu gefährlich' : e;
  if ((m = /^need (\d+) more (\w+)/.exec(e))) return `${m[1]} ${m[2]} fehlen`;
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

function dialog(title, body, actions, exit, columns = 2) {
  return {type: 'minecraft:multi_action', title: txt(title, 'gold'), body, columns, actions,
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
  actions.push(button(txt('Neuer Auftrag', 'aqua'), 'new'), button(txt('Ziele'), 'ziele'), button(txt('Karte'), 'karte'));
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
  if (typeof s.lastErrorAgoS === 'number' && s.lastErrorAgoS < 300 && s.lastError) body.push(line(txt(safe(explain(s.lastError), 80), 'red')));
  body.push(...flashLine(view.flash));
  const actions = [button(txt('Stopp', 'red'), 'stop', {bot: s.name}), button(txt('Auftrag für ' + n, 'aqua'), 'new', {bot: s.name}),
    ...QUICK.map(([job, label]) => button(txt(label), 'quick', {bot: s.name, job}))];
  return dialog(n, body, actions, {label: 'Zur Übersicht', a: 'lage'});
}

function confirmStop() {
  return dialog('Alle stoppen?', [line(txt('Alle Bots anhalten und die Daueraufträge ausschalten?', 'white'))],
    [button(txt('Ja, alle stoppen', 'red'), 'stopall_ok')], {label: 'Abbrechen', a: 'lage'}, 1);
}

// A screen is {name, ...}; unknown names fall back to the Lagebild so a stale state never breaks a viewer.
const SCREENS = {lage, bot: (v, sc) => bot(v, sc.bot), stopall: confirmStop};
const REFRESHING = new Set(['lage', 'bot']);
const render = (screen, view) => (SCREENS[screen.name] || lage)(view, screen);

module.exports = {safe, explain, lage, bot, confirmStop, render, REFRESHING, QUICK};
