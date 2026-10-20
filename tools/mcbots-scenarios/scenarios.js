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


// Hut blueprint, relative to its origin: 5x5 ring, 3 high; door gap at x2,z0 (y0..1), glass window at x2,y1,z4.
const HUT = [];
for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) {
  if (x > 0 && x < 4 && z > 0 && z < 4) continue;
  if (x === 2 && z === 0 && y < 2) continue;
  HUT.push({x, y, z, block: x === 2 && z === 4 && y === 1 ? 'glass' : 'oak_planks'});
}

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
  {name: '10-lava-beside-path', timeoutS: 120,
    // 3 wide lava strip on the floor across the box with a 1 block stone bridge; the straight line crosses the lava
    setup: [fill(3525, 200, 3000, 3527, 200, 3060, 'lava'), fill(3525, 200, 3030, 3527, 200, 3030, 'stone'), START],
    job: {type: 'goto', args: {x: 3540, y: 201, z: 3030}}, success: [finished, noError, alive, near(3540, 201, 3030)]},
  {name: '11-water-pool', timeoutS: 150,
    // start in a 2 deep water basin (3 high stone ring, 9x9 inside) with a shore step (1 high, then 2 high) on the east side: swim out, no drowning.
    // A fully walled basin (4 high) is a known gap (T53): the bot refuses to dig next to water and stays swimming.
    setup: [fill(3505, 201, 3025, 3515, 203, 3035, 'stone'), fill(3515, 203, 3025, 3515, 203, 3035, 'air'), fill(3506, 201, 3026, 3514, 205, 3034, 'air'), fill(3506, 201, 3026, 3514, 202, 3034, 'water'), fill(3513, 201, 3026, 3513, 201, 3034, 'stone'), fill(3514, 201, 3026, 3514, 202, 3034, 'stone'), 'tp bot50 3510.5 202 3030.5'],
    job: {type: 'goto', args: {x: 3527, y: 201, z: 3030}}, success: [finished, noError, alive, near(3527, 201, 3030)]},
  {name: '12-high-ledge', timeoutS: 120,
    // start on an 8 high plateau, target on the platform floor: a straight drop is 8 blocks (fatal-ish), the bot must climb down
    setup: [fill(3505, 201, 3025, 3515, 208, 3035, 'stone'), 'tp bot50 3510.5 209 3030.5'],
    job: {type: 'goto', args: {x: 3530, y: 201, z: 3030}}, success: [finished, noError, alive, near(3530, 201, 3030)]},
  {name: '13-dark-tunnel', timeoutS: 150,
    // 25 long 1x2 tunnel inside solid stone, no light at all
    setup: [fill(3505, 201, 3028, 3540, 205, 3032, 'stone'), fill(3508, 201, 3030, 3533, 202, 3030, 'air'), 'tp bot50 3508.5 201 3030.5'],
    job: {type: 'goto', args: {x: 3533, y: 201, z: 3030}}, success: [finished, noError, alive, near(3533, 201, 3030)]},
  {name: '14-craft-get', timeoutS: 300,
    // Empty inventory; a chest holds the materials. The bot only uses chests it has indexed, so a stock job on it comes first (pre);
    // then one get job per item (shield and furnace in pre, iron_pickaxe is the scored job).
    setup: ['setblock 3515 201 3030 minecraft:chest', 'item replace block 3515 201 3030 container.0 with minecraft:iron_ingot 8', 'item replace block 3515 201 3030 container.1 with minecraft:oak_planks 32', 'item replace block 3515 201 3030 container.2 with minecraft:cobblestone 16', 'clear bot50', START],
    zones: [{name: 'scn-storage', box: {x1: 3512, y1: 200, z1: 3027, x2: 3518, y2: 204, z2: 3033}}], // chests are indexed only inside a storage zone (bots.js indexChest)
    pre: [{type: 'stock', args: {x: 3515, y: 201, z: 3030}}, {type: 'get', args: {item: 'shield', count: 1}}, {type: 'get', args: {item: 'furnace', count: 1}}],
    job: {type: 'get', args: {item: 'iron_pickaxe', count: 1}}, success: [finished, noError, alive, {kind: 'inv', item: 'iron_pickaxe', min: 1}, {kind: 'inv', item: 'shield', min: 1}, {kind: 'inv', item: 'furnace', min: 1}]},
  {name: '15-wheat-plot', timeoutS: 200, stopAfterS: 150,
    // 8x4 ripe wheat on farmland (y 201/202), a stone-walled water strip along the north edge hydrates it. The job never ends on its own: stopped after 150 s. A crafting table stands by the field (else the bot walks to the real base for bread) and the bot starts without bread (16 bread would be handed in at the base chest).
    // Replanted = wheat at age 0..3 (hydrated farmland grows a fresh seed up to two stages in 150 s; ripe is 7); harvested = no age 7 left. Farmland count must stay 32 (no trampling).
    // wheatfarm.js looks for ground within 20 blocks of the supply chest's y (or the job's y): the job passes y 201 so the bot needs no SUPPLY_CHEST.
    setup: [fill(3519, 201, 3023, 3528, 201, 3023, 'stone'), fill(3519, 201, 3024, 3519, 201, 3029, 'stone'), fill(3528, 201, 3024, 3528, 201, 3029, 'stone'), fill(3520, 201, 3024, 3527, 201, 3024, 'water'),
      fill(3520, 201, 3025, 3527, 201, 3028, 'farmland[moisture=7]'), fill(3520, 202, 3025, 3527, 202, 3028, 'wheat[age=7]'), 'setblock 3525 201 3031 minecraft:crafting_table', 'clear bot50', 'give bot50 minecraft:stone_pickaxe 1', 'give bot50 minecraft:stone_axe 1', 'give bot50 minecraft:wheat_seeds 16', 'give bot50 minecraft:stone_hoe 1', 'tp bot50 3523.5 201 3032.5'],
    job: {type: 'wheatfarm', args: {x1: 3520, z1: 3025, x2: 3527, z2: 3028, y: 201}},
    success: [alive, {kind: 'cells', x1: 3520, y1: 202, z1: 3025, x2: 3527, y2: 202, z2: 3028, specs: ['minecraft:wheat[age=7]'], max: 0},
      {kind: 'cells', x1: 3520, y1: 202, z1: 3025, x2: 3527, y2: 202, z2: 3028, specs: ['minecraft:wheat[age=0]', 'minecraft:wheat[age=1]', 'minecraft:wheat[age=2]', 'minecraft:wheat[age=3]'], min: 31},
      {kind: 'cells', x1: 3520, y1: 201, z1: 3025, x2: 3527, y2: 201, z2: 3028, specs: ['minecraft:farmland'], min: 32}]},
  {name: '16-blueprint-small', timeoutS: 240,
    // 5x5 hut, walls 3 high from oak_planks, a 2 high door gap in the south wall and one glass window in the north wall (46 blocks, MAX_SIZE is 5x3x5).
    // Bot gets planks, glass and some dirt/cobblestone to scaffold with; afterwards no dirt/cobblestone may be left in the 9x9x6 box around the hut.
    setup: ['give bot50 minecraft:oak_planks 64', 'give bot50 minecraft:glass 4', 'give bot50 minecraft:dirt 16', 'give bot50 minecraft:cobblestone 16', START],
    job: {type: 'build', args: {origin: {x: 3530, y: 201, z: 3030}, blocks: HUT}},
    success: [finished, noError, alive,
      {kind: 'cells', x1: 3530, y1: 201, z1: 3030, x2: 3534, y2: 203, z2: 3034, specs: ['minecraft:oak_planks'], min: 45, max: 45},
      {kind: 'cells', x1: 3530, y1: 201, z1: 3030, x2: 3534, y2: 203, z2: 3034, specs: ['minecraft:glass'], min: 1, max: 1},
      {kind: 'cells', x1: 3532, y1: 201, z1: 3030, x2: 3532, y2: 202, z2: 3030, specs: ['minecraft:air', 'minecraft:snow'], min: 2}, // snow: the sandbox weather lays a layer in the gap
      {kind: 'cells', x1: 3528, y1: 201, z1: 3028, x2: 3536, y2: 206, z2: 3036, specs: ['minecraft:dirt', 'minecraft:cobblestone'], max: 0}]},
];

module.exports = {BOX, SCENARIOS, CLEAR, PLATFORM, BOT};
