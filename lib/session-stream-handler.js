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
const wire_protocol_1 = require("./wire-protocol");
/** Extension-UI events are opaque protocol records; absent fields read undefined. */
function extensionUIPayload(value) {
    return (0, wire_protocol_1.isRecord)(value) ? value : {};
}
// Streaming deltas carry the full message so far; coalescing per connection
// keeps slow (phone) links from being flooded.
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
        let sess;
        try {
            sess = await ports.getLiveSession(sessionId);
        }
        catch (error) {
            res.write(`event: stream_error\ndata: ${JSON.stringify({ error: (0, http_boundary_1.errorMessage)(error) })}\n\n`);
            return res.end();
        }
        if (!sess) {
            res.write(`event: stream_error\ndata: ${JSON.stringify({ error: 'Session not active' })}\n\n`);
            return res.end();
        }
        // A stream that closed during the await above has already emitted 'close'.
        if (req.destroyed || res.destroyed)
            return res.end();
        const session = sess;
        const viewerKey = (0, session_key_1.canonicalSessionId)(sessionId);
        ports.viewers.set(viewerKey, (ports.viewers.get(viewerKey) || 0) + 1);
        req.on('close', () => {
            const remaining = (ports.viewers.get(viewerKey) || 1) - 1;
            if (remaining)
                ports.viewers.set(viewerKey, remaining);
            else
                ports.viewers.delete(viewerKey);
        });
        const send = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            // Flush every frame so a reconnecting phone renders replay/live state
            // without waiting for another event to make the chunk observable.
            res.flush?.();
        };
        const toolEvents = (0, tool_event_stream_1.createToolEventStream)(send);
        const messageForStream = (message) => {
            if (!(0, wire_protocol_1.isRecord)(message) || message.role !== 'custom')
                return message;
            // interrupted-thinking content is hidden model reasoning; the client only
            // needs its marker. Other hidden host state follows the documented skip.
            if (message.customType === 'interrupted-thinking')
                return { ...message, content: [] };
            return message.display === false ? null : message;
        };
        const sideChatOf = (session) => 'sideChat' in session ? session.sideChat ?? null : null;
        send('init', { turnInProgress: !!sess.turnInProgress, compacting: !!sess.compacting });
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
        // Each message_update carries the full message, so intermediates can drop.
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
        // A delta flushed after turn_end/session_ended would re-arm the client's
        // working indicator and leave a ghost streaming bubble.
        const clearPendingUpdate = () => {
            pendingUpdate = null;
            if (updateTimer) {
                clearTimeout(updateTimer);
                updateTimer = null;
            }
        };
        sub('message_update', (data) => {
            const message = messageForStream((0, wire_protocol_1.isRecord)(data) ? data.message : undefined);
            if (!message)
                return;
            pendingUpdate = message;
            if (!updateTimer)
                flushUpdate();
        });
        sub('turn_end', () => { clearPendingUpdate(); toolEvents.push('turn_end', {}); });
        // agent_end also terminates a turn (aborted/errored turns can end without a
        // paired turn_end); forwarding it stops the client's working indicator.
        sub('agent_end', () => { clearPendingUpdate(); toolEvents.push('agent_end', {}); });
        sub('message_end', (data) => {
            const message = messageForStream((0, wire_protocol_1.isRecord)(data) ? data.message : undefined);
            const role = (0, wire_protocol_1.isRecord)(message) ? message.role : undefined;
            if (role !== 'assistant' && role !== 'user' && role !== 'custom')
                return;
            // An assistant bubble supersedes any pending delta; a mid-turn user/custom
            // message does not invalidate it.
            if (role === 'assistant')
                clearPendingUpdate();
            send('message_end', { message });
        });
        sub('session_tree', (data) => send('session_tree', data || {}));
        // Keep clients attached to the old route long enough to learn which route
        // now owns the same pane.
        sub('session_switch', (data) => {
            const routed = (0, session_ownership_1.sessionSwitchRouteData)(sess, data);
            if (routed && routed.sessionId !== routed.previousSessionId) {
                toolEvents.clear();
                send('session_switch', routed);
            }
        });
        sub('tool_execution_start', (data) => toolEvents.push('tool_execution_start', data));
        sub('tool_execution_update', (data) => toolEvents.push('tool_execution_update', data));
        sub('tool_execution_end', (data) => toolEvents.push('tool_execution_end', data));
        // Subscribe before taking the snapshot: a call that ends during replay is
        // still forwarded, while one that started just before subscription is found
        // in the session-owned map. Repeated starts dedupe by toolCallId client-side.
        for (const [toolCallId, call] of sess.runningToolCalls || []) {
            const common = { toolCallId, toolName: call.toolName, args: call.args, startedAt: call.startedAt };
            toolEvents.push('tool_execution_start', common);
            if (call.lastPartialResult != null) {
                toolEvents.push('tool_execution_update', { ...common, partialResult: call.lastPartialResult });
            }
        }
        // setWidget/setStatus re-fire with unchanged content on every extension
        // tick; skip exact repeats per connection. Content-keyed: the request id
        // changes on every emission. This absorbs the bridge's full-state replay.
        const lastExtensionUI = new Map();
        const extensionUISignature = (payload) => JSON.stringify([payload.widgetLines, payload.widgetPlacement, payload.statusText]);
        const extensionUIKey = (payload) => `${String(payload.method)}:${String(payload.widgetKey || payload.statusKey || 'default')}`;
        const replayDialogs = sess.extUIState
            ? [...sess.extUIState.dialogs.values()].filter((data) => sess.turnInProgress || extensionUIPayload(data).method === 'auth')
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
        // Replay the transport-owned extension UI to a client that just connected.
        // Tool/extension dialogs are replayed only mid-turn; a login step belongs
        // to a live harness login, which runs while idle.
        if (sess.extUIState) {
            const { widgets, statuses } = sess.extUIState;
            for (const data of [...widgets.values(), ...statuses.values(), ...replayDialogs]) {
                const payload = extensionUIPayload(data);
                if (payload.method === 'setWidget' || payload.method === 'setStatus') {
                    lastExtensionUI.set(extensionUIKey(payload), extensionUISignature(payload));
                }
                send('extension_ui_request', data);
            }
        }
        // Authoritative pending-dialog list, after the replay burst, so the client
        // can prune dialogs answered while it viewed another session.
        send('extension_ui_state', {
            dialogs: replayDialogs.map((data) => extensionUIPayload(data).id).filter(Boolean),
        });
        // Replay the last-known queue. RPCSessions have no queueState (fine).
        const queueState = 'queueState' in sess ? sess.queueState : undefined;
        if (queueState)
            send('queue_update', queueState);
        sub('queue_update', (data) => send('queue_update', data));
        // Side chat: clients consume whole snapshots. A structural `side_chat`
        // snapshot goes out immediately; streamed deltas are reduced into session
        // state, so one delayed snapshot carries all of them.
        let sideChatTimer = null;
        const clearSideChatTimer = () => {
            if (sideChatTimer) {
                clearTimeout(sideChatTimer);
                sideChatTimer = null;
            }
        };
        sub('side_chat', () => {
            clearSideChatTimer();
            send('side_chat', { sideChat: sideChatOf(sess) });
        });
        sub('side_chat_delta', () => {
            if (sideChatTimer)
                return;
            sideChatTimer = setTimeout(() => {
                sideChatTimer = null;
                send('side_chat', { sideChat: sideChatOf(sess) });
            }, SIDE_CHAT_COALESCE_MS);
        });
        if (sess instanceof bridge_session_1.BridgeSession)
            send('side_chat', { sideChat: sess.sideChat ?? null });
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
