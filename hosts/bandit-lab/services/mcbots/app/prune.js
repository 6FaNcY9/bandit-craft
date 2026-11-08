'use strict';
// Retired bots leave entries behind in the stores keyed by bot name; drop them at start so the files stay small.
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['projects.json', 'settings.json', 'idle.json', 'prefs.json', 'roles.json', 'owner-orders.json'];

// Only keys outside `roster` go; a missing or unreadable file is left as it is. Call before the stores load.
function pruneStores(dir, roster) {
  for (const f of FILES) {
    const file = path.join(dir, f);
    try {
      const all = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!all || typeof all !== 'object' || Array.isArray(all)) continue;
      const keep = Object.fromEntries(Object.entries(all).filter(([name]) => roster.has(name)));
      if (Object.keys(keep).length === Object.keys(all).length) continue;
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(keep), {mode: 0o600});
      fs.renameSync(`${file}.tmp`, file);
    } catch {}
  }
}

module.exports = {pruneStores};
