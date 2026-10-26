// Generated from src/core/wire-protocol.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.decodeSideChat = decodeSideChat;
exports.decodeRPCFrame = decodeRPCFrame;
exports.decodeBridgeFrame = decodeBridgeFrame;
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const SIDE_CHAT_TURN_STATUSES = ['running', 'complete', 'error', 'cancelled'];
function decodeSideChatTurn(value) {
    if (!isRecord(value)
        || typeof value.id !== 'string' || !value.id
        || typeof value.question !== 'string'
        || typeof value.answer !== 'string'
        || !SIDE_CHAT_TURN_STATUSES.includes(value.status)
        || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)
        || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt))
        return null;
    const turn = {
        id: value.id, question: value.question, answer: value.answer,
        status: value.status, startedAt: value.startedAt, updatedAt: value.updatedAt,
    };
    // `error` is meaningful only on an errored turn; a non-string payload is
    // malformed, so the whole turn is dropped rather than half-adopted.
    if (value.error != null) {
        if (typeof value.error !== 'string')
            return null;
        turn.error = value.error;
    }
    return turn;
}
/**
 * Decode the side-chat snapshot carried by hello and the `side_chat` event.
 * A malformed root means "no chat"; a malformed turn is dropped so one bad
 * row cannot hide the rest of a chat.
 */
function decodeSideChat(value) {
    if (value == null)
        return null;
    if (!isRecord(value)
        || typeof value.id !== 'string' || !value.id
        || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
        || !Array.isArray(value.turns))
        return null;
    const turns = [];
    for (const item of value.turns) {
        const turn = decodeSideChatTurn(item);
        if (turn)
            turns.push(turn);
    }
    return { id: value.id, createdAt: value.createdAt, turns };
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
