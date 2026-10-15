'use strict';
// Append-only JSONL for later evaluation and training (owner 2026-10-15: keep all bot and LLM data). A full
// FILE becomes FILE.1 and the FILE.1 before it is kept as FILE.<ms> instead of being overwritten, so readers
// of FILE and FILE.1 keep working and nothing is thrown away.
// ponytail: never deleted, never compressed (the lab has terabytes free); gzip the stamped files if that changes.
const fs = require('node:fs');
const path = require('node:path');

function rotate(file, now = Date.now()) {
  try { fs.renameSync(`${file}.1`, `${file}.${now}`); } catch {} // no FILE.1 yet
  fs.renameSync(file, `${file}.1`);
}

function append(file, record, {maxBytes = 50e6, mode = 0o600} = {}) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.appendFileSync(file, JSON.stringify(record) + '\n', {mode});
  if (fs.statSync(file).size > maxBytes) rotate(file);
}

// Files GET /api/archive/<name> may serve: the bot events and states, current or rotated.
const ARCHIVE_NAME = /^(events|states)\.jsonl(\.\d{1,13})?$/;

module.exports = {rotate, append, ARCHIVE_NAME};
