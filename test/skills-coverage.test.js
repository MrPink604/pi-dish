const test = require('node:test');
const assert = require('node:assert/strict');
const { projectSkillCoverage } = require('../lib/skills');

const read = (patch = {}) => ({
  skill: '/fixture/SKILL.md', file: 'SKILL.md', kind: 'read', ranges: 'all',
  ts: 100, sessionId: null, entryId: null, cwd: null, model: 'unknown', ...patch,
});

test('coverage counts overlapping ranges once per read and excludes old or untimed reads', () => {
  const coverage = projectSkillCoverage('# A\na\n## B\nb\n## C\nc\n', 100, [
    read({ ranges: [[1, 3], [2, 4], [3, 3]] }),
    read({ ranges: [[3, 3]] }),
    read({ truncatedTo: 2 }),
    read({ kind: 'explicit', ts: 99 }),
    read({ ts: null }),
    read({ kind: 'targeted', ts: 1 }),
  ]);
  assert.equal(coverage.numMapped, 3);
  assert.equal(coverage.excludedBeforeMtime, 2);
  assert.equal(coverage.targetedTouches, 1);
  assert.equal(coverage.flatFullRead, false);
  assert.equal(coverage.unreadTokensEst, 2);
  assert.deepEqual(coverage.sections.map(s => [s.heading, s.reads, s.fraction, s.neverRead]), [
    ['# A', 2, 2 / 3, false], ['## B', 2, 2 / 3, false], ['## C', 0, 0, true],
  ]);
  assert.deepEqual(coverage.sections.flatMap(s => s.lines.map(l => l.hits)), [2, 2, 2, 1, 0, 0, 0]);
});

test('coverage keeps whitespace intro out of sections without dropping it from full-read or unread accounting', () => {
  const content = ' \n# A\na\n';
  const partial = projectSkillCoverage(content, 100, [read({ ranges: [[2, -1]] })]);
  assert.equal(partial.lineCount, 4);
  assert.deepEqual(partial.sections.map(s => [s.startLine, s.endLine, s.reads]), [[2, 4, 1]]);
  assert.equal(partial.flatFullRead, false);
  assert.equal(partial.unreadTokensEst, 1);
  const explicit = projectSkillCoverage(content, 100, [read({ kind: 'explicit', ranges: null, truncatedTo: 0 })]);
  assert.equal(explicit.flatFullRead, true);
  assert.equal(explicit.unreadTokensEst, 0);
  assert.deepEqual(explicit.sections[0].lines.map(l => l.hits), [1, 1, 1]);
});
