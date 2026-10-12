import { matchesSearchText } from '../shared/search-query.js';

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
