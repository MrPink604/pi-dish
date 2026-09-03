/**
 * Unit tests for lib/cron.js — the hand-rolled five-field parser.
 *
 * Everything is local time, so the fixtures build dates with the local Date
 * constructor rather than ISO strings (which would be UTC).
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');

const { parseCron, cronMatches, nextCronMatch } = require('../lib/cron');

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0);

test('parses the plain fields and matches the exact minute', () => {
  const parsed = parseCron('30 9 * * *');
  assert.ok(cronMatches(parsed, at(2026, 9, 3, 9, 30)));
  assert.ok(!cronMatches(parsed, at(2026, 9, 3, 9, 31)));
  assert.ok(!cronMatches(parsed, at(2026, 9, 3, 10, 30)));
});

test('lists, ranges and steps', () => {
  const list = parseCron('0,15,45 * * * *');
  assert.ok(cronMatches(list, at(2026, 9, 3, 4, 15)));
  assert.ok(!cronMatches(list, at(2026, 9, 3, 4, 30)));

  const range = parseCron('0 9-17 * * *');
  assert.ok(cronMatches(range, at(2026, 9, 3, 9, 0)));
  assert.ok(cronMatches(range, at(2026, 9, 3, 17, 0)));
  assert.ok(!cronMatches(range, at(2026, 9, 3, 18, 0)));

  const step = parseCron('*/15 * * * *');
  for (const minute of [0, 15, 30, 45]) assert.ok(cronMatches(step, at(2026, 9, 3, 1, minute)));
  assert.ok(!cronMatches(step, at(2026, 9, 3, 1, 20)));

  const rangeStep = parseCron('0 1-5/2 * * *');
  assert.deepEqual([...parseCron('0 1-5/2 * * *').hour].sort((a, b) => a - b), [1, 3, 5]);
  assert.ok(cronMatches(rangeStep, at(2026, 9, 3, 3, 0)));
  assert.ok(!cronMatches(rangeStep, at(2026, 9, 3, 4, 0)));

  // A bare value with a step runs to the field maximum, Vixie-style.
  assert.deepEqual([...parseCron('5/20 * * * *').minute].sort((a, b) => a - b), [5, 25, 45]);
});

test('three-letter month and day names, and Sunday as both 0 and 7', () => {
  const named = parseCron('0 0 1 jan mon');
  assert.ok(named.month.has(1));
  assert.ok(named.dayOfWeek.has(1));

  const sunday7 = parseCron('0 0 * * 7');
  assert.ok(sunday7.dayOfWeek.has(0), '7 normalizes to Sunday');
  assert.ok(!sunday7.dayOfWeek.has(7));
  assert.ok(cronMatches(sunday7, at(2026, 9, 6, 0, 0)), '2026-09-06 is a Sunday');

  const weekdays = parseCron('0 9 * * mon-fri');
  assert.ok(cronMatches(weekdays, at(2026, 9, 4, 9, 0)), 'Friday matches');
  assert.ok(!cronMatches(weekdays, at(2026, 9, 5, 9, 0)), 'Saturday does not');
});

test('@ aliases expand to their expressions', () => {
  assert.ok(cronMatches(parseCron('@hourly'), at(2026, 9, 3, 13, 0)));
  assert.ok(!cronMatches(parseCron('@hourly'), at(2026, 9, 3, 13, 1)));
  assert.ok(cronMatches(parseCron('@daily'), at(2026, 9, 3, 0, 0)));
  assert.ok(cronMatches(parseCron('@weekly'), at(2026, 9, 6, 0, 0)));
  assert.ok(cronMatches(parseCron('@monthly'), at(2026, 9, 1, 0, 0)));
  assert.ok(!cronMatches(parseCron('@monthly'), at(2026, 9, 2, 0, 0)));
});

test('dom/dow use the either-rule only when both are restricted', () => {
  // Both restricted: the 1st OR any Monday.
  const either = parseCron('0 0 1 * mon');
  assert.ok(cronMatches(either, at(2026, 9, 1, 0, 0)), 'the 1st (a Tuesday)');
  assert.ok(cronMatches(either, at(2026, 9, 7, 0, 0)), 'a Monday that is not the 1st');
  assert.ok(!cronMatches(either, at(2026, 9, 8, 0, 0)));

  // Only dom restricted: dow is `*` and matches anyway.
  const domOnly = parseCron('0 0 8 * *');
  assert.ok(cronMatches(domOnly, at(2026, 9, 8, 0, 0)));
  assert.ok(!cronMatches(domOnly, at(2026, 9, 9, 0, 0)));

  // A `*`-rooted step keeps the star flag, so this ANDs rather than ORs.
  const starStep = parseCron('0 0 */2 * mon');
  assert.ok(cronMatches(starStep, at(2026, 9, 7, 0, 0)), 'Monday the 7th is odd-numbered');
  assert.ok(!cronMatches(starStep, at(2026, 9, 14, 0, 0)), 'Monday the 14th fails day-of-month');
});

test('invalid expressions throw a message worth returning as a 400', () => {
  for (const bad of ['', '   ', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *',
    '* * 0 * *', '* * * 13 *', '* * * * 8', 'x * * * *', '*/0 * * * *', '0 5-1 * * *',
    '@nope', '0 0 1 * mon/']) {
    assert.throws(() => parseCron(bad), /.+/, `"${bad}" must be rejected`);
  }
  assert.throws(() => parseCron('* * * * *'.replace('*', ',')), /empty|invalid/);
});

test('nextCronMatch walks forward across hour, day, month and year boundaries', () => {
  const hourly = parseCron('0 * * * *');
  assert.deepEqual(nextCronMatch(hourly, at(2026, 9, 3, 13, 30)), at(2026, 9, 3, 14, 0));

  const daily = parseCron('30 9 * * *');
  assert.deepEqual(nextCronMatch(daily, at(2026, 9, 3, 10, 0)), at(2026, 9, 4, 9, 30));

  // Crossing a month end (and February's short length).
  const firstOfMonth = parseCron('0 0 1 * *');
  assert.deepEqual(nextCronMatch(firstOfMonth, at(2026, 1, 31, 23, 59)), at(2026, 2, 1, 0, 0));

  // Crossing a year end.
  const newYear = parseCron('0 0 1 1 *');
  assert.deepEqual(nextCronMatch(newYear, at(2026, 12, 31, 12, 0)), at(2027, 1, 1, 0, 0));

  // Strictly after the given instant, never the instant itself.
  assert.deepEqual(nextCronMatch(daily, at(2026, 9, 3, 9, 30)), at(2026, 9, 4, 9, 30));

  // The 29th of February exists only in leap years — inside the 366-day
  // search window this resolves, and beyond it the walk gives up (below).
  assert.deepEqual(nextCronMatch(parseCron('0 0 29 2 *'), at(2027, 6, 1, 0, 0)), at(2028, 2, 29, 0, 0));
  assert.equal(nextCronMatch(parseCron('0 0 29 2 *'), at(2026, 3, 1, 0, 0)), null,
    'more than a year out is reported as no next run');
});

test('an expression that can never fire returns null', () => {
  assert.equal(nextCronMatch(parseCron('0 0 30 2 *'), at(2026, 9, 3, 0, 0)), null);
  assert.equal(nextCronMatch(parseCron('0 0 31 4 *'), at(2026, 9, 3, 0, 0)), null);
});
