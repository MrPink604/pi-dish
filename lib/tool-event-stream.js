// Generated from src/core/tool-event-stream.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectToolEvent = projectToolEvent;
exports.createToolEventStream = createToolEventStream;
const helper_values_1 = require("./helper-values");
/** Tool panels consume content, not harness-native task traces in result.details. */
function projectToolEvent(event, value) {
    if (!event.startsWith('tool_execution_') || !(0, helper_values_1.record)(value))
        return value;
    const { toolCallId, toolName, args, startedAt, isError } = value;
    const result = (value) => (0, helper_values_1.record)(value) ? { content: value.content } : value;
    return {
        toolCallId, toolName, args, startedAt, isError,
        ...(event === 'tool_execution_update' ? { partialResult: result(value.partialResult) } : {}),
        ...(event === 'tool_execution_end' ? { result: result(value.result) } : {}),
    };
}
/** Cumulative updates replace pending snapshots; lifecycle frames never wait. */
function createToolEventStream(send, windowMs = 50) {
    const lanes = new Map();
    function flush(id) {
        const lane = lanes.get(id);
        if (!lane)
            return;
        clearTimeout(lane.timer);
        lanes.delete(id);
        if (lane.hasPending)
            send('tool_execution_update', lane.pending);
    }
    function tick(id, lane) {
        if (!lane.hasPending) {
            lanes.delete(id);
            return;
        }
        const pending = lane.pending;
        lane.pending = undefined;
        lane.hasPending = false;
        send('tool_execution_update', pending);
        lane.timer = setTimeout(() => tick(id, lane), windowMs);
    }
    function clear() {
        for (const lane of lanes.values())
            clearTimeout(lane.timer);
        lanes.clear();
    }
    function push(event, value) {
        const data = projectToolEvent(event, value);
        const id = (0, helper_values_1.record)(data) && typeof data.toolCallId === 'string' ? data.toolCallId : null;
        if (event === 'tool_execution_update' && id) {
            const current = lanes.get(id);
            if (current) {
                current.pending = data;
                current.hasPending = true;
                return;
            }
            send(event, data);
            const lane = { timer: setTimeout(() => tick(id, lane), windowMs), pending: undefined, hasPending: false };
            lanes.set(id, lane);
            return;
        }
        if (id)
            flush(id);
        if (event === 'turn_end' || event === 'agent_end')
            for (const id of lanes.keys())
                flush(id);
        send(event, data);
    }
    return { push, clear };
}
