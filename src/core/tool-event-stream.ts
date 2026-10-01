import { record } from './helper-values';

/** Tool panels consume content, not harness-native task traces in result.details. */
export function projectToolEvent(event: string, value: unknown): unknown {
  if (!event.startsWith('tool_execution_') || !record(value)) return value;
  const { toolCallId, toolName, args, startedAt, isError } = value;
  const result = (value: unknown) => record(value) ? { content: value.content } : value;
  return {
    toolCallId, toolName, args, startedAt, isError,
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
