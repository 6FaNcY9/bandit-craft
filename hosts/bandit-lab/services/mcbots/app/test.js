'use strict';
// The mcbots self-check: unit tests plus loopback round trips, no Minecraft server. The parts live in
// test/ by topic and run in this order; async parts keep running while the next part loads, as they
// did when this was one file. A single part runs alone: node test/<part>.js
for (const part of ['config', 'build-blueprint', 'world-combat', 'debug-api', 'hub', 'hub-workers', 'keeper', 'plan', 'stop-and-death', 'jobs', 'seal-zones', 'codex-r6', 'walking', 'pillars-admin-blocklog', 'goto-crafting', 'fighting-air', 'rescue-litematic', 'materials', 'owner-orders', 'production-projects', 'fluids-unroof-tools', 'highways-light-night', 'scenario', 'board', 'trade']) require(`./test/${part}`);
