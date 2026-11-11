const test = require('node:test')
const assert = require('node:assert/strict')
const { COMMANDS, makeHub, answer, start } = require('./control')

const interaction = (sub, { user = 'owner', channel = 'kommando', bot } = {}) => ({
  id: '1', token: 'tok', type: 2, channel_id: channel,
  member: { user: { id: user, username: `name-of-${user}` } },
  data: { name: 'bots', options: [{ type: 1, name: sub, options: bot ? [{ type: 3, name: 'bot', value: bot }] : [] }] }
})

function fakeHub (answers = {}) {
  const calls = []
  const hub = async (method, path, body) => {
    calls.push([method, path, body])
    if (answers[path] instanceof Error) throw answers[path]
    return answers[path]
  }
  return { hub, calls }
}
const ctx = (hub, logs = []) => ({ channelId: 'kommando', allowed: ['owner'], hub, log: m => logs.push(m) })

test('the command is hidden from everyone but administrators', () => {
  assert.equal(COMMANDS.length, 1)
  assert.equal(COMMANDS[0].default_member_permissions, '0')
  assert.deepEqual(COMMANDS[0].options.map(o => o.name), ['status', 'stopp', 'weiter'])
})

test('status lists what each bot does', async () => {
  const { hub } = fakeHub({ fleet: { bots: [
    { name: 'bot1', online: true, job: 'mine iron_ore 64', queued: 2, paused: null },
    { name: 'bot2', online: true, job: null, queued: 0, paused: 'schematic' },
    { name: 'bot3', online: false, job: null, queued: 0, paused: null }
  ] } })
  const { content, flags } = await answer(interaction('status'), ctx(hub))
  assert.equal(flags, undefined)
  assert.deepEqual(content.split('\n'), [
    '🟢 **bot1**: mine iron_ore 64 (+2 wartend)',
    '🟢 **bot2**: frei, Projekt schematic pausiert',
    '⚫ **bot3**: offline'
  ])
})

test('stopp and weiter reach the hub, for one bot or all', async () => {
  const { hub, calls } = fakeHub({ stop: { ok: true, unreached: ['bot3'] }, resume: { ok: true, resumed: ['bot2'] } })
  assert.equal((await answer(interaction('stopp', { bot: 'bot1' }), ctx(hub))).content, 'Gestoppt: bot1. Nicht erreicht: bot3.')
  assert.match((await answer(interaction('stopp'), ctx(hub))).content, /^Alle gestoppt\./)
  assert.equal((await answer(interaction('weiter'), ctx(hub))).content, 'Weiter: bot2.')
  assert.deepEqual(calls, [['POST', 'stop', { bot: 'bot1' }], ['POST', 'stop', { bot: undefined }], ['POST', 'resume', { bot: undefined }]])
})

test('a hub refusal is shown, in German where it is a known one', async () => {
  const { hub } = fakeHub({ stop: new Error('unknown bot'), resume: new Error('fetch failed') })
  assert.equal((await answer(interaction('stopp', { bot: 'x' }), ctx(hub))).content, 'Fehler: Diesen Bot gibt es nicht.')
  assert.equal((await answer(interaction('weiter'), ctx(hub))).content, 'Fehler: fetch failed')
})

test('anyone but the allowed user, and any other channel, is refused and logged without touching the hub', async () => {
  const { hub, calls } = fakeHub()
  const logs = []
  for (const i of [interaction('stopp', { user: 'moderator' }), interaction('status', { user: 'moderator' }), interaction('stopp', { channel: 'chat' }), { ...interaction('stopp'), member: undefined }]) {
    assert.deepEqual(await answer(i, ctx(hub, logs)), { content: 'Nicht erlaubt.', flags: 64 })
  }
  assert.deepEqual(calls, [])
  assert.equal(logs.length, 4)
  assert.match(logs[0], /refused \/bots stopp from name-of-moderator \(moderator\)/)
})

test('other interactions get no answer', async () => {
  const { hub, calls } = fakeHub()
  assert.equal(await answer({ ...interaction('status'), type: 3 }, ctx(hub)), null)
  assert.equal(await answer({ ...interaction('status'), data: { name: 'other' } }, ctx(hub)), null)
  assert.deepEqual(calls, [])
})

test('the hub client sends its token and turns an error body into an Error', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push([url, init.method, init.headers.authorization, init.body])
    return url.endsWith('/stop') ? { ok: false, status: 400, json: async () => ({ error: 'unknown bot' }) } : { ok: true, json: async () => ({ bots: [] }) }
  }
  const hub = makeHub('http://127.0.0.1:8095', 'secret', fetchImpl)
  assert.deepEqual(await hub('GET', 'fleet'), { bots: [] })
  await assert.rejects(hub('POST', 'stop', { bot: 'x' }), /unknown bot/)
  assert.deepEqual(seen, [
    ['http://127.0.0.1:8095/api/remote/fleet', 'GET', 'Bearer secret', undefined],
    ['http://127.0.0.1:8095/api/remote/stop', 'POST', 'Bearer secret', '{"bot":"x"}']
  ])
})

test('start registers the command for the guild, allows its owner and answers through the callback', async () => {
  const calls = []
  const api = async (method, path, body) => {
    calls.push([method, path, body])
    return path === '/guilds/G' ? { owner_id: 'owner' } : null
  }
  let onInteraction
  const { hub } = fakeHub({ stop: { ok: true, unreached: [] } })
  await start({ api, token: 't', guildId: 'G', botId: 'B', channels: { 'bot-kommando': 'kommando', 'lab-alerts': 'alerts' }, hub, connect: opts => { onInteraction = opts.onInteraction }, log: () => {} })
  assert.deepEqual(calls[1], ['PUT', '/applications/B/guilds/G/commands', COMMANDS])
  await onInteraction(interaction('stopp'))
  assert.deepEqual(calls[2], ['POST', '/interactions/1/tok/callback', { type: 4, data: { content: 'Alle gestoppt.', allowed_mentions: { parse: [] } } }])
  await onInteraction(interaction('stopp', { user: 'moderator' }))
  assert.equal(calls[3][1], '/channels/alerts/messages', 'a refusal is reported to the owner')
  assert.equal(calls[4][2].data.flags, 64)
})
