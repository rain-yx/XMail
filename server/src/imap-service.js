import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { matchesSearchText, tokenizeSearchQuery } from './search-query.js';
import {
  buildAggregatedMessageList,
  findAggregationRule,
  getAggregationRules,
  matchesAggregationRule,
  messagesForAggregationRule,
} from './aggregation-rules.js';
import { compareMessagesNewestFirst } from './message-order.js';

const HEADER_SEARCH_CACHE_TTL = 10 * 60 * 1000;
const HEADER_SEARCH_CACHE_LIMIT = 8;
const headerSearchCache = new Map();
const SUMMARY_CACHE_TTL = 10 * 60 * 1000;
const SUMMARY_CACHE_LIMIT = 8;
const summaryCache = new Map();
const AGGREGATION_PLAN_CACHE_TTL = 10 * 60 * 1000;
const AGGREGATION_PLAN_CACHE_LIMIT = 8;
const aggregationPlanCache = new Map();

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

export function createImapClient(account, options = {}) {
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
    socketTimeout: options.socketTimeout ?? 30_000,
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
    ...(options.autoIdleDelay !== undefined ? { autoIdleDelay: options.autoIdleDelay } : {}),
    ...(options.maxIdleTime !== undefined ? { maxIdleTime: options.maxIdleTime } : {}),
    ...(options.missingIdleCommand ? { missingIdleCommand: options.missingIdleCommand } : {}),
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
    const boxes = await client.list({ statusQuery: { messages: true, unseen: true } });
    const visibleBoxes = boxes.filter((box) => !box.flags?.has('\\Noselect'));
    const result = visibleBoxes.map((box) => {
      const status = box.status?.error ? {} : box.status || {};
      return {
        path: box.path,
        name: box.name,
        label: FOLDER_LABELS.get(box.specialUse) || box.name,
        specialUse: box.specialUse || null,
        messages: status.messages || 0,
        unseen: status.unseen || 0,
        delimiter: box.delimiter || '/',
      };
    });

    return result.sort(sortMailboxes);
  });
}

export async function listMessages(account, options = {}) {
  const mailbox = cleanMailbox(options.mailbox);
  const page = positiveInteger(options.page, 1);
  const pageSize = Math.min(50, positiveInteger(options.pageSize, 25));
  const query = String(options.query || '').trim().slice(0, 100);
  const groupId = String(options.groupId || '').trim().slice(0, 100);
  const aggregationRules = getAggregationRules(account);

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      if (groupId) {
        const rule = findAggregationRule(account, groupId);
        if (!rule) throw new ApiError(404, '聚合规则不存在或已被取消。', 'AGGREGATION_RULE_NOT_FOUND');
        const plan = await tryGetAggregationPlan(client, account, mailbox, aggregationRules);
        const groupedMessages = plan
          ? plan.groupMembers.get(rule.id) || []
          : messagesForAggregationRule(
            await getMailboxSummaryIndex(client, account, mailbox),
            aggregationRules,
            rule.id,
          );
        const start = (page - 1) * pageSize;
        return {
          messages: groupedMessages.slice(start, start + pageSize),
          total: groupedMessages.length,
          page,
          pageSize,
          hasMore: page * pageSize < groupedMessages.length,
          group: rule,
        };
      }

      if (!query && aggregationRules.length) {
        const plan = await tryGetAggregationPlan(client, account, mailbox, aggregationRules);
        const start = (page - 1) * pageSize;
        if (plan) {
          const messages = await materializeAggregationPage(client, plan, start, pageSize);
          return {
            messages,
            total: plan.descriptors.length,
            sourceTotal: plan.sourceTotal,
            page,
            pageSize,
            hasMore: page * pageSize < plan.descriptors.length,
            aggregated: true,
            aggregationMode: 'rule-search',
          };
        }

        const summaries = await getMailboxSummaryIndex(client, account, mailbox);
        const aggregatedMessages = buildAggregatedMessageList(summaries, aggregationRules);
        return {
          messages: aggregatedMessages.slice(start, start + pageSize),
          total: aggregatedMessages.length,
          sourceTotal: summaries.length,
          page,
          pageSize,
          hasMore: page * pageSize < aggregatedMessages.length,
          aggregated: true,
          aggregationMode: 'summary-fallback',
        };
      }

      let fetched;
      let total;
      let searchMode;
      if (query) {
        const searchResult = await searchMessageUids(client, account, mailbox, query);
        const uids = searchResult.uids;
        searchMode = searchResult.mode;
        total = uids.length;
        const pageUids = uids.slice((page - 1) * pageSize, page * pageSize);
        fetched = pageUids.length
          ? await client.fetchAll(
            pageUids.join(','),
            { uid: true, envelope: true, flags: true, internalDate: true, size: true },
            { uid: true },
          )
          : [];
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
      }

      fetched.sort(compareMessagesNewestFirst);
      if (!fetched.length) {
        return { messages: [], total, page, pageSize, hasMore: false, searchMode };
      }
      const messages = fetched.map(serializeMessageSummary);

      return {
        messages,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
        searchMode,
      };
    } finally {
      lock.release();
    }
  });
}

export async function getMailboxSnapshot(account, mailboxValue, limitValue = 20) {
  const mailbox = cleanMailbox(mailboxValue);
  const limit = Math.min(50, positiveInteger(limitValue, 20));

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      return getSelectedMailboxSnapshot(client, mailbox, limit);
    } finally {
      lock.release();
    }
  });
}

export async function getSelectedMailboxSnapshot(client, mailbox, limit = 20) {
  const state = client.mailbox || {};
  const total = state.exists || 0;
  const start = Math.max(1, total - limit + 1);
  const fetched = total > 0
    ? await client.fetchAll(
      `${start}:${total}`,
      { uid: true, envelope: true, flags: true, internalDate: true, size: true },
    )
    : [];

  fetched.sort(compareMessagesNewestFirst);
  return {
    mailbox,
    uidValidity: String(state.uidValidity ?? ''),
    messages: fetched.map(serializeMessageSummary),
    total,
  };
}

async function searchMessageUids(client, account, mailbox, query) {
  let imapMatches = [];
  try {
    imapMatches = await searchMessageUidsViaImap(client, query);
  } catch {
    // Fall through to the local header index when the provider rejects SEARCH.
  }
  if (imapMatches.length) return { uids: imapMatches, mode: 'imap' };

  const headerIndex = await getHeaderSearchIndex(client, account, mailbox);
  const uids = headerIndex
    .filter((message) => matchesSearchText(message.text, query))
    .map((message) => message.uid)
    .sort((a, b) => b - a);
  return { uids, mode: 'header-fallback' };
}

async function searchMessageUidsViaImap(client, query) {
  let matches = null;
  for (const term of tokenizeSearchQuery(query)) {
    const termMatches = await searchMessageUidsByTerm(client, term);
    if (matches === null) {
      matches = new Set(termMatches);
    } else {
      const current = new Set(termMatches);
      matches = new Set([...matches].filter((uid) => current.has(uid)));
    }
    if (!matches.size) break;
  }

  return [...(matches || [])].sort((a, b) => b - a);
}

async function getHeaderSearchIndex(client, account, mailbox) {
  const cacheKey = headerSearchCacheKey(client, account, mailbox);
  const cached = readHeaderSearchCache(cacheKey);
  if (cached) return cached;
  if (!client.mailbox?.exists) return [];

  const index = [];
  for await (const message of client.fetch('1:*', { uid: true, envelope: true })) {
    index.push({
      uid: message.uid,
      text: envelopeSearchText(message.envelope),
      envelope: message.envelope,
    });
  }
  writeHeaderSearchCache(cacheKey, index);
  return index;
}

async function getMailboxSummaryIndex(client, account, mailbox) {
  const cacheKey = summaryCacheKey(client, account, mailbox);
  const cached = readSummaryCache(cacheKey);
  if (cached) return cached;
  if (!client.mailbox?.exists) return [];

  const summaries = [];
  for await (const message of client.fetch(
    '1:*',
    { uid: true, envelope: true, flags: true, internalDate: true, size: true },
  )) {
    summaries.push(serializeMessageSummary(message));
  }
  summaries.sort(compareMessagesNewestFirst);
  writeSummaryCache(cacheKey, account, mailbox, summaries);
  return summaries;
}

async function tryGetAggregationPlan(client, account, mailbox, rules) {
  try {
    return await getAggregationPlan(client, account, mailbox, rules);
  } catch {
    // Providers that reject simple rule searches keep the full-summary fallback.
    return null;
  }
}

async function getAggregationPlan(client, account, mailbox, rules) {
  const cacheKey = aggregationPlanCacheKey(client, account, mailbox, rules);
  const cached = readAggregationPlanCache(cacheKey);
  if (cached) return cached;

  const allUids = await listAllMessageUids(client);
  if (!allUids.length) {
    const emptyPlan = {
      descriptors: [],
      groupMembers: new Map(),
      groupRows: [],
      sourceTotal: 0,
    };
    writeAggregationPlanCache(cacheKey, account, mailbox, emptyPlan);
    return emptyPlan;
  }

  const candidateUidSet = new Set();
  for (const rule of rules) {
    const matched = await searchAggregationRuleUids(client, account, mailbox, rule);
    for (const uid of matched) candidateUidSet.add(uid);
    for (const seed of rule.seeds || []) {
      if (seed.mailbox === mailbox && allUids.includes(seed.uid)) candidateUidSet.add(seed.uid);
    }
  }

  const candidateSummaries = await fetchMessageSummariesByUids(client, [...candidateUidSet]);
  candidateSummaries.sort(compareMessagesNewestFirst);
  const groupMembers = new Map();
  const assignedUids = new Set();
  for (const rule of rules) {
    const members = messagesForAggregationRule(candidateSummaries, rules, rule.id);
    groupMembers.set(rule.id, members);
    for (const message of members) assignedUids.add(message.uid);
  }

  const groupRows = buildAggregatedMessageList(candidateSummaries, rules)
    .filter((message) => message.kind === 'group');
  const ungroupedUids = allUids
    .filter((uid) => !assignedUids.has(uid))
    .sort((a, b) => b - a);
  const plan = {
    descriptors: [...groupRows, ...ungroupedUids],
    groupMembers,
    groupRows,
    sourceTotal: allUids.length,
  };
  writeAggregationPlanCache(cacheKey, account, mailbox, plan);
  return plan;
}

async function searchAggregationRuleUids(client, account, mailbox, rule) {
  const criteria = rule.type === 'sender'
    ? { from: rule.value }
    : { subject: rule.value };
  let matches = [];
  let primaryError;
  try {
    const result = await client.search(criteria, { uid: true });
    if (Array.isArray(result)) matches = result;
  } catch (error) {
    primaryError = error;
  }

  if (!matches.length) {
    try {
      const fallback = await client.search({ text: rule.value }, { uid: true });
      if (Array.isArray(fallback)) matches = fallback;
    } catch (error) {
      if (primaryError) throw primaryError;
      throw error;
    }
  }

  if (!matches.length && (rule.seeds || []).some((seed) => seed.mailbox === mailbox)) {
    const headerIndex = await getHeaderSearchIndex(client, account, mailbox);
    matches = headerIndex
      .filter((message) => {
        if (message.envelope) {
          return matchesAggregationRule(
            serializeMessageSummary({ uid: message.uid, envelope: message.envelope }),
            rule,
          );
        }
        return matchesSearchText(message.text, rule.value);
      })
      .map((message) => message.uid);
  }

  return sanitizeUidList(matches);
}

async function listAllMessageUids(client) {
  try {
    const result = await client.search({ all: true }, { uid: true });
    if (Array.isArray(result)) return sanitizeUidList(result);
  } catch {
    // Fetching UID only is still much lighter than fetching every envelope.
  }

  const uids = [];
  if (!client.mailbox?.exists) return uids;
  for await (const message of client.fetch('1:*', { uid: true })) uids.push(message.uid);
  return sanitizeUidList(uids);
}

async function fetchMessageSummariesByUids(client, values) {
  const uids = sanitizeUidList(values);
  const messages = [];
  const batchSize = 250;
  for (let index = 0; index < uids.length; index += batchSize) {
    const batch = uids.slice(index, index + batchSize);
    const fetched = await client.fetchAll(
      batch.join(','),
      { uid: true, envelope: true, flags: true, internalDate: true, size: true },
      { uid: true },
    );
    messages.push(...fetched.map(serializeMessageSummary));
  }
  return messages;
}

async function materializeAggregationPage(client, plan, start, pageSize) {
  const descriptors = plan.descriptors.slice(start, start + pageSize);
  const uids = descriptors.filter((item) => Number.isInteger(item));
  const summaries = await fetchMessageSummariesByUids(client, uids);
  const byUid = new Map(summaries.map((message) => [message.uid, message]));
  return descriptors
    .map((item) => (Number.isInteger(item) ? byUid.get(item) : item))
    .filter(Boolean);
}

function sanitizeUidList(values) {
  return [...new Set((values || []).map(Number).filter((uid) => Number.isInteger(uid) && uid > 0))];
}

function envelopeSearchText(envelope = {}) {
  const addresses = [
    envelope.from,
    envelope.to,
    envelope.cc,
    envelope.bcc,
    envelope.sender,
    envelope.replyTo,
  ];
  return [
    envelope.subject,
    ...addresses.flatMap((list) => (
      Array.isArray(list)
        ? list.flatMap((address) => [address?.name, address?.address])
        : []
    )),
  ].filter(Boolean).join(' ');
}

function headerSearchCacheKey(client, account, mailbox) {
  const state = client.mailbox || {};
  return [
    account.host,
    account.email,
    mailbox,
    String(state.uidValidity ?? ''),
    state.uidNext || 0,
    state.exists || 0,
  ].join('\0');
}

function readHeaderSearchCache(key) {
  const cached = headerSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    headerSearchCache.delete(key);
    return null;
  }
  headerSearchCache.delete(key);
  headerSearchCache.set(key, cached);
  return cached.index;
}

function writeHeaderSearchCache(key, index) {
  headerSearchCache.delete(key);
  while (headerSearchCache.size >= HEADER_SEARCH_CACHE_LIMIT) {
    headerSearchCache.delete(headerSearchCache.keys().next().value);
  }
  headerSearchCache.set(key, {
    index,
    expiresAt: Date.now() + HEADER_SEARCH_CACHE_TTL,
  });
}

function summaryCacheKey(client, account, mailbox) {
  const state = client.mailbox || {};
  return [
    account.host,
    account.email,
    mailbox,
    String(state.uidValidity ?? ''),
    state.uidNext || 0,
    state.exists || 0,
  ].join('\0');
}

function readSummaryCache(key) {
  const cached = summaryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    summaryCache.delete(key);
    return null;
  }
  summaryCache.delete(key);
  summaryCache.set(key, cached);
  return cached.summaries;
}

function writeSummaryCache(key, account, mailbox, summaries) {
  summaryCache.delete(key);
  while (summaryCache.size >= SUMMARY_CACHE_LIMIT) {
    summaryCache.delete(summaryCache.keys().next().value);
  }
  summaryCache.set(key, {
    accountKey: `${account.host}\0${account.email}`,
    mailbox,
    summaries,
    expiresAt: Date.now() + SUMMARY_CACHE_TTL,
  });
}

function aggregationPlanCacheKey(client, account, mailbox, rules) {
  const state = client.mailbox || {};
  const ruleSignature = rules.map((rule) => {
    const seeds = (rule.seeds || [])
      .map((seed) => `${seed.mailbox}:${seed.uid}`)
      .sort()
      .join(',');
    return `${rule.id}:${rule.type}:${rule.value}:${seeds}`;
  }).join('|');
  return [
    account.host,
    account.email,
    mailbox,
    String(state.uidValidity ?? ''),
    state.uidNext || 0,
    state.exists || 0,
    ruleSignature,
  ].join('\0');
}

function readAggregationPlanCache(key) {
  const cached = aggregationPlanCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    aggregationPlanCache.delete(key);
    return null;
  }
  aggregationPlanCache.delete(key);
  aggregationPlanCache.set(key, cached);
  return cached.plan;
}

function writeAggregationPlanCache(key, account, mailbox, plan) {
  aggregationPlanCache.delete(key);
  while (aggregationPlanCache.size >= AGGREGATION_PLAN_CACHE_LIMIT) {
    aggregationPlanCache.delete(aggregationPlanCache.keys().next().value);
  }
  aggregationPlanCache.set(key, {
    accountKey: `${account.host}\0${account.email}`,
    mailbox,
    plan,
    expiresAt: Date.now() + AGGREGATION_PLAN_CACHE_TTL,
  });
}

function patchSummaryCache(account, mailbox, uids, changes) {
  const accountKey = `${account.host}\0${account.email}`;
  const uidSet = new Set(uids);
  for (const cached of summaryCache.values()) {
    if (cached.accountKey !== accountKey || cached.mailbox !== mailbox) continue;
    for (const message of cached.summaries) {
      if (!uidSet.has(message.uid)) continue;
      if (typeof changes.seen === 'boolean') message.seen = changes.seen;
      if (typeof changes.flagged === 'boolean') message.flagged = changes.flagged;
    }
  }
  patchAggregationPlanCache(account, mailbox, uids, changes);
}

function patchAggregationPlanCache(account, mailbox, uids, changes) {
  const accountKey = `${account.host}\0${account.email}`;
  const uidSet = new Set(uids);
  for (const cached of aggregationPlanCache.values()) {
    if (cached.accountKey !== accountKey || cached.mailbox !== mailbox) continue;
    for (const [ruleId, members] of cached.plan.groupMembers) {
      let changed = false;
      for (const message of members) {
        if (!uidSet.has(message.uid)) continue;
        if (typeof changes.seen === 'boolean') message.seen = changes.seen;
        if (typeof changes.flagged === 'boolean') message.flagged = changes.flagged;
        changed = true;
      }
      if (!changed) continue;
      const group = cached.plan.groupRows.find((item) => item.ruleId === ruleId);
      if (!group) continue;
      group.unread = members.reduce((count, message) => count + (message.seen ? 0 : 1), 0);
      group.seen = group.unread === 0;
      group.flagged = members.some((message) => message.flagged);
    }
  }
}

function clearMailboxCaches(account, ...mailboxes) {
  const accountKey = `${account.host}\0${account.email}`;
  const mailboxSet = new Set(mailboxes);
  for (const [key, cached] of summaryCache) {
    if (cached.accountKey === accountKey && mailboxSet.has(cached.mailbox)) summaryCache.delete(key);
  }
  for (const [key, cached] of aggregationPlanCache) {
    if (cached.accountKey === accountKey && mailboxSet.has(cached.mailbox)) aggregationPlanCache.delete(key);
  }
  const prefixes = [...mailboxSet].map((mailbox) => `${account.host}\0${account.email}\0${mailbox}\0`);
  for (const key of headerSearchCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) headerSearchCache.delete(key);
  }
}

async function searchMessageUidsByTerm(client, term) {
  let matches = [];
  let primaryError;
  try {
    const result = await client.search(
      { or: [{ from: term }, { to: term }, { subject: term }, { body: term }] },
      { uid: true },
    );
    if (Array.isArray(result)) matches = result;
  } catch (error) {
    primaryError = error;
  }

  // Some providers return no matches for nested OR searches but support TEXT.
  if (!matches.length) {
    try {
      const fallback = await client.search({ text: term }, { uid: true });
      if (Array.isArray(fallback)) matches = fallback;
    } catch (error) {
      if (primaryError) throw primaryError;
      throw error;
    }
  }

  return [...new Set(matches.map(Number).filter((uid) => Number.isInteger(uid) && uid > 0))]
    .sort((a, b) => b - a);
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
        patchSummaryCache(account, mailbox, [uid], { seen: true });
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
      patchSummaryCache(account, mailbox, uids, changes);
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
      clearMailboxCaches(account, mailbox, destination);
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
