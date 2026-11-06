// Generated from src/core/running-tool-calls.ts; edit that source and run npm run build:core.
"use strict";
const wire_protocol_1 = require("./wire-protocol");
/** Agent events reach every transport as unvalidated wire records; narrow them once here. */
function executionData(value) {
    const data = (0, wire_protocol_1.isRecord)(value) ? value : {};
    return {
        toolCallId: typeof data.toolCallId === 'string' ? data.toolCallId : undefined,
        toolName: typeof data.toolName === 'string' ? data.toolName : undefined,
        startedAt: typeof data.startedAt === 'number' || typeof data.startedAt === 'string' ? data.startedAt : undefined,
        args: data.args,
        partialResult: data.partialResult,
    };
}
function startedAt(data, fallback) {
    if (typeof data.startedAt === 'number' && Number.isFinite(data.startedAt))
        return data.startedAt;
    if (typeof data.startedAt === 'string') {
        const parsed = Date.parse(data.startedAt);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return fallback;
}
/** Keep the reconnect snapshot identical for bridge and RPC transports. */
function trackRunningToolCalls(runningToolCalls, event, value, now = Date.now()) {
    if (event === 'turn_end' || event === 'agent_end') {
        runningToolCalls.clear();
        return;
    }
    const data = executionData(value);
    const { toolCallId } = data;
    if (!toolCallId)
        return;
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
module.exports = { trackRunningToolCalls };
