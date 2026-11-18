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
// underground: the camera follows the cut's ack, a covered bot gets an automatic cut, ghosts and heights, the loose chip
assert.ok(html.match(/<div id="world">.*<\/div>\n/)[0].includes('<button class="b" id="looseChip" hidden></button>'), 'the loose chip sits in the world, a 44 px button');
assert.match(html, /chip = \$\('looseChip'\)[^\n]*\n\s*chip\.textContent = `🟥 \$\{n\} lose Erde`;\n\s*chip\.hidden = !n;/, 'N via textContent, hidden at 0');
assert.match(html, /store\.get\('looseOn', true\)/); assert.match(html, /worker\.postMessage\(\{t: 'loose', on: looseOn\}\)/);
assert.match(html, /else if \(m\.t === 'cut'\) view\.level\(m\.y\); else if \(m\.t === 'probe'\) onProbe\(m\);/, 'the camera moves on the worker\'s ack');
assert.match(html.slice(html.indexOf('r.root.onclick'), html.indexOf('rows.set(b.name, r)')), /view\.flyTo\(x, Math\.max\(y \+ 2, 70\), z\);[^\n]*\n\s*probing = \{x, y, z\};\n\s*worker\.postMessage\(\{t: 'probe', x, y, z\}\);/, 'a bot-row tap flies above ground and probes');
assert.match(html.slice(html.indexOf('function onPlan'), html.indexOf('function worldMsg')), /if \(!b\) return; probing = null; if \(cutAuto\) setCut\(319\); view\.flyTo\(/, 'a plan-chip tap voids the probe and removes an automatic cut');
{ // ruling U2: the worker cannot cancel a probe, so only the answer to the last tap counts; a slider move voids it
  const body = html.slice(html.indexOf('// the cut slider'), html.indexOf('// the camera looks almost straight down'));
  const els = {}, sent = [], levels = [], $ = (id) => (els[id] ||= {hidden: true, value: '319', textContent: '', classList: {toggle() {}}});
  const page = new Function('$', 'worker', 'view', 'setTimeout', 'clearTimeout', `${body}; return {onProbe, tap: (p) => { probing = p; }, auto: () => cutAuto};`)($, {postMessage: (m) => sent.push(m)}, {level: (y) => levels.push(y)}, () => 0, () => {});
  const A = {x: -449.5, y: 40, z: 101.5}, B = {x: -270.5, y: 64, z: -20.5}, answer = (p, roof) => page.onProbe({t: 'probe', ...p, roof});
  page.tap(A); page.tap(B); answer(A, 9); answer(B, 0);
  assert.deepStrictEqual(sent, [], 'a late answer for the first tap sets no cut after the second tap');
  page.tap(A); answer(A, 3); answer(A, 3);
  assert.deepStrictEqual(sent, [{t: 'cut', y: 41}], 'covered: a cut at head height, once');
  assert.ok(page.auto() && !els.cutY.hidden && !els.cutLbl.hidden && els.cutLbl.textContent === 'Höhe 41' && +els.cutY.value === 41, 'slider and label show the automatic cut');
  page.tap(B); answer(B, 2);
  assert.deepStrictEqual(sent.at(-1), {t: 'cut', y: 319}, 'not covered: the automatic cut goes'); assert.ok(!page.auto()); assert.deepStrictEqual(levels, [319], 'removing a cut raises the camera at once');
  page.tap(A); answer(A, 4); els.cutY.value = '26'; els.cutY.oninput();
  assert.ok(sent.length === 3 && !page.auto(), 'a slider move makes the automatic cut a cut by hand');
  page.tap(B); answer(B, 0);
  assert.strictEqual(sent.length, 3, 'a cut by hand stays');
  page.tap(A); els.cutY.oninput(); answer(A, 5);
  assert.strictEqual(sent.length, 3, 'a slider move voids the waiting probe');
}
const viewJs = fs.readFileSync(path.join(__dirname, '../public/oneview/view.js'), 'utf8');
assert.match(viewJs, /let base = cam\.y = Math\.max\(cam\.y, 70\)/, 'a saved camera starts above ground: the cut is not kept');
assert.match(viewJs, /function level\(y\) \{ lvl = y; cam\.y = y >= 319 \? base : Math\.min\(base, y \+ 1\);/, 'the target goes underground only with a cut');
assert.match(viewJs, /function flyTo\(x, y, z, r = 30\) \{ base = y; [^\n]*level\(lvl\); \}/);
assert.match(viewJs, /canvas\.dataset\.loose = s\.loose; canvas\.dataset\.cut = lvl;/); assert.match(viewJs, /return \{flyTo, level,/);
const layersJs = fs.readFileSync(path.join(__dirname, '../public/oneview/layers.js'), 'utf8');
assert.match(layersJs, /color: c, transparent: true, opacity: 0\.45, depthTest: false, depthWrite: false/, 'each marker has a ghost that shows through rock');
assert.match(layersJs, /m\.tag\.textContent = y < 60 \? `\$\{name\} · Höhe \$\{Math\.floor\(y\)\}` : name;/, 'an underground tag says the Höhe');
