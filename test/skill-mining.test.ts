/**
 * Unit tests for lib/skill-mining.js — the pure activation miner run inside the
 * session-index parse pass. Covers: read-range recording, truncation-notice
 * parsing, pi's skill-block (explicit /skill:) format, and bash-path
 * (targeted) classification including grep-style touches that carry no ranges.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert');
import {
  parseSkillBlockText,
  parseTruncationNotice,
  parseTargetedRanges,
  classifySkillPath,
  mineSkillsFromContent,
  mineSkillsFromEntries,
} from '../lib/skill-mining.js';
import type { SkillContext, SkillMiningOptions } from '../lib/skill-mining.js';
import type { SessionEntries } from '../lib/session-metadata-contracts.js';
import type { SkillActivation, SkillState, SkillProjection } from '../lib/session-index-data.js';

const SKILL = '/home/u/.pi/agent/skills/demo/SKILL.md';
const roots = new Map([['/home/u/.pi/agent/skills/demo', SKILL]]);
const ctx: SkillContext = { roots };

function jsonl(entries: SessionEntries) {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}
const session = { type: 'session', cwd: '/home/u/proj', timestamp: '2026-07-01T10:00:00.000Z' };
const modelChange = { type: 'model_change', provider: 'anthropic', modelId: 'claude-x' };
function assistantRead(id: string, args: unknown, ts = '2026-07-20T10:00:00.000Z') {
  return { type: 'message', id, timestamp: ts, message: { role: 'assistant', content: [
    { type: 'toolCall', id: 'tc_' + id, name: 'read', arguments: args },
  ] } };
}
function toolResult(callId: string, text: string) {
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
  const recs: SkillActivation[] = mineSkillsFromContent(jsonl([
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
  const recs: SkillActivation[] = mineSkillsFromContent(jsonl([
    session, assistantRead('e2', { path: SKILL }),
    toolResult('tc_e2', 'first line\n...\n\n[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]'),
  ]), { sessionId: 's2', skillCtx: ctx });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ranges, 'all');
  assert.equal(recs[0].truncatedTo, 2000);
});

test('mine: explicit /skill: invocation is detected via the skill-block format', () => {
  const expanded = `<skill name="demo" location="${SKILL}">\nReferences are relative to /home/u/.pi/agent/skills/demo.\n\nfull body here\n</skill>`;
  const recs: SkillActivation[] = mineSkillsFromContent(jsonl([
    session,
    { type: 'message', id: 'e3', timestamp: '2026-07-20T11:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: expanded }] } },
  ]), { sessionId: 's3', skillCtx: ctx });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'explicit');
  assert.equal(recs[0].skill, SKILL);
  assert.equal(recs[0].ranges, 'all');
});

test('mine: bash targeted access classifies grep (no ranges) vs sed (ranges)', () => {
  const recs: SkillActivation[] = mineSkillsFromContent(jsonl([
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
  assert.ok(grep);
  assert.ok(sed);
  assert.equal(grep.kind, 'targeted');
  assert.equal(grep.ranges, null, 'grep records no ranges');
  assert.equal(sed.kind, 'targeted');
  assert.deepEqual(sed.ranges, [[5, 20]]);
  assert.equal(sed.file, 'references/foo.md');
});

test('mine: a non-skill read produces no records', () => {
  const recs: SkillActivation[] = mineSkillsFromContent(jsonl([
    session, assistantRead('e6', { path: '/home/u/proj/src/index.js', offset: 1, limit: 40 }),
  ]), { sessionId: 's6', skillCtx: ctx });
  assert.equal(recs.length, 0);
});

test('mine: truncation evidence is batch-local until a full re-index', () => {
  const calls: SessionEntries = [
    session, modelChange,
    assistantRead('whole', { path: SKILL }),
    assistantRead('offset', { path: SKILL, offset: 7 }),
  ];
  const results: SessionEntries = [
    toolResult('tc_whole', '[Showing lines 1-13 of 50. Use offset=14 to continue.]'),
    toolResult('tc_offset', '[Showing lines 7-13 of 50. Use offset=14 to continue.]'),
  ];
  const options: SkillMiningOptions = { sessionId: 'batched', skillCtx: ctx };
  const first: SkillProjection = mineSkillsFromEntries(calls, options);
  assert.equal(first.records[0].ranges, 'all');
  assert.equal(Object.hasOwn(first.records[0], 'truncatedTo'), false);
  assert.deepEqual(first.records[1].ranges, [[7, -1]]);
  const state: SkillState | null = first.state;
  const appended: SkillProjection = mineSkillsFromEntries(results, { ...options, initialState: state });
  assert.deepEqual(appended.records, [], 'a later result does not manufacture another activation');
  assert.equal(Object.hasOwn(first.records[0], 'truncatedTo'), false, 'earlier records remain unchanged');
  assert.deepEqual(first.records[1].ranges, [[7, -1]]);

  const rebuilt: SkillProjection = mineSkillsFromEntries([...calls, ...results], options);
  assert.equal(rebuilt.records[0].truncatedTo, 13);
  assert.deepEqual(rebuilt.records[1].ranges, [[7, 13]]);
});

test('mine: tolerant physical framing preserves later cwd and model continuity', () => {
  const content = '\n{torn\n42\n' + jsonl([
    session, modelChange,
    { type: 'future_native_event', payload: { model: 'not-continuity' } },
    assistantRead('framed', { path: SKILL, offset: 7 }),
    toolResult('tc_framed', '[Showing lines 7-13 of 50. Use offset=14 to continue.]'),
  ]);
  const [record] = mineSkillsFromContent(content, { sessionId: 'framed', skillCtx: ctx });
  assert.ok(record);
  assert.equal(record.cwd, session.cwd, 'mining is not restricted to physical-first-line headers');
  assert.equal(record.model, 'anthropic/claude-x');
  assert.deepEqual(record.ranges, [[7, 13]]);
  assert.throws(() => mineSkillsFromContent('null\n' + content), TypeError);
});

test('mine: compaction archives are opaque while subsequent skill evidence survives', () => {
  const archive = { type: 'compaction', id: 'compact', parentId: null,
    preserveData: { archive: 'x'.repeat(70_000) } };
  const content = jsonl([session, archive, assistantRead('after-archive', { path: SKILL })]);
  const [record] = mineSkillsFromContent(content, { skillCtx: ctx });
  assert.ok(record);
  assert.equal(record.entryId, 'after-archive');
  assert.equal(record.skill, SKILL);
  assert.equal(record.cwd, session.cwd);
});
