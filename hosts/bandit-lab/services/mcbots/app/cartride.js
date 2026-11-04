'use strict';
// A trip by cart: put it on the rail, board, start by input, wait until it stands, get off, take it back. Every step was
// proven by a bot in survival: docs/runbooks/minecraft/highway-measurements.md, "A builder's whole trip".
const STEP_MS = 100;
const QUIET_MS = 2000; // move_minecart comes at most 0.3 s apart while a cart moves, and not at all while it stands
const NO_START_MS = 20000;
const HIT_MS = 900; // a cart heals 1 a tick and takes 10 a hit, and breaks above 40: slower hits never get there
const MAX_HITS = 8;
const CART_REACH = 4;
const PICK = /^(iron|diamond|netherite)_pickaxe$/;

function makeRide({guard, sleep, now = Date.now}) {
  const cartNear = (bot, range) => bot.nearestEntity((e) => e.name === 'minecart' && e.position.distanceTo(bot.entity.position) <= range);

  async function leave(r) {
    const {bot} = r;
    bot._client.write('player_input', {inputs: {shift: true}});
    await sleep(1000);
    bot._client.write('player_input', {inputs: {}});
    bot.vehicle = null; // mineflayer leaves it set
    await sleep(1000);
  }

  // Back in the inventory: a cart left on the rail would stop the next rider dead (runbook). Every cart in reach goes,
  // one left there before included. False without a pickaxe, or when a cart outlasts the hits.
  async function takeCart(r, job) {
    const {bot} = r;
    if (!cartNear(bot, CART_REACH)) return true;
    const pick = bot.inventory.items().find((i) => PICK.test(i.name));
    if (!pick) return false;
    await bot.equip(pick, 'hand');
    for (let cart = cartNear(bot, CART_REACH); cart; cart = cartNear(bot, CART_REACH)) {
      for (let hits = 0; bot.entities[cart.id]; hits++) {
        if (hits === MAX_HITS) return false;
        guard(job);
        bot.attack(cart);
        await sleep(HIT_MS);
      }
    }
    await sleep(1500); // the item lands at the bot's feet
    return true;
  }

  // Until the cart stands. `input` keeps it going; without it a cart that stands is simply there, which is no failure.
  async function wait(r, job, {limitMs, input}) {
    const {bot} = r, id = bot.vehicle.id, start = now();
    let last = null;
    const moved = (p) => { if (p.entityId === id && p.steps.length) last = now(); };
    bot._client.on('move_minecart', moved);
    try {
      for (;;) {
        guard(job);
        if (now() - start > limitMs) throw new Error(`ride took over ${Math.round(limitMs / 1000)} s`);
        if (input) bot.moveVehicle(0, 1);
        if (last !== null ? now() - last >= QUIET_MS : !input && now() - start >= QUIET_MS) return;
        if (input && last === null && now() - start > NO_START_MS) throw new Error('cart did not start');
        await sleep(STEP_MS);
      }
    } finally {
      bot._client.off('move_minecart', moved);
      await leave(r);
    }
  }

  // Where the bot is at the end: the job reads the blocks to know what that means.
  async function ride(r, job, railPos, {limitMs}) {
    const {bot} = r;
    const item = bot.inventory.items().find((i) => i.name === 'minecart');
    if (!item) throw new Error('no cart in the inventory');
    const rail = bot.blockAt(railPos);
    if (!rail || !/rail$/.test(rail.name)) throw new Error(`no rail at ${railPos.x} ${railPos.y} ${railPos.z}: ${rail?.name}`);
    await bot.equip(item, 'hand');
    await bot.lookAt(rail.position.offset(0.5, 0.1, 0.5), true);
    await bot.activateBlock(rail);
    let cart = null;
    for (let i = 0; i < 20 && !cart; i++) {
      guard(job);
      cart = cartNear(bot, 8);
      if (!cart) await sleep(STEP_MS);
    }
    if (!cart) throw new Error('no cart after placing one');
    await bot.lookAt(cart.position, true); // the input goes where the rider looks, so this points it along the road
    bot.mount(cart);
    for (let i = 0; i < 50 && !bot.vehicle; i++) {
      guard(job);
      await sleep(STEP_MS);
    }
    if (!bot.vehicle) throw new Error('could not board the cart');
    await wait(r, job, {limitMs, input: true});
    await takeCart(r, job);
    return bot.entity.position;
  }

  // A bot that logged in riding: its cart goes on by itself (runbook, "Quitting in a cart").
  async function rideOn(r, job, {limitMs}) {
    await wait(r, job, {limitMs, input: false});
    await takeCart(r, job);
    return r.bot.entity.position;
  }

  return {ride, rideOn, leave, takeCart};
}

module.exports = {makeRide};
