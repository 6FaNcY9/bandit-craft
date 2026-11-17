'use strict';
// World model, main-thread side: starts the worker thread (worldmodel-worker.js) and relays requests and
// buffers to it. It never decodes a section or opens SQLite, and nothing here throws: a worker that fails or
// does not answer turns into 503 answers and a restart.
const path = require('node:path');

const unavailable = () => ({status: 503, type: 'application/json', body: Buffer.from('{"error":"world model unavailable"}')});

function startWorldModel({dir, url, token, area, log = () => {}, Worker = require('node:worker_threads').Worker, restartMs = 5000, timeoutMs = 35000}) {
  const pending = new Map(); // request id -> {resolve, timer}
  let worker = null, restart = null, stopped = false, nextId = 1, seq = 0;

  function settle(id, res) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(res);
  }
  const failAll = () => { for (const id of [...pending.keys()]) settle(id, unavailable()); };
  const later = () => { restart = setTimeout(start, restartMs); };

  function start() {
    let w;
    try {
      // node:sqlite prints an ExperimentalWarning on node 22; the thread would repeat it in the hub log
      w = new Worker(path.join(__dirname, 'worldmodel-worker.js'), {workerData: {dir, url, token, area}, execArgv: ['--disable-warning=ExperimentalWarning']});
    } catch (e) {
      log(`world model: worker did not start: ${e.message}`);
      later();
      return;
    }
    worker = w;
    w.on('message', (m) => {
      try {
        if (m.t === 'seq') seq = m.seq;
        else if (m.t === 'log') log(m.msg);
        else if (m.t === 'stopped') w.terminate();
        else settle(m.id, {status: m.status, type: m.type, body: Buffer.from(m.body), ...(m.gzip && {gzip: true})});
      } catch (e) { log(`world model: bad worker message: ${e.message}`); }
    });
    w.on('error', (e) => log(`world model: worker error: ${e && e.message}`));
    w.on('exit', (code) => {
      if (worker === w) worker = null;
      failAll();
      if (stopped) return;
      log(`world model: worker exited (${code}), restarting in ${restartMs / 1000} s`);
      later();
    });
  }
  start();

  return {
    request: (op, args) => new Promise((resolve) => {
      if (!worker) return resolve(unavailable());
      const id = nextId++;
      pending.set(id, {resolve, timer: setTimeout(() => settle(id, unavailable()), timeoutMs)});
      try { worker.postMessage({id, op, args}); } catch (e) { log(`world model: request failed: ${e.message}`); settle(id, unavailable()); }
    }),
    // A box the hub changed itself (RCON fill or setblock); lost when the worker is down, the plugin's sweep catches up.
    dirty(box) { try { worker?.postMessage({t: 'dirty', box}); } catch (e) { log(`world model: dirty failed: ${e.message}`); } },
    seq: () => seq,
    async stop() {
      stopped = true;
      clearTimeout(restart);
      failAll();
      const w = worker;
      if (!w) return;
      worker = null;
      await new Promise((resolve) => {
        const hard = setTimeout(() => w.terminate(), 5000); // the worker closes its store and says `stopped`; this is the net
        w.once('exit', () => { clearTimeout(hard); resolve(); });
        try { w.postMessage({t: 'stop'}); } catch { w.terminate(); }
      });
    },
  };
}

module.exports = {startWorldModel};
