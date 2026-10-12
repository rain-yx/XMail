export function getVisibleRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  total,
  buffer = 5,
}) {
  if (!total || rowHeight <= 0) return { start: 0, end: 0 };
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + buffer * 2;
  const rawStart = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - buffer);
  const start = Math.min(Math.max(0, total - visibleCount), rawStart);
  return { start, end: Math.min(total, start + visibleCount) };
}

export function formatMailDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '0000-00-00';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
