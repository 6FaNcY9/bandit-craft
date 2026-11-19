'use strict';
// B3: build() takes what it lacks from the supply chest, only that, never when removing.
// Each part runs in its own process (node test/jobs.js <part> runs one), four at a time: the parts wait on the jobs'
// real sleeps and timeouts (3 min in a row), share no ports or files, and each passes alone.
const PARTS = ['supply', 'build-placing', 'interrupts-chests', 'rearm-excavate-shaft', 'night-hunt-bed', 'homebed-graves', 'scan-slayer', 'treefarm', 'wheatfarm', 'cropfarm', 'animalfarm', 'activation-walks', 'part', 'own-chest', 'rock-zone'];
if (process.argv[2]) require(`./jobs/${process.argv[2]}`)();
else (async () => {
  const {spawn} = require('node:child_process');
  const run = (part) => new Promise((res, rej) => spawn(process.execPath, [__filename, part], {stdio: 'inherit'})
    .on('exit', (code) => (code === 0 ? res() : rej(new Error(`test/jobs/${part} failed (exit ${code})`)))));
  const queue = [...PARTS];
  await Promise.all(Array.from({length: 4}, async () => { while (queue.length) await run(queue.shift()); }));
  console.log('ok');
})();
