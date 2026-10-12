export class ApiRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}, accountId = '') {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accountId ? { 'X-XMail-Account-Id': accountId } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      payload?.error?.message || '请求失败，请稍后重试。',
      response.status,
      payload?.error?.code || 'REQUEST_FAILED',
    );
  }
  return payload;
}

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
