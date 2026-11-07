// Generated from src/core/session-stream-handler.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionStreamHandler = createSessionStreamHandler;
const bridge_session_1 = require("./bridge-session");
const prime_daemon_1 = require("./prime-daemon");
const http_boundary_1 = require("./http-boundary");
const session_key_1 = require("./session-key");
const session_ownership_1 = require("./session-ownership");
const tool_event_stream_1 = require("./tool-event-stream");
const helper_values_1 = require("./helper-values");
function extensionUIPayload(value) {
    return (0, helper_values_1.record)(value) ? value : {};
}
// Deltas carry the full message so far; coalescing keeps slow (phone) links from flooding.
const MESSAGE_UPDATE_COALESCE_MS = 50;
const SIDE_CHAT_COALESCE_MS = 100;
function createSessionStreamHandler(ports) {
    return async (req, res) => {
        const sessionId = req.params.id;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(': connected\n\n');
        res.flush?.();
        const send = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            // Flush every frame so a reconnecting phone renders without waiting for the next event.
            res.flush?.();
        };
        const session = await ports.getLiveSession(sessionId).catch((error) => (0, http_boundary_1.errorMessage)(error));
        if (!session || typeof session === 'string') {
            send('stream_error', { error: typeof session === 'string' ? session : 'Session not active' });
            return res.end();
        }
        // A stream that closed during the await above has already emitted 'close'.
        if (req.destroyed || res.destroyed)
            return res.end();
        const viewerKey = (0, session_key_1.canonicalSessionId)(sessionId);
        ports.viewers.set(viewerKey, (ports.viewers.get(viewerKey) || 0) + 1);
        req.on('close', () => {
            const remaining = (ports.viewers.get(viewerKey) || 1) - 1;
            if (remaining)
                ports.viewers.set(viewerKey, remaining);
            else
                ports.viewers.delete(viewerKey);
        });
        const toolEvents = (0, tool_event_stream_1.createToolEventStream)(send);
        const messageForStream = (message) => {
            if (!(0, helper_values_1.record)(message) || message.role !== 'custom')
                return message;
            // interrupted-thinking is hidden reasoning; the client only needs its marker.
            if (message.customType === 'interrupted-thinking')
                return { ...message, content: [] };
            return message.display === false ? null : message;
        };
        const sideChatOf = () => 'sideChat' in session ? session.sideChat ?? null : null;
        send('init', { turnInProgress: !!session.turnInProgress, compacting: !!session.compacting });
        const offs = [];
        const sub = (event, fn) => {
            const remove = session instanceof bridge_session_1.BridgeSession ? session.on(event, fn) : session.on(event, fn);
            offs.push(typeof remove === 'function' ? remove : () => {
                if (session instanceof bridge_session_1.BridgeSession)
                    session.off(event, fn);
                else
                    session.off(event, fn);
            });
        };
        sub('turn_start', () => send('turn_start', {}));
        let pendingUpdate = null;
        let updateTimer = null;
        const flushUpdate = () => {
            updateTimer = null;
            if (!pendingUpdate)
                return;
            send('message_update', { message: pendingUpdate });
            pendingUpdate = null;
            updateTimer = setTimeout(flushUpdate, MESSAGE_UPDATE_COALESCE_MS);
        };
        // A delta flushed after turn_end/session_ended would leave a ghost streaming bubble.
        const clearPendingUpdate = () => {
            pendingUpdate = null;
            if (updateTimer) {
                clearTimeout(updateTimer);
                updateTimer = null;
            }
        };
        sub('message_update', (data) => {
            const message = messageForStream((0, helper_values_1.record)(data) ? data.message : undefined);
            if (!message)
                return;
            pendingUpdate = message;
            if (!updateTimer)
                flushUpdate();
        });
        sub('turn_end', () => { clearPendingUpdate(); toolEvents.push('turn_end', {}); });
        // Aborted/errored turns can end without a paired turn_end.
        sub('agent_end', () => { clearPendingUpdate(); toolEvents.push('agent_end', {}); });
        sub('message_end', (data) => {
            const message = messageForStream((0, helper_values_1.record)(data) ? data.message : undefined);
            const role = (0, helper_values_1.record)(message) ? message.role : undefined;
            if (role !== 'assistant' && role !== 'user' && role !== 'custom')
                return;
            // Only an assistant bubble supersedes a pending delta.
            if (role === 'assistant')
                clearPendingUpdate();
            send('message_end', { message });
        });
        sub('session_tree', (data) => send('session_tree', data || {}));
        // Clients on the old route learn which route now owns the same pane.
        sub('session_switch', (data) => {
            const routed = (0, session_ownership_1.sessionSwitchRouteData)(session, data);
            if (routed && routed.sessionId !== routed.previousSessionId) {
                toolEvents.clear();
                send('session_switch', routed);
            }
        });
        sub('tool_execution_start', (data) => toolEvents.push('tool_execution_start', data));
        sub('tool_execution_update', (data) => toolEvents.push('tool_execution_update', data));
        sub('tool_execution_end', (data) => toolEvents.push('tool_execution_end', data));
        // Subscribe before snapshotting so no call is missed; the client dedupes repeated starts by toolCallId.
        for (const [toolCallId, call] of session.runningToolCalls || []) {
            const common = { toolCallId, toolName: call.toolName, args: call.args, startedAt: call.startedAt };
            toolEvents.push('tool_execution_start', common);
            if (call.lastPartialResult != null) {
                toolEvents.push('tool_execution_update', { ...common, partialResult: call.lastPartialResult });
            }
        }
        // setWidget/setStatus re-fire unchanged every tick (and on bridge replay);
        // skip exact repeats by content, since the request id changes every emission.
        const lastExtensionUI = new Map();
        const extensionUISignature = (payload) => JSON.stringify([payload.widgetLines, payload.widgetPlacement, payload.statusText]);
        const extensionUIKey = (payload) => `${String(payload.method)}:${String(payload.widgetKey || payload.statusKey || 'default')}`;
        const replayDialogs = session.extUIState
            ? [...session.extUIState.dialogs.values()].filter((data) => session.turnInProgress || extensionUIPayload(data).method === 'auth')
            : [];
        sub('extension_ui_request', (data) => {
            const payload = extensionUIPayload(data);
            // `forced` marks a deliberate re-broadcast (/dish-push).
            if (data && !payload.forced && (payload.method === 'setWidget' || payload.method === 'setStatus')) {
                const key = extensionUIKey(payload);
                const signature = extensionUISignature(payload);
                if (lastExtensionUI.get(key) === signature)
                    return;
                lastExtensionUI.set(key, signature);
            }
            send('extension_ui_request', data);
        });
        sub('extension_ui_resolved', (data) => send('extension_ui_resolved', data));
        // Dialogs replay only mid-turn; a login step belongs to a live login, which runs while idle.
        if (session.extUIState) {
            const { widgets, statuses } = session.extUIState;
            for (const data of [...widgets.values(), ...statuses.values(), ...replayDialogs]) {
                const payload = extensionUIPayload(data);
                if (payload.method === 'setWidget' || payload.method === 'setStatus') {
                    lastExtensionUI.set(extensionUIKey(payload), extensionUISignature(payload));
                }
                send('extension_ui_request', data);
            }
        }
        // Sent after the replay burst so the client can prune dialogs answered elsewhere.
        send('extension_ui_state', {
            dialogs: replayDialogs.map((data) => extensionUIPayload(data).id).filter(Boolean),
        });
        // RPCSessions have no queueState.
        const queueState = 'queueState' in session ? session.queueState : undefined;
        if (queueState)
            send('queue_update', queueState);
        sub('queue_update', (data) => send('queue_update', data));
        // Clients consume whole side-chat snapshots: structural ones go out
        // immediately; deltas are reduced into state and sent as one delayed snapshot.
        let sideChatTimer = null;
        const clearSideChatTimer = () => {
            if (sideChatTimer) {
                clearTimeout(sideChatTimer);
                sideChatTimer = null;
            }
        };
        sub('side_chat', () => {
            clearSideChatTimer();
            send('side_chat', { sideChat: sideChatOf() });
        });
        sub('side_chat_delta', () => {
            if (sideChatTimer)
                return;
            sideChatTimer = setTimeout(() => {
                sideChatTimer = null;
                send('side_chat', { sideChat: sideChatOf() });
            }, SIDE_CHAT_COALESCE_MS);
        });
        if (session instanceof bridge_session_1.BridgeSession)
            send('side_chat', { sideChat: session.sideChat ?? null });
        sub('compaction_start', (data) => send('compaction_start', data));
        sub('compaction_end', (data) => send('compaction_end', data));
        sub('auto_retry_start', (data) => send('auto_retry_start', data));
        sub('auto_retry_end', (data) => send('auto_retry_end', data));
        const onClose = () => { clearPendingUpdate(); clearSideChatTimer(); toolEvents.clear(); send('session_ended', {}); };
        if (session instanceof bridge_session_1.BridgeSession || session instanceof prime_daemon_1.PrimeDaemonSession) {
            const remove = session instanceof bridge_session_1.BridgeSession ? session.once('close', onClose) : session.once('close', onClose);
            offs.push(typeof remove === 'function' ? remove : () => session.off('close', onClose));
        }
        else {
            sub('exit', onClose);
        }
        req.on('close', () => {
            clearPendingUpdate();
            clearSideChatTimer();
            toolEvents.clear();
            for (const off of offs) {
                try {
                    off();
                }
                catch { }
            }
        });
    };
}
