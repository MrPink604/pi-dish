// Generated from src/core/cron.ts; edit that source and run npm run build:core.
"use strict";
/**
 * Hand-rolled five-field cron: no dependency so pi-dish runs on old-glibc Node
 * without native modules. Evaluated in local time (schedules are wall-clock),
 * hence Date's local getters rather than UTC arithmetic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCron = parseCron;
exports.cronMatches = cronMatches;
exports.nextCronMatch = nextCronMatch;
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ALIASES = {
    '@hourly': '0 * * * *',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@weekly': '0 0 * * 0',
    '@monthly': '0 0 1 * *',
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
};
const FIELDS = [
    { name: 'minute', min: 0, max: 59, names: null },
    { name: 'hour', min: 0, max: 23, names: null },
    { name: 'dayOfMonth', min: 1, max: 31, names: null },
    { name: 'month', min: 1, max: 12, names: MONTH_NAMES, nameOffset: 1 },
    { name: 'dayOfWeek', min: 0, max: 7, names: DAY_NAMES, nameOffset: 0 },
];
function parseValue(field, token) {
    const text = token.trim().toLowerCase();
    if (field.names) {
        const index = field.names.indexOf(text.slice(0, 3));
        if (index >= 0 && /^[a-z]+$/.test(text))
            return index + field.nameOffset;
    }
    if (!/^\d+$/.test(text)) {
        throw new Error(`invalid ${field.name} value "${token}"`);
    }
    const value = Number(text);
    if (value < field.min || value > field.max) {
        throw new Error(`${field.name} value ${value} is out of range (${field.min}-${field.max})`);
    }
    return value;
}
function parseField(field, spec) {
    const values = new Set();
    let restricted = false;
    for (const part of spec.split(',')) {
        const chunk = part.trim();
        if (!chunk)
            throw new Error(`empty ${field.name} entry`);
        const [rangeText, stepText, ...extra] = chunk.split('/');
        if (extra.length)
            throw new Error(`invalid ${field.name} step "${chunk}"`);
        let step = 1;
        if (stepText !== undefined) {
            if (!/^\d+$/.test(stepText.trim()) || Number(stepText) < 1) {
                throw new Error(`invalid ${field.name} step "${chunk}"`);
            }
            step = Number(stepText);
        }
        let start;
        let end;
        if (rangeText.trim() === '*') {
            // `*`-rooted stays unrestricted even with a step (Vixie cron): `*/2`
            // day-of-month still ANDs with a named day-of-week.
            start = field.min;
            end = field.max;
        }
        else if (rangeText.includes('-')) {
            const [from, to, ...rest] = rangeText.split('-');
            if (rest.length)
                throw new Error(`invalid ${field.name} range "${chunk}"`);
            start = parseValue(field, from);
            end = parseValue(field, to);
            if (end < start)
                throw new Error(`${field.name} range "${chunk}" ends before it starts`);
            restricted = true;
        }
        else {
            start = parseValue(field, rangeText);
            end = stepText === undefined ? start : field.max;
            restricted = true;
        }
        for (let value = start; value <= end; value += step)
            values.add(value);
    }
    // Cron's Sunday is both 0 and 7; normalize so matching only ever asks for 0.
    if (field.name === 'dayOfWeek' && values.delete(7))
        values.add(0);
    return { values, restricted };
}
/** Throws an Error whose message is safe to return as a 400. */
function parseCron(expression) {
    if (!expression.trim()) {
        throw new Error('a cron expression is required');
    }
    const raw = expression.trim();
    const normalized = ALIASES[raw.toLowerCase()] || raw;
    if (normalized.startsWith('@')) {
        throw new Error(`unknown cron alias "${raw}" (supported: @hourly, @daily, @weekly, @monthly)`);
    }
    const parts = normalized.split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`a cron expression needs 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`);
    }
    const parsed = {
        expression: raw, minute: new Set(), hour: new Set(), dayOfMonth: new Set(),
        month: new Set(), dayOfWeek: new Set(), domRestricted: false, dowRestricted: false,
    };
    for (let i = 0; i < FIELDS.length; i++) {
        const { values, restricted } = parseField(FIELDS[i], parts[i]);
        parsed[FIELDS[i].name] = values;
        if (FIELDS[i].name === 'dayOfMonth')
            parsed.domRestricted = restricted;
        if (FIELDS[i].name === 'dayOfWeek')
            parsed.dowRestricted = restricted;
    }
    return parsed;
}
// Classic dom/dow rule: when both are restricted, either one matching suffices.
function dayMatches(parsed, date) {
    const dom = parsed.dayOfMonth.has(date.getDate());
    const dow = parsed.dayOfWeek.has(date.getDay());
    if (parsed.domRestricted && parsed.dowRestricted)
        return dom || dow;
    return dom && dow;
}
function cronMatches(parsed, when) {
    return parsed.month.has(when.getMonth() + 1)
        && dayMatches(parsed, when)
        && parsed.hour.has(when.getHours())
        && parsed.minute.has(when.getMinutes());
}
const MAX_SEARCH_DAYS = 366;
/**
 * First matching minute strictly after `from`, or null if none within a year.
 * Skips by month/day/hour so a never-matching expression costs a few hundred iterations.
 */
function nextCronMatch(parsed, from = new Date()) {
    const limit = from.getTime() + MAX_SEARCH_DAYS * 86400000;
    const cursor = new Date(from.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);
    while (cursor.getTime() <= limit) {
        if (!parsed.month.has(cursor.getMonth() + 1)) {
            cursor.setMonth(cursor.getMonth() + 1, 1);
            cursor.setHours(0, 0, 0, 0);
            continue;
        }
        if (!dayMatches(parsed, cursor)) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(0, 0, 0, 0);
            continue;
        }
        if (!parsed.hour.has(cursor.getHours())) {
            cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
            continue;
        }
        if (!parsed.minute.has(cursor.getMinutes())) {
            cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
            continue;
        }
        return cursor;
    }
    return null;
}
