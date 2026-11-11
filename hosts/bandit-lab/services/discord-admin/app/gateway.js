// Discord's gateway, only to receive slash-command interactions (bot control, phase 4). No intents: Discord
// sends no member or message events, interactions arrive regardless. Node's own WebSocket, no dependency.
// shortcut: no session resume, a new identify after every drop; a command typed in the gap fails in the client
// ("did not respond") and is typed again. Upgrade when anything but interactions is read here.

function connect ({ token, onInteraction, WS = WebSocket, url = 'wss://gateway.discord.gg/?v=10&encoding=json', log = console.error, minGap = 90000 }) {
  let wait = 5000
  let identified = 0 // when the bot last logged in
  const open = () => {
    const ws = new WS(url)
    let seq = null
    let beat = null
    let acked = true
    let gone = false
    // Leaves this socket and opens the next. The wait doubles (up to 5 min) until a READY, and two logins are at
    // least minGap apart: Discord resets a token after 1000 identifies in a day, also when each of them got a READY.
    const drop = why => {
      if (gone) return
      gone = true
      clearInterval(beat)
      const pause = Math.max(wait, identified + minGap - Date.now())
      log(`gateway: ${why}, again in ${Math.round(pause / 1000)} s`)
      try { ws.close() } catch {}
      setTimeout(open, pause)
      wait = Math.min(wait * 2, 300000)
    }
    const send = payload => ws.send(JSON.stringify(payload))
    ws.onmessage = ({ data }) => {
      if (gone) return
      let frame
      try { frame = JSON.parse(data) } catch { return drop('unreadable frame') } // must not take texts and alerts down with it
      const { op, t, s, d } = frame
      if (s != null) seq = s
      if (op === 10 && !beat) {
        beat = setInterval(() => {
          if (!acked) return drop('no heartbeat answer')
          acked = false
          send({ op: 1, d: seq })
        }, d.heartbeat_interval)
        identified = Date.now()
        send({ op: 2, d: { token, intents: 0, properties: { os: 'linux', browser: 'bandit-admin', device: 'bandit-admin' } } })
      } else if (op === 11) acked = true
      else if (op === 1) send({ op: 1, d: seq })
      else if (op === 7 || op === 9) drop(`op ${op}`)
      else if (op === 0 && t === 'READY') wait = 5000
      else if (op === 0 && t === 'INTERACTION_CREATE') onInteraction(d)
    }
    ws.onclose = ({ code }) => drop(`closed (${code})`)
    ws.onerror = () => {} // the close event follows
  }
  open()
}

module.exports = { connect }
