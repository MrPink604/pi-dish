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
 * backoff ladder on failure. Nothing in here runs on a timer.
 *
 * ssh stderr is never logged or returned: it carries host names, key paths
 * and auth detail. It is classified into a short code and the text dropped.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { dishDir } = require('./dish-store');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DEFAULT_REMOTE_PORT = 3333;
const PROBE_TIMEOUT_MS = 2500;
const PROBE_TTL_MS = 10_000;
const BACKOFF_LADDER = [3000, 4000, 8000, 16_000];
// A peer must be *continuously* reachable this long before its failure count
// is forgiven: a flapper (up two seconds, down again) has to keep climbing the
// ladder, or every brief recovery re-dials it at the 3s slot forever.
const STABLE_RESET_MS = 30_000;
const FORWARD_READY_TIMEOUT_MS = 8000;
const FORWARD_POLL_MS = 50;
const MAX_DESCRIPTOR_BYTES = 64 * 1024;

// --- config ---------------------------------------------------------------

function settingsFile() {
  return path.join(dishDir(), 'settings.json');
}

function readRemotesSetting() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return Array.isArray(raw && raw.remotes) ? raw.remotes : [];
  } catch {
    return [];
  }
}

function isValidRemoteName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

/** Config entry -> normalized remote, or null when the entry is unusable. */
function normalizeRemote(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!isValidRemoteName(name)) return null;
  const token = typeof entry.token === 'string' && entry.token.trim() ? entry.token.trim() : null;

  if (typeof entry.url === 'string' && entry.url.trim()) {
    let url;
    try { url = new URL(entry.url.trim()); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return { name, kind: 'direct', origin: url.origin, token };
  }

  if (typeof entry.sshDest === 'string' && entry.sshDest.trim()) {
    const remotePort = entry.remotePort === undefined || entry.remotePort === null
      ? DEFAULT_REMOTE_PORT : Number(entry.remotePort);
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return null;
    // remoteHost covers peers bound to a specific interface (a tailnet or
    // LAN IP) instead of loopback — the forward's far end must match the
    // peer's actual bind address.
    const remoteHost = typeof entry.remoteHost === 'string' && entry.remoteHost.trim()
      ? entry.remoteHost.trim() : '127.0.0.1';
    if (/[\s:]/.test(remoteHost)) return null;
    // A token is not part of the ssh shape (the hop authenticates), but an
    // explicitly configured one is honored: a peer that *does* run with a
    // token would otherwise 401 every proxied request.
    return { name, kind: 'ssh', sshDest: entry.sshDest.trim(), remotePort, remoteHost, token };
  }

  return null;
}

/** Configured peers, invalid entries skipped, first entry wins on a name clash. */
function listRemotes() {
  const out = [];
  const seen = new Set();
  for (const entry of readRemotesSetting()) {
    const remote = normalizeRemote(entry);
    if (!remote || seen.has(remote.name)) continue;
    seen.add(remote.name);
    out.push(remote);
  }
  return out;
}

function getRemote(name) {
  if (!isValidRemoteName(name)) return null;
  return listRemotes().find((r) => r.name === name) || null;
}

// --- per-remote state -----------------------------------------------------

// Keyed by dish dir as well as name: a test's temp HOME is a different fleet,
// and its ssh sockets live in a different run dir.
const states = new Map();

function stateFor(name) {
  const key = `${dishDir()}\u0000${name}`;
  let st = states.get(key);
  if (!st) {
    st = { probe: null, probeUntil: 0, inFlight: null, failures: 0, reachableSince: 0, forward: null, forwardFailures: 0 };
    states.set(key, st);
  }
  return st;
}

function backoffMs(failures) {
  return BACKOFF_LADDER[Math.min(failures, BACKOFF_LADDER.length - 1)];
}

// --- errors ---------------------------------------------------------------

function transportError(code) {
  const err = new Error(`remote transport: ${code}`);
  err.transportCode = code;
  return err;
}

/** Network failure -> short code. Never surfaces a message or stderr text. */
function errorCode(err) {
  if (err && err.transportCode) return err.transportCode;
  const code = err && err.code;
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
function classifySshStderr(text) {
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

function runDir() {
  return path.join(dishDir(), 'run');
}

/** Forwarded socket for a remote. 0700 dir: no other user on a shared host. */
function socketPathFor(name) {
  return path.join(runDir(), `${name}.sock`);
}

/**
 * argv for the long-lived forward (spawned as `ssh <argv>`, never a shell
 * string). BatchMode keeps a passphrase prompt from hanging the spawn;
 * ExitOnForwardFailure means a dead forward exits instead of pretending;
 * the keepalives notice a silently dropped link.
 */
function sshArgv(remote, socketPath = socketPathFor(remote.name)) {
  return [
    '-N',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-L', `${socketPath}:${remote.remoteHost}:${remote.remotePort}`,
    remote.sshDest,
  ];
}

function forwardKey(remote) {
  return `${remote.sshDest}\u0000${remote.remoteHost}\u0000${remote.remotePort}`;
}

function ensureForward(remote) {
  const st = stateFor(remote.name);
  const fwd = st.forward;
  if (fwd && !fwd.dead && fwd.key === forwardKey(remote)) return fwd.ready;
  // A forward that just died stays down for its backoff slot rather than
  // being respawned by every request that arrives behind it.
  if (fwd && fwd.dead && fwd.key === forwardKey(remote) && Date.now() < fwd.retryAt) {
    return Promise.reject(transportError(fwd.error || 'ssh_failed'));
  }
  return spawnForward(remote);
}

function spawnForward(remote) {
  const st = stateFor(remote.name);
  if (st.forward && st.forward.child) { try { st.forward.child.kill('SIGTERM'); } catch {} }

  const socketPath = socketPathFor(remote.name);
  const forward = { key: forwardKey(remote), socketPath, child: null, dead: false, error: null, retryAt: 0, ready: null };
  st.forward = forward;

  const fail = (code) => {
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

  let child;
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
  child.stderr.on('data', (chunk) => { forward.error = classifySshStderr(chunk); });
  child.on('error', () => fail('ssh_unavailable'));
  child.on('exit', () => fail(forward.error || 'ssh_failed'));

  forward.ready = new Promise((resolve, reject) => {
    const deadline = Date.now() + FORWARD_READY_TIMEOUT_MS;
    const poll = () => {
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

/** Kill every ssh child. Hooked into the server's close (server.js). */
function shutdown() {
  for (const st of states.values()) {
    const fwd = st.forward;
    if (!fwd) continue;
    if (fwd.child) { try { fwd.child.kill('SIGTERM'); } catch {} }
    if (fwd.socketPath) { try { fs.unlinkSync(fwd.socketPath); } catch {} }
    st.forward = null;
  }
}

// --- requests -------------------------------------------------------------

// Never forwarded upstream: the caller's credential (the *hub's* token is not
// the peer's, and a peer must never see it) and framing headers node owns.
const DROPPED_REQUEST_HEADERS = new Set([
  'authorization', 'host', 'connection', 'keep-alive', 'transfer-encoding',
  'te', 'trailer', 'upgrade-insecure-requests', 'proxy-authorization', 'proxy-authenticate',
  // The hub already ran the browser-facing origin check; a peer applying its
  // own allowlist to the hub's origin would refuse legitimate proxied calls.
  'origin',
]);

function outboundHeaders(headers, remote, { upgrade = false } = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined) continue;
    if (DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  // A WebSocket handshake is the one case where the hop-by-hop framing *is*
  // the request: without Connection: Upgrade the peer's http server never
  // emits its own upgrade event and answers with a plain response.
  if (upgrade) out.connection = 'Upgrade';
  if (remote.token) out.authorization = `Bearer ${remote.token}`;
  return out;
}

/**
 * Open a request to a peer. Returns the raw ClientRequest so bodies stream
 * both ways — nothing here buffers a request or a response.
 *
 * The caller writes/pipes the body and ends the request, and handles
 * 'response' / 'upgrade' / 'error' itself.
 */
async function request(target, options = {}) {
  const remote = target && typeof target === 'object' ? target : getRemote(target);
  if (!remote) throw transportError('unknown_host');
  const { method = 'GET', path: reqPath = '/', headers = {}, upgrade = false } = options;

  if (remote.kind === 'ssh') {
    const socketPath = await ensureForward(remote);
    return http.request({
      socketPath,
      method,
      path: reqPath,
      headers: { ...outboundHeaders(headers, remote, { upgrade }), host: `${remote.remoteHost}:${remote.remotePort}` },
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
    headers: { ...outboundHeaders(headers, remote, { upgrade }), host: url.host },
  });
}

// --- reachability ---------------------------------------------------------

function sanitizeDescriptor(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.hostId !== 'string' || !data.hostId) return null;
  const capabilities = {};
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

function probeNow(remote) {
  return new Promise((resolve) => {
    let settled = false;
    let req = null;
    const finish = (result) => {
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
      if (settled) { try { req.destroy(); } catch {} return; }
      req.on('error', (e) => finish({ reachable: false, error: errorCode(e) }));
      req.on('response', (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); return finish({ reachable: false, error: 'unauthorized' }); }
        if (res.statusCode !== 200) { res.resume(); return finish({ reachable: false, error: 'not_pi_dish' }); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_DESCRIPTOR_BYTES) { res.destroy(); finish({ reachable: false, error: 'not_pi_dish' }); }
        });
        res.on('error', (e) => finish({ reachable: false, error: errorCode(e) }));
        res.on('end', () => {
          let descriptor = null;
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
function probe(target, { force = false } = {}) {
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
function reachability(target) {
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
function noteTransportFailure(target, code) {
  const remote = target && typeof target === 'object' ? target : getRemote(target);
  if (!remote) return;
  const st = stateFor(remote.name);
  const now = Date.now();
  st.probe = { reachable: false, error: code || 'unreachable', at: now };
  st.reachableSince = 0;
  st.probeUntil = now + backoffMs(st.failures);
  st.failures = Math.min(st.failures + 1, BACKOFF_LADDER.length - 1);
}

module.exports = {
  BACKOFF_LADDER,
  STABLE_RESET_MS,
  DEFAULT_REMOTE_PORT,
  classifySshStderr,
  errorCode,
  getRemote,
  isValidRemoteName,
  listRemotes,
  normalizeRemote,
  noteTransportFailure,
  probe,
  reachability,
  request,
  runDir,
  shutdown,
  socketPathFor,
  sshArgv,
};
