# Task: Pi-Lineage Harness Support

**Priority:** P1
**Status:** Implemented and real-host verified — harness-specific wrappers, namespaced identity, mixed history, and tmux-only alternative-harness launch/resume
**Affects:** `extensions/pi-dish-bridge/index.ts`, live transport/session aggregation,
session discovery/read/index modules, `lib/pi-sdk.js`, session-keyed sidecar stores,
`server.js`, browser session state and routes, session-list/new-session UI, tests

## Goal

Support both Pi-derived harnesses:

- [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi), CLI `omp`
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent), CLI `prime-agent`

A known Pi-derived harness gets live support by loading its thin pi-dish bridge
wrapper. The wrappers share a public-API-only bridge core but explicitly bind
host identity and host-specific event/session behavior. A new Pi fork should
require only a small wrapper plus descriptor—not branches scattered through
`server.js`—to add historical discovery, tmux spawning/resume, and model
listing.

## Executive recommendation

This is feasible, with two deliberate concessions: alternative harnesses use a
harness-specific wrapper, and pi-dish does not use their native RPC modes.
Upstream Pi retains its existing RPC fallback for compatibility; OMP, Prime,
and future lineage harnesses are bridge-controlled processes launched or
attached through tmux.

The current bridge loaded unchanged in both harnesses and successfully exposed:

- socket registration and `hello`
- state and model discovery
- command discovery through the bridge
- rename and thinking-level controls

Both failed the same private queue-cancellation path. Their storage roots,
session layouts, CLI dialects, and process ownership also differ enough that the
server cannot safely treat either as the installed upstream Pi.

### Current managed canary (2026-08-08)

The completed integration canary runs OMP 17.2.11 with Bun 1.3.14 and Prime
Agent 0.7.1 through pi-dish's real HTTP/tmux paths. It uses isolated HOME,
tmux, bridge-socket, history, and Prime-daemon locations. Both harnesses route
`openai/gpt-4o-mini` through a local fake OpenAI Responses server, so the
canary needs no user credentials and cannot bill a provider.

It verifies, for both harnesses:

- protocol-v2 registration and the canonical namespaced route;
- command and model discovery;
- prompt delivery, `turn_start`, streamed `message_update`, `message_end`, and
  terminal turn events through pi-dish SSE;
- persisted assistant history read through the canonical API route; and
- managed resume retaining the same canonical route.

It additionally verifies OMP's explicit unsupported-close response and Prime's
generated-wrapper token claim, client/worker PID split, exact client-pane
detach refusal when Prime 0.7.1's worker remains in the pane process tree,
exact isolated-daemon cleanup, and a second streamed/persisted turn after
resume. Run it with `npm run test:lineage` and the three `PI_DISH_REAL_*` paths
documented in the README.

Build this around three deliberately separate contracts:

1. **Harness identity:** a stable id asserted by the explicitly loaded wrapper
   and checked against pi-dish's expected launch descriptor. Identity selects a
   descriptor; it does not grant process authority.
2. **Operation capabilities:** advertised or tested operations on each live
   wrapper transport. This gives a new Pi fork a useful bridge baseline without
   requiring RPC or private internals.
3. **Lifecycle ownership:** an explicit lease/mode describing whether pi-dish
   may stop an owned tmux process, only detach/close a client, or do nothing.
   Never infer this from harness id, transport type, or PID.

Small harness descriptors then add paths, tmux launch/resume argv, optional
model-list CLI, and session parsing. A logical session aggregates historical
state and one or more bridge instances; only upstream Pi may additionally have
an RPC role.

Do not try to make the existing private `AgentSession` patch the generic
contract. Keep upstream-Pi queue editing as an explicitly advertised quirk,
and disable controls when a host cannot implement them safely.

The harness-specific wrapper is the identity accommodation. The shared bridge
core must not import upstream `AgentSession` or infer a host from package/API
shape. A wrapper for an unknown fork can supply a stable namespace and public
capabilities without requiring pi-dish core changes.

## Executable spike results (2026-08-07)

The spikes used isolated temporary homes, the released CLIs, a dummy API key
without sending a model request, and the bridge file from this checkout. No
harness source was patched.

### Oh My Pi 17.2.10

Environment notes:

- The npm package requires Bun `>=1.3.14`; the orb's original Bun 1.3.10 could
  not parse its bundled CLI. Retrying with Bun 1.3.14 succeeded.
- The bridge was passed through `--extension .../index.ts`.
- OMP stores the generated session under `~/.omp/agent/sessions/`.

Observed bridge behavior:

| Probe | Result |
|---|---|
| Registry + socket + `hello` | pass |
| `get_state` | pass |
| `get_available_models` | pass, 51 models in the isolated test environment |
| `get_commands` through the bridge | pass, 12 commands |
| `set_session_name` | pass |
| `set_thinking_level(low)` | pass |
| `cancel_queued` | fail: private Pi queue internals are unavailable |

Observed native RPC behavior, retained only as evidence for excluding it from
the alternative-harness baseline:

- `get_available_commands` succeeds (38 commands in the spike).
- `get_commands` receives no response and times out.
- A `ready` frame and additional command/UI update frames precede or accompany
  normal RPC traffic.

Observed JSONL differences:

```text
line 0  { "type": "title", ... }
line 1  { "type": "session", "id": "...", "cwd": "...", "version": 3 }
line 2  { "type": "model_change", "model": "openai/gpt-5.5", ... }
```

The current pi-dish parser found the cwd and messages but returned
`sessionId: null` and `model: "unknown"`. Existing nested discovery did find
the file by basename. OMP's CLI uses `--resume <path|id>` and exposes structured
model listing through `omp models --json`; it does not accept Pi's current
`--list-models` flag.

### Prime Agent 0.7.0

Environment notes:

- The official installer was used with a temporary npm prefix and kernel setup
  disabled.
- The bridge was symlinked into `~/.prime/agent/extensions/`.
- Prime stores generated sessions as flat files under
  `~/.prime/agent/sessions/<id>.jsonl`.

Observed bridge behavior:

| Probe | Result |
|---|---|
| Registry + socket + `hello` | pass |
| `get_state` | pass |
| `get_available_models` | pass, 41 models in the isolated test environment |
| `get_commands` through the bridge | pass, 20 commands |
| `set_session_name` | pass |
| `set_thinking_level(low)` | pass |
| `cancel_queued` | fail: Prime's action scheduler is not Pi's private queue |

Prime's extension runs in a daemon worker, not the launched client:

```text
RPC launcher pid != bridge registry pid
```

That distinction affects tmux close/restart semantics, even though pi-dish will
not use Prime's native RPC mode. Prime has at least two daemon lifecycle modes:

- non-owning clients attach to resident workers and dispose with `detach`;
- native RPC/non-interactive launches request a `client_owned` worker and
  dispose with `complete_owned_session`, which asks the daemon to stop it.

The interactive TUI normally attaches to or creates a resident worker. Owning
its tmux pane therefore grants authority over the TUI client only, not the
daemon worker hosting the bridge. Signalling the bridge worker PID is wrong,
and killing the pane/client must not be reported as logical agent termination.
Follow-up source review found that an already-running daemon does **not**
forward arbitrary variables such as `PI_DISH_SPAWN_TOKEN` into each new
resident worker. pi-dish therefore passes a unique generated extension-module
path through Prime's session configuration; that module embeds the token and
constructs the ordinary thin wrapper. Token correlation binds the wrapper
registration to the expected tmux launch, but still grants no worker-close
authority. The generated module remains on disk for worker reload/recovery.

Observed native RPC behavior, retained only as evidence for excluding it from
the alternative-harness baseline:

- `get_commands` succeeds (11 commands in the spike).
- `get_available_commands` receives no response and times out.
- Prime retains `--mode rpc` but resumes with `--resume`, not `--session`.

Observed JSONL behavior:

- The normal Pi v3 header/model-change shape remains parseable.
- Prime adds bookkeeping entries such as `service_tier_change` and
  `session_state`, which pi-dish can ignore for basic transcript rendering.
- The current discovery walker returned zero sessions because it only visits
  JSONL files inside root-level workspace directories, while Prime's files are
  directly under the sessions root.
- Prime's persisted header id and filename id can differ. pi-dish must use one
  harness-defined routing identity consistently rather than mixing header,
  filename, and daemon active-session ids.

## Capability matrix

Legend: **yes** = supported by the host's public contract or directly observed;
**partial** = usable with a descriptor/translation or still needs a real-turn
canary; **no** = unsafe or unavailable through the current implementation.

| Capability | Upstream Pi | OMP | Prime Agent | Policy |
|---|---:|---:|---:|---|
| Load harness wrapper and register live session | yes | yes | yes | Thin wrapper over generic core |
| Explicit configured live harness namespace | Pi wrapper | OMP wrapper | Prime wrapper | Wrapper binding, not runtime heuristics |
| Agent/message/tool event streaming | yes | partial | partial | Public event adapter + real-turn canary per host |
| Prompt / steer / follow-up | yes | yes | yes | Public extension API |
| Abort | yes | yes | yes | Public extension API |
| Model list through bridge | yes | yes, observed | yes, observed | Public context API |
| Set model / thinking / name | yes | yes | yes | Public extension API; tested for thinking/name |
| Serializable extension UI/dialogs | yes | partial | partial | Public UI subset; bridge is the sole alternative-harness UI source |
| Queue read | yes, private canary | no current mapping | no current mapping | Capability-gated host quirk |
| Cancel one queued item | yes, private canary | no | no | Never generic; requires a stable host API |
| Compact | yes | no baseline | no baseline | Disabled until host lifecycle events are verified |
| Tree read | yes | no | no | Upstream Pi SDK only |
| Live tree navigation | yes, private priming | no | no | Upstream Pi private profile only |
| Historical transcript read | yes | yes | yes | Harness session profile |
| Historical discovery | yes | yes | yes | Harness paths/layout |
| Inactive rename/model mutation | yes via bundled Pi SDK | no | unsafe with daemon ownership | Host adapter or resume-first; never generic JSONL writes |
| Inactive branch + summary | yes via bundled Pi SDK | no | unsafe with daemon ownership | Host adapter or disable |
| New managed session | existing tmux/RPC | `omp` in tmux | `prime-agent` TUI in tmux; worker is resident | Harness tmux launch profile + wrapper token |
| Resume managed session | existing `--session` | `omp --resume` in tmux | `prime-agent --resume` in tmux | Harness tmux launch profile; no alternative RPC fallback |
| Commands | bridge or Pi RPC | bridge | bridge | Wrapper/bridge capability only for alternative harnesses |
| Model-list CLI | `--list-models` | `models --json` | unavailable | Optional descriptor command; never a session transport |
| Native RPC session transport | retained | out of scope | out of scope | Do not generalize `lib/rpc-session.js` to alternative harnesses |
| Close pi-dish-managed work | existing owned process | unsupported | client pane only; logical worker close unsupported | Never equate Prime TUI exit with worker termination |
| Prime RLM children / A2A graph | n/a | n/a | no | Explicitly later/out of scope |

The RPC observations justify not building a generic RPC dialect: unknown
commands can hang, command names already diverge, and Prime hides daemon
ownership behind its frontend. Alternative harness commands and live models
come through their wrappers; optional model-list CLI commands are short-lived
descriptor operations, not session transports.

## Feasibility and relative size

| Slice | Confidence | Relative size | Main uncertainty |
|---|---|---:|---|
| Shared bridge core + wrapper contract | high | M | Public event/UI subset across forks |
| Namespaced identity + persisted migration | high | L | Broad API/browser/persistence surface |
| OMP attach + history | high | M | Real-turn event/UI compatibility |
| Prime attach + history | high | M | Header/filename/active-id reconciliation |
| OMP managed tmux launch/resume | high | M | Process-identity/close canary |
| Prime managed tmux launch/resume | medium-high | M | Resident-worker registration and duplicate clients |
| Prime logical worker close | excluded | n/a | Requires a host-supported daemon completion contract |
| Alternative native RPC | excluded | n/a | Deliberate scope reduction |
| Generic queue cancellation | low | not recommended | Private internals already diverged in both hosts |

The first useful multi-harness release is a **large** change because identity
migration is foundational, not because either parser is difficult. Once Phase
1 contracts land, the OMP and Prime attach/history work can proceed in parallel
with disjoint fixtures/canaries and descriptor/profile code. Keep aggregate,
routing, migration, and shared bridge-protocol changes under one owner; merging
two independent rewrites of `server.js` would erase the benefit of parallelism.

## Current hard-coded seams

The compatibility problem is not confined to the extension:

1. `extensions/pi-dish-bridge/index.ts`
   - imports the host `AgentSession` class and patches its prototype;
   - reads/mutates `_steeringMessages`, `_followUpMessages`, core agent queues,
     and `_emitQueueUpdate`;
   - assumes upstream internal queue/compaction events;
   - derives registry identity from upstream session-file conventions.
2. `lib/rpc-session.js`
   - defaults to a command named `pi`;
   - bakes in one RPC command vocabulary;
   - resumes with `--session`;
   - assumes killing the child owns and ends the session;
   - should remain an upstream-Pi-only compatibility transport rather than
     becoming the generic harness seam.
3. `server.js`
   - fixes historical and settings paths to `~/.pi/agent`;
   - detects the bridge only under Pi's extension directory;
   - hardcodes `pi` tmux argv and falls back from hidden tmux to Pi RPC;
   - branches on `instanceof BridgeSession` for capabilities;
   - assumes one unqualified session id namespace;
   - treats bridge and RPC records as separate sessions and deduplicates only
     by raw id;
   - treats the RPC child PID or bridge registry PID as process ownership.
4. `lib/session-discovery.js` and `lib/session-files.js`
   - assume one directory layout, line-zero header, and upstream model-change
     schema.
5. `lib/pi-sdk.js`
   - directly loads this project's bundled upstream Pi SDK;
   - uses upstream model/auth/session/export/tree APIs for inactive work;
   - cannot safely open OMP or Prime files merely because they remain JSONL.

## Proposed architecture

Make the bridge wrapper the only alternative-harness session transport. Keep
the existing RPC implementation in an upstream-Pi-only branch so current Pi
fallback behavior does not block or leak into the generic design.

```text
Browser / HTTP API
        |
        v
opaque namespaced session key
        |
        v
logical session aggregate
   | historical candidate/profile
   | one or more instance-safe bridge roles
   | optional upstream-Pi RPC role only
   | explicit tmux/process lifecycle leases
   v
small harness registry
   |                   |                  |
   v                   v                  v
bridge wrapper     session profile     tmux launch profile
(identity/events)  (discover/read)     (argv/models/no-RPC policy)
```

### 1. Separate identity, operation support, and ownership

These concepts must not collapse into one `capabilities` object:

```javascript
{
  key, // opaque serialization of (harnessId, nativeRoutingId)
  harness: {
    id: 'pi' | 'omp' | 'prime' | 'pi-compatible',
    evidence: 'wrapper' | 'launch+wrapper' | 'session-root' | 'legacy',
    confidence: 'verified' | 'inferred' | 'unknown',
  },
  ids: { persisted, filename, daemonActive, instance },
  sessionFile,
  roles: {
    history: { candidate, profile },
    bridges: [{ instanceId, connection, capabilities, registryClaim }],
    piRpc: { connection, capabilities } | null,
  },
  lifecycleLeases: [
    // Examples, not interchangeable booleans:
    { mode: 'owned-tmux-agent', sessionClose: 'terminate-process', claim, pidIdentity },
    { mode: 'registered-agent-process', sessionClose: 'signal-process', claim, pidIdentity },
    { mode: 'owned-tmux-client', sessionClose: 'unsupported', clientClose: 'terminate-client', claim },
    { mode: 'external-wrapper', sessionClose: 'unsupported', claim },
  ],
}
```

Harness identity chooses parsing/launch dialects but does not authorize an
operation. A transport advertises what it can do; the aggregate routes each
operation to one transport. A lifecycle lease records what pi-dish created or
attached to and is the only source of truth for close behavior. A
verified v2 upstream-Pi bridge may explicitly opt its process into graceful
signal-based close, preserving today's behavior; a PID in a registry entry
alone does not create that lease.

Every lease `claim` is instance-bound: harness id, spawn token/launch id where
applicable, daemon active-session id where applicable, exact process birth
identity where applicable, and the transport/connection generation that
established it. The aggregate can select at most one valid destructive lease;
conflicting claims make close unavailable rather than picking one.

Leases fail closed across disconnect/restart. A destructive lease may be
restored only from durable pi-dish creation evidence plus positive
reconciliation with the exact host process. A fresh bridge with the same
native id or path does not inherit an old lease. Otherwise the role downgrades
to external/uncloseable. OMP logical close additionally requires a canary that
proves the wrapper registry process is the owned tmux agent process. Prime gets
only an owned-client lease: terminating its TUI client is not logical session
close, and worker close remains unsupported.

Host identification order:

1. explicit wrapper id matched to the expected pi-dish launch/spawn token;
2. an explicitly installed harness wrapper for an external process;
3. a uniquely matching configured session root, marked **inferred** and usable
   only for read-only session profiling;
4. `pi-compatible`/unknown for a legacy or unidentifiable bridge.

Identity from a wrapper or path must never grant process signalling by itself.
The wrapper establishes a durable host namespace and parsing association;
lifecycle authority still comes from an instance-bound launch claim. Legacy
registry entries without wrapper metadata retain the generic public bridge
baseline only: do not guess that they are upstream Pi, do not map them to a
storage corpus, and do not expose close/private queue operations. Loading the
appropriate wrapper supplies v2 identity/capabilities.

### 2. Represent one logical history with instance-safe live roles

Matching wrapper identity plus canonical session-file path or persisted routing
id attaches a historical candidate to a logical session. It does **not** prove
that two live registrations are the same process: two writers can point at the
same JSONL. Each bridge registration therefore has its own `instanceId`, socket,
registry filename, process-birth claim, and connection generation.

Live roles merge only with process-instance evidence:

1. an expected wrapper id plus spawn token from the same tmux launch;
2. an exact shared process-birth identity where a host exposes two views from
   one process;
3. for upstream Pi only, the existing pi-dish-owned RPC role plus its exact
   launch/process claim.

Never merge live roles on an unqualified raw id, session path, PID alone, cwd,
or model/name similarity. If multiple bridge roles point at one logical history
without instance proof, retain all claims, surface a conflict, and disable
routed live/destructive controls instead of choosing whichever registered
last. Key bridge connection pools by full registry claim/generation, not
`sessionKey` alone.

After reconciliation, operation routing is deterministic:

- use the selected wrapper bridge for public operations and extension UI/events;
- allow RPC routing only inside the existing upstream-Pi descriptor;
- choose one bridge instance as the event/dialog source only when its instance
  claim is unambiguous;
- close only through a matching lifecycle lease, independently of which role
  handled the last prompt.

### 3. A small harness descriptor, not a god adapter

Start with one `lib/harnesses.js` registry. Split it only when implementations
become large. A descriptor should hold data and narrow functions:

```javascript
{
  id: 'pi' | 'omp' | 'prime',
  label: 'Pi' | 'Oh My Pi' | 'Prime Agent',
  wrapper: {
    entrypoint,
    harnessId,
    eventProfile,
  },
  paths(home, env),
  launch: {
    transport: 'tmux',
    rpcFallback: false, // true only for the upstream Pi descriptor
    resolveCommand(env),
    newArgs(options),
    resumeArgs(sessionFile, options),
    listModels(command),
  },
  sessions: {
    layout: 'nested' | 'flat',
    decodeHeader(entries),
    decodeModelChange(entry),
    decodeName(entries),
  },
}
```

The bridge core should export a small wrapper factory. The Pi wrapper supplies
the optional private queue quirk; OMP and Prime wrappers use only public APIs
and their explicit event profiles. A future fork adds one wrapper/descriptor
pair and fixtures. The server rejects a wrapper id that disagrees with an
expected spawn token instead of silently reclassifying the process.

The upstream Pi descriptor must initially reproduce current behavior exactly,
including its RPC fallback. `rpcFallback: false` is an invariant for every
alternative descriptor. This gives the extraction a no-behavior-change Pi
checkpoint before adding either new harness.

### 4. Version and capability the bridge protocol

Extend registry and `hello` state while accepting old entries:

```javascript
{
  protocolVersion: 2,
  wrapper: { harnessId, name, hostVersion, wrapperVersion, eventProfile },
  bridgeInstanceId,
  nativeSessionId, // host-native persisted identity
  sessionFile,
  spawnToken,
  capabilities: {
    prompt, steer, followUp, abort,
    compact, models, setModel, setThinking, rename,
    commands, queueRead, queueCancel,
    treeRead, treeNavigate, extensionUI
  }
}
```

The bridge should advertise only operations it can actually perform. The
server and UI should call/hide controls from the aggregate's routed operation
set instead of checking transport classes. Lifecycle authority is never a
bridge capability: it comes from the server's exact tmux/process launch claim.
The server validates wrapper metadata and owns canonical `sessionKey`
serialization rather than trusting a wrapper-provided opaque key.

Registry/socket names include harness and `bridgeInstanceId`, so concurrent
processes for one persisted session cannot overwrite each other before the
server detects the conflict. Unknown and legacy hosts fail closed as described
above.

The wrapper factory is what makes the method semi-generic: a new fork supplies
identity, event mapping, and capabilities without pi-dish pretending it knows
how to scan, resume, mutate, or terminate that harness. Loading the bare legacy
bridge can still provide a non-persistable live-only compatibility view, but it
is not the supported onboarding contract for a new harness.

### 5. Keep a public bridge core and isolate host quirks

The public core should own:

- registration/socket protocol
- bridge registration lifecycle and message/tool forwarding
- prompt/steer/follow-up/abort
- model/thinking/name through public extension APIs
- serializable extension UI
- state refresh and capability reporting

The core entry path must not runtime-import upstream `AgentSession`, patch a
prototype, or register host-specific events unconditionally. Wrappers install
optional event/UI adapters independently and advertise a capability only after
the required public methods/handlers exist. One unsupported host event must
disable that feature, not bridge registration.

Private/internal behavior belongs behind a small optional host quirk:

- `upstreamPiQueueQuirk`: current queue snapshots and indexed cancellation,
  protected by the existing real-Pi integration canary;
- OMP: no queue cancellation until OMP exposes a stable operation;
- Prime: translate `session_action_update` for read-only display if its public
  snapshot is sufficient, but do not mutate `ActionStore` internals.

Refresh model/thinking state from public APIs on supported lifecycle events and
after bridge-originated setters. Do not assume every fork emits upstream's
exact `model_select`, queue, or compaction event names.

### 6. Profile Pi-lineage JSONL reads; never genericize unsafe writes

Most transcript/index code can stay shared after adding profile hooks for:

- session root(s) and flat vs nested traversal;
- which physical entry is the session header;
- routing identity (filename/header/native id);
- model-change decoding (`provider` + `modelId` vs `model` ref);
- title/name entries and harmless host bookkeeping entries.

Discovery must emit a candidate object, not just a path:

```javascript
{ sessionKey, harnessId, profileId, profileVersion, file }
```

That candidate remains intact through transcript reads, metadata/search/usage
indexing, skill mining, and related-session resolution. Those layers derive
identity from `sessionKey`, never by independently guessing from the basename
or header. The persistent index may retain the physical path as its storage
key, but profile id/version participate in cache validity and are persisted
with the canonical key. A profile version change rebuilds unchanged JSONL.

Treat every bundled Pi SDK call as a verified-upstream-only operation, even if
it appears read-only. The operation inventory includes historical tree read,
direct HTML export, share-token HTML export, rename/model mutation, and
branch/summary. OMP/Prime may use a profile-native reader/exporter or a
harness-native implementation; otherwise the route returns unsupported. An
existing share token for a derived harness must never fall through to the
bundled Pi exporter.

The same rule applies to session-scoped model/command fallbacks: if a live
alternative wrapper cannot provide models or commands, return unsupported
rather than falling through to the global Pi catalog, bundled Pi commands, or
Pi settings mutation. Host-global model defaults remain explicitly Pi-scoped.

Inactive mutations are a separate capability. Do not append guessed JSONL or
open a derived harness file with the bundled upstream SDK. Prefer:

1. a live wrapper/bridge operation;
2. resume through that harness, then mutate live;
3. a harness-native SDK implementation with an ownership/lease check;
4. otherwise return an explicit unsupported response.

This is especially important for Prime, where a file that appears inactive can
still belong to a resident daemon worker.

### 7. Namespace identity before combining corpora

This is a release gate, not cleanup to do after adding OMP. Pi, OMP, and Prime
can produce colliding filename/header ids, and current raw ids are persisted in
more places than the session index.

Model the key as the tuple `(harnessNamespace, nativeRoutingId)` and serialize
it through one reversible helper into an opaque `sessionKey`. Known namespaces
are wrapper/descriptor ids; a bare legacy/unknown bridge uses a non-persistable
live-instance namespace. Do not hand-concatenate or parse keys throughout
routes. Return `harnessId`, `nativeSessionId`, and `sessionKey` as distinct API
fields.

Migration inventory:

- server routing plus bridge/RPC connection maps, registry/socket filenames,
  runtime/diff caches, resume lookups, tmux placement/terminal PTY maps, and
  transient extension-UI state;
- `shares.json`, `pages.json`, and `comments.json` session associations;
- both keys in `session-provenance.json` (launched and source sessions), plus
  parent/related-session links;
- indexed metadata and skill-activation records that currently emit raw
  session ids (the physical file path can remain the index storage key);
- browser selection, drafts/prompt history, pinned/seen/expanded session
  state, terminal mode, and every API URL/bookmark carrying a session id.

Before corpus two is enabled:

1. bump persisted store schemas and migrate all pre-multi-harness raw ids to
   the upstream `pi` namespace; those stores were Pi-only when written;
2. bump/rebuild derived index records rather than trying to patch stale
   embedded metadata;
3. migrate browser session-keyed local storage on first load, retaining a
   bounded compatibility read for old Pi keys;
4. change all internal lookup and write paths to canonical keys, then enable
   OMP discovery behind that completed boundary.

Backward compatibility:

- interpret every unnamespaced legacy route id as upstream `pi` only, then
  redirect/return its canonical key; a colliding OMP/Prime id never changes an
  old Pi link's meaning;
- return/consume `sessionKey` for all new multi-harness navigation and writes;
- reject ambiguity within the Pi corpus rather than routing to whichever Pi
  candidate scanned first, and never search other harnesses for a raw route;
- keep public share/page tokens stable while migrating their internal session
  associations.

Keep persisted session id, filename id, daemon active-session id, process
instance id, and pi-dish routing key as separate fields. They are not generally
interchangeable.

## Delivery plan

### Phase 1 — Identity boundary, wrapper core, and instance-safe bridge roles

1. Implement and migrate canonical session keys everywhere listed above.
   **Do not enable a second historical root before this lands.**
2. Add the small harness registry with one `pi` descriptor and move current
   Pi constants behind it without changing upgraded-Pi behavior.
3. Extract a public-API-only bridge core and a Pi wrapper; move the runtime
   `AgentSession` import/prototype patch wholly into the verified Pi queue
   quirk.
4. Add bridge `protocolVersion`, wrapper metadata, `bridgeInstanceId`,
   instance-safe registry/socket names, and operation capabilities. Make
   v1/unknown entries generic, non-persistable, and conservative.
5. Introduce logical-history aggregation, instance-safe bridge roles,
   deterministic operation routing, and tmux/process lifecycle leases. Keep
   existing RPC routing inside the Pi descriptor only.
6. Replace touched `instanceof` and registry-PID assumptions with aggregate
   operation/lifecycle checks; key bridge pools by full claim/generation.
7. Change discovery/index boundaries to carry the candidate profile/key and
   gate every `lib/pi-sdk.js` plus session model/command fallback route to
   verified upstream Pi.

**Exit criterion:** upgraded upstream Pi retains current behavior; an unknown
fork can add an explicit thin wrapper without changing the bridge core; bare
legacy/unknown bridge entries get public live controls but cannot persist,
associate history, trigger private operations, or signal a process. A running
v1 Pi bridge visibly requests reload for trusted queue/close controls. All
migration, instance-conflict, and collision fixtures pass.

### Phase 2 — OMP attach + history slice

1. Add the OMP wrapper/descriptor, session root/layout, title-first header
   decode, combined model-ref decode, and read-only historical indexing.
2. Support/document loading the OMP wrapper into an existing OMP process.
3. Run public bridge event/control canaries, including one real model turn, on
   a pinned OMP/Bun pair.
4. Keep queue editing, inactive mutation, pi-dish spawning/resume, and model CLI
   out of this slice. Native OMP RPC remains out of scope permanently.

**Exit criterion:** attached OMP sessions and OMP history coexist with Pi under
canonical keys; stream/prompt/steer/follow-up/abort/model/thinking/name and the
supported extension UI subset work; unsupported controls are hidden or return
a precise capability error.

### Phase 3 — Prime attach + history slice

1. Add the Prime wrapper/descriptor, flat root traversal, routing-id profile,
   and read-only parsing that ignores known bookkeeping entries.
2. Support/document loading the Prime wrapper into an existing Prime process
   and run public bridge event/control canaries, including one real model turn.
3. Treat that wrapper registration as an external/resident attachment: do not
   signal its worker PID, mutate JSONL/queues directly, or infer daemon
   administration authority.
4. Verify a Prime path that is both active in the daemon and present in history
   attaches to one logical history, while multiple live wrapper instances for
   that path remain distinct/conflicted until instance evidence resolves them.

**Exit criterion:** attached Prime sessions and Prime history coexist with Pi
and OMP without identity collisions or unsafe live-role merging. Spawn, resume,
client termination, and logical close remain unavailable in this slice. Native
Prime RPC is permanently out of scope.

### Phase 4 — Managed tmux launch/resume, with no alternative RPC

1. Generalize the current tmux launcher to accept a harness descriptor's
   command, wrapper entrypoint/install expectation, new/resume argv, model CLI,
   environment, and expected wrapper id.
2. Set `rpcFallback: false` for OMP/Prime. Registration timeout, uncertain
   resume, or cleanup failure must return a precise error/quarantine; never
   start a second RPC writer for the same file.
3. Add OMP `omp` new/resume and `models --json`; keep logical close unsupported.
4. Add Prime `prime-agent` TUI new/resume and `model list`. Correlate its worker
   wrapper using expected harness plus spawn token, but record only an
   owned-client lease. Do not expose logical close or report TUI exit as worker
   termination.
5. Support both an explicit user tmux target and the managed hidden tmux target;
   bridge registration remains the only readiness signal and live transport.

**Exit criterion:** explicit new/resume/model-list flows work for OMP and Prime
through tmux and their wrappers, with no alternative RPC process or duplicate
event/dialog source. OMP close and Prime logical close remain unsupported;
Prime can detach only its exact pi-dish-owned client pane, and resident or
unrelated workers remain untouched.

### Phase 5 — Optional parity work

- stable OMP queue API integration if one becomes available;
- Prime session-action display/cancellation through a public id-based API;
- Prime logical worker completion only through a future host-supported,
  acknowledged operation;
- host-native inactive export/branch/rename/model operations;
- Prime RLM parent/child visualization;
- richer host-specific commands and extension UI.

These are not prerequisites for useful support.

## Test strategy

1. **Identity migration fixtures:** every persisted/server/browser store listed
   above upgrades raw Pi ids and preserves tokens/content. A raw URL with
   colliding Pi and OMP native ids still resolves to Pi; ambiguity within Pi is
   rejected.
2. **Aggregate reconciliation tests:** history and bridge roles associate by
   canonical profile identity, but multiple live bridges remain instance-safe;
   only process evidence merges live views. Keep bridge+RPC cases Pi-only and
   ensure each operation/dialog/event source has one unambiguous route.
3. **Wrapper/descriptor tests:** exact wrapper identity/evidence, paths, parsing
   profiles, tmux new/resume/model-list argv, ownership modes, and
   `rpcFallback: false` for OMP/Prime.
4. **Session fixtures:** small sanitized JSONLs generated by pinned Pi, OMP,
   and Prime versions; cover title-first and flat layouts, model/name parsing,
   header/filename disagreement, parent links, and identity collisions. Verify
   unchanged JSONL reindexes when its profile version changes and every derived
   metadata/search/usage/skill record retains the candidate's canonical key.
5. **No-alternative-RPC tests:** every OMP/Prime new/resume timeout and cleanup
   path fails or quarantines without invoking `lib/rpc-session.js`; existing Pi
   RPC tests remain unchanged.
6. **Wrapper protocol tests:** v1 conservative compatibility, v2 wrapper
   identity/capabilities, wrong-wrapper spawn rejection, instance-safe
   registry/socket identity, and unsupported-operation errors.
7. **Lifecycle tests:** owned Pi process, unsupported OMP close, unverified
   external wrapper, and Prime owned TUI client each permit only their declared
   action. Verify that Prime TUI exit is never reported as worker/session
   termination.
8. **Real-host canary:** pinned OMP/Bun and Prime tests use an isolated local
   fake OpenAI Responses server to exercise real streamed turns without user
   credentials, in addition to launch/resume and lifecycle checks.
9. **UI smoke:** mixed harness list, wrapper/harness badge, capability-hidden
   actions, legacy raw-id redirect, one history with explicit conflicting live
   instances, and no duplicate event/dialog source. Add the new-session harness
   picker when Phase 4 lands.
10. **Bundled-SDK route gates:** OMP and Prime historical tree/direct export/
    share export/mutation routes never call `lib/pi-sdk.js`; include an
    existing derived-harness share token, failed live model/command discovery,
    and precise unsupported responses instead of upstream Pi fallbacks.

## Definition of done

### First useful release (Phases 1–3)

- Upgraded Pi-wrapper behavior remains unchanged; legacy bare bridge entries
  retain public live controls but visibly require reload for trusted identity,
  persistence, queue, or ownership operations.
- Pi, OMP, and Prime attached/live and historical sessions coexist without id
  collisions or unsafe merging of distinct live instances.
- All three support tested bridge prompt streaming and core public controls.
- Unsupported controls are capability-gated, not attempted optimistically.
- OMP/Prime JSONLs are never passed to the bundled upstream Pi SDK for
  read/tree/export or mutation operations.
- A new bridge-compatible fork can add a thin identity/event wrapper and
  descriptor without changing shared bridge/server control logic; a bare
  unknown bridge remains non-persistable live-only.

### Managed tmux launch target (Phase 4)

- New-session and resume choose a harness explicitly and use its tmux launch
  profile/wrapper.
- OMP's optional model-list command uses known descriptor CLI argv; Prime has
  no global model catalog. Live models and commands come from either wrapper.
- No OMP/Prime path starts or falls back to native RPC.
- OMP logical close is unavailable. Prime owns only its TUI client; logical
  worker close is unavailable and unrelated daemon workers remain untouched.

## Risks

1. **Fork velocity:** OMP and Prime are moving quickly. Pin real-host canaries
   and report host/protocol versions in registry entries.
2. **Private ABI drift:** the current upstream queue path is already private.
   Isolate it and fail closed.
3. **Identity migration:** namespaced keys touch URLs, caches, shares, comments,
   pages, browser drafts/state, provenance, indexes, and related-session links.
   Complete it before corpus two and test ambiguous ids.
4. **Prime ownership:** an owned tmux TUI is only a daemon client. Direct file
   writes, bridge-worker signalling, or reporting client exit as worker exit can
   corrupt state or mislead the UI. Keep logical close unsupported.
5. **Duplicate representation:** one logical history may have multiple bridge
   instances (and upstream Pi may also have RPC). Bad reconciliation can
   duplicate prompts/dialogs or route a destructive action to the wrong
   instance. Merge live roles only on process evidence.
6. **Scope creep:** Prime's recursive-agent graph and OMP's broader plugin UI
   are separate products, not required for core remote control.

## Accepted product decisions

1. **Capability-degraded baseline:** OMP/Prime ship without queue cancellation,
   compact, tree operations, or unsafe inactive mutation.
2. **New-session default:** upstream Pi remains the default; harness choice is
   explicit in the new-session UI.
3. **Mixed-corpus URLs:** alternative harnesses use namespaced `sessionKey`
   routes now; legacy raw ids continue to mean upstream Pi.
4. **Alternative transport:** harness-specific wrappers use tmux + bridge only;
   native RPC and RPC fallback remain upstream-Pi-only.
5. **Lifecycle:** OMP close is unsupported. Prime close detaches only the exact
   pi-dish-owned client pane and never signals its resident worker.

## Out of scope for the baseline

- treating Prime RLM descendants as ordinary pi-dish peer sessions;
- Prime A2A messaging, schedules, goals, or daemon administration UI;
- OMP/Prime native RPC transports or RPC fallback;
- Prime logical worker close without a host-supported acknowledged operation;
- OMP marketplace/plugin management;
- rendering every host-specific TUI component in the browser;
- emulating unsupported commands or mutating private queues merely for parity.
