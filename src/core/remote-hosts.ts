/**
 * Fleet transports: how this host reaches the peers listed in
 * ~/.pi/dish/settings.json `remotes` (TASKS/multi-host.md block 5).
 *
 * Two kinds, both request/response — there is no standing mesh and hosts
 * never gossip:
 *   { name, url, token? }        direct HTTP to a peer's tailnet/LAN address,
 *                                the peer's own token attached here.
 *   { name, sshDest, remotePort? } a lazily-spawned `ssh -N -L <unix socket>`
 *                                forward for peers only reachable by ssh; the
 *                                peer stays loopback-bound and ssh keys are
 *                                the credential.
 *   { name, sshDest, deploy: true } the same forward, but this hub also owns
 *                                the peer: it uploads its host bundle
 *                                (host-bundle.ts) and runs it as the ssh
 *                                session's command. The deployed host lives
 *                                only while that session does, presents a
 *                                per-session token read from stdin, and is
 *                                let go after DEPLOY_IDLE_MS without traffic
 *                                or working sessions. Its agents keep running
 *                                in tmux on the far side.
 *
 * `name` becomes a path segment under /hosts/<name>/api, so it is validated
 * hard; anything malformed is skipped rather than thrown, because one bad
 * fleet-map line must not take the server's settings down with it.
 *
 * HOME is resolved per call (lib/dish-store.js rules) so a test's temp HOME
 * gets its own remotes, run dir and probe state.
 *
 * Reachability is memoized, not polled: pi-dish is poll-driven already, so a
 * probe result is cached for a few seconds on success and gated behind a
 * backoff ladder on failure. The only timer is a deployed forward's idle
 * check, which never dials anything new.
 *
 * ssh stderr is never logged or returned: it carries host names, key paths
 * and auth detail. It is classified into a short code and the text dropped.
 */
import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import crypto = require('node:crypto');
import fs = require('node:fs');
import http = require('node:http');
import https = require('node:https');
import path = require('node:path');
import type { Readable, Writable } from 'node:stream';
import { dishDir } from './dish-store';
import { hostBundle, type HostBundle } from './host-bundle';
import { readVapidKeys } from './push-notifications';
import { isRecord } from './wire-protocol';

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
export type ReachabilityResult = ProbeResult & { until: number };

export interface ProbeOptions {
  force?: boolean;
}

export interface TransportError extends Error {
  transportCode: unknown;
}

export type SshErrorCode =
  | 'ssh_host_key_failed'
  | 'ssh_auth_failed'
  | 'ssh_dns_failed'
  | 'ssh_connection_refused'
  | 'ssh_timeout'
  | 'ssh_forward_failed'
  | 'ssh_unreachable'
  | 'ssh_failed';

interface ForwardState {
  key: string;
  socketPath: string;
  child: ChildProcess | null;
  dead: boolean;
  /** Released on purpose (idle or shutdown): its exit is not a failure. */
  closed: boolean;
  error: unknown;
  retryAt: number;
  ready: Promise<string> | null;
  /** Deployed forwards: the bearer the far host accepts, and traffic bookkeeping. */
  token: string | null;
  lastUse: number;
  idleTimer: NodeJS.Timeout | null;
}

interface RemoteState {
  probe: ProbeResult | null;
  probeUntil: number;
  inFlight: Promise<ProbeResult> | null;
  failures: number;
  reachableSince: number;
  forward: ForwardState | null;
  forwardFailures: number;
}

type PendingProbeResult = Omit<ReachableProbeResult, 'at'> | Omit<UnreachableProbeResult, 'at'>;

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const DEFAULT_REMOTE_PORT = 3333;
const PROBE_TIMEOUT_MS = 2500;
const PROBE_TTL_MS = 10_000;
export const BACKOFF_LADDER = [3000, 4000, 8000, 16_000];
// A peer must be *continuously* reachable this long before its failure count
// is forgiven: a flapper (up two seconds, down again) has to keep climbing the
// ladder, or every brief recovery re-dials it at the 3s slot forever.
export const STABLE_RESET_MS = 30_000;
const FORWARD_READY_TIMEOUT_MS = 8000;
const FORWARD_POLL_MS = 50;
// A deployed host includes ssh connect plus a cold node start on a phone CPU;
// an upload carries the whole bundle over a possibly slow link.
const DEPLOY_READY_TIMEOUT_MS = 90_000;
const DEPLOY_UPLOAD_TIMEOUT_MS = 300_000;
export const DEPLOY_IDLE_MS = 10 * 60_000;
const DEPLOY_IDLE_CHECK_MS = 60_000;
// Exit statuses of hostLaunchScript() before the host starts.
export const EXIT_TMUX_MISSING = 95;
export const EXIT_NODE_MISSING = 96;
export const EXIT_NEEDS_BUNDLE = 97;
export const EXIT_NEEDS_VAPID = 98;
const HOST_READY_RE = /pi-dish running at /;
const MAX_DESCRIPTOR_BYTES = 64 * 1024;

// --- config ---------------------------------------------------------------

function settingsFile(): string {
  return path.join(dishDir(), 'settings.json');
}

function readRemotesSetting(): unknown[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const remotes: unknown = raw && typeof raw === 'object' && 'remotes' in raw ? raw.remotes : undefined;
    return Array.isArray(remotes) ? remotes : [];
  } catch {
    return [];
  }
}

export function isValidRemoteName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name);
}

/** Config entry -> normalized remote, or null when the entry is unusable. */
export function normalizeRemote(value: unknown): Remote | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!isValidRemoteName(name)) return null;
  const token = typeof entry.token === 'string' && entry.token.trim() ? entry.token.trim() : null;

  if (typeof entry.url === 'string' && entry.url.trim()) {
    let url: URL;
    try { url = new URL(entry.url.trim()); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return { name, kind: 'direct', origin: url.origin, token };
  }

  if (typeof entry.sshDest === 'string' && entry.sshDest.trim()) {
    const remotePort = entry.remotePort === undefined || entry.remotePort === null
      ? DEFAULT_REMOTE_PORT : Number(entry.remotePort);
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return null;
    const deploy = entry.deploy === true;
    // remoteHost covers peers bound to a specific interface (a tailnet or
    // LAN IP) instead of loopback — the forward's far end must match the
    // peer's actual bind address. A deployed host always binds loopback.
    const remoteHost = !deploy && typeof entry.remoteHost === 'string' && entry.remoteHost.trim()
      ? entry.remoteHost.trim() : '127.0.0.1';
    if (/[\s:]/.test(remoteHost)) return null;
    // A token is not part of the ssh shape (the hop authenticates), but an
    // explicitly configured one is honored: a peer that *does* run with a
    // token would otherwise 401 every proxied request. A deployed host gets
    // a fresh token for every ssh session instead.
    return { name, kind: 'ssh', sshDest: entry.sshDest.trim(), remotePort, remoteHost, token: deploy ? null : token, deploy };
  }

  return null;
}

/** Configured peers, invalid entries skipped, first entry wins on a name clash. */
export function listRemotes(): Remote[] {
  const out: Remote[] = [];
  const seen = new Set<string>();
  for (const entry of readRemotesSetting()) {
    const remote = normalizeRemote(entry);
    if (!remote || seen.has(remote.name)) continue;
    seen.add(remote.name);
    out.push(remote);
  }
  return out;
}

export function getRemote(name: unknown): Remote | null {
  if (!isValidRemoteName(name)) return null;
  return listRemotes().find((r) => r.name === name) || null;
}

// --- per-remote state -----------------------------------------------------

// Keyed by dish dir as well as name: a test's temp HOME is a different fleet,
// and its ssh sockets live in a different run dir.
const states = new Map<string, RemoteState>();

function stateFor(name: string): RemoteState {
  const key = `${dishDir()}\u0000${name}`;
  let st = states.get(key);
  if (!st) {
    st = { probe: null, probeUntil: 0, inFlight: null, failures: 0, reachableSince: 0, forward: null, forwardFailures: 0 };
    states.set(key, st);
  }
  return st;
}

function backoffMs(failures: number): number {
  return BACKOFF_LADDER[Math.min(failures, BACKOFF_LADDER.length - 1)];
}

// --- errors ---------------------------------------------------------------

function transportError(code: unknown): TransportError {
  const err = new Error(`remote transport: ${code}`) as TransportError;
  err.transportCode = code;
  return err;
}

/** Network failure -> short code. Never surfaces a message or stderr text. */
export function errorCode(err: unknown): unknown {
  // Preserve legacy property access and truthy passthrough without claiming
  // an external transportCode is one of our own short string codes.
  const failure = err as { transportCode?: unknown; code?: unknown } | null | undefined;
  if (failure && failure.transportCode) return failure.transportCode;
  const code = failure && failure.code;
  switch (code) {
    case 'ECONNREFUSED': return 'connection_refused';
    case 'ENOENT': return 'no_forward';
    case 'EACCES': case 'EPERM': return 'forbidden';
    case 'ETIMEDOUT': case 'ESOCKETTIMEDOUT': return 'timeout';
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'dns_failed';
    case 'EHOSTUNREACH': case 'ENETUNREACH': return 'unreachable';
    case 'ECONNRESET': case 'EPIPE': return 'connection_lost';
    default: break;
  }
  if (typeof code === 'string' && (code.startsWith('ERR_TLS') || code.startsWith('CERT_') || code.startsWith('UNABLE_TO_'))) {
    return 'tls_failed';
  }
  return 'unreachable';
}

/** ssh's own diagnostics, reduced to a class. The text itself is discarded. */
export function classifySshStderr(text: unknown): SshErrorCode {
  const s = String(text || '');
  if (/host key verification failed/i.test(s)) return 'ssh_host_key_failed';
  if (/permission denied|publickey|password|authentication/i.test(s)) return 'ssh_auth_failed';
  if (/could not resolve hostname|name or service not known|nodename nor servname/i.test(s)) return 'ssh_dns_failed';
  if (/connection refused/i.test(s)) return 'ssh_connection_refused';
  if (/timed out/i.test(s)) return 'ssh_timeout';
  if (/forward|bind|cannot listen/i.test(s)) return 'ssh_forward_failed';
  if (/no route to host|network is unreachable/i.test(s)) return 'ssh_unreachable';
  return 'ssh_failed';
}

// --- ssh forwards ---------------------------------------------------------

export function runDir(): string {
  return path.join(dishDir(), 'run');
}

/** Forwarded socket for a remote. 0700 dir: no other user on a shared host. */
export function socketPathFor(name: string): string {
  return path.join(runDir(), `${name}.sock`);
}

/**
 * argv for the long-lived forward (spawned as `ssh <argv>`, never a shell
 * string). BatchMode keeps a passphrase prompt from hanging the spawn;
 * ExitOnForwardFailure means a dead forward exits instead of pretending;
 * the keepalives notice a silently dropped link. With `launch` (deployed
 * remotes) the session runs that command instead of `-N`.
 */
export function sshArgv(remote: SshRemote, socketPath = socketPathFor(remote.name), launch?: string): string[] {
  const forward = [
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-L', `${socketPath}:${remote.remoteHost}:${remote.remotePort}`,
  ];
  return launch === undefined ? ['-N', ...forward, remote.sshDest] : ['-T', ...forward, remote.sshDest, launch];
}

// Android/Termux sessions started by sshd may lack the app's environment:
// its bin dir, a writable TMPDIR, and the exec shim that makes `#!/usr/bin/env`
// shebangs work. Elsewhere this is a no-op.
const TERMUX_ENV = [
  'if [ -d /data/data/com.termux/files/usr ]; then',
  ': "${PREFIX:=/data/data/com.termux/files/usr}"; : "${TMPDIR:=$PREFIX/tmp}"; export PREFIX TMPDIR;',
  'case ":$PATH:" in *":$PREFIX/bin:"*) ;; *) PATH="$PREFIX/bin:$PATH"; export PATH ;; esac;',
  'if [ -z "$LD_PRELOAD" ]; then for l in libtermux-exec-ld-preload.so libtermux-exec.so; do',
  'if [ -f "$PREFIX/lib/$l" ]; then LD_PRELOAD="$PREFIX/lib/$l"; export LD_PRELOAD; break; fi; done; fi;',
  'fi;',
].join(' ');

/**
 * The deployed host's ssh command. Exits EXIT_NEEDS_BUNDLE / EXIT_NEEDS_VAPID
 * / EXIT_NODE_MISSING before starting anything; otherwise replaces a host a
 * silently dropped session left holding the port (matched by its bundle path
 * in /proc, never by pid alone) and execs the bundle. Host logs go to
 * ~/.pi/dish/host/host.log on the far side; stdout carries the ready line.
 */
export function hostLaunchScript(hash: string, port: number): string {
  const script = [
    TERMUX_ENV,
    'B="$HOME/.pi/dish/host";',
    `D="$B/${hash}";`,
    `[ -f "$D/.complete" ] || exit ${EXIT_NEEDS_BUNDLE};`,
    `[ -f "$HOME/.pi/dish/vapid.json" ] || exit ${EXIT_NEEDS_VAPID};`,
    `command -v node >/dev/null 2>&1 || exit ${EXIT_NODE_MISSING};`,
    // Agents must outlive this host, so they run in hidden tmux, never as children.
    `command -v tmux >/dev/null 2>&1 || exit ${EXIT_TMUX_MISSING};`,
    // install.sh's discovery links, pointed at this bundle; a real directory is never replaced.
    'l() { mkdir -p "${2%/*}"; if [ -L "$2" ] || [ ! -e "$2" ]; then ln -sfn "$1" "$2"; fi; };',
    'l "$D/extensions/pi-dish-bridge" "$HOME/.pi/agent/extensions/pi-dish-bridge";',
    'for s in "$D"/skills/*/SKILL.md; do s="${s%/SKILL.md}"; l "$s" "$HOME/.pi/agent/skills/${s##*/}"; done;',
    'if command -v omp >/dev/null 2>&1; then l "$D/extensions/pi-dish-bridge-omp" "$HOME/.omp/agent/extensions/pi-dish-bridge-omp";',
    'for s in "$D"/skills/*/SKILL.md; do s="${s%/SKILL.md}"; l "$s" "$HOME/.omp/agent/skills/${s##*/}"; done; fi;',
    'P="$B/host.pid";',
    'if [ -f "$P" ]; then o=$(cat "$P"); if [ -n "$o" ] && grep -qa pi-dish-host "/proc/$o/cmdline" 2>/dev/null; then',
    'kill "$o" 2>/dev/null; i=0; while [ $i -lt 50 ] && kill -0 "$o" 2>/dev/null; do sleep 0.1; i=$((i+1)); done; fi; fi;',
    'echo $$ > "$P";',
    'find "$B" -mindepth 1 -maxdepth 1 -type d ! -name "${D##*/}" -mtime +7 -exec rm -rf {} + 2>/dev/null;',
    'mv -f "$B/host.log" "$B/host.log.1" 2>/dev/null; cd "$HOME";',
    `PORT=${port} HOST=127.0.0.1 PI_DISH_HEADLESS=tmux exec node "$D/lib/pi-dish-host.js" 2>"$B/host.log"`,
  ].join(' ');
  return `sh -c '${script}'`;
}

/** Unpacks a bundle tarball from stdin into ~/.pi/dish/host/<hash>, marked complete only once whole. */
export function hostUploadScript(hash: string): string {
  const script = [
    TERMUX_ENV,
    'set -e; B="$HOME/.pi/dish/host"; mkdir -p "$B"; rm -rf "$B"/.incoming-*;',
    'T="$B/.incoming-$$"; mkdir "$T"; tar -xzf - -C "$T"; touch "$T/.complete";',
    `rm -rf "$B/${hash}"; mv "$T" "$B/${hash}"`,
  ].join(' ');
  return `sh -c '${script}'`;
}

/** Installs this hub's VAPID key file from stdin unless the far side already has one. */
const VAPID_INSTALL_SCRIPT = `sh -c '${[
  'set -e; umask 077; F="$HOME/.pi/dish/vapid.json"; mkdir -p "$HOME/.pi/dish";',
  '[ -f "$F" ] || { cat > "$F.tmp"; mv "$F.tmp" "$F"; }',
].join(' ')}'`;

function forwardKey(remote: SshRemote): string {
  return `${remote.sshDest}\u0000${remote.remoteHost}\u0000${remote.remotePort}\u0000${remote.deploy}`;
}

function ensureForward(remote: SshRemote): Promise<string> {
  const st = stateFor(remote.name);
  const fwd = st.forward;
  // spawnForward installs ready synchronously before a caller can reuse it.
  if (fwd && !fwd.dead && fwd.key === forwardKey(remote)) return fwd.ready!;
  // A forward that just died stays down for its backoff slot rather than
  // being respawned by every request that arrives behind it.
  if (fwd && fwd.dead && fwd.key === forwardKey(remote) && Date.now() < fwd.retryAt) {
    return Promise.reject(transportError(fwd.error || 'ssh_failed'));
  }
  return spawnForward(remote);
}

function closeForward(st: RemoteState, forward: ForwardState): void {
  forward.closed = true;
  clearInterval(forward.idleTimer ?? undefined);
  if (forward.child) { try { forward.child.kill('SIGTERM'); } catch {} }
  try { fs.unlinkSync(forward.socketPath); } catch {}
  if (st.forward === forward) st.forward = null;
}

function spawnForward(remote: SshRemote): Promise<string> {
  const st = stateFor(remote.name);
  if (st.forward) closeForward(st, st.forward);

  const socketPath = socketPathFor(remote.name);
  const forward: ForwardState = {
    key: forwardKey(remote), socketPath, child: null, dead: false, closed: false, error: null, retryAt: 0, ready: null,
    token: null, lastUse: Date.now(), idleTimer: null,
  };
  st.forward = forward;

  const fail = (code: unknown): void => {
    forward.error = forward.error || code;
    if (!forward.dead) {
      forward.dead = true;
      forward.retryAt = Date.now() + backoffMs(st.forwardFailures);
      st.forwardFailures = Math.min(st.forwardFailures + 1, BACKOFF_LADDER.length - 1);
    }
  };

  try {
    fs.mkdirSync(runDir(), { recursive: true, mode: 0o700 });
    fs.chmodSync(runDir(), 0o700);
    // A socket left behind by a killed forward makes ssh refuse to bind.
    try { fs.unlinkSync(socketPath); } catch {}
  } catch (e) {
    fail(errorCode(e));
    forward.ready = Promise.reject(transportError(forward.error));
    forward.ready.catch(() => {});
    return forward.ready;
  }

  if (remote.deploy) {
    forward.ready = deployForward(remote, st, forward, fail);
    forward.ready.catch(() => {});
    return forward.ready;
  }

  let child: ChildProcessByStdio<null, null, Readable>;
  try {
    child = spawn('ssh', sshArgv(remote, socketPath), { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch {
    fail('ssh_unavailable');
    forward.ready = Promise.reject(transportError(forward.error));
    forward.ready.catch(() => {});
    return forward.ready;
  }
  forward.child = child;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: unknown) => { forward.error = classifySshStderr(chunk); });
  child.on('error', () => fail('ssh_unavailable'));
  child.on('exit', () => fail(forward.error || 'ssh_failed'));

  forward.ready = new Promise<string>((resolve, reject) => {
    const deadline = Date.now() + FORWARD_READY_TIMEOUT_MS;
    const poll = (): void => {
      if (forward.dead) return reject(transportError(forward.error || 'ssh_failed'));
      if (fs.existsSync(socketPath)) {
        st.forwardFailures = 0;
        return resolve(socketPath);
      }
      if (Date.now() > deadline) {
        fail('ssh_timeout');
        try { child.kill('SIGTERM'); } catch {}
        return reject(transportError('ssh_timeout'));
      }
      setTimeout(poll, FORWARD_POLL_MS).unref();
    };
    poll();
  });
  forward.ready.catch(() => {});
  return forward.ready;
}

/** One remote command whose stdin is `input`; resolves on exit 0. */
function runRemote(remote: SshRemote, script: string, input: Buffer | Readable, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let error: unknown = null;
    let settled = false;
    const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', remote.sshDest, script], { stdio: ['pipe', 'ignore', 'pipe'] });
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve();
      else reject(transportError(error || 'host_deploy_failed'));
    };
    const timer = setTimeout(() => { error = 'ssh_timeout'; try { child.kill('SIGTERM'); } catch {} }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: unknown) => { error = classifySshStderr(chunk); });
    child.stdin.on('error', () => {});
    child.on('error', () => { error = 'ssh_unavailable'; finish(false); });
    child.on('close', (code: number | null) => finish(code === 0));
    if (Buffer.isBuffer(input)) child.stdin.end(input);
    else input.pipe(child.stdin);
  });
}

async function uploadBundle(remote: SshRemote, bundle: HostBundle): Promise<void> {
  const tar = spawn('tar', ['-C', bundle.dir, '-czf', '-', '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const packed = new Promise<void>((resolve, reject) => {
    tar.on('error', () => reject(transportError('host_bundle_failed')));
    tar.on('close', (code: number | null) => (code === 0 ? resolve() : reject(transportError('host_bundle_failed'))));
  });
  try {
    await Promise.all([runRemote(remote, hostUploadScript(bundle.hash), tar.stdout, DEPLOY_UPLOAD_TIMEOUT_MS), packed]);
  } finally {
    try { tar.kill('SIGTERM'); } catch {}
  }
}

/**
 * Start the deployed host as the forward's ssh command: 'ready' once it
 * announced itself and the local socket exists, or the exit status it ended
 * with before that. Exiting later is the forward dying (`fail`).
 */
function startHost(remote: SshRemote, forward: ForwardState, hash: string, fail: (code: unknown) => void): Promise<'ready' | number | null> {
  return new Promise((resolve, reject) => {
    try { fs.unlinkSync(forward.socketPath); } catch {}
    const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(
      'ssh', sshArgv(remote, forward.socketPath, hostLaunchScript(hash, remote.remotePort)), { stdio: ['pipe', 'pipe', 'pipe'] });
    forward.child = child;
    let settled = false;
    let announced = false;
    let stdoutTail = '';
    const settle = (outcome: 'ready' | number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch {}
      reject(transportError('ssh_timeout'));
    }, DEPLOY_READY_TIMEOUT_MS);
    const poll = (): void => {
      if (settled) return;
      if (fs.existsSync(forward.socketPath)) settle('ready');
      else setTimeout(poll, FORWARD_POLL_MS).unref();
    };
    // The token is the first stdin line; stdin then stays open for the
    // session's lifetime, and its end is what stops the host.
    child.stdin.on('error', () => {});
    child.stdin.write(`${forward.token}\n`);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (announced) return;
      stdoutTail = (stdoutTail + chunk).slice(-4096);
      if (HOST_READY_RE.test(stdoutTail)) { announced = true; poll(); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: unknown) => { forward.error = classifySshStderr(chunk); });
    child.on('error', () => { forward.error = 'ssh_unavailable'; settle(null); });
    child.on('exit', (code: number | null) => {
      if (!settled) settle(code);
      else if (!forward.closed) fail(forward.error || 'host_exited');
    });
  });
}

/** GET /api/sessions on the deployed host: does anything still need it running? */
function hostBusy(remote: SshRemote, forward: ForwardState): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.request({
      socketPath: forward.socketPath, method: 'GET', path: '/api/sessions', timeout: 5000,
      headers: { accept: 'application/json', authorization: `Bearer ${forward.token}`, host: `${remote.remoteHost}:${remote.remotePort}` },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('error', () => resolve(false));
      res.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(body);
          const active = isRecord(parsed) ? parsed.active : null;
          resolve(Array.isArray(active) && active.some(row => isRecord(row) && (row.turnInProgress === true || row.askPending === true)));
        } catch { resolve(false); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function deployForward(remote: SshRemote, st: RemoteState, forward: ForwardState, fail: (code: unknown) => void): Promise<string> {
  try {
    let bundle: HostBundle;
    try { bundle = await hostBundle(); } catch { throw transportError('host_bundle_failed'); }
    readVapidKeys();
    const vapid = fs.readFileSync(path.join(dishDir(), 'vapid.json'));
    for (let attempt = 0; attempt < 3 && !forward.closed; attempt++) {
      forward.token = crypto.randomBytes(32).toString('hex');
      const outcome = await startHost(remote, forward, bundle.hash, fail);
      if (outcome === 'ready') {
        st.forwardFailures = 0;
        forward.lastUse = Date.now();
        forward.idleTimer = setInterval(() => {
          if (forward.closed || forward.dead) { clearInterval(forward.idleTimer!); return; }
          if (Date.now() - forward.lastUse < DEPLOY_IDLE_MS) return;
          void hostBusy(remote, forward).then((busy) => {
            if (!busy && Date.now() - forward.lastUse >= DEPLOY_IDLE_MS) closeForward(st, forward);
          });
        }, DEPLOY_IDLE_CHECK_MS);
        forward.idleTimer.unref();
        return forward.socketPath;
      }
      if (outcome === EXIT_NEEDS_BUNDLE) await uploadBundle(remote, bundle);
      else if (outcome === EXIT_NEEDS_VAPID) await runRemote(remote, VAPID_INSTALL_SCRIPT, vapid, DEPLOY_READY_TIMEOUT_MS);
      else if (outcome === EXIT_NODE_MISSING) throw transportError('host_node_missing');
      else if (outcome === EXIT_TMUX_MISSING) throw transportError('host_tmux_missing');
      else throw transportError(forward.error || 'host_exited');
    }
    throw transportError(forward.closed ? 'ssh_failed' : 'host_deploy_failed');
  } catch (error) {
    if (!forward.closed) fail(errorCode(error));
    try { forward.child?.kill('SIGTERM'); } catch {}
    throw transportError(forward.error || errorCode(error));
  }
}

/** Kill every ssh child. Hooked into the server's close (server.js). */
export function shutdown(): void {
  for (const st of states.values()) {
    if (st.forward) closeForward(st, st.forward);
  }
}

// --- requests -------------------------------------------------------------

// Never forwarded upstream: the caller's credential (the *hub's* token is not
// the peer's, and a peer must never see it) and framing headers node owns.
const DROPPED_REQUEST_HEADERS: Record<string, true> = {
  authorization: true, host: true, connection: true, 'keep-alive': true, 'transfer-encoding': true,
  te: true, trailer: true, 'upgrade-insecure-requests': true, 'proxy-authorization': true, 'proxy-authenticate': true,
  // The hub already ran the browser-facing origin check; a peer applying its
  // own allowlist to the hub's origin would refuse legitimate proxied calls.
  origin: true,
};

function outboundHeaders(headers: http.OutgoingHttpHeaders, token: string | null, { upgrade = false }: Pick<RemoteRequestOptions, 'upgrade'> = {}): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined) continue;
    if (DROPPED_REQUEST_HEADERS[key.toLowerCase()] === true) continue;
    out[key] = value;
  }
  // A WebSocket handshake is the one case where the hop-by-hop framing *is*
  // the request: without Connection: Upgrade the peer's http server never
  // emits its own upgrade event and answers with a plain response.
  if (upgrade) out.connection = 'Upgrade';
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

/**
 * Open a request to a peer. Returns the raw ClientRequest so bodies stream
 * both ways — nothing here buffers a request or a response.
 *
 * The caller writes/pipes the body and ends the request, and handles
 * 'response' / 'upgrade' / 'error' itself.
 */
export async function request(target: Remote | string, options: RemoteRequestOptions = {}): Promise<http.ClientRequest> {
  const remote = target && typeof target === 'object' ? target : getRemote(target);
  if (!remote) throw transportError('unknown_host');
  const { method = 'GET', path: reqPath = '/', headers = {}, upgrade = false } = options;

  if (remote.kind === 'ssh') {
    const socketPath = await ensureForward(remote);
    const forward = stateFor(remote.name).forward;
    // Real traffic keeps a deployed host from being let go as idle.
    if (forward) forward.lastUse = Date.now();
    const token = remote.deploy ? forward?.token ?? null : remote.token;
    return http.request({
      socketPath,
      method,
      path: reqPath,
      headers: { ...outboundHeaders(headers, token, { upgrade }), host: `${remote.remoteHost}:${remote.remotePort}` },
    });
  }

  const url = new URL(remote.origin);
  const secure = url.protocol === 'https:';
  return (secure ? https : http).request({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (secure ? 443 : 80),
    method,
    path: reqPath,
    headers: { ...outboundHeaders(headers, remote.token, { upgrade }), host: url.host },
  });
}

// --- reachability ---------------------------------------------------------

function sanitizeDescriptor(value: unknown): RemoteDescriptor | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.hostId !== 'string' || !data.hostId) return null;
  const capabilities: Record<string, true> = {};
  if (data.capabilities && typeof data.capabilities === 'object') {
    for (const [key, value] of Object.entries(data.capabilities)) if (value === true) capabilities[key] = true;
  }
  return {
    hostId: data.hostId,
    label: typeof data.label === 'string' ? data.label : null,
    version: typeof data.version === 'string' ? data.version : null,
    capabilities,
  };
}

function probeNow(remote: Remote): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let req: http.ClientRequest | null = null;
    const finish = (result: PendingProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) { try { req.destroy(); } catch {} }
      resolve({ ...result, at: Date.now() });
    };
    // One deadline over the whole probe, including a cold ssh forward.
    const timer = setTimeout(() => finish({ reachable: false, error: 'timeout' }), PROBE_TIMEOUT_MS);

    (async () => {
      try {
        req = await request(remote, { method: 'GET', path: '/api/host', headers: { accept: 'application/json' } });
      } catch (e) {
        return finish({ reachable: false, error: errorCode(e) });
      }
      // The deadline passed while the forward was still coming up (a deployed
      // host takes seconds). Destroying emits 'error'; with no listener that
      // would crash the server.
      if (settled) { req.on('error', () => {}); req.destroy(); return; }
      req.on('error', (e: Error) => finish({ reachable: false, error: errorCode(e) }));
      req.on('response', (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); return finish({ reachable: false, error: 'unauthorized' }); }
        if (res.statusCode !== 200) { res.resume(); return finish({ reachable: false, error: 'not_pi_dish' }); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_DESCRIPTOR_BYTES) { res.destroy(); finish({ reachable: false, error: 'not_pi_dish' }); }
        });
        res.on('error', (e: Error) => finish({ reachable: false, error: errorCode(e) }));
        res.on('end', () => {
          let descriptor: RemoteDescriptor | null = null;
          try { descriptor = sanitizeDescriptor(JSON.parse(body)); } catch {}
          if (!descriptor) return finish({ reachable: false, error: 'not_pi_dish' });
          finish({ reachable: true, descriptor });
        });
      });
      req.end();
    })();
  });
}

/**
 * Reachability of one remote: `GET /api/host` through its transport.
 * Memoized for PROBE_TTL_MS on success; on failure the result stands until
 * the backoff ladder's next slot, so a poll-driven caller can ask freely.
 */
export function probe(target: Remote | string, { force = false }: ProbeOptions = {}): Promise<ProbeResult> {
  const remote = target && typeof target === 'object' ? target : getRemote(target);
  if (!remote) return Promise.resolve({ reachable: false, error: 'unknown_host', at: Date.now() });

  const st = stateFor(remote.name);
  if (!force && st.probe && Date.now() < st.probeUntil) return Promise.resolve(st.probe);
  if (st.inFlight) return st.inFlight;

  st.inFlight = probeNow(remote).then((result) => {
    st.inFlight = null;
    st.probe = result;
    if (result.reachable) {
      if (!st.reachableSince) st.reachableSince = result.at;
      if (result.at - st.reachableSince >= STABLE_RESET_MS) st.failures = 0;
      st.probeUntil = result.at + PROBE_TTL_MS;
    } else {
      st.reachableSince = 0;
      st.probeUntil = result.at + backoffMs(st.failures);
      st.failures = Math.min(st.failures + 1, BACKOFF_LADDER.length - 1);
    }
    return result;
  });
  return st.inFlight;
}

/**
 * The memoized probe result, or null when there is none or it has expired.
 * A pure cache read: it never dials and never spawns a forward, so a caller
 * on the request path (the /hosts proxy) can consult it for free.
 */
export function reachability(target: Remote | string): ReachabilityResult | null {
  const remote = target && typeof target === 'object' ? target : getRemote(target);
  if (!remote) return null;
  const st = stateFor(remote.name);
  if (!st.probe || Date.now() >= st.probeUntil) return null;
  return { ...st.probe, until: st.probeUntil };
}

/**
 * A transport failure seen outside probe() — the /hosts proxy's own dials.
 * Real traffic is fresher truth than a cached probe, so it overwrites a
 * reachable result and advances the same ladder a failed probe would.
 */
export function noteTransportFailure(target: Remote | string, code?: unknown): void {
  const remote = target && typeof target === 'object' ? target : getRemote(target);
  if (!remote) return;
  const st = stateFor(remote.name);
  const now = Date.now();
  st.probe = { reachable: false, error: code || 'unreachable', at: now };
  st.reachableSince = 0;
  st.probeUntil = now + backoffMs(st.failures);
  st.failures = Math.min(st.failures + 1, BACKOFF_LADDER.length - 1);
}
