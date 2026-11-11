// The guild layout the admin bot keeps (docs/specs/2026-11-11-discord-platform.md) and the pure diff
// against what Discord reports. The bot only creates and corrects; it never deletes.

const VIEW = 1024n
const SEND = 2048n
const EMBED = 16384n
const HISTORY = 65536n
const BOT = VIEW | SEND | EMBED | HISTORY

const LAYOUT = {
  roles: ['Owner', 'Moderator'],
  categories: [
    { name: 'INFO', access: 'readonly', channels: ['regeln-rules', 'ankündigungen', 'server-status', 'adresse-join'] },
    { name: 'COMMUNITY', access: 'open', channels: ['chat', 'screenshots', 'bauprojekte', 'hilfe'] },
    { name: 'INGAME', access: 'open', channels: ['ingame-chat'] },
    { name: 'MODERATION', access: 'mods', channels: ['meldungen', 'mod-log'] },
    { name: 'ADMIN', access: 'owner', channels: ['lab-alerts', 'bot-kommando'] }
  ]
}

const ow = (id, type, allow, deny) => ({ id, type, allow: String(allow), deny: String(deny) })
const byId = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)

function overwrites (access, ids) {
  // The bot needs its own allow wherever @everyone loses View or Send, or it locks itself out.
  const bot = ow(ids.bot, 1, BOT, 0)
  const list = {
    readonly: [ow(ids.guild, 0, 0, SEND), bot],
    open: [],
    mods: [ow(ids.guild, 0, 0, VIEW), ow(ids.owner, 0, VIEW, 0), ow(ids.moderator, 0, VIEW, 0), bot],
    owner: [ow(ids.guild, 0, 0, VIEW), ow(ids.owner, 0, VIEW, 0), bot]
  }[access]
  if (!list) throw new Error(`unknown access ${access}`)
  return list.sort(byId)
}

const norm = list => JSON.stringify((list || []).map(o => ow(o.id, o.type, o.allow, o.deny)).sort(byId))

function diffChannel (want, have) {
  if (!have) return { create: want }
  const patch = {}
  if ((have.parent_id || null) !== (want.parent_id || null)) patch.parent_id = want.parent_id
  if (norm(have.permission_overwrites) !== norm(want.permission_overwrites)) patch.permission_overwrites = want.permission_overwrites
  return Object.keys(patch).length ? { patch } : null
}

module.exports = { LAYOUT, overwrites, diffChannel }
