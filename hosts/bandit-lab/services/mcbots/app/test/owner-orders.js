'use strict';
// Owner orders use packet identity and structured chat, never text pattern events.
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
  const {EventEmitter} = require('node:events');
  const {isOwnerMessage, parseOrder, translate, makeSayer, makeDemoLog, loadRole, saveRole} = require('../owner');
  const {BotRunner} = require('../bots');
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
  for (const text of ['', 'rolle chef', 'rolle', 'komm jetzt', 'wache dort', 'hol 0 eisen', 'hol 257 eisen', 'hol -1 eisen', 'hol 1.5 eisen', 'hol NaN eisen', 'hol 1 eisen extra', 'hol 1 stone/../', 'nonsense']) assert.deepEqual(tr(text), {unknown: true});
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
    bot.whisper = (name, text) => whispers.push({name, text});
    const outcomes = [], orders = [];
    const runner = new BotRunner('bot1', {log: () => {}, ownerUuids: [uuid], demoLog: {add: (e) => { orders.push(e); return String(orders.length); }, outcome: (...a) => outcomes.push(a)}});
    runner.bot = bot; runner.online = true;
    runner.snapshot = () => ({health: 20, food: 18, job: null, role: runner.role, strangerOrders: runner.strangerOrders});
    runner.pump = () => {}; // keep the real enqueue/validation; no Minecraft work
    runner.bindOwner(bot);
    const enqueued = [], enqueue = runner.enqueue.bind(runner);
    runner.enqueue = (...args) => { enqueued.push(args); return enqueue(...args); };
    const msg = (text, incoming = false) => ({translate: incoming ? 'commands.message.display.incoming' : 'chat.type.text', with: [{toString: () => 'fancy8869'}, {toString: () => text}]});
    bot.emit('message', msg('bot1 komm'), 'chat', uuid, true);
    assert.deepEqual(enqueued[0], ['come', {player: 'fancy8869'}, {replace: true}]);
    assert.deepEqual(whispers, [{name: 'fancy8869', text: 'ok: komme'}]);
    bot.emit('message', msg('bot1 stopp'), 'chat', other, true);
    assert.equal(runner.snapshot().strangerOrders, 1); assert.equal(whispers.length, 1); assert.equal(enqueued.length, 1);
    bot.emit('message', msg('[fancy8869 -> bot1] stopp'), 'system', null);
    assert.equal(enqueued.length, 1);
    const job = runner.queue[0];
    runner.emit('done', 'finished: come', job.id + 1); assert.equal(outcomes.length, 0);
    runner.emit('done', 'finished: come', job.id); assert.deepEqual(outcomes[0], ['1', 'finished', 'finished: come']);
    runner.emit('done', 'finished: come', job.id); assert.equal(outcomes.length, 1);
    runner.say = (text) => bot.whisper('fancy8869', text);
    runner.rolesFile = roles;
    bot.emit('message', msg('rolle sammler', true), 'chat', uuid);
    assert.equal(runner.role, 'sammler'); assert.equal(loadRole(roles, 'bot1'), 'sammler');
    bot.emit('message', msg('status', true), 'chat', uuid);
    assert.match(whispers.at(-1).text, /Leben 20, Essen 18, frei, Rolle sammler/);
    bot.emit('message', msg('folge', true), 'chat', uuid);
    assert.equal(runner.queue[0].type, 'follow');
    bot.emit('message', msg('hol 1 torch', true), 'chat', uuid);
    assert.match(whispers.at(-1).text, /^geht nicht:/); assert.equal(runner.queue[0].type, 'follow');
    bot.emit('message', msg('stopp', true), 'chat', uuid);
    assert.equal(runner.queue.length, 0); assert.ok(outcomes.some((o) => o[1] === 'stopped'));
    // the player hears how an in-game order ended, and of a death
    assert.ok(whispers.some((w) => /^gestoppt: stopped: follow/.test(w.text)));
    runner.emit('done', 'finished: something else', 999); assert.ok(!whispers.some((w) => /something else/.test(w.text)));
    runner.emit('death', 'died at 1 2 3'); assert.equal(whispers.at(-1).text, 'gestorben: died at 1 2 3');
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
