// Generated tool from test/cron.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for lib/cron.js — the hand-rolled five-field parser.
 *
 * Everything is local time, so the fixtures build dates with the local Date
 * constructor rather than ISO strings (which would be UTC).
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert");
const cron_js_1 = require("../lib/cron.js");
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0);
test('parses the plain fields and matches the exact minute', () => {
    const parsed = (0, cron_js_1.parseCron)('30 9 * * *');
    assert.ok((0, cron_js_1.cronMatches)(parsed, at(2026, 9, 3, 9, 30)));
    assert.ok(!(0, cron_js_1.cronMatches)(parsed, at(2026, 9, 3, 9, 31)));
    assert.ok(!(0, cron_js_1.cronMatches)(parsed, at(2026, 9, 3, 10, 30)));
});
test('lists, ranges and steps', () => {
    const list = (0, cron_js_1.parseCron)('0,15,45 * * * *');
    assert.ok((0, cron_js_1.cronMatches)(list, at(2026, 9, 3, 4, 15)));
    assert.ok(!(0, cron_js_1.cronMatches)(list, at(2026, 9, 3, 4, 30)));
    const range = (0, cron_js_1.parseCron)('0 9-17 * * *');
    assert.ok((0, cron_js_1.cronMatches)(range, at(2026, 9, 3, 9, 0)));
    assert.ok((0, cron_js_1.cronMatches)(range, at(2026, 9, 3, 17, 0)));
    assert.ok(!(0, cron_js_1.cronMatches)(range, at(2026, 9, 3, 18, 0)));
    const step = (0, cron_js_1.parseCron)('*/15 * * * *');
    for (const minute of [0, 15, 30, 45])
        assert.ok((0, cron_js_1.cronMatches)(step, at(2026, 9, 3, 1, minute)));
    assert.ok(!(0, cron_js_1.cronMatches)(step, at(2026, 9, 3, 1, 20)));
    const rangeStep = (0, cron_js_1.parseCron)('0 1-5/2 * * *');
    assert.deepEqual([...(0, cron_js_1.parseCron)('0 1-5/2 * * *').hour].sort((a, b) => a - b), [1, 3, 5]);
    assert.ok((0, cron_js_1.cronMatches)(rangeStep, at(2026, 9, 3, 3, 0)));
    assert.ok(!(0, cron_js_1.cronMatches)(rangeStep, at(2026, 9, 3, 4, 0)));
    // A bare value with a step runs to the field maximum, Vixie-style.
    assert.deepEqual([...(0, cron_js_1.parseCron)('5/20 * * * *').minute].sort((a, b) => a - b), [5, 25, 45]);
});
test('three-letter month and day names, and Sunday as both 0 and 7', () => {
    const named = (0, cron_js_1.parseCron)('0 0 1 jan mon');
    assert.ok(named.month.has(1));
    assert.ok(named.dayOfWeek.has(1));
    const sunday7 = (0, cron_js_1.parseCron)('0 0 * * 7');
    assert.ok(sunday7.dayOfWeek.has(0), '7 normalizes to Sunday');
    assert.ok(!sunday7.dayOfWeek.has(7));
    assert.ok((0, cron_js_1.cronMatches)(sunday7, at(2026, 9, 6, 0, 0)), '2026-09-06 is a Sunday');
    const weekdays = (0, cron_js_1.parseCron)('0 9 * * mon-fri');
    assert.ok((0, cron_js_1.cronMatches)(weekdays, at(2026, 9, 4, 9, 0)), 'Friday matches');
    assert.ok(!(0, cron_js_1.cronMatches)(weekdays, at(2026, 9, 5, 9, 0)), 'Saturday does not');
});
test('@ aliases expand to their expressions', () => {
    assert.ok((0, cron_js_1.cronMatches)((0, cron_js_1.parseCron)('@hourly'), at(2026, 9, 3, 13, 0)));
    assert.ok(!(0, cron_js_1.cronMatches)((0, cron_js_1.parseCron)('@hourly'), at(2026, 9, 3, 13, 1)));
    assert.ok((0, cron_js_1.cronMatches)((0, cron_js_1.parseCron)('@daily'), at(2026, 9, 3, 0, 0)));
    assert.ok((0, cron_js_1.cronMatches)((0, cron_js_1.parseCron)('@weekly'), at(2026, 9, 6, 0, 0)));
    assert.ok((0, cron_js_1.cronMatches)((0, cron_js_1.parseCron)('@monthly'), at(2026, 9, 1, 0, 0)));
    assert.ok(!(0, cron_js_1.cronMatches)((0, cron_js_1.parseCron)('@monthly'), at(2026, 9, 2, 0, 0)));
});
test('dom/dow use the either-rule only when both are restricted', () => {
    // Both restricted: the 1st OR any Monday.
    const either = (0, cron_js_1.parseCron)('0 0 1 * mon');
    assert.ok((0, cron_js_1.cronMatches)(either, at(2026, 9, 1, 0, 0)), 'the 1st (a Tuesday)');
    assert.ok((0, cron_js_1.cronMatches)(either, at(2026, 9, 7, 0, 0)), 'a Monday that is not the 1st');
    assert.ok(!(0, cron_js_1.cronMatches)(either, at(2026, 9, 8, 0, 0)));
    // Only dom restricted: dow is `*` and matches anyway.
    const domOnly = (0, cron_js_1.parseCron)('0 0 8 * *');
    assert.ok((0, cron_js_1.cronMatches)(domOnly, at(2026, 9, 8, 0, 0)));
    assert.ok(!(0, cron_js_1.cronMatches)(domOnly, at(2026, 9, 9, 0, 0)));
    // A `*`-rooted step keeps the star flag, so this ANDs rather than ORs.
    const starStep = (0, cron_js_1.parseCron)('0 0 */2 * mon');
    assert.ok((0, cron_js_1.cronMatches)(starStep, at(2026, 9, 7, 0, 0)), 'Monday the 7th is odd-numbered');
    assert.ok(!(0, cron_js_1.cronMatches)(starStep, at(2026, 9, 14, 0, 0)), 'Monday the 14th fails day-of-month');
});
test('rejects malformed cron expressions with Error', () => {
    for (const bad of ['', '   ', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *',
        '* * 0 * *', '* * * 13 *', '* * * * 8', 'x * * * *', '*/0 * * * *', '0 5-1 * * *',
        '@nope', '0 0 1 * mon/']) {
        assert.throws(() => (0, cron_js_1.parseCron)(bad), Error);
    }
    assert.throws(() => (0, cron_js_1.parseCron)('* * * * *'.replace('*', ',')), Error);
});
test('nextCronMatch walks forward across hour, day, month and year boundaries', () => {
    const hourly = (0, cron_js_1.parseCron)('0 * * * *');
    assert.deepEqual((0, cron_js_1.nextCronMatch)(hourly, at(2026, 9, 3, 13, 30)), at(2026, 9, 3, 14, 0));
    const daily = (0, cron_js_1.parseCron)('30 9 * * *');
    assert.deepEqual((0, cron_js_1.nextCronMatch)(daily, at(2026, 9, 3, 10, 0)), at(2026, 9, 4, 9, 30));
    // Crossing a month end (and February's short length).
    const firstOfMonth = (0, cron_js_1.parseCron)('0 0 1 * *');
    assert.deepEqual((0, cron_js_1.nextCronMatch)(firstOfMonth, at(2026, 1, 31, 23, 59)), at(2026, 2, 1, 0, 0));
    // Crossing a year end.
    const newYear = (0, cron_js_1.parseCron)('0 0 1 1 *');
    assert.deepEqual((0, cron_js_1.nextCronMatch)(newYear, at(2026, 12, 31, 12, 0)), at(2027, 1, 1, 0, 0));
    // Strictly after the given instant, never the instant itself.
    assert.deepEqual((0, cron_js_1.nextCronMatch)(daily, at(2026, 9, 3, 9, 30)), at(2026, 9, 4, 9, 30));
    // The 29th of February exists only in leap years — inside the 366-day
    // search window this resolves, and beyond it the walk gives up (below).
    assert.deepEqual((0, cron_js_1.nextCronMatch)((0, cron_js_1.parseCron)('0 0 29 2 *'), at(2027, 6, 1, 0, 0)), at(2028, 2, 29, 0, 0));
    assert.equal((0, cron_js_1.nextCronMatch)((0, cron_js_1.parseCron)('0 0 29 2 *'), at(2026, 3, 1, 0, 0)), null, 'more than a year out is reported as no next run');
});
test('an expression that can never fire returns null', () => {
    assert.equal((0, cron_js_1.nextCronMatch)((0, cron_js_1.parseCron)('0 0 30 2 *'), at(2026, 9, 3, 0, 0)), null);
    assert.equal((0, cron_js_1.nextCronMatch)((0, cron_js_1.parseCron)('0 0 31 4 *'), at(2026, 9, 3, 0, 0)), null);
});
