'use strict';
// Mitmachen (in-game bot page): a viewer's bot joins another bot's running build with the very same job args (the
// build is made for a crew: per-cell claims, plan read from the world each pass); Wieder raus stops it and gives back
// the owner order it had before. The menu only ever sees display names, the project args stay here.
const {allowedBots} = require('./botui');
const {visible} = require('./uploads');
const TYPES = new Set(['schematic', 'produce']);
const planName = (file) => { const n = String(file).replace(/\.litematic$/, ''); return n.charAt(0).toUpperCase() + n.slice(1); };
const keyOf = (p) => `${p.type}|${JSON.stringify(p.args)}`;

// projects: the Projects store; orders: bot -> the owner order it runs ({type, args}); viewerBots/viewers/ground: the
// rights (cfg.viewerBots, cfg.ingameViewers, server.js ground); submit(viewer, job) is the menu's submit;
// release(bot): no order to give back, "Wenn frei" may start again.
function makeJoins({projects, orders, viewerBots, viewers, ground, submit, release}) {
  // Throws where an order from that viewer for that bot would be refused: the bot, the plan (uploads.visible), ground().
  const check = (viewer, bot, type, args) => {
    allowedBots(viewerBots, viewer, [bot]);
    if (!type) return;
    if (!visible([args.file], viewer, viewerBots[viewer] === '*', viewers).length) throw new Error('Bauplan nicht gefunden');
    ground(viewer, bot, type, args);
  };
  const joined = new Map(); // bot -> {name, key, prev}
  // The join only while the bot still runs that project (a finished, stopped or replaced one ends it).
  const live = (bot) => {
    const j = joined.get(bot), p = projects.get(bot);
    if (j && (!p || p.paused || keyOf(p) !== j.key)) joined.delete(bot);
    return joined.get(bot) || null;
  };
  function groups(viewer, bot) {
    check(viewer, bot);
    const out = new Map();
    for (const [name, p] of Object.entries(projects.all).sort(([a], [b]) => a.localeCompare(b))) {
      if (name === bot || p.paused || !TYPES.has(p.type)) continue;
      // A guest only joins builds of bots it controls: the args carry the owner's site and supply chests.
      if (viewerBots[viewer] !== '*' && !viewerBots[viewer].includes(name)) continue;
      try { check(viewer, bot, p.type, p.args); } catch { continue; }
      const k = keyOf(p);
      if (!out.has(k)) out.set(k, {name: planName(p.args.file), bots: [], at: p.args.origin, type: p.type, args: p.args, key: k});
      out.get(k).bots.push(name);
    }
    return [...out.values()];
  }
  return {
    joinable: (viewer, bot) => groups(viewer, bot).map(({name, bots, at}) => ({name, bots: [...bots], at: {x: at.x, y: at.y, z: at.z}})),
    join(viewer, bot, from) {
      const g = groups(viewer, bot).find((x) => x.bots.includes(from));
      if (!g) throw new Error('Gerade läuft kein Bau');
      const prev = live(bot) ? joined.get(bot).prev : orders.get(bot) || null; // a second join keeps the first order
      submit(viewer, {bots: [bot], type: g.type, args: g.args, replace: true});
      joined.set(bot, {name: g.name, key: g.key, prev});
      return g.name;
    },
    leave(viewer, bot) {
      check(viewer, bot);
      const j = live(bot);
      if (!j) throw new Error('macht bei nichts mit');
      submit(viewer, {bots: [bot], type: 'stop', args: {}});
      joined.delete(bot);
      if (j.prev) submit(viewer, {bots: [bot], type: j.prev.type, args: j.prev.args});
      else release(bot);
      return j.name;
    },
    // bot -> the display name of the build it joined, for the bot page.
    joined: () => Object.fromEntries([...joined.keys()].filter(live).map((b) => [b, joined.get(b).name])),
  };
}

module.exports = {makeJoins, planName};
