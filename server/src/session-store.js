import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sessions = new Map();
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.XMAIL_DATA_DIR
  ? path.resolve(process.env.XMAIL_DATA_DIR)
  : path.resolve(moduleDirectory, '..', 'data');
const sessionFile = path.join(dataDirectory, 'sessions.enc');
const keyFile = path.join(dataDirectory, 'session.key');
const persistenceEnabled = !process.env.NODE_TEST_CONTEXT;

restoreSessions();

export function createSession() {
  const id = crypto.randomBytes(32).toString('base64url');
  sessions.set(id, {
    accounts: new Map(),
  });
  return id;
}

export function getSession(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  return session;
}

export function addAccount(session, account) {
  const existing = [...session.accounts.entries()].find(([, item]) => item.email === account.email);
  const accountId = existing?.[0] || crypto.randomUUID();
  account.aggregationRules = existing?.[1]?.aggregationRules || account.aggregationRules || [];
  session.accounts.set(accountId, account);
  persistSessions();
  return accountId;
}

export function getAccount(session, accountId) {
  if (!session || !accountId) return null;
  return session.accounts.get(accountId) || null;
}

export function removeAccount(session, accountId) {
  const removed = Boolean(session?.accounts.delete(accountId));
  if (removed) persistSessions();
  return removed;
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
  if (id && sessions.delete(id)) persistSessions();
}

export function sessionCount() {
  return sessions.size;
}

export function persistSessions() {
  if (!persistenceEnabled) return;
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    const key = getEncryptionKey(true);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const payload = JSON.stringify([...sessions.entries()].map(([id, session]) => ({
      id,
      accounts: [...session.accounts.entries()],
    })));
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const output = Buffer.concat([Buffer.from('XMAIL1'), iv, authTag, encrypted]);
    fs.writeFileSync(sessionFile, output, { mode: 0o600 });
  } catch (error) {
    console.error('Unable to persist XMail sessions:', error.message);
  }
}

function restoreSessions() {
  if (!persistenceEnabled || !fs.existsSync(sessionFile)) return;
  try {
    const input = fs.readFileSync(sessionFile);
    if (input.subarray(0, 6).toString() !== 'XMAIL1') throw new Error('invalid session file');
    const key = getEncryptionKey(false);
    if (!key) throw new Error('session encryption key is missing');
    const iv = input.subarray(6, 18);
    const authTag = input.subarray(18, 34);
    const encrypted = input.subarray(34);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const payload = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const storedSessions = JSON.parse(payload);
    if (!Array.isArray(storedSessions)) throw new Error('invalid session payload');
    for (const stored of storedSessions) {
      if (!stored?.id || !Array.isArray(stored.accounts)) continue;
      sessions.set(stored.id, { accounts: new Map(stored.accounts) });
    }
  } catch (error) {
    console.error('Unable to restore XMail sessions:', error.message);
  }
}

function getEncryptionKey(createIfMissing) {
  if (process.env.SESSION_SECRET) {
    return crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest();
  }
  if (fs.existsSync(keyFile)) {
    const key = fs.readFileSync(keyFile);
    if (key.length === 32) return key;
    throw new Error('session key has an invalid length');
  }
  if (!createIfMissing) return null;
  fs.mkdirSync(dataDirectory, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key, { mode: 0o600, flag: 'wx' });
  return key;
}
