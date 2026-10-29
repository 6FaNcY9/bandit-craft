'use strict';
// B3: build() takes what it lacks from the supply chest, only that, never when removing.
// One run in this order: each part awaits the one before it, as the single function did.
(async () => {
  for (const part of ['supply', 'build-placing', 'interrupts-chests', 'rearm-excavate-shaft', 'night-hunt-bed', 'homebed-graves', 'scan-slayer', 'treefarm', 'wheatfarm', 'activation-walks', 'part']) await require(`./jobs/${part}`)();
  console.log('ok');
})();
