import { decodeRenderMessage } from './message-data';
import type { RenderMessage } from './message-data';
import { record } from '../core/helper-values';
import { formatTime, formatTokens } from './helper-format';
import { sessionKey } from './helper-identity';
import type { HostEndpoint } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { ExtensionSession } from './extension-dialogs';
/** Stream event consumption does not confer the collaborators' other authority. */
export interface MessageStreamActivity {
  readonly turn: boolean;
  setCompacting(active: boolean): void;
  setTurn(active: boolean): void;
  endAbort(key: string): void;
}
export interface MessageStreamRenderer {
  user(message: RenderMessage, time: string): string;
  assistant(message: RenderMessage, time: string): string;
  upsertCustom(message: RenderMessage, options?: { streaming?: boolean }): void;
}
export interface MessageStreamRendering {
  queue(message: RenderMessage): void;
  cancel(): void;
}
export interface MessageStreamTools {
  append(value: unknown): void;
  update(value: unknown): void;
  finish(value: unknown): void;
  finishRunning(): void;
}
export interface MessageStreamDelivery {
  consume(key: string, content: unknown): boolean;
  render(value: unknown): void;
}
export interface MessageStreamExtensionUI {
  handle(value: unknown, session: ExtensionSession): void;
  resolve(id: unknown, session: ExtensionSession): void;
  reconcile(value: unknown, session: ExtensionSession): void;
  end(session: ExtensionSession): void;
}
export interface MessageStreamSideChat {
  /** Apply a snapshot emitted by this stream's session; foreign sessions ignore it. */
  apply(value: unknown, session: { id: string; host: string | null }): void;
}
function parseRecord(text: string): Record<string, unknown> { const value: unknown = JSON.parse(text); return record(value) ? value : {}; }
export function createMessageStream(options: {
  document: Document; sessionState: SessionState; endpoint: (host: string | null) => HostEndpoint; ticket: (host: HostEndpoint) => Promise<string>; source?: (url: string) => EventSource;
  activity: MessageStreamActivity; renderer: MessageStreamRenderer; streaming: MessageStreamRendering;
  tools: MessageStreamTools; delivery: MessageStreamDelivery; extensionUI: MessageStreamExtensionUI; sideChat: MessageStreamSideChat;
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
    // OMP can redeliver completed messages. Custom messages key on the full
    // payload (evolved details must reach upsertCustom); user/assistant key on
    // role/timestamp/content so metadata-only repeats still dedup.
    const seenMessageEnds = new Set<string>();
    const messageEndKey = (m: RenderMessage) => JSON.stringify(m.role === 'custom'
      ? [m.role, m.timestamp ?? null, m.content ?? null, m.errorMessage ?? null, m.customType ?? null, m.details ?? null]
      : [m.role, m.timestamp ?? null, m.content ?? null]);

    evtSource.onopen = () => { if (ownsStream()) options.status(''); };

    addOwnedListener('init', (e) => {
      try {
        const data = parseRecord(e.data);
        turnCleanupDone = !data.turnInProgress;
        // Stale dialogs for this session are pruned by the extension_ui_state
        // event that follows the connect replay — no per-init sweep needed.
        if (!data.turnInProgress) options.activity.endAbort(sessionKey(hostId, sessionId));
        // Set independently (auto-compaction runs inside a turn); compacting
        // first so the turn-off path doesn't wipe a live compaction's status.
        options.activity.setCompacting(!!data.compacting);
        options.activity.setTurn(!!data.turnInProgress);
        if (!data.turnInProgress) {
          // Incremental catch-up avoids a full-reload stall.
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
      // Incremental: a full reload stalls long sessions.
      options.catchup(owner);
      options.refresh();
      options.artifacts(owner); // the agent may have published pages mid-turn
      options.status('');
    };
    addOwnedListener('turn_end', handleTurnEnd);
    // An aborted/errored turn can end with agent_end and no turn_end; the guard
    // avoids double catch-up.
    addOwnedListener('agent_end', handleTurnEnd);

    addOwnedListener('message_update', (e) => {
      try {
        const message = decodeRenderMessage(parseRecord(e.data).message);
        if (message.role === 'custom') {
          renderer.upsertCustom(message, { streaming: true });
          return;
        }
        if (message.role !== 'assistant') return;
        // A late update for an already-ended message must not resurrect a
        // streaming bubble (it would never be stripped) or re-arm turn state.
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
        const container = document.getElementById('messages');
        if (!container) return;
        const messageKey = messageEndKey(message);
        if (seenMessageEnds.has(messageKey)) return;
        seenMessageEnds.add(messageKey);
        if (message.role === 'user') {
          // Skip pi's echo of the prompt this client already rendered optimistically.
          if (options.delivery.consume(sessionKey(hostId, sessionId), message.content)) {
            return;
          }
          // Mid-turn steer/follow-up or TUI prompt: inserted un-indexed; the turn_end
          // catch-up replaces un-indexed nodes with the indexed render.
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
        // Empty assistant shell before an interrupted-thinking marker: no ghost header.
        if (typeof message.content !== 'string' && message.content?.length === 0 && !message.errorMessage) {
          container.querySelectorAll('.message.assistant[data-streaming="true"]').forEach(el => el.remove());
          return;
        }
        // Stays un-indexed so the turn_end catch-up replaces it with the indexed
        // version without the text blinking out.
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

    addOwnedListener('side_chat', (e) => {
      try { options.sideChat.apply(parseRecord(e.data).sideChat, { id: sessionId, host: hostId }); } catch {}
    });

    // Dialog answered elsewhere (TUI or another browser) — dismiss ours.
    addOwnedListener('extension_ui_resolved', (e) => {
      try { options.extensionUI.resolve(parseRecord(e.data).id, { id: sessionId, host: hostId }); } catch {}
    });
    // Authoritative pending-dialog list sent after the reconnect replay; prunes
    // only this session's stale dialogs.
    addOwnedListener('extension_ui_state', (e) => {
      try {
        options.extensionUI.reconcile(JSON.parse(e.data), { id: sessionId, host: hostId });
      } catch {}
    });

    addOwnedListener('compaction_start', () => {
      options.activity.setCompacting(true);
    });
    addOwnedListener('compaction_end', (e) => {
      options.activity.setCompacting(false);
      // A manual compaction has no turn_end/agent_end, so its end is where a
      // compaction-only abort gate clears.
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
    // Tree navigation from any surface rewrote history: re-render from JSONL
    // (a duplicate reload after the UI's own branch POST is harmless).
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
      // A different transcript: never restore a stale DOM stash for that id.
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
