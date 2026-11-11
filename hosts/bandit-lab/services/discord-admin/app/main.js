// bandit-admin: keeps the public guild's layout and its INFO texts (teaser, rules, address, server status)
// and mirrors lab alerts from ntfy into #lab-alerts. Discord REST, plus the gateway for the owner's /bots
// commands in #bot-kommando (control.js).

const fs = require('node:fs')
const { setTimeout: sleep } = require('node:timers/promises')
const { LAYOUT, overwrites, diffChannel } = require('./layout')
const { toDiscord, readCredentials, subscribe } = require('./alerts')
const { ping, resolveAddress, tracker, keeper } = require('./status')
const texts = require('./texts')
const control = require('./control')
const { connect } = require('./gateway')

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
// Returns the channel ids by name, the bot's user id and how many writes it sent.
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

  // Settings and AutoMod are extras: a refusal there is logged and must not stop the texts and alerts.
  // (The guild's rules and updates channels are set in the client: Discord answers the bot's PATCH for
  // them with 403 although it holds Manage Guild; first deploy, 2026-11-11.)
  const extra = step => step().catch(err => console.error(`skipped: ${err.message}`))
  await extra(async () => {
    const guild = await api('GET', `/guilds/${guildId}`)
    const settings = { verification_level: 3, explicit_content_filter: 2 }
    const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => guild[k] !== v))
    if (Object.keys(changed).length) await write('PATCH', `/guilds/${guildId}`, changed)
  })

  // Discord allows one rule per trigger type for these three, and may already have made a default one.
  await extra(async () => {
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
  })

  return { channels: channelId, botId: me.id, writes }
}

// Every 30 s: ping the public world and keep the four INFO texts current (they change with the status,
// and all at once when LAUNCH_AT passes).
async function infoLoop (api, channels, botId, { address, launchAt }) {
  const track = tracker()
  const set = {
    announcement: keeper(api, channels['ankündigungen'], botId),
    rules: keeper(api, channels['regeln-rules'], botId),
    join: keeper(api, channels['adresse-join'], botId),
    status: keeper(api, channels['server-status'], botId)
  }
  for (;;) {
    const result = await resolveAddress(address).then(a => ping(a.host, a.port)).catch(() => null)
    const now = Math.floor(Date.now() / 1000)
    for (const [name, text] of Object.entries(texts.all({ launchAt, now, state: track(result), address }))) {
      await set[name](text).catch(err => console.error(`${name}: ${err.message}`))
    }
    await sleep(30000)
  }
}

async function main () {
  const creds = process.env.CREDENTIALS_DIRECTORY
  const token = fs.readFileSync(`${creds}/token`, 'utf8').trim()
  const api = makeApi(token)
  const { channels, botId, writes } = await applyLayout(api, process.env.GUILD_ID)
  console.log(`layout applied, ${writes} writes`)
  const alertsChannel = channels['lab-alerts']
  // Bot control only where a hub is configured; a failure there leaves layout, texts and alerts running.
  if (process.env.HUB_URL) {
    const hub = control.makeHub(process.env.HUB_URL, fs.readFileSync(`${creds}/hub`, 'utf8').trim())
    control.start({ api, token, guildId: process.env.GUILD_ID, botId, channels, hub, connect }).catch(err => console.error(`bot control off: ${err.message}`))
  }
  // LAUNCH_AT: unix seconds of the public opening; unset means "soon" and no countdown.
  infoLoop(api, channels, botId, { address: process.env.MC_ADDRESS, launchAt: Number(process.env.LAUNCH_AT) || null })
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
