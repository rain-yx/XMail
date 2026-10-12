import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareMessagesNewestFirst,
  messageTimestamp,
} from '../server/message-order.js';

test('sorts messages by date from newest to oldest across years', () => {
  const messages = [
    { uid: 4, date: '2001-03-10T08:00:00.000Z' },
    { uid: 2, date: '2024-05-01T08:00:00.000Z' },
    { uid: 1, date: '2026-10-12T08:00:00.000Z' },
    { uid: 3, date: '2012-08-20T08:00:00.000Z' },
  ];

  messages.sort(compareMessagesNewestFirst);

  assert.deepEqual(messages.map((message) => message.date.slice(0, 4)), ['2026', '2024', '2012', '2001']);
});

test('uses envelope date, then internal date, and UID as a stable tie-breaker', () => {
  const date = '2025-01-01T00:00:00.000Z';
  const messages = [
    { uid: 8, date: 'invalid', internalDate: new Date('2023-01-01T00:00:00.000Z') },
    { uid: 10, envelope: { date: new Date(date) } },
    { uid: 11, envelope: { date: new Date(date) } },
  ];

  messages.sort(compareMessagesNewestFirst);

  assert.deepEqual(messages.map((message) => message.uid), [11, 10, 8]);
  assert.equal(messageTimestamp(messages[2]), Date.parse('2023-01-01T00:00:00.000Z'));
});
