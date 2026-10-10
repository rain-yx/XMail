import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const FOLDER_LABELS = new Map([
  ['\\Inbox', '收件箱'],
  ['\\Sent', '已发送'],
  ['\\Drafts', '草稿箱'],
  ['\\Trash', '已删除'],
  ['\\Junk', '垃圾邮件'],
  ['\\Archive', '归档'],
  ['\\All', '全部邮件'],
  ['\\Flagged', '星标邮件'],
]);

export class ApiError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createImapClient(account) {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.authUser || account.email, pass: account.authorizationCode },
    logger: false,
    tls: {
      rejectUnauthorized: true,
      servername: account.host,
    },
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
  });
}

export async function withImap(account, operation) {
  const client = createImapClient(account);
  try {
    await client.connect();
    return await operation(client);
  } catch (error) {
    throw normalizeImapError(error, account);
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    } else {
      client.close();
    }
  }
}

export async function verifyAccount(account) {
  return withImap(account, async (client) => {
    const status = await client.status('INBOX', { messages: true, unseen: true });
    return {
      messages: status.messages || 0,
      unseen: status.unseen || 0,
    };
  });
}

export async function listMailboxes(account) {
  return withImap(account, async (client) => {
    const boxes = await client.list();
    const visibleBoxes = boxes.filter((box) => !box.flags?.has('\\Noselect'));
    const result = [];

    for (const box of visibleBoxes) {
      let status = {};
      try {
        status = await client.status(box.path, { messages: true, unseen: true });
      } catch {
        // Some virtual folders do not support STATUS; keep them visible.
      }
      result.push({
        path: box.path,
        name: box.name,
        label: FOLDER_LABELS.get(box.specialUse) || box.name,
        specialUse: box.specialUse || null,
        messages: status.messages || 0,
        unseen: status.unseen || 0,
        delimiter: box.delimiter || '/',
      });
    }

    return result.sort(sortMailboxes);
  });
}

export async function listMessages(account, options = {}) {
  const mailbox = cleanMailbox(options.mailbox);
  const page = positiveInteger(options.page, 1);
  const pageSize = Math.min(50, positiveInteger(options.pageSize, 25));
  const query = String(options.query || '').trim().slice(0, 100);

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      let fetched;
      let total;
      if (query) {
        const uids = await client.search(
          {
            or: [{ from: query }, { to: query }, { subject: query }, { body: query }],
          },
          { uid: true },
        );
        uids.sort((a, b) => b - a);
        total = uids.length;
        const pageUids = uids.slice((page - 1) * pageSize, page * pageSize);
        fetched = pageUids.length
          ? await client.fetchAll(
            pageUids.join(','),
            { uid: true, envelope: true, flags: true, internalDate: true, size: true },
            { uid: true },
          )
          : [];
        const byUid = new Map(fetched.map((message) => [message.uid, message]));
        fetched = pageUids.map((uid) => byUid.get(uid)).filter(Boolean);
      } else {
        total = client.mailbox?.exists || 0;
        const end = total - (page - 1) * pageSize;
        const start = Math.max(1, end - pageSize + 1);
        fetched = end > 0
          ? await client.fetchAll(
            `${start}:${end}`,
            { uid: true, envelope: true, flags: true, internalDate: true, size: true },
          )
          : [];
        fetched.sort((a, b) => b.uid - a.uid);
      }
      if (!fetched.length) {
        return { messages: [], total, page, pageSize, hasMore: false };
      }
      const messages = fetched.map(serializeMessageSummary);

      return {
        messages,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      };
    } finally {
      lock.release();
    }
  });
}

export async function getMessage(account, mailboxValue, uidValue, markSeen = true) {
  const mailbox = cleanMailbox(mailboxValue);
  const uid = positiveInteger(uidValue, 0);
  if (!uid) throw new ApiError(400, '邮件编号无效。', 'INVALID_UID');

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: !markSeen });
    try {
      const message = await client.fetchOne(
        uid,
        { uid: true, envelope: true, flags: true, internalDate: true, source: true },
        { uid: true },
      );
      if (!message) throw new ApiError(404, '邮件不存在或已被移动。', 'MESSAGE_NOT_FOUND');

      if (markSeen && !message.flags?.has('\\Seen')) {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }

      const parsed = await simpleParser(message.source, {
        skipHtmlToText: true,
        skipTextToHtml: true,
      });

      return serializeParsedMessage(message, parsed, markSeen);
    } finally {
      lock.release();
    }
  });
}

export async function downloadAttachment(account, mailboxValue, uidValue, attachmentIndex) {
  const mailbox = cleanMailbox(mailboxValue);
  const uid = positiveInteger(uidValue, 0);
  const index = Number(attachmentIndex);
  if (!uid || !Number.isInteger(index) || index < 0) {
    throw new ApiError(400, '附件参数无效。', 'INVALID_ATTACHMENT');
  }

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      const message = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!message) throw new ApiError(404, '邮件不存在。', 'MESSAGE_NOT_FOUND');
      const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true });
      const attachment = parsed.attachments[index];
      if (!attachment) throw new ApiError(404, '附件不存在。', 'ATTACHMENT_NOT_FOUND');
      return {
        filename: attachment.filename || `attachment-${index + 1}`,
        contentType: attachment.contentType || 'application/octet-stream',
        content: attachment.content,
        inline: attachment.contentDisposition === 'inline',
      };
    } finally {
      lock.release();
    }
  });
}

export async function updateMessageFlags(account, mailboxValue, uidsValue, changes = {}) {
  const mailbox = cleanMailbox(mailboxValue);
  const uids = normalizeUids(uidsValue);
  if (!uids.length) throw new ApiError(400, '请至少选择一封邮件。', 'NO_MESSAGES');

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const range = uids.join(',');
      if (typeof changes.seen === 'boolean') {
        if (changes.seen) await client.messageFlagsAdd(range, ['\\Seen'], { uid: true });
        else await client.messageFlagsRemove(range, ['\\Seen'], { uid: true });
      }
      if (typeof changes.flagged === 'boolean') {
        if (changes.flagged) await client.messageFlagsAdd(range, ['\\Flagged'], { uid: true });
        else await client.messageFlagsRemove(range, ['\\Flagged'], { uid: true });
      }
      return { updated: uids.length };
    } finally {
      lock.release();
    }
  });
}

export async function moveMessages(account, mailboxValue, uidsValue, destinationValue) {
  const mailbox = cleanMailbox(mailboxValue);
  const destination = cleanMailbox(destinationValue);
  const uids = normalizeUids(uidsValue);
  if (!uids.length) throw new ApiError(400, '请至少选择一封邮件。', 'NO_MESSAGES');

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageMove(uids.join(','), destination, { uid: true });
      return { moved: uids.length };
    } finally {
      lock.release();
    }
  });
}

function serializeMessageSummary(message) {
  const envelope = message.envelope || {};
  return {
    uid: message.uid,
    subject: envelope.subject || '(无主题)',
    from: serializeAddresses(envelope.from),
    to: serializeAddresses(envelope.to),
    date: (envelope.date || message.internalDate || new Date()).toISOString(),
    size: message.size || 0,
    seen: message.flags?.has('\\Seen') || false,
    flagged: message.flags?.has('\\Flagged') || false,
    answered: message.flags?.has('\\Answered') || false,
  };
}

function serializeParsedMessage(message, parsed, markSeen) {
  const summary = serializeMessageSummary(message);
  return {
    ...summary,
    seen: markSeen ? true : summary.seen,
    messageId: parsed.messageId || null,
    cc: serializeAddresses(parsed.cc?.value),
    replyTo: serializeAddresses(parsed.replyTo?.value),
    html: typeof parsed.html === 'string' ? parsed.html : null,
    text: parsed.text || '',
    attachments: parsed.attachments.map((attachment, index) => ({
      id: index,
      filename: attachment.filename || `附件 ${index + 1}`,
      contentType: attachment.contentType || 'application/octet-stream',
      size: attachment.size || attachment.content?.length || 0,
      contentId: attachment.cid || null,
      inline: attachment.contentDisposition === 'inline',
    })),
  };
}

function serializeAddresses(addresses) {
  if (!Array.isArray(addresses)) return [];
  return addresses.map((address) => ({
    name: address.name || '',
    address: address.address || '',
  }));
}

function cleanMailbox(value) {
  const mailbox = String(value || 'INBOX').trim();
  if (!mailbox || mailbox.length > 255 || /[\0\r\n]/.test(mailbox)) {
    throw new ApiError(400, '邮箱文件夹无效。', 'INVALID_MAILBOX');
  }
  return mailbox;
}

function normalizeUids(value) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map(Number).filter((uid) => Number.isInteger(uid) && uid > 0))].slice(0, 100);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sortMailboxes(a, b) {
  const order = ['\\Inbox', '\\Flagged', '\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash', '\\All'];
  const aIndex = order.indexOf(a.specialUse);
  const bIndex = order.indexOf(b.specialUse);
  const normalizedA = aIndex === -1 ? order.length : aIndex;
  const normalizedB = bIndex === -1 ? order.length : bIndex;
  return normalizedA - normalizedB || a.label.localeCompare(b.label, 'zh-CN');
}

function normalizeImapError(error, account) {
  if (error instanceof ApiError) return error;
  if (Number.isInteger(error?.status) && error?.code) return error;
  const text = `${error?.responseText || ''} ${error?.message || ''}`.toLowerCase();
  if (
    error?.authenticationFailed ||
    text.includes('authentication') ||
    text.includes('login failed') ||
    text.includes('auth')
  ) {
    return new ApiError(
      401,
      '登录失败。请确认已开启 IMAP 服务，并使用客户端授权码或应用专用密码。',
      'AUTHENTICATION_FAILED',
    );
  }
  if (text.includes('timeout') || text.includes('timed out')) {
    return new ApiError(504, '连接邮箱服务器超时，请检查网络后重试。', 'IMAP_TIMEOUT');
  }
  return new ApiError(502, '邮箱服务器暂时无法响应，请稍后重试。', 'IMAP_ERROR');
}
