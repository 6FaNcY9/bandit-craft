'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {rotate} = require('./archive');
const UUID_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const uuid = (s) => typeof s === 'string' && UUID_RE.test(s) ? s.replace(/-/g, '').toLowerCase() : null;
const ROLES = new Set(['helfer', 'sammler', 'farmer', 'wache']);
const HELP = 'kenne ich nicht: komm, folge, stopp, wache, wache hier, hol <n> <block>, gib, status, rolle <name>';

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
    if (['stopp', 'bleib', 'fertig'].includes(cmd)) return {stop: true};
    if (cmd === 'status') return {status: true};
    if (cmd === 'wache') return {type: 'guard', args: {player: owner, radius: 16}};
    if (cmd === 'gib') return {type: 'give', args: {player: owner}};
  }
  if (w.length === 2 && cmd === 'rolle' && ROLES.has(arg)) return {role: arg};
  if (w.length === 2 && cmd === 'wache' && arg === 'hier' && ownerPos && ['x', 'y', 'z'].every((k) => Number.isFinite(ownerPos[k]))) {
    return {type: 'guard', args: {...Object.fromEntries(['x', 'y', 'z'].map((k) => [k, Math.floor(ownerPos[k])])), radius: 16}};
  }
  const blocks = {eisen: 'iron_ore', kohle: 'coal_ore', stein: 'stone'};
  if (w.length === 3 && cmd === 'hol' && /^\d+$/.test(arg) && +arg >= 1 && +arg <= 256 && /^[a-z_]{1,48}$/.test(block)) {
    return block === 'holz' ? {type: 'chop', args: {count: +arg}} : {type: 'mine', args: {block: Object.hasOwn(blocks, block) ? blocks[block] : block, count: +arg}};
  }
  return {unknown: true};
}

function makeSayer(send, {gapMs = 2000, max = 100} = {}) {
  let last = -Infinity, waiting = null, timer = null;
  const flush = () => {
    timer = null;
    const text = waiting;
    waiting = null;
    last = Date.now();
    send(text);
  };
  return (text) => {
    waiting = String(text).replace(/[\r\n]+/g, ' ').slice(0, max);
    if (timer) return;
    const wait = gapMs - (Date.now() - last);
    if (wait <= 0) flush();
    else { timer = setTimeout(flush, wait); timer.unref?.(); }
  };
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

module.exports = {isOwnerMessage, parseOrder, translate, makeSayer, makeDemoLog, loadRole, saveRole, UUID_RE, HELP};
