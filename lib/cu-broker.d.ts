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
export interface CuBrokerClient {
    socketPath(): string | null;
    available(): boolean;
    requestJson(method: 'GET' | 'POST', endpointPath: string, body?: unknown, options?: {
        timeoutMs?: number;
    }): Promise<CuBrokerResponse>;
    openEvents(onResponse: (res: http.IncomingMessage) => void, onError: (error: Error) => void): http.ClientRequest | null;
}
export declare function resolveCuBrokerSocket(): string | null;
export declare function isSocketPathLive(socketPath: string | null | undefined): socketPath is string;
export declare function createCuBrokerClient(options?: CuBrokerClientOptions): CuBrokerClient;
