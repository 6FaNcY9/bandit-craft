const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApi, applyLayout } = require('./main')

// An in-memory guild that answers the calls applyLayout makes, as Discord does after Community setup.
function fakeGuild () {
  let next = 1000
  const g = {
    guild: { id: '1', verification_level: 1, explicit_content_filter: 2, rules_channel_id: '2', public_updates_channel_id: '3' },
    roles: [{ id: '1', name: '@everyone' }, { id: '9', name: 'bandit-admin' }],
    channels: [{ id: '2', type: 0, name: 'rules', parent_id: null }, { id: '3', type: 0, name: 'moderator-only', parent_id: null }],
    rules: [{ id: '50', trigger_type: 5, name: 'Block Mention Spam' }],
    calls: []
  }
  g.api = async (method, path, body) => {
    g.calls.push(`${method} ${path}`)
    const id = String(next++)
    if (method === 'DELETE') throw new Error('must never delete')
    if (path === '/users/@me') return { id: '7' }
    if (path === '/guilds/1/roles') return method === 'GET' ? g.roles : (g.roles.push({ id, ...body }), { id })
    if (path === '/guilds/1/channels') {
      if (method === 'GET') return g.channels
      const made = { id, ...body, name: g.rename?.[body.name] ?? body.name }
      g.channels.push(made)
      return made
    }
    if (path.startsWith('/channels/')) return Object.assign(g.channels.find(c => c.id === path.split('/')[2]), body)
    if (path === '/guilds/1') return method === 'GET' ? g.guild : Object.assign(g.guild, body)
    if (path === '/guilds/1/auto-moderation/rules') return method === 'GET' ? g.rules : (g.rules.push({ id, ...body }), { id })
    throw new Error(`unexpected ${method} ${path}`)
  }
  return g
}

test('builds the layout once; a second start writes nothing', async () => {
  const g = fakeGuild()
  const first = await applyLayout(g.api, '1')
  assert.ok(first.writes > 0)
  assert.equal(g.channels.find(c => c.id === first.alertsChannel).name, 'lab-alerts')
  assert.equal(g.channels.filter(c => c.type === 4).length, 5)
  assert.equal(g.guild.verification_level, 3)
  assert.equal(g.channels.find(c => c.id === g.guild.rules_channel_id).name, 'regeln-rules')
  assert.equal(g.rules.filter(r => r.trigger_type === 5).length, 1, 'Discord\'s own mention rule is kept, not doubled')
  assert.equal(g.rules.length, 3)
  const second = await applyLayout(g.api, '1')
  assert.equal(second.writes, 0)
  assert.equal(g.channels.length, 2 + 5 + 13)
})

test('a channel dragged into another category is moved back, not duplicated', async () => {
  const g = fakeGuild()
  await applyLayout(g.api, '1')
  const chat = g.channels.find(c => c.name === 'chat')
  chat.parent_id = g.channels.find(c => c.name === 'ADMIN').id
  const again = await applyLayout(g.api, '1')
  assert.equal(again.writes, 1)
  assert.equal(chat.parent_id, g.channels.find(c => c.name === 'COMMUNITY').id)
  assert.equal(g.channels.filter(c => c.name === 'chat').length, 1)
})

test('a channel name Discord rewrites stops the bot instead of duplicating on each start', async () => {
  const g = fakeGuild()
  g.rename = { 'ankündigungen': 'ankundigungen' }
  await assert.rejects(applyLayout(g.api, '1'), err => err.exitCode === 2)
})

test('waits out a 429 and retries', async () => {
  const replies = [
    { status: 429, json: async () => ({ retry_after: 0.01 }) },
    { status: 200, ok: true, json: async () => ({ id: '7' }) }
  ]
  const seen = []
  const api = makeApi('t', async (_url, opts) => { seen.push(opts.headers.authorization); return replies.shift() })
  assert.deepEqual(await api('GET', '/users/@me'), { id: '7' })
  assert.deepEqual(seen, ['Bot t', 'Bot t'])
})
