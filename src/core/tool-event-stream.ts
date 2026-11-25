import { finite, record } from './helper-values';

const BASH_DETAIL_KEYS = ['wallTimeMs', 'exitCode', 'timedOut', 'timeoutSeconds', 'timeoutDisabled'] as const;
const WAIT_JOB_KEYS = ['id', 'type', 'status', 'label', 'durationMs', 'exitCode', 'agentUrlId'] as const;
const OUTPUT_TEXT_LIMIT = 8000;
const EVAL_CELL_KEYS = ['index', 'title', 'language', 'status', 'exitCode', 'durationMs'] as const;
const EVAL_EVENT_KEYS = ['op', 'detail', 'path', 'cmd', 'args', 'key', 'action', 'chars', 'bytes', 'count', 'error', 'exit_code'] as const;
const EVAL_EVENT_LIMIT = 50;
const EVAL_EVENT_TEXT_LIMIT = 300;
const CODEMODE_CALL_LIMIT = 100;
const CODEMODE_CALL_TEXT_LIMIT = 500;
const TASK_SUBAGENT_LIMIT = 64;
const TASK_ROW_SCAN_LIMIT = 256;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface TaskSubagentProjection {
  readonly id: string;
  readonly index?: number;
  readonly agent?: string;
  readonly status?: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly sessionId?: string;
}

export interface ExtractTaskSubagentsOptions {
  /** Allow bridge-projected `details.subagents` (live SSE wire); persisted JSONL reads only raw OMP `progress`/`results`. */
  readonly allowProjectedSubagents?: boolean;
}

export interface ToolEventProjectionOptions {
  /** Resolves an OMP task subagent id (`<parent>/<id>.jsonl`) to its verified canonical route id (`~sk1_...`). */
  readonly resolveTaskSubagent?: (agentId: string) => string | null;
  /** Creates one frame-scoped resolver per emitted snapshot (called only after coalescing). */
  readonly resolveTaskSubagentsFrame?: () => (agentId: string) => string | null;
}

function validTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && TASK_ID_RE.test(value) && !value.includes('..') && value !== 'changes';
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, max) : undefined;
}

/**
 * Project OMP `task` subagent identities from structured OMP details (`progress`/`results`)
 * or bridge-projected `details.subagents` (when `allowProjectedSubagents` is enabled).
 * Untrusted incoming `sessionId` / route fields are ALWAYS stripped; routes are attached
 * strictly from `resolveTaskSubagent` after applying the 64-entry cap, with misses memoized
 * within the frame. Never walks traces, outputs, text content, or arbitrary keys on `details`.
 */
export function extractTaskSubagents(
  details: unknown,
  resolveTaskSubagent?: (agentId: string) => string | null,
  options: ExtractTaskSubagentsOptions = {},
): TaskSubagentProjection[] {
  if (!record(details)) return [];
  const allowProjected = options.allowProjectedSubagents !== false;
  const byId = new Map<string, TaskSubagentProjection>();
  const order: string[] = [];
  const upsert = (entry: TaskSubagentProjection) => {
    const existing = byId.get(entry.id);
    if (!existing) {
      if (order.length >= TASK_SUBAGENT_LIMIT) return;
      order.push(entry.id);
    }
    const merged: TaskSubagentProjection = {
      id: entry.id,
      ...(entry.index !== undefined ? { index: entry.index } : existing?.index !== undefined ? { index: existing.index } : {}),
      ...(entry.agent ? { agent: entry.agent } : existing?.agent ? { agent: existing.agent } : {}),
      ...(entry.status ? { status: entry.status } : existing?.status ? { status: existing.status } : {}),
      ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : existing?.exitCode !== undefined ? { exitCode: existing.exitCode } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : existing?.durationMs !== undefined ? { durationMs: existing.durationMs } : {}),
    };
    byId.set(entry.id, merged);
  };

  // 1. Bridge-projected hop (live wire): preserve bounded metadata, ALWAYS strip any incoming route/sessionId.
  if (allowProjected && Array.isArray(details.subagents)) {
    const limit = Math.min(details.subagents.length, TASK_ROW_SCAN_LIMIT);
    for (let i = 0; i < limit; i++) {
      const item = details.subagents[i];
      if (!record(item) || !validTaskId(item.id)) continue;
      upsert({
        id: item.id,
        ...(finite(item.index) && Number.isInteger(item.index) && item.index >= 0 ? { index: item.index } : {}),
        ...(boundedString(item.agent, 64) ? { agent: boundedString(item.agent, 64) } : {}),
        ...(boundedString(item.status, 32) ? { status: boundedString(item.status, 32) } : {}),
        ...(finite(item.exitCode) ? { exitCode: item.exitCode } : {}),
        ...(finite(item.durationMs) && item.durationMs >= 0 ? { durationMs: item.durationMs } : {}),
      });
    }
  }
  // 2. Raw OMP `progress` rows (running sync/batch updates, async background spawns, error fallback).
  if (Array.isArray(details.progress)) {
    const limit = Math.min(details.progress.length, TASK_ROW_SCAN_LIMIT);
    for (let i = 0; i < limit; i++) {
      const item = details.progress[i];
      if (!record(item) || !validTaskId(item.id)) continue;
      upsert({
        id: item.id,
        ...(finite(item.index) && Number.isInteger(item.index) && item.index >= 0 ? { index: item.index } : {}),
        ...(boundedString(item.agent, 64) ? { agent: boundedString(item.agent, 64) } : {}),
        ...(boundedString(item.status, 32) ? { status: boundedString(item.status, 32) } : {}),
        ...(finite(item.durationMs) && item.durationMs >= 0 ? { durationMs: item.durationMs } : {}),
      });
    }
  }
  // 3. Raw OMP `results` rows (completed/failed sync runs override status/exitCode/durationMs).
  if (Array.isArray(details.results)) {
    const limit = Math.min(details.results.length, TASK_ROW_SCAN_LIMIT);
    for (let i = 0; i < limit; i++) {
      const item = details.results[i];
      if (!record(item) || !validTaskId(item.id)) continue;
      const exitCode = finite(item.exitCode) ? item.exitCode : undefined;
      const status = item.aborted === true
        ? 'aborted'
        : (exitCode !== undefined && exitCode !== 0) || typeof item.error === 'string' && item.error
          ? 'failed'
          : 'completed';
      upsert({
        id: item.id,
        ...(finite(item.index) && Number.isInteger(item.index) && item.index >= 0 ? { index: item.index } : {}),
        ...(boundedString(item.agent, 64) ? { agent: boundedString(item.agent, 64) } : {}),
        status,
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(finite(item.durationMs) && item.durationMs >= 0 ? { durationMs: item.durationMs } : {}),
      });
    }
  }

  let out = order.map(id => byId.get(id)!);
  if (out.length > 1 && out.every(item => item.index !== undefined)) {
    out.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  if (resolveTaskSubagent && out.length) {
    const memo = new Map<string, string | null>();
    out = out.map(item => {
      let resolved: string | null;
      if (memo.has(item.id)) resolved = memo.get(item.id)!;
      else {
        resolved = resolveTaskSubagent(item.id) || null;
        memo.set(item.id, resolved);
      }
      return resolved ? { ...item, sessionId: resolved } : item;
    });
  }
  return out;
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

const CODEMODE_ARG_KEYS_LIMIT = 8;
const CODEMODE_ARG_KEY_LIMIT = 64;
const CODEMODE_ARG_VALUE_LIMIT = 200;

/** Bounded shallow JSON preview for object-shaped codemode call args, capped before stringifying. */
function summarizeCodemodeObjectArgs(args: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  let budget = CODEMODE_CALL_TEXT_LIMIT;
  let keys: string[];
  try { keys = Object.keys(args); } catch { return undefined; }
  for (let i = 0; i < keys.length && parts.length < CODEMODE_ARG_KEYS_LIMIT && budget > 0; i++) {
    const rawKey = keys[i]!;
    let value: unknown;
    try { value = args[rawKey]; } catch { continue; }
    let rendered: string;
    if (typeof value === 'string') rendered = JSON.stringify(value.slice(0, Math.min(budget, CODEMODE_ARG_VALUE_LIMIT)));
    else if (typeof value === 'number') rendered = Number.isFinite(value) ? String(value) : 'null';
    else if (typeof value === 'boolean' || value === null) rendered = String(value);
    else if (Array.isArray(value)) rendered = JSON.stringify(`[${value.length} items]`);
    else if (record(value)) rendered = '"{…}"';
    else continue;
    const entry = `${JSON.stringify(rawKey.slice(0, CODEMODE_ARG_KEY_LIMIT))}:${rendered}`;
    parts.push(entry);
    budget -= entry.length + 1;
  }
  if (!parts.length) return undefined;
  return `{${parts.join(',')}}`.slice(0, CODEMODE_CALL_TEXT_LIMIT);
}

function resolveFrameOf(options?: ToolEventProjectionOptions): ((agentId: string) => string | null) | undefined {
  return options?.resolveTaskSubagentsFrame ? options.resolveTaskSubagentsFrame() : options?.resolveTaskSubagent;
}

/**
 * The few result details the browser formats: OMP bash timing/exit/deadline,
 * wait job rows, eval cell status/activity, codemode call rows and task
 * subagent links. Everything else in result.details (task traces, widgets,
 * previews) stays on the server.
 */
function projectToolDetails(
  toolName: unknown,
  details: unknown,
  options?: ToolEventProjectionOptions,
): Record<string, unknown> | undefined {
  if (toolName === 'task') {
    const subagents = extractTaskSubagents(details, resolveFrameOf(options), { allowProjectedSubagents: true });
    return subagents.length ? { subagents } : undefined;
  }
  if (!record(details)) return undefined;
  if (toolName === 'bash') {
    const out = pick(details, BASH_DETAIL_KEYS);
    if (record(details.async) && typeof details.async.jobId === 'string') out.async = { jobId: details.async.jobId };
    return Object.keys(out).length ? out : undefined;
  }
  if (toolName === 'wait' && Array.isArray(details.jobs)) {
    return { jobs: details.jobs.flatMap((job: unknown) => {
      if (!record(job)) return [];
      const out = pick(job, WAIT_JOB_KEYS);
      for (const key of ['resultText', 'errorText'] as const) {
        if (typeof job[key] === 'string') out[key] = job[key].slice(0, OUTPUT_TEXT_LIMIT);
      }
      return [out];
    }) };
  }
  if (toolName === 'codemode' && Array.isArray(details.calls)) {
    const callsTruncated = details.calls.length > CODEMODE_CALL_LIMIT;
    const calls = details.calls.slice(0, CODEMODE_CALL_LIMIT).flatMap((call: unknown) => {
      if (!record(call) || typeof call.name !== 'string' || !call.name) return [];
      const out: Record<string, unknown> = {};
      if (finite(call.id)) out.id = call.id;
      else if (typeof call.id === 'string') out.id = call.id.slice(0, CODEMODE_CALL_TEXT_LIMIT);
      out.name = call.name.slice(0, CODEMODE_CALL_TEXT_LIMIT);
      if (typeof call.args === 'string') out.args = call.args.slice(0, CODEMODE_CALL_TEXT_LIMIT);
      else if (record(call.args)) {
        const preview = summarizeCodemodeObjectArgs(call.args);
        if (preview) out.args = preview;
      }
      if (typeof call.status === 'string') out.status = call.status.slice(0, CODEMODE_CALL_TEXT_LIMIT);
      if (finite(call.durationMs)) out.durationMs = call.durationMs;
      if (typeof call.error === 'string') out.error = call.error.slice(0, CODEMODE_CALL_TEXT_LIMIT);
      return [out];
    });
    return callsTruncated ? { calls, callsTruncated: true } : { calls };
  }
  if (toolName === 'eval' && Array.isArray(details.cells)) {
    const multi = details.cells.length > 1;
    return { cells: details.cells.flatMap((cell: unknown) => {
      if (!record(cell)) return [];
      const out = pick(cell, EVAL_CELL_KEYS);
      // A single cell's output is the result content already; only split cells need their own.
      if (multi && typeof cell.output === 'string') out.output = cell.output.slice(0, OUTPUT_TEXT_LIMIT);
      if (Array.isArray(cell.statusEvents)) {
        out.statusEvents = cell.statusEvents.slice(0, EVAL_EVENT_LIMIT).flatMap((event: unknown) => {
          if (!record(event)) return [];
          const kept: Record<string, unknown> = {};
          for (const key of EVAL_EVENT_KEYS) {
            const value = event[key];
            if (typeof value === 'string') kept[key] = value.slice(0, EVAL_EVENT_TEXT_LIMIT);
            else if (typeof value === 'number' || typeof value === 'boolean') kept[key] = value;
          }
          return [kept];
        });
      }
      return [out];
    }) };
  }
  return undefined;
}

/** Tool panels consume content plus projected details, not harness-native traces in result.details. */
export function projectToolEvent(event: string, value: unknown, options?: ToolEventProjectionOptions): unknown {
  if (!event.startsWith('tool_execution_') || !record(value)) return value;
  const { toolCallId, toolName, args, startedAt, isError } = value;
  const intent = typeof value.intent === 'string' && value.intent ? value.intent : undefined;
  const result = (value: unknown) => {
    if (!record(value)) return value;
    const details = projectToolDetails(toolName, value.details, options);
    return details ? { content: value.content, details } : { content: value.content };
  };
  return {
    toolCallId, toolName, args, startedAt, isError,
    ...(intent ? { intent } : {}),
    ...(event === 'tool_execution_update' ? { partialResult: result(value.partialResult) } : {}),
    ...(event === 'tool_execution_end' ? { result: result(value.result) } : {}),
  };
}

/** Resolve verified task subagent routes on a projected snapshot right before emission. */
function resolveProjectedTaskEvent(event: string, data: unknown, options?: ToolEventProjectionOptions): unknown {
  if (!options?.resolveTaskSubagent && !options?.resolveTaskSubagentsFrame) return data;
  if (!record(data) || data.toolName !== 'task') return data;
  const slotKey = event === 'tool_execution_update' ? 'partialResult'
    : event === 'tool_execution_end' ? 'result' : null;
  if (!slotKey) return data;
  const slot = data[slotKey];
  if (!record(slot) || !record(slot.details) || !Array.isArray(slot.details.subagents) || !slot.details.subagents.length) {
    return data;
  }
  const resolver = resolveFrameOf(options);
  if (!resolver) return data;
  const subagents = extractTaskSubagents(slot.details, resolver, { allowProjectedSubagents: true });
  return {
    ...data,
    [slotKey]: subagents.length ? { ...slot, details: { subagents } } : { content: slot.content },
  };
}

export interface ToolEventStream {
  push(event: string, data: unknown): void;
  clear(): void;
}

/** Cumulative updates replace pending snapshots; lifecycle frames never wait. */
export function createToolEventStream(
  send: (event: string, data: unknown) => void,
  windowMs = 50,
  options?: ToolEventProjectionOptions,
): ToolEventStream {
  interface Lane { timer: NodeJS.Timeout; pending: unknown; hasPending: boolean }
  const lanes = new Map<string, Lane>();
  const emit = (event: string, projected: unknown) => {
    send(event, resolveProjectedTaskEvent(event, projected, options));
  };
  function flush(id: string) {
    const lane = lanes.get(id);
    if (!lane) return;
    clearTimeout(lane.timer); lanes.delete(id);
    if (lane.hasPending) emit('tool_execution_update', lane.pending);
  }
  function tick(id: string, lane: Lane) {
    if (!lane.hasPending) { lanes.delete(id); return; }
    const pending = lane.pending;
    lane.pending = undefined; lane.hasPending = false;
    emit('tool_execution_update', pending);
    lane.timer = setTimeout(() => tick(id, lane), windowMs);
  }
  function clear() {
    for (const lane of lanes.values()) clearTimeout(lane.timer);
    lanes.clear();
  }
  function push(event: string, value: unknown) {
    // Strip traces and untrusted route fields cheaply on ingress; resolve routes only when actually emitted.
    const data = projectToolEvent(event, value);
    const id = record(data) && typeof data.toolCallId === 'string' ? data.toolCallId : null;
    if (event === 'tool_execution_update' && id) {
      const current = lanes.get(id);
      if (current) { current.pending = data; current.hasPending = true; return; }
      emit(event, data);
      const lane: Lane = { timer: setTimeout(() => tick(id, lane), windowMs), pending: undefined, hasPending: false };
      lanes.set(id, lane);
      return;
    }
    if (id) flush(id);
    if (event === 'turn_end' || event === 'agent_end') for (const id of lanes.keys()) flush(id);
    emit(event, data);
  }
  return { push, clear };
}
