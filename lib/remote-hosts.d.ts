// Generated from src/core/remote-hosts.ts; edit that source and run npm run build:core.
import http = require('node:http');
export interface DirectRemote {
    name: string;
    kind: 'direct';
    origin: string;
    token: string | null;
}
export interface SshRemote {
    name: string;
    kind: 'ssh';
    sshDest: string;
    remoteHost: string;
    remotePort: number;
    token: string | null;
}
export type Remote = DirectRemote | SshRemote;
export interface RemoteRequestOptions {
    method?: string;
    path?: string;
    headers?: http.OutgoingHttpHeaders;
    upgrade?: boolean;
}
export interface RemoteDescriptor {
    hostId: string;
    label: string | null;
    version: string | null;
    capabilities: Record<string, true>;
}
export interface ReachableProbeResult {
    reachable: true;
    descriptor: RemoteDescriptor;
    at: number;
}
export interface UnreachableProbeResult {
    reachable: false;
    error: unknown;
    at: number;
}
export type ProbeResult = ReachableProbeResult | UnreachableProbeResult;
export type ReachabilityResult = ProbeResult & {
    until: number;
};
export interface ProbeOptions {
    force?: boolean;
}
export interface TransportError extends Error {
    transportCode: unknown;
}
export type SshErrorCode = 'ssh_host_key_failed' | 'ssh_auth_failed' | 'ssh_dns_failed' | 'ssh_connection_refused' | 'ssh_timeout' | 'ssh_forward_failed' | 'ssh_unreachable' | 'ssh_failed';
export declare const DEFAULT_REMOTE_PORT = 3333;
export declare const BACKOFF_LADDER: number[];
export declare const STABLE_RESET_MS = 30000;
export declare function isValidRemoteName(name: unknown): name is string;
/** Config entry -> normalized remote, or null when the entry is unusable. */
export declare function normalizeRemote(value: unknown): Remote | null;
/** Configured peers, invalid entries skipped, first entry wins on a name clash. */
export declare function listRemotes(): Remote[];
export declare function getRemote(name: unknown): Remote | null;
/** Network failure -> short code. Never surfaces a message or stderr text. */
export declare function errorCode(err: unknown): unknown;
/** ssh's own diagnostics, reduced to a class. The text itself is discarded. */
export declare function classifySshStderr(text: unknown): SshErrorCode;
export declare function runDir(): string;
/** Forwarded socket for a remote. 0700 dir: no other user on a shared host. */
export declare function socketPathFor(name: string): string;
/**
 * argv for the long-lived forward (spawned as `ssh <argv>`, never a shell
 * string). BatchMode keeps a passphrase prompt from hanging the spawn;
 * ExitOnForwardFailure means a dead forward exits instead of pretending;
 * the keepalives notice a silently dropped link.
 */
export declare function sshArgv(remote: SshRemote, socketPath?: string): string[];
/** Kill every ssh child. Hooked into the server's close (server.js). */
export declare function shutdown(): void;
/**
 * Open a request to a peer. Returns the raw ClientRequest so bodies stream
 * both ways — nothing here buffers a request or a response.
 *
 * The caller writes/pipes the body and ends the request, and handles
 * 'response' / 'upgrade' / 'error' itself.
 */
export declare function request(target: Remote | string, options?: RemoteRequestOptions): Promise<http.ClientRequest>;
/**
 * Reachability of one remote: `GET /api/host` through its transport.
 * Memoized for PROBE_TTL_MS on success; on failure the result stands until
 * the backoff ladder's next slot, so a poll-driven caller can ask freely.
 */
export declare function probe(target: Remote | string, { force }?: ProbeOptions): Promise<ProbeResult>;
/**
 * The memoized probe result, or null when there is none or it has expired.
 * A pure cache read: it never dials and never spawns a forward, so a caller
 * on the request path (the /hosts proxy) can consult it for free.
 */
export declare function reachability(target: Remote | string): ReachabilityResult | null;
/**
 * A transport failure seen outside probe() — the /hosts proxy's own dials.
 * Real traffic is fresher truth than a cached probe, so it overwrites a
 * reachable result and advances the same ladder a failed probe would.
 */
export declare function noteTransportFailure(target: Remote | string, code?: unknown): void;
