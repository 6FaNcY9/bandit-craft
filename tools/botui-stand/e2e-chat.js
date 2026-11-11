// The public world's chat bridge (minecraft-public/chatbridge) on the stand, against a Discord made up here:
// starts the stand itself with the bridge's environment and stops it again.
// NODE_PATH = mcbots node_modules: node tools/botui-stand/e2e-chat.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {WebSocketServer} = require('ws');
const {connect} = require('./client');

const PORT = 18200, CHANNEL = '4242', TOKEN = 'stand-bridge-token', SELF = '777';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (fn()) return;
  throw new Error(`timeout: ${what}`);
}
// A Discord user id that says "created n days ago".
const born = (daysAgo) => String((BigInt(Date.now() - daysAgo * 86400000) - 1420070400000n) << 22n);

(async () => {
  const posts = [], identifies = [], searches = [], deleted = [];
  // What the channel holds from before the limit: one copy of the bridge's own, one message a member wrote.
  const history = [{id: born(31), author: {id: SELF}}, {id: born(32), author: {id: born(400)}}];
  let refuse = 1, gateway = null, seq = 0;
  // Java's client offers HTTP/2 on plain http ("Upgrade: h2c"); only a real WebSocket upgrade goes to ws (Node 24).
  const server = http.createServer({shouldUpgradeCallback: (req) => req.headers.upgrade === 'websocket'}, (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      assert.equal(req.headers.authorization, `Bot ${TOKEN}`);
      // the search for old copies, and their deletion
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === `/channels/${CHANNEL}/messages`) {
        searches.push(url.searchParams.get('before'));
        return res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(history));
      }
      if (req.method === 'DELETE') { deleted.push(req.url); return res.writeHead(204).end(); }
      assert.equal(`${req.method} ${req.url}`, `POST /channels/${CHANNEL}/messages`);
      if (refuse-- > 0) return res.writeHead(429, {'content-type': 'application/json'}).end('{"retry_after": 0.3}');
      posts.push(JSON.parse(body));
      res.writeHead(200, {'content-type': 'application/json'}).end('{"id":"1"}');
    });
  });
  new WebSocketServer({server}).on('connection', (ws) => {
    gateway = ws;
    ws.send(JSON.stringify({op: 10, d: {heartbeat_interval: 1000}}));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.op === 2) { identifies.push(m.d); ws.send(JSON.stringify({op: 0, t: 'READY', s: ++seq, d: {user: {id: SELF}}})); }
      if (m.op === 1) ws.send(JSON.stringify({op: 11}));
    });
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const say = (d) => gateway.send(JSON.stringify({op: 0, t: 'MESSAGE_CREATE', s: ++seq, d: {channel_id: CHANNEL, type: 0, ...d}}));

  const stand = path.join(__dirname, 'stand.sh');
  const env = {...process.env, CHATBRIDGE_TOKEN: TOKEN, CHATBRIDGE_CHANNEL: CHANNEL, CHATBRIDGE_API: `http://127.0.0.1:${PORT}`, CHATBRIDGE_GATEWAY: `ws://127.0.0.1:${PORT}/`};
  execFileSync(stand, ['up'], {env, stdio: 'inherit'});
  try {
    // the gateway: one identify with the token and the two intents, heartbeats answered, no reconnect
    await waitFor(() => identifies.length, 'identify');
    assert.equal(identifies[0].token, TOKEN);
    assert.equal(identifies[0].intents, (1 << 9) | (1 << 15));

    // game to Discord: join, chat with markdown and a mass mention, through one 429
    const p = await connect('Tester');
    await waitFor(() => posts.some((m) => m.content.includes('➡️ **Tester**')), 'join line');
    p.chat('hallo **welt** @everyone [x](http://a)');
    await waitFor(() => posts.some((m) => m.content.includes('**Tester**: hallo')), 'chat line');
    const chat = posts.find((m) => m.content.includes('**Tester**: hallo'));
    assert.ok(chat.content.includes('**Tester**: hallo \\*\\*welt\\*\\* @everyone \\[x\\](http\\://a)'), chat.content);
    for (const m of posts) assert.deepEqual([m.allowed_mentions, m.flags], [{parse: []}, 4]);

    // Discord to game: plain text with a prefix; ids, line breaks and colour codes gone
    say({content: 'hi <@1>\nwie §cgeht <a:wave:9>', author: {id: born(30), username: 'vino'}, member: {nick: null}});
    await waitFor(() => p.chats.some((c) => c.includes('vino: hi @… wie geht :wave:')), 'Discord line in the game');
    const shown = p.chats.find((c) => c.includes('vino: hi'));
    assert.ok(shown.includes('[Discord] '), shown);
    assert.ok(!/click|hover/i.test(shown), 'no click or hover from Discord text');
    // not shown: a new account, a bot, a webhook, another channel, an attachment without text
    say({content: 'NEU', author: {id: born(2), username: 'frisch'}});
    say({content: 'BOT', author: {id: born(30), username: 'b', bot: true}});
    say({content: 'HOOK', author: {id: born(30), username: 'h'}, webhook_id: '7'});
    say({content: 'FREMD', author: {id: born(30), username: 'x'}, channel_id: '1'});
    say({content: '', author: {id: born(30), username: 'bild'}, attachments: [{url: 'https://x/y.png'}]});
    // a flood: at most 8 lines in 10 s reach the game (one is used above)
    for (let i = 0; i < 20; i++) say({content: `flut ${i}`, author: {id: born(30), username: 'laut'}});
    await waitFor(() => p.chats.some((c) => c.includes('flut 6')), 'the flood up to its cap');
    await sleep(1500);
    for (const no of ['NEU', 'BOT', 'HOOK', 'FREMD', 'bild', 'flut 7']) assert.ok(!p.chats.some((c) => c.includes(no)), `${no} must not reach the game`);

    // death and leave
    fs.writeFileSync(path.join(process.env.XDG_RUNTIME_DIR, 'botui-stand', 'in'), 'kill Tester\n');
    await waitFor(() => posts.some((m) => /💀 Tester /.test(m.content)), 'death line');
    await p.end();
    await waitFor(() => posts.some((m) => m.content.includes('⬅️ **Tester**')), 'leave line');
    // old copies: the bridge's own message past 30 days is deleted, the member's stays; one search, from the limit
    await waitFor(() => deleted.length, 'an old copy deleted', 20000);
    await sleep(6000);
    assert.deepEqual(deleted, [`/channels/${CHANNEL}/messages/${history[0].id}`]);
    assert.equal(searches.length, 1);
    const limit = Number((BigInt(searches[0]) >> 22n) + 1420070400000n);
    assert.ok(Math.abs(Date.now() - 30 * 86400000 - limit) < 600000, `search from 30 days back, got ${new Date(limit).toISOString()}`);
    assert.equal(identifies.length, 1, 'the gateway connection held');
    console.log('chat bridge e2e ok');
  } finally {
    execFileSync(stand, ['down'], {stdio: 'inherit'});
    server.closeAllConnections?.();
    server.close();
    gateway?.terminate();
  }
})().catch((e) => { console.error(e); process.exit(1); });
