const test = require('node:test')
const assert = require('node:assert/strict')
const { connect } = require('./gateway')

// A socket the test drives by hand; `sent` holds what the client wrote.
function fakeSockets () {
  const all = []
  class WS {
    constructor (url) { this.url = url; this.sent = []; this.closed = false; all.push(this) }
    send (text) { this.sent.push(JSON.parse(text)) }
    close () { this.closed = true }
    push (payload) { this.onmessage({ data: JSON.stringify(payload) }) }
  }
  return { WS, all }
}

test('identifies without intents, heartbeats with the last sequence and hands interactions over', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { WS, all } = fakeSockets()
  const got = []
  connect({ token: 'T', onInteraction: i => got.push(i), WS, log: () => {} })
  const ws = all[0]
  ws.push({ op: 10, d: { heartbeat_interval: 1000 } })
  assert.deepEqual(ws.sent[0].op, 2)
  assert.equal(ws.sent[0].d.token, 'T')
  assert.equal(ws.sent[0].d.intents, 0)
  ws.push({ op: 0, t: 'READY', s: 1, d: {} })
  ws.push({ op: 0, t: 'INTERACTION_CREATE', s: 2, d: { id: '9' } })
  assert.deepEqual(got, [{ id: '9' }])
  t.mock.timers.tick(1000)
  assert.deepEqual(ws.sent[1], { op: 1, d: 2 })
  ws.push({ op: 11 })
  t.mock.timers.tick(1000)
  assert.equal(ws.sent.length, 3)
  assert.equal(all.length, 1)
})

test('connects again after a close, a reconnect request and a missed heartbeat ack', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { WS, all } = fakeSockets()
  connect({ token: 'T', onInteraction: () => {}, WS, log: () => {} })
  all[0].push({ op: 10, d: { heartbeat_interval: 1000 } })
  all[0].onclose({ code: 1006 })
  t.mock.timers.tick(5000)
  assert.equal(all.length, 2, 'after a close')

  all[1].push({ op: 10, d: { heartbeat_interval: 1000 } })
  all[1].push({ op: 7 })
  assert.equal(all[1].closed, true)
  t.mock.timers.tick(10000)
  assert.equal(all.length, 3, 'after op 7, waiting twice as long while nothing got through')

  all[2].push({ op: 10, d: { heartbeat_interval: 1000 } })
  all[2].push({ op: 0, t: 'READY', s: 1, d: {} })
  t.mock.timers.tick(1000) // heartbeat, never acknowledged
  t.mock.timers.tick(1000)
  assert.equal(all[2].closed, true, 'a silent connection is dropped')
  t.mock.timers.tick(5000)
  assert.equal(all.length, 4, 'READY put the wait back to 5 s')
  t.mock.timers.tick(60000)
  assert.equal(all[2].sent.length, 2, 'a dropped socket beats no more')

  const before = all.length
  all.at(-1).onmessage({ data: 'not json' })
  assert.equal(all.at(-1).closed, true, 'an unreadable frame drops the connection, not the process')
  t.mock.timers.tick(300000)
  assert.ok(all.length > before)
})
