import { request } from './http-client.js';

export const api = {
  providers: () => request('/api/providers'),
  session: () => request('/api/auth/session'),
  login: (family, email, authorizationCode) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ family, email, authorizationCode }),
    }),
  removeAccount: (accountId) => request(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
  logoutAll: () => request('/api/auth/logout', { method: 'POST' }),
  mailboxes: (accountId) => request('/api/mailboxes', {}, accountId),
  messages: (accountId, { mailbox, page = 1, pageSize = 40, query = '', groupId = '' }) => {
    const params = new URLSearchParams({ mailbox, page, pageSize });
    if (query) params.set('query', query);
    if (groupId) params.set('groupId', groupId);
    return request(`/api/messages?${params}`, {}, accountId);
  },
  mailboxSnapshot: (accountId, mailbox, limit = 20) => {
    const params = new URLSearchParams({ mailbox, limit });
    return request(`/api/messages/snapshot?${params}`, {}, accountId);
  },
  mailEventsUrl: (accountId) => {
    const params = new URLSearchParams({ accountId });
    return `/api/mail-events?${params}`;
  },
  aggregationRules: (accountId) => request('/api/aggregation-rules', {}, accountId),
  createAggregationRule: (accountId, rule) => request('/api/aggregation-rules', {
    method: 'POST',
    body: JSON.stringify(rule),
  }, accountId),
  deleteAggregationRule: (accountId, ruleId) => request(
    `/api/aggregation-rules/${encodeURIComponent(ruleId)}`,
    { method: 'DELETE' },
    accountId,
  ),
  message: (accountId, mailbox, uid) => {
    const params = new URLSearchParams({ mailbox });
    return request(`/api/messages/${uid}?${params}`, {}, accountId);
  },
  updateFlags: (accountId, mailbox, uids, changes) =>
    request('/api/messages/flags', {
      method: 'PATCH',
      body: JSON.stringify({ mailbox, uids, ...changes }),
    }, accountId),
  move: (accountId, mailbox, uids, destination) =>
    request('/api/messages/move', {
      method: 'POST',
      body: JSON.stringify({ mailbox, uids, destination }),
    }, accountId),
  attachmentUrl: (accountId, mailbox, uid, attachmentId) => {
    const params = new URLSearchParams({ mailbox, accountId });
    return `/api/messages/${uid}/attachments/${attachmentId}?${params}`;
  },
};
