// Generated from src/core/cu-broker.ts; edit that source and run npm run build:core.
import http = require('node:http');
export declare const DEFAULT_BROKER_TIMEOUT_MS = 8000;
export declare const TAKEOVER_BROKER_TIMEOUT_MS = 8000;
export interface CuBrokerResponse {
    status: number;
    body: unknown;
}
export interface CuBrokerClientOptions {
    /** Override socket path lookup (defaults to PI_DISH_CU_BROKER_SOCKET). */
    socketPath?: () => string | null;
}
export interface CuBrokerEventsOptions {
    /** Exact Last-Event-ID header value (e.g. `<generation>:<cursor>`). */
    readonly lastEventId?: string | null;
    /** Optional explicit broker generation for ordered SSE resume. */
    readonly generation?: string | null;
    /** Optional explicit non-negative broker cursor for ordered SSE resume. */
    readonly cursor?: number | null;
}
export interface CuBrokerClient {
    socketPath(): string | null;
    /** True when PI_DISH_CU_BROKER_SOCKET (or test seam) is configured — even if the socket file is temporarily missing. */
    configured(): boolean;
    /** True when the configured socket path currently exists as a live Unix socket. */
    available(): boolean;
    requestJson(method: 'GET' | 'POST', endpointPath: string, body?: unknown, options?: {
        timeoutMs?: number;
    }): Promise<CuBrokerResponse>;
    openEvents(onResponse: (res: http.IncomingMessage) => void, onError: (error: Error) => void, options?: CuBrokerEventsOptions): http.ClientRequest | null;
}
export declare function resolveCuBrokerSocket(): string | null;
export declare function isSocketPathLive(socketPath: string | null | undefined): socketPath is string;
export declare function createCuBrokerClient(options?: CuBrokerClientOptions): CuBrokerClient;
