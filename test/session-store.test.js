import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAccount,
  createSession,
  deleteSession,
  getAccount,
  getSession,
  listAccounts,
  removeAccount,
} from '../server/session-store.js';

test('keeps multiple mailbox accounts isolated in one browser session', () => {
  const sessionId = createSession();
  const session = getSession(sessionId);
  assert.equal('expiresAt' in session, false);
  const netease = { email: 'one@163.com', provider: '网易 163 邮箱', family: 'netease', authorizationCode: 'secret-one' };
  const qq = { email: 'two@qq.com', provider: 'QQ 邮箱', family: 'qq', authorizationCode: 'secret-two' };

  const neteaseId = addAccount(session, netease);
  const qqId = addAccount(session, qq);

  assert.notEqual(neteaseId, qqId);
  assert.equal(getAccount(session, neteaseId), netease);
  assert.equal(getAccount(session, qqId), qq);
  assert.deepEqual(listAccounts(session), [
    { id: neteaseId, email: 'one@163.com', provider: '网易 163 邮箱', family: 'netease' },
    { id: qqId, email: 'two@qq.com', provider: 'QQ 邮箱', family: 'qq' },
  ]);
  assert.equal('authorizationCode' in listAccounts(session)[0], false);

  assert.equal(removeAccount(session, neteaseId), true);
  assert.equal(getAccount(session, neteaseId), null);
  assert.equal(getAccount(session, qqId), qq);
  deleteSession(sessionId);
});

test('logging in the same address replaces credentials without duplicating the tab account', () => {
  const sessionId = createSession();
  const session = getSession(sessionId);
  const firstId = addAccount(session, { email: 'same@126.com', family: 'netease', authorizationCode: 'old' });
  const secondId = addAccount(session, { email: 'same@126.com', family: 'netease', authorizationCode: 'new' });

  assert.equal(firstId, secondId);
  assert.equal(session.accounts.size, 1);
  assert.equal(getAccount(session, firstId).authorizationCode, 'new');
  deleteSession(sessionId);
});
