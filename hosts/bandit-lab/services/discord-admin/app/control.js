// Bot control from Discord (docs/specs/2026-11-11-discord-platform.md, phase 4): /bots status | stopp | weiter
// in #bot-kommando, against the hub's /api/remote/ door (mcbots app/remote.js), which offers nothing else.
// Three locks, each enough alone: Discord hides the command from everyone but administrators, the channel must
// be #bot-kommando (Owner role only), and the caller must be the guild's owner.

const BOT = { type: 3, name: 'bot', description: 'Name, z. B. bot2. Ohne Namen: alle' }
const COMMANDS = [{
  name: 'bots',
  description: 'Die Bots der privaten Welt',
  default_member_permissions: '0',
  options: [
    { type: 1, name: 'status', description: 'Was jeder Bot gerade tut' },
    { type: 1, name: 'stopp', description: 'Einen Bot stoppen oder alle', options: [BOT] },
    { type: 1, name: 'weiter', description: 'Pausierte Projekte fortsetzen', options: [BOT] }
  ]
}]

function makeHub (url, token, fetchImpl = fetch) {
  return async function hub (method, path, body) {
    const res = await fetchImpl(`${url}/api/remote/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2000) // Discord waits 3 s for the answer
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `hub ${res.status}`)
    return data
  }
}

const GERMAN = { 'unknown bot': 'Diesen Bot gibt es nicht.', 'bot must be a name': 'Das ist kein Bot-Name.', 'no paused project': 'Kein pausiertes Projekt.' }
const line = b => `${b.online ? '🟢' : '⚫'} **${b.name}**: ${!b.online ? 'offline' : (b.job || 'frei') + (b.queued ? ` (+${b.queued} wartend)` : '') + (b.paused ? `, Projekt ${b.paused} pausiert` : '')}`

// The message for one interaction, or null when it is not ours.
async function answer (i, { channelId, allowed, hub, log }) {
  if (i.type !== 2 || i.data?.name !== 'bots') return null
  const user = i.member?.user
  const sub = i.data.options?.[0]
  const bot = sub?.options?.find(o => o.name === 'bot')?.value
  if (i.channel_id !== channelId || !allowed.includes(user?.id)) {
    log(`refused /bots ${sub?.name} from ${user?.username} (${user?.id}) in channel ${i.channel_id}`)
    return { content: 'Nicht erlaubt.', flags: 64 }
  }
  try {
    if (sub.name === 'status') return { content: (await hub('GET', 'fleet')).bots.map(line).join('\n').slice(0, 2000) || 'Keine Bots.' }
    if (sub.name === 'stopp') {
      const { unreached } = await hub('POST', 'stop', { bot })
      return { content: (bot ? `Gestoppt: ${bot}.` : 'Alle gestoppt.') + (unreached?.length ? ` Nicht erreicht: ${unreached.join(', ')}.` : '') }
    }
    if (sub.name === 'weiter') return { content: `Weiter: ${(await hub('POST', 'resume', { bot })).resumed.join(', ')}.` }
    return { content: 'Unbekannter Befehl.' }
  } catch (err) {
    return { content: `Fehler: ${GERMAN[err.message] || err.message}` }
  }
}

// Registers the command for this guild only and answers it while the gateway is up.
async function start ({ api, token, guildId, botId, channels, hub, connect, log = console.error }) {
  const { owner_id: owner } = await api('GET', `/guilds/${guildId}`)
  await api('PUT', `/applications/${botId}/guilds/${guildId}/commands`, COMMANDS)
  const quiet = { allowed_mentions: { parse: [] } }
  // A refused command is somebody trying a door: the journal and #lab-alerts.
  const refused = text => {
    log(text)
    return api('POST', `/channels/${channels['lab-alerts']}/messages`, { content: `⚠️ ${text}`.slice(0, 2000), ...quiet }).catch(err => log(err.message))
  }
  connect({
    token,
    onInteraction: async i => {
      const pending = []
      const reply = await answer(i, { channelId: channels['bot-kommando'], allowed: [owner], hub, log: text => pending.push(refused(text)) })
      await Promise.all(pending)
      if (reply) await api('POST', `/interactions/${i.id}/${i.token}/callback`, { type: 4, data: { ...reply, ...quiet } }).catch(err => log(err.message))
    }
  })
}

module.exports = { COMMANDS, makeHub, answer, start }
