'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {rotate} = require('./archive');
const UUID_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const uuid = (s) => typeof s === 'string' && UUID_RE.test(s) ? s.replace(/-/g, '').toLowerCase() : null;
const ROLES = new Set(['helfer', 'sammler', 'farmer', 'wache']);
const HELP = 'kenne ich nicht: komm folge stopp wache hol <n> <block> gib status rolle ecke abbau bau <name> hilfe';
const HELP2 = 'laut leise queue [weg|erst n] alles stopp jetzt <x> kiste lagern behalte <n> <x> handel sticks';

// Mineflayer 4.39 emits message(msg, 'chat', sender UUID, verified) for playerChat, including
// msg_command_incoming: translate=commands.message.display.incoming, with=[sender, content].
// That incoming type is delivered to this recipient; outgoing whispers have a different translation.
// systemChat has no sender. verified is signature status, not identity (offline/proxy chat may lack it).
const isOwnerMessage = ({sender, position, verified}, ownerUuids) => position === 'chat' && !!uuid(sender) && ownerUuids.some((u) => uuid(u) === uuid(sender));

function parseOrder(text, botName, {whisper = false} = {}) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (whisper) return {all: false, words};
  const head = words.shift()?.toLowerCase();
  return head === botName.toLowerCase() || head === 'alle' ? {all: head === 'alle', words} : null;
}

function translate(words, {owner, ownerPos}) {
  const w = words.map((s) => s.toLowerCase()), [cmd, arg, block] = w;
  if (w.length === 1) {
    if (cmd === 'komm' || cmd === 'folge') return {type: cmd === 'komm' ? 'come' : 'follow', args: {player: owner}};
    if (['stopp', 'bleib', 'fertig', 'cancel'].includes(cmd)) return {stop: true};
    if (cmd === 'status') return {status: true};
    if (cmd === 'hilfe') return {help: true};
    if (cmd === 'laut' || cmd === 'leise') return {verbose: cmd === 'laut'};
    if (cmd === 'queue' || cmd === 'liste') return {queue: 'list'};
    if (cmd === 'clear') return {stopAll: true};
    if (cmd === 'kiste') return {chest: 'look'};
    if (cmd === 'lagern') return {type: 'deposit', args: {own: true}};
    if (cmd === 'wache') return {type: 'guard', args: {player: owner, radius: 16}};
    if (cmd === 'gib') return {type: 'give', args: {player: owner}};
    // Misa's building words (misa.js): the runner resolves them where it can see the player and the world.
    if (cmd === 'ecke') return {corner: true};
    if (cmd === 'abbau') return {clear: true};
  }
  if ((w.length === 2 || w.length === 3) && cmd === 'bau' && /^[\w.-]{1,64}$/.test(words[1]) && (w.length === 2 || ['90', '180', '270'].includes(w[2]))) return {build: {name: words[1], rotation: +(w[2] || 0)}};
  if (w.length === 2 && cmd === 'rolle' && ROLES.has(arg)) return {role: arg};
  if (w.length === 2 && cmd === 'wache' && arg === 'hier' && ownerPos && ['x', 'y', 'z'].every((k) => Number.isFinite(ownerPos[k]))) {
    return {type: 'guard', args: {...Object.fromEntries(['x', 'y', 'z'].map((k) => [k, Math.floor(ownerPos[k])])), radius: 16}};
  }
  const blocks = {eisen: 'iron_ore', kohle: 'coal_ore', stein: 'stone'};
  if (w.length === 3 && (cmd === 'hol' || cmd === 'farm') && /^\d+$/.test(arg) && +arg >= 1 && +arg <= 4096 && /^[a-z_]{1,48}$/.test(block)) {
    return block === 'holz' ? {type: 'chop', args: {count: +arg}} : {type: 'mine', args: {block: Object.hasOwn(blocks, block) ? blocks[block] : block, count: +arg}};
  }
  if (w.length === 2 && cmd === 'alles' && arg === 'stopp') return {stopAll: true};
  if (w.length === 2 && cmd === 'verbose' && (arg === 'on' || arg === 'off')) return {verbose: arg === 'on'};
  if (w.length === 3 && cmd === 'queue' && (arg === 'weg' || arg === 'remove' || arg === 'erst' || arg === 'first') && /^\d{1,2}$/.test(block) && +block >= 1) return {queue: {[arg === 'weg' || arg === 'remove' ? 'remove' : 'first']: +block}};
  if (w.length > 1 && cmd === 'jetzt') { const now = translate(words.slice(1), {owner, ownerPos}); return now.type ? {now} : {unknown: true}; }
  if (w.length === 4 && cmd === 'kiste' && w.slice(1).every((s) => /^-?\d{1,8}$/.test(s))) return {chest: {x: +arg, y: +block, z: +w[3]}};
  if (w.length === 3 && cmd === 'behalte' && /^[a-z_]{1,48}$/.test(block) && (arg === 'nichts' || (/^\d{1,4}$/.test(arg) && +arg <= 4096))) return {keep: {item: block, count: arg === 'nichts' ? 0 : +arg}};
  if ((w.length === 2 || w.length === 3) && cmd === 'handel' && (arg === 'sticks' || arg === 'stick')) {
    const m = /^(\d{1,4})([hm])$/.exec(block || '');
    if (w.length === 2) return {type: 'trade', args: {item: 'stick'}};
    if (m && +m[1] >= 1) return {type: 'trade', args: {item: 'stick', minutes: +m[1] * (m[2] === 'h' ? 60 : 1)}};
    if (/^\d{1,6}$/.test(block) && +block >= 1) return {type: 'trade', args: {item: 'stick', target: +block}};
  }
  return {unknown: true};
}

// One line per gap. Default: the newest line replaces the one still waiting. queue: every line goes out in order
// (a start and an end report must both arrive); more than 8 waiting drops the oldest.
function makeSayer(send, {gapMs = 2000, max = 100, queue = false} = {}) {
  let last = -Infinity, waiting = [], timer = null;
  const arm = () => {
    const wait = gapMs - (Date.now() - last);
    if (wait <= 0) flush();
    else { timer = setTimeout(flush, wait); timer.unref?.(); }
  };
  const flush = () => {
    timer = null;
    last = Date.now();
    send(waiting.shift());
    if (waiting.length) arm();
  };
  return (text) => {
    const line = String(text).replace(/[\r\n]+/g, ' ').slice(0, max);
    if (queue) { waiting.push(line); if (waiting.length > 8) waiting.shift(); } else waiting = [line];
    if (!timer) arm();
  };
}

const BLOCK_WORDS = {iron_ore: 'eisen', coal_ore: 'kohle', stone: 'stein'};
const WORDS = {come: 'komm', follow: 'folge', guard: 'wache', give: 'gib', deposit: 'lagern', clear: 'abbau'};
// What a player hears of a job; fallback is the English label for types without a word.
function chatLabel(job, fallback = job.type) {
  const a = job.args || {};
  if (job.type === 'mine') return `hol ${a.count} ${BLOCK_WORDS[a.block] ?? a.block}`;
  if (job.type === 'chop') return `hol ${a.count} holz`;
  if (job.type === 'schematic') return `bau ${String(a.file).replace(/\.litematic$/i, '')}`;
  if (job.type === 'trade') return ['handel sticks', a.minutes && `${a.minutes}min`, a.target].filter(Boolean).join(' ');
  return WORDS[job.type] ?? String(fallback).trim();
}

// First match wins; the texts are the throws in bots.js, build.js.
const REASONS = [
  [/^bot (?:is|went) offline/, () => 'Bot ist offline'],
  [/^no path to (.+)/, (m) => `kein Weg zu ${m[1]}`],
  [/^inventory still full/, () => 'Inventar voll, Kiste auch'],
  [/^no chest at (\S+ \S+ \S+)/, (m) => `keine Kiste bei ${m[1]}`],
  [/^no chests within/, () => 'keine Kiste in der Nähe'],
  [/^no pickaxe for (\S+)/, (m) => `keine Spitzhacke für ${m[1]}`],
  [/^needs a tool that can harvest ([^:\s]+)/, (m) => `kein Werkzeug für ${m[1]}`],
  [/^no free (\S+) within/, (m) => `kein ${m[1]} in Reichweite`],
  [/is inside a protected area$/, () => 'liegt im Schutzgebiet'],
  [/is not visible and not on the map/, () => 'Spieler nicht zu finden'],
  [/^unknown block: (.+)/, (m) => `unbekannter Block: ${m[1]}`],
  [/^no torches available/, () => 'keine Fackeln'],
  [/^inventory full: no room for the emeralds/, () => 'Inventar voll, kein Platz für Smaragde'],
  [/^no room for the emeralds/, () => 'kein Platz für die Smaragde'],
  [/^inventory full and no supply chest/, () => 'Inventar voll, keine Kiste'],
];
function germanReason(text) {
  for (const [re, say] of REASONS) { const m = re.exec(text); if (m) return say(m); }
  return text;
}

function makeDemoLog(file, {maxBytes = 10 * 1024 * 1024} = {}) {
  if (!file) return {add: () => null, outcome: () => {}};
  const append = (line) => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.appendFileSync(file, JSON.stringify(line) + '\n', {mode: 0o600});
    if (fs.statSync(file).size > maxBytes) rotate(file); // the older FILE.1 is kept (archive.js)
  };
  return {
    add(entry) { const id = randomUUID(); append({...entry, id, t: new Date().toISOString(), outcome: null}); return id; },
    outcome(id, result, text) { append({id, outcome: {t: new Date().toISOString(), result, text}}); },
  };
}

function loadRole(file, name) {
  try { const role = JSON.parse(fs.readFileSync(file, 'utf8'))[name]; if (ROLES.has(role)) return role; } catch {}
  return {bot1: 'helfer', bot2: 'sammler', bot3: 'farmer'}[name] || 'helfer';
}
function saveRole(file, name, role) {
  if (!file) return;
  let roles = {};
  try { roles = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({...roles, [name]: role}), {mode: 0o600});
  fs.renameSync(`${file}.tmp`, file);
}

module.exports = {isOwnerMessage, parseOrder, translate, makeSayer, chatLabel, germanReason, makeDemoLog, loadRole, saveRole, UUID_RE, HELP, HELP2};
