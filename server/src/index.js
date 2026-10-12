import 'dotenv/config';

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import {
  createAggregationRule,
  getAggregationRules,
  removeAggregationRule,
} from './aggregation-rules.js';
import {
  ApiError,
  downloadAttachment,
  getMessage,
  listMailboxes,
  listMessages,
  moveMessages,
  updateMessageFlags,
  verifyAccount,
} from './imap-service.js';
import { getProvider, getPublicProviders } from './providers.js';
import {
  addAccount,
  createSession,
  deleteSession,
  getAccount,
  getSession,
  listAccounts,
  persistSessions,
  removeAccount,
} from './session-store.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const sessionCookie = 'xmail_session';
const persistentCookieAge = 10 * 365 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000).unref();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'xmail', time: new Date().toISOString() });
});

app.get('/api/providers', (_req, res) => {
  res.json({ providers: getPublicProviders() });
});

app.post('/api/auth/login', loginRateLimit, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const authorizationCode = String(req.body?.authorizationCode || '').trim();
  const expectedFamily = String(req.body?.family || '').trim().toLowerCase();
  const provider = getProvider(email);

  if (!provider || (expectedFamily && provider.family !== expectedFamily)) {
    throw new ApiError(400, '该标签只支持对应的网易或 QQ 邮箱地址。', 'UNSUPPORTED_PROVIDER');
  }
  if (authorizationCode.length < 6 || authorizationCode.length > 128) {
    throw new ApiError(400, '请输入有效的客户端授权码。', 'INVALID_AUTHORIZATION_CODE');
  }

  const account = {
    email: provider.email,
    authUser: provider.authUser,
    authorizationCode,
    host: provider.host,
    port: provider.port,
    provider: provider.label,
    family: provider.family,
  };
  const mailbox = await verifyAccount(account);

  let sessionId = req.cookies?.[sessionCookie];
  let session = getSession(sessionId);
  if (!session) {
    sessionId = createSession();
    session = getSession(sessionId);
  }
  const accountId = addAccount(session, account);

  loginAttempts.delete(req.ip);
  res.cookie(sessionCookie, sessionId, cookieOptions(req));
  res.json({ account: publicAccount(accountId, account), mailbox });
}));

app.get('/api/auth/session', requireSession, (req, res) => {
  res.json({ accounts: listAccounts(req.session) });
});

app.delete('/api/accounts/:accountId', requireSession, (req, res, next) => {
  if (!removeAccount(req.session, req.params.accountId)) {
    return next(new ApiError(404, '邮箱账号不存在或已退出。', 'ACCOUNT_NOT_FOUND'));
  }
  res.status(204).end();
});

app.post('/api/auth/logout', (req, res) => {
  deleteSession(req.cookies?.[sessionCookie]);
  res.clearCookie(sessionCookie, { path: '/' });
  res.status(204).end();
});

app.get('/api/mailboxes', requireSession, requireAccount, asyncHandler(async (req, res) => {
  const mailboxes = await listMailboxes(req.account);
  res.json({ mailboxes });
}));

app.get('/api/aggregation-rules', requireSession, requireAccount, (req, res) => {
  res.json({ rules: getAggregationRules(req.account) });
});

app.post('/api/aggregation-rules', requireSession, requireAccount, (req, res, next) => {
  const type = String(req.body?.type || '').trim().toLowerCase();
  const value = String(req.body?.value || '').trim();
  if (!['sender', 'subject'].includes(type) || !value || value.length > 998) {
    return next(new ApiError(400, '聚合条件无效。', 'INVALID_AGGREGATION_RULE'));
  }

  const result = createAggregationRule(req.account, {
    type,
    value,
    label: req.body?.label,
    mailbox: req.body?.mailbox,
    uid: req.body?.uid,
  });
  if (!result) return next(new ApiError(400, '聚合条件无效。', 'INVALID_AGGREGATION_RULE'));
  persistSessions();
  res.status(result.created ? 201 : 200).json(result);
});

app.delete('/api/aggregation-rules/:ruleId', requireSession, requireAccount, (req, res, next) => {
  if (!removeAggregationRule(req.account, req.params.ruleId)) {
    return next(new ApiError(404, '聚合规则不存在。', 'AGGREGATION_RULE_NOT_FOUND'));
  }
  persistSessions();
  res.status(204).end();
});

app.get('/api/messages', requireSession, requireAccount, asyncHandler(async (req, res) => {
  const result = await listMessages(req.account, req.query);
  res.json(result);
}));

app.get('/api/messages/:uid', requireSession, requireAccount, asyncHandler(async (req, res) => {
  const message = await getMessage(
    req.account,
    req.query.mailbox,
    req.params.uid,
    req.query.markSeen !== 'false',
  );
  res.json({ message });
}));

app.get('/api/messages/:uid/attachments/:attachmentId', requireSession, requireAccount, asyncHandler(async (req, res) => {
  const attachment = await downloadAttachment(
    req.account,
    req.query.mailbox,
    req.params.uid,
    req.params.attachmentId,
  );
  res.setHeader('Content-Type', attachment.contentType);
  res.setHeader('Content-Disposition', contentDisposition(attachment.filename, attachment.inline));
  res.setHeader('Content-Length', attachment.content.length);
  res.send(attachment.content);
}));

app.patch('/api/messages/flags', requireSession, requireAccount, asyncHandler(async (req, res) => {
  const result = await updateMessageFlags(
    req.account,
    req.body?.mailbox,
    req.body?.uids,
    { seen: req.body?.seen, flagged: req.body?.flagged },
  );
  res.json(result);
}));

app.post('/api/messages/move', requireSession, requireAccount, asyncHandler(async (req, res) => {
  const result = await moveMessages(
    req.account,
    req.body?.mailbox,
    req.body?.uids,
    req.body?.destination,
  );
  res.json(result);
}));

app.use((req, _res, next) => {
  next(new ApiError(404, `接口不存在：${req.method} ${req.path}`, 'NOT_FOUND'));
});

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    error = new ApiError(400, '请求内容不是有效的 JSON。', 'INVALID_JSON');
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status >= 500 && !(error instanceof ApiError) && !error.expose
        ? '服务器发生未知错误。'
        : error.message,
    },
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`XMail server is running at http://localhost:${port}`);
});

function requireSession(req, res, next) {
  const sessionId = req.cookies?.[sessionCookie];
  const session = getSession(sessionId);
  if (!session) return next(new ApiError(401, '登录状态已失效，请重新登录。', 'SESSION_EXPIRED'));
  req.session = session;
  res.cookie(sessionCookie, sessionId, cookieOptions(req));
  next();
}

function requireAccount(req, _res, next) {
  const accountId = String(req.get('x-xmail-account-id') || req.query.accountId || '').trim();
  const account = getAccount(req.session, accountId);
  if (!account) return next(new ApiError(401, '邮箱账号未登录或登录已失效。', 'ACCOUNT_REQUIRED'));
  req.account = account;
  req.accountId = accountId;
  next();
}

function loginRateLimit(req, _res, next) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const current = loginAttempts.get(req.ip);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(req.ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  current.count += 1;
  if (current.count > 10) {
    return next(new ApiError(429, '登录尝试过于频繁，请十分钟后再试。', 'TOO_MANY_ATTEMPTS'));
  }
  next();
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production' || req.secure,
    path: '/',
    maxAge: persistentCookieAge,
  };
}

function publicAccount(id, account) {
  return { id, email: account.email, provider: account.provider, family: account.family };
}

function contentDisposition(filename, inline = false) {
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
