'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // homebed: one bed slot per bot in Barracks 1 (castle A3a) - slots, needs, the job against a fake bot
    const {JOBS, VALIDATE, Cancelled} = require('../../bots');
    const HB = require('../../homebed');
    const {Vec3} = require('vec3');
    // Barracks 1 (A3a, spec 2026-11-15-castle-armoury): heads to the north wall in row 1, to the south wall in row 2,
    // the door column x -329 stays free in row 2
    assert.deepStrictEqual(HB.slotSpot(0), {x: -332, y: 105, z: -28, facing: 'north'});
    assert.deepStrictEqual(HB.slotSpot(6), {x: -326, y: 105, z: -28, facing: 'north'}, 'row 1 ends at x -326');
    assert.deepStrictEqual(HB.slotSpot(7), {x: -332, y: 105, z: -22, facing: 'south'}, 'the 8th goes to row 2');
    assert.ok(Array.from({length: HB.SLOTS}, (_, i) => HB.slotSpot(i)).every((p) => !(p.x === -329 && p.z === -22)), 'the door column stays free');
    assert.strictEqual(HB.SLOTS, 14, 'spec: at least 14');
    assert.deepStrictEqual(HB.slotSpot(13), {x: -331, y: 105, z: -25, facing: 'west'}, 'the 14th in the aisle, head on the west wall');
    assert.strictEqual(new Set(Array.from({length: HB.SLOTS}, (_, i) => JSON.stringify(HB.slotSpot(i)))).size, HB.SLOTS, 'every slot differs');
    assert.deepStrictEqual(HB.CREW.map((n) => HB.homeSpot(n, {}).x), [-332, -331, -330], 'the crew gets different x');
    assert.deepStrictEqual(HB.homeSpot('bot3', {slot: 8}), HB.slotSpot(8), 'an explicit slot wins');
    assert.deepStrictEqual(HB.homeSpot('bot3', {x: 1, y: 60, z: 2}), {x: 1, y: 60, z: 2, facing: 'north'});
    assert.throws(() => HB.homeSpot('bot99', {}), /no bed slot/);
    assert.throws(() => HB.homeSpot('bot1', {slot: 14}), /no bed slot/);
    const have = (o) => Object.entries(o).map(([name, count]) => ({name, count}));
    assert.deepStrictEqual(HB.bedNeeds(have({red_bed: 1})), {wool: false, planks: false});
    assert.deepStrictEqual(HB.bedNeeds(have({white_wool: 3, oak_planks: 3})), {wool: false, planks: false});
    assert.deepStrictEqual(HB.bedNeeds(have({white_wool: 3, oak_log: 1})), {wool: false, planks: false}, 'one log makes planks');
    assert.deepStrictEqual(HB.bedNeeds(have({white_wool: 2, red_wool: 1, oak_planks: 2})), {wool: true, planks: true});
    // wool from the base chest: one colour at a time, never "any wool" (2 gray + 1 light gray, bot21 2026-11-16)
    assert.deepStrictEqual(HB.woolPicks([], {white_wool: 20, gray_wool: 2}), [{item: 'white_wool', count: 3}], 'white when the chest has it');
    assert.deepStrictEqual(HB.woolPicks(have({gray_wool: 2, light_gray_wool: 1}), {white_wool: 20, gray_wool: 1}),
      [{item: 'gray_wool', count: 1}, {item: 'white_wool', count: 3}, {item: 'light_gray_wool', count: 2}], 'finish the held colour first');
    assert.deepStrictEqual(HB.woolPicks([], {red_wool: 5}), [{item: 'red_wool', count: 3}, {item: 'white_wool', count: 3}], 'a colour the index shows enough of');
    assert.deepStrictEqual(HB.woolPicks([], {}), [{item: 'white_wool', count: 3}], 'no index: white');
    assert.ok(HB.woolPicks(have({a_wool: 1, b_wool: 1, c_wool: 1}), {d_wool: 9, e_wool: 9}).length <= 3, 'three tries at most');
    assert.deepStrictEqual(HB.searchRing({x: 10.5, y: 66, z: -4}).slice(0, 4), [{x: 80, z: -4}, {x: 10, z: 66}, {x: -60, z: -4}, {x: 10, z: -74}]);
    assert.strictEqual(HB.searchRing({x: 0, z: 0}).length, 8);
    assert.deepStrictEqual(VALIDATE.homebed({}), {});
    assert.deepStrictEqual(VALIDATE.homebed({slot: 3}), {slot: 3});
    assert.deepStrictEqual(VALIDATE.homebed({x: 1, y: 60, z: 2}), {x: 1, y: 60, z: 2, facing: 'north'});
    assert.throws(() => VALIDATE.homebed({slot: 14}), /slot/);
    assert.throws(() => VALIDATE.homebed({x: 1, y: 60, z: 2, facing: 'up'}), /facing/);

    // bot3's slot is x -330 in Barracks 1: floor y 104, air 105..106, rows z -29 (head) and -28 (foot)
    const room = (extra = {}) => {
      const c = {};
      for (const z of [-29, -28]) { c[`-330,104,${z}`] = {name: 'stone', boundingBox: 'block'}; for (const y of [105, 106]) c[`-330,${y},${z}`] = {name: 'air', boundingBox: 'empty'}; }
      return {...c, ...extra};
    };
    const fakeHome = ({inv = [], blocks = room(), areas = []} = {}) => {
      const events = [], infos = [], listeners = new Set(), cell = new Map(Object.entries(blocks));
      const bot = {
        entities: {}, inventory: {items: () => inv}, heldItem: null, game: {dimension: 'overworld'}, time: {timeOfDay: 1000}, isSleeping: false,
        entity: {position: new Vec3(-330, 105, -31), onGround: true},
        pathfinder: {goto: async (g) => { events.push(`goto ${g.x ?? ''} ${g.z ?? ''}`.trim()); }, setGoal() {}, stop() {}, isMoving: () => false},
        equip: async (item) => { bot.heldItem = item; events.push(`equip ${item.name}`); },
        look: async (yaw) => { events.push(`look ${yaw}`); },
        lookAt: async () => {},
        blockAt: (p) => { const c = cell.get(`${p.x},${p.y},${p.z}`); return c ? {position: p, ...c} : null; },
        _placeBlockWithOptions: async (ref, face, o) => { events.push(`place ${ref.position.x},${ref.position.y + 1},${ref.position.z} ${o.forceLook}`); cell.set('-330,105,-28', {name: 'red_bed'}); cell.set('-330,105,-29', {name: 'red_bed'}); },
        activateBlock: async (b) => { events.push(`click ${b.name}`); for (const l of listeners) l('Respawn point set'); },
        on: (n, f) => n === 'messagestr' && listeners.add(f), off: (n, f) => listeners.delete(f),
      };
      return {bot, events, infos, cells: cell, r: {name: 'bot3', bot, world: {hostilesNear: () => []}, combat: {busy: false, epoch: 0}, emit: (k, t) => infos.push(t), protectedAreas: areas}};
    };
    const job = (extra = {}) => ({t: {}, cancelled: false, type: 'homebed', args: {}, ...extra});
    const bed = {name: 'red_bed', count: 1, type: 5};
    let f = fakeHome({inv: [{...bed}]});
    await JOBS.homebed(f.r, job());
    assert.deepStrictEqual(f.events.filter((e) => /^(equip|look|place|click)/.test(e)), ['equip red_bed', 'look 0', 'place -330,105,-28 ignore', 'click red_bed'], 'looks north, places on the foot cell, clicks');
    assert.ok(f.events.includes('goto -330 -29'), 'stands in the head cell to place');
    assert.ok(f.infos.some((m) => /placed red_bed at -330 105 -28/.test(m)) && f.infos.some((m) => /spawn set at -330 105 -28/.test(m)), f.infos.join('|'));
    f = fakeHome({blocks: room({'-330,105,-28': {name: 'red_bed'}, '-330,105,-29': {name: 'red_bed'}})}); // slot taken by a bed: click only, nothing fetched
    await JOBS.homebed(f.r, job());
    assert.deepStrictEqual(f.events.filter((e) => /^(equip|look|place|click)/.test(e)), ['click red_bed']);
    // a bed already stands on one cell only (other colour, turned another way): clicked, never "in the way" (lab 2026-10-10)
    f = fakeHome({blocks: room({'-330,105,-28': {name: 'white_bed'}, '-330,105,-29': {name: 'air', boundingBox: 'empty'}})});
    await JOBS.homebed(f.r, job());
    assert.deepStrictEqual(f.events.filter((e) => /^(equip|look|place|click)/.test(e)), ['click white_bed']);
    // the bot places a bed and the head lands east, not north: the spawn is still set, and the log says what is there
    f = fakeHome({inv: [{...bed}]});
    f.bot._placeBlockWithOptions = async () => { f.cells.set('-330,105,-28', {name: 'red_bed'}); f.cells.set('-329,105,-28', {name: 'red_bed'}); };
    await JOBS.homebed(f.r, job());
    assert.ok(f.events.includes('click red_bed') && f.infos.some((m) => /did not land facing north: foot red_bed, head cell air, beds next to the foot: -329 105 -28/.test(m)), f.infos.join('|'));
    { // natural blocks in the slot or the standing cell are dug, placed ones refuse
      const dug = [];
      const mk = (blocks) => {
        const cell = new Map(Object.entries(blocks));
        const bot = {blockAt: (p) => { const c = cell.get(`${p.x},${p.y},${p.z}`); return c ? {position: p, ...c} : null; }, inventory: {items: () => [{name: 'red_bed', count: 1}]}, entity: {}, equip: async () => {}, look: async () => {},
          _placeBlockWithOptions: async () => { cell.set('-330,105,-28', {name: 'red_bed'}); cell.set('-330,105,-29', {name: 'red_bed'}); }};
        const {homebed} = HB.makeHomebed({goNear: async () => {}, guard() {}, sleep: async () => {}, goals: {GoalBlock: function () {}}, crafting: {}, at: (c) => `${c.x} ${c.y} ${c.z}`, NATURAL: require('../../bots').NATURAL,
          digAt: async (r, j, p, want) => { const b = bot.blockAt(p); if (!want(b.name)) return false; dug.push(b.name); cell.set(`${p.x},${p.y},${p.z}`, {name: 'air', boundingBox: 'empty'}); return true; },
          run: async (r, j, type) => { dug.push(type); }});
        return {homebed, r: {name: 'bot3', bot, emit() {}, protectedAreas: []}};
      };
      let h = mk(room({'-330,105,-28': {name: 'grass_block', boundingBox: 'block'}, '-330,106,-29': {name: 'dirt', boundingBox: 'block'}}));
      await h.homebed(h.r, job());
      assert.deepStrictEqual(dug.splice(0), ['grass_block', 'dirt', 'bed'], 'natural blocks dug before the check, then placed and clicked');
      h = mk(room({'-330,105,-28': {name: 'oak_planks', boundingBox: 'block'}}));
      await assert.rejects(h.homebed(h.r, job()), /oak_planks is in the way/);
      assert.deepStrictEqual(dug, [], 'a placed block is never dug');
      h = mk(room({'-330,105,-28': {name: 'red_bed'}, '-330,105,-29': {name: 'dirt', boundingBox: 'block'}}));
      await h.homebed(h.r, job());
      assert.deepStrictEqual(dug.splice(0), ['bed'], 'a bed in the slot: nothing is dug');
    }
    f = fakeHome({areas: [[-340, -40, -320, -20]]});
    await assert.rejects(JOBS.homebed(f.r, job()), /protected/);
    assert.deepStrictEqual(f.events, [], 'a protected slot is refused before walking');
    f = fakeHome({blocks: room({'-330,105,-29': {name: 'chest', boundingBox: 'block'}}), inv: [{...bed}]});
    await assert.rejects(JOBS.homebed(f.r, job()), /chest is in the way/);
    f = fakeHome({inv: [{...bed}]});
    f.r.name = 'bot99';
    await assert.rejects(JOBS.homebed(f.r, job()), /no bed slot/);
    await JOBS.homebed(f.r, job({args: {x: -330, y: 105, z: -28}})); // an explicit spot needs no crew slot
    f = fakeHome({inv: [{...bed}]});
    const stopped = job();
    f.bot.equip = async () => { stopped.cancelled = true; };
    await assert.rejects(JOBS.homebed(f.r, stopped), Cancelled);
    assert.ok(!f.events.some((e) => /^(look|place|click)/.test(e)), 'a Stop during the equip places and clicks nothing');
    f = fakeHome(); // no bed, no wool, no sheep around: says what is missing
    await assert.rejects(JOBS.homebed(f.r, job()), /need 3 wool of one colour/);
  }
  { // graves (AxGraves): validation, the pure decisions, then the job against a fake bot
    const {JOBS, VALIDATE, Cancelled} = require('../../bots');
    const G = require('../../graves');
    const {Vec3} = require('vec3');
    assert.deepStrictEqual(VALIDATE.grave({x: 1.9, y: 64, z: -2}), {x: 1, y: 64, z: -2});
    assert.throws(() => VALIDATE.grave({x: 1, y: 999, z: 2}), /y must be/);
    assert.deepStrictEqual(VALIDATE.graves({spots: [{x: 1.8, y: 64, z: 2}]}), {spots: [{x: 1, y: 64, z: 2}]});
    assert.strictEqual(VALIDATE.graves({spots: Array.from({length: 50}, (_, x) => ({x, y: 64, z: 0}))}).spots.length, 40);

    const now = Date.now(), ev = (bot, kind, text, age = 0) => ({bot, kind, text, t: now - age});
    assert.deepStrictEqual(G.openGraves([
      ev('bot1', 'death', 'died at 1 64 1: zombie'), ev('bot1', 'death', 'died at 2 64 2: zombie', 25 * 3600000),
      ev('bot2', 'death', 'died at 3 64 3: zombie'), ev('bot1', 'done', 'finished: grave 1 64 1 (65 items)'),
    ], 'bot1', {now, chest: {x: 0, y: 64, z: 0}}), [], 'only recent, own, unfetched graves are returned');
    assert.deepStrictEqual(G.openGraves([ev('bot1', 'death', 'died at 1 64 1: zombie')], 'bot1', {now, chest: {x: 0, y: 64, z: 0}}), [{x: 1, y: 64, z: 1}]);
    // "died at" is rounded, the grave job's spot floored: a fetch a block off after the death took it; a later death there is a new grave
    assert.deepStrictEqual(G.openGraves([ev('bot1', 'death', 'died at -382 71 -238: shot', 3000), ev('bot1', 'done', 'finished: grave -383 71 -239 (227 s)', 2000)],
      'bot1', {now, chest: {x: -271, y: 66, z: -214}}), []);
    assert.deepStrictEqual(G.openGraves([ev('bot1', 'done', 'finished: grave -383 71 -239 (227 s)', 2000), ev('bot1', 'death', 'died at -382 71 -238: shot', 1000)],
      'bot1', {now, chest: {x: -271, y: 66, z: -214}}), [{x: -382, y: 71, z: -238}]);
    // a grave taken inside a graves run counts too; its "N candidates" line does not
    assert.deepStrictEqual(G.openGraves([ev('bot1', 'death', 'died at -351 62 -173: shot', 3000), ev('bot1', 'info', 'grave at -351 62 -173: 4 candidates (armor_stand)', 2000)],
      'bot1', {now, chest: {x: -271, y: 66, z: -214}}), [{x: -351, y: 62, z: -173}]);
    assert.deepStrictEqual(G.openGraves([ev('bot1', 'death', 'died at -351 62 -173: shot', 3000), ev('bot1', 'info', 'grave at -351 62 -173: 8 items back', 2000)],
      'bot1', {now, chest: {x: -271, y: 66, z: -214}}), []);
    // two deaths within 32 blocks in 24 h make a deadly spot (graveAfterDeath's repeat rule): no grave there is sent again.
    // bot1 drowned twice in a flooded tunnel under a lake, and a graves round sent it back a third time (2026-11-19).
    assert.deepStrictEqual(G.openGraves([ev('bot1', 'death', 'died at -161 53 -176: drowned', 500000), ev('bot1', 'death', 'died at -162 53 -175: drowned', 20000),
      ev('bot1', 'death', 'died at -300 64 -100: shot', 10000)], 'bot1', {now, chest: {x: -271, y: 66, z: -214}}), [{x: -300, y: 64, z: -100}]);
    assert.deepStrictEqual(G.openGraves([ev('bot1', 'death', 'died at 5 64 5: drowned', 9000), ev('bot1', 'death', 'died at 5 64 5: drowned', 1000)],
      'bot1', {now, chest: {x: 0, y: 64, z: 0}}), [], 'the same spot twice counts as two deaths');

    // graveCandidates: nearest first within 3 blocks; never players, items, orbs, invalid or far entities
    const ent = (id, name, x, y, z, extra = {}) => ({id, name, type: 'other', position: new Vec3(x, y, z), ...extra});
    const around = [ent(1, 'armor_stand', 0, 65, 1), ent(2, 'text_display', 0, 66.5, 0), ent(3, 'armor_stand', 0, 64, 5), ent(4, 'item', 0, 64, 0), ent(5, 'zombie', 1, 64, 0, {type: 'mob'}), ent(6, 'x', 0, 64, 0, {type: 'player'}), ent(7, 'armor_stand', 0, 64, 1, {isValid: false}), ent(8, 'experience_orb', 0, 64, 0)];
    assert.deepStrictEqual(G.graveCandidates(around, {x: 0, y: 64, z: 0}).map((e) => e.id), [5, 1, 2]);
    assert.deepStrictEqual(G.graveCandidates([], {x: 0, y: 64, z: 0}), []);

    // graveAfterDeath: own overworld death near the base, outside protected areas, once
    const dead = {pos: new Vec3(100.7, 64.2, -50.5), dim: 'minecraft:overworld', chest: {x: 0, y: 64, z: 0}, areas: [[-80, -144, 80, 80]], jobType: 'mine', queued: []};
    assert.deepStrictEqual(G.graveAfterDeath(dead), {x: 100, y: 64, z: -51});
    {
      const {graveAfterDeath: g} = require('../../graves');
      const at = (x) => ({pos: {x, y: 0, z: 0}, dim: 'overworld', chest: {x: 0, y: 66, z: 0}, areas: [], jobType: 'highway', queued: []});
      assert.strictEqual(g(at(1139)), null, 'a road bot deep out rides back for a new load: the grave lies in rock over the road');
      assert.deepStrictEqual(g(at(300)), {x: 300, y: 0, z: 0}, 'near the farms it fetches it');
      assert.deepStrictEqual(g({...at(1139), jobType: 'mine'}), {x: 1139, y: 0, z: 0}, 'other jobs as before');
    }
    for (const [why, o] of [['no chest', {chest: null}], ['nether', {dim: 'the_nether'}], ['no position', {pos: null}], ['protected', {pos: new Vec3(0, 64, 0)}],
      ['too far', {pos: new Vec3(1600, 64, 0)}], ['void', {pos: new Vec3(100, -70, 0)}], ['died on the way to a grave', {jobType: 'grave'}],
      ['already queued', {queued: [{type: 'grave', args: {x: 100, y: 64, z: -51}}]}]]) assert.strictEqual(G.graveAfterDeath({...dead, ...o}), null, why);
    assert.ok(G.graveAfterDeath({...dead, queued: [{type: 'grave', args: {x: 1, y: 2, z: 3}}]}), 'another grave in the queue does not matter');

    // armourPicks: the best piece per slot, only when better than what is worn
    const inv = ['iron_helmet', 'leather_helmet', 'diamond_boots', 'iron_boots', 'stone_sword'].map((name) => ({name, count: 1}));
    assert.deepStrictEqual(G.armourPicks(inv, {head: null, torso: null, legs: null, feet: 'iron_boots'}).map((p) => `${p.slot}:${p.item.name}`), ['head:iron_helmet', 'feet:diamond_boots']);
    assert.deepStrictEqual(G.armourPicks(inv, {head: 'diamond_helmet', torso: null, legs: null, feet: 'netherite_boots'}), []);

    // the job: a fake bot whose grave gives 65 items when right-clicked while sneaking
    const fake = ({entities = [ent(1, 'armor_stand', 0, 65, 0)], gives = [{name: 'iron_sword', count: 1}, {name: 'cobblestone', count: 64}], areas = []} = {}) => {
      const slots = new Array(46).fill(null), events = [], infos = [];
      let sneak = false;
      const bot = {
        entities: Object.fromEntries(entities.map((e) => [e.id, e])), game: {dimension: 'overworld'}, entity: {position: new Vec3(0, 64, 0)},
        inventory: {slots, items: () => slots.filter(Boolean)}, pathfinder: {goto: async () => {}, setGoal() {}, stop() {}},
        getEquipmentDestSlot: (s) => ({head: 5, torso: 6, legs: 7, feet: 8}[s]),
        setControlState: (k, v) => { if (k === 'sneak') { sneak = v; events.push(`sneak ${v}`); } },
        lookAt: async () => {},
        _client: {write: (packet, p) => {
          assert.strictEqual(packet, 'use_entity');
          if (p.mouse === 0) { events.push(`click ${bot.entities[p.target].name} sneaking=${p.sneaking}`); if (sneak && p.sneaking) gives.forEach((g, i) => (slots[9 + i] = {...g, type: i + 1})); }
        }},
        equip: async (item, slot) => events.push(`equip ${item.name} ${slot}`),
      };
      return {bot, events, infos, r: {bot, world: {hostilesNear: () => []}, combat: {busy: false, epoch: 0}, emit: (k, t) => infos.push(t), protectedAreas: areas, supplyChest: {x: 5, y: 64, z: 5}}};
    };
    const graveJob = (extra = {}) => ({t: {}, cancelled: false, type: 'grave', args: {x: 0, y: 64, z: 0}, ...extra});
    const realDeposit = JOBS.deposit;
    const deposits = [];
    JOBS.deposit = async (r, j) => { deposits.push(j.args); };
    try {
      let f = fake();
      let job = graveJob();
      await JOBS.grave(f.r, job);
      assert.deepStrictEqual(f.events, ['sneak true', 'click armor_stand sneaking=true', 'sneak false']);
      assert.strictEqual(job.collected, 65);
      assert.deepStrictEqual(deposits, [{x: 5, y: 64, z: 5}], 'deposits into the supply chest');
      assert.ok(f.infos.some((m) => /^grave at 0 64 0: 65 items back$/.test(m)), f.infos.join('|'));

      // a click that opens a window (a villager next to the grave) leaves nothing open
      f = fake({entities: [ent(1, 'villager', 0, 64, 1), ent(2, 'armor_stand', 0, 65, 0)]});
      const w = f.bot._client.write;
      f.bot._client.write = (packet, p) => { if (p.target === 1) { if (p.mouse === 0) { f.events.push('click villager'); f.bot.currentWindow = {id: 1}; } } else w(packet, p); };
      f.bot.closeWindow = () => { f.events.push('close window'); f.bot.currentWindow = null; };
      await JOBS.grave(f.r, graveJob());
      assert.deepStrictEqual(f.events.filter((e) => /^(click|close)/.test(e)), ['click villager', 'close window', 'click armor_stand sneaking=true']);
      assert.strictEqual(f.bot.currentWindow ?? null, null);

      // armour that came back is put on before the deposit
      f = fake({gives: [{name: 'iron_chestplate', count: 1}]});
      await JOBS.grave(f.r, graveJob());
      assert.ok(f.events.includes('equip iron_chestplate torso'), f.events.join('|'));

      // the second candidate is tried when the first gives nothing
      f = fake({entities: [ent(1, 'armor_stand', 0, 64, 1), ent(2, 'text_display', 0, 65, 0)]});
      const write = f.bot._client.write;
      f.bot._client.write = (packet, p) => { if (p.target === 2) write(packet, p); else if (p.mouse === 0) f.events.push('click armor_stand (dud)'); };
      await JOBS.grave(f.r, graveJob());
      assert.deepStrictEqual(f.events.filter((e) => e.startsWith('click')), ['click armor_stand (dud)', 'click text_display sneaking=true']);

      // refusals and failures; sneak is always released
      await assert.rejects(JOBS.grave(fake({areas: [[-5, -5, 5, 5]]}).r, graveJob()), /protected area/);
      f = fake({entities: []});
      await assert.rejects(JOBS.grave(f.r, graveJob()), /no grave entity within 3 blocks of 0 64 0/);
      f = fake({gives: []});
      await assert.rejects(JOBS.grave(f.r, graveJob()), /gave nothing/);
      assert.strictEqual(f.events.at(-1), 'sneak false');
      deposits.length = 0;
      f = fake();
      job = graveJob();
      f.bot._client.write = () => { job.cancelled = true; };
      await assert.rejects(JOBS.grave(f.r, job), Cancelled);
      assert.deepStrictEqual([f.events.at(-1), deposits.length], ['sneak false', 0], 'a Stop releases sneak and deposits nothing');
      f = fake();
      f.r.supplyChest = null; // no chest: the loot stays in the inventory
      await JOBS.grave(f.r, graveJob());
      assert.strictEqual(deposits.length, 0);
      assert.ok(f.infos.some((m) => /65 items back \(no supply chest/.test(m)));

      f = fake();
      const graveEntities = f.bot.entities;
      const runner = G.makeGraves({goNear: async (_r, _j, x) => { if (x === 2) throw new Error('pathfinder reach error'); f.bot.entities = x === 0 ? graveEntities : {}; }, guard() {}, sleep: async () => {}, deposit: async () => {}});
      const multi = {t: {}, cancelled: false, type: 'graves', args: {spots: [{x: 1, y: 64, z: 0}, {x: 2, y: 64, z: 0}, {x: 0, y: 64, z: 0}]}};
      await runner.graves(f.r, multi);
      assert.strictEqual(multi.done, 3);
      assert.ok(f.infos.some((m) => m === 'graves: 1 of 3 fetched, 1 gone, 1 out of reach'), f.infos.join('|'));
      // a death cancels the job during a grave walk: the walk sees it, the spot stays for the resumed run
      const stopping = {t: {}, cancelled: false, type: 'graves', args: {spots: [{x: 5, y: 64, z: 0}, {x: 6, y: 64, z: 0}]}};
      let walkSaw = null;
      const dies = G.makeGraves({goNear: async (_r, j) => { stopping.cancelled = true; walkSaw = j.cancelled; if (j.cancelled) throw new Error('stopped'); }, guard: (j) => { if (j.cancelled) throw new Error('stopped'); }, sleep: async () => {}, deposit: async () => {}});
      await assert.rejects(dies.graves(f.r, stopping), /stopped/);
      assert.strictEqual(walkSaw, true, 'the grave walk sees the cancelled job');
      assert.deepStrictEqual(stopping.args.spots, [{x: 5, y: 64, z: 0}, {x: 6, y: 64, z: 0}]);
    } finally {
      JOBS.deposit = realDeposit;
    }
  }
};
