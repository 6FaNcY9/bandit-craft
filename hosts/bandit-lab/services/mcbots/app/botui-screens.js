'use strict';
// Pure builders for the in-game dialogs (Minecraft dialog JSON, multi_action). No I/O and no clock: the same view must
// build the same JSON, because BotUi re-sends a refreshing screen only when its JSON changed.

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

function flashLine(flash) {
  return flash ? [line(txt(`${flash.ok ? '✔' : '✖'} ${safe(flash.text, 90)}`, flash.ok ? 'green' : 'red'))] : [];
}

function confirmStop() {
  return dialog('Alle stoppen?', [line(txt('Alle Bots anhalten und die Daueraufträge ausschalten?', 'white'))],
    [button(txt('Ja, alle stoppen', 'red'), 'stopall_ok')], {label: 'Abbrechen', a: 'ov'}, 1);
}

// Number inputs are the only reason a dialog survives.
const field = (type, key, label, extra) => ({type: 'minecraft:' + type, key, label: txt(label), width: 200, ...extra});
const slider = (key, label, min, max, step, initial) => field('number_range', key, label, {start: min, end: max, step, initial});

// --- Ziele: the owner's keeper quota sliders (numbers need a dialog); toggles, sidebar and trader chests are the zielm menu
function ziele(view) {
  const body = [], actions = [], inputs = [];
  if (view.owner) {
    let k = null;
    try { k = view.keeper?.state(); } catch { /* shown as not configured */ }
    for (const q of k?.configured || k?.quotas || []) {
      const end = Math.min(4096, Math.max(64, q.want * 4));
      inputs.push(slider('want_' + q.item, `${safe(q.item, 24)}${q.have !== null ? ' (da: ' + q.have + ')' : ''}`, 0, end, 1, Math.min(end, q.want)));
    }
    if (inputs.length) body.push(line(txt('Ziele pro Rohstoff in der Vorratskiste', 'white')));
  }
  body.push(...flashLine(view.flash));
  if (inputs.length) actions.push({label: txt('Speichern', 'green'), width: 200, action: {type: 'minecraft:dynamic/custom', id: 'botui:do', additions: {a: 'saveziele'}}});
  actions.push(button(txt('Zurück'), 'zielm'));
  return dialog('Ziele', body, actions, CLOSE, 2, inputs);
}

// The one-time upload link as a browser button; the URL carries the token, so it is shown nowhere else.
function upload(view, sc) {
  const body = [line(txt('Öffne die Seite, wähle deine .litematic-Datei aus Litematica (config/litematica/schematics) und lade sie hoch.', 'white')), line(txt('Der Link gilt 10 Minuten und nur für dich.', 'gray')), ...flashLine(view.flash)];
  return dialog('Bauplan hochladen', body, [{label: txt('Seite öffnen', 'aqua'), width: 200, action: {type: 'minecraft:open_url', url: String(sc.url)}}], {label: 'Zurück', a: 'ov'});
}

// The dialogs left: everything else is a menu (botui-menus.js). BotUi sends any other name to the overview.
const SCREENS = {upload, stopall: confirmStop, ziele};
const REFRESHING = new Set(['ov', 'botm', 'kartem', 'zielm']);
const render = (screen, view) => {
  if (!Object.hasOwn(SCREENS, screen.name)) throw new Error('unbekannter Bildschirm: ' + screen.name);
  return SCREENS[screen.name](view, screen);
};

module.exports = {safe, explain, ziele, confirmStop, render, REFRESHING, DIALOGS: new Set(Object.keys(SCREENS))};
