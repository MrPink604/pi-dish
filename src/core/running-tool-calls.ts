import type { RunningToolCall, ToolExecutionData } from './contracts';
'use strict';

function startedAt(data: ToolExecutionData | null | undefined, fallback: number): number {
  if (Number.isFinite(data?.startedAt)) return data!.startedAt as number;
  if (typeof data?.startedAt === 'string') {
    const parsed = Date.parse(data.startedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Keep the reconnect snapshot identical for bridge and RPC transports. */
function trackRunningToolCalls(runningToolCalls: Map<string, RunningToolCall>, event: string, data?: ToolExecutionData | null, now = Date.now()): void {
  if (event === 'turn_end' || event === 'agent_end') {
    runningToolCalls.clear();
    return;
  }

  const toolCallId = data?.toolCallId;
  if (!toolCallId) return;
  if (event === 'tool_execution_end') {
    runningToolCalls.delete(toolCallId);
    return;
  }

  if (event === 'tool_execution_start') {
    runningToolCalls.set(toolCallId, {
      toolName: data!.toolName || 'tool',
      args: data!.args ?? {},
      startedAt: startedAt(data, now),
      lastPartialResult: null,
    });
    return;
  }

  if (event === 'tool_execution_update') {
    const current = runningToolCalls.get(toolCallId);
    runningToolCalls.set(toolCallId, {
      toolName: data!.toolName || current?.toolName || 'tool',
      args: data!.args ?? current?.args ?? {},
      startedAt: current?.startedAt ?? startedAt(data, now),
      lastPartialResult: data!.partialResult ?? current?.lastPartialResult ?? null,
    });
  }
}

export = { trackRunningToolCalls };
