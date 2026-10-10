import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, SUPPORTED_DOMAINS } from '../server/providers.js';

test('detects NetEase addresses and normalizes email', () => {
  const provider = getProvider('  Demo@163.COM ');
  assert.equal(provider.email, 'demo@163.com');
  assert.equal(provider.family, 'netease');
  assert.equal(provider.host, 'imap.163.com');
  assert.equal(provider.port, 993);
  assert.equal(provider.secure, true);
});

test('only exposes NetEase and QQ domains', () => {
  assert.deepEqual(
    SUPPORTED_DOMAINS,
    ['163.com', '126.com', 'yeah.net', 'vip.163.com', 'vip.126.com', '188.com', 'qq.com', 'foxmail.com'],
  );
});

test('maps QQ and Foxmail to the QQ account family and trusted host', () => {
  assert.equal(getProvider('hello@qq.com').family, 'qq');
  assert.equal(getProvider('hello@foxmail.com').family, 'qq');
  assert.equal(getProvider('hello@qq.com').host, 'imap.qq.com');
  assert.equal(getProvider('hello@foxmail.com').host, 'imap.qq.com');
});

test('rejects unsupported domains and malformed values', () => {
  assert.equal(getProvider('demo@example.com'), null);
  assert.equal(getProvider('not-an-email'), null);
  assert.equal(getProvider('two@@163.com'), null);
  assert.equal(getProvider(''), null);
});
