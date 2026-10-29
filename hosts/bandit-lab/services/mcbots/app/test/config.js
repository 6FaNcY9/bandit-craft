'use strict';
const APP = require('node:path').join(__dirname, '..');
// Minimal self-check: config validation + job argument validation.
const assert = require('node:assert');
const {loadConfig} = require('../config');
const {VALIDATE} = require('../bots');
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BOT_AUTH: 'x'}), /BOT_AUTH/);
loadConfig({BOT_NAMES: 'bot1', BOT_AUTH: 'none'});
assert.throws(() => require('../config').loadWorkerConfig({HUB_URL: 'ws://127.0.0.1:1/worker', HUB_TOKEN: 't'.repeat(40), MC_HOST: 'h', BOT_AUTH: 'x'}, ['bot2']), /BOT_AUTH/);
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', MC_VHOST: 'bad host'}), /MC_VHOST/);
{ // sandbox console: same host as the main one only on another port (rehearsal forwarders on one gateway address)
  const rc = {BOT_NAMES: 'bot1', RCON_HOST: 'minecraft', RCON_PASSWORD: 'pw', SANDBOX_RCON_HOST: 'minecraft-sandbox', SANDBOX_RCON_PASSWORD: 'pw'};
  assert.strictEqual(loadConfig(rc).sandboxRcon.port, 25575, 'default port');
  assert.strictEqual(loadConfig({...rc, SANDBOX_RCON_PORT: '25580'}).sandboxRcon.port, 25580);
  assert.throws(() => loadConfig({...rc, SANDBOX_RCON_HOST: 'minecraft'}), /must differ/);
  assert.strictEqual(loadConfig({...rc, SANDBOX_RCON_HOST: 'minecraft', SANDBOX_RCON_PORT: '25580'}).sandboxRcon.host, 'minecraft');
  for (const bad of ['0', '65536', 'x', '1.5']) assert.throws(() => loadConfig({...rc, SANDBOX_RCON_PORT: bad}), /SANDBOX_RCON_PORT/, bad);
}
loadConfig({BOT_NAMES: 'bot1', MC_VHOST: 'sandbox.bots'});
assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1, bot22'}).names, ['bot1', 'bot22']);
for (const bad of ['bot', 'bot100', 'Bot1', 'steve', 'bot1,x']) assert.throws(() => loadConfig({BOT_NAMES: bad}), bad);
{ // agent bearer (H5): config pairs token and bots; the policy limits endpoints, bots, jobs and chests
  const tok = 'a'.repeat(40);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', TRUSTED_PROXIES: '10.250.77.1, 172.22.0.1'}).trustedProxies, ['10.250.77.1', '172.22.0.1']);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', TRUSTED_PROXIES: 'evil.example'}), /IP addresses/);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1,bot2', AGENT_TOKEN: tok, AGENT_BOTS: 'bot1'}).agentBots, ['bot1']);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', AGENT_TOKEN: tok}), /set together/);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', AGENT_TOKEN: tok, AGENT_BOTS: 'bot1,bot16'}).agentBots, ['bot1', 'bot16'], 'worker bots too');
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', AGENT_TOKEN: tok, AGENT_BOTS: 'steve'}), /must be bot names/);
  // the job board's bots: names, and never the agent's or the plan's
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', BOARD_BOTS: 'bot2, bot19'}).boardBots, ['bot2', 'bot19']);
  assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1'}).boardBots, [], 'no BOARD_BOTS: no board');
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', BOARD_BOTS: 'steve'}), /BOARD_BOTS must be bot names/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', AGENT_TOKEN: tok, AGENT_BOTS: 'bot1', BOARD_BOTS: 'bot1,bot2'}), /must not contain agent or plan bots: bot1/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PLAN_ENABLE: '1', PLAN_ROSTER: 'bot2', BOARD_BOTS: 'bot2'}), /agent or plan bots: bot2/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', AGENT_TOKEN: 'short', AGENT_BOTS: 'bot1'}), /32..128/);
  assert.throws(() => loadConfig({BOT_NAMES: 'bot1', AGENT_TOKEN: tok, AGENT_BOTS: 'bot1', WORKER_TOKEN: tok, WORKER_PORT: '8096'}), /differ/);
  const A = require('../agentauth');
  const h = A.hash(tok);
  assert.strictEqual(A.bearerMatches(undefined, h), null, 'no bearer: human path');
  assert.strictEqual(A.bearerMatches(`Bearer ${tok}`, h), true);
  for (const bad of [`Bearer ${'b'.repeat(40)}`, `bearer ${tok}`, tok, `Bearer ${tok} x`, '']) assert.strictEqual(A.bearerMatches(bad, h), false, bad);
  assert.strictEqual(A.bearerMatches(`Bearer ${tok}`, null), false, 'no agent token configured: every bearer fails');
  for (const backend of ['lab', 'slayer', 'second-pc', '127.0.0.1:18082', '[::1]:8081']) assert.ok(A.validBackend(backend));
  for (const backend of [1, null, '', 'x'.repeat(129), 'pc\n', '<script>']) assert.ok(!A.validBackend(backend));
  assert.ok(A.agentEndpoint('GET', '/api/state') && A.agentEndpoint('GET', '/api/events') && A.agentEndpoint('POST', '/api/job') && A.agentEndpoint('POST', '/api/decision'));
  assert.ok(A.agentEndpoint('POST', '/api/agentstatus') && !A.agentEndpoint('GET', '/api/agents') && !A.agentEndpoint('POST', '/api/agents'), 'only the agent posts its status');
  const sp = {agentBots: ['bot1', 'bot2']};
  assert.deepStrictEqual(A.agentStatus({agent: 'bot1', goal: 'g'.repeat(1200), workers: ['bot2'], role: 'lead'}, sp), {agent: 'bot1', goal: 'g'.repeat(1000), workers: ['bot2'], role: 'lead'});
  for (const bad of [{agent: 'bot9', goal: '', workers: []}, {agent: 'bot1', goal: 1, workers: []}, {agent: 'bot1', goal: '', workers: 'bot2'}, {agent: 'bot1', goal: '', workers: ['a b']}, {agent: 'bot1', goal: '', workers: Array(13).fill('w')}, {agent: 'bot1', goal: '', workers: ['bot999']}]) assert.ok(A.agentStatus(bad, sp).error, JSON.stringify(bad));
  { // the dashboard keeps one row per worker of the current crew, not one per name ever seen (Codex R4-6)
    const html = require('node:fs').readFileSync(require('node:path').join(APP, 'public/legacy.html'), 'utf8');
    const body = html.slice(html.indexOf('function renderAgents() {'), html.indexOf('async function pollAgents'));
    const stub = () => ({append() {}, replaceChildren() {}, getBoundingClientRect: () => ({}), set textContent(v) {}});
    const cards = new Map();
    const render = new Function('agentCards', 'agentList', '$', 'el', 'last', 'decs', `${body}; return renderAgents;`);
    const list = [{agent: 'bot1', workers: ['bot2'], goal: '', t: 0}];
    const run = render(cards, list, stub, stub, {bots: []}, []);
    for (const w of ['bot2', 'bot3', 'bot4']) { list[0].workers = [w]; run(); }
    assert.deepStrictEqual([...cards.get('bot1').wk.keys()], ['bot4']);
  }
  assert.ok(!A.agentEndpoint('GET', '/api/decisions'), 'reading decisions is for humans');
  for (const [m, u] of [['POST', '/api/settings'], ['POST', '/api/keeper'], ['POST', '/api/plan'], ['GET', '/api/plan'], ['POST', '/api/places'], ['GET', '/api/debug'], ['GET', '/'], ['GET', '/api/view']]) assert.ok(!A.agentEndpoint(m, u), u);
  const pol = {agentBots: ['bot1', 'bot2'], supplyChest: {x: 1, y: 2, z: 3}};
  const no = (body) => A.agentJobRefusal(body, pol);
  assert.strictEqual(no({bots: ['bot1'], type: 'mine', args: {block: 'stone', count: 3}}), null);
  assert.strictEqual(no({bots: ['bot2'], type: 'stop', args: {}}), null);
  assert.strictEqual(no({bots: ['bot1'], type: 'deposit', args: {x: 1, y: 2, z: 3}}), null);
  assert.match(no({bots: 'all', type: 'stop'}), /name their bots/);
  assert.match(no({bots: ['bot1', 'bot10'], type: 'stop'}), /bot10 is not an agent bot/);
  assert.match(no({bots: ['bot1'], type: 'say', args: {text: 'hi'}}), /not allowed/);
  assert.match(no({bots: ['bot1'], type: 'rearm', args: {}}), /not allowed/);
  for (const type of ['withdraw', 'deposit', 'stock', 'shift']) assert.match(no({bots: ['bot1'], type, args: {x: 9, y: 2, z: 3}}), /supply chest/, type);
  const building = {...pol, jobOf: (b) => (b === 'bot2' ? {type: 'schematic'} : {type: 'mine'})};
  assert.match(A.agentJobRefusal({bots: ['bot1', 'bot2'], type: 'stop', args: {}}, building), /bot2 works on the owner's schematic project/);
  assert.strictEqual(A.agentJobRefusal({bots: ['bot1'], type: 'stop', args: {}}, building), null, 'a bot on an ordinary job takes orders');
  // the owner's dashboard order holds until it ends, idle before a resume too (bot3's wheat fields, restarts, 2026-10-16)
  const ordered = {...pol, agentBots: ['bot1', 'bot3'], jobOf: (b) => ({bot3: {type: 'wheatfarm'}, bot1: null})[b], ownerOrderOf: (b) => ({bot3: 'wheatfarm', bot1: 'produce'})[b]};
  assert.match(A.agentJobRefusal({bots: ['bot3'], type: 'treefarm', args: {x1: 0, z1: 0, x2: 3, z2: 3}}, ordered), /bot3 works on the owner's wheatfarm order/);
  assert.match(A.agentJobRefusal({bots: ['bot1'], type: 'stop', args: {}}, ordered), /bot1 works on the owner's produce order/, 'idle, its order not resumed yet');
  assert.strictEqual(A.agentJobRefusal({bots: ['bot1'], type: 'stop', args: {}}, {...ordered, ownerOrderOf: () => undefined}), null, 'the order ended: agents may');
  // ... and a failure does not end it: the job starts again later (one exploded chest, 806 agent jobs, 2026-10-17)
  const order = {type: 'produce', args: {file: 'f'}}, at = (kind, text) => A.orderOutcome({kind, text}, order);
  assert.deepStrictEqual(at('done', 'finished: produce f (30 s)'), {end: true});
  assert.deepStrictEqual(at('fail', 'failed: produce f - no chest at -356 67 -191'), {retry: A.ORDER_RETRY_MS});
  assert.deepStrictEqual(at('fail', 'gave up: produce f (died 4 times)'), {retry: 4 * A.ORDER_RETRY_MS});
  assert.strictEqual(at('fail', 'failed: rearm -271 66 -214 - chest full'), null, 'a helper job is not the order');
  assert.strictEqual(at('info', 'failed: produce f'), null);
  assert.deepStrictEqual(A.orderOutcome({kind: 'fail', text: 'failed: produce f - x'}, {type: 'produce'}), {end: true}, 'saved without args (older file): ends');
  // a sweep starts idle bots' orders again, also after a restart forgot the failure (bot2 after the 11:19 deploy)
  const orders = new Map([['bot1', order], ['bot2', order], ['bot3', order], ['bot4', {type: 'produce'}], ['bot5', order], ['bot6', order]]);
  const snaps = {bot1: {online: true, job: null, queue: []}, bot2: {online: true, job: {type: 'produce'}, queue: []}, bot3: {online: false},
    bot4: {online: true, job: null, queue: []}, bot5: {online: true, job: null, queue: []}, bot6: {online: true, remote: true, connected: false, job: null, queue: []}};
  const waits = new Map([['bot5', 2000]]);
  assert.deepStrictEqual(A.ordersToStart(orders, (b) => snaps[b], waits, 1000).map(([b]) => b), ['bot1'], 'idle and online only, with args, after the wait');
  assert.deepStrictEqual(A.ordersToStart(orders, (b) => snaps[b], waits, 3000).map(([b]) => b), ['bot1', 'bot5'], 'the wait is over');
  // Three deaths within 30 min hold the order for 30 min (bot1 died 19 times in 3 h, main server 2026-10-19).
  const MIN = 60000;
  let d = A.deathLoop([], 0);
  assert.deepStrictEqual(d, {times: [0], hold: false});
  d = A.deathLoop(d.times, 10 * MIN);
  assert.strictEqual(d.hold, false);
  assert.strictEqual(A.deathLoop(d.times, 29 * MIN).hold, true, 'the third within 30 min');
  assert.deepStrictEqual(A.deathLoop(d.times, 29 * MIN).times, [], 'counting starts over after a hold');
  assert.strictEqual(A.deathLoop(d.times, 31 * MIN).hold, false, 'the first death is 31 min old: out of the window');
  assert.strictEqual(A.deathLoopAlert('bot1', {type: 'produce'}, 0), 'bot1 died 3 times in 30 min: its produce order waits 30 min');
  assert.strictEqual(A.deathLoopAlert('bot1', undefined, 9), 'bot1 died 3 times in 30 min: its 9 queued jobs are dropped', 'graves queued one by one (2026-10-20)');
  assert.match(A.deathLoopAlert('bot1', undefined, 0), /: nothing queued$/);
  // Three failed jobs in a row: no agent order for REST_MS after the newest (bot3, main server 2026-10-14).
  const ev = (kind, t, bot = 'bot1') => ({bot, kind, t, text: `${kind === 'fail' ? 'failed' : 'finished'}: chop 1 - no free logs`});
  const now = 1e6;
  assert.strictEqual(A.resting([ev('fail', now - 30000), ev('fail', now - 20000)], 'bot1', now), null, 'two failures are no pattern');
  assert.match(A.resting([ev('fail', now - 30000), ev('fail', now - 20000), ev('fail', now - 10000)], 'bot1', now), /bot1 failed its last 3 jobs .* rests 110 s/);
  assert.strictEqual(A.resting([ev('fail', now - 30000), ev('done', now - 20000), ev('fail', now - 10000), ev('fail', now - 5000)], 'bot1', now), null, 'a finished job in between');
  assert.strictEqual(A.resting([ev('fail', now - 30000), ev('fail', now - 20000), ev('fail', now - 10000)], 'bot1', now + A.REST_MS), null, 'the rest ends');
  assert.strictEqual(A.resting([ev('fail', now - 3, 'bot2'), ev('fail', now - 2, 'bot2'), ev('fail', now - 1, 'bot2')], 'bot1', now), null, 'another bot');
  const tired = {...pol, restingOf: (b) => (b === 'bot1' ? 'bot1 failed its last 3 jobs' : null)};
  assert.match(A.agentJobRefusal({bots: ['bot1'], type: 'chop', args: {count: 1}}, tired), /failed its last 3/);
  assert.strictEqual(A.agentJobRefusal({bots: ['bot1'], type: 'stop', args: {}}, tired), null, 'a stop always goes through');
}
{ // the problem solver's rules (agentauth.js solverRefusal / solverAction), deny by default
  const A = require('../agentauth');
  let clock = 1e9;
  const mk = () => new A.SolverLimiter({now: () => clock});
  const chest = {x: 1, y: 2, z: 3};
  const places = [{name: 'Mine', x: 10, y: 60, z: 20}, {name: 'Pit', x: 0, y: 60, z: 0, box: {x1: -3, y1: 50, z1: -3, x2: 5, y2: 70, z2: 5}}];
  let limiter = mk(), jobs = {bot3: null};
  const pol = () => ({agentBots: ['bot1', 'bot2'], supplyChest: chest, roster: ['bot3', 'bot4'], places, jobOf: (n) => jobs[n], limiter});
  const s = (body, bot = 'bot3') => A.agentJobRefusal({bots: [bot], solver: true, ...body}, pol());
  // every menu job passes with the right arguments
  const ok = {rearm: chest, deposit: chest, withdraw: {...chest, item: 'coal', count: 3}, craft: {item: 'stone_pickaxe', count: 1}, smelt: {item: 'raw_iron', count: 2}, mine: {block: 'iron_ore', count: 3}, chop: {count: 5}, tidy: {...chest, radius: 16}, goto: {x: 10, y: 60, z: 20}, seal: {x1: -3, y1: 50, z1: -3, x2: 5, y2: 70, z2: 5}};
  assert.deepStrictEqual([...A.SOLVER_JOBS].sort(), Object.keys(ok).sort(), 'the menu allowlist is exactly this list');
  for (const [type, args] of Object.entries(ok)) { limiter = mk(); assert.strictEqual(s({type, args}), null, type); }
  // not on the menu
  for (const type of ['say', 'build', 'excavate', 'place', 'shaft', 'stop', 'shift', 'stock', 'hunt']) { limiter = mk(); assert.match(s({type, args: {}}), /not on the solver menu/, type); }
  limiter = mk(); assert.match(s({type: 'mine', args: {block: 'iron_block', count: 1}}), /natural mining list/);
  for (const block of ['cobblestone', 'chest', 'stone_bricks']) { limiter = mk(); assert.match(s({type: 'mine', args: {block, count: 1}}), /natural mining list/, block); }
  for (const block of ['iron_ore', 'deepslate_iron_ore', 'stone', 'gravel']) { limiter = mk(); assert.strictEqual(s({type: 'mine', args: {block, count: 4}}), null, block); }
  // who: roster only, never agent bots through the solver door, one bot
  limiter = mk();
  assert.match(s({type: 'chop', args: {count: 1}}, 'bot9'), /not a plan roster bot/);
  assert.match(A.agentJobRefusal({bots: ['bot3', 'bot4'], solver: true, type: 'chop', args: {count: 1}}, pol()), /not an agent bot|one bot/);
  assert.match(A.agentJobRefusal({bots: 'all', solver: true, type: 'stop'}, pol()), /name their bots/);
  assert.match(A.agentJobRefusal({bots: ['bot3'], type: 'chop', args: {count: 1}}, pol()), /not an agent bot/, 'without solver:true the old rule holds');
  assert.strictEqual(A.agentJobRefusal({bots: ['bot1'], solver: true, type: 'build', args: {}}, pol()), null, 'agent bots keep their own rules');
  // chests, places, zones
  for (const type of ['rearm', 'deposit', 'withdraw']) { limiter = mk(); assert.match(s({type, args: {x: 9, y: 2, z: 3, item: 'coal'}}), /supply chest/, type); }
  limiter = mk(); assert.match(s({type: 'goto', args: {x: 11, y: 60, z: 20}}), /named place/);
  limiter = mk(); assert.match(s({type: 'seal', args: {x1: -3, y1: 50, z1: -3, x2: 6, y2: 70, z2: 5}}), /named zone/);
  // a fresh job is never replaced
  limiter = mk(); jobs.bot3 = {runningS: 20};
  assert.match(s({type: 'chop', args: {count: 1}, replace: true}), /less than 60 s ago/);
  jobs.bot3 = {runningS: 90}; limiter = mk();
  assert.strictEqual(s({type: 'chop', args: {count: 1}, replace: true}), null);
  // rate limit per bot: one per 3 min, ten per hour; another bot is independent
  limiter = mk(); jobs.bot3 = null;
  assert.strictEqual(s({type: 'chop', args: {count: 1}}), null);
  assert.match(s({type: 'chop', args: {count: 1}}), /less than 3 min ago/);
  assert.strictEqual(s({type: 'chop', args: {count: 1}}, 'bot4'), null);
  for (let i = 0; i < 9; i++) { clock += 181000; assert.strictEqual(s({type: 'chop', args: {count: 1}}), null, `job ${i + 2}`); }
  clock += 181000;
  assert.match(s({type: 'chop', args: {count: 1}}), /10 solver actions this hour/);
  clock += 3600000;
  assert.strictEqual(s({type: 'chop', args: {count: 1}}), null, 'the hour passes');
  assert.match(A.agentJobRefusal({bots: ['bot3'], solver: true, type: 'chop', args: {count: 1}}, {...pol(), limiter: undefined}), /no rate limiter/);
  assert.ok(A.agentEndpoint('POST', '/api/solver') && !A.agentEndpoint('GET', '/api/solver'));
  // note / escalate / skip
  limiter = mk();
  const act = (b) => A.solverAction(b, {agentBots: ['bot1', 'bot2'], roster: ['bot3'], blocked: ['storage'], limiter});
  assert.match(act({action: 'say', bot: 'bot3', text: 'x'}).error, /note, escalate or skip/);
  assert.match(act({action: 'note', bot: 'bot9', text: 'x'}).error, /not a roster bot/);
  assert.match(act({action: 'note', bot: 'bot3', text: ''}).error, /text required/);
  assert.deepStrictEqual(act({action: 'note', bot: 'bot3', text: 'bot3 rearm  - no pickaxe'}), {kind: 'info', bot: 'bot3', text: 'solver: bot3 rearm - no pickaxe'});
  assert.strictEqual(act({action: 'escalate', bot: 'base', text: 'help'}).kind, 'alert');
  assert.match(act({action: 'escalate', bot: 'base', text: 'again'}).error, /less than 3 min ago/);
  assert.match(act({action: 'skip', bot: 'plan', text: 'x', objective: 'mine'}).error, /not parked or blocked/);
  assert.strictEqual(act({action: 'skip', bot: 'plan', text: 'storage skipped', objective: 'storage'}).skip, 'storage');
  for (let i = 0; i < 2; i++) act({action: 'skip', bot: 'plan', text: 's', objective: 'storage'});
  assert.match(act({action: 'skip', bot: 'plan', text: 's', objective: 'storage'}).error, /3 solver actions this hour/);
}
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', DASHBOARD_HOST: '0.0.0.0'}));
assert.ok(loadConfig({BOT_NAMES: 'bot1', DASHBOARD_HOST: '0.0.0.0', ALLOWED_TS_LOGINS: 'a@github'}).allowed.length);
assert.deepStrictEqual(VALIDATE.goto({x: '1', y: 64, z: -3}), {x: 1, y: 64, z: -3});
assert.throws(() => VALIDATE.goto({x: 'a', y: 1, z: 1}));
assert.deepStrictEqual(VALIDATE.goto({x: 5, z: -7}), {x: 5, z: -7}, 'a spot tapped on the map has no height');
assert.throws(() => VALIDATE.say({text: '/op me'}));
// A site given free by the owner (clearAll) is a plain true, else not set at all (2026-10-14).
{
  const base = {file: 'sorter.litematic', origin: {x: 1, y: 2, z: 3}, chests: [{x: 1, y: 2, z: 4}]};
  assert.strictEqual(VALIDATE.schematic({...base, clearAll: true}).clearAll, true);
  assert.ok(!('clearAll' in VALIDATE.schematic(base)) && !('clearAll' in VALIDATE.schematic({...base, clearAll: 'yes'})));
  assert.strictEqual(VALIDATE.produce({...base, clearAll: true, store: {x: 1, y: 2, z: 4}}).clearAll, true);
  // substitute: cheaper blocks of the same shape (the iron farm's smooth stone, 2026-10-15)
  assert.deepStrictEqual(VALIDATE.schematic({...base, substitute: {smooth_stone: 'cobblestone'}}).substitute, {smooth_stone: 'cobblestone'});
  assert.ok(!('substitute' in VALIDATE.schematic(base)) && !('substitute' in VALIDATE.schematic({...base, substitute: {}})));
  for (const bad of [{a: 'B'}, {'../x': 'stone'}, ['stone'], 'stone', Object.fromEntries(Array.from({length: 17}, (_, i) => [`b${'x'.repeat(i)}`, 'stone']))]) assert.throws(() => VALIDATE.schematic({...base, substitute: bad}), JSON.stringify(bad));
}
assert.throws(() => VALIDATE.mine({block: 'Iron Ore'}));
assert.throws(() => VALIDATE.mine({block: 'torch'}), /placed block/);
assert.throws(() => VALIDATE.mine({block: 'white_bed'}), /placed block/);
assert.deepStrictEqual(VALIDATE.mine({block: 'coal_ore', count: 3}), {block: 'coal_ore', count: 3});
assert.deepStrictEqual(loadConfig({BOT_NAMES: 'bot1', PROTECTED_AREAS: '10,5,-10,-5; 1,2,3,4'}).protectedAreas, [[-10, -5, 10, 5], [1, 2, 3, 4]]);
assert.throws(() => loadConfig({BOT_NAMES: 'bot1', PROTECTED_AREAS: '1,2,3'}));

// notify.js: real event shapes, safe formatting, delayed loss, and rolling rate limits.
{
  const {NtfyNotifier, TEN_MIN, HOUR, WORKER_LOSS} = require('../notify');
  const {EventLog} = require('../events');
  let now = 0;
  const sent = [];
  const options = {url: 'https://ntfy.example/', topic: 'mcbots', token: 'fixture', now: () => now,
    fetcher: (url, opts) => { sent.push({url, ...opts}); return Promise.resolve({body: {cancel: () => Promise.resolve()}}); }};
  const n = new NtfyNotifier(options);
  const event = (bot, kind, text) => n.event({bot, kind, text});
  event('bot1', 'death', 'died at 1 64 2: fell from a high place');
  assert.deepStrictEqual([sent[0].url, sent[0].headers.Authorization, sent[0].headers.Priority, sent[0].body],
    ['https://ntfy.example/mcbots', 'Bearer fixture', 'high', 'bot1 died at 1 64 2: fell from a high place']);
  event('bot1', 'death', 'died: lava');
  now = TEN_MIN - 1;
  event('bot1', 'death', 'died: lava');
  assert.strictEqual(sent.length, 1);
  now = TEN_MIN;
  event('bot1', 'death', 'died');
  assert.strictEqual(sent.length, 2, 'ten-minute boundary allows another message');
  assert.match(sent[1].body, /cause unknown/);
  event('bot2', 'fail', 'failed: mine stone 10 - no path at 1 2 3');
  event('bot2', 'job', 'started: mine stone 5');
  event('bot2', 'info', 'trying again');
  event('bot2', 'fail', 'failed: mine stone 5 - no path at 4 5 6');
  assert.match(sent.at(-1).body, /stuck after repeated failures/);
  event('bot3', 'fail', 'failed: mine - a');
  event('bot3', 'done', 'finished: goto 1 2 3 (2 s)');
  event('bot3', 'fail', 'failed: mine - a');
  assert.strictEqual(n.failures.get('bot3').count, 1, 'successful jobs clear the failure streak');
  event('bot4', 'fail', 'gave up: shaft 1 2 (died 4 times)');
  assert.match(sent.at(-1).body, /bot4 is stuck/);
  for (const type of ['shaft', 'excavate', 'level', 'treefarm']) {
    event(`bot-${type}`, 'done', `finished: ${type} 1 2 3 (20 s)`);
    assert.strictEqual(sent.at(-1).body, `bot-${type} finished ${type} 1 2 3`);
    assert.strictEqual(sent.at(-1).headers.Priority, 'default');
  }
  const beforeChest = sent.length;
  n.chest({}, ['full (0 free slots)', 'no food', 'no torches or coal', 'no pickaxes', 'no saplings']);
  assert.strictEqual(sent.length - beforeChest, 4, 'each requested chest warning has its own kind');
  n.chest({}, ['full (1 free slots)', 'no food', 'no torches or coal', 'no pickaxes']);
  assert.strictEqual(sent.length - beforeChest, 4, 'full slot-count changes do not trigger new alerts');
  event('bot5', 'disconnect', 'left the game');
  event('bot6', 'hub', 'worker laptop disconnected');
  now += WORKER_LOSS - 1;
  event('bot6', 'hub', 'worker laptop disconnected');
  n.tick();
  const beforeLoss = sent.length;
  now += 1;
  n.tick();
  assert.strictEqual(sent.length, beforeLoss + 1, 'duplicate disconnect preserves the first loss time');
  assert.deepStrictEqual([sent.at(-1).body, sent.at(-1).headers.Priority], ['bot6 worker disconnected for over 5 minutes', 'high']);
  event('bot7', 'hub', 'worker laptop disconnected');
  event('bot7', 'hub', 'worker laptop connected');
  now += WORKER_LOSS;
  n.tick();
  assert.strictEqual(sent.length, beforeLoss + 1, 'reconnect cancels pending worker loss; game disconnect is ignored');
  const cap = new NtfyNotifier(options);
  const beforeCap = sent.length;
  for (let i = 0; i < 31; i++) cap.send(`bot${i}`, 'death', 'x');
  assert.strictEqual(sent.length - beforeCap, 30);
  now += HOUR - 1;
  assert.strictEqual(cap.send('extra', 'death', 'x'), false);
  now += 1;
  assert.strictEqual(cap.send('extra', 'death', 'x'), true, 'rolling hour expires at its boundary');
  n.send('format', 'info', 'hello\n\u0000\rworld ' + 'x'.repeat(400));
  assert.ok(sent.at(-1).body.startsWith('hello world '));
  assert.strictEqual(sent.at(-1).body.length, 300);
  for (const overrides of [{url: ''}, {token: ''}, {url: 'http://ntfy.example'}]) {
    assert.strictEqual(new NtfyNotifier({...options, ...overrides}).send('bot1', 'x', 'off'), false);
  }
  { // the configured gateway (ntfy/default.nix) is plain http inside the Docker subnet (Codex R7-3)
    const sent = [];
    const g = new NtfyNotifier({...options, url: 'http://10.250.77.1:2586', fetcher: (u) => { sent.push(u); return Promise.resolve({}); }});
    assert.strictEqual(g.send('bot1', 'x', 'hi'), true);
    assert.strictEqual(sent[0], 'http://10.250.77.1:2586/' + encodeURIComponent(options.topic || 'mcbots'));
    for (const url of ['http://10.250.77.9:2586', 'http://10.250.78.1:2586', 'http://10.250.77.1.evil.example']) assert.strictEqual(new NtfyNotifier({...options, url}).send('bot1', 'x', 'off'), false, url);
  }
  assert.doesNotThrow(() => new NtfyNotifier({...options, fetcher: () => { throw Error('offline'); }}).send('bot1', 'x', 'x'));
  assert.doesNotThrow(() => new NtfyNotifier({...options, fetcher: () => Promise.reject(Error('offline'))}).send('bot1', 'x', 'x'));
  // Both local and sanitized remote events share this callback; notification errors cannot stop logging.
  const hooked = new EventLog({onAdd: (e) => n.event(e)});
  hooked.add('bot99', 'death', 'died: drowned');
  assert.match(sent.at(-1).body, /bot99 died: drowned/);
  assert.strictEqual(new EventLog({onAdd: () => { throw Error('offline'); }}).add('bot1', 'death', 'died').id, 1);
}
