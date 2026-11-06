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

module.exports = {HourCounter};
