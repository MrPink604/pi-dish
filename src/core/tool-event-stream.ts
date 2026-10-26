import { record } from './helper-values';

const BASH_DETAIL_KEYS = ['wallTimeMs', 'exitCode', 'timedOut', 'timeoutSeconds', 'timeoutDisabled'] as const;
const WAIT_JOB_KEYS = ['id', 'type', 'status', 'label', 'durationMs', 'exitCode'] as const;
const OUTPUT_TEXT_LIMIT = 8000;
const EVAL_CELL_KEYS = ['index', 'title', 'language', 'status', 'exitCode', 'durationMs'] as const;
const EVAL_EVENT_KEYS = ['op', 'detail', 'path', 'cmd', 'args', 'key', 'action', 'chars', 'bytes', 'count', 'error', 'exit_code'] as const;
const EVAL_EVENT_LIMIT = 50;
const EVAL_EVENT_TEXT_LIMIT = 300;

/**
 * The few result details the browser formats: OMP bash timing/exit/deadline,
 * wait job rows and eval cell status/activity. Everything else in
 * result.details (task traces, widgets, previews) stays on the server.
 */
function projectToolDetails(toolName: unknown, details: unknown): Record<string, unknown> | undefined {
  if (!record(details)) return undefined;
  if (toolName === 'bash') {
    const out: Record<string, unknown> = {};
    for (const key of BASH_DETAIL_KEYS) if (details[key] !== undefined) out[key] = details[key];
    if (record(details.async) && typeof details.async.jobId === 'string') out.async = { jobId: details.async.jobId };
    return Object.keys(out).length ? out : undefined;
  }
  if (toolName === 'wait' && Array.isArray(details.jobs)) {
    return { jobs: details.jobs.flatMap((job: unknown) => {
      if (!record(job)) return [];
      const out: Record<string, unknown> = {};
      for (const key of WAIT_JOB_KEYS) if (job[key] !== undefined) out[key] = job[key];
      for (const key of ['resultText', 'errorText'] as const) {
        if (typeof job[key] === 'string') out[key] = job[key].slice(0, OUTPUT_TEXT_LIMIT);
      }
      return [out];
    }) };
  }
  if (toolName === 'eval' && Array.isArray(details.cells)) {
    const multi = details.cells.length > 1;
    return { cells: details.cells.flatMap((cell: unknown) => {
      if (!record(cell)) return [];
      const out: Record<string, unknown> = {};
      for (const key of EVAL_CELL_KEYS) if (cell[key] !== undefined) out[key] = cell[key];
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
export function projectToolEvent(event: string, value: unknown): unknown {
  if (!event.startsWith('tool_execution_') || !record(value)) return value;
  const { toolCallId, toolName, args, startedAt, isError } = value;
  const intent = typeof value.intent === 'string' && value.intent ? value.intent : undefined;
  const result = (value: unknown) => {
    if (!record(value)) return value;
    const details = projectToolDetails(toolName, value.details);
    return details ? { content: value.content, details } : { content: value.content };
  };
  return {
    toolCallId, toolName, args, startedAt, isError,
    ...(intent ? { intent } : {}),
    ...(event === 'tool_execution_update' ? { partialResult: result(value.partialResult) } : {}),
    ...(event === 'tool_execution_end' ? { result: result(value.result) } : {}),
  };
}

export interface ToolEventStream {
  push(event: string, data: unknown): void;
  clear(): void;
}

/** Cumulative updates replace pending snapshots; lifecycle frames never wait. */
export function createToolEventStream(send: (event: string, data: unknown) => void, windowMs = 50): ToolEventStream {
  interface Lane { timer: NodeJS.Timeout; pending: unknown; hasPending: boolean }
  const lanes = new Map<string, Lane>();
  function flush(id: string) {
    const lane = lanes.get(id);
    if (!lane) return;
    clearTimeout(lane.timer); lanes.delete(id);
    if (lane.hasPending) send('tool_execution_update', lane.pending);
  }
  function tick(id: string, lane: Lane) {
    if (!lane.hasPending) { lanes.delete(id); return; }
    const pending = lane.pending;
    lane.pending = undefined; lane.hasPending = false;
    send('tool_execution_update', pending);
    lane.timer = setTimeout(() => tick(id, lane), windowMs);
  }
  function clear() {
    for (const lane of lanes.values()) clearTimeout(lane.timer);
    lanes.clear();
  }
  function push(event: string, value: unknown) {
    const data = projectToolEvent(event, value);
    const id = record(data) && typeof data.toolCallId === 'string' ? data.toolCallId : null;
    if (event === 'tool_execution_update' && id) {
      const current = lanes.get(id);
      if (current) { current.pending = data; current.hasPending = true; return; }
      send(event, data);
      const lane: Lane = { timer: setTimeout(() => tick(id, lane), windowMs), pending: undefined, hasPending: false };
      lanes.set(id, lane);
      return;
    }
    if (id) flush(id);
    if (event === 'turn_end' || event === 'agent_end') for (const id of lanes.keys()) flush(id);
    send(event, data);
  }
  return { push, clear };
}
