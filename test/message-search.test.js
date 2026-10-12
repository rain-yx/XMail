import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesMessageSummary } from '../src/message-search.js';
import { matchesSearchText, tokenizeSearchQuery } from '../shared/search-query.js';

const message = {
  subject: 'Quarterly Report',
  from: [{ name: 'Alice Zhang', address: 'alice@example.com' }],
  to: [{ name: 'Bob Li', address: 'bob@example.com' }],
};

test('locally matches visible message sender, recipient, and subject', () => {
  assert.equal(matchesMessageSummary(message, 'alice'), true);
  assert.equal(matchesMessageSummary(message, 'BOB@EXAMPLE.COM'), true);
  assert.equal(matchesMessageSummary(message, 'quarterly report'), true);
  assert.equal(matchesMessageSummary(message, 'alice quarterly'), true);
  assert.equal(matchesMessageSummary(message, 'alice missing'), false);
  assert.equal(matchesMessageSummary(message, 'missing'), false);
});

test('splits URL-decoded multi-keyword searches on whitespace', () => {
  assert.deepEqual(tokenizeSearchQuery('  eam   交易  '), ['eam', '交易']);
  assert.deepEqual(tokenizeSearchQuery('交易 交易'), ['交易']);
  assert.equal(matchesSearchText('Team monthly 交易报告', 'eam 交易'), true);
  assert.equal(matchesSearchText('Team monthly report', 'eam 交易'), false);
});
