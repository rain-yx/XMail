export function tokenizeSearchQuery(value) {
  const tokens = String(value || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  return [...new Set(tokens)];
}

export function matchesSearchText(value, query) {
  const haystack = String(value || '').toLocaleLowerCase();
  const needles = tokenizeSearchQuery(query).map((token) => token.toLocaleLowerCase());
  return needles.length === 0 || needles.every((needle) => haystack.includes(needle));
}

function addressText(addresses) {
  if (!Array.isArray(addresses)) return '';
  return addresses
    .flatMap((address) => [address?.name, address?.address])
    .filter(Boolean)
    .join(' ');
}

export function matchesMessageSummary(message, query) {
  const haystack = [
    message?.subject,
    addressText(message?.from),
    addressText(message?.to),
  ]
    .filter(Boolean)
    .join(' ');
  return matchesSearchText(haystack, query);
}
