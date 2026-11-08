'use strict';
// Plan upload by one-time link (Kommandostand "Bauplan hochladen"). /upload is exempt from the Tailscale login
// allowlist (a guest's login is not on it), so the token is the ONLY gate: 32 hex, 10 minutes, one use, bound to
// the player it was issued to; the player of an upload comes from the token, never from the request.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TTL_MS = 10 * 60 * 1000, MAX_BYTES = 2 * 1024 * 1024, MAX_FILES = 50, MAX_CELLS = 3000000; // MAX_CELLS: a link is open to guests, so less than the dashboard's 8 M
const GONE = 'Dieser Link ist ungültig oder abgelaufen. Hol dir im Spiel einen neuen.';
const TOKEN_RE = /^[0-9a-f]{32}$/;

class Uploads {
  constructor({now = Date.now} = {}) { this.now = now; this.tokens = new Map(); this.busy = new Set(); }
  issue(player) {
    for (const [t, v] of this.tokens) if (v.exp <= this.now()) this.tokens.delete(t);
    const token = crypto.randomBytes(16).toString('hex');
    this.tokens.set(token, {player, exp: this.now() + TTL_MS});
    return token;
  }
  // The player a live token belongs to, token kept (a failed upload may retry); null for anything else.
  peek(token) {
    const v = typeof token === 'string' && TOKEN_RE.test(token) ? this.tokens.get(token) : null;
    return v && v.exp > this.now() ? v.player : null;
  }
  take(token) {
    const player = this.peek(token);
    if (player !== null) this.tokens.delete(token);
    return player;
  }
}

// '<player lowercased>-<name>.litematic'; the name is cut so the whole stays within build.js SCHEMATIC_RE (64).
const fileName = (player, name) => {
  const p = String(player).toLowerCase();
  const n = String(name || '').replace(/\.litematic$/i, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, Math.min(40, 53 - p.length));
  return `${p}-${n}.litematic`;
};

// The owner sees everything; anyone else the shared files (no viewer's prefix) and their own.
// `viewers`: every viewer name, to tell a prefixed file from a shared one.
const visible = (files, viewer, owner, viewers = []) => {
  if (owner) return files;
  const own = String(viewer).toLowerCase() + '-';
  const others = viewers.map((v) => String(v).toLowerCase() + '-').filter((p) => p !== own);
  return files.filter((f) => { const l = f.toLowerCase(); return l.startsWith(own) || !others.some((p) => l.startsWith(p)); });
};

// Reads at most max bytes; past that it stops collecting and rejects (the caller answers 413 and closes).
const readLimited = (req, max) => new Promise((resolve, reject) => {
  const parts = [];
  let n = 0, over = false;
  req.on('data', (c) => {
    if (over) return;
    n += c.length;
    if (n > max) { over = true; parts.length = 0; reject(Object.assign(new Error('too large'), {status: 413})); } else parts.push(c);
  });
  req.on('end', () => !over && resolve(Buffer.concat(parts)));
  req.on('error', reject);
});

// GET /upload?t= serves the page, POST /upload?t=&name= takes the raw file. deps: {uploads, dir, parse, page, csp,
// events, say, fileRe, sameOrigin, max}. Only these two routes reach here, before the login check.
async function handle(req, res, url, deps) {
  const reply = (code, type, body, extra = {}) => {
    res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra});
    res.end(body);
  };
  const json = (code, obj, extra) => reply(code, 'application/json', JSON.stringify(obj), extra);
  const token = url.searchParams.get('t');
  if (deps.uploads.peek(token) === null) return req.method === 'GET' ? reply(403, 'text/plain; charset=utf-8', GONE) : json(403, {error: GONE});
  if (req.method === 'GET') return reply(200, 'text/html; charset=utf-8', deps.page, {'Content-Security-Policy': deps.csp});
  if (!deps.sameOrigin(req) || req.headers['content-type'] !== 'application/octet-stream') return json(403, {error: 'Ungültige Anfrage'});
  const max = deps.max ?? MAX_BYTES;
  const tooBig = () => json(413, {error: 'Die Datei ist zu groß (höchstens 2 MB)'}, {Connection: 'close'});
  if (Number(req.headers['content-length']) > max) return tooBig();
  let bytes;
  try { bytes = await readLimited(req, max); } catch (e) {
    if (e.status !== 413) return json(400, {error: 'Upload abgebrochen'});
    tooBig();
    return res.once('finish', () => req.destroy());
  }
  if (deps.uploads.busy.has(token)) return json(409, {error: 'Upload läuft schon'});
  deps.uploads.busy.add(token); // one parse per token at a time; cleared on every exit below
  try { return await store(bytes); } finally { deps.uploads.busy.delete(token); }
  async function store(bytes) {
  let s;
  try { s = await deps.parse(bytes, {maxCells: MAX_CELLS}); } catch (e) { return json(400, {error: /^Bauplan zu groß/.test(e.message) ? e.message : 'Das ist keine gültige .litematic-Datei'}); }
  // Everything from here to the write is synchronous: the token is taken exactly once, and only when the file is storable.
  const player = deps.uploads.peek(token);
  if (player === null) return json(403, {error: GONE});
  const file = fileName(player, url.searchParams.get('name'));
  if (!deps.fileRe.test(file) || file.endsWith('-.litematic')) return json(400, {error: 'Der Dateiname braucht Buchstaben oder Ziffern'});
  const prefix = player.toLowerCase() + '-', target = path.join(deps.dir, file), tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(deps.dir, {recursive: true});
    if (!fs.existsSync(target) && fs.readdirSync(deps.dir).filter((f) => f.startsWith(prefix) && deps.fileRe.test(f)).length >= MAX_FILES) return json(400, {error: `Zu viele Baupläne (${MAX_FILES}) – überschreib einen alten Namen oder frag Bandit`});
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, target);
    deps.uploads.take(token); // synchronous with the check above: single use holds
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    deps.log?.(`upload ${file}: ${e.message}`);
    return json(400, {error: 'Speichern ging schief'});
  }
  deps.events.add('dashboard', 'info', `schematic ${file} uploaded by ${player}`);
  deps.say?.(player, 'Server', `Bauplan bereit: ${file.replace(/\.litematic$/, '')}`);
  return json(200, {file, blocks: s.blocks.length});
  }
}

module.exports = {Uploads, fileName, visible, handle, MAX_BYTES};