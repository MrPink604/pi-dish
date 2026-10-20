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
    /** Hub-owned peer: bundle uploaded and started per ssh session. */
    deploy: boolean;
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
export declare const DEPLOY_IDLE_MS: number;
export declare const EXIT_TMUX_MISSING = 95;
export declare const EXIT_NODE_MISSING = 96;
export declare const EXIT_NEEDS_BUNDLE = 97;
export declare const EXIT_NEEDS_VAPID = 98;
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
 * the keepalives notice a silently dropped link. With `launch` (deployed
 * remotes) the session runs that command instead of `-N`.
 */
export declare function sshArgv(remote: SshRemote, socketPath?: string, launch?: string): string[];
/**
 * The deployed host's ssh command. Exits EXIT_NEEDS_BUNDLE / EXIT_NEEDS_VAPID
 * / EXIT_NODE_MISSING before starting anything; otherwise replaces a host a
 * silently dropped session left holding the port (matched by its bundle path
 * in /proc, never by pid alone) and execs the bundle. Host logs go to
 * ~/.pi/dish/host/host.log on the far side; stdout carries the ready line.
 *
 * On Termux it also refreshes the bundle's satellite watchdog in
 * ~/.pi/dish/satellite/, links it into Termux:Boot, and (re)schedules it with
 * termux-job-scheduler whenever its content changed. The scheduler call runs
 * detached under a timeout, because termux-api blocks forever without the
 * Termux:API app; only a successful call writes the `scheduled` marker.
 */
export declare function hostLaunchScript(hash: string, port: number): string;
/** Unpacks a bundle tarball from stdin into ~/.pi/dish/host/<hash>, marked complete only once whole. */
export declare function hostUploadScript(hash: string): string;
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
