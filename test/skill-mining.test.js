/**
 * Unit tests for lib/skill-mining.js — the pure activation miner run inside the
 * session-index parse pass. Covers: read-range recording, truncation-notice
 * parsing, pi's skill-block (explicit /skill:) format, and bash-path
 * (targeted) classification including grep-style touches that carry no ranges.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  parseSkillBlockText,
  parseTruncationNotice,
  parseTargetedRanges,
  classifySkillPath,
  mineSkillsFromContent,
} = require('../lib/skill-mining.js');

const SKILL = '/home/u/.pi/agent/skills/demo/SKILL.md';
const roots = new Map([['/home/u/.pi/agent/skills/demo', SKILL]]);
const ctx = { roots };

function jsonl(entries) {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}
const session = { type: 'session', cwd: '/home/u/proj', timestamp: '2026-07-01T10:00:00.000Z' };
const modelChange = { type: 'model_change', provider: 'anthropic', modelId: 'claude-x' };
function assistantRead(id, args, ts = '2026-07-20T10:00:00.000Z') {
  return { type: 'message', id, timestamp: ts, message: { role: 'assistant', content: [
    { type: 'toolCall', id: 'tc_' + id, name: 'read', arguments: args },
  ] } };
}
function toolResult(callId, text) {
  return { type: 'message', message: { role: 'toolResult', toolCallId: callId, content: [{ type: 'text', text }] } };
}

test('parseSkillBlockText matches pi\'s exact skill-block format', () => {
  const text = `<skill name="demo" location="${SKILL}">\nReferences are relative to /home/u/.pi/agent/skills/demo.\n\nbody line\n</skill>`;
  const parsed = parseSkillBlockText(text);
  assert.ok(parsed);
  assert.equal(parsed.name, 'demo');
  assert.equal(parsed.location, SKILL);
  assert.equal(parseSkillBlockText('not a skill block'), null);
  assert.equal(parseSkillBlockText('<skill name="x">missing location</skill>'), null);
});

test('parseTruncationNotice reads both the live and documented forms', () => {
  assert.equal(parseTruncationNotice('...\n\n[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]'), 2000);
  assert.equal(parseTruncationNotice('body\n[Truncated: showing 2000 of 5000 lines (2000 line limit)]'), 2000);
  assert.equal(parseTruncationNotice('body\n[Truncated: 1800 lines shown (50KB limit)]'), 1800);
  assert.equal(parseTruncationNotice('no notice here'), null);
});

test('parseTargetedRanges parses cat/sed ranges but never fabricates for grep', () => {
  assert.deepEqual(parseTargetedRanges("sed -n '10,50p' " + SKILL, SKILL), [[10, 50]]);
  assert.deepEqual(parseTargetedRanges("sed -n '12p' " + SKILL, SKILL), [[12, 12]]);
  assert.equal(parseTargetedRanges('cat ' + SKILL, SKILL), 'all');
  assert.equal(parseTargetedRanges('grep -n foo ' + SKILL, SKILL), null, 'grep is a touch, not line data');
  assert.equal(parseTargetedRanges('rg pattern ' + SKILL, SKILL), null);
});

test('classifySkillPath: SKILL.md by basename, and files under a known root', () => {
  assert.deepEqual(classifySkillPath(SKILL, ctx), { skill: SKILL, file: 'SKILL.md' });
  assert.deepEqual(classifySkillPath('/home/u/.pi/agent/skills/demo/references/foo.md', ctx),
    { skill: SKILL, file: 'references/foo.md' });
  assert.equal(classifySkillPath('/etc/passwd', ctx), null);
  // basename SKILL.md counts even without a matching root
  assert.deepEqual(classifySkillPath('/somewhere/else/SKILL.md', { roots: new Map() }),
    { skill: '/somewhere/else/SKILL.md', file: 'SKILL.md' });
});

test('mine: ranged read records offset/limit as a line range', () => {
  const recs = mineSkillsFromContent(jsonl([
    session, modelChange, assistantRead('e1', { path: SKILL, offset: 1, limit: 250 }),
  ]), { sessionId: 's1', skillCtx: ctx });
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].ranges, [[1, 250]]);
  assert.equal(recs[0].kind, 'read');
  assert.equal(recs[0].skill, SKILL);
  assert.equal(recs[0].model, 'anthropic/claude-x');
  assert.equal(recs[0].cwd, '/home/u/proj');
  assert.equal(recs[0].sessionId, 's1');
  assert.equal(recs[0].entryId, 'e1');
});

test('mine: un-ranged read records ranges:"all" + truncatedTo from the result', () => {
  const recs = mineSkillsFromContent(jsonl([
    session, assistantRead('e2', { path: SKILL }),
    toolResult('tc_e2', 'first line\n...\n\n[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]'),
  ]), { sessionId: 's2', skillCtx: ctx });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ranges, 'all');
  assert.equal(recs[0].truncatedTo, 2000);
});

test('mine: explicit /skill: invocation is detected via the skill-block format', () => {
  const expanded = `<skill name="demo" location="${SKILL}">\nReferences are relative to /home/u/.pi/agent/skills/demo.\n\nfull body here\n</skill>`;
  const recs = mineSkillsFromContent(jsonl([
    session,
    { type: 'message', id: 'e3', timestamp: '2026-07-20T11:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: expanded }] } },
  ]), { sessionId: 's3', skillCtx: ctx });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'explicit');
  assert.equal(recs[0].skill, SKILL);
  assert.equal(recs[0].ranges, 'all');
});

test('mine: bash targeted access classifies grep (no ranges) vs sed (ranges)', () => {
  const recs = mineSkillsFromContent(jsonl([
    session,
    { type: 'message', id: 'e4', timestamp: '2026-07-20T12:00:00.000Z', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'b1', name: 'bash', arguments: { command: "grep -n pattern " + SKILL } },
    ] } },
    { type: 'message', id: 'e5', timestamp: '2026-07-20T12:01:00.000Z', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'b2', name: 'bash', arguments: { command: "sed -n '5,20p' /home/u/.pi/agent/skills/demo/references/foo.md" } },
    ] } },
  ]), { sessionId: 's4', skillCtx: ctx });
  const grep = recs.find(r => r.entryId === 'e4');
  const sed = recs.find(r => r.entryId === 'e5');
  assert.equal(grep.kind, 'targeted');
  assert.equal(grep.ranges, null, 'grep records no ranges');
  assert.equal(sed.kind, 'targeted');
  assert.deepEqual(sed.ranges, [[5, 20]]);
  assert.equal(sed.file, 'references/foo.md');
});

test('mine: a non-skill read produces no records', () => {
  const recs = mineSkillsFromContent(jsonl([
    session, assistantRead('e6', { path: '/home/u/proj/src/index.js', offset: 1, limit: 40 }),
  ]), { sessionId: 's6', skillCtx: ctx });
  assert.equal(recs.length, 0);
});
