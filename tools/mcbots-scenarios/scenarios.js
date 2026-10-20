'use strict';
// Sandbox scenario table for run.js. Every scenario is built in a SKY LAB (box x 3500..3560, z 3000..3060, y 200..230 on
// the SANDBOX server) so terrain never decides the outcome. 2026-10-20: written after walking/digging fixes had no
// repeatable check; each scenario is passable by the bot as of 1c571a3, a FAIL is a finding, not a test bug.
const BOX = {x1: 3500, x2: 3560, z1: 3000, z2: 3060, y1: 200, y2: 230};
const fill = (x1, y1, z1, x2, y2, z2, block, how = '') => `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:${block}${how ? ` ${how}` : ''}`;
// Clear 2 slabs (a fill is capped at 32768 blocks) and the dropped items, only while the platform stands.
// The platform is smooth_stone, not stone: a mine/shift job for "stone" would otherwise dig the floor under its feet.
const GUARD = 'execute if block 3500 200 3000 minecraft:smooth_stone run';
const CLEAR = [
  `${GUARD} ${fill(3500, 201, 3000, 3560, 208, 3060, 'air')}`,
  `${GUARD} ${fill(3500, 209, 3000, 3560, 216, 3060, 'air')}`,
  `${GUARD} kill @e[type=item,x=3500,y=200,z=3000,dx=60,dy=30,dz=60]`,
];
const PLATFORM = [
  'forceload add 3500 3000 3560 3060', // the box's chunks only; the bot needs them loaded to walk
  fill(3500, 200, 3000, 3560, 200, 3060, 'smooth_stone'),
];
const START = 'tp bot50 3510.5 201 3030.5';
// Fresh bot per run: survival, full health, a pickaxe and an axe, daylight (mobs would skew the walk metrics).
const BOT = ['gamemode survival bot50', 'clear bot50', 'time set noon', 'effect clear bot50',
  'effect give bot50 minecraft:instant_health 1 5', 'effect give bot50 minecraft:saturation 1 20',
  'give bot50 minecraft:iron_pickaxe 1', 'give bot50 minecraft:iron_axe 1', 'give bot50 minecraft:bread 8'];

const SEALED = {x: 3549 + (Date.now() % 3), y: 201 + (Math.floor(Date.now() / 3) % 3), z: 3049 + (Math.floor(Date.now() / 9) % 3)};
const alive = {kind: 'alive'}, finished = {kind: 'finished'}, noError = {kind: 'noError'};
const near = (x, y, z, r = 2.5) => ({kind: 'near', x, y, z, r});

const SCENARIOS = [
  {name: '1-goto-open', setup: [START], timeoutS: 90,
    job: {type: 'goto', args: {x: 3540, y: 201, z: 3030}}, success: [finished, noError, alive, near(3540, 201, 3030)]},
  {name: '2-wall-gap', timeoutS: 120,
    // wall across the box at x 3525, 3 high, one door gap (2 high) at z 3040 well off the straight line
    setup: [fill(3525, 201, 3000, 3525, 203, 3060, 'stone'), fill(3525, 201, 3040, 3525, 202, 3040, 'air'), START],
    job: {type: 'goto', args: {x: 3540, y: 201, z: 3030}}, success: [finished, noError, alive, near(3540, 201, 3030)]},
  {name: '3-walled-in', timeoutS: 150,
    // a 1x1x2 cell inside solid stone; the way out is digging
    setup: [fill(3507, 201, 3027, 3513, 205, 3033, 'stone'), fill(3510, 201, 3030, 3510, 202, 3030, 'air'), START],
    job: {type: 'goto', args: {x: 3525, y: 201, z: 3030}}, success: [finished, noError, alive, near(3525, 201, 3030)]},
  {name: '4-pit-5-deep', timeoutS: 150,
    // plateau 5 high with a 3x3 pit down to the platform; target on the plateau top, bot has blocks to pillar
    setup: [fill(3505, 201, 3025, 3545, 205, 3035, 'stone'), fill(3509, 201, 3029, 3511, 205, 3031, 'air'), 'give bot50 minecraft:dirt 16', START],
    job: {type: 'goto', args: {x: 3520, y: 206, z: 3030}}, success: [finished, noError, alive, near(3520, 206, 3030)]},
  {name: '5-sealed-target', timeoutS: 120,
    // Target inside a bedrock cell (cannot be dug) with a 3 thick shell, so "stood next to the wall" is far from the target.
    // Its own spot: the bot remembers a walk with no path for 10 min per target, which would fail scenarios 1 and 2 otherwise.
    // The target rotates over the 27 cell blocks per run, so a cached "no path" from an earlier run (<10 min) cannot answer for this one.
    setup: [fill(3546, 200, 3046, 3554, 206, 3054, 'bedrock'), fill(3549, 201, 3049, 3551, 203, 3051, 'air'), START],
    job: {type: 'goto', args: SEALED}, success: [finished, alive, {kind: 'error', re: 'could not reach|no path'}, {kind: 'notNear', ...SEALED, r: 3.5}]},
  {name: '6-mine-cobble', timeoutS: 120,
    // one layer only: a taller field makes the bot pillar up with its own cobblestone and the count never grows
    setup: [fill(3520, 201, 3028, 3525, 201, 3032, 'stone'), START],
    job: {type: 'mine', args: {block: 'stone', count: 8}}, success: [finished, noError, alive, {kind: 'inv', item: 'cobblestone', min: 8}]},
  {name: '7-chop-logs', timeoutS: 120,
    setup: [3520, 3522, 3524, 3526].map((x) => fill(x, 201, 3030, x, 203, 3030, 'oak_log')).concat(START),
    job: {type: 'chop', args: {count: 4}}, success: [finished, noError, alive, {kind: 'inv', item: 'oak_log', min: 4}]},
  {name: '8-shift-chest', timeoutS: 240, stopAfterS: 180,
    // 12 stacks of cobblestone + 20 of torches (a deposit keeps them) make the inventory full, so the shift deposits at once;
    // 26 stacks overflowed the 27-slot chest and a 1658-item deposit got the bot kicked (packet flood). What it mines afterwards stays in the inventory (second check).
    setup: [fill(3520, 201, 3025, 3530, 203, 3035, 'stone'), 'setblock 3515 201 3030 minecraft:chest', 'give bot50 minecraft:cobblestone 768', 'give bot50 minecraft:torch 1280', START],
    job: {type: 'shift', args: {block: 'stone', x: 3515, y: 201, z: 3030}},
    success: [alive, noError, {kind: 'chest', x: 3515, y: 201, z: 3030, item: 'cobblestone', min: 16}, {kind: 'inv', item: 'cobblestone', min: 1}]},
  {name: '9-far-sealed-field', timeoutS: 180,
    // 6x6 stone layer 35 blocks away inside a bedrock ring (3 high) whose only gap is on the far side: the nearest blocks are
    // behind the wall (no line of sight), so the bot must walk around (T04 top-k walk) instead of failing on the closest one.
    setup: [fill(3544, 201, 3026, 3551, 203, 3033, 'bedrock'), fill(3545, 201, 3027, 3550, 203, 3032, 'air'), fill(3545, 201, 3027, 3550, 201, 3032, 'stone'), fill(3551, 201, 3030, 3551, 202, 3030, 'air'), START],
    job: {type: 'mine', args: {block: 'stone', count: 8}}, success: [finished, noError, alive, {kind: 'inv', item: 'cobblestone', min: 8}]},
];

module.exports = {BOX, SCENARIOS, CLEAR, PLATFORM, BOT};
