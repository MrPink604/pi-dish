// Generated from src/core/helper-format.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.truncate = truncate;
function escapeHtml(text) {
    if (text == null || text === '')
        return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
// No newline — truncated text also lands in one-line summary spans.
function truncate(text, maxLen, suffix = ' … (truncated)') {
    if (!text || text.length <= maxLen)
        return text;
    return text.slice(0, maxLen) + suffix;
}
