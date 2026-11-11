const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { toDiscord, readCredentials, subscribe } = require('./alerts')

test('only message events are posted', () => {
  assert.equal(toDiscord({ event: 'keepalive' }), null)
  assert.equal(toDiscord({ event: 'open' }), null)
})

test('title, warning mark and body; nobody is pinged', () => {
  const out = toDiscord({ event: 'message', title: 'Unit failed: x', priority: 4, message: '@everyone hi' })
  assert.deepEqual(out, { content: '**Unit failed: x** ⚠️ @everyone hi', allowed_mentions: { parse: [] } })
  assert.equal(toDiscord({ event: 'message', message: 'plain' }).content, 'plain')
})

test('long alerts are cut to Discord\'s limit', () => {
  assert.equal(toDiscord({ event: 'message', message: 'x'.repeat(5000) }).content.length, 2000)
})

test('reads the ntfy reader credentials file', () => {
  assert.deepEqual(readCredentials('Username: phone\nPassword: abc\n'), { user: 'phone', password: 'abc' })
})

test('reconnects after a drop and asks for what it missed', async () => {
  const seen = []
  const urls = []
  const ac = new AbortController()
  const server = http.createServer((req, res) => {
    urls.push(req.url)
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('phone:abc').toString('base64'))
    if (urls.length === 1) {
      res.end(JSON.stringify({ id: 'm1', event: 'message', message: 'one' }) + '\n')
    } else {
      ac.abort()
      res.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await subscribe({
    url: `http://127.0.0.1:${server.address().port}/mcbots`,
    auth: { user: 'phone', password: 'abc' },
    onMessage: e => seen.push(e.message),
    log: () => {},
    retryMs: 10,
    signal: ac.signal
  })
  server.close()
  assert.deepEqual(seen, ['one'])
  assert.deepEqual(urls, ['/mcbots/json', '/mcbots/json?since=m1'])
})
