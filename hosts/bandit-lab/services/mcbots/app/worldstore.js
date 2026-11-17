'use strict';
// Section store of the world model: opaque section blobs per chunk/section in one SQLite file, each change
// numbered by a growing seq for the change feed. Used inside the world worker only, never on the hub's main loop.
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {SY_MIN, SY_MAX} = require('./worldsection');

const SECTIONS = SY_MAX - SY_MIN + 1;
const buf = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength); // sqlite hands out fresh Uint8Arrays; wrap, do not copy

function openStore(dir) {
  fs.mkdirSync(dir, {recursive: true});
  const db = new DatabaseSync(path.join(dir, 'model.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS sections (
      dim INTEGER NOT NULL DEFAULT 0, cx INTEGER NOT NULL, cz INTEGER NOT NULL, sy INTEGER NOT NULL,
      hash BLOB NOT NULL, blob BLOB NOT NULL, seq INTEGER NOT NULL,
      PRIMARY KEY (dim, cx, cz, sy)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS sections_seq ON sections (seq);
    CREATE TABLE IF NOT EXISTS ungenerated (
      dim INTEGER NOT NULL DEFAULT 0, cx INTEGER NOT NULL, cz INTEGER NOT NULL,
      PRIMARY KEY (dim, cx, cz)) WITHOUT ROWID;`);
  const q = (sql) => db.prepare(sql);
  const sMax = q('SELECT COALESCE(MAX(seq), 0) AS n FROM sections');
  const sUpsert = q(`INSERT INTO sections (cx, cz, sy, hash, blob, seq) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (dim, cx, cz, sy) DO UPDATE SET hash = excluded.hash, blob = excluded.blob, seq = excluded.seq
    WHERE sections.hash IS NOT excluded.hash`);
  const sUnmark = q('DELETE FROM ungenerated WHERE dim = 0 AND cx = ? AND cz = ?');
  const sMark = q('INSERT OR IGNORE INTO ungenerated (cx, cz) VALUES (?, ?)');
  const sHas = q('SELECT 1 AS x FROM ungenerated WHERE dim = 0 AND cx = ? AND cz = ?');
  const sCount = q('SELECT COUNT(*) AS n FROM sections WHERE dim = 0 AND cx = ? AND cz = ? AND sy BETWEEN ? AND ?');
  const sGet = q('SELECT blob FROM sections WHERE dim = 0 AND cx = ? AND cz = ? AND sy = ?');
  const sColumn = q('SELECT sy, hash, blob FROM sections WHERE dim = 0 AND cx = ? AND cz = ? ORDER BY sy');
  const sSince = q('SELECT cx, sy, cz, seq FROM sections WHERE seq > ? ORDER BY seq LIMIT ?');
  const sTotal = q('SELECT (SELECT COUNT(*) FROM sections) AS sections, (SELECT COUNT(*) FROM ungenerated) AS ungenerated');

  const seq = () => sMax.get().n; // from the index, so it needs no state beside the file and survives a restart
  let depth = 0;
  function tx(fn) {
    if (depth) return fn(); // nested: joins the outer transaction
    db.exec('BEGIN');
    depth = 1;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth = 0; }
  }
  const sectionCount = (cx, cz) => sCount.get(cx, cz, SY_MIN, SY_MAX).n;

  return {
    // Copies hash and blob (SQLite binds by value), so a view into a larger frame is safe to pass.
    put: (cx, sy, cz, hash, blob) => tx(() => {
      if (!sUpsert.run(cx, cz, sy, hash, blob, seq() + 1).changes) return false;
      sUnmark.run(cx, cz);
      return true;
    }),
    markUngenerated: (cx, cz) => tx(() => {
      if (sectionCount(cx, cz)) return false;
      sMark.run(cx, cz);
      return true;
    }),
    get(cx, sy, cz) { const r = sGet.get(cx, cz, sy); return r ? buf(r.blob) : null; },
    chunk(cx, cz) {
      if (sectionCount(cx, cz) >= SECTIONS) return 'known';
      return sHas.get(cx, cz) ? 'ungenerated' : 'unknown';
    },
    column: (cx, cz) => sColumn.all(cx, cz).map((r) => ({sy: r.sy, hash: buf(r.hash), blob: buf(r.blob)})),
    since(from, limit) {
      const rows = sSince.all(from, limit + 1), more = rows.length > limit;
      if (more) rows.length = limit;
      return {seq: more ? (rows.at(-1)?.seq ?? from) : seq(), sections: rows.map((r) => [r.cx, r.sy, r.cz]), more};
    },
    seq,
    counts: () => ({...sTotal.get()}),
    tx,
    close: () => db.close(),
  };
}

module.exports = {openStore};
