// Public world status: a server-list ping through the public address (there is no RCON on that world),
// and the one message per channel the bot keeps up to date.

const net = require('node:net')
const dns = require('node:dns/promises')

function varint (n) {
  const out = []
  do {
    let b = n & 0x7f
    n >>>= 7
    if (n) b |= 0x80
    out.push(b)
  } while (n)
  return Buffer.from(out)
}

// Returns [value, bytes read] or null while the number is still incomplete.
function readVarint (buf, at) {
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (at + i >= buf.length) return null
    value |= (buf[at + i] & 0x7f) << (7 * i)
    if (!(buf[at + i] & 0x80)) return [value, i + 1]
  }
  throw new Error('bad varint')
}

const packet = (...parts) => {
  const body = Buffer.concat(parts)
  return Buffer.concat([varint(body.length), body])
}

function ping (host, port, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port })
    let buf = Buffer.alloc(0)
    const fail = err => { sock.destroy(); reject(err) }
    sock.setTimeout(timeoutMs, () => fail(new Error('ping timed out')))
    sock.on('error', fail)
    sock.on('close', () => reject(new Error('closed before an answer')))
    sock.on('connect', () => {
      const name = Buffer.from(host)
      const portBytes = Buffer.alloc(2)
      portBytes.writeUInt16BE(port)
      // Handshake (protocol 47, as mcstatus sends), next state 1 = status; then the status request.
      sock.write(packet(Buffer.from([0x00]), varint(47), varint(name.length), name, portBytes, varint(1)))
      sock.write(packet(Buffer.from([0x00])))
    })
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      try {
        const len = readVarint(buf, 0)
        if (!len || buf.length < len[1] + len[0]) return
        const id = readVarint(buf, len[1])
        const text = readVarint(buf, len[1] + id[1])
        const start = len[1] + id[1] + text[1]
        const json = JSON.parse(buf.subarray(start, start + text[0]).toString())
        sock.destroy()
        // Counts only: the player sample (names) is never passed on.
        resolve({ online: true, players: json.players?.online ?? 0, max: json.players?.max ?? 0, version: json.version?.name ?? '' })
      } catch (err) {
        fail(err)
      }
    })
  })
}

// "host", "host:port", or a host with a _minecraft._tcp SRV record (playit hands out those).
async function resolveAddress (address) {
  const [host, port] = address.split(':')
  if (port) return { host, port: Number(port) }
  // Only "no such record" means the default port; a resolver hiccup is a failed try, not port 25565.
  const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`).catch(err => {
    if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') return []
    throw err
  })
  return srv[0] ? { host: srv[0].name, port: srv[0].port } : { host, port: 25565 }
}

// One lost ping through the tunnel must not show "offline": that takes two in a row.
function tracker () {
  let state = null
  let fails = 0
  return result => {
    if (result) {
      fails = 0
      state = result
    } else if (++fails >= 2 || !state) {
      state = { online: false }
    }
    return state
  }
}

// set(content) keeps the bot's one message in a channel at `content`; it writes only on a change.
function keeper (api, channelId, botId) {
  let id = null
  let last = null
  return async function set (content) {
    if (id === null) {
      // shortcut: looks at the newest 100 messages only; pin the message once a channel outgrows that.
      const mine = (await api('GET', `/channels/${channelId}/messages?limit=100`)).find(m => m.author.id === botId)
      id = mine ? mine.id : undefined
      last = mine ? mine.content : null
    }
    if (content === last) return
    const body = { content, allowed_mentions: { parse: [] } }
    if (id) await api('PATCH', `/channels/${channelId}/messages/${id}`, body)
    else id = (await api('POST', `/channels/${channelId}/messages`, body)).id
    last = content
  }
}

module.exports = { ping, resolveAddress, tracker, keeper }
