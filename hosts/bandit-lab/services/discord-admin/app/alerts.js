// Lab alerts: read the ntfy topic as a JSON stream and turn each message into a Discord post.

const { setTimeout: sleep } = require('node:timers/promises')

function toDiscord (event) {
  if (event.event !== 'message') return null
  const head = (event.title ? `**${event.title}** ` : '') + (event.priority >= 4 ? '⚠️ ' : '')
  // Alerts quote unit output and bot chat: never let them ping anyone.
  return { content: (head + (event.message || '')).slice(0, 2000), allowed_mentions: { parse: [] } }
}

function readCredentials (text) {
  const field = name => (text.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1]
  return { user: field('Username'), password: field('Password') }
}

// Runs until `signal` aborts. After a drop it asks ntfy for everything since the last id it saw.
async function subscribe ({ url, auth, onMessage, log = console.log, retryMs = 5000, signal }) {
  const headers = { authorization: 'Basic ' + Buffer.from(`${auth.user}:${auth.password}`).toString('base64') }
  let since = null
  while (!signal?.aborted) {
    try {
      const res = await fetch(`${url}/json${since ? `?since=${encodeURIComponent(since)}` : ''}`, { headers, signal })
      if (!res.ok) throw new Error(`ntfy ${res.status}`)
      let buf = ''
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const event = JSON.parse(line)
          if (event.event === 'message') {
            since = event.id
            await onMessage(event)
          }
        }
      }
      log('ntfy stream ended, reconnecting')
    } catch (err) {
      if (signal?.aborted) break
      log(`ntfy: ${err.message}, reconnecting`)
    }
    await sleep(retryMs, null, { signal }).catch(() => {})
  }
}

module.exports = { toDiscord, readCredentials, subscribe }
