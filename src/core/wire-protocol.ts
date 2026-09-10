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
