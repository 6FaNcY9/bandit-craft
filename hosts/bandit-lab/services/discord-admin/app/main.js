// bandit-admin: keeps the public guild's layout and mirrors lab alerts from ntfy into #lab-alerts.
// Discord REST only (no gateway until slash commands arrive in phase 4).

const fs = require('node:fs')
const { setTimeout: sleep } = require('node:timers/promises')
const { LAYOUT, overwrites, diffChannel } = require('./layout')
const { toDiscord, readCredentials, subscribe } = require('./alerts')

function makeApi (token, fetchImpl = fetch, base = 'https://discord.com/api/v10') {
  return async function api (method, path, body) {
    for (;;) {
      const res = await fetchImpl(base + path, {
        method,
        headers: {
          authorization: `Bot ${token}`,
          'user-agent': 'DiscordBot (https://github.com/6FaNcY9/bandit-craft, 1)',
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
      if (res.status === 429) {
        const { retry_after: wait = 1 } = await res.json().catch(() => ({}))
        await sleep(Math.ceil(wait * 1000))
        continue
      }
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
      return res.status === 204 ? null : res.json()
    }
  }
}

// Creates what is missing, puts back parent and overwrites of declared channels, never deletes.
// Returns the id of #lab-alerts and how many writes it sent.
async function applyLayout (api, guildId) {
  let writes = 0
  const write = (...args) => { writes++; return api(...args) }
  const me = await api('GET', '/users/@me')

  const roles = await api('GET', `/guilds/${guildId}/roles`)
  const roleId = {}
  for (const name of LAYOUT.roles) {
    const have = roles.find(r => r.name === name)
    roleId[name] = (have || await write('POST', `/guilds/${guildId}/roles`, { name, permissions: '0' })).id
  }
  const ids = { guild: guildId, owner: roleId.Owner, moderator: roleId.Moderator, bot: me.id }

  const channels = await api('GET', `/guilds/${guildId}/channels`)
  const ensure = async want => {
    const have = channels.find(c => c.type === want.type && c.name === want.name)
    const d = diffChannel(want, have)
    if (!d) return have.id
    if (d.create) {
      const made = await write('POST', `/guilds/${guildId}/channels`, d.create)
      // A name Discord rewrote would be created again on every start: stop for good (exit 2, no restart).
      if (made.name !== want.name) throw Object.assign(new Error(`Discord stored "${want.name}" as "${made.name}": fix LAYOUT`), { exitCode: 2 })
      return made.id
    }
    await write('PATCH', `/channels/${have.id}`, d.patch)
    return have.id
  }
  const channelId = {}
  for (const cat of LAYOUT.categories) {
    const permission_overwrites = overwrites(cat.access, ids)
    const parent_id = await ensure({ name: cat.name, type: 4, parent_id: null, permission_overwrites })
    for (const name of cat.channels) channelId[name] = await ensure({ name, type: 0, parent_id, permission_overwrites })
  }

  const guild = await api('GET', `/guilds/${guildId}`)
  const settings = {
    verification_level: 3,
    explicit_content_filter: 2,
    rules_channel_id: channelId['regeln-rules'],
    public_updates_channel_id: channelId['mod-log']
  }
  const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => guild[k] !== v))
  if (Object.keys(changed).length) await write('PATCH', `/guilds/${guildId}`, changed)

  // Discord allows one rule per trigger type for these three, and may already have made a default one.
  const rules = await api('GET', `/guilds/${guildId}/auto-moderation/rules`)
  const actions = [{ type: 1 }, { type: 2, metadata: { channel_id: channelId['mod-log'] } }]
  const want = [
    { name: 'Bandit: Wortlisten', trigger_type: 4, trigger_metadata: { presets: [1, 2, 3] } },
    { name: 'Bandit: Spam', trigger_type: 3, trigger_metadata: {} },
    { name: 'Bandit: Mentions', trigger_type: 5, trigger_metadata: { mention_total_limit: 5 } }
  ]
  for (const rule of want) {
    if (rules.some(r => r.trigger_type === rule.trigger_type)) continue
    await write('POST', `/guilds/${guildId}/auto-moderation/rules`, { ...rule, event_type: 1, actions, enabled: true })
  }

  return { alertsChannel: channelId['lab-alerts'], writes }
}

async function main () {
  const creds = process.env.CREDENTIALS_DIRECTORY
  const api = makeApi(fs.readFileSync(`${creds}/token`, 'utf8').trim())
  const { alertsChannel, writes } = await applyLayout(api, process.env.GUILD_ID)
  console.log(`layout applied, ${writes} writes`)
  await subscribe({
    url: process.env.NTFY_URL,
    auth: readCredentials(fs.readFileSync(`${creds}/ntfy`, 'utf8')),
    onMessage: async event => {
      const msg = toDiscord(event)
      // ntfy stays the primary path: a failed mirror is logged, not retried.
      if (msg) await api('POST', `/channels/${alertsChannel}/messages`, msg).catch(err => console.error(err.message))
    }
  })
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message)
    process.exit(err.exitCode || 1)
  })
}

module.exports = { makeApi, applyLayout }
