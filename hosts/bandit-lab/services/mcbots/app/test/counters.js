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
