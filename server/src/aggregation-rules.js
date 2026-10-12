import crypto from 'node:crypto';

const SUPPORTED_TYPES = new Set(['sender', 'subject']);

export function getAggregationRules(account) {
  if (!Array.isArray(account.aggregationRules)) account.aggregationRules = [];
  return account.aggregationRules;
}

export function createAggregationRule(account, input = {}) {
  const type = String(input.type || '').trim().toLowerCase();
  if (!SUPPORTED_TYPES.has(type)) return null;

  const sourceValue = String(input.value || '').trim();
  const value = normalizeRuleValue(type, sourceValue);
  if (!value) return null;

  const rules = getAggregationRules(account);
  const existing = rules.find((rule) => rule.type === type && rule.value === value);
  if (existing) {
    addRuleSeed(existing, input.mailbox, input.uid);
    return { rule: existing, created: false };
  }

  const label = String(input.label || sourceValue).trim().slice(0, 160) || sourceValue.slice(0, 160);
  const rule = {
    id: crypto.randomUUID(),
    type,
    value,
    label,
    createdAt: new Date().toISOString(),
    seeds: [],
  };
  addRuleSeed(rule, input.mailbox, input.uid);
  rules.push(rule);
  return { rule, created: true };
}

function addRuleSeed(rule, mailboxValue, uidValue) {
  const mailbox = String(mailboxValue || '').trim();
  const uid = Number(uidValue);
  if (!mailbox || mailbox.length > 255 || /[\0\r\n]/.test(mailbox)) return;
  if (!Number.isInteger(uid) || uid <= 0) return;
  if (!Array.isArray(rule.seeds)) rule.seeds = [];
  if (!rule.seeds.some((seed) => seed.mailbox === mailbox && seed.uid === uid)) {
    rule.seeds.push({ mailbox, uid });
  }
}

export function removeAggregationRule(account, ruleId) {
  const rules = getAggregationRules(account);
  const index = rules.findIndex((rule) => rule.id === ruleId);
  if (index === -1) return false;
  rules.splice(index, 1);
  return true;
}

export function findAggregationRule(account, ruleId) {
  return getAggregationRules(account).find((rule) => rule.id === ruleId) || null;
}

export function normalizeSubject(value) {
  let subject = String(value || '').trim();
  const prefix = /^(?:(?:re|fw|fwd)\s*[:：]|回复\s*[:：]|答复\s*[:：]|转发\s*[:：])\s*/i;
  while (prefix.test(subject)) subject = subject.replace(prefix, '').trim();
  return subject.replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function matchesAggregationRule(message, rule) {
  if (!message || !rule) return false;
  if (rule.type === 'sender') {
    return (message.from || []).some((address) => (
      normalizeRuleValue('sender', address?.address) === rule.value
    ));
  }
  if (rule.type === 'subject') {
    return normalizeSubject(message.subject) === rule.value;
  }
  return false;
}

export function messagesForAggregationRule(messages, rules, ruleId) {
  return messages.filter((message) => (
    rules.find((rule) => matchesAggregationRule(message, rule))?.id === ruleId
  ));
}

export function buildAggregatedMessageList(messages, rules) {
  const groups = new Map(rules.map((rule) => [rule.id, { rule, messages: [] }]));
  const singles = [];

  for (const message of messages) {
    const matchedRule = rules.find((rule) => matchesAggregationRule(message, rule));
    if (matchedRule) groups.get(matchedRule.id).messages.push(message);
    else singles.push({ ...message, kind: 'message' });
  }

  const output = [...singles];
  for (const { rule, messages: members } of groups.values()) {
    if (!members.length) continue;

    const latest = members[0];
    const unread = members.reduce((count, message) => count + (message.seen ? 0 : 1), 0);
    output.push({
      kind: 'group',
      key: `group:${rule.id}`,
      groupId: rule.id,
      ruleId: rule.id,
      groupType: rule.type,
      label: rule.label,
      count: members.length,
      unread,
      seen: unread === 0,
      flagged: members.some((message) => message.flagged),
      date: latest.date,
      latestUid: latest.uid,
      latestSubject: latest.subject,
      subject: rule.label,
      from: latest.from,
      to: latest.to,
    });
  }

  return output.sort(compareSummaryDates);
}

function normalizeRuleValue(type, value) {
  if (type === 'subject') return normalizeSubject(value);
  return String(value || '').trim().toLocaleLowerCase();
}

function compareSummaryDates(a, b) {
  const aGrouped = a.kind === 'group';
  const bGrouped = b.kind === 'group';
  if (aGrouped !== bGrouped) return aGrouped ? -1 : 1;
  const aTime = Date.parse(a.date);
  const bTime = Date.parse(b.date);
  const safeA = Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY;
  const safeB = Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY;
  if (safeA !== safeB) return safeB - safeA;
  return (Number(b.uid || b.latestUid) || 0) - (Number(a.uid || a.latestUid) || 0);
}
