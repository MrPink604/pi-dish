import type { ExtensionUIState, PromptOptions, RunningToolCall } from './contracts';
import { createExtensionUIState } from './extension-ui-state';
import { type ProtocolRecord } from './wire-protocol';
import { record as isRecord } from './helper-values';

export type SessionListener = (data: unknown) => void;

/**
 * Live-session surface shared by the stdio (RPC) and Prime daemon transports:
 * replay state, listener bookkeeping, and the prompt vocabulary both wire
 * protocols use. The bridge transport keeps Node's EventEmitter instead.
 */
export abstract class TransportSession {
  readonly runningToolCalls = new Map<string, RunningToolCall>();
  readonly extUIState: ExtensionUIState = createExtensionUIState();
  turnInProgress = false;
  /** Harness-reported; the /compact emulation also holds it to gate double-compaction. */
  compacting = false;
  /** Bumped on turn/message boundaries only: a per-poll timestamp made sessions look unread. */
  lastActivityAt = new Date();
  lastStats?: unknown;
  streamingAssistantMessage: ProtocolRecord | null = null;
  private listeners = new Map<string, SessionListener[]>();

  on(event: string, listener: SessionListener): () => void {
    const listeners = this.listeners.get(event);
    if (listeners) listeners.push(listener);
    else this.listeners.set(event, [listener]);
    return () => this.off(event, listener);
  }

  off(event: string, listener: SessionListener): void {
    const listeners = this.listeners.get(event);
    const index = listeners ? listeners.indexOf(listener) : -1;
    if (listeners && index >= 0) listeners.splice(index, 1);
  }

  once(event: string, listener: SessionListener): () => void {
    const off = this.on(event, (data) => { off(); listener(data); });
    return off;
  }

  protected emitEvent(event: string, data: unknown): void {
    // A listener may unsubscribe from inside its own callback, which splices
    // the live array; iterate a copy so no listener is skipped.
    for (const listener of [...(this.listeners.get(event) || [])]) listener(data);
  }

  /**
   * Rebuild the assistant snapshot when the harness sends delta-only
   * `message_update` frames, so every consumer keeps seeing a whole message.
   */
  protected assistantFrame(msg: ProtocolRecord): ProtocolRecord {
    if (msg.type === 'message_start' && isRecord(msg.message) && msg.message.role === 'assistant') {
      this.streamingAssistantMessage = structuredClone(msg.message);
    } else if (msg.type === 'message_update' && !msg.message && msg.assistantMessageEvent) {
      const event = isRecord(msg.assistantMessageEvent) ? msg.assistantMessageEvent : {};
      const snapshot = this.streamingAssistantMessage;
      if (event.type === 'done') this.streamingAssistantMessage = isRecord(event.message) ? structuredClone(event.message) : null;
      else if (event.type === 'error') this.streamingAssistantMessage = isRecord(event.error) ? structuredClone(event.error) : null;
      else if (snapshot) {
        const content: unknown[] = Array.isArray(snapshot.content) ? snapshot.content : (snapshot.content = []);
        const index = event.contentIndex;
        if (typeof index === 'number' && Number.isInteger(index) && index >= 0) {
          if (event.type === 'text_start') content[index] = { type: 'text', text: '' };
          else if (event.type === 'text_delta' && typeof event.delta === 'string') {
            const block = isRecord(content[index]) ? content[index] : {};
            if (block.type !== 'text' || typeof block.text !== 'string') content[index] = { type: 'text', text: event.delta };
            else block.text += event.delta;
          } else if (event.type === 'text_end' && typeof event.content === 'string') content[index] = { type: 'text', text: event.content };
          else if (event.type === 'thinking_start') content[index] = { type: 'thinking', thinking: '' };
          else if (event.type === 'thinking_delta' && typeof event.delta === 'string') {
            const block = isRecord(content[index]) ? content[index] : {};
            if (block.type !== 'thinking' || typeof block.thinking !== 'string') content[index] = { type: 'thinking', thinking: event.delta };
            else block.thinking += event.delta;
          } else if (event.type === 'thinking_end' && typeof event.content === 'string') content[index] = { type: 'thinking', thinking: event.content };
          else if (event.type === 'toolcall_end' && isRecord(event.toolCall)) content[index] = structuredClone(event.toolCall);
        }
      }
      if (this.streamingAssistantMessage) {
        return { ...msg, message: structuredClone(this.streamingAssistantMessage) };
      }
    }
    return msg;
  }

  /** The snapshot ends with the assistant message that carried it. */
  protected endAssistantMessage(msg: ProtocolRecord): void {
    if (msg.type === 'message_end' && isRecord(msg.message) && msg.message.role === 'assistant') {
      this.streamingAssistantMessage = null;
    }
  }

  abstract getSessionStats(): Promise<unknown>;

  _refreshStats(): void {
    this.getSessionStats().then(stats => { this.lastStats = stats; }).catch(() => {});
  }
}

/** A busy agent receives an undecorated prompt as steering; both protocols call that field streamingBehavior. */
export function promptParams(message: string, opts: PromptOptions, busy: boolean): ProtocolRecord {
  const params: ProtocolRecord = { message };
  if (opts.deliverAs) params.streamingBehavior = opts.deliverAs;
  else if (busy) params.streamingBehavior = 'steer';
  if (opts.images?.length) params.images = opts.images;
  return params;
}
