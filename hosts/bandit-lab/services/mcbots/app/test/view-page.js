'use strict';
// The page shell: one inline script (CSP), the bottom bar and sheets, the 2D map gone, the Plan tab kept.
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.strictEqual((html.match(/<script>/g) || []).length, 1, 'one inline script: the CSP hashes the first only');
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.match(m[1], /^\/(oneview|vendor)\/[\w.-]+\.js$/);
for (const gone of ['drawMap', 'planThree', '/api/tile/', 'data-page="map"', 'id="tabs"', 'architect/chat']) assert.ok(!html.includes(gone), gone);
assert.ok(html.includes('/api/schematic/blocks') && html.includes('Datei ansehen'), 'the Plan tab lives on as „Datei ansehen“');
for (const need of ['id="view"', 'id="bar"', 'data-sheet="bots"', 'data-sheet="plan"', 'data-sheet="menu"', 'id="chatBtn"', 'id="sheet"', 'id="stopAll"', 'id="me"', '/api/architect/status']) assert.ok(html.includes(need), need);
assert.match(html, /<button[^>]*id="chatBtn"[^>]*hidden/);
for (const page of ['home', 'orders', 'chests', 'project', 'plan', 'server']) assert.ok(html.includes(`data-page="${page}"`), page);
// the world's files run after the inline script, which uses them only from the load event
assert.deepStrictEqual([...html.slice(html.indexOf('</script>')).matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]), ['/oneview/blocks.js', '/oneview/planview.js', '/oneview/view.js']);
