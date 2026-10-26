import test = require('node:test');
import assert = require('node:assert/strict');
import { createToolEventStream, projectToolEvent } from '../lib/tool-event-stream.js';

const update = (id: string, text: string) => ({ toolCallId: id, toolName: 'task', partialResult: { content: [{ type: 'text', text }] } });

test('worker bursts retain each tool latest output and flush before completion', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const frames: Array<{ event: string; data: unknown }> = [];
  const stream = createToolEventStream((event, data) => frames.push({ event, data }));
  t.after(() => stream.clear());
  stream.push('tool_execution_update', update('a', 'first'));
  stream.push('tool_execution_update', update('b', 'other'));
  stream.push('tool_execution_update', update('a', 'superseded'));
  stream.push('tool_execution_update', update('a', 'latest'));
  t.mock.timers.tick(49);
  assert.deepEqual(frames.map(frame => frame.data), [projectToolEvent('tool_execution_update', update('a', 'first')), projectToolEvent('tool_execution_update', update('b', 'other'))]);
  stream.push('tool_execution_end', { toolCallId: 'a', result: { content: [{ type: 'text', text: 'done' }] }, isError: false });
  assert.deepEqual(frames.slice(2), [
    { event: 'tool_execution_update', data: projectToolEvent('tool_execution_update', update('a', 'latest')) },
    { event: 'tool_execution_end', data: projectToolEvent('tool_execution_end', { toolCallId: 'a', result: { content: [{ type: 'text', text: 'done' }] }, isError: false }) },
  ]);
  t.mock.timers.tick(100);
  assert.equal(frames.length, 4);
});

test('steady updates deliver the latest snapshot every window and retire stale work', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const texts: string[] = [];
  const stream = createToolEventStream((_event, value) => {
    const data = value as { partialResult: { content: Array<{ text: string }> } };
    texts.push(data.partialResult.content[0]!.text);
  });
  t.after(() => stream.clear());
  stream.push('tool_execution_update', update('a', 'first'));
  stream.push('tool_execution_update', update('a', 'second'));
  t.mock.timers.tick(50);
  stream.push('tool_execution_update', update('a', 'third'));
  t.mock.timers.tick(50);
  assert.deepEqual(texts, ['first', 'second', 'third']);
  stream.push('tool_execution_update', update('a', 'old session'));
  stream.clear();
  t.mock.timers.tick(100);
  assert.deepEqual(texts, ['first', 'second', 'third']);
  stream.push('tool_execution_update', update('a', 'new session'));
  assert.equal(texts.at(-1), 'new session');
});

test('run boundaries flush pending worker output before ending the run', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const boundary of ['turn_end', 'agent_end']) {
    const frames: Array<{ event: string; data: unknown }> = [];
    const stream = createToolEventStream((event, data) => frames.push({ event, data }));
    stream.push('tool_execution_update', update('a', 'first'));
    stream.push('tool_execution_update', update('a', 'last'));
    stream.push(boundary, {});
    assert.deepEqual(frames.slice(1), [
      { event: 'tool_execution_update', data: projectToolEvent('tool_execution_update', update('a', 'last')) },
      { event: boundary, data: {} },
    ]);
    stream.clear();
  }
});

test('tool projection preserves images and errors without serializing native worker traces', () => {
  const content = [{ type: 'text', text: 'output' }, { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }];
  const native = { content, details: { get trace() { throw new Error('native trace must not be read'); } } };
  const projected = projectToolEvent('tool_execution_end', { toolCallId: 'a', toolName: 'task', args: { tasks: [] }, isError: true, result: native });
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), { toolCallId: 'a', toolName: 'task', args: { tasks: [] }, isError: true, result: { content } });
  assert.equal(native.content, content);
});

test('tool projection keeps eval intent and code without reading result details', () => {
  const native = { content: [{ type: 'text', text: '1' }], details: { get trace() { throw new Error('native trace must not be read'); } } };
  const projected = projectToolEvent('tool_execution_start', {
    toolCallId: 'e', toolName: 'eval', args: { language: 'py', code: 'print(1)' }, intent: 'print one', startedAt: 1,
    partialResult: native,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), {
    toolCallId: 'e', toolName: 'eval', args: { language: 'py', code: 'print(1)' }, intent: 'print one', startedAt: 1,
  });
});

test('bash, wait and eval results keep only the timing, exit, job and cell fields their panels format', () => {
  const bash = projectToolEvent('tool_execution_end', { toolCallId: 'b', toolName: 'bash', isError: false, result: { content: [],
    details: { wallTimeMs: 12.5, exitCode: 2, timeoutSeconds: 1800, wallTimeNoticeEmitted: false, meta: { big: true }, async: { state: 'running', jobId: 'bg_1', type: 'bash' } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(bash)).result.details, { wallTimeMs: 12.5, exitCode: 2, timeoutSeconds: 1800, async: { jobId: 'bg_1' } });
  const wait = projectToolEvent('tool_execution_update', { toolCallId: 'w', toolName: 'wait', isError: false, partialResult: { content: [],
    details: { op: 'wait', meta: { source: 'report' }, jobs: [{ id: 'bg_1', type: 'bash', status: 'running', label: 'npm test', durationMs: 5, widget: { blocks: [] }, resultText: 'x'.repeat(9000) }, 'bad'] } } });
  const jobs = JSON.parse(JSON.stringify(wait)).partialResult.details.jobs;
  assert.deepEqual(jobs.map((job: Record<string, unknown>) => Object.keys(job)), [['id', 'type', 'status', 'label', 'durationMs', 'resultText']]);
  assert.equal(jobs[0].resultText.length, 8000);
  const evalCell = { index: 0, title: 't', code: 'print(1)', output: '1', status: 'complete', exitCode: 0, durationMs: 9,
    statusEvents: [{ op: 'read', path: 'p'.repeat(400), chars: 5, preview: 'large', matches: ['a'] }] };
  const single = JSON.parse(JSON.stringify(projectToolEvent('tool_execution_end', { toolCallId: 'e', toolName: 'eval', isError: false, result: { content: [], details: { cells: [evalCell], jsonOutputs: [{}] } } })));
  assert.deepEqual(single.result.details, { cells: [{ index: 0, title: 't', status: 'complete', exitCode: 0, durationMs: 9, statusEvents: [{ op: 'read', path: 'p'.repeat(300), chars: 5 }] }] });
  const split = JSON.parse(JSON.stringify(projectToolEvent('tool_execution_end', { toolCallId: 'e', toolName: 'eval', isError: false, result: { content: [], details: { cells: [evalCell, evalCell] } } })));
  assert.equal(split.result.details.cells[1].output, '1');
});
