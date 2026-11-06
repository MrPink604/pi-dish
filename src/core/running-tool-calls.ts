import type { RunningToolCall, ToolExecutionData } from './contracts';
import { isRecord } from './wire-protocol';

/** Agent events reach every transport as unvalidated wire records; narrow them once here. */
function executionData(value: unknown): ToolExecutionData {
  const data = isRecord(value) ? value : {};
  return {
    toolCallId: typeof data.toolCallId === 'string' ? data.toolCallId : undefined,
    toolName: typeof data.toolName === 'string' ? data.toolName : undefined,
    startedAt: typeof data.startedAt === 'number' || typeof data.startedAt === 'string' ? data.startedAt : undefined,
    args: data.args,
    partialResult: data.partialResult,
  };
}

function startedAt(data: ToolExecutionData, fallback: number): number {
  if (typeof data.startedAt === 'number' && Number.isFinite(data.startedAt)) return data.startedAt;
  if (typeof data.startedAt === 'string') {
    const parsed = Date.parse(data.startedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Keep the reconnect snapshot identical for bridge and RPC transports. */
function trackRunningToolCalls(runningToolCalls: Map<string, RunningToolCall>, event: string, value?: unknown, now = Date.now()): void {
  if (event === 'turn_end' || event === 'agent_end') {
    runningToolCalls.clear();
    return;
  }

  const data = executionData(value);
  const { toolCallId } = data;
  if (!toolCallId) return;
  if (event === 'tool_execution_end') {
    runningToolCalls.delete(toolCallId);
    return;
  }

  if (event === 'tool_execution_start') {
    runningToolCalls.set(toolCallId, {
      toolName: data.toolName || 'tool',
      args: data.args ?? {},
      startedAt: startedAt(data, now),
      lastPartialResult: null,
    });
    return;
  }

  if (event === 'tool_execution_update') {
    const current = runningToolCalls.get(toolCallId);
    runningToolCalls.set(toolCallId, {
      toolName: data.toolName || current?.toolName || 'tool',
      args: data.args ?? current?.args ?? {},
      startedAt: current?.startedAt ?? startedAt(data, now),
      lastPartialResult: data.partialResult ?? current?.lastPartialResult ?? null,
    });
  }
}

export = { trackRunningToolCalls };
