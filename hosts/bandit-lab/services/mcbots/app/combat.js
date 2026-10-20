'use strict';
// Self-defence, one per BotRunner, ticking every 500 ms. Targets are hostile
// mobs only (never players, tamed or neutral animals). It may take over the
// pathfinder (retreat / creeper back-off); `epoch` then changes so the running
// job knows to re-issue its goal, and `busy` makes jobs wait until calm.
const {goals} = require('mineflayer-pathfinder');
const {mobLocation, isHostile, shouldFight, normDim, insideAreas, NOTABLE_BLOCKS} = require('./world');
const {CONTAINER} = require('./build');
const {DEFAULTS} = require('./settings');
const {weapon, armour: armourOdds, odds, NIGHT} = require('./odds');

const TICK_MS = 500;

// Health only regenerates at food 18+, so a hurt bot must eat earlier than a healthy one.
const wantsToEat = (food, health, eatBelow) => food < eatBelow || (health < 20 && food < 18);

// Fight instead of wait, from the numbers (odds.js) against a usual night: the old rule (a sword or axe, two armour
// pieces, health above 12; 5 of 8 lab bots stood still at night, 2026-10-10) counted leather and iron alike.
const bestWeapon = (names) => [...names].sort((a, b) => weaponScore(b) - weaponScore(a))[0];
const fightReady = (names, worn, health) => odds({health, weapon: weapon(bestWeapon(names)), armour: armourOdds(worn), threats: NIGHT}).fight;
// A shield held in the off-hand: the bot blocks with it between swings in close fights. It is no armour for fit():
// a "fit" bot with only a shield walked up to two skeletons with it raised, slowed and turned to its path, and
// fared worse than without one (lowest health 1, 14, 0 vs 18, 10, 15; sandbox 2026-10-17).
const hasShield = (bot) => bot.inventory?.slots?.[bot.getEquipmentDestSlot?.('off-hand')]?.name === 'shield';

// Vanilla's death messages (en_us): "bot2 was doomed to fall by Creeper" went unnamed (main server 2026-10-17).
const DEATH_PHRASE = /^(was (slain|shot|speared|killed|blown up|fireballed|pummeled|impaled|skewered|stung|squashed|squished|poked|pricked|doomed to fall|knocked into the void|burned|struck by lightning|frozen|obliterated|roasted|stabbed)|fell|hit the ground|drowned|died|burned|went (up in flames|off with a bang)|tried to swim in lava|discovered the floor was lava|walked into|blew up|suffocated|starved|froze|withered|experienced kinetic energy|didn't want to live|left the confines of this world|removed an elytra)/;
// "bot1 fell from a high place" -> "fell from a high place"; null for chat and other players.
const deathCause = (name, msg) => {
  if (!msg.startsWith(`${name} `)) return null;
  const rest = msg.slice(name.length + 1);
  return DEATH_PHRASE.test(rest) ? rest : null;
};
// A hit counts from up to 6 blocks, eye to hitbox (the server's interaction range 3 plus its allowance for lag 3): bot50
// hit a still creeper from 6.0 blocks, not from 6.5 (sandbox 2026-10-17). A player swings at 3; a bot strikes from 5,
// which leaves room for lag and a mob on the move, and is out of a zombie's reach.
const STRIKE_REACH = 5;
const FIGHT_RANGE = STRIKE_REACH;
const CREEPER_KEEP = 5; // a creeper lights within 3 blocks of its target: the bot backs off below this
const CREEPER_REACH = 5.5; // a creeper is struck from here; the server takes 6 (see STRIKE_REACH)
const CREEPER_SWELL = 16; // metadata index of a creeper's fuse state: 1 while it hisses
const DUEL_MAX_MS = 60000;
const MELEE_KEEP = 4; // a kiting bot backs off from a zombie or spider closer than this
const RANGED = /^(skeleton|stray|bogged|pillager|witch)$/; // shoot from afar: kiting them back gains nothing
const EAT_CLEAR = 8; // eating takes 1.6 s; a zombie covers about 4 blocks in that time
// A mode that has not resolved by then ends, and its mob is left alone for IGNORE_MS (it still gets hit
// at arm's length): a mob behind a wall kept bot1 hunting and bot3 retreating for hours while their
// jobs waited for calm (lab, 2026-10-13).
const MODE_MAX_MS = {hunt: 20000, retreat: 30000, creeper: 15000, air: 20000};
// Air under water runs 20 -> 0 in 15 s, then it hurts. At AIR_LOW the bot drops everything and surfaces.
const AIR_LOW = 12;
const IGNORE_MS = 120000;
const SEE_RANGE = 24;
const SCAN_EVERY = 20; // ticks between notable-block scans (10 s)
const MATERIALS = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'];
const AVOID_FOOD = new Set(['pufferfish', 'spider_eye', 'poisonous_potato', 'rotten_flesh', 'chicken', 'golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew']);

// Swords beat axes (axes hit harder but cool down much slower); higher tier wins.
function weaponScore(name) {
  const m = /^(\w+?)_(sword|axe)$/.exec(name);
  if (!m) return 0;
  const tier = Math.max(0, MATERIALS.indexOf(m[1]));
  return (m[2] === 'sword' ? 100 : 50) + tier;
}

class Combat {
  constructor(runner) {
    this.r = runner;
    this.epoch = 0;
    this.busy = false; // retreating or backing off a creeper
    this.mode = null; // 'hunt' | 'retreat' | 'creeper'
    this.ignore = new Map(); // mob entity id -> until: a mode about it did not resolve
    this.eating = false;
    this.lastAttack = 0;
    this.ticks = 0;
    this.lastOdds = null;
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  // The dashboard settings; a guard job fights whatever the defend setting says (it only walked up to the
  // mob and stood there with defend off, self-test 2026-10-11).
  settings() {
    const s = this.r.getSettings?.() || DEFAULTS;
    return this.r.current?.type === 'guard' && !s.defend ? {...s, defend: true} : s;
  }

  // The weapon it would fight with (the one in hand if no better is carried) and the armour it wears.
  gear() {
    const bot = this.r.bot, held = bot.heldItem?.name, best = bestWeapon(bot.inventory.items().map((i) => i.name));
    const worn = ['head', 'torso', 'legs', 'feet'].map((s) => bot.inventory.slots[bot.getEquipmentDestSlot(s)]?.name).filter(Boolean);
    return {weapon: weapon(held && weaponScore(held) >= weaponScore(best || '') ? held : best), armour: armourOdds(worn)};
  }

  // The odds against these hostiles (creepers aside: duel() kites them); with none, against a usual night if asked.
  odds(mobs, night = false) {
    const me = this.r.bot.entity?.position;
    const threats = me ? mobs.filter((e) => e.name !== 'creeper').map((e) => ({name: e.name, dist: mobLocation(e).position.distanceTo(me)})) : [];
    return odds({health: this.r.bot.health, ...this.gear(), threats: threats.length || !night ? threats : NIGHT});
  }

  // True when this bot can clear the hostiles it sees (or a usual night) and keep more than odds.KEEP health. Fists
  // alone never: the numbers let a bare bot punch out one zombie for 7 health, and that walk gains nothing.
  fit() {
    const bot = this.r.bot, me = bot.entity?.position;
    if (!weaponScore(bestWeapon(bot.inventory.items().map((i) => i.name)) || '')) return false;
    const seen = me ? Object.values(bot.entities || {}).filter((e) => e !== bot.entity && shouldFight(e) && mobLocation(e).position.distanceTo(me) <= SEE_RANGE) : [];
    return this.settings().defend && this.odds(seen, true).fight;
  }

  takeover(mode, target, dist) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.target = target;
    this.since = Date.now();
    this.busy = true;
    this.epoch++;
    this.r.log(this.r.name, `${mode}: away from ${target.name}`);
    this.r.bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(mobLocation(target), dist)), true);
  }

  // Lava or fire within 3 blocks of a mob: do not chase it there (a bot burned
  // to death hunting a zombie, 2026-10-10); it is still fought if it comes close.
  hazardNear(pos) {
    const bot = this.r.bot;
    const ids = ['lava', 'fire', 'soul_fire', 'magma_block'].map((n) => bot.registry.blocksByName[n]?.id).filter((i) => i !== undefined);
    return !!bot.findBlock({matching: ids, point: pos, maxDistance: 3});
  }

  hunt(target) {
    this.r.log(this.r.name, `hunt: ${target.name} at ${Math.round(mobLocation(target).position.distanceTo(this.r.bot.entity.position))}, health ${Math.round(this.r.bot.health)}`);
    this.mode = 'hunt';
    this.target = target;
    this.since = Date.now();
    this.busy = true;
    this.epoch++;
    this.r.bot.pathfinder.setGoal(new goals.GoalFollow(mobLocation(target), 3), true); // strikes reach 5, a zombie 1.5
  }

  // The shield, if one is in the off-hand: up between swings (it counts after 5 ticks, so it guards most of a sword's
  // 0.65 s), down for the swing and when no hostile is close (a raised shield keeps the bot from digging and eating).
  // A player rarely times this; a bot does it every swing (owner, 2026-10-17).
  block(up) {
    const bot = this.r.bot;
    if (up === !!this.blocking || (up && !hasShield(bot))) return;
    this.blocking = up;
    if (up) bot.activateItem(true);
    else bot.deactivateItem();
  }

  // Head out of the water: swim up, and walk to the nearest cell that has air over a water or air cell (stand in the
  // lower one, breathe in the upper one). Everything else waits meanwhile (busy).
  surface() {
    const bot = this.r.bot;
    if (bot.targetDigBlock) bot.stopDigging();
    this.block(false); // a raised shield slows the swim
    this.unsteer?.();
    // Open water up to the air: swimming up is enough, and the pathfinder would only fight the jump (it let go of it,
    // and bot50 hung at y 60 in a pool with no air left, sandbox 2026-10-17). Under a roof: the nearest air it reaches.
    const at = bot.entity.position.floored();
    this.straightUp = false;
    let roof = null;
    for (let dy = 1; dy <= 24; dy++) {
      const b = bot.blockAt(at.offset(0, dy, 0));
      if (/^(cave_)?air$/.test(b?.name || '')) { this.straightUp = true; break; }
      if (!b || (b.name !== 'water' && b.boundingBox !== 'empty')) { roof = b; break; }
    }
    const ids = ['air', 'cave_air'].map((n) => bot.registry.blocksByName[n]?.id).filter((i) => i !== undefined);
    // Only above its feet: the nearest air was a cave under the pool floor (sandbox 2026-10-17).
    const feet = bot.entity.position.y;
    const spot = this.straightUp ? null : bot.findBlock({matching: ids, maxDistance: 12, useExtraInfo: (b) => { const under = bot.blockAt(b.position.offset(0, -1, 0)); return b.position.y > feet && !!under && (under.name === 'water' || under.boundingBox === 'empty'); }});
    // Air within about 2 blocks: it swims there itself. The pathfinder never made the one block to -221 47 -211, and
    // bot1 drowned beside it (main server 2026-10-19).
    const near = !!spot && spot.position.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.62, 0)) <= 2.5;
    // No air at all: it digs out the roof over its head, and the hole is the air. Not in a protected area, not a block
    // that holds items, and not under water or lava.
    const dig = !this.straightUp && !spot && !!roof && bot.canDigBlock(roof) && !CONTAINER.test(roof.name)
      && !insideAreas(this.r.protectedAreas, roof.position.x, roof.position.z, roof.position.y)
      && !/water|lava/.test(bot.blockAt(roof.position.offset(0, 1, 0))?.name || '');
    this.mode = 'air';
    this.target = null;
    this.since = Date.now();
    this.busy = true;
    const epoch = ++this.epoch;
    const p = (v) => `${v.x} ${v.y} ${v.z}`;
    this.r.log(this.r.name, `air ${bot.ownAir ?? bot.oxygenLevel}: surfacing ${this.straightUp ? 'straight up' : spot ? `to ${p(spot.position)}${near ? ', swimming' : ''}` : dig ? `through the ${roof.name} at ${p(roof.position)}` : 'with no air in sight'}`);
    bot.pathfinder.setGoal(spot && !near ? new goals.GoalBlock(spot.position.x, spot.position.y - 1, spot.position.z) : null, !!spot && !near);
    bot.setControlState('jump', !dig); // a bot on the ground digs 5 times faster than a floating one
    if (near) this.steer(spot.position.offset(0.5, 0, 0.5));
    if (dig) this.digUp(roof, epoch).catch((e) => this.r.log(this.r.name, `air: could not dig the ${roof.name}: ${e.message}`));
  }

  // Swims at the air cell every physics tick: forward until the bot is under it, and up all along.
  steer(to) {
    const bot = this.r.bot;
    const go = () => {
      const far = Math.hypot(to.x - bot.entity.position.x, to.z - bot.entity.position.z) > 0.3;
      if (far) bot.lookAt(to, true).catch(() => {});
      bot.setControlState('forward', far);
      bot.setControlState('jump', true);
    };
    bot.on('physicsTick', go);
    this.unsteer = () => { bot.removeListener('physicsTick', go); bot.setControlState('forward', false); this.unsteer = null; };
    go();
  }

  // Stands on the floor first (under water a floating bot digs 25 times slower than on land, a standing one 5 times),
  // digs the roof, then swims up into the hole.
  async digUp(roof, epoch) {
    const bot = this.r.bot;
    for (let i = 0; i < 6 && !bot.entity.onGround; i++) await new Promise((res) => setTimeout(res, 250));
    if (this.epoch !== epoch) return;
    await bot.tool?.equipForBlock(roof, {}).catch(() => {});
    if (this.epoch !== epoch) return;
    await bot.dig(roof, true);
    if (this.epoch !== epoch) return;
    this.straightUp = true;
    bot.setControlState('jump', true);
  }

  release() {
    if (!this.mode) return;
    if (this.mode === 'air') {
      this.unsteer?.();
      this.r.bot.setControlState('jump', false);
    }
    this.block(false);
    this.mode = null;
    this.target = null;
    this.busy = false;
    this.epoch++;
    this.r.bot.pathfinder.setGoal(null);
  }

  async tick() {
    const {r} = this;
    const bot = r.bot;
    if (!r.online || !bot?.entity || this.dueling) return; // a creeper duel runs tick by tick on its own
    this.ticks++;
    // Air before anything else: 6 drownings in a day, bot1 three times at -228 29 -205, mining and then back for its
    // grave (main server 2026-10-17). Nothing in the bots watched the air.
    // Only with its head in water, and its own air (bots.js ownAir): mineflayer's oxygenLevel is any entity's.
    const eye = bot.blockAt?.(bot.entity.position.offset(0, 1.62, 0));
    const wet = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(eye?.name || '') || eye?.getProperties?.().waterlogged === true;
    const air = wet ? bot.ownAir ?? bot.oxygenLevel ?? 20 : 20;
    // Done by its own air, not by the first breath: else a job takes it back under with next to none left.
    if (this.mode === 'air' && (wet ? air : bot.ownAir ?? 20) >= 18) this.release();
    else if (this.mode === 'air' && Date.now() - this.since <= MODE_MAX_MS.air) return void (this.straightUp && bot.setControlState('jump', true));
    if (air <= AIR_LOW) return this.surface(); // also again after MODE_MAX_MS: another search from where it is now
    const dim = normDim(bot.game?.dimension);
    const me = bot.entity.position;

    const seen = Object.values(bot.entities).filter((e) => e !== bot.entity && isHostile(e) && mobLocation(e).position.distanceTo(me) <= SEE_RANGE);
    for (const e of seen) r.world.noteMob(r.name, e, dim);
    if (this.ticks % SCAN_EVERY === 0) this.scanBlocks(dim);
    // Only mobs that actually threaten the bot drive retreat/back-off/attack;
    // endermen, piglins and the like are seen and shared but left alone.
    const s = this.settings();
    const now = Date.now();
    for (const [id, until] of this.ignore) if (until < now) this.ignore.delete(id);
    const threats = seen.filter(shouldFight).sort((a, b) => mobLocation(a).position.distanceTo(me) - mobLocation(b).position.distanceTo(me));
    const close = threats[0], closeDist = close ? mobLocation(close).position.distanceTo(me) : Infinity;
    const near = threats.find((e) => !this.ignore.has(e.id));
    const dist = near ? mobLocation(near).position.distanceTo(me) : Infinity;
    // Numbers, not a fixed health line: three zombies cost an unarmoured bot 13 health, an iron one 2 (arena 2026-10-18).
    const forecast = this.odds(threats.filter((e) => mobLocation(e).position.distanceTo(me) <= 16));
    if (near && near.name !== 'creeper') {
      const key = `${near.name}:${forecast.fight}`;
      if (this.lastOdds !== key) r.log(r.name, `odds: ${threats.filter((e) => e.name !== 'creeper').length} ${near.name} -> ${forecast.fight ? 'fight' : 'keep away'} (loss ~${Math.round(forecast.loss)} of ${Math.round(bot.health)}, ${Math.round(forecast.secs)} s)`);
      this.lastOdds = key;
    } else this.lastOdds = null;

    if (this.mode && now - this.since > MODE_MAX_MS[this.mode]) {
      if (this.target) this.ignore.set(this.target.id, now + IGNORE_MS);
      r.log(r.name, `${this.mode}: gave up on ${this.target?.name || 'a mob'} after ${Math.round((now - this.since) / 1000)} s`);
      return this.release(); // the next tick sees the mob ignored
    }
    // Retreat until healthy again or nothing hostile is close, eating meanwhile (health only comes back at food 18+).
    if (this.mode === 'retreat') {
      if (bot.health >= Math.min(20, s.retreatHealth + 4) || dist > 16) this.release();
      else if (!r.inventoryBusy && !bot.currentWindow) await this.eat();
      return;
    }
    // In a night shelter (bots.js nightShelter) a bot only hits what reaches it: no walk out to hunt or flee.
    // Hurt: it kites what comes close (backwards, striking from STRIKE_REACH; a zombie reaches 1.5). Running off turned
    // its back on them: bot1 and bot2 died some 20 times in one night "retreating to heal", 5 to 10 zombie hits each
    // (main server 2026-10-17). From archers alone it still walks off, out of their range.
    if (near && (bot.health < s.retreatHealth || !forecast.fight) && dist <= 16 && !r.sheltered) {
      const melee = threats.find((e) => !RANGED.test(e.name) && mobLocation(e).position.distanceTo(me) < 8);
      return melee ? this.duel(melee, {all: true}) : this.takeover('retreat', near, 20);
    }
    // Hunt: walk up to a hostile within the fight range (skeletons shoot from afar).
    if (this.mode === 'hunt' && (!near || !s.defend || dist > s.fightRange + 4 || near !== this.target)) this.release();
    if (this.mode === 'creeper' && (!near || near.name !== 'creeper' || dist > 8)) this.release();

    // A creeper: a fit bot strikes it from STRIKE_REACH, where it does not light, and steps back while it is closer than
    // CREEPER_KEEP. Backing off alone let one blow up the iron farm's material chest beside bot1 (main server
    // 2026-10-17); fought at arm's length it took bot50 to 3 health. An unfit bot still only backs off.
    const creeper = threats.find((e) => e.name === 'creeper' && mobLocation(e).position.distanceTo(me) < 6); // an ignored one too, once close
    if (creeper && !r.sheltered) return this.duel(creeper); // kited by any bot: walking backwards keeps it off, armour or not
    if (this.blocking && closeDist > 6) this.block(false);
    if (close && s.defend && closeDist <= FIGHT_RANGE && (!this.busy || this.mode === 'hunt')) return this.fight(close);
    // Only a fit bot walks up to a mob, never to a creeper: bot2, unarmoured and unarmed, hunted a creeper and was blown
    // up, and died four times in ten minutes (main server 2026-10-16). An unfit bot still hits what comes close.
    if (near && near.name !== 'creeper' && (this.fit() || this.r.current?.type === 'guard') && s.defend && dist <= s.fightRange && !this.busy && !r.sheltered && !this.r.inventoryBusy && !bot.currentWindow && !this.hazardNear(mobLocation(near).position)) return this.hunt(near);
    // Eat unless a hostile is close: at night one is nearly always within the 24 blocks a bot sees, and bot50 held
    // bread at food 6 for minutes with a zombie 16 blocks off, until it fled at 2.5 health and died (sandbox 2026-10-15).
    if (!this.busy && dist > EAT_CLEAR && !this.r.inventoryBusy && !bot.currentWindow) await this.eat();
  }

  // Swapping to a weapon (or striking) mid-dig leaves the dig running with the
  // wrong item: the server counts its slower break time and refuses the block, and
  // the bot waits for an answer that never comes. End the dig first; digAt() digs
  // again once the fight is over (2026-10-10).
  async armUp() {
    const bot = this.r.bot;
    this.lastFight = Date.now();
    if (bot.targetDigBlock) bot.stopDigging();
    const weapon = bot.inventory.items().sort((a, b) => weaponScore(b.name) - weaponScore(a.name))[0];
    // Keep an axe or sword already in hand (a bot chopping with an axe fights
    // with it instead of swapping to the sword and then chopping with that).
    const armed = /_(axe|sword)$/.test(bot.heldItem?.name || '');
    if (!armed && !this.r.inventoryBusy && !bot.currentWindow && weapon && weaponScore(weapon.name) && bot.heldItem?.type !== weapon.type) await bot.equip(weapon, 'hand').catch(() => {});
  }

  // Creepers, tick by tick: the combat tick is 500 ms, a creeper closes a block in that, and struck that late (after a
  // crit jump) one lit and blew up beside bot50 (sandbox 2026-10-17). The bot kites them as a good player does: it faces
  // them and walks backwards (4.3 blocks a second, a creeper makes about 2.6) while the nearest is closer than
  // CREEPER_KEEP, away from all of them at once, and strikes the nearest whenever the sword is ready and it is within
  // CREEPER_REACH; each hit knocks it back a block. The pathfinder backed off too slowly, and with three creepers
  // around it walked into the next one (bot50 down to 6 health).
  // all: every hostile, as a hurt bot kites them (MELEE_KEEP, STRIKE_REACH for those that are no creeper).
  async duel(first, {all = false} = {}) {
    const bot = this.r.bot;
    Object.assign(this, {dueling: true, mode: all ? 'kite' : 'creeper', target: first, since: Date.now(), busy: true});
    this.epoch++;
    this.block(false);
    bot.pathfinder.setGoal(null);
    let struck = 0;
    const around = (match) => Object.values(bot.entities).filter((e) => e !== bot.entity && e.isValid !== false && match(e))
      .map((e) => ({e, at: mobLocation(e).position, d: mobLocation(e).position.distanceTo(bot.entity.position)})).sort((a, b) => a.d - b.d);
    // Each hit knocks a creeper back past 6 blocks, and it takes some 5 s to kill one: the duel goes on while they come.
    // One that stays out of reach for 8 s (behind a wall, say) is left alone, unless it comes close again.
    const came = new Map(); // creeper id -> when it was last within reach (or first seen)
    const creepers = () => around((e) => (all ? shouldFight(e) : e.name === 'creeper')).filter((c) => c.d < 6 || !this.ignore.has(c.e.id));
    const keep = (e) => (e.name === 'creeper' ? CREEPER_KEEP : MELEE_KEEP), reach = (e) => (e.name === 'creeper' ? CREEPER_REACH : STRIKE_REACH);
    try {
      await this.armUp();
      const cooldown = (bot.heldItem?.name.endsWith('_axe') ? 1000 : 625) + 30;
      for (const end = Date.now() + DUEL_MAX_MS; Date.now() < end && this.r.online;) {
        const near = creepers(), now = Date.now();
        for (const c of near) {
          if (c.d <= reach(c.e) + 1.5 || !came.has(c.e.id)) came.set(c.e.id, now);
          else if (now - came.get(c.e.id) > 8000) this.ignore.set(c.e.id, now + IGNORE_MS);
        }
        if (!near.length || near[0].d > 10) break;
        const {e, d, at} = near[0];
        this.target = e;
        // Away from all of them: their middle, the near ones weighing most.
        const me = bot.entity.position;
        let ax = 0, az = 0;
        for (const c of near.filter((x) => x.d < 8)) {
          const w = 1 / Math.max(1, c.d) ** 2;
          ax += (me.x - c.at.x) * w;
          az += (me.z - c.at.z) * w;
        }
        const len = Math.hypot(ax, az) || 1;
        // Closer than CREEPER_KEEP, or one hissing within 7: its fuse goes out once its target is further off.
        const hiss = near.some((c) => c.d <= 7 && c.e.metadata?.[CREEPER_SWELL] === 1);
        const back = (d < keep(e) || hiss) && this.safeStep(me, ax / len, az / len);
        if (back) bot.lookAt(me.offset(-ax / len, 1.62, -az / len), true).catch(() => {}); // facing them, back is away
        bot.setControlState('back', back);
        // The nearest creeper in reach, else another hostile in reach (a zombie walking up meanwhile).
        const hit = d <= reach(e) ? {e, at} : around((x) => x.name !== 'creeper' && shouldFight(x)).find((x) => x.d <= STRIKE_REACH);
        if (hit && Date.now() - this.lastAttack >= cooldown) {
          if (!back) bot.lookAt(hit.at.offset(0, hit.e.height * 0.8, 0), true).catch(() => {});
          this.lastAttack = this.lastFight = Date.now();
          bot.attack(hit.e);
          this.hits = (this.hits || 0) + 1;
          struck++;
        }
        await bot.waitForTicks(1);
      }
      this.r.log(this.r.name, `${all ? 'kite' : 'creeper'}: ${creepers().length ? 'left some' : 'none left'} after ${struck} hits, health ${Math.round(bot.health)}`);
    } finally {
      bot.setControlState('back', false);
      Object.assign(this, {dueling: false, mode: null, target: null, busy: false});
      this.epoch++;
    }
  }

  // Is a step from `me` in direction (dx, dz) safe on foot: room for the body, no fluid, ground at most 2 down?
  safeStep(me, dx, dz) {
    const bot = this.r.bot;
    const at = me.offset(dx, 0, dz).floored();
    const passable = (b) => !!b && b.boundingBox === 'empty' && !/water|lava|fire/.test(b.name);
    if (!passable(bot.blockAt(at)) || !passable(bot.blockAt(at.offset(0, 1, 0)))) return false;
    for (let dy = 1; dy <= 3; dy++) {
      const b = bot.blockAt(at.offset(0, -dy, 0));
      if (!b || /water|lava|fire|magma/.test(b.name)) return false;
      if (b.boundingBox === 'block') return dy <= 3;
    }
    return false;
  }

  async fight(target) {
    const bot = this.r.bot;
    await this.armUp();
    // Precision a player cannot match: swing exactly when the weapon is fully
    // charged (full damage, and a sword sweeps every mob around), and make it a
    // critical hit (x1.5, the sparkles) by jumping and striking on the way down.
    const cooldown = (bot.heldItem?.name.endsWith('_axe') ? 1000 : 625) + 30; // attack speed 1.0 / 1.6 per s, plus a tick of slack
    const wait = cooldown - (Date.now() - this.lastAttack);
    if (this.striking || target.isValid === false) return;
    const aim = () => bot.lookAt(mobLocation(target).position.offset(0, (target.vehicle?.height || 0) + target.height * 0.8, 0), true).catch(() => {});
    await aim();
    if (wait > 450) return this.block(true); // the next tick comes in 500 ms
    this.striking = true;
    try {
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      // A sword sweep (ground hit) beats a crit when two or more hostiles stand together.
      const bunch = Object.values(bot.entities).filter((e) => e !== target && shouldFight(e) && mobLocation(e).position.distanceTo(mobLocation(target).position) <= 2).length;
      const sweep = bunch > 0 && bot.heldItem?.name.endsWith('_sword');
      const crit = !sweep && bot.entity.onGround && !bot.entity.isInWater && !bot.entity.isInLava && mobLocation(target).position.distanceTo(bot.entity.position) <= STRIKE_REACH;
      if (crit) {
        bot.setControlState('jump', true);
        await bot.waitForTicks(1);
        bot.setControlState('jump', false);
        for (let i = 0; i < 12 && !(bot.entity.velocity.y < 0); i++) await bot.waitForTicks(1); // apex of the jump
      }
      if (target.isValid === false || mobLocation(target).position.distanceTo(bot.entity.position) > STRIKE_REACH + 0.5) return;
      await aim();
      this.block(false); // no swing with the shield up
      this.lastAttack = Date.now();
      bot.attack(target);
      this.block(true); // up again at once: it counts from 5 ticks on
      this.hits = (this.hits || 0) + 1;
      if (crit) this.crits = (this.crits || 0) + 1;
    } finally {
      bot.setControlState('jump', false);
      this.striking = false;
    }
  }

  async eat() {
    const bot = this.r.bot;
    if (this.eating || !wantsToEat(bot.food, bot.health, (this.r.getSettings?.() || DEFAULTS).eatBelow)) return;
    this.block(false); // a raised shield would keep the food from being eaten
    const best = (ok) => bot.inventory.items()
      .filter((i) => bot.registry.foodsByName[i.name] && ok(i.name))
      .sort((a, b) => bot.registry.foodsByName[b.name].foodPoints - bot.registry.foodsByName[a.name].foodPoints)[0];
    // Starving or nearly dead with nothing better (bot3 at food 0 and health 7 with three rotten flesh, main server
    // 2026-10-16): rotten flesh still gives 4 food, and its hunger effect costs less than no regeneration at all.
    const food = best((n) => !AVOID_FOOD.has(n)) || (bot.food <= 6 || bot.health <= 8 ? best((n) => n === 'rotten_flesh') : null);
    if (!food) return;
    this.eating = true;
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
    } catch {} finally {
      this.eating = false;
    }
  }

  scanBlocks(dim) {
    const bot = this.r.bot;
    const ids = NOTABLE_BLOCKS.map((n) => bot.registry.blocksByName[n]?.id).filter((i) => i !== undefined);
    for (const pos of bot.findBlocks({matching: ids, maxDistance: 32, count: 16})) {
      const b = bot.blockAt(pos);
      if (b) this.r.world.noteBlock(this.r.name, b.name, pos, dim);
    }
  }
}

module.exports = {Combat, weaponScore, AVOID_FOOD, wantsToEat, deathCause, fightReady, hasShield};
