// Generated from src/core/wire-protocol.ts; edit that source and run npm run build:core.
/** Only envelope fields are validated here; feature payloads remain unknown. */
export type ProtocolRecord = Record<string, unknown>;
export interface CommandResponse {
    type: 'response';
    id?: string | number | null;
    success: boolean;
    data?: unknown;
    error?: string | null;
}
export type ResponseFrame = {
    kind: 'response';
    response: CommandResponse;
};
export type RPCFrame = ResponseFrame | {
    kind: 'event';
    event: string;
    data: ProtocolRecord;
};
export type BridgeFrame = ResponseFrame | {
    kind: 'hello';
    hello: ProtocolRecord;
} | {
    kind: 'event';
    event: string;
    data: unknown;
};
export declare function isRecord(value: unknown): value is ProtocolRecord;
/** RPC agent events carry their payload directly alongside type. */
export declare function decodeRPCFrame(value: unknown): RPCFrame | null;
/** Hello ownership is still proved against the selected registry claim by BridgeSession. */
export declare function decodeBridgeFrame(value: unknown): BridgeFrame | null;
