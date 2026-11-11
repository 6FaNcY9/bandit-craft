const test = require('node:test')
const assert = require('node:assert/strict')
const { LAYOUT, overwrites, diffChannel } = require('./layout')

const ids = { guild: '100', owner: '200', moderator: '300', bot: '400' }
const BOT_PERMS = 268520496n

test('readonly: everyone may not write, the bot may', () => {
  assert.deepEqual(overwrites('readonly', ids), [
    { id: '100', type: 0, allow: '0', deny: '2048' },
    { id: '400', type: 1, allow: '84992', deny: '0' }
  ])
})

test('open channels carry no overwrites', () => {
  assert.deepEqual(overwrites('open', ids), [])
})

test('owner channels are hidden from moderators and everyone', () => {
  const ow = overwrites('owner', ids)
  assert.deepEqual(ow.map(o => o.id), ['100', '200', '400'])
  assert.equal(ow[0].deny, '1024')
  assert.ok(overwrites('mods', ids).some(o => o.id === '300' && o.allow === '1024'))
})

test('every overwrite bit is one the bot holds', () => {
  for (const cat of LAYOUT.categories) {
    for (const o of overwrites(cat.access, ids)) {
      assert.equal((BigInt(o.allow) | BigInt(o.deny)) & ~BOT_PERMS, 0n, `${cat.name} ${o.id}`)
    }
  }
})

const want = { name: 'lab-alerts', type: 0, parent_id: '9', permission_overwrites: overwrites('owner', ids) }

test('a missing channel is created', () => {
  assert.deepEqual(diffChannel(want, undefined), { create: want })
})

test('an identical channel needs nothing, whatever the order and extra fields', () => {
  const have = { ...want, id: '55', position: 3, topic: 'x', permission_overwrites: [...want.permission_overwrites].reverse() }
  assert.equal(diffChannel(want, have), null)
})

test('a channel in the wrong category is moved, nothing else', () => {
  assert.deepEqual(diffChannel(want, { ...want, id: '55', parent_id: '8' }), { patch: { parent_id: '9' } })
})

test('changed overwrites are put back', () => {
  const have = { ...want, id: '55', permission_overwrites: [] }
  assert.deepEqual(diffChannel(want, have), { patch: { permission_overwrites: want.permission_overwrites } })
})
