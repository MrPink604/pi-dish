import type { RouteHandler } from './http-boundary';
import { BridgeSession } from './bridge-session';
import { PrimeDaemonSession } from './prime-daemon';
import { getHarness } from './harnesses';
import { errorMessage } from './http-boundary';
import { canonicalSessionId } from './session-key';
import { createNestedSubsessionResolver } from './session-discovery';
import { sessionSwitchRouteData } from './session-ownership';
import { createToolEventStream, sanitizeAssistantTaskBlocks } from './tool-event-stream';
import { record as isRecord } from './helper-values';
import type { LiveSession } from './session-ownership';
import type { LiveSourceObservation, SessionSource } from './session-source';

export interface SessionStreamPorts {
  getLiveSession(sessionId: string): Promise<LiveSession | null>;
  /** Optional fallback for resolving the session's persisted file when not directly on the live transport. */
  findSessionSource?(sessionId: string): SessionSource | null;
  /** Live source observations so a colliding live claim blocks stale nested subagent routes. */
  liveSourceObservations?(sessionId: unknown): readonly LiveSourceObservation[];
  /** Open browser event streams per canonical session; hibernation reads it. */
  viewers: Map<string, number>;
  /** Interval for observable SSE heartbeats, also below reverse-proxy idle timeouts. */
  heartbeatMs?: number;
  /** A session's review deck changes (`review_updated`); returns the unsubscribe. */
  reviewUpdates?(sessionId: string, listener: (data: unknown) => void): () => void;
  /** True while a session is restarting transparently (e.g. stale bot relay) and SSE should reconnect instead of ending. */
  isRestarting?(sessionId: string): boolean;
  /** Wait for an in-flight transparent restart to finish before resolving the live session. */
  waitForRestart?(sessionId: string): Promise<void>;
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

function extensionUIPayload(value: unknown): ExtensionUIPayload {
  return isRecord(value) ? value : {};
}

// Deltas carry the full message so far; coalescing keeps slow (phone) links from flooding.
const MESSAGE_UPDATE_COALESCE_MS = 50;
const SIDE_CHAT_COALESCE_MS = 100;
// Below reverse-proxy idle read timeouts (Cloudflare ~100s, nginx 60s) and mobile NAT timeouts.
const DEFAULT_HEARTBEAT_MS = 25_000;

export function createSessionStreamHandler(ports: SessionStreamPorts): RouteHandler {
  const heartbeatMs = ports.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  return async (req, res) => {
    const sessionId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(': connected\n\n');
    res.flush?.();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Flush every frame so a reconnecting phone renders without waiting for the next event.
      res.flush?.();
    };

    let session = await ports.getLiveSession(sessionId).catch((error: unknown) => errorMessage(error));
    if ((!session || typeof session === 'string') && ports.isRestarting?.(sessionId)) {
      await Promise.race([
        ports.waitForRestart?.(sessionId) ?? Promise.resolve(),
        new Promise<void>(resolve => { res.once('close', resolve); }),
      ]);
      if (res.destroyed || res.writableEnded) return res.end();
      session = await ports.getLiveSession(sessionId).catch((error: unknown) => errorMessage(error));
    }
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

    const nestedResolvers = new Map<string, ReturnType<typeof createNestedSubsessionResolver>>();
    const resolveTaskSubagentsFrame = (): ((agentId: string) => string | null) => {
      let parentFile: string | null = null;
      let descriptor = null as ReturnType<typeof getHarness>;
      if (session instanceof BridgeSession && typeof session.sessionFile === 'string' && session.sessionFile) {
        descriptor = getHarness(session.harnessId);
        if (descriptor?.nestedSubsessions) parentFile = session.sessionFile;
      }
      if (!parentFile) {
        const source = ports.findSessionSource?.(sessionId);
        if (source) {
          descriptor = getHarness(source.harnessId);
          if (descriptor?.nestedSubsessions) parentFile = source.file;
        }
      }
      if (!parentFile || !descriptor?.nestedSubsessions) return () => null;
      let resolver = nestedResolvers.get(descriptor.id);
      if (!resolver) {
        resolver = createNestedSubsessionResolver({
          descriptor,
          snapshotTtlMs: 2000,
          live: ports.liveSourceObservations,
        });
        nestedResolvers.set(descriptor.id, resolver);
      }
      return resolver.forParentFrame(parentFile);
    };
    const toolEvents = createToolEventStream(send, undefined, { resolveTaskSubagentsFrame });
    const messageForStream = (message: unknown): unknown => {
      if (!isRecord(message)) return message;
      if (message.role === 'assistant') return sanitizeAssistantTaskBlocks(message);
      if (message.role !== 'custom') return message;
      // interrupted-thinking is hidden reasoning; the client only needs its marker.
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

    let pendingUpdate: unknown = null;
    let updateTimer: NodeJS.Timeout | null = null;
    const flushUpdate = () => {
      updateTimer = null;
      if (!pendingUpdate) return;
      send('message_update', { message: pendingUpdate });
      pendingUpdate = null;
      updateTimer = setTimeout(flushUpdate, MESSAGE_UPDATE_COALESCE_MS);
    };
    // A delta flushed after turn_end/session_ended would leave a ghost streaming bubble.
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
    // Aborted/errored turns can end without a paired turn_end.
    sub('agent_end', () => { clearPendingUpdate(); toolEvents.push('agent_end', {}); });
    // Modern Pi may retry, compact or drain queued messages after agent_end.
    // Expose its final-idle boundary so clients need not infer it from timing.
    sub('agent_settled', (data) => send('agent_settled', data || {}));

    sub('message_end', (data) => {
      const message = messageForStream(isRecord(data) ? data.message : undefined);
      const role = isRecord(message) ? message.role : undefined;
      if (role !== 'assistant' && role !== 'user' && role !== 'custom') return;
      // Only an assistant bubble supersedes a pending delta.
      if (role === 'assistant') clearPendingUpdate();
      send('message_end', { message });
    });

    sub('session_tree', (data) => send('session_tree', data || {}));
    // Clients on the old route learn which route now owns the same pane.
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
    if (queueState) send('queue_update', queueState);
    sub('queue_update', (data) => send('queue_update', data));

    // Clients consume whole side-chat snapshots: structural ones go out
    // immediately; deltas are reduced into state and sent as one delayed snapshot.
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
    if (ports.reviewUpdates) offs.push(ports.reviewUpdates(sessionId, data => send('review_updated', data)));

    let heartbeat: NodeJS.Timeout | null = null;
    const stopHeartbeat = () => {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    };
    if (heartbeatMs > 0) {
      heartbeat = setInterval(() => {
        if (req.destroyed || res.destroyed || res.writableEnded) { stopHeartbeat(); return; }
        res.write('event: keepalive\ndata: {}\n\n');
        res.flush?.();
      }, heartbeatMs);
      heartbeat.unref();
    }

    const onClose = () => {
      stopHeartbeat();
      clearPendingUpdate();
      clearSideChatTimer();
      toolEvents.clear();
      if (ports.isRestarting?.(sessionId)) {
        // Close without `session_ended` so EventSource automatically reconnects to the replacement relay.
        res.end();
        return;
      }
      send('session_ended', {});
    };
    // Bridge and Prime events are application-level close; RPC and owned ACP
    // children report their stdio exit instead.
    if (session instanceof BridgeSession || session instanceof PrimeDaemonSession) {
      const remove = session instanceof BridgeSession ? session.once('close', onClose) : session.once('close', onClose);
      offs.push(typeof remove === 'function' ? remove : () => session.off('close', onClose));
    } else {
      sub('exit', onClose);
    }

    req.on('close', () => {
      stopHeartbeat();
      clearPendingUpdate();
      clearSideChatTimer();
      toolEvents.clear();
      for (const off of offs) { try { off(); } catch {} }
    });
  };
}
