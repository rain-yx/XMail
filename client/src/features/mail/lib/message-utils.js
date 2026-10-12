export function sortMessagesNewestFirst(items) {
  return [...items].sort((a, b) => {
    const aGrouped = a.kind === 'group';
    const bGrouped = b.kind === 'group';
    if (aGrouped !== bGrouped) return aGrouped ? -1 : 1;
    const aTime = Date.parse(a.date);
    const bTime = Date.parse(b.date);
    const safeATime = Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY;
    const safeBTime = Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY;
    if (safeATime !== safeBTime) return safeBTime > safeATime ? 1 : -1;
    return (Number(b.uid || b.latestUid) || 0) - (Number(a.uid || a.latestUid) || 0);
  });
}

export function messageIdentity(message) {
  return message.kind === 'group' ? `group:${message.groupId}` : `message:${message.uid}`;
}

export function normalizeAggregationSubject(value) {
  let subject = String(value || '').trim();
  const prefix = /^(?:(?:re|fw|fwd)\s*[:：]|回复\s*[:：]|答复\s*[:：]|转发\s*[:：])\s*/i;
  while (prefix.test(subject)) subject = subject.replace(prefix, '').trim();
  return subject.replace(/\s+/g, ' ').toLocaleLowerCase();
}
