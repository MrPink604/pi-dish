// Generated from src/core/host-colors.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOST_COLOR_SLOTS = void 0;
exports.sanitizeHostColors = sanitizeHostColors;
exports.sanitizeHostColorOrder = sanitizeHostColorOrder;
exports.assignHostColor = assignHostColor;
exports.rgbStringToHex = rgbStringToHex;
exports.HOST_COLOR_SLOTS = 5;
/** Only validated, own #rrggbb values may become CSS colors. */
function sanitizeHostColors(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const entries = [];
    for (const [key, value] of Object.entries(raw)) {
        if (key && typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value))
            entries.push([key, value.toLowerCase()]);
    }
    return Object.fromEntries(entries);
}
function sanitizeHostColorOrder(raw) {
    if (!Array.isArray(raw))
        return [];
    const rows = raw;
    return [...new Set(rows.filter((item) => typeof item === 'string' && !!item))];
}
/** First-seen slots remain stable; explicit overrides do not reorder hosts. */
function assignHostColor(order, key, overrides) {
    const list = sanitizeHostColorOrder(order);
    const map = sanitizeHostColors(overrides);
    let index = list.indexOf(key);
    const appended = !!key && index < 0;
    if (appended) {
        list.push(key);
        index = list.length - 1;
    }
    const auto = index < 0 ? 'var(--text-muted)' : `var(--chart-${(index % exports.HOST_COLOR_SLOTS) + 1})`;
    const custom = Object.prototype.hasOwnProperty.call(map, key);
    return { color: custom ? map[key] : auto, order: list, index, appended, custom };
}
function rgbStringToHex(value) {
    if (typeof value !== 'string')
        return null;
    if (/^#[0-9a-fA-F]{6}$/.test(value))
        return value.toLowerCase();
    const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value.trim());
    if (!match)
        return null;
    const part = (input) => Math.max(0, Math.min(255, Math.round(Number(input)))).toString(16).padStart(2, '0');
    return '#' + part(match[1]) + part(match[2]) + part(match[3]);
}
