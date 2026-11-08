'use strict';
const assert = require('node:assert/strict');
const {HourCounter} = require('../counters');

let t = 1e9;
const c = new HourCounter(() => t);
c.add(); t += 1800000; c.add();
assert.equal(c.count(), 2);
t += 1800001; // the first is now just over an hour old
assert.equal(c.count(), 1);
t += 3600001;
assert.equal(c.count(), 0);
console.log('counters ok');

{ // unhandled rejections are counted; one notice per 10 minutes carries the count
  const {rejectionReporter} = require('../counters');
  let t = 0; const seen = [];
  const rej = rejectionReporter((text) => seen.push(text), () => t);
  rej(); rej(); rej();
  assert.equal(seen.length, 1);
  assert.match(seen[0], /unhandled rejection/);
  t = 599999; rej(); assert.equal(seen.length, 1);
  t = 600000; rej(); assert.equal(seen.length, 2);
  assert.match(seen[1], /4 since/);
}
