import type { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from 'http';
import type { Duplex } from 'stream';
import hostIdentity = require('./host-identity');
import * as remoteHosts from './remote-hosts';
import type { Remote, ProbeResult } from './remote-hosts';
import type { ArtifactKind, FleetArtifactRecord, FleetArtifactStore } from './fleet-artifacts';
import type { HostDescriptor, TransportRequest, TransportResponse, TransportHandler } from './access-handlers';
import { isolateArtifact } from './artifact-isolation';
import { asRecord } from './wire-protocol';
import { FORM_CLIENT_HEADER, PAGE_FORMS_CAPABILITY, PAGE_FORMS_RELAY_LIMIT, SUBMISSION_ID_RE } from './page-forms';

/**
 * Whether a generic-proxy path reaches the owner's page-form routes as any
 * hop could read it: Express matches routes case-insensitively, and a
 * normalizing proxy may decode (repeatedly), turn backslashes into slashes and
 * collapse repeated slashes. An undecodable path is treated as a match.
 */
export function namesPageForms(path: string): boolean {
  let decoded = path;
  for (let round = 0; round < 3; round++) {
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return true; }
    if (next === decoded) break;
    decoded = next;
  }
  return /(?:^|\/)page-forms(?:\/|$)/.test(decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase());
}

/**
 * A page asset path (already decoded by Express) re-encoded segment by segment
 * for the owner, or null when a hop could read it as different path
 * structure. Redundant separators collapse, as they do when the owner serves
 * the file itself. A segment is refused when it, or any further decode of it,
 * is a dot segment, holds a control character, decodes to a separator, or has
 * a dot part between backslashes (some hops treat `\` as `/`). Literal `%` and
 * `\` names otherwise pass, encoded.
 */
export function encodedAssetPath(rest: string): string | null {
  if (rest === '' || rest === '/') return rest;
  if (!rest.startsWith('/')) return null;
  const segments = rest.slice(1).split('/').filter(segment => segment !== '');
  if (segments.some(unsafeSegment)) return null;
  const trailing = rest.endsWith('/') && segments.length ? '/' : '';
  return `/${segments.map(encodeURIComponent).join('/')}${trailing}`;
}

function unsafeSegment(segment: string): boolean {
  let reading = segment;
  for (let round = 0; round < 4; round++) {
    if (/[\u0000-\u001f\u007f]/.test(reading) || (round > 0 && reading.includes('/'))) return true;
    if (reading.split('\\').some(part => part === '.' || part === '..')) return true;
    let next: string;
    try { next = decodeURIComponent(reading); } catch { return false; }
    if (next === reading) return false;
    reading = next;
  }
  return true;
}

/** Public fallback only; callers retain local-first artifact ownership. */
export interface PublicArtifactRelay {
  serve(req: TransportRequest, res: TransportResponse, kind: ArtifactKind, options?: { annotate?: boolean }): void;
}
export interface RelayPorts {
  fleetArtifacts: FleetArtifactStore;
  localPageExists(token: string): boolean;
  publicBaseUrl(): string | undefined;
  hostDescriptor(): HostDescriptor;
  upgradeAuthorized(req: IncomingMessage, url: URL): boolean;
  proxyResponseTimeoutMs?: number;
}
export interface RelayHandlers {
  rawApi: TransportHandler;
  registerArtifact: TransportHandler;
  listArtifacts: TransportHandler;
  removeArtifact: TransportHandler;
  hosts: TransportHandler;
  /** Page-comment relays, each building its owner URL from route params only. */
  pageComments(route: 'list' | 'item' | 'delete'): TransportHandler;
  /** Page-form relays: the state (optionally one `?submission=`) or one receipt. */
  pageForms(route: 'state' | 'receipt'): TransportHandler;
  publicArtifacts: PublicArtifactRelay;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
}
type ArtifactHook = (status: number, body: unknown) => unknown;
type BoundedProbe = ProbeResult | { reachable: false; error?: string };
interface FleetHostEntry {
  self?: true;
  name: string | null;
  base: string;
  kind?: Remote['kind'];
  reachable: boolean;
  hostId?: string;
  label?: string;
  version?: string | null;
  capabilities?: Record<string, boolean>;
  error?: unknown;
}
/** A relayed reply's cap and how a chunk counts toward it. */
interface BodyLimit { max: number; count(chunk: string): number }
const PROXY_TERMINAL_PATH_RE = /^\/hosts\/([^/]+)\/api\/sessions\/[^/]+\/terminal$/;
const PROXY_RESPONSE_TIMEOUT_MS = 10_000;
const HOSTS_PROBE_DEADLINE_MS = 3000;
const HOP_BY_HOP_HEADERS: Record<string, true> = {
  connection: true, 'keep-alive': true, 'transfer-encoding': true, te: true,
  trailer: true, upgrade: true, 'proxy-authenticate': true,
};

// The request promise includes SSH setup, so the timer arms only once it yields a
// request; any response clears it for good (idle SSE streams included). While a
// request body is still uploading, `progress` and advancing socket writes before
// `writableFinished` restart it: the peer answers a large upload only after its
// last byte.
export function relayFirstResponse(
  opening: Promise<ClientRequest>,
  timeoutMs: number,
  send: (upstream: ClientRequest, progress: () => void) => void,
  respond: (peerRes: IncomingMessage) => void,
  onFailure: (reason: unknown) => void,
  classifyError: ((error: unknown) => unknown) | null,
): void {
  let settled = false;
  const fail = (reason: unknown) => {
    if (settled) return;
    settled = true;
    onFailure(reason);
  };
  const error = (cause: unknown) => fail(classifyError ? classifyError(cause) : undefined);
  opening.then((upstream) => {
    let lastBytesWritten = upstream.socket?.bytesWritten ?? 0;
    upstream.once('socket', (socket) => {
      lastBytesWritten = Math.max(lastBytesWritten, socket?.bytesWritten ?? 0);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      const bytesWritten = upstream.socket?.bytesWritten ?? 0;
      if (!upstream.writableFinished && bytesWritten > lastBytesWritten) {
        lastBytesWritten = bytesWritten;
        timer.refresh();
        return;
      }
      try { upstream.destroy(); } catch {}
      fail('timeout');
    }, timeoutMs);
    const progress = () => {
      if (settled) return;
      lastBytesWritten = Math.max(lastBytesWritten, upstream.socket?.bytesWritten ?? 0);
      timer.refresh();
    };
    upstream.on('error', (cause) => { clearTimeout(timer); error(cause); });
    upstream.on('response', (peerRes) => {
      clearTimeout(timer);
      if (settled) return peerRes.resume();
      settled = true;
      respond(peerRes);
    });
    send(upstream, progress);
  }).catch(error);
}

function copyRelayResponseHeaders(peerRes: IncomingMessage, res: TransportResponse): void {
  for (const [key, value] of Object.entries(peerRes.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS[lower] === true || lower.startsWith('access-control-')) continue;
    res.setHeader(key, value!);
  }
}

// The race keeps one wedged peer from holding the fleet list open.
function boundedProbe(remote: Remote): Promise<BoundedProbe> {
  return Promise.race([
    remoteHosts.probe(remote).catch((): BoundedProbe => ({ reachable: false })),
    new Promise<BoundedProbe>((resolve) => setTimeout(
      () => resolve({ reachable: false, error: 'timeout' }), HOSTS_PROBE_DEADLINE_MS).unref()),
  ]);
}

export function createRelayHandlers(ports: RelayPorts): RelayHandlers {
  const { fleetArtifacts } = ports;
  const proxyResponseTimeoutMs = ports.proxyResponseTimeoutMs ?? PROXY_RESPONSE_TIMEOUT_MS;
  const rawApi: TransportHandler = (req, res) => {
    const remote = remoteHosts.getRemote(req.params.name);
    // Bare 404: the fleet map is not a discovery surface.
    if (!remote) return res.status(404).type('text/plain').send('Not found');
    // The vault bridge belongs to the host's own listener; it is never a fleet route.
    if (/^\/vault\/bridge(?:\/|$)/.test(req.path)) return res.status(404).type('text/plain').send('Not found');
    // Page forms are owner-only: only this host's dedicated relay (behind its
    // same-origin check) may carry them, never the generic API proxy.
    if (namesPageForms(req.path)) {
      return res.status(403).json({ error: 'page forms are answered through /api/page-forms on this host, not the /hosts proxy' });
    }
    proxyToRemote(remote, req, res, fleetArtifactHook(remote, req));
  };

  function proxyToRemote(remote: Remote, req: TransportRequest, res: TransportResponse, hook: ArtifactHook | null = null) {
    const unreachable = (reason: unknown) => {
      res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name, reason });
    };
    // A peer known down answers instantly: a sleeping tailscale machine
    // black-holes the connect and would cost the whole first-byte timer.
    const known = remoteHosts.reachability(remote);
    if (known && !known.reachable) return unreachable(known.error || 'unreachable');

    // A hooked response is parsed, not relayed byte for byte, so it must be uncompressed.
    const headers = hook ? { ...req.headers, 'accept-encoding': 'identity' } : req.headers;
    relayFirstResponse(
      remoteHosts.request(remote, { method: req.method, path: `/api${req.url}`, headers }),
      proxyResponseTimeoutMs,
      (upstream, progress) => {
        req.on('aborted', () => { try { upstream.destroy(); } catch {} });
        upstream.on('drain', progress);
        upstream.on('finish', progress);
        req.pipe(upstream);
        req.on('data', progress);
      },
      (peerRes) => {
          res.status(peerRes.statusCode!);
          copyRelayResponseHeaders(peerRes, res);
          if (hook && String(peerRes.headers['content-type'] || '').includes('application/json')) {
            // The body may be rewritten, changing its length.
            res.removeHeader('Content-Length');
            return relayHookedJson(peerRes, res, hook);
          }
          // Content-Encoding passes through (compression already excludes
          // /hosts/*), so event streams arrive as the peer wrote them.
          if (String(peerRes.headers['content-type'] || '').startsWith('text/event-stream')) res.flushHeaders();
          peerRes.pipe(res);
          res.on('close', () => { try { peerRes.destroy(); } catch {} });
      },
      (reason) => {
        // Only transport failures reach here; peer HTTP statuses don't trip the breaker.
        remoteHosts.noteTransportFailure(remote, reason);
        unreachable(reason);
      },
      remoteHosts.errorCode,
    );
  }

  // The only buffered exception to the byte-relay rule: small JSON creation/revocation replies.
  const FLEET_ARTIFACT_BODY_LIMIT = 64 * 1024;
  const PROXY_SHARE_PATH_RE = /^\/sessions\/[^/]+\/share$/;
  const PROXY_PAGE_TOKEN_PATH_RE = /^\/pages\/([^/]+)$/;
  const PUBLIC_ARTIFACT_TIMEOUT_MS = 10_000;
  // Allowlist so the hub's origin/credentials never leak into a peer's logs.
  const PUBLIC_FORWARD_HEADERS = ['accept', 'accept-language', 'range', 'if-range', 'if-none-match', 'if-modified-since', 'user-agent'];
  // Set by a hub fronting this page from a listener with no /api (see serveFleetArtifact).
  const PAGE_COMMENTS_HEADER = 'x-pi-dish-page-comments';
  // Marks every hub→peer public-artifact request; the receiver answers from its
  // local registry only, bounding mutually-remote fleets to one hop. Never copied
  // from the client request.
  const ARTIFACT_HOP_HEADER = 'x-pi-dish-artifact-hop';

  // Discovery bounds: negative cache against refresh storms, shared in-flight
  // lookups, and a global cap on outbound traffic an anonymous listener can cause.
  const DISCOVERY_NEGATIVE_TTL_MS = 30_000;
  const DISCOVERY_NEGATIVE_CAP = 1000;
  const DISCOVERY_CONCURRENCY = 16;
  const discoveryAbsent = new Map<string, number>();
  const discoveryInFlight = new Map<string, Promise<FleetArtifactRecord | null>>();

  /** null when no public base is configured (client builds it). */
  function publicUrlFor(publicPath: string) {
    const base = ports.publicBaseUrl();
    return base ? base.replace(/\/+$/, '') + publicPath : null;
  }

  function fleetArtifactPayload(token: string, kind: ArtifactKind) {
    const publicPath = kind === 'share' ? `/share/${token}` : `/page/${token}`;
    return { token, path: publicPath, url: publicUrlFor(publicPath) };
  }

  /**
   * A peer minting a share/page through this hub records where the token lives
   * and answers with the hub's public URL: the peer's PI_DISH_SHARE_BASE_URL may
   * describe a front door this reader lacks.
   */
  function fleetArtifactHook(remote: Remote, req: TransportRequest): ArtifactHook | null {
    const reqPath = req.url.split('?')[0];
    const isShare = PROXY_SHARE_PATH_RE.test(reqPath);
    const pageTokenMatch = PROXY_PAGE_TOKEN_PATH_RE.exec(reqPath);

    // /shares/import: an OMP share is a snapshot the peer minted, fronted like any other.
    if (req.method === 'POST' && (isShare || reqPath === '/shares/import' || reqPath === '/pages')) {
      const kind = reqPath === '/pages' ? 'page' : 'share';
      return (status, body) => {
        if (status < 200 || status >= 300) return body;
        if (!body || typeof body !== 'object' || !fleetArtifacts.record(asRecord(body).token, remote.name, kind)) return body;
        return { ...body, ...fleetArtifactPayload(asRecord(body).token as string, kind) };
      };
    }

    if (req.method === 'DELETE' && (isShare || pageTokenMatch)) {
      // A page revoke names its token in the path; a share revoke reports it in
      // the body (when it doesn't, the serving path's 404 prune is the backstop).
      const pathToken = pageTokenMatch ? decodeURIComponent(pageTokenMatch[1]) : null;
      return (status, body) => {
        if (status < 200 || status >= 300) return body;
        const token = pathToken || (body && typeof asRecord(body).token === 'string' ? asRecord(body).token : null);
        if (token) fleetArtifacts.remove(token, remote.name);
        return body;
      };
    }

    return null;
  }

  function relayHookedJson(peerRes: IncomingMessage, res: TransportResponse, hook: ArtifactHook) {
    let raw = '';
    let relaying = false;
    peerRes.setEncoding('utf8');
    peerRes.on('data', (chunk) => {
      if (relaying) return void res.write(chunk);
      raw += chunk;
      // Too large for an artifact reply: stop interpreting and relay.
      if (raw.length > FLEET_ARTIFACT_BODY_LIMIT) {
        relaying = true;
        res.write(raw);
        raw = '';
      }
    });
    peerRes.on('error', () => { try { res.end(); } catch {} });
    peerRes.on('end', () => {
      if (relaying) return res.end();
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return res.end(raw); }
      let out = body;
      try { out = hook(peerRes.statusCode!, body); } catch { out = body; }
      res.end(JSON.stringify(out === undefined ? body : out));
    });
    res.on('close', () => { try { peerRes.destroy(); } catch {} });
  }

  /** Fleet-map membership is the authorization: only known remotes are probed. */
  async function findRemoteByHostId(hostId: string): Promise<Remote | null> {
    const remotes = remoteHosts.listRemotes();
    const probes = await Promise.all(remotes.map(boundedProbe));
    const index = probes.findIndex((probe) => probe.reachable && probe.descriptor?.hostId === hostId);
    return index >= 0 ? remotes[index] : null;
  }

  // A peer's agent publishes locally, then asks the hub (via its own server's
  // proxy) to front it, so it never needs the hub's address or credential.
  const registerArtifact: TransportHandler = async (req, res) => {
    const { token, kind, hostId } = asRecord(req.body);
    if (!fleetArtifacts.isValidToken(token)) {
      return res.status(400).json({ error: 'token required (base64url, max 128 characters)' });
    }
    if (!fleetArtifacts.isValidKind(kind)) {
      return res.status(400).json({ error: 'kind must be "share" or "page"' });
    }
    if (typeof hostId !== 'string' || !hostId || hostId.length > 256) {
      return res.status(400).json({ error: 'hostId required' });
    }
    if (hostId === hostIdentity.getHostId()) {
      return res.status(404).json({ error: 'hostId is this host, not one of its configured remotes' });
    }
    const remote = await findRemoteByHostId(hostId);
    if (!remote) {
      return res.status(404).json({ error: 'no configured, reachable remote has that hostId' });
    }
    if (!fleetArtifacts.record(token, remote.name, kind)) {
      return res.status(400).json({ error: 'artifact could not be recorded' });
    }
    res.json({ ...fleetArtifactPayload(token, kind), host: remote.name });
  };

  const listArtifacts: TransportHandler = (_req, res) => {
    const artifacts = [];
    for (const [host, entries] of Object.entries(fleetArtifacts.listByHost())) {
      for (const entry of entries) artifacts.push({ ...entry, host, ...fleetArtifactPayload(entry.token, entry.kind) });
    }
    artifacts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ artifacts });
  };

  const removeArtifact: TransportHandler = (req, res) => {
    // Only ends public reachability through this hub; the owner revokes the
    // artifact. The tombstone stops rediscovery until the artifact is re-created.
    res.json({ revoked: fleetArtifacts.suppress(req.params.token) });
  };

  function knownAbsent(key: string): boolean {
    const expires = discoveryAbsent.get(key);
    if (expires === undefined) return false;
    if (expires > Date.now()) return true;
    discoveryAbsent.delete(key);
    return false;
  }

  function rememberAbsent(key: string): void {
    discoveryAbsent.delete(key);
    discoveryAbsent.set(key, Date.now() + DISCOVERY_NEGATIVE_TTL_MS);
    // Map iteration is insertion order: first key is oldest.
    while (discoveryAbsent.size > DISCOVERY_NEGATIVE_CAP) {
      const oldest = discoveryAbsent.keys().next().value;
      if (oldest === undefined) break;
      discoveryAbsent.delete(oldest);
    }
  }

  /**
   * HEADs the token's document on each remote (any 2xx/3xx claims it). Tokens are
   * ≥128-bit random capabilities, only fleet-map members are contacted, and the
   * hop header keeps it to one hop.
   */
  function discoverOwner(token: string, kind: ArtifactKind): Promise<FleetArtifactRecord | null> {
    const key = `${kind}:${token}`;
    const joined = discoveryInFlight.get(key);
    if (joined) return joined;
    if (knownAbsent(key)) return Promise.resolve(null);
    const remotes = remoteHosts.listRemotes();
    // No fleet, no traffic: the single-host invariant.
    if (remotes.length === 0) return Promise.resolve(null);
    // Over the cap: not-found without probing or caching — the token may exist.
    if (discoveryInFlight.size >= DISCOVERY_CONCURRENCY) return Promise.resolve(null);

    const discovery = new Promise<FleetArtifactRecord | null>((resolve) => {
      const docPath = kind === 'share' ? `/share/${token}` : `/page/${token}`;
      let pending = 0;
      let claimed = false;
      let definite = true;
      let probed = 0;
      const settle = () => {
        if (claimed || --pending > 0) return;
        if (probed > 0 && definite) rememberAbsent(key);
        resolve(null);
      };
      for (const remote of remotes) {
        // Skip known-down peers; one may own the token, so nothing is cached.
        const known = remoteHosts.reachability(remote);
        if (known && !known.reachable) { definite = false; continue; }
        pending++;
        probed++;
        relayFirstResponse(
          remoteHosts.request(remote, {
            method: 'HEAD',
            path: docPath,
            headers: { 'accept-encoding': 'identity', [ARTIFACT_HOP_HEADER]: '1' },
          }),
          PUBLIC_ARTIFACT_TIMEOUT_MS,
          (upstream) => upstream.end(),
          (peerRes) => {
            peerRes.resume();
            const status = peerRes.statusCode || 0;
            if (status >= 200 && status < 400 && !claimed) {
              claimed = true;
              // A concurrent explicit unmap wins over discovery.
              if (fleetArtifacts.isSuppressed(token)) return resolve(null);
              return resolve(fleetArtifacts.record(token, remote.name, kind));
            }
            settle();
          },
          (reason) => {
            remoteHosts.noteTransportFailure(remote, reason);
            definite = false;
            settle();
          },
          remoteHosts.errorCode,
        );
      }
      if (pending === 0) resolve(null);
    }).finally(() => { discoveryInFlight.delete(key); });
    discoveryInFlight.set(key, discovery);
    return discovery;
  }

  /**
   * Fallback for a /share or /page token this host doesn't own. Unmapped
   * (suppressed) tokens and hub hop requests 404 without contacting anybody.
   */
  function serveFleetArtifact(req: TransportRequest, res: TransportResponse, kind: ArtifactKind, { annotate = true }: { annotate?: boolean } = {}): void {
    const token = req.params.token;
    const notFound = () => { if (!res.headersSent) res.status(404).type('text/plain').send('Not found'); };
    // Another hub asking: the local registry, already checked, is the whole answer.
    if (req.headers[ARTIFACT_HOP_HEADER] !== undefined) return notFound();
    if (!fleetArtifacts.isValidToken(token)) return notFound();
    const mapping = fleetArtifacts.get(token);
    if (mapping) {
      if (mapping.kind !== kind) return notFound();
      return relayMapped(req, res, kind, annotate, token, mapping, notFound);
    }
    if (fleetArtifacts.isSuppressed(token)) return notFound();
    discoverOwner(token, kind).then((found) => {
      if (!found || found.kind !== kind) return notFound();
      relayMapped(req, res, kind, annotate, token, found, notFound);
    }, notFound);
  }

  function relayMapped(
    req: TransportRequest,
    res: TransportResponse,
    kind: ArtifactKind,
    annotate: boolean,
    token: string,
    mapping: FleetArtifactRecord,
    notFound: () => void,
  ): void {
    const remote = remoteHosts.getRemote(mapping.host);
    if (!remote) return notFound();

    const rawRest = kind === 'page' ? (req.params[0] || (req.path.endsWith('/') ? '/' : '')) : '';
    // Rebuilt from validated, re-encoded segments: a path a normalizing proxy
    // could resolve elsewhere never leaves this host with the owner's credential.
    const rest = encodedAssetPath(rawRest);
    if (rest === null) return notFound();
    const documentRequest = kind === 'share' || rest === '' || rest === '/';
    const queryAt = req.originalUrl.indexOf('?');
    const query = queryAt >= 0 ? req.originalUrl.slice(queryAt) : '';
    const peerPath = kind === 'share' ? `/share/${token}${query}` : `/page/${token}${rest}${query}`;

    const headers: OutgoingHttpHeaders = { 'accept-encoding': 'identity', [ARTIFACT_HOP_HEADER]: '1' };
    for (const name of PUBLIC_FORWARD_HEADERS) {
      if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    }
    // The overlay's calls are relative and need /api; ask the owner to skip
    // injection so this listener serves raw HTML as it does for local pages.
    if (kind === 'page' && !annotate) headers[PAGE_COMMENTS_HEADER] = 'off';
    // This front serves pi-dish's /forms view, so the owner may link its form there.
    if (kind === 'page' && annotate) headers['x-pi-dish-forms'] = '1';

    relayFirstResponse(
      remoteHosts.request(remote, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', path: peerPath, headers }),
      PUBLIC_ARTIFACT_TIMEOUT_MS,
      (upstream) => upstream.end(),
      (peerRes) => {
          if (peerRes.statusCode === 404) {
            // Only the token's own document proves a revoke (a missing asset is the
            // page's own 404). A single-file page 404s `/page/t/` while `/page/t`
            // lives, so verify the bare form before pruning and redirect there.
            peerRes.resume();
            if (!documentRequest) return notFound();
            if (kind === 'page' && rest === '/') {
              return relayFirstResponse(
                remoteHosts.request(remote, { method: 'GET', path: `/page/${token}`, headers }),
                PUBLIC_ARTIFACT_TIMEOUT_MS,
                (check) => check.end(),
                (checkRes) => {
                  checkRes.resume();
                  if (checkRes.statusCode === 404) {
                    fleetArtifacts.remove(token, mapping.host);
                    return notFound();
                  }
                  res.redirect(302, `/page/${token}${query}`);
                },
                notFound,
                null,
              );
            }
            fleetArtifacts.remove(token, mapping.host);
            return notFound();
          }
          res.status(peerRes.statusCode!);
          copyRelayResponseHeaders(peerRes, res);
          isolateArtifact(res, kind);
          peerRes.pipe(res);
          res.on('close', () => { try { peerRes.destroy(); } catch {} });
      },
      () => { res.status(502).type('text/plain').send('Host unavailable'); },
      null,
    );
  }

  const hosts: TransportHandler = async (_req, res) => {
    const remotes = remoteHosts.listRemotes();
    const probes = await Promise.all(remotes.map(boundedProbe));

    const hosts: FleetHostEntry[] = [{
      self: true,
      name: null,
      base: '',
      ...ports.hostDescriptor(),
      reachable: true,
    }];
    remotes.forEach((remote, i) => {
      const probe = probes[i];
      const entry: FleetHostEntry = { name: remote.name, base: `/hosts/${remote.name}`, kind: remote.kind, reachable: !!probe.reachable };
      if (probe.reachable && probe.descriptor) {
        entry.hostId = probe.descriptor.hostId;
        entry.label = probe.descriptor.label || remote.name;
        entry.version = probe.descriptor.version;
        entry.capabilities = probe.descriptor.capabilities;
      } else {
        entry.error = ('error' in probe && probe.error) || 'unreachable';
      }
      hosts.push(entry);
    });
    res.json({ hosts });
  };

  // Feedback on a fronted page belongs to the owner host whose agent reads it.
  // The owner URL is built from route params alone (never a request suffix).
  // `capability`: what the owner must advertise first (an older host gets a 404).
  function ownerPageRelay(build: (req: TransportRequest, token: string) => string | null, bodyLimit: BodyLimit,
    capability: string | null = null): TransportHandler {
    return (req, res, next) => {
      const token = req.params.token;
      // Another hub's relayed call: answered from this host's own pages only.
      if (req.headers[ARTIFACT_HOP_HEADER] !== undefined) return next();
      if (!fleetArtifacts.isValidToken(token) || ports.localPageExists(token)) return next();
      const peerPath = build(req, token);
      if (peerPath === null) return res.status(404).json({ error: 'not found' });
      const relay = (mapping: FleetArtifactRecord | null) => {
        const remote = mapping?.kind === 'page' ? remoteHosts.getRemote(mapping.host) : null;
        if (!remote) return next();
        if (!capability) return proxyToPageOwner(remote, req, res, peerPath, bodyLimit);
        void remoteHosts.probe(remote).then((probe) => {
          if (!probe.reachable) return res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name });
          if (probe.descriptor?.capabilities?.[capability] !== true) {
            return res.status(404).json({ error: `Host ${remote.name} runs a pi-dish that cannot take form answers`, host: remote.name });
          }
          proxyToPageOwner(remote, req, res, peerPath, bodyLimit);
        });
      };
      const mapping = fleetArtifacts.get(token);
      if (mapping || fleetArtifacts.isSuppressed(token)) return relay(mapping);
      // A form view opened straight from a link: find the page's host first.
      discoverOwner(token, 'page').then(relay, () => next());
    };
  }
  // Ids are opaque tokens; anything else is refused here rather than relayed.
  const COMMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
  const segment = (value: unknown, pattern: RegExp) => typeof value === 'string' && pattern.test(value) ? value : null;
  // Comment replies keep their long-standing limit, counted in UTF-16 units as
  // it always was (a long CJK quote and comment fit); the form budget is bytes.
  const COMMENT_BODY_LIMIT: BodyLimit = { max: FLEET_ARTIFACT_BODY_LIMIT, count: chunk => chunk.length };
  const FORM_BODY_LIMIT: BodyLimit = { max: PAGE_FORMS_RELAY_LIMIT, count: chunk => Buffer.byteLength(chunk) };
  const pageComments: RelayHandlers['pageComments'] = route => ownerPageRelay((req, token) => {
    const base = `/api/page-comments/${encodeURIComponent(token)}`;
    if (route === 'list') return base;
    const id = segment(req.params.id, COMMENT_ID_RE);
    return id && `${base}/${id}${route === 'delete' ? '/delete' : ''}`;
  }, COMMENT_BODY_LIMIT);
  // A form's spec, answers and receipts are budgeted under this (src/core/page-forms.ts).
  const pageForms: RelayHandlers['pageForms'] = route => ownerPageRelay((req, token) => {
    const base = `/api/page-forms/${encodeURIComponent(token)}`;
    if (route === 'receipt') {
      const id = segment(req.params.id, SUBMISSION_ID_RE);
      return id && `${base}/receipts/${id}`;
    }
    if (req.query.submission === undefined) return base;
    const submission = segment(req.query.submission, SUBMISSION_ID_RE);
    return submission && `${base}?submission=${submission}`;
  }, FORM_BODY_LIMIT, PAGE_FORMS_CAPABILITY);

  // Small JSON both ways with the body already parsed by express: the same
  // buffered exception as artifact creation replies. A body cut short is a 502,
  // never a truncated or empty success.
  function proxyToPageOwner(remote: Remote, req: TransportRequest, res: TransportResponse, peerPath: string, bodyLimit: BodyLimit) {
    const payload = req.method === 'GET' || req.method === 'HEAD' ? null : JSON.stringify(req.body ?? {});
    const headers: OutgoingHttpHeaders = {
      accept: 'application/json', 'accept-encoding': 'identity', [ARTIFACT_HOP_HEADER]: '1', [FORM_CLIENT_HEADER]: 'relay',
    };
    if (payload !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }

    relayFirstResponse(
      remoteHosts.request(remote, { method: req.method, path: peerPath, headers }),
      proxyResponseTimeoutMs,
      (upstream, progress) => {
        upstream.on('drain', progress);
        upstream.on('finish', progress);
        if (payload !== null) upstream.write(payload);
        upstream.end();
      },
      (peerRes) => {
          let raw = '';
          let size = 0;
          let done = false;
          const fail = (error: string) => {
            if (done) return;
            done = true;
            peerRes.destroy();
            if (!res.headersSent) res.status(502).json({ error: `Host ${remote.name} ${error}`, host: remote.name });
          };
          peerRes.setEncoding('utf8');
          peerRes.on('data', (chunk: string) => {
            if (done) return;
            raw += chunk;
            size += bodyLimit.count(chunk);
            if (size > bodyLimit.max) fail('returned an oversized page response');
          });
          peerRes.on('aborted', () => fail('sent an incomplete response'));
          peerRes.on('error', () => fail('sent an incomplete response'));
          peerRes.on('end', () => {
            if (done) return;
            if (!peerRes.complete || (!raw && req.method !== 'HEAD')) return fail('sent an incomplete response');
            done = true;
            if (req.method === 'HEAD') {
              // The owner's metadata for the body it would send.
              res.status(peerRes.statusCode!);
              for (const name of ['content-type', 'content-length', 'cache-control']) {
                const value = peerRes.headers[name];
                if (value !== undefined) res.setHeader(name, value);
              }
              res.end();
              return;
            }
            res.status(peerRes.statusCode!).type('application/json').send(raw);
          });
      },
      (reason) => { res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name, reason }); },
      remoteHosts.errorCode,
    );
  }

  // Works even when this host's terminal feature is off: the PTY lives on the peer.
  const upgrade: RelayHandlers['upgrade'] = (req, socket, head, url) => {
    const match = PROXY_TERMINAL_PATH_RE.exec(url.pathname);
    if (!match) return false;
    const remote = remoteHosts.getRemote(match[1]);
    if (!remote) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return true;
    }
    // This host's gate, applied by hand; the peer's own credential is attached
    // downstream, never the caller's.
    if (!ports.upgradeAuthorized(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return true;
    }
    proxyUpgrade(remote, req, socket, head, url);
    return true;
  };

  function proxyUpgrade(remote: Remote, req: IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    const teardown = () => { try { socket.destroy(); } catch {} };
    const peerPath = url.pathname.slice(`/hosts/${remote.name}`.length) + url.search;

    remoteHosts.request(remote, { method: 'GET', path: peerPath, headers: req.headers, upgrade: true })
      .then((upstream) => {
        upstream.on('error', teardown);
        socket.on('error', teardown);
        // A client hanging up mid-handshake must not leave a half-open peer request.
        socket.once('close', () => { try { upstream.destroy(); } catch {} });
        upstream.on('upgrade', (peerRes, peerSocket, peerHead) => {
          const lines = [`HTTP/1.1 ${peerRes.statusCode} ${peerRes.statusMessage || 'Switching Protocols'}`];
          for (const [key, value] of Object.entries(peerRes.headers)) {
            for (const one of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${one}`);
          }
          socket.write(`${lines.join('\r\n')}\r\n\r\n`);
          if (peerHead && peerHead.length) socket.write(peerHead);
          if (head && head.length) peerSocket.write(head);
          peerSocket.on('error', teardown);
          peerSocket.on('close', teardown);
          socket.on('close', () => { try { peerSocket.destroy(); } catch {} });
          socket.pipe(peerSocket);
          peerSocket.pipe(socket);
        });
        // Peer refused the handshake: relay its status, not a dead socket.
        upstream.on('response', (peerRes) => {
          peerRes.resume();
          socket.write(`HTTP/1.1 ${peerRes.statusCode} ${peerRes.statusMessage || ''}\r\n\r\n`);
          socket.destroy();
        });
        upstream.end();
      })
      .catch(() => {
        try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
        teardown();
      });
  }
  return { rawApi, registerArtifact, listArtifacts, removeArtifact, hosts, pageComments, pageForms, publicArtifacts: { serve: serveFleetArtifact }, upgrade };
}
