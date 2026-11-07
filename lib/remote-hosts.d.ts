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
/** Invalid entries skipped; first entry wins on a name clash. */
export declare function listRemotes(): Remote[];
export declare function getRemote(name: unknown): Remote | null;
/** Never surfaces a message or stderr text. */
export declare function errorCode(err: unknown): unknown;
/** The stderr text itself is discarded. */
export declare function classifySshStderr(text: unknown): SshErrorCode;
export declare function runDir(): string;
/** Lives in the 0700 run dir: no other user on a shared host. */
export declare function socketPathFor(name: string): string;
/**
 * Spawned as `ssh <argv>`, never a shell string. BatchMode keeps a passphrase
 * prompt from hanging; ExitOnForwardFailure makes a dead forward exit; keepalives
 * notice a silently dropped link. `launch` (deployed remotes) replaces `-N`.
 */
export declare function sshArgv(remote: SshRemote, socketPath?: string, launch?: string): string[];
/**
 * Exits EXIT_* before starting anything; otherwise replaces a host a dropped
 * session left holding the port (matched by bundle path in /proc, never pid
 * alone) and execs the bundle. stdout carries the ready line.
 * On Termux it also installs/schedules the satellite watchdog; the scheduler call
 * runs detached under a timeout because termux-api blocks forever without the
 * Termux:API app, and only success writes the `scheduled` marker.
 */
export declare function hostLaunchScript(hash: string, port: number): string;
/** Called on server close. */
export declare function shutdown(): void;
/**
 * Returns the raw ClientRequest so bodies stream both ways; the caller writes the
 * body, ends the request and handles 'response' / 'upgrade' / 'error'.
 */
export declare function request(target: Remote | string, options?: RemoteRequestOptions): Promise<http.ClientRequest>;
/**
 * Memoized for PROBE_TTL_MS on success; a failure stands until the backoff
 * ladder's next slot, so poll-driven callers can ask freely.
 */
export declare function probe(target: Remote | string, { force }?: ProbeOptions): Promise<ProbeResult>;
/**
 * Pure cache read (never dials or spawns), so the /hosts proxy request path can
 * consult it for free. null when absent or expired.
 */
export declare function reachability(target: Remote | string): ReachabilityResult | null;
/**
 * Real traffic failures (the /hosts proxy's dials) overwrite a cached reachable
 * result and advance the same ladder a failed probe would.
 */
export declare function noteTransportFailure(target: Remote | string, code?: unknown): void;
