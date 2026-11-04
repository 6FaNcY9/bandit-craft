'use strict';
// A trip by cart (cartride.js), against a fake bot and a fake clock: the live trip is in tools/mcbots-railspeed/spikes/ends.js.
const assert = require('node:assert');
const {EventEmitter} = require('node:events');
const {Vec3} = require('vec3');
const {makeRide} = require('../cartride');

const CART = 7, OTHER = 9;

// packets: the times (ms) at which the server says the bot's cart moved; other: the same for another cart.
function world({packets = [], other = [], empty = [], carts = 1, pickaxe = 'iron_pickaxe', vehicle = false, stopAt = null} = {}) {
  let t = 0;
  const client = new EventEmitter();
  client.written = [];
  client.write = (name, data) => client.written.push([name, data]);
  const due = [...packets.map((at) => [at, {entityId: CART, steps: [{}]}]), ...other.map((at) => [at, {entityId: OTHER, steps: [{}]}]), ...empty.map((at) => [at, {entityId: CART, steps: []}])].sort((a, b) => a[0] - b[0]);
  const job = {cancelled: false};
  const items = [...(carts ? [{name: 'minecart', count: carts}] : []), ...(pickaxe ? [{name: pickaxe, count: 1}] : [])];
  const bot = {
    _client: client,
    entity: {position: new Vec3(0, 0, 0)},
    entities: {},
    vehicle: null,
    moves: 0,
    placed: 0,
    attacks: 0,
    held: [],
    inventory: {items: () => items},
    blockAt: (p) => (p.y === 0 ? {name: 'rail', position: p} : {name: 'air', position: p}),
    equip: async (item) => { bot.held.push(item.name); },
    lookAt: async () => {},
    activateBlock: async () => {
      bot.placed++;
      items.find((i) => i.name === 'minecart').count--;
      items.splice(items.findIndex((i) => i.name === 'minecart' && !i.count), 1);
      bot.entities[CART] = {id: CART, name: 'minecart', position: new Vec3(1, 0, 0), hits: 0};
    },
    nearestEntity: (match) => Object.values(bot.entities).find(match) || null,
    mount: (cart) => { bot.vehicle = cart; },
    moveVehicle: () => { bot.moves++; },
    attack: (cart) => {
      bot.attacks++;
      if (++cart.hits < 3) return;
      delete bot.entities[cart.id];
      const have = items.find((i) => i.name === 'minecart');
      if (have) have.count++; else items.push({name: 'minecart', count: 1});
    },
  };
  if (vehicle) bot.vehicle = bot.entities[CART] = {id: CART, name: 'minecart', position: new Vec3(1, 0, 0), hits: 0};
  const sleep = async (ms) => {
    t += ms;
    while (due.length && due[0][0] <= t) client.emit('move_minecart', due.shift()[1]);
    if (stopAt !== null && t >= stopAt) job.cancelled = true;
  };
  const guard = (j) => { if (j.cancelled) throw new Error('stopped'); };
  return {r: {bot}, bot, job, client, ride: makeRide({guard, sleep, now: () => t}), clock: () => t};
}

const every = (from, to, step = 200) => { const out = []; for (let at = from; at <= to; at += step) out.push(at); return out; };
const rail = new Vec3(1, 0, 0);
(async () => { // the client never learns where a cart went: it "is" where it was boarded, far out of reach of a rider 300 m on
  const w = world({packets: every(300, 3000)});
  w.client.on('move_minecart', () => { w.bot.entity.position = new Vec3(300, 0, 0); });
  await w.ride.ride(w.r, w.job, rail, {limitMs: 60000});
  assert.strictEqual(w.bot.attacks, 3, 'hit where it stands');
  assert.strictEqual(w.bot.inventory.items().find((i) => i.name === 'minecart')?.count, 1, 'and back in the bag');
})();
const shifts = (client) => client.written.filter(([name]) => name === 'player_input').map(([, d]) => d.inputs.shift === true);

module.exports = (async () => {
  { // rides until the packets stop
    const w = world({packets: every(1000, 5000)});
    const at = await w.ride.ride(w.r, w.job, rail, {limitMs: 60000});
    assert.strictEqual(at, w.bot.entity.position, 'where the bot is');
    assert.ok(w.clock() >= 7000, `2 s of quiet after the last packet, was ${w.clock()}`);
    assert.ok(w.bot.moves > 40, 'input all the way');
    assert.deepStrictEqual(shifts(w.client), [true, false], 'sneaks off');
    assert.strictEqual(w.bot.vehicle, null, 'mineflayer leaves it set');
    assert.strictEqual(w.bot.attacks, 3, 'three hits');
    assert.ok(w.bot.held.includes('iron_pickaxe'), 'by hand it heals faster than a bot hits');
    assert.strictEqual(w.bot.inventory.items().find((i) => i.name === 'minecart').count, 1, 'the cart is back');
    assert.strictEqual(w.client.listenerCount('move_minecart'), 0, 'no listener left');
  }
  { // packets for another cart do not count
    const w = world({other: every(0, 40000)});
    await assert.rejects(w.ride.ride(w.r, w.job, rail, {limitMs: 60000}), /cart did not start/);
    assert.strictEqual(w.bot.vehicle, null, 'not left sitting in it');
  }
  { // nor does a packet with no steps
    const w = world({empty: every(0, 40000)});
    await assert.rejects(w.ride.ride(w.r, w.job, rail, {limitMs: 60000}), /cart did not start/);
  }
  { // a pause under 2 s is no arrival
    const w = world({packets: [1000, 2800, 4600]});
    await w.ride.ride(w.r, w.job, rail, {limitMs: 60000});
    assert.ok(w.clock() >= 6600, `was ${w.clock()}`);
  }
  { // stop during a ride
    const w = world({packets: every(1000, 60000), stopAt: 3000});
    await assert.rejects(w.ride.ride(w.r, w.job, rail, {limitMs: 90000}), /stopped/);
    assert.ok(w.clock() < 6000, `at once, was ${w.clock()}`);
    assert.deepStrictEqual(shifts(w.client), [true, false], 'the bot gets off');
    assert.strictEqual(w.bot.vehicle, null);
    assert.strictEqual(w.client.listenerCount('move_minecart'), 0, 'no listener left');
    const moves = w.bot.moves;
    await w.ride.leave(w.r);
    assert.strictEqual(w.bot.moves, moves, 'no input after it');
  }
  { // a ride that never ends
    const w = world({packets: every(1000, 200000)});
    await assert.rejects(w.ride.ride(w.r, w.job, rail, {limitMs: 30000}), /ride took/);
    assert.strictEqual(w.bot.vehicle, null);
  }
  { // no cart: fails before anything is placed
    const w = world({carts: 0});
    await assert.rejects(w.ride.ride(w.r, w.job, rail, {limitMs: 30000}), /no cart in the inventory/);
    assert.strictEqual(w.bot.placed, 0);
  }
  { // no rail where it should be
    const w = world();
    await assert.rejects(w.ride.ride(w.r, w.job, new Vec3(1, 5, 0), {limitMs: 30000}), /no rail at 1 5 0: air/);
    assert.strictEqual(w.bot.placed, 0);
  }
  { // logged in riding: the cart goes on by itself, no input, then off
    const w = world({vehicle: true, packets: every(0, 4000)});
    await w.ride.rideOn(w.r, w.job, {limitMs: 60000});
    assert.strictEqual(w.bot.moves, 0, 'no input: it may be standing on a dip');
    assert.ok(w.clock() >= 6000, `was ${w.clock()}`);
    assert.strictEqual(w.bot.vehicle, null);
    assert.strictEqual(w.bot.attacks, 3, 'and the cart is taken');
  }
  { // logged in riding a cart that stands: 2 s and off, no failure
    const w = world({vehicle: true});
    await w.ride.rideOn(w.r, w.job, {limitMs: 60000});
    assert.ok(w.clock() < 10000, `was ${w.clock()}`);
    assert.strictEqual(w.bot.vehicle, null);
  }
  { // taking a cart back: without a pickaxe it says so and does not try
    const w = world({vehicle: true, pickaxe: null});
    w.bot.vehicle = null;
    assert.strictEqual(await w.ride.takeCart(w.r, w.job), false);
    assert.strictEqual(w.bot.attacks, 0);
  }
  { // two carts where the bot stands, one of them left behind: both go
    const w = world({vehicle: true});
    w.bot.vehicle = null;
    w.bot.entities[OTHER] = {id: OTHER, name: 'minecart', position: new Vec3(2, 0, 0), hits: 0};
    assert.strictEqual(await w.ride.takeCart(w.r, w.job), true);
    assert.deepStrictEqual(Object.keys(w.bot.entities), []);
    assert.strictEqual(w.bot.attacks, 6);
  }
  { // a cart far off is none of its business
    const w = world({vehicle: true});
    w.bot.vehicle = null;
    w.bot.entities[CART].position = new Vec3(30, 0, 0);
    assert.strictEqual(await w.ride.takeCart(w.r, w.job), true);
    assert.strictEqual(w.bot.attacks, 0);
  }
})();
if (require.main === module) module.exports.then(() => console.log('ok'), (e) => { console.error(e); process.exit(1); });
