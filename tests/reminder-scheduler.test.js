'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextDueAt } = require('../src/main/reminder-scheduler');

test('每日提醒会顺延一天', () => {
  const now = new Date('2026-07-27T08:00:00+08:00').getTime();
  assert.equal(nextDueAt({ repeat: 'daily' }, now), now + 24 * 60 * 60 * 1000);
});

test('工作日提醒会跳过周末', () => {
  const friday = new Date('2026-07-31T08:00:00+08:00').getTime();
  const next = new Date(nextDueAt({ repeat: 'weekdays' }, friday));
  assert.equal(next.getDay(), 1);
});

test('每周与每月提醒保持周期', () => {
  const now = new Date('2026-07-27T08:00:00+08:00').getTime();
  assert.equal(nextDueAt({ repeat: 'weekly' }, now), now + 7 * 24 * 60 * 60 * 1000);
  const monthly = new Date(nextDueAt({ repeat: 'monthly' }, now));
  assert.equal(monthly.getMonth(), 7);
  assert.equal(monthly.getDate(), 27);
});
