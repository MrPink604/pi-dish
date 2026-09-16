import type { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from 'http';
import type { Duplex } from 'stream';
import hostIdentity = require('./host-identity');
import * as remoteHosts from './remote-hosts';
import type { Remote, ProbeResult } from './remote-hosts';
import type { ArtifactKind, FleetArtifactStore } from './fleet-artifacts';
import type { HostDescriptor, TransportRequest, TransportResponse, TransportHandler } from './access-handlers';

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
}
export interface RelayHandlers {
  rawApi: TransportHandler;
  registerArtifact: TransportHandler;
  listArtifacts: TransportHandler;
  removeArtifact: TransportHandler;
  hosts: TransportHandler;
  comments: TransportHandler;
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
function objectFields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
const PROXY_TERMINAL_PATH_RE = /^\/hosts\/([^/]+)\/api\/sessions\/[^/]+\/terminal$/;
const PROXY_RESPONSE_TIMEOUT_MS = 10_000;
const HOSTS_PROBE_DEADLINE_MS = 3000;
const HOP_BY_HOP_HEADERS: Record<string, true> = {
  connection: true, 'keep-alive': true, 'transfer-encoding': true, te: true,
  trailer: true, upgrade: true, 'proxy-authenticate': true,
};

// The request promise includes SSH setup. Arm only once it yields a request;
// a response clears the deadline permanently, including for idle SSE streams.
function relayFirstResponse(
  opening: Promise<ClientRequest>,
  timeoutMs: number,
  send: (upstream: ClientRequest) => void,
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
    const timer = setTimeout(() => { try { upstream.destroy(); } catch {} fail('timeout'); }, timeoutMs);
    upstream.on('error', (cause) => { clearTimeout(timer); error(cause); });
    upstream.on('response', (peerRes) => {
      clearTimeout(timer);
      if (settled) return peerRes.resume();
      settled = true;
      respond(peerRes);
    });
    send(upstream);
  }).catch(error);
}

function copyRelayResponseHeaders(peerRes: IncomingMessage, res: TransportResponse): void {
  for (const [key, value] of Object.entries(peerRes.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS[lower] === true || lower.startsWith('access-control-')) continue;
    res.setHeader(key, value!);
  }
}

export function createRelayHandlers(ports: RelayPorts): RelayHandlers {
  const { fleetArtifacts } = ports;
  const rawApi: TransportHandler = (req, res) => {
    const remote = remoteHosts.getRemote(req.params.name);
    // An unknown or malformed name is a bare 404 — the fleet map is not a
    // discovery surface.
    if (!remote) return res.status(404).type('text/plain').send('Not found');
    proxyToRemote(remote, req, res, fleetArtifactHook(remote, req));
  };

  function proxyToRemote(remote: Remote, req: TransportRequest, res: TransportResponse, hook: ArtifactHook | null = null) {
    const unreachable = (reason: unknown) => {
      res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name, reason });
    };
    // A peer already known down within its backoff slot answers instantly. A
    // sleeping tailscale machine black-holes the connect rather than refusing
    // it, so dialing anyway costs the whole first-byte timer on every request;
    // the slot expiring (3-16s) is what re-dials, no other machinery needed.
    const known = remoteHosts.reachability(remote);
    if (known && !known.reachable) return unreachable(known.error || 'unreachable');

    // A hooked response is read, not relayed byte for byte, so the peer must
    // not compress it.
    const headers = hook ? { ...req.headers, 'accept-encoding': 'identity' } : req.headers;
    relayFirstResponse(
      remoteHosts.request(remote, { method: req.method, path: `/api${req.url}`, headers }),
      PROXY_RESPONSE_TIMEOUT_MS,
      (upstream) => {
        req.on('aborted', () => { try { upstream.destroy(); } catch {} });
        req.pipe(upstream);
      },
      (peerRes) => {
          res.status(peerRes.statusCode!);
          copyRelayResponseHeaders(peerRes, res);
          if (hook && String(peerRes.headers['content-type'] || '').includes('application/json')) {
            // The body is about to change length (and may be rewritten).
            res.removeHeader('Content-Length');
            return relayHookedJson(peerRes, res, hook);
          }
          // Content-Encoding passes through untouched (compression already
          // excludes /hosts/*), so an event stream arrives as the peer wrote it.
          if (String(peerRes.headers['content-type'] || '').startsWith('text/event-stream')) res.flushHeaders();
          peerRes.pipe(res);
          res.on('close', () => { try { peerRes.destroy(); } catch {} });
      },
      (reason) => {
        // Only transport failures reach here; peer HTTP statuses do not
        // update the breaker.
        remoteHosts.noteTransportFailure(remote, reason);
        unreachable(reason);
      },
      remoteHosts.errorCode,
    );
  }

  // Buffering a proxied response is the documented exception to the byte-relay
  // rule and applies only to these two small JSON creation/revocation replies.
  const FLEET_ARTIFACT_BODY_LIMIT = 64 * 1024;
  const PROXY_SHARE_PATH_RE = /^\/sessions\/[^/]+\/share$/;
  const PROXY_PAGE_TOKEN_PATH_RE = /^\/pages\/([^/]+)$/;
  const PUBLIC_ARTIFACT_TIMEOUT_MS = 10_000;
  // A public artifact request is relayed as the browser sent it minus anything
  // that would leak the hub's origin/credentials into a peer's logs.
  const PUBLIC_FORWARD_HEADERS = ['accept', 'accept-language', 'range', 'if-none-match', 'if-modified-since', 'user-agent'];
  // Set by a hub fronting this host's page from a listener that has no /api to
  // answer the overlay (see serveFleetArtifact).
  const PAGE_COMMENTS_HEADER = 'x-pi-dish-page-comments';

  /** Absolute public URL for a hub-served path, or null (client builds it). */
  function publicUrlFor(publicPath: string) {
    const base = ports.publicBaseUrl();
    return base ? base.replace(/\/+$/, '') + publicPath : null;
  }

  function fleetArtifactPayload(token: string, kind: ArtifactKind) {
    const publicPath = kind === 'share' ? `/share/${token}` : `/page/${token}`;
    return { token, path: publicPath, url: publicUrlFor(publicPath) };
  }

  /**
   * Artifact bookkeeping for a proxied request, or null for everything else.
   *
   * A peer minting a share/page through this hub is the hub's cue to record
   * where the token lives and to hand back *its own* public URL: the browser
   * is on the hub, and the peer's PI_DISH_SHARE_BASE_URL describes a front
   * door this reader may not have.
   */
  function fleetArtifactHook(remote: Remote, req: TransportRequest): ArtifactHook | null {
    const reqPath = req.url.split('?')[0];
    const isShare = PROXY_SHARE_PATH_RE.test(reqPath);
    const pageTokenMatch = PROXY_PAGE_TOKEN_PATH_RE.exec(reqPath);

    // /shares/import is here too: an OMP session's share is a snapshot the peer
    // minted from its live session, and it needs fronting like any other.
    if (req.method === 'POST' && (isShare || reqPath === '/shares/import' || reqPath === '/pages')) {
      const kind = reqPath === '/pages' ? 'page' : 'share';
      return (status, body) => {
        if (status < 200 || status >= 300) return body;
        if (!body || typeof body !== 'object' || !fleetArtifacts.record(objectFields(body).token, remote.name, kind)) return body;
        return { ...body, ...fleetArtifactPayload(objectFields(body).token as string, kind) };
      };
    }

    if (req.method === 'DELETE' && (isShare || pageTokenMatch)) {
      // A page revoke names its token in the path; a share revoke reports the
      // token it removed (older peers don't — the serving path's 404 prune is
      // the backstop for those).
      const pathToken = pageTokenMatch ? decodeURIComponent(pageTokenMatch[1]) : null;
      return (status, body) => {
        if (status < 200 || status >= 300) return body;
        const token = pathToken || (body && typeof objectFields(body).token === 'string' ? objectFields(body).token : null);
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
      // Not the small artifact reply it claimed to be: stop interpreting.
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

  /**
   * Which configured remote answers to a hostId. Fleet-map membership is the
   * authorization (block 6's trust statement): only remotes this host already
   * knows are ever probed, and an id nobody claims simply has no answer.
   */
  async function findRemoteByHostId(hostId: string): Promise<Remote | null> {
    const remotes = remoteHosts.listRemotes();
    const probes = await Promise.all(remotes.map((remote) => Promise.race([
      remoteHosts.probe(remote).catch((): BoundedProbe => ({ reachable: false })),
      new Promise<BoundedProbe>((resolve) => setTimeout(() => resolve({ reachable: false }), HOSTS_PROBE_DEADLINE_MS).unref()),
    ])));
    const index = probes.findIndex((probe) => probe.reachable && probe.descriptor?.hostId === hostId);
    return index >= 0 ? remotes[index] : null;
  }

  // An agent on a peer publishes locally, then asks the hub to front it. The
  // agent talks only to its own server (which proxies this call), so it never
  // needs the hub's address or credential.
  const registerArtifact: TransportHandler = async (req, res) => {
    const { token, kind, hostId } = objectFields(req.body);
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
    // Unmapping only ends public reachability through this hub; the artifact
    // itself is the owning host's to revoke.
    res.json({ revoked: fleetArtifacts.remove(req.params.token) });
  };

  /**
   * Fallback for a /share or /page token this host doesn't own: stream it from
   * the peer that does. Unmapped tokens never get here — the caller answers
   * them as bare 404s without contacting anybody.
   */
  function serveFleetArtifact(req: TransportRequest, res: TransportResponse, kind: ArtifactKind, { annotate = true }: { annotate?: boolean } = {}): void {
    const token = req.params.token;
    const notFound = () => { if (!res.headersSent) res.status(404).type('text/plain').send('Not found'); };
    const mapping = fleetArtifacts.get(token);
    if (!mapping || mapping.kind !== kind) return notFound();
    const remote = remoteHosts.getRemote(mapping.host);
    if (!remote) return notFound();

    const rest = kind === 'page' ? (req.params[0] || (req.path.endsWith('/') ? '/' : '')) : '';
    const documentRequest = kind === 'share' || rest === '' || rest === '/';
    const queryAt = req.originalUrl.indexOf('?');
    const query = queryAt >= 0 ? req.originalUrl.slice(queryAt) : '';
    const peerPath = kind === 'share' ? `/share/${token}${query}` : `/page/${token}${rest}${query}`;

    const headers: OutgoingHttpHeaders = { 'accept-encoding': 'identity' };
    for (const name of PUBLIC_FORWARD_HEADERS) {
      if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    }
    // The comment overlay's calls are relative, so they can only work where
    // /api is mounted. Asking the owner to skip the injection keeps the public
    // listener serving raw, non-commentable HTML as it does for local pages
    // (an older peer ignores the header and its overlay simply stays inert).
    if (kind === 'page' && !annotate) headers[PAGE_COMMENTS_HEADER] = 'off';

    relayFirstResponse(
      remoteHosts.request(remote, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', path: peerPath, headers }),
      PUBLIC_ARTIFACT_TIMEOUT_MS,
      (upstream) => upstream.end(),
      (peerRes) => {
          if (peerRes.statusCode === 404) {
            // Revoked on the owner: the mapping is dead, and this reader gets
            // the same bare 404 an unknown token gets. Only the token's own
            // document proves that — a missing *asset* under a live page is
            // the page's own 404, not the artifact's. And the slash spelling
            // alone proves nothing: a single-file page root 404s `/page/t/`
            // while `/page/t` is alive, so verify the bare form before
            // pruning and send the reader there when it lives.
            peerRes.resume();
            if (!documentRequest) return notFound();
            if (kind === 'page' && rest === '/') {
              return remoteHosts.request(remote, { method: 'GET', path: `/page/${token}`, headers })
                .then((check) => {
                  const checkTimer = setTimeout(() => { try { check.destroy(); } catch {} notFound(); }, PUBLIC_ARTIFACT_TIMEOUT_MS);
                  check.on('error', () => { clearTimeout(checkTimer); notFound(); });
                  check.on('response', (checkRes) => {
                    clearTimeout(checkTimer);
                    checkRes.resume();
                    if (checkRes.statusCode === 404) {
                      fleetArtifacts.remove(token, mapping.host);
                      return notFound();
                    }
                    res.redirect(302, `/page/${token}${query}`);
                  });
                  check.end();
                })
                .catch(notFound);
            }
            fleetArtifacts.remove(token, mapping.host);
            return notFound();
          }
          res.status(peerRes.statusCode!);
          copyRelayResponseHeaders(peerRes, res);
          peerRes.pipe(res);
          res.on('close', () => { try { peerRes.destroy(); } catch {} });
      },
      () => { res.status(502).type('text/plain').send('Host unavailable'); },
      null,
    );
  }

  const hosts: TransportHandler = async (_req, res) => {
    const remotes = remoteHosts.listRemotes();
    // Probes are memoized and individually bounded; the race is the belt to
    // that braces, so one wedged peer can never hold the fleet list open.
    const probes = await Promise.all(remotes.map((remote) => Promise.race([
      remoteHosts.probe(remote).catch((): BoundedProbe => ({ reachable: false, error: 'unreachable' })),
      new Promise<BoundedProbe>((resolve) => setTimeout(() => resolve({ reachable: false, error: 'timeout' }), HOSTS_PROBE_DEADLINE_MS).unref()),
    ])));

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

  // Feedback on a page this host merely fronts belongs to the host whose agent
  // will read it. The overlay injected into a proxied page makes its calls
  // relative, so they land here; every one of them names its page token, which
  // is what routes them home. Anything without a token — or with one this host
  // owns or has never mapped — takes the normal local path.
  function fleetPageTokenFor(req: TransportRequest) {
    const body = objectFields(req.body);
    const candidates = [req.query?.pageToken, body.pageToken, objectFields(body.target).pageToken];
    const token = candidates.find((value) => fleetArtifacts.isValidToken(value));
    if (!token || ports.localPageExists(token)) return null;
    const mapping = fleetArtifacts.get(token);
    return mapping && mapping.kind === 'page' ? mapping : null;
  }

  const comments: TransportHandler = (req, res, next) => {
    const mapping = fleetPageTokenFor(req);
    if (!mapping) return next();
    const remote = remoteHosts.getRemote(mapping.host);
    if (!remote) return next();
    proxyCommentToOwner(remote, req, res);
  };

  // Comment payloads are small JSON both ways, and express has already parsed
  // the request body here — the same buffered exception the artifact creation
  // responses get, not a second byte relay.
  function proxyCommentToOwner(remote: Remote, req: TransportRequest, res: TransportResponse) {
    const rest = req.url === '/' ? '' : req.url;
    const payload = req.method === 'GET' || req.method === 'HEAD' ? null : JSON.stringify(req.body ?? {});
    const headers: OutgoingHttpHeaders = { accept: 'application/json', 'accept-encoding': 'identity' };
    if (payload !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }

    relayFirstResponse(
      remoteHosts.request(remote, { method: req.method, path: `/api/comments${rest}`, headers }),
      PROXY_RESPONSE_TIMEOUT_MS,
      (upstream) => {
        if (payload !== null) upstream.write(payload);
        upstream.end();
      },
      (peerRes) => {
          let raw = '';
          let overflow = false;
          peerRes.setEncoding('utf8');
          peerRes.on('data', (chunk) => {
            if (overflow) return;
            raw += chunk;
            if (raw.length <= FLEET_ARTIFACT_BODY_LIMIT) return;
            overflow = true;
            peerRes.destroy();
            res.status(502).json({ error: `Host ${remote.name} returned an oversized comment response`, host: remote.name });
          });
          peerRes.on('end', () => {
            if (!overflow) res.status(peerRes.statusCode!).type('application/json').send(raw || '{}');
          });
          peerRes.on('error', () => { try { res.end(); } catch {} });
      },
      (reason) => { res.status(502).json({ error: `Host ${remote.name} is unreachable`, host: remote.name, reason }); },
      remoteHosts.errorCode,
    );
  }

  // Proxied terminals work even when this host's own terminal feature is off:
  // the PTY lives on the peer.
  const upgrade: RelayHandlers['upgrade'] = (req, socket, head, url) => {
    const match = PROXY_TERMINAL_PATH_RE.exec(url.pathname);
    if (!match) return false;
    const remote = remoteHosts.getRemote(match[1]);
    if (!remote) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return true;
    }
    // This host's gate, applied by hand exactly like the local terminal's —
    // the peer's own credential is attached downstream, not the caller's.
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
        // A client that hangs up mid-handshake must not leave a half-open
        // request against the peer.
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
        // The peer refused the handshake (auth, unknown session): relay its
        // status so the client sees the peer's answer, not a dead socket.
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
  return { rawApi, registerArtifact, listArtifacts, removeArtifact, hosts, comments, publicArtifacts: { serve: serveFleetArtifact }, upgrade };
}
