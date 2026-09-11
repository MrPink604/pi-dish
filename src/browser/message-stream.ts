import { decodeRenderMessage } from './message-data';
import type { RenderMessage } from './message-data';
import { record } from './helper-values';
import { formatTime, formatTokens } from './helper-format';
import { sessionKey } from './helper-identity';
import type { HostEndpoint } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { createSessionActivity } from './session-activity';
import type { createMessageRenderer } from './message-render';
import type { createStreamingRenderer } from './streaming-render';
import type { createLiveTools } from './live-tools';
import type { createPromptDelivery } from './prompt-delivery';
import type { createExtensionUI } from './extension-ui';
function parseRecord(text: string): Record<string, unknown> { const value: unknown = JSON.parse(text); return record(value) ? value : {}; }
export function createMessageStream(options: {
  document: Document; sessionState: SessionState; endpoint: (host: string | null) => HostEndpoint; ticket: (host: HostEndpoint) => Promise<string>; source?: (url: string) => EventSource;
  activity: ReturnType<typeof createSessionActivity>; renderer: ReturnType<typeof createMessageRenderer>; streaming: ReturnType<typeof createStreamingRenderer>;
  tools: ReturnType<typeof createLiveTools>; delivery: ReturnType<typeof createPromptDelivery>; extensionUI: ReturnType<typeof createExtensionUI>;
  status: (message: string, type?: string) => void; catchup: (owner: SelectionOwner) => unknown; refresh: () => unknown; artifacts: (owner: SelectionOwner) => unknown;
  pinned: (container: HTMLElement) => boolean; follow: () => boolean; scroll: (container: HTMLElement) => void; jump: (container: HTMLElement) => void; highlight: (root: Element) => void;
  select: (id: string, options: { forceTranscriptReload: boolean; host: string | null }) => unknown;
  deleteCached: (key: string) => void; loadSessions: (query: undefined, options: { withPrevious: boolean }) => Promise<unknown>;
}) {
  const { document, sessionState, renderer, tools } = options;
  let source: EventSource | null = null, reconnect: ReturnType<typeof setTimeout> | null = null, connectionGeneration = 0, disposed = false;
  function ownsConnection(owner: SelectionOwner, target: Readonly<HostEndpoint>, generation: number) {
    return !disposed && generation === connectionGeneration && sessionState.ownsSelection(owner) && options.endpoint(owner.host).base === target.base;
  }
  function stop() { connectionGeneration++; if (reconnect) clearTimeout(reconnect); reconnect = null; source?.close(); source = null; }
  async function start(owner = sessionState.captureSelection()) {
    if (disposed || !owner || !sessionState.ownsSelection(owner)) return; stop();
    const generation = connectionGeneration, target = Object.freeze({ ...options.endpoint(owner.host) });
    const path = `/api/sessions/${encodeURIComponent(owner.id)}/stream`;
    if (!target.token) { open(target.base + path, owner, target, generation); return; }
    try {
      const ticket = await options.ticket(target); if (!ownsConnection(owner, target, generation)) return;
      open(`${target.base}${path}?ticket=${encodeURIComponent(ticket)}`, owner, target, generation);
    } catch { if (ownsConnection(owner, target, generation)) options.status('Stream failed', 'error'); }
  }
function open(url: string, owner: SelectionOwner, target: Readonly<HostEndpoint>, generation: number) {
  if (!ownsConnection(owner, target, generation)) return;
  const { id: sessionId, host: hostId } = owner;
  try {
    const evtSource = (options.source || (url => new EventSource(url)))(url);
    source = evtSource;
    const ownsStream = () => source === evtSource && ownsConnection(owner, target, generation);
    const addOwnedListener = (event: string, listener: (event: MessageEvent<string>) => void) => evtSource.addEventListener(event, event => {
      if (ownsStream() && event instanceof MessageEvent && typeof event.data === 'string') listener(event);
    });
    let switchSequence = 0;
    let turnCleanupDone = false;
    // OMP can deliver the same completed message event more than once. Keep
    // completion rendering idempotent for the whole turn, including a late
    // repeat after turn_end's JSONL catch-up has installed the indexed copy.
    // Two keys: the full key for custom messages (a redelivery with evolved
    // details must reach renderer.upsertCustom), and the core signature —
    // role/timestamp/content — for user/assistant, so a repeat that only
    // gained usage/details metadata still dedups. The core signature is also
    // what a late message_update for an already-finalized message carries
    // (timestamp is stamped at API-call start, content complete by the last
    // delta), which lets the update handler below refuse to resurrect a
    // streaming bubble for it.
    const seenMessageEnds = new Set<string>();
    const messageEndKey = (m: RenderMessage) => JSON.stringify(m.role === 'custom'
      ? [m.role, m.timestamp ?? null, m.content ?? null, m.errorMessage ?? null, m.customType ?? null, m.details ?? null]
      : [m.role, m.timestamp ?? null, m.content ?? null]);

    evtSource.onopen = () => { if (ownsStream()) options.status(''); };

    // Server sends current state on connect so we can catch up
    addOwnedListener('init', (e) => {
      try {
        const data = parseRecord(e.data);
        turnCleanupDone = !data.turnInProgress;
        // Stale dialogs for this session are pruned by the extension_ui_state
        // event that follows the connect replay — no per-init sweep needed.
        if (!data.turnInProgress) options.activity.endAbort(sessionKey(hostId, sessionId));
        // Both flags, independently: auto-compaction runs inside a turn
        // (both true), a TUI /compact has neither turn nor stream events yet
        // (compacting only), and a reconnect after either ended must clear
        // stale indicators (both false). options.activity.setCompacting first so the
        // turn-off path doesn't wipe status a live compaction still owns.
        options.activity.setCompacting(!!data.compacting);
        options.activity.setTurn(!!data.turnInProgress);
        if (data.compacting) options.status('Compacting context...', 'working');
        else if (data.turnInProgress) options.status('Waiting for response...', 'working');
        if (!data.turnInProgress) {
          // No turn running — incremental catch-up for any messages written
          // since our initial load (avoids full reload stall).
          options.catchup(owner);
        }
      } catch {}
    });

    addOwnedListener('stream_error', (e) => {
      try {
        const data = parseRecord(e.data || '{}');
        options.status(typeof data.error === 'string' && data.error || 'Stream error', 'error');
      } catch {
        options.status('Stream error', 'error');
      }
      stop();
    });

    addOwnedListener('turn_start', () => {
      seenMessageEnds.clear();
      turnCleanupDone = false;
      options.activity.setTurn(true);
    });

    const handleTurnEnd = () => {
      if (turnCleanupDone || !ownsStream()) return;
      turnCleanupDone = true;
      options.activity.endAbort(sessionKey(hostId, sessionId));
      options.activity.setTurn(false);
      options.streaming.cancel();
      tools.finishRunning();
      // Incrementally pull only new messages from JSONL — full reload
      // stalls long sessions.
      options.catchup(owner);
      options.refresh();
      options.artifacts(owner); // the agent may have published pages mid-turn
      options.status('');
    };
    addOwnedListener('turn_end', handleTurnEnd);
    // An aborted/errored turn can end with agent_end and no paired turn_end;
    // both server backends treat it as turn-terminating, so we must too. The
    // guard avoids double catch-up when turn_end already ran.
    addOwnedListener('agent_end', handleTurnEnd);

    // message_update streams text, thinking, and partial tool calls live —
    // rendered incrementally through the throttled streaming renderer.
    addOwnedListener('message_update', (e) => {
      try {
        const message = decodeRenderMessage(parseRecord(e.data).message);
        if (!message) return;
        if (message.role === 'custom') {
          renderer.upsertCustom(message, { streaming: true });
          return;
        }
        if (message.role !== 'assistant') return;
        // A redelivered/late update for a message whose message_end already
        // ran (OMP usage-enrichment repeats, options.delivery-timing corners) must not
        // resurrect a streaming bubble: the finalized render — or, post
        // turn_end, the indexed JSONL copy — is already on screen, and a
        // bubble created now would never be stripped again. It also must not
        // re-arm the turn state below.
        if (seenMessageEnds.size && seenMessageEnds.has(messageEndKey(message))) return;
        if (turnCleanupDone) seenMessageEnds.clear();
        turnCleanupDone = false;
        if (!options.activity.turn) options.activity.setTurn(true);
        options.streaming.queue(message);
      } catch (err) {}
    });

    addOwnedListener('message_end', (e) => {
      try {
        const message = decodeRenderMessage(parseRecord(e.data).message);
        if (!message) return;
        const container = document.getElementById('messages');
        if (!container) return;
        const messageKey = messageEndKey(message);
        if (seenMessageEnds.has(messageKey)) return;
        seenMessageEnds.add(messageKey);
        if (message.role === 'user') {
          // pi echoes every user message it processes — including the prompt
          // this client just rendered optimistically in sendMessage. Skip that
          // one echo or the prompt shows twice until the turn_end catch-up.
          if (options.delivery.consume(sessionKey(hostId, sessionId), message.content)) {
            return;
          }
          // A steer/follow-up pi just delivered mid-turn (or a prompt typed in
          // the TUI). Insert it un-indexed before the streaming placeholder
          // (if any); the turn_end JSONL catch-up strips un-indexed .message
          // nodes and re-inserts the authoritative indexed render, so this
          // never duplicates.
          const wasPinned = options.pinned(container);
          const streaming = container.querySelector('.message.assistant[data-streaming="true"]');
          const tmp = document.createElement('template');
          tmp.innerHTML = renderer.user(message, formatTime(message.timestamp || Date.now()));
          const el = tmp.content.firstElementChild;
          if (!el) return;
          if (streaming) streaming.before(el);
          else container.appendChild(el);
          if (wasPinned || options.follow()) options.scroll(container); else options.jump(container);
          return;
        }
        if (message.role === 'custom') {
          renderer.upsertCustom(message);
          return;
        }
        if (message.role !== 'assistant') return;
        options.streaming.cancel();
        // OMP ends an interrupted thinking turn with an empty assistant shell
        // before its interrupted-thinking custom marker. Keep the API entry
        // but do not flash a ghost π header in the live transcript.
        if (Array.isArray(message.content) && message.content.length === 0 && !message.errorMessage) {
          container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach(el => el.remove());
          return;
        }
        // Swap the streaming placeholder for the finalized render in place.
        // It stays un-indexed, so the turn_end JSONL catch-up replaces it
        // with the authoritative version (options.catchup strips all
        // .message:not([data-msg-index]) once indexed messages land) —
        // meanwhile the text never blinks out of the transcript.
        const wasPinned = options.pinned(container);
        const streaming = container.querySelectorAll('.message.assistant[data-streaming="true"]');
        const tmp = document.createElement('template');
        tmp.innerHTML = renderer.assistant(message, formatTime(message.timestamp || Date.now()));
        const finalEl = tmp.content.firstElementChild;
        if (!finalEl) return;
        if (streaming.length) streaming[streaming.length - 1].before(finalEl);
        else container.appendChild(finalEl);
        streaming.forEach(el => el.remove());
        options.highlight(finalEl);
        if (wasPinned) options.scroll(container); else options.jump(container);
      } catch (err) {}
    });

    addOwnedListener('tool_execution_start', (e) => {
      try {
        const data = parseRecord(e.data);
        tools.append(data);
      } catch (err) { console.error('tool_execution_start error:', err); }
    });

    addOwnedListener('tool_execution_update', (e) => {
      try {
        const data = parseRecord(e.data);
        tools.update(data);
      } catch (err) { console.error('tool_execution_update error:', err); }
    });

    addOwnedListener('tool_execution_end', (e) => {
      try {
        const data = parseRecord(e.data);
        tools.finish(data);
      } catch (err) { console.error('tool_execution_end error:', err); }
    });

    addOwnedListener('extension_ui_request', (e) => {
      try { options.extensionUI.handle(JSON.parse(e.data), { id: sessionId, host: hostId }); } catch (err) { console.error('extension_ui_request error:', err); }
    });

    addOwnedListener('queue_update', (e) => {
      try { options.delivery.render(JSON.parse(e.data)); } catch {}
    });

    // Dialog answered elsewhere (TUI or another browser) — dismiss ours.
    addOwnedListener('extension_ui_resolved', (e) => {
      try { options.extensionUI.resolve(parseRecord(e.data).id, { id: sessionId, host: hostId }); } catch {}
    });
    // Authoritative list of this session's pending dialogs, sent on (re)connect
    // after the replay burst. Prunes stashed dialogs that were answered or
    // dismissed while we were away (or orphaned by an idle session), without
    // touching other sessions' dialogs.
    addOwnedListener('extension_ui_state', (e) => {
      try {
        options.extensionUI.reconcile(JSON.parse(e.data), { id: sessionId, host: hostId });
      } catch {}
    });

    addOwnedListener('compaction_start', () => {
      options.status('Compacting context...', 'working');
      options.activity.setCompacting(true);
    });
    addOwnedListener('compaction_end', (e) => {
      options.activity.setCompacting(false);
      // A manual compaction has no turn_end/agent_end boundary. Whether Stop
      // won the race, compaction failed, or it completed first, its end is the
      // authoritative point where a compaction-only abort gate can clear.
      if (!options.activity.turn) options.activity.endAbort(sessionKey(hostId, sessionId));
      try {
        const data = parseRecord(e.data);
        if (data.errorMessage) {
          options.status('Compaction failed: ' + data.errorMessage, 'error');
          return;
        }
        if (data.aborted) {
          options.status('Compaction cancelled');
          return;
        }
        const r = record(data.result) ? data.result : null;
        // The bridge path knows tokensBefore but not the post-compaction size
        // (context tokens are unknown until the next LLM response).
        let msg = 'Compaction finished';
        if (r && typeof r.tokensBefore === 'number' && Number.isFinite(r.tokensBefore) && r.tokensBefore) {
          msg = typeof r.estimatedTokensAfter === 'number' && Number.isFinite(r.estimatedTokensAfter)
            ? `Compacted: ${formatTokens(r.tokensBefore)} → ~${formatTokens(r.estimatedTokensAfter)} tokens`
            : `Compacted (was ${formatTokens(r.tokensBefore)} tokens)`;
        }
        options.status(msg);
        options.refresh();
      } catch { options.status('Compaction finished'); }
    });
    // Tree navigation (from any surface — this UI, the TUI, another client)
    // rewrote the session's authoritative history: re-render the transcript
    // from the JSONL. The UI's own branch flow also reloads after its POST
    // resolves; a second forced reload of the same state is harmless.
    addOwnedListener('session_tree', () => {
      if (sessionState.currentSession && sessionState.currentSession.id === sessionId) {
        options.select(sessionId, { forceTranscriptReload: true, host: hostId });
      }
    });
    addOwnedListener('session_switch', (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      const nextId = record(data) && typeof data.sessionId === 'string' ? data.sessionId : '';
      const switchOwner = ++switchSequence;
      if (!nextId || nextId === sessionId) return;
      // The route identifies a different transcript even though the pane and
      // bridge socket stayed put. Never restore a prior DOM stash for that id:
      // the session may have changed since it was last viewed.
      options.deleteCached(sessionKey(hostId, nextId));
      void options.loadSessions(undefined, { withPrevious: true }).then(() => {
        if (!ownsStream() || switchOwner !== switchSequence || !sessionState.findSession(nextId, hostId)) return;
        options.select(nextId, { forceTranscriptReload: true, host: hostId });
      });
    });

    addOwnedListener('auto_retry_start', (e) => {
      try {
        const d = parseRecord(e.data);
        options.status(`Retrying (attempt ${d.attempt}/${d.maxAttempts})...`, 'working');
      } catch {}
    });
    addOwnedListener('auto_retry_end', (e) => {
      try {
        const d = parseRecord(e.data);
        if (d.success === false) options.status('Retry failed: ' + (d.finalError || 'unknown'), 'error');
      } catch {}
    });

    addOwnedListener('session_ended', () => {
      options.activity.endAbort(sessionKey(hostId, sessionId));
      options.activity.setCompacting(false);
      options.activity.setTurn(false);
      options.extensionUI.end({ id: sessionId, host: hostId });
      options.status('Session ended');
      options.refresh();
    });

    evtSource.onerror = () => {
      if (!ownsStream()) return;
      if (evtSource.readyState === EventSource.CLOSED) {
        options.status('Stream disconnected', 'error');
        if (reconnect) clearTimeout(reconnect);
        reconnect = setTimeout(() => { reconnect = null; if (ownsStream()) start(owner); }, 3000);
      }
    };
  } catch (err) {
    if (!ownsConnection(owner, target, generation)) return;
    console.error('Stream failed:', err);
    options.status('Stream failed', 'error');
  }
}

return { start, stop, get source() { return source; }, dispose() { if (disposed) return; stop(); disposed = true; } };
}
