import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysInMonth, leadOffset, shiftMonth } from '../calendar.js';

test('daysInMonth: ordinary months', () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
});

test('daysInMonth: February, leap vs non-leap year', () => {
  assert.equal(daysInMonth(2024, 2), 29); // leap
  assert.equal(daysInMonth(2026, 2), 28); // not leap
});

test('leadOffset: day-of-week the 1st of the month falls on (0=Sun..6=Sat)', () => {
  // 2026-08-01 is a Saturday
  assert.equal(leadOffset(2026, 8), 6);
  // 2026-11-01 is a Sunday
  assert.equal(leadOffset(2026, 11), 0);
});

test('shiftMonth: steps forward and backward within a year', () => {
  assert.equal(shiftMonth('2026-08', 1), '2026-09');
  assert.equal(shiftMonth('2026-08', -1), '2026-07');
});

test('shiftMonth: crosses a year boundary in both directions', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
