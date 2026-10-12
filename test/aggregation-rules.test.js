import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAggregatedMessageList,
  createAggregationRule,
  matchesAggregationRule,
  normalizeSubject,
  removeAggregationRule,
} from '../server/aggregation-rules.js';

function message(uid, subject, sender, date, seen = true) {
  return {
    uid,
    subject,
    from: [{ name: sender, address: sender }],
    to: [],
    date,
    seen,
    flagged: false,
  };
}

test('normalizes reply and forward prefixes before matching subjects', () => {
  assert.equal(normalizeSubject(' Re: 回复： FWD:  Steam   交易 '), 'steam 交易');
});

test('creates idempotent aggregation rules and supports removing them', () => {
  const account = {};
  const first = createAggregationRule(account, {
    type: 'sender',
    value: 'Notify@Example.com',
    label: '通知',
    mailbox: 'INBOX',
    uid: 8,
  });
  const duplicate = createAggregationRule(account, {
    type: 'sender',
    value: 'notify@example.com',
    label: '另一个名称',
    mailbox: 'INBOX',
    uid: 9,
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.rule.id, duplicate.rule.id);
  assert.deepEqual(first.rule.seeds, [
    { mailbox: 'INBOX', uid: 8 },
    { mailbox: 'INBOX', uid: 9 },
  ]);
  assert.equal(removeAggregationRule(account, first.rule.id), true);
  assert.equal(account.aggregationRules.length, 0);
});

test('builds a group with newest date, total count and unread count', () => {
  const account = {};
  const { rule } = createAggregationRule(account, {
    type: 'subject',
    value: 'Steam 交易',
    label: 'Steam 交易',
  });
  const messages = [
    message(3, 'Re: Steam 交易', 'a@example.com', '2026-03-01T00:00:00.000Z', false),
    message(2, 'Steam 交易', 'b@example.com', '2025-03-01T00:00:00.000Z'),
    message(1, '单独邮件', 'c@example.com', '2024-03-01T00:00:00.000Z'),
  ];

  assert.equal(matchesAggregationRule(messages[0], rule), true);
  const result = buildAggregatedMessageList(messages, account.aggregationRules);
  assert.equal(result.length, 2);
  assert.deepEqual(
    {
      kind: result[0].kind,
      count: result[0].count,
      unread: result[0].unread,
      date: result[0].date,
    },
    {
      kind: 'group',
      count: 2,
      unread: 1,
      date: '2026-03-01T00:00:00.000Z',
    },
  );
  assert.equal(result[1].kind, 'message');
});

test('keeps a one-message rule visible so it can be opened or cancelled', () => {
  const account = {};
  createAggregationRule(account, {
    type: 'sender',
    value: 'only@example.com',
    label: '唯一发件人',
  });
  const result = buildAggregatedMessageList([
    message(1, '只有一封', 'only@example.com', '2026-01-01T00:00:00.000Z'),
  ], account.aggregationRules);

  assert.equal(result[0].kind, 'group');
  assert.equal(result[0].count, 1);
});

test('keeps all aggregation groups above newer ungrouped messages', () => {
  const account = {};
  createAggregationRule(account, {
    type: 'sender',
    value: 'group@example.com',
    label: '聚合发件人',
  });
  const result = buildAggregatedMessageList([
    message(3, '最新的普通邮件', 'single@example.com', '2026-10-01T00:00:00.000Z'),
    message(2, '较早的聚合邮件', 'group@example.com', '2025-10-01T00:00:00.000Z'),
  ], account.aggregationRules);

  assert.equal(result[0].kind, 'group');
  assert.equal(result[1].kind, 'message');
});
