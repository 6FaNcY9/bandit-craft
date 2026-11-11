const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { ping, tracker, keeper } = require('./status')
const texts = require('./texts')

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

test('server-list ping reads players and version, also when the answer comes in pieces', async () => {
  const json = Buffer.from(JSON.stringify({ version: { name: 'Paper 26.2' }, players: { online: 3, max: 20, sample: [{ name: 'x' }] } }))
  const body = Buffer.concat([Buffer.from([0x00, json.length]), json])
  const reply = Buffer.concat([Buffer.from([body.length]), body])
  let got = Buffer.alloc(0)
  const server = net.createServer(sock => {
    sock.on('data', d => {
      got = Buffer.concat([got, d])
      if (got.subarray(-2).equals(Buffer.from([0x01, 0x00]))) {
        sock.write(reply.subarray(0, 7))
        setTimeout(() => sock.end(reply.subarray(7)), 5)
      }
    })
  })
  const port = await listen(server)
  assert.deepEqual(await ping('127.0.0.1', port), { online: true, players: 3, max: 20, version: 'Paper 26.2' })
  assert.equal(got[1], 0x00, 'handshake packet id')
  assert.ok(got.includes(Buffer.from('127.0.0.1')), 'handshake names the host')
  server.close()
})

test('a server that never answers is a failure, not a hang', async () => {
  const server = net.createServer(() => {})
  const port = await listen(server)
  await assert.rejects(ping('127.0.0.1', port, { timeoutMs: 50 }))
  server.close()
})

test('one lost ping does not flip the status, two do', () => {
  const t = tracker()
  const up = { online: true, players: 1, max: 20, version: 'v' }
  assert.deepEqual(t(up), up)
  assert.deepEqual(t(null), up)
  assert.deepEqual(t(null), { online: false })
  assert.deepEqual(t(up), up)
  assert.deepEqual(tracker()(null), { online: false }, 'nothing known yet: offline at once')
})

function fakeChannel (messages = []) {
  const calls = []
  const api = async (method, path, body) => {
    calls.push(`${method} ${path}`)
    if (method === 'GET') return messages
    if (method === 'POST') { messages.push({ id: '9', author: { id: 'bot' }, ...body }); return { id: '9' } }
    return Object.assign(messages.find(m => m.id === path.split('/')[4]), body)
  }
  return { api, calls, messages }
}

test('keeps one message: posts once, edits on change, stays quiet otherwise', async () => {
  const ch = fakeChannel([{ id: '1', author: { id: 'owner' }, content: 'hi' }])
  const set = keeper(ch.api, 'c', 'bot')
  await set('a')
  await set('a')
  await set('b')
  assert.deepEqual(ch.calls, ['GET /channels/c/messages?limit=100', 'POST /channels/c/messages', 'PATCH /channels/c/messages/9'])
  assert.deepEqual(ch.messages[1].allowed_mentions, { parse: [] })
  assert.equal(ch.messages[0].content, 'hi', 'other people\'s messages are left alone')
})

test('after a restart the message already there is reused, unchanged text writes nothing', async () => {
  const ch = fakeChannel([{ id: '5', author: { id: 'bot' }, content: 'a' }])
  const set = keeper(ch.api, 'c', 'bot')
  await set('a')
  assert.deepEqual(ch.calls, ['GET /channels/c/messages?limit=100'])
  await set('b')
  assert.equal(ch.calls[1], 'PATCH /channels/c/messages/5')
})

const LAUNCH = 1795802400
const up = { online: true, players: 3, max: 20, version: 'Paper 26.2' }
const address = 'play.example.org'

test('before the opening: a countdown when the date is set, "soon" when not, never the address', () => {
  const dated = texts.all({ launchAt: LAUNCH, now: LAUNCH - 86400, state: up, address })
  const open = texts.all({ launchAt: null, now: 1000, state: up, address })
  for (const t of [dated, open]) {
    for (const text of Object.values(t)) assert.ok(!text.includes(address), 'address stays secret until the opening')
  }
  assert.ok(dated.status.includes(`<t:${LAUNCH}:R>`))
  assert.ok(dated.announcement.includes(`<t:${LAUNCH}:F>`))
  assert.ok(!open.status.includes('<t:17958'))
  assert.match(open.announcement, /bald/i)
})

test('from the opening on: address, players and version are shown', () => {
  const t = texts.all({ launchAt: LAUNCH, now: LAUNCH + 1, state: up, address })
  assert.ok(t.join.includes(address))
  assert.match(t.status, /3\/20/)
  assert.ok(t.status.includes('Paper 26.2'))
  assert.match(texts.all({ launchAt: LAUNCH, now: LAUNCH + 1, state: { online: false }, address }).status, /offline/i)
})

test('the status text changes at most every five minutes while nothing happens', () => {
  const at = now => texts.all({ launchAt: LAUNCH, now, state: up, address }).status
  assert.equal(at(LAUNCH + 600), at(LAUNCH + 899))
  assert.notEqual(at(LAUNCH + 600), at(LAUNCH + 900))
})

test('every text fits a Discord message and names the three rules', () => {
  for (const now of [LAUNCH - 1, LAUNCH + 1]) {
    for (const [name, text] of Object.entries(texts.all({ launchAt: LAUNCH, now, state: up, address }))) {
      assert.ok(text.length <= 2000, `${name} is ${text.length} long`)
    }
  }
  assert.match(texts.all({ launchAt: null, now: 0, state: null, address }).rules, /doxxing/i)
})
