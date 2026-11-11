'use strict';
// The mcbots self-check: unit tests plus loopback round trips, no Minecraft server. The parts live in
// test/ by topic and run in this order; async parts keep running while the next part loads, as they
// did when this was one file. A single part runs alone: node test/<part>.js
// botui runs last, alone: in the shared loop 8 of 10 runs failed in timing asserts of walking and goto-crafting (1 of 10 without it),
// and beside the others its loopback servers can take a port a part picked but has not bound yet.
process.once('beforeExit', () => require('node:child_process').spawn(process.execPath, [`${__dirname}/test/botui.js`], {stdio: 'inherit'}).on('exit', (code) => { if (code !== 0) process.exit(1); }));
for (const part of ['config', 'road', 'cartride', 'roadjob', 'build-blueprint', 'world-combat', 'combat-retreat', 'debug-api', 'hub', 'hub-workers', 'ingame', 'botui-screens', 'botui-menus', 'uploads', 'botui-jobs', 'keeper', 'stop-and-death', 'jobs', 'seal-zones', 'codex-r6', 'walking', 'pillars-admin-blocklog', 'goto-crafting', 'fighting-air', 'rescue-litematic', 'materials', 'owner-orders', 'production-projects', 'fluids-unroof-tools', 'highways-light-night', 'board', 'trade', 'traderchests', 'misa', 'prefs', 'idle', 'alive', 'ownalerts', 'farsearch', 'reports', 'autoempty', 'counters', 'prune', 'inventory', 'remote']) require(`./test/${part}`);
