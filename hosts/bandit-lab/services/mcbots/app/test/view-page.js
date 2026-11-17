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
// a page opened in a hidden tab pauses the worker before the view's first message makes it fetch
const start = html.slice(html.indexOf('function startWorld'), html.indexOf("window.addEventListener('load', startWorld)"));
assert.match(start, /new Worker\([^)]*\);\n\s*const pause = [^\n]*\n\s*pause\(\);/, 'pause is the first message to the worker');
// the world's files run after the inline script, which uses them only from the load event
assert.deepStrictEqual([...html.slice(html.indexOf('</script>')).matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]), ['/oneview/blocks.js', '/oneview/planview.js', '/oneview/view.js', '/oneview/layers.js']);
// a throw in the 3D layer never stops the old dashboard: toWorld() runs last, caught
const onWs = html.slice(html.indexOf('ws.onmessage'), html.indexOf('ws.onclose'));
assert.match(onWs, /renderBots\(\);[\s\S]*loadEvents\(\);\n\s*try \{ toWorld\(\); \} catch/, 'toWorld() after the old renders, in try');
assert.strictEqual(onWs.match(/toWorld\(\)/g).length, 1);
// a world that cannot start says so instead of „Welt lädt …“ forever
assert.match(start, /then\(\(\) => \{ try \{\n[\s\S]*\} catch \(e\) \{ worldFail\(e\); \} \},/); assert.match(start, /worker\.onerror = worldFail;/); assert.ok(html.includes('Welt geht hier nicht. Seite neu laden.'));
// the name field and „Wer?“ live under Auftrag now
for (const gone of ['Trag oben', 'Erst oben']) assert.ok(!html.includes(gone), gone);
assert.match(html, /top: 50vh; top: 50dvh;/); assert.match(html, /bottom: 50vh; bottom: 50dvh;/);
// Safari before 15.5 has no worker-src fallback to script-src: without it the worker falls to default-src 'none'
assert.ok(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').includes("connect-src 'self'; worker-src 'self';"), 'worker-src in the page CSP');
