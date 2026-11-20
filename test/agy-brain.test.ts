/**
 * Unit tests for read-only Antigravity brain directory parsing:
 * subagents, swarm state & board posts, background tasks & logs,
 * transcript projection (`agy-brain-v1`), and agy tool summaries.
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');

import { present, record, records } from './test-types.js';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-agy-brain-'));
const brainRoot = path.join(tmpHome, '.gemini', 'antigravity-cli', 'brain');
process.env.HOME = tmpHome;

const agyBrain: typeof import('../lib/agy-brain.js') = require('../lib/agy-brain.js');
const helperContent: typeof import('../lib/helper-content.js') = require('../lib/helper-content.js');

test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

function writeText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('parseAgyBrainEntries projects steps into Pi-v3 entries and suppresses noisy swarm wakes', () => {
  const convId = '11111111-1111-1111-1111-111111111111';
  const transcript = present(agyBrain.agyBrainTranscriptPath(convId), 'transcript path');
  writeJsonl(transcript, [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-19T10:00:00Z',
      content: 'Investigate auth bug',
    },
    {
      step_index: 1,
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-19T10:00:01Z',
      content: '[swarm] new board message #2 from @coordinator — call read_board',
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-19T10:00:02Z',
      model: 'gemini-4-carbon',
      input_tokens: 100,
      cache_read_tokens: 40,
      output_tokens: 25,
      thinking: 'Check login handler first',
      content: 'Inspecting login code.',
      tool_calls: [
        { name: 'read_file', args: { Path: JSON.stringify('/repo/auth.ts'), StartLine: '1' } },
        { name: 'run_command', args: { CommandLine: JSON.stringify('npm test'), WaitMsBeforeAsync: '5000' } },
      ],
    },
    {
      step_index: 3,
      source: 'SYSTEM',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-19T10:00:03Z',
      content: 'Created At: 2026-11-19T10:00:03Z\nCompleted At: 2026-11-19T10:00:03Z\nexport function login() {}',
    },
    {
      step_index: 4,
      source: 'SYSTEM',
      type: 'GENERIC',
      status: 'ERROR',
      created_at: '2026-11-19T10:00:04Z',
      content: 'Command exited with code 2.\n\nCommand output:\nauth test failed',
    },
  ]);

  const raw = fs.readFileSync(transcript, 'utf8');
  const parsed = records(agyBrain.parseAgyBrainEntries(raw, transcript));
  assert.equal(parsed[0]?.type, 'session');

  const messages = parsed.filter(e => e.type === 'message').map(e => record(e.message));
  // Noisy [swarm] wake suppressed: user + assistant + 2 toolResults = 4 messages.
  assert.equal(messages.length, 4);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].model, 'gemini-4-carbon');
  const usage = record(messages[1].usage);
  assert.equal(usage.input, 100);
  assert.equal(usage.cacheRead, 40);
  assert.equal(usage.output, 25);

  const blocks = records(messages[1].content);
  assert.equal(blocks[0]?.type, 'thinking');
  assert.equal(blocks[1]?.type, 'text');
  assert.equal(blocks[2]?.type, 'toolCall');
  assert.equal(blocks[2]?.name, 'read');
  assert.equal(record(blocks[2]?.arguments).path, '/repo/auth.ts');
  assert.equal(blocks[3]?.type, 'toolCall');
  assert.equal(blocks[3]?.name, 'bash');
  assert.equal(record(blocks[3]?.arguments).command, 'npm test');

  assert.equal(messages[2].role, 'toolResult');
  assert.equal(messages[2].toolName, 'read');
  assert.equal(messages[2].isError, false);
  assert.equal(messages[3].role, 'toolResult');
  assert.equal(messages[3].toolName, 'bash');
  assert.equal(messages[3].isError, true);
});

test('subagents, transcript activity, background tasks, task logs, and swarm state parse cleanly', () => {
  const coordId = '22222222-2222-2222-2222-222222222222';
  const workerId = '33333333-3333-3333-3333-333333333333';
  const subId = '44444444-4444-4444-4444-444444444444';
  const narratorId = '55555555-5555-5555-5555-555555555555';
  const coordSys = path.join(brainRoot, coordId, '.system_generated');

  // Coordinator transcript: running command, finished command, cron schedule, workflow.
  writeJsonl(present(agyBrain.agyBrainTranscriptPath(coordId), 'coord transcript'), [
    {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-19T12:00:00Z',
      model: 'gemini-4-carbon',
      tool_calls: [
        { name: 'run_command', args: { CommandLine: JSON.stringify('npm run watch'), toolSummary: JSON.stringify('Watch build'), WaitMsBeforeAsync: '500' } },
        { name: 'schedule', args: { CronExpression: JSON.stringify('*/5 * * * *'), Prompt: JSON.stringify('Check build health'), IsDaemon: 'true' } },
        { name: 'run_workflow', args: { Description: JSON.stringify('Fan-out audit') } },
      ],
    },
    {
      step_index: 2,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-19T12:00:01Z',
      content: `Tool is running as a background task with task id: ${coordId}/task-10\nTask logs are available at: ${path.join(coordSys, 'tasks', 'task-10.log')}\nLog output:\nstarting watcher...`,
    },
    {
      step_index: 3,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-19T12:00:02Z',
      content: `Scheduled recurring job with task id: ${coordId}/task-11`,
    },
    {
      step_index: 4,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-19T12:00:03Z',
      content: `Workflow started with task id: ${coordId}/task-12`,
    },
    {
      step_index: 5,
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-19T12:01:00Z',
      content: `Task id "${coordId}/task-12" finished with result:\nCommand exited with code 0.\n\nCommand output:\nAudit complete`,
    },
  ]);

  // Task logs: task-10 (running) and task-99 (orphaned log file).
  writeText(path.join(coordSys, 'tasks', 'task-10.log'), 'line 1\nline 2\nwatching...\n');
  writeText(path.join(coordSys, 'tasks', 'task-99.log'), 'orphan output\n');

  // Subagents: regular research subagent (working) + swarm worker (waiting on swarm_wait).
  writeJson(path.join(coordSys, 'subagents', `${subId}.json`), {
    conversationId: subId,
    subagentDescriptor: { typeName: 'research', role: 'Codebase Researcher' },
    state: 'SUBAGENT_STATE_ALIVE',
    spawnStepIndex: 6,
    workspaceUris: ['file:///repo/app'],
  });
  writeJsonl(present(agyBrain.agyBrainTranscriptPath(subId), 'sub transcript'), [
    {
      step_index: 0,
      type: 'PLANNER_RESPONSE',
      status: 'RUNNING',
      created_at: '2026-11-19T12:02:00Z',
      model: 'gemini-3.8-flash',
      tool_calls: [{ name: 'read_file', args: { Path: JSON.stringify('/repo/app/index.ts') } }],
    },
  ]);

  writeJson(path.join(coordSys, 'subagents', `${workerId}.json`), {
    conversationId: workerId,
    subagentDescriptor: { typeName: 'worker', role: 'Swarm Worker (builder)' },
    state: 'SUBAGENT_STATE_ALIVE',
    spawnStepIndex: 7,
    workspaceUris: ['file:///repo/app'],
  });
  writeJsonl(present(agyBrain.agyBrainTranscriptPath(workerId), 'worker transcript'), [
    {
      step_index: 0,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-19T12:03:00Z',
      model: 'gemini-4-carbon',
      tool_calls: [{ name: 'swarm_wait', args: {} }],
    },
  ]);

  // Swarm metadata, board, plan, and narrator view.json.
  writeJson(path.join(coordSys, 'swarm', 'swarm.json'), {
    version: 1, backend: 'local', swarm_id: 'sw-1', created_at: '2026-11-19T12:00:00Z',
  });
  writeJson(path.join(coordSys, 'swarm', 'members.json'), {
    title: 'Auth refactor',
    channels: { main: { topic: 'Main coordination' }, tests: { topic: 'Test results' } },
    members: {
      coordinator: { conversation_id: coordId, role: 'coordinator', applied_model: 'gemini-4-carbon', phase: 'waiting', last_read_seq: 2 },
      builder: { conversation_id: workerId, role: 'worker', applied_model: 'gemini-4-carbon', workspace_mode: 'share', phase: 'waiting', last_read_seq: 1 },
      narrator: { conversation_id: narratorId, role: 'worker', applied_model: 'gemini-3.8-flash', phase: 'waiting', last_read_seq: 2 },
    },
  });
  writeJsonl(path.join(coordSys, 'swarm', 'board.jsonl'), [
    { seq: 1, agent: 'coordinator', text: '@builder please fix auth.ts', time: '2026-11-19 12:00:10', kind: 'brief' },
    { seq: 2, agent: 'builder', text: '[done] @coordinator fixed auth.ts and ran suite', time: '2026-11-19 12:03:10', channel: 'tests' },
  ]);
  writeJson(path.join(coordSys, 'swarm', 'plan.json'), {
    goal: { title: 'Auth refactor', line: 'Eliminate token race' },
    threads: [{ title: 'Core fix', tasks: ['builder'] }],
    tasks: { builder: 'Fix login race' },
  });
  writeJson(path.join(brainRoot, narratorId, 'swarm_view', 'view.json'), {
    headline: 'Builder finished the auth fix',
    attention: [{ kind: 'fyi', severity: 'low', title: 'Ready to review', refs: [{ seq: 2 }] }],
  });

  // Subagent discovery & live state.
  const subs = agyBrain.readAgySubagentDescriptors(coordId);
  assert.equal(subs.length, 2);
  assert.equal(agyBrain.findAgySubagentParent(subId)?.parentId, coordId);
  assert.equal(agyBrain.isAgySubagentLive(coordId, subId), true);
  assert.equal(agyBrain.isAgySubagentLive(coordId, workerId), true);

  const subActivity = agyBrain.inspectAgyTranscriptActivity(subId);
  assert.equal(subActivity.working, true);
  assert.match(subActivity.currentAction ?? '', /read_file|read/);

  const workerActivity = agyBrain.inspectAgyTranscriptActivity(workerId);
  assert.equal(workerActivity.working, false);
  assert.equal(workerActivity.parkedOnBoard, true);

  assert.equal(agyBrain.hasActiveAgyBrainWork(coordId), true);

  // Background tasks & log tail + path traversal rejection.
  const tasks = agyBrain.readAgyBackgroundTasks(coordId, true);
  const byId = new Map(tasks.map(t => [t.id, t]));
  assert.equal(byId.get('task-10')?.status, 'running');
  assert.equal(byId.get('task-10')?.fullTaskId, `${coordId}/task-10`);
  assert.equal(byId.get('task-10')?.title, 'Watch build');
  assert.equal(byId.get('task-10')?.hasLog, true);
  assert.equal(byId.get('task-11')?.kind, 'schedule');
  assert.equal(byId.get('task-11')?.fullTaskId, `${coordId}/task-11`);
  assert.equal(byId.get('task-11')?.status, 'scheduled');
  assert.equal(byId.get('task-11')?.cron, '*/5 * * * *');
  assert.equal(byId.get('task-11')?.isDaemon, true);
  assert.equal(byId.get('task-12')?.kind, 'workflow');
  assert.equal(byId.get('task-12')?.fullTaskId, `${coordId}/task-12`);
  assert.equal(byId.get('task-12')?.status, 'completed');
  assert.equal(byId.get('task-12')?.exitCode, 0);
  assert.equal(byId.get('task-99')?.hasLog, true);
  assert.equal(byId.get('task-99')?.fullTaskId, `${coordId}/task-99`);

  // canControl distinguishes direct live sessions from child views observing a live coordinator.
  const workerTasks = agyBrain.readAgySessionTasks(workerId, { isActive: true, canControl: false });
  assert.equal(workerTasks.isActive, true);
  assert.equal(workerTasks.canControl, false);
  const coordTasks = agyBrain.readAgySessionTasks(coordId, { isActive: true, canControl: true });
  assert.equal(coordTasks.canControl, true);

  const log = agyBrain.readAgyTaskLog(coordId, 'task-10', 1024);
  assert.ok(log);
  assert.match(log.content, /watching\.\.\./);
  assert.equal(log.truncated, false);
  assert.equal(agyBrain.readAgyTaskLog(coordId, '../etc/passwd'), null);
  assert.equal(agyBrain.readAgyTaskLog(coordId, 'task-missing'), null);

  // Swarm state works from both coordinator and worker conversation IDs!
  assert.equal(agyBrain.findAgySwarmCoordinator(workerId), coordId);
  const sw = agyBrain.readAgySwarmState(workerId, { isActive: true, coordinatorTurnInProgress: true });
  assert.equal(sw.hasSwarm, true);
  assert.equal(sw.coordinatorTurnInProgress, true);
  assert.equal(sw.title, 'Auth refactor');
  assert.equal(sw.coordinatorNativeId, coordId);
  assert.equal(sw.head, 2);
  assert.equal(sw.posts.length, 2);
  assert.deepEqual(sw.posts[0].mentions, ['builder']);
  assert.deepEqual(sw.posts[1].tags, ['done']);
  assert.deepEqual(sw.posts[1].mentions, ['coordinator']);
  assert.equal(sw.channels.length, 2);
  assert.equal(sw.members.find(m => m.name === 'builder')?.unreadCount, 1);
  assert.equal(sw.narratorView?.headline, 'Builder finished the auth fix');
  assert.ok(sw.plan);

  const incremental = agyBrain.readAgySwarmState(coordId, { since: 1, isActive: true });
  assert.equal(incremental.posts.length, 1);
  assert.equal(incremental.posts[0].seq, 2);
});

test('getToolSummary formats Antigravity task, subagent, and swarm tools cleanly', () => {
  assert.equal(helperContent.getToolSummary('invoke_subagent', { Role: 'Codebase Researcher', TypeName: 'research' }), 'Codebase Researcher (research)');
  assert.equal(helperContent.getToolSummary('manage_subagents', { Action: 'list' }), 'list');
  assert.equal(helperContent.getToolSummary('manage_task', { Action: 'status', TaskId: 'conv/task-7' }), 'status task-7');
  assert.equal(helperContent.getToolSummary('schedule', { CronExpression: '*/5 * * * *', Prompt: 'Check tests' }), '*/5 * * * *: Check tests');
  assert.equal(helperContent.getToolSummary('schedule', { DurationSeconds: 30, Prompt: 'Wait' }), '30s: Wait');
  assert.equal(helperContent.getToolSummary('run_workflow', { Description: 'Audit modules' }), 'Audit modules');
  assert.equal(helperContent.getToolSummary('swarm', { action: 'add', name: 'builder', model: 'gemini-4-carbon' }), 'add @builder');
  assert.equal(helperContent.getToolSummary('post_message', { channel: 'tests', text: '[done] all green' }), '#tests [done] all green');
  assert.equal(helperContent.getToolSummary('read_board', { since: 4 }), 'since #4');
  assert.equal(helperContent.getToolSummary('swarm_wait', { since: 4 }), 'wait since #4');
  assert.equal(helperContent.getToolSummary('search_web', { query: 'ACP protocol' }), 'ACP protocol');
});

test('readAgyBrainArtifacts lists user-facing brain artifacts with sidecar metadata and ignores internals/symlinks', () => {
  const convId = '66666666-6666-6666-6666-666666666666';
  const dir = present(agyBrain.agyBrainDir(convId), 'brain dir');
  writeText(path.join(dir, 'implementation_plan.md'), '# Plan\n![diagram](arch.png)\n');
  writeJson(path.join(dir, 'implementation_plan.md.metadata.json'), {
    Summary: 'Step-by-step refactor plan',
    UserFacing: true,
    RequestFeedback: true,
    ArtifactType: 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN',
    updatedAt: '2026-11-19T15:00:00Z',
  });
  writeText(path.join(dir, 'arch.png'), 'pngbytes');
  writeText(path.join(dir, 'hidden.md'), 'internal');
  writeJson(path.join(dir, 'hidden.md.metadata.json'), { UserFacing: false, Summary: 'Hidden' });
  writeText(path.join(dir, '.system_generated', 'secret.md'), 'never expose');
  writeText(path.join(dir, 'scratch', 'tmp.md'), 'scratch file');
  const outside = path.join(tmpHome, 'outside.md');
  writeText(outside, 'outside');
  fs.symlinkSync(outside, path.join(dir, 'escape.md'));

  const artifacts = agyBrain.readAgyBrainArtifacts(convId);
  assert.deepEqual(artifacts.map(a => a.name).sort(), ['arch.png', 'implementation_plan.md']);
  const plan = artifacts.find(a => a.name === 'implementation_plan.md');
  assert.ok(plan);
  assert.equal(plan.kind, 'markdown');
  assert.equal(plan.summary, 'Step-by-step refactor plan');
  assert.equal(plan.requestFeedback, true);
  assert.equal(plan.artifactType, 'ARTIFACT_TYPE_IMPLEMENTATION_PLAN');

  const meta = agyBrain.readAgyBrainArtifactMeta(convId, path.join(dir, 'implementation_plan.md'));
  assert.equal(meta?.requestFeedback, true);
  assert.equal(agyBrain.readAgyBrainArtifactMeta(convId, path.join(dir, '.system_generated', 'secret.md')), null);
});

test('background task lifecycle ignores quoted foreign task ids, honors cancellations, server restarts, and early timer wakes', () => {
  const convId = '77777777-7777-7777-7777-777777777777';
  const otherId = '88888888-8888-8888-8888-888888888888';
  const subId = '99999999-9999-9999-9999-999999999999';
  const sysDir = path.join(brainRoot, convId, '.system_generated');

  writeJsonl(present(agyBrain.agyBrainTranscriptPath(convId), 'conv transcript'), [
    {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-20T10:00:00Z',
      tool_calls: [
        { name: 'run_command', args: { CommandLine: JSON.stringify('cat other.log'), toolSummary: JSON.stringify('Inspect other log'), WaitMsBeforeAsync: '5000' } },
        { name: 'run_command', args: { CommandLine: JSON.stringify('sleep 300'), toolSummary: JSON.stringify('Long task before restart'), WaitMsBeforeAsync: '500' } },
      ],
    },
    {
      // Synchronous command whose stdout quotes ANOTHER session's `task id: ...`
      step_index: 2,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-20T10:00:01Z',
      content: `Created At: 2026-11-20T10:00:00Z\nCompleted At: 2026-11-20T10:00:01Z\nCommand exited with code 0.\n\nCommand output:\nquoted task id: ${otherId}/task-161`,
    },
    {
      // Real background command that will be stopped by server restart notice
      step_index: 3,
      type: 'GENERIC',
      status: 'RUNNING',
      created_at: '2026-11-20T10:00:02Z',
      content: `Created At: 2026-11-20T10:00:02Z\nTool is running as a background task with task id: ${convId}/task-3\nTask Description: Long task before restart`,
    },
    {
      step_index: 4,
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-20T10:05:00Z',
      content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-20T10:05:00Z sender=system priority=MESSAGE_PRIORITY_LOW content=[Notice] All your subagents and background tasks have been stopped due to server restart.\n</SYSTEM_MESSAGE>`,
    },
    {
      step_index: 5,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-20T10:06:00Z',
      tool_calls: [
        { name: 'run_command', args: { CommandLine: JSON.stringify('sleep 99'), toolSummary: JSON.stringify('Canceled task'), WaitMsBeforeAsync: '500' } },
        { name: 'schedule', args: { DurationSeconds: '180', Prompt: JSON.stringify('Wake on timer'), TimerCondition: JSON.stringify('any') } },
      ],
    },
    {
      step_index: 6,
      type: 'GENERIC',
      status: 'RUNNING',
      created_at: '2026-11-20T10:06:01Z',
      content: `Created At: 2026-11-20T10:06:01Z\nTool is running as a background task with task id: ${convId}/task-6\nTask Description: Canceled task`,
    },
    {
      step_index: 7,
      type: 'GENERIC',
      status: 'RUNNING',
      created_at: '2026-11-20T10:06:02Z',
      content: `Created At: 2026-11-20T10:06:02Z\nTool is running as a background task with task id: ${convId}/task-7\nTask Description: Timer: 3m`,
    },
    {
      step_index: 8,
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-20T10:06:30Z',
      content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-20T10:06:30Z sender=${convId}/task-6 priority=MESSAGE_PRIORITY_LOW content=Task id "${convId}/task-6" was canceled with result:\nTool execution was canceled\n</SYSTEM_MESSAGE>`,
    },
  ]);

  // Subagent whose last step was a DONE tool result older than 5m (stale) or parked on schedule.
  writeJson(path.join(sysDir, 'subagents', `${subId}.json`), {
    conversationId: subId,
    subagentDescriptor: { typeName: 'research', role: 'Stale Researcher' },
    state: 'SUBAGENT_STATE_ALIVE',
    spawnStepIndex: 1,
    workspaceUris: ['file:///repo/app'],
  });
  const subTranscript = present(agyBrain.agyBrainTranscriptPath(subId), 'sub transcript');
  writeJsonl(subTranscript, [
    {
      step_index: 0,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-20T10:00:00Z',
      tool_calls: [{ name: 'send_message', args: { Message: JSON.stringify('done') } }],
    },
    {
      step_index: 1,
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-20T10:00:01Z',
      content: 'Message sent.',
    },
  ]);
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(subTranscript, tenMinAgo, tenMinAgo);

  const tasks = agyBrain.readAgyBackgroundTasks(convId, true);
  const byId = new Map(tasks.map(t => [t.id, t]));
  assert.equal(byId.has('task-161'), false, 'stdout quoting a foreign task id is never tracked as a running task');
  assert.equal(byId.get('task-3')?.status, 'killed', 'server restart notice terminates earlier running tasks');
  assert.equal(byId.get('task-6')?.status, 'killed', 'was canceled SYSTEM_MESSAGE marks task killed');
  assert.equal(byId.get('task-7')?.status, 'completed', 'subsequent SYSTEM_MESSAGE cancels TimerCondition=any one-shot timer');
  assert.equal(agyBrain.inspectAgyTranscriptActivity(subId).working, false, 'stale DONE tail step does not appear stuck working');
  assert.equal(agyBrain.hasActiveAgyBrainWork(convId), false, 'no false active brain work remains');

  // A subagent sleeping on `schedule` is not actively working either.
  writeJsonl(subTranscript, [
    {
      step_index: 0,
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-20T10:10:00Z',
      tool_calls: [{ name: 'schedule', args: { DurationSeconds: '120', Prompt: JSON.stringify('poll later') } }],
    },
    {
      step_index: 1,
      type: 'GENERIC',
      status: 'RUNNING',
      created_at: '2026-11-20T10:10:01Z',
      content: `Tool is running as a background task with task id: ${subId}/task-1`,
    },
  ]);
  const schedAct = agyBrain.inspectAgyTranscriptActivity(subId);
  assert.equal(schedAct.working, false, 'subagent sleeping on a schedule timer is not reported as working');
  assert.equal(schedAct.currentAction, 'Waiting on schedule');
});
