import type { RouteHandler } from './http-boundary';
import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import { errorMessage } from './http-boundary';
import { canonicalSessionId } from './session-key';
import { sessionSwitchRouteData } from './session-ownership';
import { createToolEventStream } from './tool-event-stream';
import { record as isRecord } from './helper-values';
import type { LiveSession } from './session-ownership';

export interface SessionStreamPorts {
  getLiveSession(sessionId: string): Promise<LiveSession | null>;
  /** Open browser event streams per canonical session; hibernation reads it. */
  viewers: Map<string, number>;
}

interface ExtensionUIPayload {
  method?: unknown;
  id?: unknown;
  widgetKey?: unknown;
  statusKey?: unknown;
  widgetLines?: unknown;
  widgetPlacement?: unknown;
  statusText?: unknown;
  forced?: unknown;
}

/** Extension-UI events are opaque protocol records; absent fields read undefined. */
function extensionUIPayload(value: unknown): ExtensionUIPayload {
  return isRecord(value) ? value : {};
}

// Streaming deltas carry the full message so far; coalescing per connection
// keeps slow (phone) links from being flooded.
const MESSAGE_UPDATE_COALESCE_MS = 50;
const SIDE_CHAT_COALESCE_MS = 100;

export function createSessionStreamHandler(ports: SessionStreamPorts): RouteHandler {
  return async (req, res) => {
    const sessionId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(': connected\n\n');
    res.flush?.();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Flush every frame so a reconnecting phone renders replay/live state
      // without waiting for another event to make the chunk observable.
      res.flush?.();
    };

    const session = await ports.getLiveSession(sessionId).catch((error: unknown) => errorMessage(error));
    if (!session || typeof session === 'string') {
      send('stream_error', { error: typeof session === 'string' ? session : 'Session not active' });
      return res.end();
    }
    // A stream that closed during the await above has already emitted 'close'.
    if (req.destroyed || res.destroyed) return res.end();
    const viewerKey = canonicalSessionId(sessionId);
    ports.viewers.set(viewerKey, (ports.viewers.get(viewerKey) || 0) + 1);
    req.on('close', () => {
      const remaining = (ports.viewers.get(viewerKey) || 1) - 1;
      if (remaining) ports.viewers.set(viewerKey, remaining); else ports.viewers.delete(viewerKey);
    });

    const toolEvents = createToolEventStream(send);
    const messageForStream = (message: unknown): unknown => {
      if (!isRecord(message) || message.role !== 'custom') return message;
      // interrupted-thinking content is hidden model reasoning; the client only
      // needs its marker. Other hidden host state follows the documented skip.
      if (message.customType === 'interrupted-thinking') return { ...message, content: [] };
      return message.display === false ? null : message;
    };
    const sideChatOf = (): unknown => 'sideChat' in session ? session.sideChat ?? null : null;

    send('init', { turnInProgress: !!session.turnInProgress, compacting: !!session.compacting });

    const offs: Array<() => unknown> = [];
    const sub = (event: string, fn: (data: unknown) => void): void => {
      const remove = session instanceof BridgeSession ? session.on(event, fn) : session.on(event, fn);
      offs.push(typeof remove === 'function' ? remove : () => {
        if (session instanceof BridgeSession) session.off(event, fn);
        else session.off(event, fn);
      });
    };

    sub('turn_start', () => send('turn_start', {}));

    // Each message_update carries the full message, so intermediates can drop.
    let pendingUpdate: unknown = null;
    let updateTimer: NodeJS.Timeout | null = null;
    const flushUpdate = () => {
      updateTimer = null;
      if (!pendingUpdate) return;
      send('message_update', { message: pendingUpdate });
      pendingUpdate = null;
      updateTimer = setTimeout(flushUpdate, MESSAGE_UPDATE_COALESCE_MS);
    };
    // A delta flushed after turn_end/session_ended would re-arm the client's
    // working indicator and leave a ghost streaming bubble.
    const clearPendingUpdate = () => {
      pendingUpdate = null;
      if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
    };
    sub('message_update', (data) => {
      const message = messageForStream(isRecord(data) ? data.message : undefined);
      if (!message) return;
      pendingUpdate = message;
      if (!updateTimer) flushUpdate();
    });

    sub('turn_end', () => { clearPendingUpdate(); toolEvents.push('turn_end', {}); });
    // agent_end also terminates a turn (aborted/errored turns can end without a
    // paired turn_end); forwarding it stops the client's working indicator.
    sub('agent_end', () => { clearPendingUpdate(); toolEvents.push('agent_end', {}); });

    sub('message_end', (data) => {
      const message = messageForStream(isRecord(data) ? data.message : undefined);
      const role = isRecord(message) ? message.role : undefined;
      if (role !== 'assistant' && role !== 'user' && role !== 'custom') return;
      // An assistant bubble supersedes any pending delta; a mid-turn user/custom
      // message does not invalidate it.
      if (role === 'assistant') clearPendingUpdate();
      send('message_end', { message });
    });

    sub('session_tree', (data) => send('session_tree', data || {}));
    // Keep clients attached to the old route long enough to learn which route
    // now owns the same pane.
    sub('session_switch', (data) => {
      const routed = sessionSwitchRouteData(session, data);
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
    for (const [toolCallId, call] of session.runningToolCalls || []) {
      const common = { toolCallId, toolName: call.toolName, args: call.args, startedAt: call.startedAt };
      toolEvents.push('tool_execution_start', common);
      if (call.lastPartialResult != null) {
        toolEvents.push('tool_execution_update', { ...common, partialResult: call.lastPartialResult });
      }
    }

    // setWidget/setStatus re-fire with unchanged content on every extension
    // tick; skip exact repeats per connection. Content-keyed: the request id
    // changes on every emission. This absorbs the bridge's full-state replay.
    const lastExtensionUI = new Map<string, string | undefined>();
    const extensionUISignature = (payload: ExtensionUIPayload) =>
      JSON.stringify([payload.widgetLines, payload.widgetPlacement, payload.statusText]);
    const extensionUIKey = (payload: ExtensionUIPayload) =>
      `${String(payload.method)}:${String(payload.widgetKey || payload.statusKey || 'default')}`;
    const replayDialogs = session.extUIState
      ? [...session.extUIState.dialogs.values()].filter((data) =>
        session.turnInProgress || extensionUIPayload(data).method === 'auth')
      : [];
    sub('extension_ui_request', (data) => {
      const payload = extensionUIPayload(data);
      // `forced` marks a deliberate re-broadcast (/dish-push).
      if (data && !payload.forced && (payload.method === 'setWidget' || payload.method === 'setStatus')) {
        const key = extensionUIKey(payload);
        const signature = extensionUISignature(payload);
        if (lastExtensionUI.get(key) === signature) return;
        lastExtensionUI.set(key, signature);
      }
      send('extension_ui_request', data);
    });
    sub('extension_ui_resolved', (data) => send('extension_ui_resolved', data));

    // Replay the transport-owned extension UI to a client that just connected.
    // Tool/extension dialogs are replayed only mid-turn; a login step belongs
    // to a live harness login, which runs while idle.
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
    // Authoritative pending-dialog list, after the replay burst, so the client
    // can prune dialogs answered while it viewed another session.
    send('extension_ui_state', {
      dialogs: replayDialogs.map((data) => extensionUIPayload(data).id).filter(Boolean),
    });
    // Replay the last-known queue. RPCSessions have no queueState (fine).
    const queueState = 'queueState' in session ? session.queueState : undefined;
    if (queueState) send('queue_update', queueState);
    sub('queue_update', (data) => send('queue_update', data));

    // Side chat: clients consume whole snapshots. A structural `side_chat`
    // snapshot goes out immediately; streamed deltas are reduced into session
    // state, so one delayed snapshot carries all of them.
    let sideChatTimer: NodeJS.Timeout | null = null;
    const clearSideChatTimer = () => {
      if (sideChatTimer) { clearTimeout(sideChatTimer); sideChatTimer = null; }
    };
    sub('side_chat', () => {
      clearSideChatTimer();
      send('side_chat', { sideChat: sideChatOf() });
    });
    sub('side_chat_delta', () => {
      if (sideChatTimer) return;
      sideChatTimer = setTimeout(() => {
        sideChatTimer = null;
        send('side_chat', { sideChat: sideChatOf() });
      }, SIDE_CHAT_COALESCE_MS);
    });
    if (session instanceof BridgeSession) send('side_chat', { sideChat: session.sideChat ?? null });

    sub('compaction_start', (data) => send('compaction_start', data));
    sub('compaction_end', (data) => send('compaction_end', data));
    sub('auto_retry_start', (data) => send('auto_retry_start', data));
    sub('auto_retry_end', (data) => send('auto_retry_end', data));

    const onClose = () => { clearPendingUpdate(); clearSideChatTimer(); toolEvents.clear(); send('session_ended', {}); };
    if (session instanceof BridgeSession || session instanceof PrimeDaemonSession) {
      const remove = session instanceof BridgeSession ? session.once('close', onClose) : session.once('close', onClose);
      offs.push(typeof remove === 'function' ? remove : () => session.off('close', onClose));
    } else {
      sub('exit', onClose);
    }

    req.on('close', () => {
      clearPendingUpdate();
      clearSideChatTimer();
      toolEvents.clear();
      for (const off of offs) { try { off(); } catch {} }
    });
  };
}
