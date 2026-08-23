# Task: Multi-host aggregation (scoping)

**Priority:** P2 (scoping — not yet a buildable contract)
**Status:** Scoped 2026-08-22 from t3code study (upstream @ 30be31195) + pi-dish
API audit. Decision-shaped; open questions flagged inline.
**Affects (eventually):** `server.js`, new `lib/remote-hosts.js`, `public/app.js`
(fetch layer), `public/helpers.js`, docs.
**Reference:** the t3code worktree used for the study was disposable; the
canonical docs are `docs/internals/{overview,remote,connection-runtime,
environment-auth}.md` in the t3code repo — unusually good reading.

## Problem

pi-dish now runs on 5 personal hosts (one tailnet) and 2–3 work hosts
(SSH-only reachability, no tailnet). Checking each host's UI separately is
the pain. Wanted: one pane of glass over all hosts' sessions, with a sane
security story, no N² connection mesh, and — in principle — the option of
either (a) one host acting as hub, fronted by e.g. a Cloudflare Zero Trust
tunnel, or (b) a "serverless" entry point (static UI on a worker/pages)
talking to all end nodes directly, which would also unlock a phone app that
connects straight to hosts.

## What t3code does (the study, condensed)

t3code ships multi-host today and its answer is unambiguous: **there is no
hub**. One server per host, bound to 127.0.0.1 (their server has no TLS
listener at all); every client — web, desktop, mobile, all composing one
shared client-runtime — keeps a *local catalog* of known hosts and holds one
authenticated WebSocket per host, all at once, retrying independently.
Aggregation (merged project/thread lists across hosts) is **entirely
client-side**. Remoteness is only a question of how a connection reaches a
host:

- **SSH** (desktop only): not a protocol — a launcher. A bootstrap script is
  piped over `ssh … sh -s` stdin (finds node, reuses a running server if its
  pid is alive and loopback-bound — marked `external` so disconnect never
  kills it — else starts one on 127.0.0.1, prints `{port}` as JSON), then a
  plain `ssh -N -L localport:127.0.0.1:remoteport` forward. The client then
  treats `http://127.0.0.1:<localport>` like any other host. SSH is both
  transport encryption and authn.
- **Tailscale**: ~400 lines shelling out to the user's authed `tailscale`
  CLI: `tailscale serve --bg --https=443 http://127.0.0.1:<port>` gives the
  host a real-cert HTTPS endpoint on the tailnet; MagicDNS name + tailnet IPs
  are advertised as candidate endpoints. Not a connection kind — pairing
  proceeds over the normal bearer path.
- **Cloudflare relay** ("T3 Connect", optional account): a Worker that is
  **control-plane only**. It brokers short-lived key-bound credentials via
  mutually-signed Ed25519 proofs and provisions a per-host `cloudflared`
  tunnel hostname, then gets out of the way — clients talk *directly* to
  `wss://<host-tunnel>/ws`. The relay never proxies session traffic and
  can't use the credentials it brokers (they're bound to the client's DPoP
  key).

Auth model per host (their "environment"): one-time pairing credential
(QR/URL with the token **in the fragment**, never the query) → RFC-8693
token exchange → 30-day scoped bearer, stored client-side → and per socket
connect, a **5-minute single-purpose ticket** fetched over authed HTTP and
appended as `?wsTicket=` so long-lived tokens never appear in URLs. Scopes
are enforced per RPC method, not per socket. Host identity is a persisted
`environmentId`; every connect re-fetches the descriptor and fails hard on
id mismatch. Capability flags on the descriptor (absent = unsupported, hide
the button) handle version skew across hosts.

Offline: connection phase (`offline/connecting/backoff/connected/blocked`)
is kept strictly separate from per-domain data status
(`empty/cached/synchronizing/live` + separate error). An unreachable host's
cached sessions stay in the merged list, marked stale; transient failures
retry forever on a `[3s,4s,8s,16s]` ladder; auth failures park in `blocked`
instead of spinning.

## Decision: the client is the aggregator

Adopt t3code's shape. The pi-dish *frontend* becomes the thing that holds N
host connections and merges; the server grows only (a) an identity/
descriptor endpoint, (b) an auth story for non-loopback exposure, and (c) an
optional SSH hub-proxy mode for hosts a browser can't reach directly. This
answers all four original questions at once:

- **No N²** — every topology below is a star centered on the client (or on
  the hub, which the client reaches; never host↔host).
- **"Web UI on a worker"** — the pi-dish server can never run in a Worker
  (fs, Unix sockets, node-pty, tmux, native fff), but it doesn't need to:
  the UI is already static files. Any static host (a worker, pages, or just
  any one pi-dish instance — every host already serves the bundle) can be
  the entry point; the browser fans out to hosts from there. The Worker
  buys nothing over "open host A's UI" except an always-up URL.
- **"Hub through a Zero Trust tunnel"** — equally effective for
  reachability, and strictly less new code: it composes with the SSH hub
  mode (phase 3) or even with today's single-host pi-dish. The trade is the
  double hop (phone → CF edge → hub → SSH → peer) and the hub as SPOF; the
  per-host-tunnel alternative (t3code's relay shape) removes the hub from
  the data path but needs a connector per host and a broker. Both stay
  available; neither is foundational.
- **Android app** — falls out for free: a native/TWA wrapper around the same
  client is just another aggregating client with its own host catalog.
  Native apps also sidestep the mixed-content wall (below).

The one honest cost vs a hub-side aggregator: the browser must be able to
*reach* every host. On the tailnet that's already true; `tailscale serve`
makes it true for HTTPS contexts too. For work (SSH-only), the hub-proxy
mode covers it — and because proxied peers surface as same-origin base
paths, the client code treats both cases identically.

### The mixed-content wall (plan around it, don't fight it)

A page served over HTTPS (worker/pages, or any host behind `tailscale
serve`/cloudflared) cannot fetch plain-`http://` LAN/tailnet hosts. t3code
encodes this per endpoint (`hostedHttpsApp: mixed-content-blocked`) rather
than working around it. Consequences:

- HTTP entry point (open host A's UI over plain tailnet http) → can reach
  all plain-http hosts. The everyday personal-tailnet case; works day one.
- HTTPS entry point → every host needs HTTPS too: `tailscale serve` per
  host (real certs, tailnet-gated, one command) or a cloudflared tunnel per
  host. Document both as recipes; maybe later a "Serve" toggle in settings.
- Native Android app → no mixed-content rule; can mix freely.

## Building blocks

### 1. Host identity + descriptor (server)

`GET /api/host` (unauthed, like t3code's `/.well-known`): `{ hostId, label,
version, capabilities }`. `hostId` is a uuid generated once into
`~/.pi/dish/host-id`; `label` defaults to `os.hostname()`, overridable in
settings. `capabilities` is the t3code bag-of-booleans pattern — absent
means unsupported — so mixed-version fleets degrade per-feature instead of
breaking (`terminal`, `spawns`, `comments`, `pages`, `skills`, …). Client
verifies `hostId` matches the catalog entry on every (re)connect.

### 2. Client host catalog + fetch layer (the real refactor)

- Catalog in localStorage: `[{ hostId, label, base, token? }]` plus the
  implicit self entry (`base: ''`). Managed in settings (add by URL, paste
  token, test button); hub-provided entries (block 5) merge in from
  `GET /api/hosts` at boot.
- All 53 fetch sites route through `api(host, path, opts)`; `EventSource`
  and the terminal `WebSocket` URL builders take the host base too.
  Session-scoped calls get the host from the session's entry — every
  session object in client state gains a `host` ref, and **wire ids stay
  host-local** (t3code's key decision): namespacing happens only in client
  keys, `hostId + ' ' + sessionId`, with a parse helper in helpers.js.
- localStorage that keys on session id (drafts, history, seen-map, pinned,
  expanded-families, terminal mode/size) moves to the composite key —
  generic `session.jsonl` header ids can collide across hosts. Migration:
  treat bare keys as self-host.
- Per-host connection state (t3code's split, simplified to pi-dish's
  polling reality): `reachable | connecting | backoff | blocked(auth)` per
  host, driven by the existing 10s sidebar poll fanning out per host
  (`Promise.allSettled`, per-host sequence guards like `loadSessions`'
  current one). One down host must degrade to one stale sidebar group with
  an "unreachable" affordance — never blank the list, never block the
  merge on the slowest host (render as results land, t3code-style
  progressive fill). Cache each host's last session list in memory (and
  optionally localStorage for cold boots) so its rows persist offline,
  dimmed.

### 3. What merges vs what proxies vs what stays host-scoped

Audit result — the API splits cleanly:

- **Merge (client-side):** `/api/sessions` (sidebar: host becomes a
  grouping/badge dimension — workspace groups get a host chip when >1 host;
  Recent view interleaves on lastActivity), `/api/search` (fan out, merge on
  `searchScore` — `scoreSessionMatch` is shared code, scores are comparable
  across hosts), `/api/usage-summary` (sum totals/day buckets client-side;
  note: server truncates groups to top-20, so merged workspace/session
  breakdowns are approximate at the tail — acceptable, label it, don't
  build a hub endpoint for it).
- **Pass-through by session's host (no merging):** all 29
  `/api/sessions/:id/*` routes — messages, stream (SSE), prompt/steer/
  follow-up, terminal WS, diff, files, tree/branch, stats, share, close.
  Only the *selected* session streams, so multi-host adds no standing
  socket load. File inspection is fully covered by this: the file viewer,
  @-mention search, and the diff view are session-scoped, so the **owning
  host** does the filesystem reads, runs its own fff, walks its own git
  repos, and enforces the existing containment rules (cwd subtree +
  tool-touched paths) against its own disk. The hub never touches a peer's
  filesystem directly, and no path input crosses hosts un-gated.
- **Host-scoped by an explicit picker:** new-session/resume flow (`/api/
  models`, `/api/tmux/targets`, `/api/dirs*`, `/api/sessions/new`) — the
  new-session takeover gains a host select (persisted like spawn target);
  everything below it re-queries the chosen host. Harness config, themes,
  settings, comments, pages, skills stay per-host (viewed session's host).

### 4. Security policy (server)

Today pi-dish trusts the network (loopback default, LAN/tailnet by choice).
Multi-host formalizes that instead of replacing it:

- **Bearer token, opt-in:** `~/.pi/dish/token` (or `PI_DISH_TOKEN`). When
  set, every `/api` request requires `Authorization: Bearer` — constant-time
  compare. Public listeners (`/share`, `/page` on `PI_DISH_SHARE_PORT`)
  stay tokenless by design. When unset, behavior is exactly today's
  (tailnet-trust). Not per-client tokens, no scopes, no expiry in v1 —
  t3code's RFC-8693/DPoP apparatus is the right shape for a product with
  accounts; for a personal fleet a static token per host is proportionate.
- **Tickets for streams:** `EventSource` can't set headers and tokens must
  not live in URLs, so when a token is configured: `POST /api/auth/ticket`
  (authed) → 60s single-use ticket accepted as `?ticket=` by the SSE route
  and the terminal WS upgrade. (SSE reconnects re-mint; trivial client
  wrapper.)
- **CORS:** cross-origin hosts need it. `Access-Control-Allow-Origin`
  echoing an allowlist from settings (`allowedOrigins`), only when a token
  is set — CORS without auth would open the API to any page the browser
  visits on the same network. Same-origin (self + hub-proxied) needs none.
- Origin-check the terminal WS upgrade against the same allowlist.
- **SSH hop (block 5):** peers stay loopback-bound; no token needed on that
  path — ssh keys are the credential, same posture as t3code.

### 5. Fleet config + `/hosts/<name>` proxy (server-side, on any host)

Originally scoped as "hub mode" for the work case; generalized because the
same mechanism is what gives **agents** cross-host reach (block 6). Any
host's server may know about peers and re-serve them under
`/hosts/<name>/api/*`; "the hub" is simply whichever host a browser or
tunnel happens to enter through. The client just sees extra catalog entries
with `base: '/hosts/<name>'`.

- Config `remotes` in `~/.pi/dish/settings.json`, two transport kinds:
  - `{ name, url, token? }` — **direct**: plain `http.request` to a peer's
    tailnet/LAN address, peer token attached server-side. No standing
    connection at all; the everyday personal-fleet transport.
  - `{ name, sshDest, remotePort? }` — **ssh**: for peers only reachable by
    ssh (work). `sshDest` is anything `ssh` accepts, honoring
    `~/.ssh/config` (jump hosts, keys, aliases). Use the **system ssh
    binary** via long-lived `spawn` (argv arrays, lib/tmux.js rules) — no
    ssh2/native dep (work-machine constraint), and it inherits agent/config
    for free.
- For ssh remotes, forward to a **Unix socket**, not a port: `ssh -N -o
  ExitOnForwardFailure=yes -o ServerAliveInterval=15 -L
  <rundir>/<name>.sock:127.0.0.1:<remotePort> <sshDest>`. No local port
  allocation, no other-user access on shared hosts (0700 dir).
- `lib/remote-hosts.js`: per-remote supervisor — health probe is `GET
  /api/host` (through the socket for ssh, straight HTTP for direct);
  backoff ladder on failure (t3code's `[3s,4s,8s,16s]`, reset after
  stable); ssh forwards spawn lazily on first use, direct remotes need no
  supervision beyond the probe. Never manage the remote *process* in v1,
  just report "pi-dish not running on <name>" (a t3code-style stdin
  bootstrap that *starts* pi-dish remotely is a later nicety — all target
  hosts already run it).
- Reverse proxy `/hosts/<name>/api/*` with node's raw `http.request` (no
  proxy dep): stream bodies both ways unbuffered, forward the `upgrade`
  event for the terminal WS by splicing sockets, and exclude proxied SSE
  from compression (same identity-encoding assertion the local stream route
  keeps). Strip caller auth before forwarding; attach the peer's token
  (direct) or nothing (ssh — peers loopback-trusted).
- `GET /api/hosts` returns self + configured remotes with reachability, so
  browser catalogs and the peer-sessions skill both auto-discover the
  fleet.
- N² check: config may name every peer on every host (a small file, can be
  one synced fleet map), but *connections* stay on-demand request/response
  or lazy ssh forwards — no standing mesh, and hosts never gossip.

### 6. Agent-facing cross-host control (peer-sessions skill)

Agents never grow a host catalog of their own: an agent always talks to
**its own host's** server on loopback, and the `/hosts/<name>` proxy is its
door to the fleet. Every existing agent surface composes unchanged behind
it — `GET /hosts/tycho/api/sessions`, `POST /hosts/tycho/api/sessions/new`,
`.../:id/prompt|steer|follow-up|interrupt|close`, `/api/search`, comments,
pages. No new agent-facing semantics, just a path prefix.

- `skills/pi-dish-sessions/` gains `hosts` (list the fleet with
  reachability, from `GET /api/hosts`) and a `--host <name>` flag on
  list/search/spawn/show/prompt/steer/follow-up/interrupt/resume/close.
  Default remains local. The comments CLI gets the same flag if
  cross-host review flows turn out to matter.
- Cross-host launch provenance stays **advisory**, per the existing rule:
  the spawning agent's identity is recorded host-qualified
  (`hostId:sessionId`) in the *target* host's provenance sidecar; related
  chips can render a "from <host>" hint. No ownership, no cascade, no
  lifecycle authority — same posture as today.
- Trust statement (deliberate): any process that can reach a host's
  loopback API can act on all of that host's configured remotes. That is
  the existing trust model extended, not a new hole — a local agent
  already fully controls local sessions, and the fleet map is the same
  unix-level config that grants the browser hub path. If a host should
  *not* be reachable by peers' agents, don't put it in their `remotes`
  (authorization = fleet-map membership + per-host tokens).

### 7. Artifacts through the hub (shares + pages for the whole fleet)

The hub is the natural public front door (it's what sits behind the Zero
Trust tunnel / `PI_DISH_SHARE_PORT`), but share exports and published
pages are generated/served **live from the owning host's disk**. So the
hub gets a small fleet-artifact registry, `~/.pi/dish/fleet-artifacts.json`
(shares.js rules): `{ token: { host, kind: 'share'|'page' } }`.

- **Serving:** hub `/share/:token` and `/page/:token(/*)` check local
  registries first, then the fleet map → stream-proxy from the owner
  (export caching stays on the owner, keyed on its JSONL mtime/size;
  page assets stay contained by the owner's sendFile root). Unknown
  tokens are bare 404s — **never probe peers for unknown tokens**; only
  explicitly registered mappings resolve. The dedicated public listener
  serves fleet-mapped `/share` + `/page` like local ones but still never
  mounts `/api` or the `/hosts/*` proxy.
- **Creating from the hub UI:** the stats-modal share section, artifacts
  modal, and file-viewer 🌐 already operate on the viewed session — via
  the proxy they hit the owning host (which mints its token as today,
  idempotent per session); the hub records the mapping and **rewrites the
  returned `url` to its own public base** (`PI_DISH_SHARE_BASE_URL` on the
  hub governs handed-out URLs, not the owner's).
- **Agent publishing with a public URL:** the pages skill registers
  locally as today, then optionally (`--via <host>` or a
  `PI_DISH_PUBLIC_VIA` default) calls the hub's mapping route through its
  own server's `/hosts/<hub>` proxy and pastes the hub URL into chat.
  Fleet-map membership authorizes this, like everything else in block 6.
- **Revocation:** revoking on the owner kills the content everywhere (hub
  proxy sees the 404 and lazily prunes its mapping); deleting the hub
  mapping kills public reachability only. Both surfaces show which is
  which.
- **Comments gotcha (real):** commentable pages are main-app-served, and
  `artifact-comments.js` is injected by the *owner* when the hub proxies
  the page — but the overlay's relative `/api/comments*` calls then land
  on the **hub's** origin, whose comment store doesn't know the page. The
  hub must route comment API calls whose `pageToken` is fleet-mapped to
  the owning host, so feedback lands where the session's agent will read
  it. Without this, comments on hub-served peer pages silently file into
  the wrong host.

### 8. Off-tailnet access (recipes, not code)

- **Hub behind Cloudflare Zero Trust:** `cloudflared` + Access in front of
  the hub (or any single host). Zero pi-dish changes — works today; Access
  handles authn at the edge, pi-dish token optional beneath it. SSE and WS
  both traverse cloudflared fine. Document it.
- **Per-host HTTPS on the tailnet:** `tailscale serve --bg --https=443
  http://127.0.0.1:3333` per host — needed only for HTTPS entry points
  (mixed content). Document; possibly later automate à la t3code (one
  execFile call, but scrub stderr from logs — tailscale prints auth keys
  to stderr; t3code classifies stderr into an enum and discards raw text).
- **t3code-style broker (worker + per-host cloudflared + key-bound
  credential mint)** — explicitly **not building**. It's the right design
  for a multi-tenant product; for one person's fleet, Zero Trust Access +
  the two options above deliver the same reachability with none of the
  Ed25519/DPoP machinery. Revisit only if pi-dish grows accounts.

### 9. Android

Phase-last. The aggregating client makes this a packaging problem: TWA/
Capacitor wrapper over the static UI with the host catalog, or just a PWA
opened against any host. Native wrapper avoids mixed content entirely and
could add per-host client certs later. No pi-dish server work required.

## Where config lives

Fleet topology and auth are **unix-host-level, deliberately**: per host,
`~/.pi/dish/host-id` (generated), `~/.pi/dish/token` (optional), and
`remotes` + `label` + `allowedOrigins` in `~/.pi/dish/settings.json`.
Editing the fleet means editing files (or syncing one fleet map across
hosts) — no fleet-editing UI in v1; the UI *reads* it (`/api/hosts`
reachability, settings modal read-only display). The only browser-level
config is the client's own catalog in localStorage (directly-added hosts +
their tokens, for the no-hub tailnet case) and the usual device-local view
prefs. Agents read nothing new: their fleet view comes from `GET
/api/hosts` on loopback.

## Search indexing and usage costs across hosts

Each host's session index (`lib/session-index.js`) stays **strictly
host-local** — built from, and colocated with, that host's own JSONL corpus.
Nothing replicates: the work machine's thousands of sessions never leave
it, index build/refresh cost lands on the machine that owns the files, and
a host addition/removal has zero effect on other hosts' indexes. Queries
fan out — sidebar search and the advanced-search takeover call each host's
`/api/search` (directly or via `/hosts/<name>`) and merge on `searchScore`,
which is comparable across hosts because ranking is the shared
`scoreSessionMatch`; snippets ride each host's own results. Usage/costs
likewise: `/api/usage-summary` per host, client sums totals and day/model
buckets; the top-20 group truncation makes merged workspace/session tails
approximate (label it). Cost estimates come from each host's own pi model
catalog, so the same model could in principle price differently on a stale
host — the existing "estimate, never billed spend" rule already covers
presenting that honestly.

## Non-goals

- Running the server (or any session logic) on a Worker.
- Cross-host session *moves* (move/resume-elsewhere) and placement logic
  ("run on least-busy host") — spawning on an **explicitly named** host is
  in scope (block 6); choosing the host for you is not.
- Cross-host index replication or a global search index — fan-out only.
- Accounts, per-client tokens, scopes, token rotation, E2E crypto.
- Hub-side merged endpoints (`/api/sessions?all-hosts`) — the client
  merges; don't build the same logic twice. (Note: this makes the *phone's
  CPU* do the merge; with ~7 hosts and the poll being metadata-only, this
  is well inside budget.)
- Auto-installing/starting pi-dish on remotes (v1 reports instead).

## Phasing

1. **Foundations:** `/api/host` identity + capabilities; token + ticket +
   CORS (all opt-in, default behavior unchanged); `api()` fetch-layer
   refactor with composite client keys + localStorage migration. Ship with
   zero visible change for single-host users.
2. **Client aggregation:** host catalog UI in settings; multi-host sidebar
   poll with per-host state, host badges/grouping, offline-host dimming;
   host picker in new-session; merged search + usage.
3. **Fleet proxy + agent reach:** `lib/remote-hosts.js` (direct-url + ssh
   transports, supervisor), `/hosts/<name>` proxy incl. WS upgrade + SSE,
   `/api/hosts`, peer-sessions skill `hosts`/`--host`. This is the
   work-machine unlock *and* the agent cross-host unlock.
4. **Fleet artifacts:** hub artifact registry, `/share`+`/page` fleet
   proxying with URL rewriting, pages-skill `--via`, pageToken-aware
   comment routing. (Depends on 3.)
5. **Recipes/docs:** Zero Trust tunnel, tailscale serve, PWA/Android notes.

Each phase is independently shippable; 1+2 alone solve the personal-tailnet
browsing case, 3 adds work hosts and agent-to-agent reach, 4 makes the hub
the fleet's public front door, 5 is reachability polish.

## Risks / gotchas (from both codebases)

- **Mixed content** is the sharpest edge — surface it in the host-add UI
  ("this host is http:// but you're on https://") instead of a silent
  failed fetch. t3code encodes endpoint compatibility as data; do the same
  check inline.
- **SSE through the hub proxy** must stay unbuffered end to end (existing
  compression exclusion extends to `/hosts/*`).
- **Session-id collisions across hosts** are real for generic
  `session.jsonl` header ids — composite keys everywhere client-side; the
  share/page routes stay host-local and are unaffected.
- **Version skew across 5+ hosts is the steady state**, not an edge —
  capability flags from day one; client hides what a host doesn't
  advertise.
- **Poll fan-out ordering:** per-host sequence guards, render-as-they-land;
  never `Promise.all` the sidebar.
- **tailscale/ssh stderr hygiene:** never log raw stderr from either
  (keys/env leak); classify to enums like t3code's `stderrDiagnosticOf`.
- **Don't kill what you didn't start:** if a bootstrap-remote-server path
  is ever added, copy t3code's `external` vs `managed` marking.
