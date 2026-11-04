'use strict';
// Hub side of the in-game bot UI: polls the Paper plugin (BotUi) for player events, keeps one state per viewer and
// shows or refreshes their dialog. Identity is only ever the plugin's Bukkit player name, never a payload field, and
// a dialog the player closed is never shown again: only a new open or click event may open one.
const FLASH_MS = 30000;

// One handler per click `data.a`; later tasks add theirs here. (st, data, ui, viewer) -> void, may be async, may throw.
// Every handler that touches bots checks the viewer's rights itself (allowedBots / owner); the data is the player's input.
const QUICK_LABEL = Object.fromEntries(require('./botui-screens').QUICK);
const {explain, ZOOMS} = require('./botui-screens');
const {botState} = require('./ingame');
const jobs = require('./botui-jobs');
const ownerOnly = (ui, viewer) => { if (ui.viewerBots[viewer] !== '*') throw new Error('nur für den Besitzer'); };
const oneBot = (ui, viewer, data) => allowedBots(ui.viewerBots, viewer, [data.bot])[0];
const on = (data) => data.on === 1 || data.on === true;
const KIND = {sticks: 'Stick-Kiste', stores: 'Smaragd-Kiste'};
const traderOf = (ui, viewer, data) => {
  const bot = oneBot(ui, viewer, data);
  if (!ui.api.traders().includes(bot)) throw new Error('kein Händler');
  return bot;
};
const done = (r) => { if (r?.unreached?.length) throw new Error('nicht erreichbar'); };

const box = (p, q) => ({x1: Math.min(p.x, q.x), y1: Math.min(p.y, q.y), z1: Math.min(p.z, q.z), x2: Math.max(p.x, q.x), y2: Math.max(p.y, q.y), z2: Math.max(p.z, q.z)});
const outline = (ui, viewer, b) => ui.call('/outline', {player: viewer, box: b}).catch((e) => ui.log(`botui ${viewer}: outline: ${e.message}`));
const clearSel = async (st, ui, viewer) => { st.sel = {a: null, b: null, dim: null}; await outline(ui, viewer, null); };

// What the map item shows for a viewer: only the bots they may see, only with a known place and world.
const MARK = {work: 'work', sheltered: 'idle', idle: 'idle', error: 'bad', dead: 'bad', offline: 'off'};
function markersOf(snaps, allowed) {
  return snaps.filter((s) => (allowed === '*' || allowed.includes(s.name)) && Array.isArray(s.pos) && s.pos.length >= 3 && Number.isFinite(s.pos[0]) && Number.isFinite(s.pos[2]) && typeof s.dimension === 'string')
    .map((s) => ({x: s.pos[0], z: s.pos[2], dim: s.dimension, kind: MARK[botState(s)] || 'idle', label: String(s.name).slice(0, 16)}));
}

const ACTIONS = {
  // `none` after_action keeps the dialog open on the client, so the plugin clears it; Escape closes it either way.
  close: async (st, data, ui, viewer) => {
    st.open = false; // the plugin stops tracking on its own, no `closed` follows
    await ui.call('/close', {player: viewer}).catch((e) => ui.log(`botui ${viewer}: close: ${e.message}`));
  },
  lage: (st) => { st.screen = {name: 'lage'}; },
  bot: (st, data, ui, viewer) => { st.screen = {name: 'bot', bot: oneBot(ui, viewer, data)}; },
  stop: (st, data, ui, viewer) => {
    const bot = oneBot(ui, viewer, data);
    done(ui.api.submit(viewer, {bots: [bot], type: 'stop', args: {}}));
    ui.flash(st, `${bot}: gestoppt`, true);
  },
  new: (st, data, ui, viewer) => { st.screen = {name: 'auftrag', ...(data.bot !== undefined ? {bot: oneBot(ui, viewer, data)} : {})}; },
  job: (st, data, ui, viewer) => {
    if (!jobs.hasJob(data.key)) throw new Error('unbekannter Auftrag');
    if (!jobs.mayOrder(ui.viewerBots[viewer], data.key)) throw new Error('Diesen Auftrag darfst du nicht erteilen');
    st.screen = {name: 'job', key: data.key, preset: jobs.presetOf(data, jobs.JOBS[data.key]), ...(data.bot !== undefined ? {bot: oneBot(ui, viewer, data)} : {})};
  },
  // Every field is the player's input: jobs.build validates all of it, then VALIDATE has the last word (dashboard path).
  send: async (st, data, ui, viewer) => {
    try {
      const o = jobs.build(data.key, data, {ctx: st.ctx, sel: st.sel, supply: jobs.supplyOf(ui.api.keeper), places: ui.api.places(), snaps: ui.api.snapshots(),
        allowed: ui.viewerBots[viewer], schematics: await ui.api.schematics()});
      const r = ui.api.submit(viewer, {bots: o.bots, type: o.type, args: o.args, replace: o.replace});
      done(r);
      if (r?.skipped?.length === o.bots.length) { // nothing was queued (graves: none open)
        ui.flash(st, o.type === 'graves' ? 'Keine offenen Gräber' : 'Nichts zu tun');
        st.screen = {name: 'lage'};
        return;
      }
      ui.flash(st, (o.bots.length > 1 ? o.bots.length + ' Bots' : o.bots[0]) + ': ' + o.say, true);
      st.screen = {name: 'lage'};
      if (o.area) await clearSel(st, ui, viewer);
    } catch (e) {
      ui.flash(st, 'Geht nicht: ' + explain(e.message));
      if (!(st.screen.name === 'job' && st.screen.key === data.key)) st.screen = {name: 'auftrag'};
    }
  },
  corner: async (st, data, ui, viewer) => {
    ownerOnly(ui, viewer); // area jobs are the owner's
    const g = st.ctx.gaze, dim = st.ctx.dim;
    st.screen = {name: 'auftrag'};
    if (data.which !== 'a' && data.which !== 'b') throw new Error('unbekannte Ecke');
    if (!g) return ui.flash(st, 'Du schaust auf keinen Block');
    const corner = {x: g.x, y: g.y, z: g.z, dim};
    if (data.which === 'b' && !st.sel.a) return ui.flash(st, 'Erst Ecke A setzen');
    if (data.which === 'b' && jobs.dimOf(st.sel.a.dim) !== jobs.dimOf(dim)) return ui.flash(st, 'Ecken in verschiedenen Welten');
    if (data.which === 'a') st.sel = {a: corner, b: null, dim};
    else st.sel.b = corner;
    await outline(ui, viewer, st.sel.b ? box(st.sel.a, st.sel.b) : box(corner, corner));
    if (data.which === 'a') { // a dialog freezes the player: close it so they can walk to the second corner
      ui.flash(st, `Ecke A gesetzt: ${g.x} ${g.y} ${g.z}`, true);
      await ACTIONS.close(st, data, ui, viewer);
    }
  },
  clearsel: async (st, data, ui, viewer) => { await clearSel(st, ui, viewer); st.screen = {name: 'auftrag'}; },
  stopall: (st, data, ui, viewer) => { ownerOnly(ui, viewer); st.screen = {name: 'stopall'}; },
  stopall_ok: (st, data, ui, viewer) => {
    ownerOnly(ui, viewer);
    const r = ui.api.stopAll(viewer);
    st.screen = {name: 'lage'};
    ui.flash(st, 'Alle gestoppt' + (r?.keeperOff ? ', Daueraufträge aus' : ''), true);
  },
  quick: (st, data, ui, viewer) => {
    const bot = oneBot(ui, viewer, data), label = Object.hasOwn(QUICK_LABEL, data.job) && QUICK_LABEL[data.job];
    if (!label) throw new Error('unbekannter Auftrag');
    if (!jobs.mayOrder(ui.viewerBots[viewer], data.job)) throw new Error('Diesen Auftrag darfst du nicht erteilen');
    let args = {};
    if (data.job === 'deposit' || data.job === 'rearm') {
      const c = ui.api.keeper?.state().chest;
      if (!c) throw new Error('keine Vorratskiste eingestellt');
      args = {x: c.x, y: c.y, z: c.z};
    }
    done(ui.api.submit(viewer, {bots: [bot], type: data.job, args}));
    ui.flash(st, `${bot}: ${label} gestartet`, true);
  },
  ziele: (st) => { st.screen = {name: 'ziele'}; },
  // The plugin moves or creates the viewer's map item; a full inventory comes back as an error and the Lagebild stays.
  karte: async (st, data, ui, viewer) => {
    const r = await ui.call('/map/give', {player: viewer});
    if (!r.ok) { st.screen = {name: 'lage'}; return ui.flash(st, `Keine Karte: ${r.error || 'unbekannter Fehler'}`); }
    st.screen = {name: 'karte'};
    await ui.pushMap(viewer, st);
  },
  zoom: async (st, data, ui, viewer) => {
    st.screen = {name: 'karte'};
    if (!ZOOMS.includes(data.z)) throw new Error('ungültiger Zoom');
    st.mapState.zoom = data.z;
    await ui.pushMap(viewer, st);
  },
  center: async (st, data, ui, viewer) => {
    st.screen = {name: 'karte'};
    st.mapState.center = data.me ? null : oneBot(ui, viewer, data);
    await ui.pushMap(viewer, st);
  },
  // The toggles flip a server-side switch: owner only for keeper and plan, the sidebar is each viewer's own.
  keeper: (st, data, ui, viewer) => {
    ownerOnly(ui, viewer);
    if (!ui.api.keeper) throw new Error('keine Daueraufträge eingerichtet');
    ui.api.keeper.setEnabled(on(data));
    st.screen = {name: 'ziele'};
  },
  plan: (st, data, ui, viewer) => {
    ownerOnly(ui, viewer);
    if (!ui.api.plan) throw new Error('kein Plan eingerichtet');
    ui.api.plan.setEnabled(on(data));
    st.screen = {name: 'ziele'};
  },
  sidebar: (st, data, ui, viewer) => {
    ui.api.sidebar(viewer, on(data));
    st.screen = {name: 'ziele'};
    ui.flash(st, on(data) ? 'Seitenleiste an' : 'Seitenleiste aus', true);
  },
  // Dynamic action: the sliders arrive as want_<item>. A bad item or number throws from setWant; earlier ones are already saved.
  saveziele: (st, data, ui, viewer) => {
    ownerOnly(ui, viewer);
    st.screen = {name: 'ziele'};
    if (!ui.api.keeper) return ui.flash(st, 'Keine Daueraufträge eingerichtet');
    const known = new Set((ui.api.keeper.state().configured || ui.api.keeper.state().quotas).map((q) => q.item));
    const wants = Object.entries(data).filter(([key]) => key.startsWith('want_')).map(([key, v]) => [key.slice(5), Math.round(Number(v))]);
    // all or nothing: a bad entry must not leave the earlier ones saved
    for (const [item, n] of wants) if (!known.has(item) || !(n >= 0 && n <= 4096)) throw new Error(`ungültiges Ziel: ${item}`);
    for (const [item, n] of wants) ui.api.keeper.setWant(item, n);
    const n = wants.length;
    ui.flash(st, n ? 'Ziele gespeichert' : 'Nichts zu speichern', !!n);
  },
  // The chest is the one the player is looking at: coordinates are never taken from the click.
  trader_add: (st, data, ui, viewer) => {
    const bot = traderOf(ui, viewer, data), g = st.ctx.gaze;
    st.screen = {name: 'auftrag'};
    if (!KIND[data.kind]) throw new Error('unbekannte Kiste');
    if (jobs.dimOf(st.ctx.dim) !== 'overworld') return ui.flash(st, 'Nur in der Oberwelt');
    if (!g || !jobs.isChest(g.block)) return ui.flash(st, 'Du schaust keine Kiste an');
    ui.api.traderChests.add(bot, data.kind, {x: g.x, y: g.y, z: g.z});
    ui.flash(st, `${bot}: ${KIND[data.kind]} ${g.x} ${g.y} ${g.z}`, true);
  },
  trader_del: (st, data, ui, viewer) => {
    const bot = traderOf(ui, viewer, data);
    st.screen = {name: 'ziele'};
    if (!KIND[data.kind]) throw new Error('unbekannte Kiste');
    ui.api.traderChests.remove(bot, data.kind, {x: data.x, y: data.y, z: data.z});
    ui.flash(st, 'Kiste entfernt', true);
  },
};

class BotUi {
  constructor({url, token, viewerBots, api, log, now = Date.now, fetch = globalThis.fetch, refreshMs = 5000, idleLimitMs = 600000, retryMs = 2000, screens = require('./botui-screens')}) {
    Object.assign(this, {url, token, viewerBots, api, log, now, fetch, refreshMs, idleLimitMs, retryMs, screens,
      states: new Map(), since: 0, boot: null, pushed: false, down: false, running: false, ticking: false, ac: new AbortController()});
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick().catch((e) => this.log('botui tick: ' + e.message)), this.refreshMs).unref();
    this.loop();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.ac.abort();
  }

  state(viewer) { return this.states.get(viewer); }

  async call(path, body, timeoutMs = 10000) {
    const res = await this.fetch(this.url + path, {
      method: body ? 'POST' : 'GET',
      headers: {authorization: 'Bearer ' + this.token, ...(body ? {'content-type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([this.ac.signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async loop() {
    let wait = this.retryMs;
    while (this.running) {
      try {
        if (!this.pushed) { await this.call('/viewers', {names: Object.keys(this.viewerBots)}); this.pushed = true; }
        const r = await this.call(`/events?since=${this.since}&wait=${this.boot === null ? 0 : 25}`, null, 30000);
        if (this.down) { this.log('botui: plugin reachable again'); this.down = false; }
        wait = this.retryMs;
        if (r.boot !== this.boot) { // first contact skips the backlog; after a plugin restart ids start over
          this.pushed = this.boot === null;
          if (this.boot !== null) for (const st of this.states.values()) st.open = false; // the plugin lost its tracking and will not say `closed`
          this.since = this.boot === null ? r.last : 0;
          this.boot = r.boot;
          continue;
        }
        for (const e of r.events) {
          this.since = e.id;
          await this.handle(e).catch((err) => this.log('botui event: ' + err.message));
        }
      } catch (e) {
        if (!this.running) return;
        if (!this.down) { this.log('botui: plugin unreachable: ' + e.message); this.down = true; }
        this.pushed = false;
        await new Promise((ok) => setTimeout(ok, wait).unref());
        wait = Math.min(wait * 2, 30000);
      }
    }
  }

  canon(player) {
    const p = String(player).toLowerCase();
    return Object.keys(this.viewerBots).find((n) => n.toLowerCase() === p);
  }

  flash(st, text, ok = false) { st.flash = {text, ok, until: this.now() + FLASH_MS}; }

  async handle(e) {
    const viewer = this.canon(e.player);
    if (!viewer) return;
    if (e.type === 'quit') { this.states.delete(viewer); return; }
    let st = this.states.get(viewer);
    if (e.type === 'closed') { if (st) st.open = false; return; }
    if (!st) this.states.set(viewer, st = {screen: {name: 'lage'}, open: false, lastJson: null, flash: null, sel: {a: null, b: null, dim: null}, ctx: {}, lastClick: 0, mapState: {zoom: 5, center: null}});
    st.ctx = {pos: e.pos, dim: e.dim, yaw: e.yaw, gaze: e.gaze};
    if (e.type === 'open') {
      st.screen = {name: st.sel.a ? 'auftrag' : 'lage'}; st.lastClick = this.now();
    } else if (e.type === 'click') {
      st.lastClick = this.now(); st.lastJson = null; st.open = true; // a click proves a dialog is up; it always re-shows
      const act = ACTIONS[e.data?.a];
      try {
        if (act) await act(st, e.data, this, viewer);
        else this.flash(st, 'Unbekannte Aktion');
      } catch (err) { this.flash(st, 'Fehler: ' + err.message); }
      if (!st.open) return;
    } else if (e.type === 'mapclick') {
      st.screen = {name: 'karte'}; st.lastClick = this.now();
    } else return;
    try { await this.show(viewer, st); } catch (err) {
      this.flash(st, 'Fehler: ' + err.message);
      await this.show(viewer, st).catch((e2) => { st.open = false; this.log(`botui ${viewer}: ${e2.message}`); });
    }
  }

  async render(viewer, st) {
    const allowed = this.viewerBots[viewer];
    if (st.flash && st.flash.until < this.now()) st.flash = null;
    const snaps = this.api.snapshots().filter((s) => allowed === '*' || allowed.includes(s.name));
    const refreshing = this.screens.REFRESHING.has(st.screen.name);
    return this.screens.render(st.screen, {viewer, snaps, allowed, owner: allowed === '*', keeper: this.api.keeper, plan: this.api.plan, flash: st.flash, ctx: st.ctx, sel: st.sel,
      places: this.api.places(), schematics: refreshing ? [] : await this.api.schematics(), traderChests: this.api.traderChests, traders: this.api.traders?.() || [], mapState: st.mapState});
  }

  // refresh: the plugin itself refuses (feedback "closed") when the player closed the dialog while this was on the wire.
  async post(viewer, st, json, refresh = false) {
    const r = await this.call('/show', {player: viewer, dialog: json, ...(refresh ? {refresh: true} : {})});
    if (r.ok) { st.lastJson = json; return; }
    st.open = false;
    if (!(refresh && r.feedback === 'closed')) this.log(`botui ${viewer}: ${r.feedback}`);
  }

  async show(viewer, st) {
    st.open = true;
    await this.post(viewer, st, JSON.stringify(await this.render(viewer, st)));
  }

  // The map item's whole view for one viewer; the plugin ignores it unless they are online and holding the map.
  mapBody(viewer, st) {
    const {zoom, center} = st?.mapState || {zoom: 5, center: null};
    const allowed = this.viewerBots[viewer];
    const at = center && this.api.snapshots().find((s) => s.name === center && (allowed === '*' || allowed.includes(s.name)));
    return {player: viewer, zoom, center: at?.online && Array.isArray(at.pos) && typeof at.dimension === 'string' ? {x: at.pos[0], z: at.pos[2], dim: at.dimension} : null, markers: this.api.markers(viewer)};
  }

  pushMap(viewer, st) { return this.call('/map', this.mapBody(viewer, st)); }

  // Re-sends a changed REFRESHING screen to open viewers; stops after idleLimitMs without a click.
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (this.api.markers) {
        try { for (const viewer of Object.keys(this.viewerBots)) await this.pushMap(viewer, this.states.get(viewer)); } catch (e) { // plugin down: one try per tick, one log line per outage
          if (!this.down) { this.log(`botui map: ${e.message}`); this.down = true; }
        }
      }
      for (const [viewer, st] of [...this.states]) {
        if (!st.open || st.lastJson === null || !this.screens.REFRESHING.has(st.screen.name)) continue; // null: a show is in flight
        if (this.now() - st.lastClick > this.idleLimitMs) { st.open = false; continue; }
        try {
          const [screen, before] = [st.screen, st.lastJson];
          const json = JSON.stringify(await this.render(viewer, st));
          // closed, quit or navigated while rendering: a stale refresh must not pop up or overwrite
          if (json === st.lastJson || !st.open || this.states.get(viewer) !== st || st.screen !== screen || st.lastJson !== before) continue;
          await this.post(viewer, st, json, true);
        } catch (e) { // one viewer or an outage must not stop the others; one log line per outage
          if (!this.down) { this.log(`botui refresh ${viewer}: ${e.message}`); this.down = true; }
        }
      }
    } finally { this.ticking = false; }
  }
}

// Rights of a viewer (cfg.viewerBots): the bots a request names must all be theirs.
function allowedBots(viewerBots, viewer, bots) {
  const allowed = viewerBots[viewer];
  if (!allowed || !Array.isArray(bots) || (allowed !== '*' && bots.some((n) => !allowed.includes(n)))) throw new Error('nicht dein Bot');
  return bots;
}

// What a viewer's "stop all" reaches: 'all' for a full viewer, else their existing bots (an empty list means nothing to stop).
function stopTargets(viewerBots, viewer, known) {
  const allowed = viewerBots[viewer];
  if (!allowed) throw new Error('nicht dein Bot');
  return allowed === '*' ? 'all' : allowed.filter((n) => known.includes(n));
}

module.exports = {BotUi, ACTIONS, allowedBots, stopTargets, markersOf};
