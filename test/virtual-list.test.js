import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMailDate, getVisibleRange } from '../src/virtual-list.js';

test('virtual range only keeps viewport rows and a small buffer mounted', () => {
  const range = getVisibleRange({
    scrollTop: 54 * 5000,
    viewportHeight: 540,
    rowHeight: 54,
    total: 10_000,
    buffer: 5,
  });

  assert.deepEqual(range, { start: 4995, end: 5015 });
  assert.equal(range.end - range.start, 20);
});

test('virtual range stays inside collection boundaries', () => {
  assert.deepEqual(
    getVisibleRange({ scrollTop: 0, viewportHeight: 540, rowHeight: 54, total: 8, buffer: 5 }),
    { start: 0, end: 8 },
  );
  assert.deepEqual(
    getVisibleRange({ scrollTop: 999999, viewportHeight: 540, rowHeight: 54, total: 8, buffer: 5 }),
    { start: 0, end: 8 },
  );
});

test('mail list date is always formatted as YYYY-MM-DD', () => {
  assert.equal(formatMailDate(new Date(2026, 0, 2, 8, 30)), '2026-01-02');
  assert.equal(formatMailDate('not-a-date'), '0000-00-00');
});
