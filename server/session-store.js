import crypto from 'node:crypto';

const sessions = new Map();
const DEFAULT_TTL = 24 * 60 * 60 * 1000;

function ttl() {
  const configured = Number(process.env.SESSION_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL;
}

export function createSession() {
  const id = crypto.randomBytes(32).toString('base64url');
  sessions.set(id, {
    accounts: new Map(),
    expiresAt: Date.now() + ttl(),
  });
  return id;
}

export function getSession(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }

  session.expiresAt = Date.now() + ttl();
  return session;
}

export function addAccount(session, account) {
  const existing = [...session.accounts.entries()].find(([, item]) => item.email === account.email);
  const accountId = existing?.[0] || crypto.randomUUID();
  session.accounts.set(accountId, account);
  return accountId;
}

export function getAccount(session, accountId) {
  if (!session || !accountId) return null;
  return session.accounts.get(accountId) || null;
}

export function removeAccount(session, accountId) {
  return Boolean(session?.accounts.delete(accountId));
}

export function listAccounts(session) {
  if (!session) return [];
  return [...session.accounts.entries()].map(([id, account]) => ({
    id,
    email: account.email,
    provider: account.provider,
    family: account.family,
  }));
}

export function deleteSession(id) {
  if (id) sessions.delete(id);
}

export function clearExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

export function sessionCount() {
  return sessions.size;
}

setInterval(clearExpiredSessions, 15 * 60 * 1000).unref();
