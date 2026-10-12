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
