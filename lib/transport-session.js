// Generated from src/core/transport-session.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransportSession = void 0;
exports.promptParams = promptParams;
const extension_ui_state_1 = require("./extension-ui-state");
const wire_protocol_1 = require("./wire-protocol");
/**
 * Live-session surface shared by the stdio (RPC) and Prime daemon transports:
 * replay state, listener bookkeeping, and the prompt vocabulary both wire
 * protocols use. The bridge transport keeps Node's EventEmitter instead.
 */
class TransportSession {
    runningToolCalls = new Map();
    extUIState = (0, extension_ui_state_1.createExtensionUIState)();
    turnInProgress = false;
    /** Harness-reported; the /compact emulation also holds it to gate double-compaction. */
    compacting = false;
    /** Bumped on turn/message boundaries only: a per-poll timestamp made sessions look unread. */
    lastActivityAt = new Date();
    lastStats;
    streamingAssistantMessage = null;
    listeners = new Map();
    on(event, listener) {
        const listeners = this.listeners.get(event);
        if (listeners)
            listeners.push(listener);
        else
            this.listeners.set(event, [listener]);
        return () => this.off(event, listener);
    }
    off(event, listener) {
        const listeners = this.listeners.get(event);
        const index = listeners ? listeners.indexOf(listener) : -1;
        if (listeners && index >= 0)
            listeners.splice(index, 1);
    }
    once(event, listener) {
        const off = this.on(event, (data) => { off(); listener(data); });
        return off;
    }
    emitEvent(event, data) {
        // A listener may unsubscribe from inside its own callback, which splices
        // the live array; iterate a copy so no listener is skipped.
        for (const listener of [...(this.listeners.get(event) || [])])
            listener(data);
    }
    /**
     * Rebuild the assistant snapshot when the harness sends delta-only
     * `message_update` frames, so every consumer keeps seeing a whole message.
     */
    assistantFrame(msg) {
        if (msg.type === 'message_start' && (0, wire_protocol_1.isRecord)(msg.message) && msg.message.role === 'assistant') {
            this.streamingAssistantMessage = structuredClone(msg.message);
        }
        else if (msg.type === 'message_update' && !msg.message && msg.assistantMessageEvent) {
            const event = (0, wire_protocol_1.isRecord)(msg.assistantMessageEvent) ? msg.assistantMessageEvent : {};
            const snapshot = this.streamingAssistantMessage;
            if (event.type === 'done')
                this.streamingAssistantMessage = (0, wire_protocol_1.isRecord)(event.message) ? structuredClone(event.message) : null;
            else if (event.type === 'error')
                this.streamingAssistantMessage = (0, wire_protocol_1.isRecord)(event.error) ? structuredClone(event.error) : null;
            else if (snapshot) {
                const content = Array.isArray(snapshot.content) ? snapshot.content : (snapshot.content = []);
                const index = event.contentIndex;
                if (typeof index === 'number' && Number.isInteger(index) && index >= 0) {
                    if (event.type === 'text_start')
                        content[index] = { type: 'text', text: '' };
                    else if (event.type === 'text_delta' && typeof event.delta === 'string') {
                        const block = (0, wire_protocol_1.isRecord)(content[index]) ? content[index] : {};
                        if (block.type !== 'text' || typeof block.text !== 'string')
                            content[index] = { type: 'text', text: event.delta };
                        else
                            block.text += event.delta;
                    }
                    else if (event.type === 'text_end' && typeof event.content === 'string')
                        content[index] = { type: 'text', text: event.content };
                    else if (event.type === 'thinking_start')
                        content[index] = { type: 'thinking', thinking: '' };
                    else if (event.type === 'thinking_delta' && typeof event.delta === 'string') {
                        const block = (0, wire_protocol_1.isRecord)(content[index]) ? content[index] : {};
                        if (block.type !== 'thinking' || typeof block.thinking !== 'string')
                            content[index] = { type: 'thinking', thinking: event.delta };
                        else
                            block.thinking += event.delta;
                    }
                    else if (event.type === 'thinking_end' && typeof event.content === 'string')
                        content[index] = { type: 'thinking', thinking: event.content };
                    else if (event.type === 'toolcall_end' && (0, wire_protocol_1.isRecord)(event.toolCall))
                        content[index] = structuredClone(event.toolCall);
                }
            }
            if (this.streamingAssistantMessage) {
                return { ...msg, message: structuredClone(this.streamingAssistantMessage) };
            }
        }
        return msg;
    }
    /** The snapshot ends with the assistant message that carried it. */
    endAssistantMessage(msg) {
        if (msg.type === 'message_end' && (0, wire_protocol_1.isRecord)(msg.message) && msg.message.role === 'assistant') {
            this.streamingAssistantMessage = null;
        }
    }
    _refreshStats() {
        this.getSessionStats().then(stats => { this.lastStats = stats; }).catch(() => { });
    }
}
exports.TransportSession = TransportSession;
/** A busy agent receives an undecorated prompt as steering; both protocols call that field streamingBehavior. */
function promptParams(message, opts, busy) {
    const params = { message };
    if (opts.deliverAs)
        params.streamingBehavior = opts.deliverAs;
    else if (busy)
        params.streamingBehavior = 'steer';
    if (opts.images?.length)
        params.images = opts.images;
    return params;
}
