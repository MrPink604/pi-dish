// Generated from src/core/wire-protocol.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.decodeRPCFrame = decodeRPCFrame;
exports.decodeBridgeFrame = decodeBridgeFrame;
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isResponse(value) {
    return value.type === 'response' && typeof value.success === 'boolean'
        && (value.id == null || typeof value.id === 'string' || (typeof value.id === 'number' && Number.isFinite(value.id)))
        && (value.error == null || typeof value.error === 'string');
}
/** RPC agent events carry their payload directly alongside type. */
function decodeRPCFrame(value) {
    if (!isRecord(value) || typeof value.type !== 'string' || !value.type)
        return null;
    if (value.type === 'response')
        return isResponse(value) ? { kind: 'response', response: value } : null;
    return { kind: 'event', event: value.type, data: value };
}
/** Hello ownership is still proved against the selected registry claim by BridgeSession. */
function decodeBridgeFrame(value) {
    if (!isRecord(value))
        return null;
    if (value.type === 'response')
        return isResponse(value) ? { kind: 'response', response: value } : null;
    if (value.type === 'hello')
        return { kind: 'hello', hello: value };
    if (value.type === 'event' && typeof value.event === 'string' && value.event) {
        return { kind: 'event', event: value.event, data: value.data };
    }
    return null;
}
