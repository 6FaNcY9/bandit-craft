'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // part: one board slice, dug top down, then the bots' own scaffold; torches stay
    const {JOBS, VALIDATE} = require('../../bots');
    const {Vec3} = require('vec3');
    assert.deepStrictEqual(VALIDATE.part({part: 'j1.2', x1: 3, y1: 61, z1: 2, x2: 0, y2: 60, z2: 0}), {part: 'j1.2', x1: 0, y1: 60, z1: 0, x2: 3, y2: 61, z2: 2});
    assert.deepStrictEqual(VALIDATE.part({part: 'j1.1', x1: 0, y1: 40, z1: 0, x2: 63, y2: 71, z2: 3}).x2, 63, 'long along x is fine');
    assert.throws(() => VALIDATE.part({part: 'j1.2', x1: 0, y1: 60, z1: 0, x2: 4, y2: 60, z2: 4}), /at most 4 wide/);
    assert.throws(() => VALIDATE.part({part: 'j1.2', x1: 0, y1: 0, z1: 0, x2: 3, y2: 32, z2: 3}), /32 high/);
    assert.throws(() => VALIDATE.part({x1: 0, y1: 60, z1: 0, x2: 3, y2: 60, z2: 3}), /part id/);

    const blocks = new Map();
    for (let x = 0; x <= 3; x++) for (let y = 60; y <= 61; y++) for (let z = 0; z <= 2; z++) blocks.set(`${x},${y},${z}`, 'stone');
    blocks.set('1,61,1', 'cobblestone'); // a bot's scaffold: excavate leaves it
    blocks.set('2,60,2', 'torch');
    const order = [];
    const bot = {
      blockAt: (p) => {
        const name = p.y === 59 ? 'bedrock' : blocks.get(`${p.x},${p.y},${p.z}`); // a floor: no unsafe drop
        return name ? {name, type: 1, position: p, boundingBox: name === 'torch' ? 'empty' : 'block', getProperties: () => ({})} : {name: 'air', type: 0, position: p, boundingBox: 'empty'};
      },
      entity: {position: new Vec3(1, 62, 1), onGround: true}, game: {dimension: 'overworld'}, entities: {}, food: 20,
      registry: {blocks: {}, foodsByName: {}},
      inventory: {items: () => [{type: 2, name: 'stone_pickaxe'}], emptySlotCount: () => 30, slots: []}, getEquipmentDestSlot: () => 5,
      pathfinder: {goto: async () => {}, stop() {}, setGoal() {}}, tool: {equipForBlock: async () => {}},
      dig: async (b) => { order.push(`${b.name}@${b.position.y}`); blocks.delete(`${b.position.x},${b.position.y},${b.position.z}`); },
      stopDigging() {},
    };
    const r = {bot, world: {hostilesNear: () => [], claim: async () => true, release() {}}, emit() {}, protectedAreas: [], supplyChest: null, combat: null};
    const job = {t: {}, cancelled: false, type: 'part', args: {part: 'j1.2', x1: 0, y1: 60, z1: 0, x2: 3, y2: 61, z2: 2}};
    await JOBS.part(r, job);
    assert.deepStrictEqual([job.t.done, job.t.total], [24, 24]);
    assert.deepStrictEqual([...blocks.values()], ['torch'], 'stone and the scaffold are gone, the torch stays');
    assert.strictEqual(order.indexOf('cobblestone@61'), order.length - 1, 'the scaffold goes after the natural ground');
    assert.ok(order.slice(0, 11).every((o) => o.endsWith('@61')), 'top layer first');
    assert.ok(!job.noop);
    assert.strictEqual(r.boardPart, false);
    const again = {...job, t: {}};
    await JOBS.part(r, again);
    assert.strictEqual(again.noop, true, 'an empty slice is already done');
  }
};
