'use strict';
// Per-bot preferences set over chat (chest, keep list, verbose), one JSON file keyed by bot name.
const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = {chest: null, keep: {}, verbose: false};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function clean(p) {
  p = isObj(p) ? p : {};
  const chest = isObj(p.chest) && ['x', 'y', 'z'].every((k) => Number.isInteger(p.chest[k])) ? {x: p.chest.x, y: p.chest.y, z: p.chest.z} : null;
  const keep = isObj(p.keep) ? Object.fromEntries(Object.entries(p.keep).filter(([k, n]) => /^[a-z_]{1,48}$/.test(k) && Number.isInteger(n) && n >= 0 && n <= 4096)) : {};
  return {chest, keep, verbose: p.verbose === true};
}
function read(file) {
  try { const all = JSON.parse(fs.readFileSync(file, 'utf8')); return isObj(all) ? all : {}; } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; return {}; }
}
const loadPrefs = (file, name) => clean(file ? read(file)[name] : null);
function savePrefs(file, name, patch) {
  if (!file) return;
  const all = read(file);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({...all, [name]: {...(isObj(all[name]) ? all[name] : {}), ...patch}}), {mode: 0o600});
  fs.renameSync(`${file}.tmp`, file);
}
module.exports = {loadPrefs, savePrefs, DEFAULTS};
