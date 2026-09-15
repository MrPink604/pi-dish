export function escapeHtml(text: unknown) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// No newline — truncated text also lands in one-line summary spans.
export function truncate(text: string, maxLen: number, suffix = ' … (truncated)') {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + suffix;
}
