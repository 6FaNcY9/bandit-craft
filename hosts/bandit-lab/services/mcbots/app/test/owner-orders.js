'use strict';
// Owner orders use packet identity and structured chat, never text pattern events.
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
  const {EventEmitter} = require('node:events');
  const {isOwnerMessage, parseOrder, translate, makeSayer, makeDemoLog, loadRole, saveRole, HELP, HELP2} = require('../owner');
  const {BotRunner, VALIDATE} = require('../bots');
  const {loadConfig, loadWorkerConfig} = require('../config');
  const uuid = '623c7ee4-71ca-487a-b92a-a4564e43fbb9', other = '123c7ee4-71ca-487a-b92a-a4564e43fbb9';
  assert.equal(isOwnerMessage({sender: uuid.replace(/-/g, '').toUpperCase(), position: 'chat'}, [uuid]), true);
  for (const m of [{sender: null, position: 'system'}, {sender: uuid, position: 'system'}, {sender: other, position: 'chat'},
    {sender: other, position: 'chat', text: '[fancy8869 -> bot1] stopp'}, {sender: null, position: 'chat'}, {sender: 'bad', position: 'chat'}]) assert.equal(isOwnerMessage(m, [uuid]), false);
  assert.equal(isOwnerMessage({sender: uuid, position: 'chat'}, []), false);
  assert.deepEqual(parseOrder('BOT1 KOMM', 'bot1', {}), {all: false, words: ['KOMM']});
  assert.deepEqual(parseOrder('alle stopp', 'bot1', {}), {all: true, words: ['stopp']});
  assert.deepEqual(parseOrder('komm', 'bot1', {whisper: true}), {all: false, words: ['komm']});
  for (const s of ['komm', 'bot12 komm', '[fancy8869 -> bot1] stopp', 'bot1komm']) assert.equal(parseOrder(s, 'bot1', {}), null);
  const ctx = {owner: 'fancy8869', ownerPos: {x: 1.9, y: 64.5, z: -2.1}}, tr = (s, c = ctx) => translate(s.split(' '), c);
  for (const [word, type] of [['KOMM', 'come'], ['folge', 'follow'], ['gib', 'give']]) assert.deepEqual(tr(word), {type, args: {player: ctx.owner}});
  for (const word of ['stopp', 'bleib', 'fertig']) assert.deepEqual(tr(word), {stop: true});
  assert.deepEqual(tr('status'), {status: true});
  assert.deepEqual(tr('wache'), {type: 'guard', args: {player: ctx.owner, radius: 16}});
  assert.deepEqual(tr('wache hier'), {type: 'guard', args: {x: 1, y: 64, z: -3, radius: 16}});
  assert.deepEqual(tr('wache hier', {...ctx, ownerPos: null}), {unknown: true});
  for (const role of ['helfer', 'sammler', 'farmer', 'wache']) assert.deepEqual(tr(`ROLLE ${role.toUpperCase()}`), {role});
  for (const [word, block] of [['eisen', 'iron_ore'], ['kohle', 'coal_ore'], ['stein', 'stone'], ['diamond_ore', 'diamond_ore']]) assert.deepEqual(tr(`hol 16 ${word}`), {type: 'mine', args: {block, count: 16}});
  assert.deepEqual(tr('hol 256 holz'), {type: 'chop', args: {count: 256}});
  assert.deepEqual(tr('hol 1 stein'), {type: 'mine', args: {block: 'stone', count: 1}});
  assert.deepEqual(tr('laut'), {verbose: true}); assert.deepEqual(tr('verbose off'), {verbose: false});
  assert.deepEqual(tr('queue'), {queue: 'list'}); assert.deepEqual(tr('liste'), {queue: 'list'});
  assert.deepEqual(tr('queue weg 2'), {queue: {remove: 2}}); assert.deepEqual(tr('queue erst 3'), {queue: {first: 3}});
  assert.deepEqual(tr('alles stopp'), {stopAll: true}); assert.deepEqual(tr('clear'), {stopAll: true}); assert.deepEqual(tr('cancel'), {stop: true});
  assert.deepEqual(tr('jetzt hol 64 kohle'), {now: {type: 'mine', args: {block: 'coal_ore', count: 64}}});
  assert.deepEqual(tr('jetzt status'), {unknown: true});
  assert.deepEqual(tr('kiste'), {chest: 'look'}); assert.deepEqual(tr('kiste 120 64 -340'), {chest: {x: 120, y: 64, z: -340}});
  assert.deepEqual(tr('lagern'), {type: 'deposit', args: {own: true}});
  assert.deepEqual(tr('behalte 64 stick'), {keep: {item: 'stick', count: 64}}); assert.deepEqual(tr('behalte nichts stick'), {keep: {item: 'stick', count: 0}});
  assert.deepEqual(tr('handel sticks'), {type: 'trade', args: {item: 'stick'}});
  assert.deepEqual(tr('handel sticks 1h'), {type: 'trade', args: {item: 'stick', minutes: 60}});
  assert.deepEqual(tr('handel sticks 30m'), {type: 'trade', args: {item: 'stick', minutes: 30}});
  assert.deepEqual(tr('handel sticks 500'), {type: 'trade', args: {item: 'stick', target: 500}});
  assert.deepEqual(tr('hol 4096 stein'), {type: 'mine', args: {block: 'stone', count: 4096}});
  assert.deepEqual(tr('farm 256 deepslate'), {type: 'mine', args: {block: 'deepslate', count: 256}});
  assert.deepEqual(tr('hilfe'), {help: true});
  for (const s of ['hol 4097 stein', 'queue weg 0', 'queue weg x', 'kiste 1 2', 'behalte 5000 stick', 'handel diamonds', 'handel sticks 0h', 'jetzt']) assert.deepEqual(tr(s), {unknown: true});
  assert.ok(HELP2.length <= 100); assert.ok(HELP.length <= 100 && /\bhilfe\b/.test(HELP));
  assert.equal(VALIDATE.mine({block: 'stone', count: 4096}).count, 4096); assert.equal(VALIDATE.chop({count: 4096}).count, 4096); assert.throws(() => VALIDATE.mine({block: 'stone', count: 4097}));
  for (const text of ['', 'rolle chef', 'rolle', 'komm jetzt', 'wache dort', 'hol 0 eisen', 'hol 4097 eisen', 'hol -1 eisen', 'hol 1.5 eisen', 'hol NaN eisen', 'hol 1 eisen extra', 'hol 1 stone/../', 'nonsense']) assert.deepEqual(tr(text), {unknown: true});
  const sent = [], say = makeSayer((text) => sent.push({text, t: Date.now()}), {gapMs: 40, max: 4});
  say('abcdef'); say('old'); say('newest');
  assert.deepEqual(sent.map((s) => s.text), ['abcd']);
  await new Promise((r) => setTimeout(r, 150)); // generous: the lab builds this under load
  assert.deepEqual(sent.map((s) => s.text), ['abcd', 'newe']);
  // A timer may fire a millisecond before Date.now() says the gap is over (39 ms on the lab, 2026-10-13).
  assert.ok(sent[1].t - sent[0].t >= 38, `one line per gap: ${sent[1].t - sent[0].t} ms`);
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mcbots-owner-'));
  try {
    const file = path.join(dir, 'demo.jsonl'), log = makeDemoLog(file);
    const entry = {bot: 'bot1', via: 'whisper', text: 'komm', command: tr('komm'), state: {health: 20}};
    const id = log.add(entry);
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
    log.outcome(id, 'finished', 'finished: come');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines[0], {...entry, id, t: lines[0].t, outcome: null});
    assert.ok(Number.isFinite(Date.parse(lines[0].t)));
    assert.deepEqual(lines[1], {id, outcome: {t: lines[1].outcome.t, result: 'finished', text: 'finished: come'}});
    const rotated = path.join(dir, 'rotate.jsonl'), small = makeDemoLog(rotated, {maxBytes: 1});
    small.add(entry); assert.ok(fs.existsSync(`${rotated}.1`)); assert.equal(fs.existsSync(rotated), false);
    small.add({...entry, text: 'folge'});
    assert.equal(JSON.parse(fs.readFileSync(`${rotated}.1`, 'utf8')).text, 'folge');
    const noop = makeDemoLog(null); noop.outcome(noop.add(entry), 'finished', 'ok');
    const roles = path.join(dir, 'roles.json');
    assert.equal(loadRole(roles, 'bot2'), 'sammler');
    saveRole(roles, 'bot1', 'wache'); saveRole(roles, 'bot2', 'farmer');
    assert.equal(loadRole(roles, 'bot1'), 'wache'); assert.equal(loadRole(roles, 'bot2'), 'farmer');
    const bot = new EventEmitter(), whispers = [];
    bot.players = {fancy8869: {uuid, username: 'fancy8869', entity: {position: ctx.ownerPos}}};
    bot.whisper = () => { throw new Error('replies go over the say event, not /tell'); };
    const outcomes = [], orders = [];
    const runner = new BotRunner('bot1', {log: () => {}, ownerUuids: [uuid], onEvent: (b, k, t) => { if (k === 'say') whispers.push({name: t.split(': ')[0], text: t.slice(t.indexOf(': ') + 2)}); }, demoLog: {add: (e) => { orders.push(e); return String(orders.length); }, outcome: (...a) => outcomes.push(a)}});
    runner.bot = bot; runner.online = true;
    runner.snapshot = () => ({health: 20, food: 18, job: null, role: runner.role, freeSlots: 36, strangerOrders: runner.strangerOrders});
    runner.pump = () => {}; // keep the real enqueue/validation; no Minecraft work
    runner.bindOwner(bot);
    const enqueued = [], enqueue = runner.enqueue.bind(runner);
    runner.enqueue = (...args) => { enqueued.push(args); return enqueue(...args); };
    const msg = (text, incoming = false) => ({translate: incoming ? 'commands.message.display.incoming' : 'chat.type.text', with: [{toString: () => 'fancy8869'}, {toString: () => text}]});
    bot.emit('message', msg('bot1 komm'), 'chat', uuid, true);
    assert.deepEqual(enqueued[0], ['come', {player: 'fancy8869'}, {first: true}]);
    assert.deepEqual(whispers, []); // a job that starts at once says no ok: its start line is the receipt
    bot.emit('message', msg('bot1 stopp'), 'chat', other, true);
    assert.equal(runner.snapshot().strangerOrders, 1); assert.equal(whispers.length, 0); assert.equal(enqueued.length, 1);
    bot.emit('message', msg('[fancy8869 -> bot1] stopp'), 'system', null);
    assert.equal(enqueued.length, 1);
    const job = runner.queue[0];
    runner.emit('done', 'finished: come', job.id + 1); assert.equal(outcomes.length, 0);
    runner.emit('done', 'finished: come', job.id); assert.deepEqual(outcomes[0], ['1', 'finished', 'finished: come']);
    runner.emit('done', 'finished: come', job.id); assert.equal(outcomes.length, 1);
    runner.say = (text) => runner.emit('say', `fancy8869: ${text}`); // unthrottled stand-in for the queueing sayer
    runner.rolesFile = roles; runner.prefsFile = path.join(dir, 'prefs.json');
    bot.emit('message', msg('rolle sammler', true), 'chat', uuid);
    assert.equal(runner.role, 'sammler'); assert.equal(loadRole(roles, 'bot1'), 'sammler');
    bot.emit('message', msg('status', true), 'chat', uuid);
    assert.match(whispers.at(-1).text, /^ok: Leben 20, Essen 18, frei, Liste 1, Inventar 0%, Kiste nein$/);
    bot.emit('message', msg('folge', true), 'chat', uuid);
    assert.equal(runner.queue[0].type, 'follow');
    bot.emit('message', msg('hol 1 torch', true), 'chat', uuid);
    assert.match(whispers.at(-1).text, /^geht nicht:/); assert.equal(runner.queue[0].type, 'follow');
    runner.current = {...runner.queue.shift(), status: 'running'}; // pump is stubbed; follow runs, come waits
    bot.emit('message', msg('stopp', true), 'chat', uuid);
    assert.equal(runner.current.cancelled, true); assert.equal(runner.queue.length, 1);
    assert.match(whispers.at(-1).text, /^ok: abgebrochen, weiter mit komm$/);
    runner.emit('stop', 'stopped: follow fancy8869', runner.current.id, 'folge'); // what the real pump does once the cancelled job ends
    assert.ok(outcomes.some((o) => o[1] === 'stopped'));
    bot.emit('message', msg('alles stopp', true), 'chat', uuid);
    assert.equal(runner.queue.length, 0); assert.equal(whispers.at(-1).text, 'ok: alles gestoppt'); runner.current = null;
    // the player hears how an in-game order ended, and of a death
    assert.ok(whispers.some((w) => w.text === 'gestoppt: folge'));
    // queue words: orders append, stopp keeps the queue, jetzt goes first and re-queues the running job
    runner.queue = []; runner.current = null;
    bot.emit('message', msg('hol 16 stein', true), 'chat', uuid);
    assert.ok(!whispers.some((w) => w.text === 'ok: sammle')); // no receipt for a job that starts at once
    bot.emit('message', msg('hol 16 kohle', true), 'chat', uuid);
    bot.emit('message', msg('hol 8 holz', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine', 'mine', 'chop']);
    assert.equal(whispers.at(-1).text, 'ok: kommt dran, Platz 3');
    bot.emit('message', msg('queue', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, 'ok: 1 hol 16 stein, 2 hol 16 kohle, 3 hol 8 holz');
    bot.emit('message', msg('queue weg 2', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine', 'chop']);
    bot.emit('message', msg('queue erst 2', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['chop', 'mine']);
    bot.emit('message', msg('queue weg 9', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, 'geht nicht: nur 2 in der Liste');
    runner.current = {...runner.queue.shift(), status: 'running', t: {done: 3, total: 8}};
    bot.emit('message', msg('stopp', true), 'chat', uuid);
    assert.equal(runner.current.cancelled, true); assert.equal(runner.queue.length, 1);
    runner.current = {id: 77, type: 'mine', args: {block: 'stone', count: 16}, status: 'running', t: {done: 4, total: 16}};
    bot.emit('message', msg('jetzt hol 2 kohle', true), 'chat', uuid);
    assert.equal(runner.queue[0].args.block, 'coal_ore'); assert.equal(runner.queue[1].id, 77); assert.ok(runner.queue[1].resume);
    bot.emit('message', msg('alles stopp', true), 'chat', uuid);
    assert.equal(runner.queue.length, 0);
    bot.emit('message', msg('laut', true), 'chat', uuid);
    assert.equal(runner.prefs.verbose, true); assert.equal(whispers.at(-1).text, 'ok: laut');
    assert.equal(JSON.parse(fs.readFileSync(runner.prefsFile, 'utf8')).bot1.verbose, true);
    bot.emit('message', msg('hilfe', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, require('../owner').HELP2);
    runner.snapshot = () => ({health: 20, food: 18, job: {label: 'mine stone 16', done: 4, total: 16}, role: runner.role, freeSlots: 18, strangerOrders: 0});
    bot.emit('message', msg('status', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, 'ok: Leben 20, Essen 18, hol 16 stein 25%, Liste 0, Inventar 50%, Kiste nein');
    runner.snapshot = () => ({health: 20, food: 18, job: {label: 'x', done: 4, total: 16}, role: runner.role, freeSlots: 0, strangerOrders: 0});
    runner.current = {id: 1, type: 'mine', args: {block: 'deepslate_diamond_ore', count: 4096}};
    bot.emit('message', msg('status', true), 'chat', uuid);
    assert.ok(whispers.at(-1).text.length <= 100); assert.match(whispers.at(-1).text, /^ok: Leben 20, Essen 18, hol 4096 deepslate_diamo 25%, Liste 0, Inventar 100%, Kiste nein$/);
    // trade is still a placeholder (Task 6): nothing is queued and nothing unbounded starts
    for (const s of ['handel sticks', 'jetzt handel sticks']) {
      bot.emit('message', msg(s, true), 'chat', uuid);
      assert.equal(whispers.at(-1).text, 'geht nicht: noch nicht'); assert.equal(runner.queue.length, 0);
    }
    // own chest, keep list, lagern
    const {loadPrefs} = require('../prefs');
    const say = (s) => { bot.emit('message', msg(s, true), 'chat', uuid); return whispers.at(-1).text; };
    bot.registry = {itemsByName: {stick: {}, coal: {}}};
    const chestAt = {x: 1, y: 2, z: 3};
    bot.blockAtEntityCursor = () => ({name: 'barrel', position: chestAt});
    assert.equal(say('kiste'), 'ok: Kiste: 1 2 3'); assert.deepEqual(runner.prefs.chest, chestAt); assert.deepEqual(loadPrefs(runner.prefsFile, 'bot1').chest, chestAt);
    bot.blockAtEntityCursor = () => ({name: 'stone', position: chestAt});
    assert.equal(say('kiste'), 'geht nicht: schau auf eine Kiste');
    bot.blockAtEntityCursor = () => null;
    assert.equal(say('kiste'), 'geht nicht: schau auf eine Kiste');
    const seen = bot.players.fancy8869.entity; bot.players.fancy8869.entity = null;
    assert.equal(say('kiste'), 'geht nicht: ich sehe dich nicht'); bot.players.fancy8869.entity = seen;
    bot.blockAt = () => null;
    assert.equal(say('kiste 5 6 7'), 'geht nicht: zu weit weg: 5 6 7');
    bot.blockAt = () => ({name: 'stone'});
    assert.equal(say('kiste 5 6 7'), 'geht nicht: keine Kiste bei 5 6 7');
    assert.deepEqual(runner.prefs.chest, chestAt, 'a refused order keeps the chest');
    bot.blockAt = () => ({name: 'trapped_chest', position: {x: 5, y: 6, z: 7}});
    assert.equal(say('kiste 5 6 7'), 'ok: Kiste: 5 6 7'); assert.deepEqual(loadPrefs(runner.prefsFile, 'bot1').chest, {x: 5, y: 6, z: 7});
    assert.equal(say('behalte 64 stick'), 'ok: behalte 64 stick'); assert.deepEqual(loadPrefs(runner.prefsFile, 'bot1').keep, {stick: 64});
    assert.equal(say('behalte 8 coal'), 'ok: behalte 8 coal'); assert.deepEqual(runner.prefs.keep, {stick: 64, coal: 8});
    assert.equal(say('behalte 8 kohle'), 'geht nicht: kenne kohle nicht'); assert.deepEqual(runner.prefs.keep, {stick: 64, coal: 8});
    assert.equal(say('behalte nichts stick'), 'ok: behalte stick nicht mehr'); assert.deepEqual(loadPrefs(runner.prefsFile, 'bot1').keep, {coal: 8});
    runner.queue = []; runner.current = null;
    bot.emit('message', msg('lagern', true), 'chat', uuid);
    assert.deepEqual(enqueued.at(-1), ['deposit', {own: true}, {}]);
    bot.emit('message', msg('jetzt lagern', true), 'chat', uuid);
    assert.deepEqual(enqueued.at(-1).slice(0, 2), ['deposit', {own: true}]);
    runner.queue = []; runner.current = null;
    // placement against open-ended and non-chat jobs
    const run = (j) => { runner.current = {status: 'running', args: {}, ...j}; };
    runner.queue = []; run({id: 90, type: 'follow'}); runner.chatJobs.add(90);
    bot.emit('message', msg('hol 16 stein', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine', 'follow']); assert.ok(runner.queue[1].resume);
    run({id: 91, type: 'mine', args: {block: 'stone', count: 1}}); runner.chatJobs.add(91); // stone runs, follow waits
    bot.emit('message', msg('hol 8 holz', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine', 'chop', 'follow']);
    runner.queue = []; run({id: 92, type: 'mine', args: {block: 'stone', count: 1}}); // hub job, not a chat job
    bot.emit('message', msg('hol 16 stein', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.id), [runner.jobSeq, 92]);
    runner.queue = [{id: 93, type: 'mine', args: {block: 'stone', count: 1}, status: 'queued'}]; run({id: 94, type: 'chop', args: {count: 1}}); runner.chatJobs.add(94);
    bot.emit('message', msg('hol 16 kohle', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.id), [runner.jobSeq, 93]);
    runner.queue = []; run({id: 95, type: 'mine', args: {block: 'stone', count: 1}}); runner.chatJobs.add(95);
    bot.emit('message', msg('komm', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['come', 'mine']);
    runner.queue = []; run({id: 96, type: 'trade', args: {item: 'stick'}}); // hub trade: interrupted, not dropped
    bot.emit('message', msg('hol 16 stein', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine', 'trade']); assert.ok(runner.queue[1].resume);
    runner.queue = []; run({id: 97, type: 'craft', args: {item: 'stick', count: 1}}); // non-resumable hub job stops as under replace
    bot.emit('message', msg('hol 16 stein', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine']);
    // chat interruptions do not use up the death budget
    runner.queue = []; const long = {id: 98, type: 'mine', args: {block: 'stone', count: 99}, status: 'running', interruptions: 0}; runner.chatJobs.add(98);
    for (let i = 0; i < 4; i++) {
      run(runner.queue.length ? runner.queue.splice(runner.queue.findIndex((j) => j.id === 98), 1)[0] : long); // the pump would take it back
      bot.emit('message', msg('komm', true), 'chat', uuid);
      runner.queue = runner.queue.filter((j) => j.type !== 'come');
    }
    assert.deepEqual(runner.queue.map((j) => j.id), [98]); assert.equal(runner.queue[0].interruptions || 0, 0);
    runner.queue = []; const gave = [], emit0 = runner.emit.bind(runner); runner.emit = (k, ...r) => { gave.push(k); return emit0(k, ...r); };
    runner.resumeLater({id: 99, type: 'mine', args: {}, interruptions: 3}, 'died');
    assert.equal(runner.queue.length, 0); assert.ok(gave.includes('fail')); runner.emit = emit0;
    // a duplicate area order is answered, and its id does not stay behind in chatJobs
    runner.queue = []; runner.current = null; runner.chatJobs.clear();
    runner.builderOrder = () => ({type: 'clear', args: {x1: 0, y1: 60, z1: 0, x2: 2, y2: 62, z2: 2}});
    const before = whispers.length;
    bot.emit('message', msg('abbau', true), 'chat', uuid); bot.emit('message', msg('abbau', true), 'chat', uuid);
    assert.deepEqual(whispers.slice(before).map((w) => w.text), ['ok: läuft schon']); assert.equal(runner.queue.length, 1);
    assert.deepEqual([...runner.chatJobs], [runner.queue[0].id]); assert.ok(!runner.orders.has(runner.jobSeq + 1));
    delete runner.builderOrder; runner.queue = []; runner.current = null; runner.chatJobs.clear();
    runner.emit('done', 'finished: something else', 999); assert.ok(!whispers.some((w) => /something else/.test(w.text)));
    const nw = whispers.length; runner.emit('death', 'died at 1 2 3'); assert.equal(whispers.length, nw); // the hub tells of deaths, not the runner
    // the main server sends the format text instead of the key: no bot ever answered there (probe 2026-10-15)
    const asText = (m, t) => ({...m, translate: t}), heard = whispers.length;
    bot.emit('message', asText(msg('bot1 status'), '<%s> %s'), 'chat', uuid, false);
    assert.match(whispers.at(-1).text, /^ok: Leben 20/); assert.equal(whispers.length, heard + 1);
    bot.emit('message', asText(msg('status', true), '%s whispers to you: %s'), 'chat', uuid, false);
    assert.equal(whispers.length, heard + 2);
    const disabled = new BotRunner('bot1', {log: () => {}}); disabled.bindOwner(bot);
    const env = {BOT_NAMES: 'bot1', BOT_PASSWORD_SEED: 'test', OWNER_UUIDS: uuid};
    assert.deepEqual(loadConfig(env).ownerUuids, [uuid]);
    assert.throws(() => loadConfig({...env, OWNER_UUIDS: 'bad'}), /OWNER_UUIDS/);
    assert.deepEqual(loadWorkerConfig({...env, HUB_URL: 'ws://localhost/worker', HUB_TOKEN: 'test', MC_HOST: 'localhost'}, ['bot1']).ownerUuids, [uuid]);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  console.log('owner: in-game orders ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
