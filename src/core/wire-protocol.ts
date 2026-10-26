import type { SideChatState, SideChatTurn, SideChatTurnStatus } from './contracts';

/** Only envelope fields are validated here; feature payloads remain unknown. */
export type ProtocolRecord = Record<string, unknown>;
export interface CommandResponse {
  type: 'response';
  id?: string | number | null;
  success: boolean;
  data?: unknown;
  error?: string | null;
}
export type ResponseFrame = { kind: 'response'; response: CommandResponse };
export type RPCFrame = ResponseFrame | { kind: 'event'; event: string; data: ProtocolRecord };
export type BridgeFrame = ResponseFrame
  | { kind: 'hello'; hello: ProtocolRecord }
  | { kind: 'event'; event: string; data: unknown };

export function isRecord(value: unknown): value is ProtocolRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const SIDE_CHAT_TURN_STATUSES: readonly SideChatTurnStatus[] = ['running', 'complete', 'error', 'cancelled'];

function decodeSideChatTurn(value: unknown): SideChatTurn | null {
  if (!isRecord(value)
    || typeof value.id !== 'string' || !value.id
    || typeof value.question !== 'string'
    || typeof value.answer !== 'string'
    || !SIDE_CHAT_TURN_STATUSES.includes(value.status as SideChatTurnStatus)
    || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null;
  const turn: SideChatTurn = {
    id: value.id, question: value.question, answer: value.answer,
    status: value.status as SideChatTurnStatus, startedAt: value.startedAt, updatedAt: value.updatedAt,
  };
  // `error` is meaningful only on an errored turn; a non-string payload is
  // malformed, so the whole turn is dropped rather than half-adopted.
  if (value.error != null) {
    if (typeof value.error !== 'string') return null;
    turn.error = value.error;
  }
  return turn;
}

/**
 * Decode the side-chat snapshot carried by hello and the `side_chat` event.
 * A malformed root means "no chat"; a malformed turn is dropped so one bad
 * row cannot hide the rest of a chat.
 */
export function decodeSideChat(value: unknown): SideChatState {
  if (value == null) return null;
  if (!isRecord(value)
    || typeof value.id !== 'string' || !value.id
    || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
    || !Array.isArray(value.turns)) return null;
  const turns: SideChatTurn[] = [];
  for (const item of value.turns) {
    const turn = decodeSideChatTurn(item);
    if (turn) turns.push(turn);
  }
  return { id: value.id, createdAt: value.createdAt, turns };
}

function isResponse(value: ProtocolRecord): value is ProtocolRecord & CommandResponse {
  return value.type === 'response' && typeof value.success === 'boolean'
    && (value.id == null || typeof value.id === 'string' || (typeof value.id === 'number' && Number.isFinite(value.id)))
    && (value.error == null || typeof value.error === 'string');
}

/** RPC agent events carry their payload directly alongside type. */
export function decodeRPCFrame(value: unknown): RPCFrame | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !value.type) return null;
  if (value.type === 'response') return isResponse(value) ? { kind: 'response', response: value } : null;
  return { kind: 'event', event: value.type, data: value };
}

/** Hello ownership is still proved against the selected registry claim by BridgeSession. */
export function decodeBridgeFrame(value: unknown): BridgeFrame | null {
  if (!isRecord(value)) return null;
  if (value.type === 'response') return isResponse(value) ? { kind: 'response', response: value } : null;
  if (value.type === 'hello') return { kind: 'hello', hello: value };
  if (value.type === 'event' && typeof value.event === 'string' && value.event) {
    return { kind: 'event', event: value.event, data: value.data };
  }
  return null;
}
