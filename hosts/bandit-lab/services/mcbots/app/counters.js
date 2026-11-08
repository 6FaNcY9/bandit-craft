'use strict';
// Events in the last hour, for the movement counters on the bot screen.
const HOUR_MS = 3600000;

class HourCounter {
  constructor(now = Date.now) {
    this.now = now;
    this.times = [];
  }

  add() {
    this.times.push(this.now());
  }

  count() {
    const t = this.now();
    while (this.times.length && t - this.times[0] > HOUR_MS) this.times.shift();
    return this.times.length;
  }
}

// Count unhandled rejections; report() hears about them at most once per 10 minutes (with the count since the last notice).
function rejectionReporter(report, now = Date.now) {
  let last = -Infinity, unreported = 0;
  return () => {
    unreported++;
    if (now() - last < 600000) return;
    last = now();
    report(`unhandled rejection (${unreported} since the last notice, see the log)`);
    unreported = 0;
  };
}

module.exports = {HourCounter, rejectionReporter};
