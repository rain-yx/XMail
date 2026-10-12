function timestampFrom(value) {
  if (value == null || value === '') return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function messageTimestamp(message) {
  const candidates = [message?.date, message?.envelope?.date, message?.internalDate];
  for (const candidate of candidates) {
    const timestamp = timestampFrom(candidate);
    if (timestamp !== null) return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

export function compareMessagesNewestFirst(a, b) {
  const aTimestamp = messageTimestamp(a);
  const bTimestamp = messageTimestamp(b);
  if (aTimestamp !== bTimestamp) return bTimestamp > aTimestamp ? 1 : -1;
  return (Number(b?.uid) || 0) - (Number(a?.uid) || 0);
}
